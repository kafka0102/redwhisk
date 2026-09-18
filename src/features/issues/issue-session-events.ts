import type { IssueSessionStartProgressEvent } from "./issue-commands";

export const ISSUE_SESSION_START_PROGRESS_EVENT =
  "issue-session-start-progress";

export function isIssueSessionStartProgressEvent(
  value: unknown,
): value is IssueSessionStartProgressEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.projectId === "number" &&
    typeof record.issueId === "number" &&
    (record.phase === "creating_worktree" ||
      record.phase === "running_setup_command" ||
      record.phase === "starting_session")
  );
}
