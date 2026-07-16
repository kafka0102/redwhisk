import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";

import { useI18n } from "../i18n/i18n";
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
  isCommittedExpanded: boolean;
  onToggleCommittedExpanded: () => void;
}

/**
 * 「未提交 + 已提交」两折叠面板共享布局。代码工作区与 Agent 会话变更面板共用，
 * 保证两侧渲染一致。面板级展开态（未提交 / 已提交）走 props，由各消费方父层持有
 * （默认值因消费方而异）；per-commit 时间轴展开态由本组件内部自管。
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
  isCommittedExpanded,
  onToggleCommittedExpanded,
}: WorkspaceChangesPanelsProps) {
  const { messages } = useI18n();
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

  return (
    <div className="code-workspace__changes-view">
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
              onOpenCommittedChangedFile={onOpenCommittedChangedFile}
              onToggleCommit={handleToggleCommit}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
