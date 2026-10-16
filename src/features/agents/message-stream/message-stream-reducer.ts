// 结构化消息流的纯函数 reducer。
//
// 消费 `AgentStreamEvent`（来自 agent-session-stream-event 广播）与 hook 内部
// 动作（RESET/HYDRATE/HYDRATE_FAILED），折叠成 `MessageStreamState`。
//
// 增量合并语义（与后端 `codex_app_server/session.rs` 的广播策略对齐）：
// - assistant_message 带 messageId：每个 delta 携带完整累积文本 → 按 messageId
//   幂等 upsert。同 id 仍是时间线尾项时原地替换；若中间已插入 reasoning 等
//   条目，则把正文条目挪到尾部再替换，保持「先思考、后提问」的到达顺序。
// - reasoning 无 id：后端每次发完整最新文本 → 合并到上一条 reasoning（若尾项是
//   reasoning 则替换，否则 append），保证只剩最终完整推理。
// - tool_call：按 callId upsert；item/started→running，item/completed→终态。
// - todo：codex plan 渐进更新 → 若尾项是 todo 则替换，否则 append。
// - user_message：按 messageId 或文本合并乐观消息与后端回显；同文不同次发送保留多条。
// - error / compaction：直接 append。
//
// reducer 为纯函数，不依赖 React，便于单测。

import type {
  AgentStreamEvent,
  AgentTimelineItem,
  AgentUsage,
  TimelineHistoryItem,
} from "../agent-stream-types";
import {
  foldColdCollapsibleEntries,
  isColdCollapsibleEntry,
  stripToolCallBody,
} from "./message-stream-fold";
import { mergeToolCallDetail } from "./message-stream-tool-detail";
import { foldSubagentRoster } from "./output-source";
import type {
  MessageStreamAction,
  MessageStreamEntry,
  MessageStreamState,
  SubagentRosterEntry,
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
    turnInterrupted: false,
    interruptedStopReason: null,
    subagentInterrupted: false,
    subagents: [],
    isInitialized: false,
    expandedEntryIds: [],
    entryLoadErrors: {},
  };
}

/** 视为「正常完成」的 SDK stop_reason。null（后端未上报）也算正常，避免误判。 */
const CLEAN_STOP_REASONS = new Set(["end_turn", "stop_sequence"]);

export function isCleanStopReason(stopReason: string | null): boolean {
  return stopReason === null || CLEAN_STOP_REASONS.has(stopReason);
}

/**
 * 末条 timeline 是否为「已完成的 tool_call」。
 *
 * 正常 turn 都以 assistant 收尾消息结束；若 tool 完成后直接 turn_completed、无收尾
 * 消息，即「被提前掐断」形态。该信号与 stop_reason 无关，可兜底代理把空响应当
 * end_turn 上报、或后端未上报 stop_reason 的场景。
 */
function lastEntryIsCompletedToolCall(entries: MessageStreamEntry[]): boolean {
  const last = entries[entries.length - 1];
  return (
    last !== undefined &&
    last.kind === "tool_call" &&
    last.item.type === "tool_call" &&
    last.item.status === "completed"
  );
}

/**
 * timeline item 是否代表 agent 正在产出（即 turn 实际仍在跑）。
 *
 * reasoning / assistant_message / 仍 running 的 tool_call 视为产出；已完成、
 * 失败或取消的 tool_call 以及 user_message / error / todo / compaction 不计。
 * 用于在 spurious turn_completed 之后收到产出事件时恢复 running。
 */
function timelineItemBelongsToSubagent(item: AgentTimelineItem): boolean {
  if (
    item.type !== "assistant_message" &&
    item.type !== "reasoning" &&
    item.type !== "tool_call" &&
    item.type !== "compaction"
  ) {
    return false;
  }
  return Boolean(item.subagentId?.trim());
}

