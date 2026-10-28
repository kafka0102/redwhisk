// 父会话超过 3 分钟没有自己的新输出时，把「正在思考…」换成停滞提示。
// 子智能体的正文和工具不算父会话还活着，也不在这里中断轮次。

import { useEffect, useState } from "react";

import type { AgentTimelineItem, ToolCallDetail } from "../agent-stream-types";
import type { MessageStreamEntry } from "./message-stream-types";

export const PARENT_OUTPUT_STALL_MS = 3 * 60 * 1000;

export function parentActivityKey(
  entries: readonly MessageStreamEntry[],
): string {
  let userMark = "";
  let outputMark = "";
  for (const entry of entries) {
    if (entry.item.type === "user_message") {
      userMark = entry.id;
      outputMark = "";
      continue;
    }
    const mark = parentOutputMark(entry);
    if (mark.length > 0) {
      outputMark = mark;
    }
  }
  return `${userMark}|${outputMark}`;
}

export function useParentOutputStalled(
  entries: readonly MessageStreamEntry[],
  isTurnActive: boolean,
): boolean {
  const activityKey = isTurnActive ? parentActivityKey(entries) : null;
  const [trackedKey, setTrackedKey] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);

  if (activityKey !== trackedKey) {
    setTrackedKey(activityKey);
    setStalled(false);
  }

  useEffect(() => {
    if (activityKey == null) {
      return;
    }
    const timer = window.setTimeout(() => {
      setStalled(true);
    }, PARENT_OUTPUT_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [activityKey]);

  return isTurnActive && stalled;
}

function parentOutputMark(entry: MessageStreamEntry): string {
  const item = entry.item;
  if (belongsToSubagent(item)) {
    return "";
  }
  switch (item.type) {
    case "assistant_message":
      return `a:${entry.id}:${item.text.length}`;
    case "reasoning":
      return `r:${entry.id}:${item.text.length}:${item.durationMs ?? ""}`;
    case "tool_call":
      return `t:${entry.id}:${item.status}:${toolDetailSize(item.detail)}`;
    default:
      return "";
  }
}

function belongsToSubagent(item: AgentTimelineItem): boolean {
  switch (item.type) {
    case "assistant_message":
    case "reasoning":
    case "tool_call":
    case "compaction":
      return (item.subagentId ?? "").length > 0;
    default:
      return false;
  }
}

function toolDetailSize(detail: ToolCallDetail): number {
  switch (detail.type) {
    case "shell":
      return detail.command.length + (detail.output?.length ?? 0);
    case "read":
      return detail.path.length + (detail.content?.length ?? 0);
    case "edit":
      return detail.path.length + (detail.diff?.length ?? 0);
    case "write":
      return detail.path.length + (detail.content?.length ?? 0);
    case "search":
      return detail.query.length + detail.matches.length;
    case "plan":
      return detail.text.length;
    case "collab_agent":
      return (detail.prompt?.length ?? 0) + detail.receiverThreadIds.length;
    case "sub_agent":
      return detail.childSessionId?.length ?? 0;
    case "unknown":
      return (detail.rawInput?.length ?? 0) + (detail.rawOutput?.length ?? 0);
  }
}
