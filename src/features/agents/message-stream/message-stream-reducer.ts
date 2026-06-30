// 结构化消息流的纯函数 reducer。
//
// 消费 `AgentStreamEvent`（来自 agent-session-stream-event 广播）与 hook 内部
// 动作（RESET/HYDRATE/HYDRATE_FAILED），折叠成 `MessageStreamState`。
//
// 增量合并语义（与后端 `codex_app_server/session.rs` 的广播策略对齐）：
// - assistant_message 带 messageId：每个 delta 携带完整累积文本 → 按 messageId
//   幂等 upsert（找到同 messageId 的尾项则替换文本，否则 append）。
// - reasoning 无 id：后端每次发完整最新文本 → 合并到上一条 reasoning（若尾项是
//   reasoning 则替换，否则 append），保证只剩最终完整推理。
// - tool_call：按 callId upsert；item/started→running，item/completed→终态。
// - todo：codex plan 渐进更新 → 若尾项是 todo 则替换，否则 append。
// - user_message：按 messageId 或文本合并乐观消息与后端回显。
// - error / compaction：直接 append。
//
// reducer 为纯函数，不依赖 React，便于单测。

import type {
  AgentStreamEvent,
  AgentTimelineItem,
  AgentUsage,
} from "../agent-stream-types";
import type {
  MessageStreamAction,
  MessageStreamEntry,
  MessageStreamState,
  TurnStatus,
} from "./message-stream-types";

/** 创建初始状态。 */
export function createInitialState(): MessageStreamState {
  return {
    entries: [],
    turnStatus: "idle",
    usage: null,
    pendingPermissions: [],
    mode: null,
    model: null,
    effort: null,
    lastSeq: null,
    lastError: null,
    isInitialized: false,
  };
}

/** 主 reducer。 */
export function messageStreamReducer(
  state: MessageStreamState,
  action: MessageStreamAction,
): MessageStreamState {
  switch (action.type) {
    case "RESET":
      return createInitialState();

    case "RESTORE":
      return action.state;

    case "HYDRATE": {
      const entries = action.items.reduce<MessageStreamEntry[]>(
        (currentEntries, item) => applyTimelineItem(currentEntries, item),
        [],
      );
      return {
        ...createInitialState(),
        entries,
        effort: action.effort ?? null,
        isInitialized: true,
      };
    }

    case "HYDRATE_FAILED":
      return {
        ...state,
        isInitialized: true,
        lastError: action.error,
      };

    case "EVENT":
      return applyEvent(state, action.event);

    case "EVENT_BATCH":
      return action.events.reduce(
        (currentState, event) => applyEvent(currentState, event),
        state,
      );

    case "OPTIMISTIC_USER_MESSAGE": {
      // 乐观插入用户消息：发送成功后立即展示，不等后端 timeline 回显。
      // 后端回显到达后通过文本匹配替换该乐观条目，避免重复展示。
      const localId = nextLocalId(state.entries);
      const item: AgentTimelineItem = {
        type: "user_message",
        text: action.text,
      };
      const entry: MessageStreamEntry = {
        id: `optimistic-${localId}`,
        kind: "user_message",
        item,
      };
      return { ...state, entries: [...state.entries, entry] };
    }

    default:
      return state;
  }
}

