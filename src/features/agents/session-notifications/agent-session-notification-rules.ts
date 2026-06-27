import type { AgentStreamEventEnvelope } from "../agent-stream-types";

export type AgentSessionNotificationLevel = "normal" | "urgent";

export interface AgentSessionNotificationCopy {
  needsInputTitle: (projectName: string) => string;
  permissionFallbackBody: string;
  sessionCompletedTitle: (projectName: string) => string;
  sessionCompletionFallbackSummary: string;
  sessionFailedTitle: (projectName: string) => string;
  sessionRecentMessagesLabel: string;
  sessionStatusLine: (title: string, status: string) => string;
  sessionSummaryLabel: string;
  sessionUpdatedTitle: (projectName: string) => string;
  turnCompletedBody: (sessionId: number) => string;
  turnFailedFallbackBody: string;
}

export interface AgentSessionNotificationIntent {
  body: string;
  durationMs?: number;
  key: string;
  level: AgentSessionNotificationLevel;
  title: string;
}

interface AgentSessionNotificationContext {
  copy: AgentSessionNotificationCopy;
  projectName: string;
}

export function createAgentSessionNotificationIntent(
  envelope: AgentStreamEventEnvelope,
  context: AgentSessionNotificationContext,
): AgentSessionNotificationIntent | null {
  const key = `agent-session:${envelope.sessionId}:${envelope.epoch}:${envelope.seq}`;

  switch (envelope.event.type) {
    case "permission_requested":
      return {
        body:
          envelope.event.request.title?.trim() ||
          context.copy.permissionFallbackBody,
        key,
        level: "urgent",
        title: context.copy.needsInputTitle(context.projectName),
      };
    case "turn_completed":
      return {
        body: context.copy.turnCompletedBody(envelope.sessionId),
        key,
        level: "normal",
        title: context.copy.sessionUpdatedTitle(context.projectName),
      };
    case "turn_failed":
      return {
        body:
          envelope.event.error.trim() || context.copy.turnFailedFallbackBody,
        key,
        level: "urgent",
        title: context.copy.sessionFailedTitle(context.projectName),
      };
    default:
      return null;
  }
}
