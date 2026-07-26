import { WorkspaceChangesPanels } from "../../../shared/workspace/workspace-changes-panels";
import type {
  ProjectWorkspaceInput,
  WorkspaceChangedFile,
  WorkspaceCommitChangedFile,
  WorkspaceCommitRecord,
} from "./session-workspace-commands";

interface SessionChangesPanelProps {
  changes: WorkspaceChangedFile[];
  commitHistory: WorkspaceCommitRecord[];
  isWorktree: boolean;
  // worktree 场景下解析出的分叉基分支名；非 worktree / 主分支 / 解析失败时为 null。
  // 透传给共享变更面板渲染首条黄色提交右侧的黄色 base Tag。
  baseBranch?: string | null;
  commitHistoryErrorMessage: string | null;
  errorMessage: string | null;
  isCommitHistoryLoading: boolean;
  isLoading: boolean;
  isUncommittedExpanded: boolean;
  isCommittedExpanded: boolean;
  onToggleUncommittedExpanded: () => void;
  onToggleCommittedExpanded: () => void;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onOpenCommittedChangedFile: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
  /** 解析 github remote；缺省不显示「在 GitHub 上打开」。 */
  workspaceInput?: ProjectWorkspaceInput | null;
  hasMoreCommitHistory?: boolean;
  isLoadingMoreCommitHistory?: boolean;
  loadMoreCommitHistoryErrorMessage?: string | null;
  onLoadMoreCommitHistory?: () => void;
}

export function SessionChangesPanel({
  changes,
  commitHistory,
  isWorktree,
  baseBranch,
  commitHistoryErrorMessage,
  errorMessage,
  isCommitHistoryLoading,
  isLoading,
  isUncommittedExpanded,
  isCommittedExpanded,
  onToggleUncommittedExpanded,
  onToggleCommittedExpanded,
  onOpenChangedFile,
  onOpenCommittedChangedFile,
  workspaceInput = null,
  hasMoreCommitHistory,
  isLoadingMoreCommitHistory,
  loadMoreCommitHistoryErrorMessage,
  onLoadMoreCommitHistory,
}: SessionChangesPanelProps) {
  return (
    <WorkspaceChangesPanels
      changes={changes}
      isChangesLoading={isLoading}
      changesErrorMessage={errorMessage}
      isUncommittedExpanded={isUncommittedExpanded}
      onToggleUncommittedExpanded={onToggleUncommittedExpanded}
      onOpenChangedFile={onOpenChangedFile}
      commitHistory={commitHistory}
      isCommitHistoryLoading={isCommitHistoryLoading}
      commitHistoryErrorMessage={commitHistoryErrorMessage}
      isWorktree={isWorktree}
      baseBranch={baseBranch}
      isCommittedExpanded={isCommittedExpanded}
      onToggleCommittedExpanded={onToggleCommittedExpanded}
      onOpenCommittedChangedFile={onOpenCommittedChangedFile}
      workspaceInput={workspaceInput}
      hasMoreCommitHistory={hasMoreCommitHistory}
      isLoadingMoreCommitHistory={isLoadingMoreCommitHistory}
      loadMoreCommitHistoryErrorMessage={loadMoreCommitHistoryErrorMessage}
      onLoadMoreCommitHistory={onLoadMoreCommitHistory}
    />
  );
}
