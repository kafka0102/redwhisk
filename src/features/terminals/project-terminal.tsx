import { subscribeAgentSessionTerminalOutput } from "../agents/agent-terminal-events";
import { TerminalSurface } from "./terminal-surface";
import { ProjectTerminalStatusBar } from "./project-terminal-status-bar";
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
    <div className="project-terminal-shell">
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
            }),
          write: (data) => writeProjectTerminal({ projectId, sessionId, data }),
        }}
        transportKey={`project:${projectId}:${sessionId}`}
      />
      <ProjectTerminalStatusBar projectId={projectId} sessionId={sessionId} />
    </div>
  );
}