function timelineItemIndicatesActiveWork(item: AgentTimelineItem): boolean {
  // 子智能体的产出和拉起记录都不代表用户 Turn 还在跑。
  if (
    timelineItemBelongsToSubagent(item) ||
    (item.type === "tool_call" && item.detail.type === "collab_agent")
  ) {
    return false;
  }
  return (
    item.type === "assistant_message" ||
    item.type === "reasoning" ||
    (item.type === "tool_call" && item.status === "running")
  );
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
      const folded = action.items.reduce<{
        entries: MessageStreamEntry[];
        subagents: SubagentRosterEntry[];
        turnId: string | null;
      }>(
        (current, rawItem) => {
          const historyItem = asHistoryItem(rawItem);
          const item = historyItem.item;
          const markedTurn = historyItem.turnId ?? null;
          const turnId = markedTurn ?? current.turnId;
          const startsTurn =
            markedTurn !== null &&
            (current.turnId === null || markedTurn !== current.turnId);
          const withBoundary = startsTurn
            ? appendTurnBoundary(current.entries, turnId)
            : current.entries;
          return {
            entries:
              item.type === "subagent_roster"
                ? withBoundary
                : applyTimelineItem(withBoundary, item, historyItem.logOffset),
            subagents: foldSubagentRoster(current.subagents, item),
            turnId,
          };
        },
        { entries: [], subagents: [], turnId: null },
      );
      return foldState({
        ...createInitialState(),
        entries: folded.entries,
        subagents: folded.subagents,
        effort: action.effort ?? null,
        model: action.model ?? null,
        isInitialized: true,
      });
    }

    case "HYDRATE_FAILED":
      return {
        ...state,
        isInitialized: true,
        lastError: action.error,
      };

    case "EVENT":
      return applyEvent(state, action.event, action.logOffset);

    case "EVENT_BATCH":
      return action.events.reduce(
        (currentState, queued) =>
          applyEvent(currentState, queued.event, queued.logOffset),
        state,
      );

    case "SET_ENTRY_EXPANDED": {
      const expanded = action.expanded
        ? state.expandedEntryIds.includes(action.entryId)
          ? state.expandedEntryIds
          : [...state.expandedEntryIds, action.entryId]
        : state.expandedEntryIds.filter((id) => id !== action.entryId);
      if (expanded === state.expandedEntryIds) {
        return state;
      }
      return foldState({ ...state, expandedEntryIds: expanded });
    }

    case "RESTORE_ENTRY_BODY": {
      const index = state.entries.findIndex(
        (entry) => entry.id === action.entryId,
      );
      if (index < 0) {
        return state;
      }
      const current = state.entries[index];
      if (
        current.item.type !== "tool_call" ||
        action.item.type !== "tool_call"
      ) {
        return state;
      }
      const entryLoadErrors = { ...state.entryLoadErrors };
      delete entryLoadErrors[action.entryId];
      return foldState({
        ...state,
        entryLoadErrors,
        entries: replaceAt(state.entries, index, {
          ...current,
          item: action.item,
        }),
      });
    }

    case "SET_ENTRY_LOAD_ERROR": {
      if (action.error == null) {
        if (!(action.entryId in state.entryLoadErrors)) {
          return state;
        }
        const entryLoadErrors = { ...state.entryLoadErrors };
        delete entryLoadErrors[action.entryId];
        return { ...state, entryLoadErrors };
      }
      return {
        ...state,
        entryLoadErrors: {
          ...state.entryLoadErrors,
          [action.entryId]: action.error,
        },
      };
    }

    case "OPTIMISTIC_USER_MESSAGE": {
      // 乐观插入用户消息：发送成功后立即展示，不等后端 timeline 回显。
      // 后端回显到达后通过文本匹配替换该乐观条目，避免重复展示。
      //
      // 竞态保护：后端 timeline 事件经 requestAnimationFrame 异步 flush，而
      // sendAgentMessage 的 invoke 响应可能更慢——后端 user_message 回显可能先于
      // 乐观插入到达并被追加。此时乐观条目若再无条件追加会导致同一消息显示两次。
      // 仅当「末条」已是同文后端回显时跳过；不可扫全量历史，否则多轮选择题
      // 用户反复回复同一选项（如 "A"）时，后续乐观消息会被误吞。
      const lastEntry = state.entries[state.entries.length - 1];
      if (
        lastEntry &&
        lastEntry.kind === "user_message" &&
        !lastEntry.id.startsWith("optimistic-") &&
        lastEntry.item.type === "user_message" &&
        normalizeMessageText(lastEntry.item.text) ===
          normalizeMessageText(action.text)
      ) {
        return state;
      }
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
      return {
        ...state,
        entries: [...state.entries, entry],
        turnInterrupted: false,
        interruptedStopReason: null,
        subagentInterrupted: false,
      };
    }

    default:
      return state;
  }
}

