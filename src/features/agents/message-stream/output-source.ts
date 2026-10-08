// 输出来源视图：只决定消息流渲染哪些项，不改写已保存的 timeline。
// 选中档由调用方放在视图内存里，不进入可恢复的 MessageStreamState。

import type { AgentTimelineItem } from "../agent-stream-types";
import type {
  MessageStreamEntry,
  MessageStreamState,
} from "./message-stream-types";

/** 全部、主智能体，或某一个子智能体 thread id。 */
export type OutputSourceSelection = "all" | "main" | (string & {});

export interface OutputSourceOption {
  value: OutputSourceSelection;
  kind: "all" | "main" | "subagent";
  ordinal?: number;
  status?: "running";
}

export interface OutputSourceLabels {
  all: string;
  main: string;
  subagentName: (ordinal: number) => string;
  running: string;
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
  const name = labels.subagentName(option.ordinal ?? 1);
  return `${name} · ${labels.running}`;
}

export function projectMessageStream(
  state: MessageStreamState,
  selection: OutputSourceSelection,
): MessageStreamOutputView {
  const options = outputSourceOptions(state.entries);
  return {
    entries:
      selection === "all"
        ? state.entries
        : state.entries.filter((entry) => entryVisible(entry, selection)),
    pendingPermissions: state.pendingPermissions,
    showSourceSelect: options.length > 0,
    options,
  };
}

function outputSourceOptions(
  entries: MessageStreamEntry[],
): OutputSourceOption[] {
  const roster: OutputSourceOption[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = outputSourceId(entry.item);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    roster.push({
      value: id,
      kind: "subagent",
      ordinal: roster.length + 1,
      status: "running",
    });
  }
  if (roster.length === 0) {
    return [];
  }
  return [
    { value: "all", kind: "all" },
    { value: "main", kind: "main" },
    ...roster,
  ];
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
