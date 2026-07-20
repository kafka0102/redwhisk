import { TerminalSurface } from "../../terminals/terminal-surface";
import {
  readAgentSessionTerminal,
  resizeAgentSessionTerminal,
  restoreAgentSessionTerminal,
  subscribeAgentSessionTerminalOutput as subscribeAgentSessionTerminalOutputCommand,
  unsubscribeAgentSessionTerminalOutput,
  writeAgentSessionTerminal,
} from "../agent-session-commands";
import { subscribeAgentSessionTerminalOutput } from "../agent-terminal-events";
import { useI18n } from "../../../shared/i18n/i18n";

interface AgentTuiSessionViewProps {
  projectId: number;
  sessionId: number;
}

/**
 * Agent TUI 会话主区：复用 TerminalSurface + agent session 终端 transport。
 *
 * displayMode=tui 时由 AgentsSessionPane 挂载；不接入结构化消息流 / composer /
 * 权限卡主路径。主题由 TerminalSurface 经 getTerminalTheme 响应 light/dark。
 */
export function AgentTuiSessionView({
  projectId,
  sessionId,
}: AgentTuiSessionViewProps) {
  const { messages } = useI18n();

  return (
    <div className="agent-tui-session-shell">
      <TerminalSurface
        ariaLabel={messages.agentsFeature.tuiSessionView}
        transport={{
          readSnapshot: (maxBytes) =>
            readAgentSessionTerminal({ projectId, sessionId, maxBytes }),
          resize: (rows, cols) =>
            resizeAgentSessionTerminal({ projectId, sessionId, rows, cols }),
          restore: () => restoreAgentSessionTerminal({ projectId, sessionId }),
          setLiveSubscription: (active) =>
            active
              ? subscribeAgentSessionTerminalOutputCommand({
                  projectId,
                  sessionId,
                })
              : unsubscribeAgentSessionTerminalOutput({
                  projectId,
                  sessionId,
                }),
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
          write: (data) =>
            writeAgentSessionTerminal({ projectId, sessionId, data }),
        }}
        transportKey={`agent-tui:${projectId}:${sessionId}`}
      />
    </div>
  );
}
