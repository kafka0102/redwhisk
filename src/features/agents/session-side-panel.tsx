import { SessionChangesPanel } from "./session-changes-panel";
import { SessionFileTreePanel } from "./session-file-tree-panel";
import { SessionIssuePanel } from "./session-issue-panel";
import type { LinkedSessionIssue } from "./agents-session-pane";
import type { AgentSessionListItem } from "./agent-session-commands";
import { useI18n } from "../../shared/i18n/i18n";
import type {
  WorkspaceCommitChangedFile,
  WorkspaceCommitRecord,
  WorkspaceChangedFile,
  WorkspaceFileTreeNode,
} from "./session-workspace-commands";
import type { SessionSidePanelTab } from "./session-workspace-types";

interface SessionSidePanelProps {
  activeTab: SessionSidePanelTab;
  changes: WorkspaceChangedFile[];
  changesErrorMessage: string | null;
  commitHistory: WorkspaceCommitRecord[];
  isCommitFromWorktree: boolean;
  commitHistoryErrorMessage: string | null;
  fileTree: WorkspaceFileTreeNode[];
  fileTreeErrorMessage: string | null;
  isChangesLoading: boolean;
  isCommitHistoryLoading: boolean;
  isFileTreeLoading: boolean;
  linkedIssue: LinkedSessionIssue | null;
  session: AgentSessionListItem | null;
  onActiveTabChange: (tab: SessionSidePanelTab) => void;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onOpenCommittedChangedFile: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
  onOpenIssue: (issueId: number) => void;
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
  onRefreshCommitHistory: () => void;
  onRefreshChanges: () => void;
  projectId: number;
  workspacePath?: string | null;
}

export function SessionSidePanel({
  activeTab,
  changes,
  changesErrorMessage,
  commitHistory,
  isCommitFromWorktree,
  commitHistoryErrorMessage,
  fileTree,
  fileTreeErrorMessage,
  isChangesLoading,
  isCommitHistoryLoading,
  isFileTreeLoading,
  linkedIssue,
  session,
  onActiveTabChange,
  onOpenChangedFile,
  onOpenCommittedChangedFile,
  onOpenIssue,
  onOpenFile,
  onRefreshCommitHistory,
  onRefreshChanges,
  projectId,
  workspacePath,
}: SessionSidePanelProps) {
  const { messages } = useI18n();
  return (
    <aside
      className="session-side-panel"
      aria-label={messages.agentsFeature.sessionSidePanel}
    >
      <div className="session-side-panel__tabs" role="tablist">
        {linkedIssue ? (
          <button
            aria-selected={activeTab === "issue"}
            className="session-side-panel__tab"
            role="tab"
            type="button"
            onClick={() => onActiveTabChange("issue")}
          >
            {messages.agentsFeature.issueTab}
          </button>
        ) : null}
        <button
          aria-selected={activeTab === "changes"}
          className="session-side-panel__tab"
          role="tab"
          type="button"
          onClick={() => onActiveTabChange("changes")}
        >
          {messages.agentsFeature.changes}
        </button>
        <button
          aria-selected={activeTab === "files"}
          className="session-side-panel__tab"
          role="tab"
          type="button"
          onClick={() => onActiveTabChange("files")}
        >
          {messages.agentsFeature.files}
        </button>
      </div>
      <div className="session-side-panel__content" role="tabpanel">
        {activeTab === "issue" && linkedIssue ? (
          <SessionIssuePanel
            issueId={linkedIssue.issueId}
            issueTitle={linkedIssue.issueTitle}
            projectId={projectId}
            session={session}
            onOpenIssue={onOpenIssue}
          />
        ) : activeTab === "changes" || activeTab === "issue" ? (
          <SessionChangesPanel
            changes={changes}
            commitHistory={commitHistory}
            isWorktree={isCommitFromWorktree}
            commitHistoryErrorMessage={commitHistoryErrorMessage}
            errorMessage={changesErrorMessage}
            isCommitHistoryLoading={isCommitHistoryLoading}
            isLoading={isChangesLoading}
            onOpenChangedFile={onOpenChangedFile}
            onOpenCommittedChangedFile={onOpenCommittedChangedFile}
            onRefreshCommitHistory={onRefreshCommitHistory}
            onRefreshChanges={onRefreshChanges}
          />
        ) : (
          <SessionFileTreePanel
            errorMessage={fileTreeErrorMessage}
            fileTree={fileTree}
            isLoading={isFileTreeLoading}
            onOpenFile={onOpenFile}
            workspacePath={workspacePath}
          />
        )}
      </div>
    </aside>
  );
}
