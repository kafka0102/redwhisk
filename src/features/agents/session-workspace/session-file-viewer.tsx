import { Editor } from "@monaco-editor/react";
import { Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { SessionWorkspaceFileTab } from "./session-workspace-types";
import { useI18n } from "../../../shared/i18n/i18n";
import { useMonacoEditorReady } from "../../../shared/use-monaco-editor-ready";
import { createEditorReadingLoadKey } from "../../../shared/workspace/editor-reading-position";
import { useEditorReadingPosition } from "../../../shared/workspace/use-editor-reading-position";
import {
  isSvgTextSwitchable,
  shouldRenderVisualPreview,
  visualPreviewMimeType,
  type SvgPreviewView,
} from "../../../shared/workspace/visual-file-preview-model";
import { VisualFilePreview } from "../../../shared/workspace/visual-file-preview";
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
  const [svgView, setSvgView] = useState<{
    filePath: string;
    mode: SvgPreviewView;
  } | null>(null);
  if (svgView?.filePath !== tab.filePath) {
    setSvgView({ filePath: tab.filePath, mode: "image" });
  }
  const svgViewMode =
    svgView?.filePath === tab.filePath ? svgView.mode : "image";
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

  if (tab.content.isTooLarge) {
    return (
      <section
        className="session-viewer-state"
        aria-label={messages.agentsFeature.fileUnavailable}
      >
        <h3>{tab.fileName}</h3>
        <p>{messages.agentsFeature.largeFilePreviewUnavailable}</p>
      </section>
    );
  }

  const svgTextSwitch = isSvgTextSwitchable(tab.content);
  const previewKind = tab.content.previewKind;
  const showVisual =
    previewKind != null && shouldRenderVisualPreview(tab.content, svgViewMode);

  if (!showVisual && !svgTextSwitch && tab.content.isBinary) {
    return (
      <section
        className="session-viewer-state"
        aria-label={messages.agentsFeature.fileUnavailable}
      >
        <h3>{tab.fileName}</h3>
        <p>{messages.agentsFeature.binaryPreviewUnavailable}</p>
      </section>
    );
  }

  let body: ReactNode;
  if (showVisual && previewKind) {
    body = (
      <VisualFilePreview
        bytesBase64={tab.content.previewBytesBase64}
        failureMessage={messages.agentsFeature.visualPreviewLoadFailed}
        kind={previewKind}
        label={tab.fileName}
        mimeType={visualPreviewMimeType(tab.content.filePath, previewKind)}
      />
    );
  } else if (!isMonacoReady) {
    body = (
      <p className="session-viewer-state">
        {messages.agentsFeature.loadingFile}
      </p>
    );
  } else {
    body = (
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
    );
  }

  return (
    <section
      className="session-file-viewer"
      aria-label={messages.agentsFeature.fileView(tab.fileName)}
    >
      <div className="session-file-viewer__status">
        <span className="session-file-viewer__path">{tab.filePath}</span>
        {svgTextSwitch ? (
          <button
            type="button"
            className="code-workspace__markdown-toggle"
            aria-label={messages.agentsFeature.toggleSvgPreview}
            aria-pressed={svgViewMode === "image"}
            onClick={() =>
              setSvgView({
                filePath: tab.filePath,
                mode: svgViewMode === "image" ? "text" : "image",
              })
            }
          >
            {svgViewMode === "image" ? (
              <EyeOff aria-hidden="true" size={14} strokeWidth={1.9} />
            ) : (
              <Eye aria-hidden="true" size={14} strokeWidth={1.9} />
            )}
          </button>
        ) : null}
      </div>
      {body}
    </section>
  );
}
