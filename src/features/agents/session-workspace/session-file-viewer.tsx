import { Editor } from "@monaco-editor/react";

import type { SessionWorkspaceFileTab } from "./session-workspace-types";
import { useI18n } from "../../../shared/i18n/i18n";
import { useMonacoEditorReady } from "../../../shared/use-monaco-editor-ready";

interface SessionFileViewerProps {
  tab: SessionWorkspaceFileTab;
}

export function SessionFileViewer({ tab }: SessionFileViewerProps) {
  const { messages, contentFontSize, theme } = useI18n();
  const isMonacoReady = useMonacoEditorReady();
  if (tab.isLoading) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.loadingFile}
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

  if (!tab.content) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.selectFile}
      </p>
    );
  }

  if (tab.content.isBinary || tab.content.isTooLarge) {
    return (
      <section
        className="session-viewer-state"
        aria-label={messages.agentsFeature.fileUnavailable}
      >
        <h3>{tab.fileName}</h3>
        <p>
          {tab.content.isBinary
            ? messages.agentsFeature.binaryPreviewUnavailable
            : messages.agentsFeature.largeFilePreviewUnavailable}
        </p>
      </section>
    );
  }

  if (!isMonacoReady) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.loadingFile}
      </p>
    );
  }

  return (
    <section
      className="session-file-viewer"
      aria-label={messages.agentsFeature.fileView(tab.fileName)}
    >
      <div className="session-file-viewer__status">{tab.filePath}</div>
      <Editor
        height="100%"
        theme={theme === "dark" ? "vs-dark" : "light"}
        language={tab.content.language ?? undefined}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: contentFontSize,
        }}
        value={tab.content.content}
      />
    </section>
  );
}
