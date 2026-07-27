import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { useI18n } from "../i18n/i18n";
import { DiffViewer } from "./diff-viewer";
import type {
  MultiDiffFileState,
  MultiDiffViewState,
} from "./multi-diff-types";
import { renderCommitFileStatusIcon } from "./workspace-commit-file-status";

interface MultiDiffViewerProps {
  state: MultiDiffViewState | null;
}

/**
 * 提交全部更改视图：主体叠放该提交全部文件 diff。
 * 每文件可折叠（默认全展开，折叠态不持久化）；面板头 sticky 单层吸顶。
 * 无页头摘要条。状态由调用方 hook 管理。
 */
export function MultiDiffViewer({ state }: MultiDiffViewerProps) {
  const { messages } = useI18n();
  // 折叠态仅存本组件内存；切换提交时 key 变化会重置（调用方应挂 key=commitHash）。
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(
    () => new Set(),
  );

  if (!state) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.selectChangedFile}
      </p>
    );
  }

  if (state.files.length === 0) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.noCommitFileChanges}
      </p>
    );
  }

  const toggle = (filePath: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  return (
    <div
      className="multi-diff-viewer"
      aria-label={messages.agentsFeature.commitAllChangesView}
    >
      {state.files.map((file) => {
        const isCollapsed = collapsedPaths.has(file.filePath);
        return (
          <MultiDiffPanel
            key={file.filePath}
            file={file}
            isCollapsed={isCollapsed}
            onToggle={() => toggle(file.filePath)}
          />
        );
      })}
    </div>
  );
}

interface MultiDiffPanelProps {
  file: MultiDiffFileState;
  isCollapsed: boolean;
  onToggle: () => void;
}

function MultiDiffPanel({ file, isCollapsed, onToggle }: MultiDiffPanelProps) {
  const { messages } = useI18n();
  const expandLabel = isCollapsed
    ? messages.agentsFeature.expandDiffPanel(file.fileName)
    : messages.agentsFeature.collapseDiffPanel(file.fileName);

  return (
    <section className="multi-diff-panel" aria-label={file.filePath}>
      <header className="multi-diff-panel__header">
        <button
          type="button"
          className="multi-diff-panel__toggle"
          aria-expanded={!isCollapsed}
          aria-label={expandLabel}
          onClick={onToggle}
        >
          {isCollapsed ? (
            <ChevronRight aria-hidden="true" size={14} strokeWidth={1.8} />
          ) : (
            <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
          )}
        </button>
        {renderCommitFileStatusIcon(file.status)}
        <span className="multi-diff-panel__identity">
          <span className="multi-diff-panel__name">{file.fileName}</span>
          <span className="multi-diff-panel__path">{file.filePath}</span>
        </span>
      </header>
      {isCollapsed ? null : (
        <div className="multi-diff-panel__body">
          <DiffViewer
            tab={{
              fileName: file.fileName,
              filePath: file.filePath,
              diff: file.diff,
              isLoading: file.isLoading,
              errorMessage: file.errorMessage,
            }}
            showStatusBar={false}
            heightMode="content"
          />
        </div>
      )}
    </section>
  );
}
