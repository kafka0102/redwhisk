import type { AgentSessionListItem } from "../agent-session-commands";
import type { AgentTimelineItem } from "../agent-stream-types";
import {
  formatSessionStatusLabel,
  formatSessionTitle,
} from "../agent-session-formatters";
import type {
  AgentSessionNotificationCopy,
  AgentSessionNotificationIntent,
} from "./agent-session-notification-rules";
import type { I18nMessages, Locale } from "../../../shared/i18n/messages";

export const DEFAULT_SESSION_MONITOR_RECENT_LIMIT = 3;
export const DEFAULT_SESSION_STATUS_NOTIFICATION_DURATION_MS = 300_000;
export const DEFAULT_SESSION_STATUS_RECENT_MESSAGE_LIMIT = 3;

export function selectSessionMonitorItems(
  sessions: AgentSessionListItem[],
  recentLimit = DEFAULT_SESSION_MONITOR_RECENT_LIMIT,
): AgentSessionListItem[] {
  const sortedSessions = [...sessions].sort(
    (left, right) => right.lastActiveAt - left.lastActiveAt,
  );
  const runningSessions = sortedSessions.filter(
    (session) => session.status === "running",
  );

  return runningSessions.length > 0
    ? runningSessions
    : sortedSessions.slice(0, recentLimit);
}

export function formatSessionMonitorUpdatedAt(
  locale: Locale,
  timestamp: number,
): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(timestamp));
}

export function formatSessionMonitorStatusLabel(
  messages: I18nMessages,
  session: AgentSessionListItem,
): string {
  switch (session.status) {
    case "closed":
      return messages.agentsFeature.sessionClosed;
    case "crashed":
      return messages.agentsFeature.sessionCrashed;
    case "stopped":
      return messages.agentsFeature.sessionStopped;
    case "running":
      return formatSessionStatusLabel(messages, session);
    default:
      return formatSessionStatusLabel(messages, session);
  }
}

export function createAgentSessionStatusNotificationIntent(
  session: AgentSessionListItem,
  timelineItems: AgentTimelineItem[],
  context: {
    copy: AgentSessionNotificationCopy;
    projectName: string;
    recentMessageLimit?: number;
  },
): AgentSessionNotificationIntent | null {
  if (session.status !== "closed" && session.status !== "crashed") {
    return null;
  }

  const statusLabel =
    session.status === "closed" ? "completed" : session.status;
  const summary = buildTimelineSummary(timelineItems, context.copy);
  const recentMessages = buildRecentMessageLines(
    timelineItems,
    context.recentMessageLimit ?? DEFAULT_SESSION_STATUS_RECENT_MESSAGE_LIMIT,
  );
  const bodyParts = [
    context.copy.sessionStatusLine(formatSessionTitle(session), statusLabel),
    "",
    context.copy.sessionSummaryLabel,
    summary,
  ];

  if (recentMessages.length > 0) {
    bodyParts.push(
      "",
      context.copy.sessionRecentMessagesLabel,
      ...recentMessages,
    );
  }

  return {
    body: bodyParts.join("\n"),
    durationMs: DEFAULT_SESSION_STATUS_NOTIFICATION_DURATION_MS,
    key: `agent-session-status:${session.sessionId}:${session.status}`,
    level: session.status === "crashed" ? "urgent" : "normal",
    title:
      session.status === "crashed"
        ? context.copy.sessionFailedTitle(context.projectName)
        : context.copy.sessionCompletedTitle(context.projectName),
  };
}

function buildTimelineSummary(
  timelineItems: AgentTimelineItem[],
  copy: AgentSessionNotificationCopy,
): string {
  for (let index = timelineItems.length - 1; index >= 0; index -= 1) {
    const item = timelineItems[index];

    if (item.type === "assistant_message") {
      return compactText(item.text);
    }

    if (item.type === "error") {
      return compactText(item.message);
    }

    if (item.type === "todo") {
      const remainingItems = item.items
        .filter((todoItem) => !todoItem.completed)
        .map((todoItem) => todoItem.text);
      if (remainingItems.length > 0) {
        return remainingItems.join("; ");
      }
    }
  }

  return copy.sessionCompletionFallbackSummary;
}

function buildRecentMessageLines(
  timelineItems: AgentTimelineItem[],
  limit: number,
): string[] {
  return timelineItems
    .flatMap((item) => {
      if (item.type === "user_message") {
        return [`User: ${compactText(item.text)}`];
      }

      if (item.type === "assistant_message") {
        return [`Agent: ${compactText(item.text)}`];
      }

      if (item.type === "error") {
        return [`Error: ${compactText(item.message)}`];
      }

      return [];
    })
    .slice(-limit);
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
