import type { AgentSessionListItem } from "./agent-session-commands";

export type SessionIssueGroup = "inProcess" | "review" | "done";

export function formatSessionTitle(session: AgentSessionListItem): string {
  return session.issueTitle ?? session.title ?? `Session #${session.sessionId}`;
}

export function getSessionIssueGroup(
  session: AgentSessionListItem,
): SessionIssueGroup | null {
  switch (session.issueStatus) {
    case "running":
      return "inProcess";
    case "review":
      return "review";
    case "completed":
      return "done";
    case "backlog":
      return null;
    default:
      break;
  }

  if (session.issueId != null) {
    return session.status === "running" ? "inProcess" : "done";
  }

  return session.status === "running" ? "inProcess" : "done";
}

export function formatSessionStatusLabel(
  session: AgentSessionListItem,
): string {
  if (session.status === "crashed") {
    return "crashed";
  }

  if (session.status === "stopped") {
    return "stopped";
  }

  if (session.issueStatus === "completed") {
    return "Done";
  }

  if (session.issueStatus === "review") {
    return "Review";
  }

  if (session.issueStatus === "running" && session.isTurnRunning === false) {
    return "In Progress";
  }

  if (session.attention === "requested") {
    return "输出完成";
  }

  if (session.status === "running") {
    return "运行中";
  }

  return "closed";
}

export function shouldShowExplicitSessionStatus(
  session: AgentSessionListItem,
): boolean {
  return session.status === "crashed" || session.status === "stopped";
}
