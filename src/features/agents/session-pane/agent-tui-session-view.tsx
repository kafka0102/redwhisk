import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { TerminalSurface } from "../../terminals/terminal-surface";
import {
  readAgentSessionTerminal,
  resizeAgentSessionTerminal,
  restoreAgentSessionTerminal,
  subscribeAgentSessionTerminalOutput as subscribeAgentSessionTerminalOutputCommand,
  unsubscribeAgentSessionTerminalOutput,
  writeAgentSessionTerminal,
  type AgentSessionStatus,
  type IssueStatus,
} from "../agent-session-commands";
import { subscribeAgentSessionTerminalOutput } from "../agent-terminal-events";
import { useI18n } from "../../../shared/i18n/i18n";
import { AgentTuiArchiveMarkdownView } from "./agent-tui-archive-markdown-view";
import { isTuiArchiveLogPath } from "./agent-tui-archive-path";
import { useAgentTuiSessionResume } from "./use-agent-tui-session-resume";

interface AgentTuiSessionViewProps {
  projectId: number;
  sessionId: number;
  sessionStatus?: AgentSessionStatus;
  issueStatus?: IssueStatus | null;
  /** 本 session 是否为当前选中（实例池 hidden 时为 false，不自动 resume）。 */
  isActive?: boolean;
  /** 会话日志路径；Issue 完成归档路径走 Markdown 回看，不挂 xterm。 */
  logPath?: string | null;
}

/**
 * Agent TUI 会话主区：复用 TerminalSurface + agent session 终端 transport。
 *
 * displayMode=tui 时由 AgentsSessionPane 挂载；不接入结构化消息流 / composer /
 * 权限卡主路径。主题由 TerminalSurface 经 getTerminalTheme 响应 light/dark。
 *
 * inactive 且 supportsTuiResume 时自动 resume 一次：进行中显示 saved log +
 * 「正在续接」；成功后 remount surface 接 live；失败按 reason 白名单可重试。
 *
 * logPath 指向 session-logs/archive 时改为 AgentMarkdown 富文本回看（对齐 JSON）。
 */
export function AgentTuiSessionView({
  projectId,
  sessionId,
  sessionStatus,
  issueStatus = null,
  isActive = true,
  logPath = null,
}: AgentTuiSessionViewProps) {
  const { messages } = useI18n();
  const isArchiveReplay = isTuiArchiveLogPath(logPath);
  const { phase, errorMessage, canRetry, surfaceEpoch, retry } =
    useAgentTuiSessionResume({
      projectId,
      sessionId,
      sessionStatus,
      issueStatus,
      isActive,
      // 完成归档只读回看，禁止自动 resume。
      autoResumeEnabled: !isArchiveReplay,
    });

  const transport = useMemo(
    () => ({
      readSnapshot: (maxBytes: number) =>
        readAgentSessionTerminal({ projectId, sessionId, maxBytes }),
      resize: (rows: number, cols: number) =>
        resizeAgentSessionTerminal({ projectId, sessionId, rows, cols }),
      restore: () => restoreAgentSessionTerminal({ projectId, sessionId }),
      setLiveSubscription: (active: boolean) =>
        active
          ? subscribeAgentSessionTerminalOutputCommand({
              projectId,
              sessionId,
            })
          : unsubscribeAgentSessionTerminalOutput({
              projectId,
              sessionId,
            }),
      subscribeOutput: (
        handler: (event: { sequence: number; data: string }) => void,
      ) =>
        subscribeAgentSessionTerminalOutput((event) => {
          if (event.projectId !== projectId || event.sessionId !== sessionId) {
            return;
          }

          handler({
            sequence: event.sequence,
            data: event.data,
          });
        }),
      write: (data: string) =>
        writeAgentSessionTerminal({ projectId, sessionId, data }),
    }),
    [projectId, sessionId],
  );

  if (isArchiveReplay) {
    return (
      <div className="agent-tui-session-shell">
        <AgentTuiArchiveMarkdownView
          projectId={projectId}
          sessionId={sessionId}
        />
      </div>
    );
  }

  return (
    <div className="agent-tui-session-shell">
      {phase === "resuming" ? (
        <p className="agent-tui-session-shell__banner" role="status">
          {messages.agentsFeature.tuiSessionResuming}
        </p>
      ) : null}
      {phase === "failed" && errorMessage ? (
        <div className="agent-tui-session-shell__banner agent-tui-session-shell__banner--error">
          <p role="alert">{errorMessage}</p>
          {canRetry ? (
            <Button size="sm" type="button" variant="secondary" onClick={retry}>
              {messages.agentsFeature.tuiSessionResumeRetry}
            </Button>
          ) : null}
        </div>
      ) : null}
      <TerminalSurface
        ariaLabel={messages.agentsFeature.tuiSessionView}
        transport={transport}
        transportKey={`agent-tui:${projectId}:${sessionId}:${surfaceEpoch}`}
      />
    </div>
  );
}
