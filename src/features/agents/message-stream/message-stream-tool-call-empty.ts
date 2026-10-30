import type { AgentTimelineItem } from "../agent-stream-types";

/** 工具调用是否没有任何可展示的命令、路径、查询或正文。 */
export function isEmptyToolCall(
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
