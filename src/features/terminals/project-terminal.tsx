import { subscribeAgentSessionTerminalOutput } from "../agents/agent-terminal-events";
import { TerminalSurface } from "./terminal-surface";
import {
  readProjectTerminal,
  resizeProjectTerminal,
  restoreProjectTerminal,
  writeProjectTerminal,
} from "./project-terminal-commands";

interface ProjectTerminalProps {
  projectId: number;
  sessionId: number;
}

export function ProjectTerminal({
  projectId,
  sessionId,
}: ProjectTerminalProps) {
  return (
    <TerminalSurface
      ariaLabel="Project terminal"
      transport={{
        readSnapshot: (maxBytes) =>
          readProjectTerminal({ projectId, sessionId, maxBytes }),
        resize: (rows, cols) =>
          resizeProjectTerminal({ projectId, sessionId, rows, cols }),
        restore: () => restoreProjectTerminal({ projectId, sessionId }),
        subscribeOutput: (handler) =>
          subscribeAgentSessionTerminalOutput((event) => {
            if (event.projectId !== projectId || event.sessionId !== sessionId) {
              return;
            }

            handler({
              sequence: event.sequence,
              data: event.data,
            });
          }),
        write: (data) => writeProjectTerminal({ projectId, sessionId, data }),
      }}
      transportKey={`project:${projectId}:${sessionId}`}
    />
  );
}
