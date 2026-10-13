import type { IssueRecord } from "../issue-commands";

export function canReopenCompletedIssue(
  issue: Pick<
    IssueRecord,
    | "status"
    | "linkedSessionId"
    | "linkedSessionDisplayMode"
    | "linkedSessionProviderSessionId"
    | "linkedSessionAgentType"
  >,
): boolean {
  if (issue.status !== "completed" || issue.linkedSessionId == null) {
    return false;
  }
  const providerSessionId = issue.linkedSessionProviderSessionId?.trim() ?? "";
  if (providerSessionId.length === 0) {
    return false;
  }
  if (issue.linkedSessionDisplayMode === "json") {
    return true;
  }
  // TUI 续接以 Agent 类型为准，与后端 supports_tui_resume 一致：DeepSeek 不支持。
  if (issue.linkedSessionDisplayMode === "tui") {
    return issue.linkedSessionAgentType !== "deepseek";
  }
  return false;
}
