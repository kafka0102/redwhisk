import { SessionChangesPanel } from "../session-workspace/session-changes-panel";
import { SessionFileTreePanel } from "../session-workspace/session-file-tree-panel";
import { SessionIssuePanel } from "./session-issue-panel";
import type { LinkedSessionIssue } from "../session-pane/agents-session-pane";
import type { AgentSessionListItem } from "../agent-session-commands";
import { useI18n } from "../../../shared/i18n/i18n";
import type {
  WorkspaceChangeKind,
  WorkspaceCommitChangedFile,
  WorkspaceCommitRecord,
  WorkspaceChangedFile,
  WorkspaceFileTreeNode,
} from "../session-workspace/session-workspace-commands";
import type { SessionSidePanelTab } from "../session-workspace/session-workspace-types";

interface SessionSidePanelProps {
  activeTab: SessionSidePanelTab;
  changes: WorkspaceChangedFile[];
  /** 文件树装饰：文件路径 → kind（徽标 + 文件名着色）。 */
  changedFileKinds?: ReadonlyMap<string, WorkspaceChangeKind>;
  /** 文件树装饰：目录路径 → 聚合 kind（仅目录名着色）。 */
  directoryKinds?: ReadonlyMap<string, WorkspaceChangeKind>;
  changesErrorMessage: string | null;
  commitHistory: WorkspaceCommitRecord[];
  isCommitFromWorktree: boolean;
  // worktree 场景下解析出的分叉基分支名；非 worktree / 主分支 / 解析失败时为 null。
  // 透传给 SessionChangesPanel 渲染首条黄色提交右侧的黄色 base Tag。
  baseBranch?: string | null;
  commitHistoryErrorMessage: string | null;
  fileTree: WorkspaceFileTreeNode[];
  fileTreeErrorMessage: string | null;
  isChangesLoading: boolean;
  isCommitHistoryLoading: boolean;
  isFileTreeLoading: boolean;
  isCommittedChangesExpanded: boolean;
  isUncommittedChangesExpanded: boolean;
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
  onToggleCommittedChangesExpanded: () => void;
  onToggleUncommittedChangesExpanded: () => void;
  hasMoreCommitHistory?: boolean;
  isLoadingMoreCommitHistory?: boolean;
  loadMoreCommitHistoryErrorMessage?: string | null;
  onLoadMoreCommitHistory?: () => void;
  projectId: number;
  workspacePath?: string | null;
}

export function SessionSidePanel({
  activeTab,
  changes,
  changedFileKinds,
  directoryKinds,
  changesErrorMessage,
  commitHistory,
  isCommitFromWorktree,
  baseBranch,
  commitHistoryErrorMessage,
  fileTree,
  fileTreeErrorMessage,
  isChangesLoading,
  isCommitHistoryLoading,
  isFileTreeLoading,
  isCommittedChangesExpanded,
  isUncommittedChangesExpanded,
  linkedIssue,
  session,
  onActiveTabChange,
  onOpenChangedFile,
  onOpenCommittedChangedFile,
  onOpenIssue,
  onOpenFile,
  onToggleCommittedChangesExpanded,
  onToggleUncommittedChangesExpanded,
  hasMoreCommitHistory,
  isLoadingMoreCommitHistory,
  loadMoreCommitHistoryErrorMessage,
  onLoadMoreCommitHistory,
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
            baseBranch={baseBranch}
            commitHistoryErrorMessage={commitHistoryErrorMessage}
            errorMessage={changesErrorMessage}
            isCommitHistoryLoading={isCommitHistoryLoading}
            isLoading={isChangesLoading}
            isUncommittedExpanded={isUncommittedChangesExpanded}
            isCommittedExpanded={isCommittedChangesExpanded}
            onToggleUncommittedExpanded={onToggleUncommittedChangesExpanded}
            onToggleCommittedExpanded={onToggleCommittedChangesExpanded}
            onOpenChangedFile={onOpenChangedFile}
            onOpenCommittedChangedFile={onOpenCommittedChangedFile}
            workspaceInput={{
              projectId,
              sessionId: session?.sessionId ?? null,
              workspacePath: workspacePath ?? null,
            }}
            hasMoreCommitHistory={hasMoreCommitHistory}
            isLoadingMoreCommitHistory={isLoadingMoreCommitHistory}
            loadMoreCommitHistoryErrorMessage={
              loadMoreCommitHistoryErrorMessage
            }
            onLoadMoreCommitHistory={onLoadMoreCommitHistory}
          />
        ) : (
          <SessionFileTreePanel
            changedFileKinds={changedFileKinds}
            directoryKinds={directoryKinds}
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
