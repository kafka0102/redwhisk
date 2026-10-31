import { Editor } from "@monaco-editor/react";
import { Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { SessionWorkspaceFileTab } from "./session-workspace-types";
import { useAlertDialog } from "../../../components/ui";
import { CodeMarkdownPreview } from "../../code/code-markdown-preview";
import { useI18n } from "../../../shared/i18n/i18n";
import { useMonacoEditorReady } from "../../../shared/use-monaco-editor-ready";
import { createEditorReadingLoadKey } from "../../../shared/workspace/editor-reading-position";
import {
  isHtmlFile,
  openHtmlInBrowser,
} from "../../../shared/workspace/open-html-in-browser";
import { useEditorReadingPosition } from "../../../shared/workspace/use-editor-reading-position";
import {
  useMarkdownPreviewMode,
  useMarkdownPreviewReadingPosition,
} from "../../../shared/workspace/use-markdown-preview-state";
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
  workspacePath?: string | null;
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
  workspacePath = null,
}: SessionFileViewerProps) {
  const { messages, contentFontSize, theme, t } = useI18n();
  const { alertDialog, showAlert } = useAlertDialog();
  const [svgView, setSvgView] = useState<{
    filePath: string;
    mode: SvgPreviewView;
  } | null>(null);
  const openInBrowserRoot = hasWorkspaceRoot(workspacePath)
    ? workspacePath
    : null;
  const showOpenInBrowser =
    openInBrowserRoot != null && isHtmlFile(tab.fileName);
  if (svgView?.filePath !== tab.filePath) {
    setSvgView({ filePath: tab.filePath, mode: "image" });
  }
  const svgViewMode =
    svgView?.filePath === tab.filePath ? svgView.mode : "image";
  const isMonacoReady = useMonacoEditorReady();
  const readingKey = sessionFileReadingPositionKey(
    projectId,
    sessionId,
    tab.filePath,
  );
  const [markdownMode, setMarkdownMode] = useMarkdownPreviewMode(readingKey);
  const {
    containerRef: markdownPreviewRef,
    handleScroll: handleMarkdownPreviewScroll,
  } = useMarkdownPreviewReadingPosition({
    readingKey,
    enabled: markdownMode === "preview",
  });
  const { handleEditorMount } = useEditorReadingPosition({
    readingKey,
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

  const showMarkdownPreview = tab.content.language === "markdown";
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
  } else if (showMarkdownPreview && markdownMode === "preview") {
    body = (
      <div
        className="code-workspace__markdown-preview"
        ref={markdownPreviewRef}
        onScroll={handleMarkdownPreviewScroll}
        style={{ fontSize: contentFontSize }}
      >
        <CodeMarkdownPreview content={tab.content.content} theme={theme} />
      </div>
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
        {showOpenInBrowser ? (
          <button
            type="button"
            className="code-workspace__browser-toggle session-file-viewer__browser-toggle"
            aria-label={t("agentsFeature.openHtmlInBrowser")}
            title={t("agentsFeature.openHtmlInBrowser")}
            onClick={() => {
              if (!openInBrowserRoot) {
                return;
              }
              void openHtmlInBrowser(openInBrowserRoot, tab.filePath).then(
                (opened) => {
                  if (!opened) {
                    showAlert({
                      message: t("agentsFeature.openHtmlInBrowserFailed"),
                      type: "error",
                    });
                  }
                },
              );
            }}
          >
            <SessionBrowserIcon />
          </button>
        ) : null}
        {showMarkdownPreview ? (
          <button
            type="button"
            className="code-workspace__markdown-toggle session-file-viewer__browser-toggle"
            aria-label={t("agentsFeature.toggleMarkdownPreview")}
            aria-pressed={markdownMode === "preview"}
            title={t("agentsFeature.toggleMarkdownPreview")}
            onClick={() =>
              setMarkdownMode(markdownMode === "preview" ? "source" : "preview")
            }
          >
            {markdownMode === "preview" ? (
              <EyeOff aria-hidden="true" size={14} strokeWidth={1.9} />
            ) : (
              <Eye aria-hidden="true" size={14} strokeWidth={1.9} />
            )}
          </button>
        ) : null}
      </div>
      {alertDialog}
      {body}
    </section>
  );
}

function hasWorkspaceRoot(
  workspacePath: string | null | undefined,
): workspacePath is string {
  return typeof workspacePath === "string" && workspacePath.trim().length > 0;
}

function SessionBrowserIcon() {
  return (
    <svg aria-hidden="true" width={14} height={14} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="#34A853" />
      <path
        d="M12 2a10 10 0 0 1 8.66 15H13.2A4.6 4.6 0 0 0 12 7.4V2Z"
        fill="#EA4335"
      />
      <path
        d="M3.34 7A10 10 0 0 0 12 22l3.2-7.6A4.6 4.6 0 0 0 8.2 13.1L3.34 7Z"
        fill="#FBBC04"
      />
      <circle cx="12" cy="12" r="4.5" fill="#fff" />
      <circle cx="12" cy="12" r="3.1" fill="#4285F4" />
    </svg>
  );
}
