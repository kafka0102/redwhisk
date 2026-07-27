import { useCallback, useEffect } from "react";

import { WorkspaceChangesPanels } from "../../shared/workspace/workspace-changes-panels";
import type {
  WorkspaceChangedFile,
  WorkspaceCommitChangedFile,
  WorkspaceCommitRecord,
} from "../../shared/workspace/workspace-commands";
import {
  useChangesAutoRefresh,
  useWorktreeRunningSession,
} from "./use-changes-auto-refresh";
import { useCodeWorkspaceChanges } from "./use-code-workspace-changes";
import { useSyncChangesAction } from "./use-sync-changes-action";

interface CodeWorkspaceChangesViewProps {
  projectId: number;
  selectedRootWorkspacePath: string | null;
  /** 当前选中根是否为项目主 checkout；linked worktree 为 false。 */
  isProjectRoot?: boolean;
  /** 外部递增时立即刷新未提交与已提交列表（拉取/推送成功）。 */
  refreshTick?: number;
  uncommittedExpanded: boolean;
  committedExpanded: boolean;
  onToggleUncommitted: () => void;
  onToggleCommitted: () => void;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onOpenCommittedChangedFile: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
  onOpenCommitChanges?: (commit: WorkspaceCommitRecord) => void;
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
  isProjectRoot = false,
  refreshTick = 0,
  uncommittedExpanded,
  committedExpanded,
  onToggleUncommitted,
  onToggleCommitted,
  onOpenChangedFile,
  onOpenCommittedChangedFile,
  onOpenCommitChanges,
}: CodeWorkspaceChangesViewProps) {
  const {
    changes,
    branchSync,
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

  useEffect(() => {
    if (refreshTick <= 0) {
      return;
    }
    refreshChanges();
    refreshCommitHistory();
  }, [refreshTick, refreshChanges, refreshCommitHistory]);

  const handleRemoteSuccess = useCallback(() => {
    refreshChanges();
    refreshCommitHistory();
  }, [refreshChanges, refreshCommitHistory]);

  const { requestSync, dialogs: syncDialogs } = useSyncChangesAction({
    projectId,
    workspacePath: selectedRootWorkspacePath,
    onSuccess: handleRemoteSuccess,
  });

  const handleSyncChanges = useCallback(() => {
    if (branchSync == null) {
      return;
    }
    requestSync(branchSync);
  }, [branchSync, requestSync]);

  return (
    <>
      <WorkspaceChangesPanels
        changes={changes}
        changesErrorMessage={changesErrorMessage}
        isChangesLoading={isChangesLoading}
        isUncommittedExpanded={uncommittedExpanded}
        onOpenChangedFile={onOpenChangedFile}
        onOpenCommittedChangedFile={onOpenCommittedChangedFile}
        onOpenCommitChanges={onOpenCommitChanges}
        onToggleUncommittedExpanded={onToggleUncommitted}
        workspaceInput={
          selectedRootWorkspacePath
            ? { projectId, workspacePath: selectedRootWorkspacePath }
            : null
        }
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
        branchSync={branchSync}
        isProjectRoot={isProjectRoot}
        onSyncChanges={isProjectRoot ? handleSyncChanges : undefined}
      />
      {syncDialogs}
    </>
  );
}
