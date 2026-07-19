export const AGENT_SESSION_LIST_CHANGED_EVENT = "agent-session-list-changed";

export interface AgentSessionListChangedEvent {
  projectId: number;
  sessionId: number | null;
  reason: string;
}