function applyEvent(
  state: MessageStreamState,
  event: AgentStreamEvent,
  envelopeLogOffset?: number,
): MessageStreamState {
  switch (event.type) {
    case "thread_started":
      return state;

    case "turn_started":
      return foldState({
        ...state,
        entries: appendTurnBoundary(state.entries, event.turnId),
        turnStatus: "running",
        turnInterrupted: false,
        interruptedStopReason: null,
        subagentInterrupted: false,
      });

    case "turn_completed": {
      const usage = mergeUsage(state.usage, event.usage);
      const stopReason = event.stopReason ?? null;
      const reasonAbnormal = !isCleanStopReason(stopReason);
      const interrupted =
        reasonAbnormal || lastEntryIsCompletedToolCall(state.entries);
      return {
        ...state,
        turnStatus: "idle",
        usage,
        turnInterrupted: interrupted,
        // 正常 end_turn 但末条还是已完成工具时也记下 stopReason。
        // 紧随其后的收尾正文据此保持 idle，只清横幅，不恢复执行中。
        interruptedStopReason: interrupted ? stopReason : null,
      };
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
      const subagents = foldSubagentRoster(state.subagents, event.item);
      // 收到「有产出」事件说明 turn 实际仍在跑。若此前被 spurious turn_completed
      // 误置异常中断态（含子代理被取消留下的 subagentInterrupted 横幅），恢复
      // running 并清红条，避免活动进行中却挂着「异常中断 / 工作流可能已暂停」。
      // end_turn 先于收尾正文到达时，末条还是已完成工具，会被标成异常中断。
      // 随后的正文只补进时间线并清掉横幅，不再把提交按钮拉回执行中。
      // stop_reason 异常（如 max_tokens）的 idle 仍按产出恢复 running。
      const activeWorkClearsInterrupt =
        (state.turnInterrupted || state.subagentInterrupted) &&
        timelineItemIndicatesActiveWork(event.item);
      const settlesCleanLateReply =
        activeWorkClearsInterrupt &&
        state.turnStatus === "idle" &&
        state.interruptedStopReason !== null &&
        isCleanStopReason(state.interruptedStopReason);
      const turnPatch = settlesCleanLateReply
        ? {
            turnInterrupted: false,
            interruptedStopReason: null,
            subagentInterrupted: false,
          }
        : activeWorkClearsInterrupt
          ? {
              turnStatus: "running" as const,
              turnInterrupted: false,
              interruptedStopReason: null,
              subagentInterrupted: false,
            }
          : {};
      if (event.item.type === "subagent_roster") {
        const lastSeq =
          event.seq > (state.lastSeq ?? -1) ? event.seq : state.lastSeq;
        return { ...state, subagents, lastSeq };
      }
      if (shouldSkipTimelineItem(event.item, state.entries)) {
        const lastSeq =
          event.seq > (state.lastSeq ?? -1) ? event.seq : state.lastSeq;
        return { ...state, ...turnPatch, subagents, lastSeq };
      }
      const entries = applyTimelineItem(
        state.entries,
        event.item,
        event.logOffset ?? envelopeLogOffset,
        state.expandedEntryIds,
      );
      const lastSeq =
        event.seq > (state.lastSeq ?? -1) ? event.seq : state.lastSeq;
      // 异步子代理被中断（task_notification status 异常）：工作流可能因此暂停，
      // 挂横幅提示用户。与 turnInterrupted 独立——主 turn 仍可能以 end_turn 正常结束。
      const subagentInterrupted =
        event.item.type === "tool_call" &&
        event.item.detail.type === "sub_agent" &&
        event.item.status === "canceled";
      return foldState({
        ...state,
        ...turnPatch,
        entries,
        subagents,
        lastSeq,
        ...(subagentInterrupted ? { subagentInterrupted: true } : {}),
      });
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
  logOffset?: number | null,
  expandedEntryIds: readonly string[] = [],
): MessageStreamEntry[] {
  if (shouldSkipTimelineItem(item, entries)) {
    return entries;
  }

  switch (item.type) {
    case "assistant_message": {
      const messageId = item.messageId;
      if (messageId) {
        const entryId = scopedTimelineId(messageId, item.subagentId);
        const index = findLastIndex(
          entries,
          (entry) => entry.kind === "assistant_message" && entry.id === entryId,
        );
        if (index >= 0) {
          const next = entryWithOffset(
            {
              id: entryId,
              kind: item.type,
              item,
            },
            logOffset,
            entries[index]?.logOffset,
          );
          // Grok 整轮共用一个 messageId，reasoning 会插在同一条正文中间。
          // 原地替换会让后写的问题留在思考前面；中间已有别的条目时挪到尾部。
          if (index === entries.length - 1) {
            return replaceAt(entries, index, next);
          }
          return [
            ...entries.slice(0, index),
            ...entries.slice(index + 1),
            next,
          ];
        }
      }
      return [
        ...entries,
        entryWithOffset(toEntry(item, nextLocalId(entries)), logOffset),
      ];
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

      // 无 messageId 时仅抑制「紧邻末条」的同文回显，避免双写。
      // 有 messageId 的条目：同 id 已在上方合并；不同 id 即使文案相同也是新发送
      // （多轮选择题反复选 "A"），必须各自展示，不可按全文历史文本去重。
      const lastEntry = entries[entries.length - 1];
      if (
        !messageId &&
        lastEntry &&
        lastEntry.kind === "user_message" &&
        lastEntry.item.type === "user_message" &&
        normalizeMessageText(lastEntry.item.text) ===
          normalizeMessageText(item.text)
      ) {
        return entries;
      }

      return [...entries, toEntry(item, nextLocalId(entries))];
    }

    case "reasoning": {
      // 后端每次发完整最新文本且无 id：合并到同一来源的上一条 reasoning。
      const lastIndex = entries.length - 1;
      const last = entries[lastIndex];
      if (
        last &&
        last.kind === "reasoning" &&
        last.item.type === "reasoning" &&
        (last.item.subagentId ?? undefined) === item.subagentId
      ) {
        // 流式 flush 与 assistant 完整消息阶段的 reasoning 文本可能存在空白/换行
        // 差异（trim、\r\n 等）。用 normalizeMessageText 归一化比较，避免因细微
        // 差异用 durationMs=null 的 incoming 覆盖掉已带 duration 的 last 条目，
        // 导致「思考过程」标题回退成「正在思考…」。
        const mergedItem: Extract<AgentTimelineItem, { type: "reasoning" }> =
          item.durationMs == null &&
          last.item.type === "reasoning" &&
          last.item.durationMs != null &&
          normalizeMessageText(last.item.text) ===
            normalizeMessageText(item.text)
            ? { ...item, durationMs: last.item.durationMs }
            : item;
        return replaceAt(
          entries,
          lastIndex,
          entryWithOffset(
            {
              id: last.id,
              kind: "reasoning",
              item: mergedItem,
            },
            logOffset,
            last.logOffset,
          ),
        );
      }
      return [
        ...entries,
        entryWithOffset(toEntry(item, nextLocalId(entries)), logOffset),
      ];
    }

    case "tool_call": {
      const callId = scopedTimelineId(item.callId, item.subagentId);
      const index = findLastIndex(
        entries,
        (entry) => entry.kind === "tool_call" && entry.id === callId,
      );
      if (index >= 0) {
        // tool_use 阶段（带 path/command/diff 等摘要）与 tool_result 回填
        // （带 output/exit_code 但可能清空摘要）会按同一 callId 到达。
        // 字段级合并：incoming 非空字段覆盖 existing，空字段保留 existing，
        // 避免后端 patch_detail 新建空 detail 时丢失 tool_use 阶段的 path/command。
        const existing = entries[index];
        const existingDetail =
          existing.kind === "tool_call" && existing.item.type === "tool_call"
            ? existing.item.detail
            : null;
        // 占位已经丢掉正文。迟到的旧快照不能把空正文再写回来。
        const keepBody =
          expandedEntryIds.includes(existing.id) ||
          logOffset != null ||
          !isColdCollapsibleEntry(entries, existing.id);
        const incomingDetail = keepBody
          ? item.detail
          : stripToolCallBody(item.detail);
        const mergedDetail = existingDetail
          ? mergeToolCallDetail(existingDetail, incomingDetail)
          : incomingDetail;
        const existingStatus =
          existing.kind === "tool_call" && existing.item.type === "tool_call"
            ? existing.item.status
            : item.status;
        const mergedItem: Extract<AgentTimelineItem, { type: "tool_call" }> = {
          ...item,
          name:
            existing.kind === "tool_call" &&
            existing.item.type === "tool_call" &&
            shouldPreserveExistingToolName(existing.item.name, item.name)
              ? existing.item.name
              : item.name,
          detail: mergedDetail,
          // 终态不能被迟到的 running 回放打回去，否则已完成工具会重新显示为运行中。
          status: preserveTerminalToolStatus(existingStatus, item.status),
        };
        return replaceAt(
          entries,
          index,
          entryWithOffset(
            {
              id: callId,
              kind: item.type,
              item: mergedItem,
            },
            logOffset,
            existing.logOffset,
          ),
        );
      }
      return [
        ...entries,
        entryWithOffset(toEntry(item, nextLocalId(entries)), logOffset),
      ];
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

    case "subagent_roster":
      return entries;

    default:
      return entries;
  }
}

function shouldSkipTimelineItem(
  item: AgentTimelineItem,
  entries: MessageStreamEntry[],
): boolean {
  if (
    item.type === "tool_call" &&
    item.status !== "running" &&
    entries.some(
      (entry) =>
        entry.kind === "tool_call" &&
        entry.id === scopedTimelineId(item.callId, item.subagentId),
    )
  ) {
    return false;
  }
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
      // 回填场景：command 可能为空但 output/exit_code 有值，任一非空即非空。
      return (
        detail.command.trim().length === 0 &&
        !(detail.output && detail.output.trim().length > 0) &&
        detail.exitCode == null
      );
    case "read":
      return (
        detail.path.trim().length === 0 &&
        !(detail.content && detail.content.trim().length > 0)
      );
    case "edit":
      return (
        detail.path.trim().length === 0 &&
        !(detail.diff && detail.diff.trim().length > 0)
      );
    case "write":
      return (
        detail.path.trim().length === 0 &&
        !(detail.content && detail.content.trim().length > 0)
      );
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
      return item.messageId
        ? scopedTimelineId(item.messageId, item.subagentId)
        : `local-${localId}`;
    case "user_message":
      return item.messageId ?? `local-${localId}`;
    case "tool_call":
      return scopedTimelineId(item.callId, item.subagentId);
    default:
      return `local-${localId}`;
  }
}

function scopedTimelineId(id: string, subagentId: string | undefined): string {
  return subagentId ? `${subagentId}:${id}` : id;
}

function normalizeMessageText(text: string): string {
  return text.trim().replace(/\r\n/g, "\n");
}

function preserveTerminalToolStatus(
  previous: Extract<AgentTimelineItem, { type: "tool_call" }>["status"],
  incoming: Extract<AgentTimelineItem, { type: "tool_call" }>["status"],
): Extract<AgentTimelineItem, { type: "tool_call" }>["status"] {
  if (previous !== "running" && incoming === "running") {
    return previous;
  }
  return incoming;
}

function shouldPreserveExistingToolName(
  existingName: string,
  incomingName: string,
): boolean {
  return (
    !isGenericToolName(existingName) &&
    (incomingName.trim().length === 0 || isGenericToolName(incomingName))
  );
}

function isGenericToolName(name: string): boolean {
  return name.trim().toLowerCase() === "tool";
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

function asHistoryItem(
  value: AgentTimelineItem | TimelineHistoryItem,
): TimelineHistoryItem {
  if ("type" in value) {
    return { item: value };
  }
  return value;
}

function appendTurnBoundary(
  entries: MessageStreamEntry[],
  turnId: string | null,
): MessageStreamEntry[] {
  const last = entries[entries.length - 1];
  if (last?.kind === "turn_boundary" && last.id === turnBoundaryId(turnId)) {
    return entries;
  }
  return [
    ...entries,
    {
      id: turnBoundaryId(turnId),
      kind: "turn_boundary",
      item: { type: "compaction", status: "completed" },
    },
  ];
}

function turnBoundaryId(turnId: string | null): string {
  return `turn:${turnId ?? "unknown"}`;
}

function entryWithOffset(
  entry: MessageStreamEntry,
  logOffset: number | null | undefined,
  previous?: number,
): MessageStreamEntry {
  const offset = logOffset ?? previous;
  if (offset == null) {
    return entry;
  }
  return { ...entry, logOffset: offset };
}

function foldState(state: MessageStreamState): MessageStreamState {
  const entries = foldColdCollapsibleEntries(
    state.entries,
    new Set(state.expandedEntryIds),
  );
  if (entries === state.entries) {
    return state;
  }
  return { ...state, entries: entries.slice() };
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