function applyEvent(
  state: MessageStreamState,
  event: AgentStreamEvent,
): MessageStreamState {
  switch (event.type) {
    case "thread_started":
      return state;

    case "turn_started":
      return { ...state, turnStatus: "running" };

    case "turn_completed": {
      const usage = mergeUsage(state.usage, event.usage);
      return { ...state, turnStatus: "idle", usage };
    }

    case "turn_failed": {
      const errorEntry = toEntry(
        {
          type: "error",
          message: event.error,
        },
        nextLocalId(state.entries),
      );
      return {
        ...state,
        turnStatus: "failed",
        lastError: event.error,
        entries: [...state.entries, errorEntry],
      };
    }

    case "turn_canceled":
      return { ...state, turnStatus: "canceled" };

    case "timeline": {
      if (shouldSkipTimelineItem(event.item, state.entries)) {
        const lastSeq =
          event.seq > (state.lastSeq ?? -1) ? event.seq : state.lastSeq;
        return { ...state, lastSeq };
      }
      const entries = applyTimelineItem(state.entries, event.item);
      const lastSeq =
        event.seq > (state.lastSeq ?? -1) ? event.seq : state.lastSeq;
      return { ...state, entries, lastSeq };
    }

    case "usage_updated":
      return { ...state, usage: mergeUsage(state.usage, event.usage) };

    case "permission_requested": {
      const exists = state.pendingPermissions.some(
        (request) => request.id === event.request.id,
      );
      if (exists) {
        return state;
      }
      return {
        ...state,
        pendingPermissions: [...state.pendingPermissions, event.request],
      };
    }

    case "permission_resolved":
      return {
        ...state,
        pendingPermissions: state.pendingPermissions.filter(
          (request) => request.id !== event.requestId,
        ),
      };

    case "mode_changed":
      return {
        ...state,
        mode: event.currentModeId,
      };

    case "model_changed":
      return { ...state, model: event.modelId };

    case "effort_changed":
      return { ...state, effort: event.effort };

    default:
      return state;
  }
}

/**
 * 把一条 timeline item 幂等 upsert 到 entries。
 *
 * 不同 item 类型采用不同合并策略（见文件头注释）。
 */
function applyTimelineItem(
  entries: MessageStreamEntry[],
  item: AgentTimelineItem,
): MessageStreamEntry[] {
  if (shouldSkipTimelineItem(item, entries)) {
    return entries;
  }

  switch (item.type) {
    case "assistant_message": {
      const messageId = item.messageId;
      if (messageId) {
        const index = findLastIndex(
          entries,
          (entry) =>
            entry.kind === "assistant_message" && entry.id === messageId,
        );
        if (index >= 0) {
          return replaceAt(entries, index, {
            id: messageId,
            kind: item.type,
            item,
          });
        }
      }
      return [...entries, toEntry(item, nextLocalId(entries))];
    }

    case "user_message": {
      const messageId = item.messageId;
      if (messageId) {
        const index = findLastIndex(
          entries,
          (entry) => entry.kind === "user_message" && entry.id === messageId,
        );
        if (index >= 0) {
          return replaceAt(entries, index, {
            id: messageId,
            kind: item.type,
            item,
          });
        }
      }

      const optimisticIndex = findLastIndex(
        entries,
        (entry) =>
          entry.kind === "user_message" &&
          entry.id.startsWith("optimistic-") &&
          entry.item.type === "user_message" &&
          normalizeMessageText(entry.item.text) ===
            normalizeMessageText(item.text),
      );
      if (optimisticIndex >= 0) {
        return replaceAt(entries, optimisticIndex, {
          id: messageId ?? entries[optimisticIndex].id,
          kind: item.type,
          item,
        });
      }

      const duplicateIndex = findLastIndex(
        entries,
        (entry) =>
          entry.kind === "user_message" &&
          entry.item.type === "user_message" &&
          normalizeMessageText(entry.item.text) ===
            normalizeMessageText(item.text),
      );
      if (duplicateIndex >= 0) {
        return entries;
      }

      return [...entries, toEntry(item, nextLocalId(entries))];
    }

    case "reasoning": {
      // 后端每次发完整最新文本且无 id：合并到上一条 reasoning。
      const lastIndex = entries.length - 1;
      const last = entries[lastIndex];
      if (last && last.kind === "reasoning") {
        return replaceAt(entries, lastIndex, {
          id: last.id,
          kind: "reasoning",
          item,
        });
      }
      return [...entries, toEntry(item, nextLocalId(entries))];
    }

    case "tool_call": {
      const callId = item.callId;
      const index = findLastIndex(
        entries,
        (entry) => entry.kind === "tool_call" && entry.id === callId,
      );
      if (index >= 0) {
        return replaceAt(entries, index, { id: callId, kind: item.type, item });
      }
      return [...entries, toEntry(item, nextLocalId(entries))];
    }

    case "todo": {
      // codex plan 渐进更新：若尾项是 todo 则替换，否则 append。
      const lastIndex = entries.length - 1;
      const last = entries[lastIndex];
      if (last && last.kind === "todo") {
        return replaceAt(entries, lastIndex, {
          id: last.id,
          kind: "todo",
          item,
        });
      }
      return [...entries, toEntry(item, nextLocalId(entries))];
    }

    case "error":
    case "compaction":
      return [...entries, toEntry(item, nextLocalId(entries))];

    default:
      return entries;
  }
}

