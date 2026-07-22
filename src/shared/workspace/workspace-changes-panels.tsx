import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
  WorkspaceChangedFile,
  WorkspaceCommitChangedFile,
  WorkspaceCommitRecord,
} from "./workspace-commands";

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
}: WorkspaceChangesPanelsProps) {
  const { messages } = useI18n();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [expandedCommitHashes, setExpandedCommitHashes] = useState<Set<string>>(
    () => new Set(),
  );

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
              <p className="code-workspace__panel-empty">
                {isChangesLoading
                  ? messages.agentsFeature.loadingChanges
                  : messages.agentsFeature.noUncommittedChanges}
              </p>
            ) : null}
            {!changesErrorMessage ? (
              <div className="code-workspace__changes-list">
                {changes.map((file) => (
                  <ChangedFileRow
                    key={file.filePath}
                    file={file}
                    onOpenChangedFile={onOpenChangedFile}
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
              onToggleCommit={handleToggleCommit}
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
