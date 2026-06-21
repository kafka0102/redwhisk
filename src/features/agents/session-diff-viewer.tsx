import { DiffEditor } from "@monaco-editor/react";

import type { WorkspaceChangeKind } from "./session-workspace-commands";
import type { SessionWorkspaceChangeTab } from "./session-workspace-types";

interface SessionDiffViewerProps {
  tab: SessionWorkspaceChangeTab;
}

export function SessionDiffViewer({ tab }: SessionDiffViewerProps) {
  if (tab.isLoading) {
    return <p className="session-viewer-state">正在加载 diff...</p>;
  }

  if (tab.errorMessage) {
    return (
      <p className="session-viewer-state" role="alert">
        {tab.errorMessage}
      </p>
    );
  }

  if (!tab.diff) {
    return <p className="session-viewer-state">请选择变更文件。</p>;
  }

  if (tab.diff.isBinary || tab.diff.isTooLarge) {
    return (
      <section className="session-viewer-state" aria-label="Diff 不可预览">
        <h3>{tab.fileName}</h3>
        <p>
          {tab.diff.isBinary ? "二进制文件不可预览。" : "文件过大，暂不预览。"}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label={`${tab.fileName} diff`}
      className="session-diff-viewer"
    >
      <div className="session-diff-viewer__status">
        {formatDiffStatus(tab.diff.kind)}
      </div>
      <DiffEditor
        height="100%"
        language={tab.diff.language ?? undefined}
        modified={tab.diff.modifiedContent}
        original={tab.diff.originalContent}
        options={{
          fontSize: 12,
          minimap: { enabled: false },
          readOnly: true,
          renderSideBySide:
            tab.diff.kind !== "added" && tab.diff.kind !== "untracked",
          scrollBeyondLastLine: false,
        }}
      />
    </section>
  );
}

function formatDiffStatus(kind: WorkspaceChangeKind): string {
  switch (kind) {
    case "added":
    case "untracked":
      return "新增";
    case "deleted":
      return "删除";
    case "renamed":
      return "重命名";
    case "copied":
      return "复制";
    case "binary":
      return "二进制";
    case "modified":
      return "修改";
  }
}