function shouldSkipTimelineItem(
  item: AgentTimelineItem,
  entries: MessageStreamEntry[],
): boolean {
  if (isEmptyTimelineItem(item)) {
    return true;
  }
  if (entries.some((entry) => entry.kind === "user_message")) {
    return false;
  }
  if (item.type !== "assistant_message") {
    return false;
  }
  return isStartupNoise(item.text);
}

function isEmptyTimelineItem(item: AgentTimelineItem): boolean {
  switch (item.type) {
    case "user_message":
    case "assistant_message":
    case "reasoning":
      return item.text.trim().length === 0;
    case "tool_call":
      return isEmptyToolCall(item);
    case "todo":
      return item.items.length === 0;
    case "error":
      return item.message.trim().length === 0;
    default:
      return false;
  }
}

function isEmptyToolCall(
  item: Extract<AgentTimelineItem, { type: "tool_call" }>,
): boolean {
  const detail = item.detail;
  switch (detail.type) {
    case "shell":
      return detail.command.trim().length === 0;
    case "read":
    case "edit":
    case "write":
      return detail.path.trim().length === 0;
    case "search":
      return detail.query.trim().length === 0;
    case "plan":
      return detail.text.trim().length === 0;
    default:
      return false;
  }
}

function isStartupNoise(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized === "codeance ready" ||
    normalized === "codex ready" ||
    normalized === "ready" ||
    normalized.startsWith("codeance started") ||
    normalized.startsWith("codex started")
  );
}

/** 从 timeline item 派生稳定 id。 */
function toEntry(item: AgentTimelineItem, localId: number): MessageStreamEntry {
  const id = deriveEntryId(item, localId);
  return { id, kind: item.type, item };
}

function deriveEntryId(item: AgentTimelineItem, localId: number): string {
  switch (item.type) {
    case "assistant_message":
    case "user_message":
      return item.messageId ?? `local-${localId}`;
    case "tool_call":
      return item.callId ?? `local-${localId}`;
    default:
      return `local-${localId}`;
  }
}

function normalizeMessageText(text: string): string {
  return text.trim().replace(/\r\n/g, "\n");
}

/** 生成下一个 local 自增序号（基于现有 entries 数量）。 */
function nextLocalId(entries: MessageStreamEntry[]): number {
  return entries.length;
}

/** 合并 usage：新值字段覆盖旧值字段（undefined 不覆盖）。 */
function mergeUsage(
  current: AgentUsage | null,
  next: AgentUsage | null,
): AgentUsage | null {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  return {
    inputTokens: next.inputTokens ?? current.inputTokens,
    outputTokens: next.outputTokens ?? current.outputTokens,
    contextWindowMaxTokens:
      next.contextWindowMaxTokens ?? current.contextWindowMaxTokens,
    contextWindowUsedTokens:
      next.contextWindowUsedTokens ?? current.contextWindowUsedTokens,
  };
}

function replaceAt(
  entries: MessageStreamEntry[],
  index: number,
  entry: MessageStreamEntry,
): MessageStreamEntry[] {
  const next = entries.slice();
  next[index] = entry;
  return next;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }
  return -1;
}

/** 仅供测试：把 TurnStatus 字符串映射暴露，便于断言。 */
export const TURN_STATUS_VALUES: ReadonlyArray<TurnStatus> = [
  "idle",
  "running",
  "failed",
  "canceled",
];
