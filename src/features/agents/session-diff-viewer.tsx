import { DiffEditor } from "@monaco-editor/react";

import type { WorkspaceChangeKind } from "./session-workspace-commands";
import type { SessionWorkspaceChangeTab } from "./session-workspace-types";
import { useI18n } from "../../shared/i18n/i18n";

interface SessionDiffViewerProps {
  tab: SessionWorkspaceChangeTab;
}

export function SessionDiffViewer({ tab }: SessionDiffViewerProps) {
  const { messages, contentFontSize } = useI18n();
  if (tab.isLoading) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.loadingDiff}
      </p>
    );
  }

  if (tab.errorMessage) {
    return (
      <p className="session-viewer-state" role="alert">
        {tab.errorMessage}
      </p>
    );
  }

  if (!tab.diff) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.selectChangedFile}
      </p>
    );
  }

  if (tab.diff.isBinary || tab.diff.isTooLarge) {
    return (
      <section
        className="session-viewer-state"
        aria-label={messages.agentsFeature.diffUnavailable}
      >
        <h3>{tab.fileName}</h3>
        <p>
          {tab.diff.isBinary
            ? messages.agentsFeature.binaryPreviewUnavailable
            : messages.agentsFeature.largeFilePreviewUnavailable}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label={messages.agentsFeature.diffView(tab.fileName)}
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
          fontSize: contentFontSize,
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
