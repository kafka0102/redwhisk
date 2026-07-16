import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import {
  ChangedFileRow,
  CommittedChangesTimeline,
} from "../../shared/workspace/workspace-changes-view";
import type {
  WorkspaceChangedFile,
  WorkspaceCommitRecord,
} from "../../shared/workspace/workspace-commands";

interface CodeWorkspaceChangesViewProps {
  changes: WorkspaceChangedFile[];
  isChangesLoading: boolean;
  changesErrorMessage: string | null;
  isUncommittedExpanded: boolean;
  onToggleUncommittedExpanded: () => void;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  commitHistory: WorkspaceCommitRecord[];
  isCommitHistoryLoading: boolean;
  commitHistoryErrorMessage: string | null;
  isWorktree: boolean;
  isCommittedExpanded: boolean;
  onToggleCommittedExpanded: () => void;
}

/**
 * 代码工作区左侧栏「变更」视图。复用 Agent 会话变更面板的同款渲染件，保证两处
 * 「未提交 / 已提交」展示一致；本组件只负责在此处的折叠面板布局与数据接线。
 *
 * 已提交时间轴仅展示文件列表与提交元信息（与「文件列表 + 提交元信息」范围一致），
 * 点击已提交文件为空操作；diff / 历史版本内容查看不在本特性范围。
 */
export function CodeWorkspaceChangesView({
  changes,
  isChangesLoading,
  changesErrorMessage,
  isUncommittedExpanded,
  onToggleUncommittedExpanded,
  onOpenChangedFile,
  commitHistory,
  isCommitHistoryLoading,
  commitHistoryErrorMessage,
  isWorktree,
  isCommittedExpanded,
  onToggleCommittedExpanded,
}: CodeWorkspaceChangesViewProps) {
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
              onOpenCommittedChangedFile={() => {}}
              onToggleCommit={handleToggleCommit}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
