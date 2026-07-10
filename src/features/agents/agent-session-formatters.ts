import type { AgentSessionListItem } from "./agent-session-commands";
import type { I18nMessages } from "../../shared/i18n/messages";

export type SessionIssueGroup = "inProcess" | "review" | "done";

export function formatSessionTitle(session: AgentSessionListItem): string {
  if (session.issueTitle) {
    return session.issueTitle;
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
    return messages.agentsFeature.sessionCrashed;
  }

  if (session.status === "stopped") {
    return messages.agentsFeature.sessionStopped;
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

  return messages.agentsFeature.sessionClosed;
}

export function shouldShowExplicitSessionStatus(
  session: AgentSessionListItem,
): boolean {
  return session.status === "crashed" || session.status === "stopped";
}

// 将毫秒处理时长格式化为秒级本地化字符串。不足 1 秒返回 "-"。
export function formatDuration(ms: number, locale: string): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds <= 0) {
    return "-";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const isZh = locale === "zh";
  if (hours > 0) {
    return isZh
      ? `${hours}小时${minutes}分${seconds}秒`
      : `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return isZh ? `${minutes}分${seconds}秒` : `${minutes}m ${seconds}s`;
  }
  return isZh ? `${seconds}秒` : `${seconds}s`;
}

// 详情区总耗时展示：crashed/stopped 或无有效处理时长时返回 "-"。
export function formatProcessingDuration(
  session: AgentSessionListItem | null,
  locale: string,
): string {
  if (
    !session ||
    session.processingMs == null ||
    session.processingMs <= 0 ||
    session.status === "crashed" ||
    session.status === "stopped"
  ) {
    return "-";
  }
  return formatDuration(session.processingMs, locale);
}
