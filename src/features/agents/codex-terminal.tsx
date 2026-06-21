import {
  readAgentSessionTerminal,
  restoreAgentSessionTerminal,
  resizeAgentSessionTerminal,
  writeAgentSessionTerminal,
} from "./agent-session-commands";
import {
  type AgentSessionTerminalOutputEvent,
  subscribeAgentSessionTerminalOutput,
} from "./agent-terminal-events";
import { TerminalSurface } from "../terminals/terminal-surface";

interface CodexTerminalProps {
  projectId: number;
  sessionId: number;
}

export function CodexTerminal({ projectId, sessionId }: CodexTerminalProps) {
  return (
    <TerminalSurface
      ariaLabel="Codex Session terminal"
      transport={{
        readSnapshot: (maxBytes) =>
          readAgentSessionTerminal({ projectId, sessionId, maxBytes }),
        resize: (rows, cols) =>
          resizeAgentSessionTerminal({ projectId, sessionId, rows, cols }),
        restore: () => restoreAgentSessionTerminal({ projectId, sessionId }),
        subscribeOutput: (handler) =>
          subscribeAgentSessionTerminalOutput(
            (event: AgentSessionTerminalOutputEvent) => {
              if (
                event.projectId !== projectId ||
                event.sessionId !== sessionId
              ) {
                return;
              }

              handler({
                sequence: event.sequence,
                data: event.data,
              });
            },
          ),
        write: (data) =>
          writeAgentSessionTerminal({ projectId, sessionId, data }),
      }}
      transportKey={`agent:${projectId}:${sessionId}`}
    />
  );
}
