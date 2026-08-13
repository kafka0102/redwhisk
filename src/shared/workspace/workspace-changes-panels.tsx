import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../i18n/i18n";
import {
  COMMIT_HISTORY_LOAD_MORE_THRESHOLD_PX,
  isNearScrollBottom,
} from "./commit-history-pagination";
import {
  ChangedFileRow,
  CommittedChangesTimeline,
} from "./workspace-changes-view";
import type {
  BranchSyncStatus,
  ProjectWorkspaceInput,
  WorkspaceChangedFile,
  WorkspaceCommitChangedFile,
  WorkspaceCommitRecord,
} from "./workspace-commands";
import { useWorkspaceGithubRemote } from "./use-workspace-github-remote";
import {
  formatSyncChangesLabel,
  shouldShowSyncChangesButton,
} from "./sync-changes";

interface WorkspaceChangesPanelsProps {
  changes: WorkspaceChangedFile[];
  isChangesLoading: boolean;
  changesErrorMessage: string | null;
  isUncommittedExpanded: boolean;
  onToggleUncommittedExpanded: () => void;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onOpenCommittedChangedFile: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
  /** 提交上下文菜单「打开更改」；可选，后续多 diff 视图接线。 */
  onOpenCommitChanges?: (commit: WorkspaceCommitRecord) => void;
  /** 用于解析 github.com remote 以显示「在 GitHub 上打开」；缺省不显示。 */
  workspaceInput?: ProjectWorkspaceInput | null;
  commitHistory: WorkspaceCommitRecord[];
  isCommitHistoryLoading: boolean;
  commitHistoryErrorMessage: string | null;
  isWorktree: boolean;
  // worktree 场景下解析出的分叉基分支名；非 worktree / 主分支 / 解析失败时为 null。
  // 透传给 CommittedChangesTimeline 渲染首条黄色提交右侧的黄色 base Tag。
  baseBranch?: string | null;
  isCommittedExpanded: boolean;
  onToggleCommittedExpanded: () => void;
  hasMoreCommitHistory?: boolean;
  isLoadingMoreCommitHistory?: boolean;
  loadMoreCommitHistoryErrorMessage?: string | null;
  onLoadMoreCommitHistory?: () => void;
  /** 项目主 checkout 相对 upstream 的同步状态；缺省不展示同步按钮。 */
  branchSync?: BranchSyncStatus | null;
  /** 当前选中根是否为项目主 checkout；Agent 会话侧不传。 */
  isProjectRoot?: boolean;
  /** 点击「同步更改」；缺省不展示按钮。 */
  onSyncChanges?: () => void;
}

/**
 * 「未提交 + 已提交」两折叠面板共享布局。代码工作区与 Agent 会话变更面板共用，
 * 保证两侧渲染一致。面板级展开态（未提交 / 已提交）走 props，由各消费方父层持有
 * （默认值因消费方而异）；per-commit 时间轴展开态由本组件内部自管。
 *
 * 外层 `.code-workspace__changes-view` 滚动到距底约 80px 且已提交展开时触发
 * load-more；首屏不足一屏时在内容变化后自动连拉。
 *
 * 点击未提交 / 已提交变更文件均由父层回调触发右侧 diff 面板：未提交取工作区 diff，
 * 已提交带 commitHash 取该提交版本 diff。
 */
