import { Editor } from "@monaco-editor/react";

import type { SessionWorkspaceFileTab } from "./session-workspace-types";

interface SessionFileViewerProps {
  tab: SessionWorkspaceFileTab;
}

export function SessionFileViewer({ tab }: SessionFileViewerProps) {
  if (tab.isLoading) {
    return <p className="session-viewer-state">正在加载文件...</p>;
  }

  if (tab.errorMessage) {
    return (
      <p className="session-viewer-state" role="alert">
        {tab.errorMessage}
      </p>
    );
  }

  if (!tab.content) {
    return <p className="session-viewer-state">请选择文件。</p>;
  }

  if (tab.content.isBinary || tab.content.isTooLarge) {
    return (
      <section className="session-viewer-state" aria-label="File unavailable">
        <h3>{tab.fileName}</h3>
        <p>
          {tab.content.isBinary
            ? "二进制文件不可预览。"
            : "文件过大，暂不预览。"}
        </p>
      </section>
    );
  }

  return (
    <section
      className="session-file-viewer"
      aria-label={`${tab.fileName} file`}
    >
      <div className="session-file-viewer__status">{tab.filePath}</div>
      <Editor
        height="100%"
        language={tab.content.language ?? undefined}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
        }}
        value={tab.content.content}
      />
    </section>
  );
}
