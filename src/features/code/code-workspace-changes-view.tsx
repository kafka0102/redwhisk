import { ChevronDown, ChevronRight } from "lucide-react";

import { useI18n } from "../../shared/i18n/i18n";
import { ChangedFileRow } from "../../shared/workspace/workspace-changes-view";
import type { WorkspaceChangedFile } from "../../shared/workspace/workspace-commands";

interface CodeWorkspaceChangesViewProps {
  changes: WorkspaceChangedFile[];
  isChangesLoading: boolean;
  changesErrorMessage: string | null;
  isUncommittedExpanded: boolean;
  onToggleUncommittedExpanded: () => void;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
}

/**
 * 代码工作区左侧栏「变更」视图。复用 Agent 会话变更面板的同款渲染件，保证两处
 * 「未提交 / 已提交」展示一致；本组件只负责在此处的折叠面板布局与数据接线。
 */
export function CodeWorkspaceChangesView({
  changes,
  isChangesLoading,
  changesErrorMessage,
  isUncommittedExpanded,
  onToggleUncommittedExpanded,
  onOpenChangedFile,
}: CodeWorkspaceChangesViewProps) {
  const { messages } = useI18n();

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
    </div>
  );
}
