import { DiffEditor } from "@monaco-editor/react";

import type { WorkspaceChangeKind } from "./session-workspace-commands";
import type { SessionWorkspaceChangeTab } from "./session-workspace-types";
import { useI18n } from "../../shared/i18n/i18n";

interface SessionDiffViewerProps {
  tab: SessionWorkspaceChangeTab;
}

const CHANGE_KIND_KEY: Record<WorkspaceChangeKind, string> = {
  added: "agentsFeature.changeKindAdded",
  untracked: "agentsFeature.changeKindAdded",
  deleted: "agentsFeature.changeKindDeleted",
  renamed: "agentsFeature.changeKindRenamed",
  copied: "agentsFeature.changeKindCopied",
  binary: "agentsFeature.changeKindBinary",
  modified: "agentsFeature.changeKindModified",
};

export function SessionDiffViewer({ tab }: SessionDiffViewerProps) {
  const { messages, t, contentFontSize } = useI18n();
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
        {t(CHANGE_KIND_KEY[tab.diff.kind])} {tab.filePath}
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
