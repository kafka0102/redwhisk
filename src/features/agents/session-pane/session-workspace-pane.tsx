import { memo, useState, type ReactNode } from "react";

import { AgentSessionView } from "./agent-session-view";
import { AgentTuiSessionView } from "./agent-tui-session-view";
import { CompletedReviewTerminal } from "./completed-review-terminal";
import { CompletedSessionReview } from "./completed-session-review";
import { SessionWorkspaceTabs } from "../session-workspace/session-workspace-tabs";
import type { AgentSessionListItem } from "../agent-session-commands";
import type { SessionWorkspaceToolTab } from "../session-workspace/session-workspace-tabs";
import type {
  SessionWorkspaceChangeTab,
  SessionWorkspaceFileTab,
  SessionWorkspaceTabKind,
} from "../session-workspace/session-workspace-types";

export interface SessionWorkspaceEntry {
  sessionId: number;
  agentType: AgentSessionListItem["agentType"];
  sessionStatus: AgentSessionListItem["status"];
  issueStatus: NonNullable<AgentSessionListItem["issueStatus"]> | null;
  isTurnRunning: boolean;
  displayMode: AgentSessionListItem["displayMode"];
  /** 会话日志路径；完成后指向归档。 */
  logPath: string;
  /** 完成后保留的运行日志。只读回放用它。 */
  runtimeLogPath: string | null;
  activeWorkspaceTab: SessionWorkspaceTabKind;
  changeTab: SessionWorkspaceChangeTab | null;
  fileTab: SessionWorkspaceFileTab | null;
  toolTabs: SessionWorkspaceToolTab[];
  /** 本 session 工作区根绝对路径；消息流把绝对路径 / `~/` 收成相对路径时用。 */
  workspacePath: string | null;
}

interface SessionWorkspacePaneProps {
  isCurrent: boolean;
  onCloseWorkspaceTab: (
    sessionId: number,
    tab: Exclude<SessionWorkspaceTabKind, "session">,
  ) => void;
  onCreateBrowserTab: (sessionId: number) => void;
  onCreateTerminalTab: (sessionId: number) => void;
  /** 打开指定 session 工作区内的文件（`workspaceCache.openFilePathForSession`）。 */
  onOpenFilePath: (sessionId: number, filePath: string) => void;
  onSelectWorkspaceTab: (
    sessionId: number,
    tab: SessionWorkspaceTabKind,
  ) => void;
  onAcknowledgeSessionAttention: (sessionId: number) => void;
  projectId: number;
  workspace: SessionWorkspaceEntry;
}

/**
 * 单个 session 的 workspace 面板。Issue 完成后默认归档，确认后才挂只读 Session。
 */
export const SessionWorkspacePane = memo(function SessionWorkspacePane({
  isCurrent,
  onCloseWorkspaceTab,
  onCreateBrowserTab,
  onCreateTerminalTab,
  onOpenFilePath,
  onSelectWorkspaceTab,
  onAcknowledgeSessionAttention,
  projectId,
  workspace,
}: SessionWorkspacePaneProps) {
  const completed = workspace.issueStatus === "completed";
  const [completedReview, setCompletedReview] = useState<"archive" | "session">(
    "archive",
  );
  const [trackedSessionId, setTrackedSessionId] = useState(workspace.sessionId);
  if (trackedSessionId !== workspace.sessionId) {
    setTrackedSessionId(workspace.sessionId);
    setCompletedReview("archive");
  }

  const sessionContent = completed ? (
    <CompletedSessionReview
      projectId={projectId}
      readOnlySession={
        completedReview === "session" ? (
          <CompletedReviewTerminal
            projectId={projectId}
            sessionId={workspace.sessionId}
          />
        ) : null
      }
      sessionId={workspace.sessionId}
      showingSession={completedReview === "session"}
    />
  ) : (
    sessionView(projectId, isCurrent, workspace, onOpenFilePath)
  );

  return (
    <div
      className="agents-terminal-host session-workspace-host"
      hidden={!isCurrent}
      onMouseDown={() => onAcknowledgeSessionAttention(workspace.sessionId)}
    >
      <SessionWorkspaceTabs
        activeTab={workspace.activeWorkspaceTab}
        changeTab={workspace.changeTab}
        completedReview={completed ? completedReview : null}
        fileTab={workspace.fileTab}
        sessionAgentType={workspace.agentType}
        sessionDisplayMode={workspace.displayMode}
        sessionIssueStatus={workspace.issueStatus}
        sessionStatus={workspace.sessionStatus}
        sessionContent={sessionContent}
        onCloseTab={(tab) => onCloseWorkspaceTab(workspace.sessionId, tab)}
        onCompletedReviewArchive={() => setCompletedReview("archive")}
        onCompletedReviewSession={() => setCompletedReview("session")}
        onCreateBrowserTab={() => onCreateBrowserTab(workspace.sessionId)}
        onCreateTerminalTab={() => onCreateTerminalTab(workspace.sessionId)}
        onSelectTab={(tab) => onSelectWorkspaceTab(workspace.sessionId, tab)}
        projectId={projectId}
        sessionId={workspace.sessionId}
        toolTabs={workspace.toolTabs}
      />
    </div>
  );
});

function sessionView(
  projectId: number,
  isCurrent: boolean,
  workspace: SessionWorkspaceEntry,
  onOpenFilePath: (sessionId: number, filePath: string) => void,
): ReactNode {
  if (workspace.displayMode === "tui") {
    return (
      <AgentTuiSessionView
        isActive={isCurrent}
        issueStatus={workspace.issueStatus}
        logPath={workspace.logPath}
        projectId={projectId}
        sessionId={workspace.sessionId}
        sessionStatus={workspace.sessionStatus}
      />
    );
  }
  return (
    <AgentSessionView
      agentType={workspace.agentType}
      isActive={isCurrent}
      issueStatus={workspace.issueStatus}
      isTurnRunning={workspace.isTurnRunning}
      onOpenFilePath={onOpenFilePath}
      projectId={projectId}
      sessionId={workspace.sessionId}
      sessionStatus={workspace.sessionStatus}
      workspacePath={workspace.workspacePath}
    />
  );
}
