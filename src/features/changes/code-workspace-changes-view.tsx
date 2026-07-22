import { WorkspaceChangesPanels } from "../../shared/workspace/workspace-changes-panels";
import type {
  WorkspaceChangedFile,
  WorkspaceCommitChangedFile,
} from "../../shared/workspace/workspace-commands";
import {
  useChangesAutoRefresh,
  useWorktreeRunningSession,
} from "./use-changes-auto-refresh";
import { useCodeWorkspaceChanges } from "./use-code-workspace-changes";

interface CodeWorkspaceChangesViewProps {
  projectId: number;
  selectedRootWorkspacePath: string | null;
  uncommittedExpanded: boolean;
  committedExpanded: boolean;
  onToggleUncommitted: () => void;
  onToggleCommitted: () => void;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onOpenCommittedChangedFile: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
}

/**
 * 变更 Activity 的侧栏内容：接线变更数据 hooks（useCodeWorkspaceChanges /
 * useWorktreeRunningSession / useChangesAutoRefresh）并渲染 WorkspaceChangesPanels。
 * 分支下拉 / splitter / 布局 / DiffViewer 由 ChangesActivity + WorkspaceShell 承载，
 * 本组件不再负责。文件名保留 code-workspace- 前缀属历史包袱（ADR-0009），暂不更名。
 */
export function CodeWorkspaceChangesView({
  projectId,
  selectedRootWorkspacePath,
  uncommittedExpanded,
  committedExpanded,
  onToggleUncommitted,
  onToggleCommitted,
  onOpenChangedFile,
  onOpenCommittedChangedFile,
}: CodeWorkspaceChangesViewProps) {
  const {
    changes,
    isChangesLoading,
    changesErrorMessage,
    isChangesUnavailable,
    commitHistory,
    isCommitHistoryLoading,
    commitHistoryErrorMessage,
    isWorktree,
    baseBranch,
    hasMoreCommitHistory,
    isLoadingMoreCommitHistory,
    loadMoreCommitHistoryErrorMessage,
    refreshChanges,
    refreshCommitHistory,
    loadMoreCommitHistory,
  } = useCodeWorkspaceChanges(projectId, selectedRootWorkspacePath, true);

  const isWorktreeRunning = useWorktreeRunningSession(
    projectId,
    selectedRootWorkspacePath,
    true,
  );
  useChangesAutoRefresh({
    enabled: true,
    running: isWorktreeRunning,
    refreshChanges,
    refreshCommitHistory,
    isUnavailable: isChangesUnavailable,
  });

  return (
    <WorkspaceChangesPanels
      changes={changes}
      changesErrorMessage={changesErrorMessage}
      isChangesLoading={isChangesLoading}
      isUncommittedExpanded={uncommittedExpanded}
      onOpenChangedFile={onOpenChangedFile}
      onOpenCommittedChangedFile={onOpenCommittedChangedFile}
      onToggleUncommittedExpanded={onToggleUncommitted}
      commitHistory={commitHistory}
      commitHistoryErrorMessage={commitHistoryErrorMessage}
      isCommitHistoryLoading={isCommitHistoryLoading}
      isWorktree={isWorktree}
      baseBranch={baseBranch}
      isCommittedExpanded={committedExpanded}
      onToggleCommittedExpanded={onToggleCommitted}
      hasMoreCommitHistory={hasMoreCommitHistory}
      isLoadingMoreCommitHistory={isLoadingMoreCommitHistory}
      loadMoreCommitHistoryErrorMessage={loadMoreCommitHistoryErrorMessage}
      onLoadMoreCommitHistory={loadMoreCommitHistory}
    />
  );
}
