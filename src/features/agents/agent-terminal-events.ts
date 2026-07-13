import { listen } from "@tauri-apps/api/event";

export const AGENT_SESSION_TERMINAL_OUTPUT_EVENT =
  "agent-session-terminal-output";

export interface AgentSessionTerminalOutputEvent {
  projectId: number;
  sessionId: number;
  sequence: number;
  /** base64-encoded terminal bytes */
  data: string;
}

export function subscribeAgentSessionTerminalOutput(
  handler: (event: AgentSessionTerminalOutputEvent) => void,
): Promise<() => void> {
  return listen<AgentSessionTerminalOutputEvent>(
    AGENT_SESSION_TERMINAL_OUTPUT_EVENT,
    (event) => {
      handler(event.payload);
    },
  );
}
