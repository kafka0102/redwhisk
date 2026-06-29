import { listen } from "@tauri-apps/api/event";

export const AGENT_SESSION_LIST_CHANGED_EVENT = "agent-session-list-changed";

export interface AgentSessionListChangedEvent {
  projectId: number;
  sessionId: number | null;
  reason: string;
}

export function subscribeAgentSessionListChanged(
  handler: (event: AgentSessionListChangedEvent) => void,
): Promise<() => void> {
  return listen<AgentSessionListChangedEvent>(
    AGENT_SESSION_LIST_CHANGED_EVENT,
    (event) => {
      handler(event.payload);
    },
  );
}
