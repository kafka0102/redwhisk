import { Editor } from "@monaco-editor/react";

import type { SessionWorkspaceFileTab } from "./session-workspace-types";
import { useI18n } from "../../../shared/i18n/i18n";
import { useMonacoEditorReady } from "../../../shared/use-monaco-editor-ready";
import { createEditorReadingLoadKey } from "../../../shared/workspace/editor-reading-position";
import { useEditorReadingPosition } from "../../../shared/workspace/use-editor-reading-position";
import { sessionFileReadingPositionKey } from "./session-file-reading-position";

interface SessionFileViewerProps {
  projectId: number;
  sessionId: number;
  tab: SessionWorkspaceFileTab;
}

/**
 * 会话工作区的文件查看器（只读 Monaco）。
 *
 * 按「项目 + session + 文件路径」缓存阅读位置，跨 Activity 切换、同 Session 内
 * Tab 遮蔽后重新可见、以及卸载后重新挂载都回到原位置（时序策略见共享 hook）。
 */
export function SessionFileViewer({
  projectId,
  sessionId,
  tab,
}: SessionFileViewerProps) {
  const { messages, contentFontSize, theme } = useI18n();
  const isMonacoReady = useMonacoEditorReady();
  const { handleEditorMount } = useEditorReadingPosition({
    readingKey: sessionFileReadingPositionKey(
      projectId,
      sessionId,
      tab.filePath,
    ),
    loadKey: createEditorReadingLoadKey({
      filePath: tab.filePath,
      isLoading: tab.isLoading,
      content: tab.content,
    }),
  });

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
        onMount={handleEditorMount}
      />
    </section>
  );
}
