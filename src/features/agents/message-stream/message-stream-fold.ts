// 折叠项热区：只按 Turn 数收口。
//
// 常驻正文（用户消息、助手消息、推理、错误）一直留在消息流上。
// 可折叠时间轴项只在最近 50 个 Turn 内保留正文；更早的收成折叠项占位。
// 用户正在展开的那一条继续留着正文，收起后再收成占位。
// 同一条的新正文替换旧正文，旧字符串不再留在条目上。

import type { AgentTimelineItem, ToolCallDetail } from "../agent-stream-types";
import type { MessageStreamEntry } from "./message-stream-types";

/** 与后端打开回放相同：最近 50 个 Turn。 */
export const FOLD_HOT_TURN_LIMIT = 50;

export function countTurns(entries: readonly MessageStreamEntry[]): number {
  let turns = 0;
  for (const entry of entries) {
    if (entry.kind === "turn_boundary") {
      turns += 1;
    }
  }
  return turns;
}

/**
 * 超出最近 50 个 Turn 的可折叠项丢掉正文。
 * `expandedIds` 里的条目保持原样，直到用户收起。
 */
export function foldColdCollapsibleEntries(
  entries: readonly MessageStreamEntry[],
  expandedIds: ReadonlySet<string>,
): readonly MessageStreamEntry[] {
  const turns = countTurns(entries);
  if (turns <= FOLD_HOT_TURN_LIMIT) {
    return entries;
  }
  let seenFromEnd = 0;
  let hotStart = entries.length;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].kind === "turn_boundary") {
      seenFromEnd += 1;
      if (seenFromEnd === FOLD_HOT_TURN_LIMIT) {
        hotStart = index;
        break;
      }
    }
  }
  let changed = false;
  const next = entries.map((entry, index) => {
    if (index >= hotStart || expandedIds.has(entry.id)) {
      return entry;
    }
    const folded = foldEntryToPlaceholder(entry);
    if (folded !== entry) {
      changed = true;
    }
    return folded;
  });
  return changed ? next : entries;
}

/** 这条可折叠项是否已经落在最近 50 个 Turn 之外。 */
export function isColdCollapsibleEntry(
  entries: readonly MessageStreamEntry[],
  entryId: string,
): boolean {
  const turns = countTurns(entries);
  if (turns <= FOLD_HOT_TURN_LIMIT) {
    return false;
  }
  let seenFromEnd = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].kind === "turn_boundary") {
      seenFromEnd += 1;
    }
    if (entries[index].id === entryId) {
      // 从末尾数到第 50 个 Turn 边界时，边界本身仍在热区，它前面的条目已经在热区外。
      return seenFromEnd >= FOLD_HOT_TURN_LIMIT;
    }
  }
  return false;
}

export function isCollapsibleTimelineItem(item: AgentTimelineItem): boolean {
  return item.type === "tool_call";
}

export function foldEntryToPlaceholder(
  entry: MessageStreamEntry,
): MessageStreamEntry {
  if (entry.item.type !== "tool_call") {
    return entry;
  }
  const detail = stripToolCallBody(entry.item.detail);
  if (detail === entry.item.detail) {
    return entry;
  }
  return {
    ...entry,
    item: { ...entry.item, detail },
  };
}

/** 占位只留名称和状态能用到的字段，正文清空。 */
export function stripToolCallBody(detail: ToolCallDetail): ToolCallDetail {
  switch (detail.type) {
    case "shell":
      if (detail.output == null) {
        return detail;
      }
      return {
        type: "shell",
        command: detail.command,
        exitCode: detail.exitCode,
      };
    case "read":
      if (detail.content == null) {
        return detail;
      }
      return { type: "read", path: detail.path };
    case "edit":
      if (detail.diff == null) {
        return detail;
      }
      return { type: "edit", path: detail.path };
    case "write":
      if (detail.content == null) {
        return detail;
      }
      return { type: "write", path: detail.path };
    case "search":
      if (detail.matches.length === 0) {
        return detail;
      }
      return {
        type: "search",
        query: detail.query,
        mode: detail.mode,
        matches: [],
      };
    case "plan":
      if (detail.text.length === 0) {
        return detail;
      }
      return { type: "plan", text: "" };
    case "unknown":
      if (detail.rawOutput == null) {
        return detail;
      }
      return { type: "unknown", rawInput: detail.rawInput };
    default:
      return detail;
  }
}
