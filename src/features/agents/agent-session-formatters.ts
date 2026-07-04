import type { AgentSessionListItem } from "./agent-session-commands";
import type { I18nMessages } from "../../shared/i18n/messages";

export type SessionIssueGroup = "inProcess" | "review" | "done";

export function formatSessionTitle(session: AgentSessionListItem): string {
  if (session.issueId != null && session.issueTitle) {
    return `#${session.issueId} ${session.issueTitle}`;
  }
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
  messages: I18nMessages,
  session: AgentSessionListItem,
): string {
  if (session.status === "crashed") {
    return "crashed";
  }

  if (session.status === "stopped") {
    return "stopped";
  }

  if (session.issueStatus === "completed") {
    return messages.agentsFeature.done;
  }

  if (session.issueStatus === "review") {
    return messages.agentsFeature.review;
  }

  if (session.issueStatus === "running" && session.isTurnRunning === false) {
    return messages.agentsFeature.inProgress;
  }

  if (session.attention === "requested") {
    return messages.agentsFeature.attentionOutputComplete;
  }

  if (session.status === "running") {
    return messages.agentsFeature.running;
  }

  return "closed";
}

export function shouldShowExplicitSessionStatus(
  session: AgentSessionListItem,
): boolean {
  return session.status === "crashed" || session.status === "stopped";
}
