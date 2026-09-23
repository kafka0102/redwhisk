import { useRef } from "react";

import { subscribeAgentSessionTerminalOutput } from "../agents/agent-terminal-events";
import {
  TerminalSurface,
  type TerminalSurfaceHandle,
} from "./terminal-surface";
import { ProjectTerminalStatusBar } from "./project-terminal-status-bar";
import {
  readProjectTerminal,
  resizeProjectTerminal,
  restoreProjectTerminal,
  subscribeProjectTerminalOutput,
  unsubscribeProjectTerminalOutput,
  writeProjectTerminal,
} from "./project-terminal-commands";

interface ProjectTerminalProps {
  projectId: number;
  sessionId: number;
  /** 该终端是否为当前展示的 pane；非当前 pane 隐藏挂载，不轮询 cwd。 */
  isActive?: boolean;
}

export function ProjectTerminal({
  projectId,
  sessionId,
  isActive = true,
}: ProjectTerminalProps) {
  const terminalSurfaceRef = useRef<TerminalSurfaceHandle | null>(null);

  return (
    <div className="project-terminal-shell">
      <TerminalSurface
        ref={terminalSurfaceRef}
        ariaLabel="Project terminal"
        transport={{
          readSnapshot: (maxBytes) =>
            readProjectTerminal({ projectId, sessionId, maxBytes }),
          resize: (rows, cols) =>
            resizeProjectTerminal({ projectId, sessionId, rows, cols }),
          restore: () => restoreProjectTerminal({ projectId, sessionId }),
          setLiveSubscription: (active) =>
            active
              ? subscribeProjectTerminalOutput({ projectId, sessionId })
              : unsubscribeProjectTerminalOutput({ projectId, sessionId }),
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
      <ProjectTerminalStatusBar
        isActive={isActive}
        projectId={projectId}
        sessionId={sessionId}
        focusTerminal={() => {
          terminalSurfaceRef.current?.focus();
        }}
      />
    </div>
  );
}
