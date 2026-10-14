// 输出来源视图：只决定消息流渲染哪些项，不改写已保存的 timeline。
// 选中档由调用方放在视图内存里，不进入可恢复的 MessageStreamState。

import type { AgentTimelineItem } from "../agent-stream-types";
import type {
  MessageStreamEntry,
  MessageStreamState,
  SubagentRosterEntry,
} from "./message-stream-types";

/** 全部、主智能体，或某一个子智能体 thread id。 */
export type OutputSourceSelection = "all" | "main" | (string & {});

export interface OutputSourceOption {
  value: OutputSourceSelection;
  kind: "all" | "main" | "subagent";
  ordinal?: number;
  status?: "running" | "ended";
  name?: string;
}

export interface OutputSourceLabels {
  all: string;
  main: string;
  subagentName: (ordinal: number) => string;
  running: string;
  ended: string;
}

export interface MessageStreamOutputView {
  entries: MessageStreamEntry[];
  pendingPermissions: MessageStreamState["pendingPermissions"];
  showSourceSelect: boolean;
  options: OutputSourceOption[];
}

export function outputSourceId(item: AgentTimelineItem): string | null {
  if (
    item.type !== "assistant_message" &&
    item.type !== "reasoning" &&
    item.type !== "tool_call" &&
    item.type !== "compaction"
  ) {
    return null;
  }
  const id = item.subagentId?.trim();
  return id ? id : null;
}

export function foldSubagentRoster(
  roster: SubagentRosterEntry[],
  item: AgentTimelineItem,
): SubagentRosterEntry[] {
  let next = roster;
  if (item.type === "tool_call" && item.detail.type === "collab_agent") {
    for (const id of item.detail.receiverThreadIds) {
      next = upsertSubagent(next, id, { prompt: item.detail.prompt });
    }
  }
  if (item.type === "subagent_roster") {
    return upsertSubagent(next, item.subagentId, {
      ended: item.status === "ended",
    });
  }
  const source = outputSourceId(item);
  if (source) {
    next = upsertSubagent(next, source, {});
  }
  return next;
}

export function formatOutputSourceOption(
  option: OutputSourceOption,
  labels: OutputSourceLabels,
): string {
  if (option.kind === "all") {
    return labels.all;
  }
  if (option.kind === "main") {
    return labels.main;
  }
  const name = option.name ?? labels.subagentName(option.ordinal ?? 1);
  const status = option.status === "ended" ? labels.ended : labels.running;
  return `${name} · ${status}`;
}

export function projectMessageStream(
  state: MessageStreamState,
  selection: OutputSourceSelection,
  turnRunning = state.turnStatus === "running",
): MessageStreamOutputView {
  const options = outputSourceOptions(state.subagents ?? [], turnRunning);
  const entries = state.entries.filter(
    (entry) =>
      entry.kind !== "turn_boundary" && entry.item.type !== "subagent_roster",
  );
  return {
    entries:
      selection === "all"
        ? entries
        : entries.filter((entry) => entryVisible(entry, selection)),
    pendingPermissions: state.pendingPermissions,
    showSourceSelect: options.length > 0,
    options,
  };
}

function outputSourceOptions(
  roster: readonly SubagentRosterEntry[],
  turnRunning: boolean,
): OutputSourceOption[] {
  if (roster.length === 0) {
    return [];
  }
  return [
    { value: "all", kind: "all" },
    { value: "main", kind: "main" },
    ...roster.map((entry, index) => {
      const status: "running" | "ended" =
        turnRunning && !entry.ended ? "running" : "ended";
      return {
        value: entry.id,
        kind: "subagent" as const,
        ordinal: index + 1,
        status,
        name: subagentOptionName(entry, index, roster),
      };
    }),
  ];
}

function subagentOptionName(
  entry: SubagentRosterEntry,
  index: number,
  roster: readonly SubagentRosterEntry[],
): string | undefined {
  const prompt = entry.prompt?.trim() ?? "";
  if (!prompt) {
    return undefined;
  }
  const prior = roster
    .slice(0, index)
    .filter((other) => (other.prompt?.trim() ?? "") === prompt).length;
  return prior === 0 ? prompt : `${prompt} ${prior + 1}`;
}

function upsertSubagent(
  roster: readonly SubagentRosterEntry[],
  id: string,
  patch: { prompt?: string; ended?: boolean },
): SubagentRosterEntry[] {
  const trimmed = id.trim();
  if (!trimmed) {
    return [...roster];
  }
  const prompt = patch.prompt?.trim() ? patch.prompt.trim() : null;
  const index = roster.findIndex((entry) => entry.id === trimmed);
  if (index < 0) {
    return [...roster, { id: trimmed, prompt, ended: patch.ended ?? false }];
  }
  const current = roster[index];
  const nextPrompt = current.prompt ?? prompt;
  const nextEnded = patch.ended ?? current.ended;
  if (nextPrompt === current.prompt && nextEnded === current.ended) {
    return [...roster];
  }
  const copy = [...roster];
  copy[index] = { id: current.id, prompt: nextPrompt, ended: nextEnded };
  return copy;
}

function entryVisible(
  entry: MessageStreamEntry,
  selection: OutputSourceSelection,
): boolean {
  const source = outputSourceId(entry.item);
  if (selection === "main") {
    return source === null;
  }
  return source === selection;
}