export function WorkspaceChangesPanels({
  changes,
  isChangesLoading,
  changesErrorMessage,
  isUncommittedExpanded,
  onToggleUncommittedExpanded,
  onOpenChangedFile,
  onOpenCommittedChangedFile,
  onOpenCommitChanges,
  workspaceInput = null,
  commitHistory,
  isCommitHistoryLoading,
  commitHistoryErrorMessage,
  isWorktree,
  baseBranch,
  isCommittedExpanded,
  onToggleCommittedExpanded,
  hasMoreCommitHistory = false,
  isLoadingMoreCommitHistory = false,
  loadMoreCommitHistoryErrorMessage = null,
  onLoadMoreCommitHistory,
  branchSync = null,
  isProjectRoot = false,
  onSyncChanges,
}: WorkspaceChangesPanelsProps) {
  const { messages, t } = useI18n();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [expandedCommitHashes, setExpandedCommitHashes] = useState<Set<string>>(
    () => new Set(),
  );
  const githubRemote = useWorkspaceGithubRemote(workspaceInput);

  const showSyncChanges = shouldShowSyncChangesButton({
    fileCount: changes.length,
    isLoading: isChangesLoading,
    hasError: changesErrorMessage != null,
    isProjectRoot,
    branchSync,
    hasSyncHandler: onSyncChanges != null,
  });

  const syncChangesLabel = useMemo(() => {
    if (!showSyncChanges || branchSync == null) {
      return null;
    }
    return formatSyncChangesLabel(branchSync, {
      behindOnly: (count) => t("changesSync.syncChangesBehind", { count }),
      aheadOnly: (count) => t("changesSync.syncChangesAhead", { count }),
      both: (behind, ahead) =>
        t("changesSync.syncChangesBoth", { behind, ahead }),
    });
  }, [branchSync, showSyncChanges, t]);

  const handleToggleCommit = useCallback((hash: string) => {
    setExpandedCommitHashes((current) => {
      const next = new Set(current);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  }, []);

  const canLoadMoreCommitHistory = useCallback(() => {
    if (!onLoadMoreCommitHistory) return false;
    if (!isCommittedExpanded) return false;
    if (!hasMoreCommitHistory) return false;
    if (isLoadingMoreCommitHistory || isCommitHistoryLoading) return false;
    return true;
  }, [
    onLoadMoreCommitHistory,
    isCommittedExpanded,
    hasMoreCommitHistory,
    isLoadingMoreCommitHistory,
    isCommitHistoryLoading,
  ]);

  const handleScroll = useCallback(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    if (!isNearScrollBottom(node, COMMIT_HISTORY_LOAD_MORE_THRESHOLD_PX)) {
      return;
    }
    // 用户再次滚动可重试：load-more 入口会清掉上一轮错误。
    if (!canLoadMoreCommitHistory()) return;
    onLoadMoreCommitHistory?.();
  }, [canLoadMoreCommitHistory, onLoadMoreCommitHistory]);

  // 首屏不足一屏 / 展开已提交后贴底：自动连拉直到填满或 hasMore=false。
  // 失败后不自动连拉，避免错误态下 tight loop。
  useEffect(() => {
    if (!canLoadMoreCommitHistory()) return;
    if (loadMoreCommitHistoryErrorMessage) return;
    const node = scrollContainerRef.current;
    if (!node) return;
    if (!isNearScrollBottom(node, COMMIT_HISTORY_LOAD_MORE_THRESHOLD_PX)) {
      return;
    }
    onLoadMoreCommitHistory?.();
  }, [
    commitHistory.length,
    canLoadMoreCommitHistory,
    loadMoreCommitHistoryErrorMessage,
    onLoadMoreCommitHistory,
  ]);

  return (
    <div
      className="code-workspace__changes-view"
      ref={scrollContainerRef}
      onScroll={handleScroll}
    >
      <section className="code-workspace__panel">
        <button
          aria-expanded={isUncommittedExpanded}
          className="code-workspace__panel-header"
          type="button"
          onClick={onToggleUncommittedExpanded}
        >
          {isUncommittedExpanded ? (
            <ChevronDown aria-hidden="true" size={13} strokeWidth={2} />
          ) : (
            <ChevronRight aria-hidden="true" size={13} strokeWidth={2} />
          )}
          <span>{messages.agentsFeature.uncommittedChanges}</span>
        </button>
        {isUncommittedExpanded ? (
          <div className="code-workspace__panel-body">
            {changesErrorMessage ? (
              <p className="code-workspace__panel-empty">
                {changesErrorMessage}
              </p>
            ) : null}
            {changes.length === 0 && !changesErrorMessage ? (
              showSyncChanges && syncChangesLabel && onSyncChanges ? (
                <button
                  className="code-workspace__sync-changes"
                  type="button"
                  onClick={onSyncChanges}
                >
                  <span>{syncChangesLabel}</span>
                </button>
              ) : (
                <p className="code-workspace__panel-empty">
                  {isChangesLoading
                    ? messages.agentsFeature.loadingChanges
                    : messages.agentsFeature.noUncommittedChanges}
                </p>
              )
            ) : null}
            {!changesErrorMessage ? (
              <div className="code-workspace__changes-list">
                {changes.map((file) => (
                  <ChangedFileRow
                    key={file.filePath}
                    file={file}
                    onOpenChangedFile={onOpenChangedFile}
                    workspacePath={workspaceInput?.workspacePath}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="code-workspace__panel">
        <button
          aria-expanded={isCommittedExpanded}
          className="code-workspace__panel-header"
          type="button"
          onClick={onToggleCommittedExpanded}
        >
          {isCommittedExpanded ? (
            <ChevronDown aria-hidden="true" size={13} strokeWidth={2} />
          ) : (
            <ChevronRight aria-hidden="true" size={13} strokeWidth={2} />
          )}
          <span>{messages.agentsFeature.committedChanges}</span>
        </button>
        {isCommittedExpanded ? (
          <div className="code-workspace__panel-body">
            <CommittedChangesTimeline
              commits={commitHistory}
              errorMessage={commitHistoryErrorMessage}
              expandedCommitHashes={expandedCommitHashes}
              isLoading={isCommitHistoryLoading}
              isWorktree={isWorktree}
              baseBranch={baseBranch}
              onOpenCommittedChangedFile={onOpenCommittedChangedFile}
              onOpenCommitChanges={onOpenCommitChanges}
              githubRemote={githubRemote}
              onToggleCommit={handleToggleCommit}
              workspacePath={workspaceInput?.workspacePath}
            />
            {isLoadingMoreCommitHistory ? (
              <div
                className="code-workspace__commit-history-load-more"
                role="status"
              >
                <LoaderCircle
                  aria-hidden="true"
                  className="code-workspace__commit-history-load-more-spinner"
                  size={13}
                  strokeWidth={2}
                />
                <span>{messages.agentsFeature.loadingMoreCommitHistory}</span>
              </div>
            ) : null}
            {loadMoreCommitHistoryErrorMessage ? (
              <p className="code-workspace__commit-history-load-more-error">
                {loadMoreCommitHistoryErrorMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
