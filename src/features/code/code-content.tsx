import { Editor, type OnMount } from "@monaco-editor/react";

import { CodeMarkdownPreview } from "./code-markdown-preview";
import { useCallback, useEffect, useRef } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import {
  getCodeEditorViewState,
  setCodeEditorViewState,
  type CodeFileTab,
} from "./code-workspace-cache";

export interface CodeRevealRequest {
  filePath: string;
  lineNumber: number;
  token: number;
}

/**
 * 文件内容渲染区：根据 tab 状态展示加载/错误/二进制/过大/正常态。
 *
 * - 加载中：loadingFile 文案。
 * - 加载失败：file-error 红色 alert（受 `resolveFileLoadErrorMessage` 解析的 errorMessage 驱动）。
 * - 二进制或过大：占位提示，不进入 Monaco。
 * - 正常：Monaco 只读 Editor，字号跟随 `contentFontSize`，主题跟随全局 `theme`。
 * - 可选 revealRequest：打开匹配行时滚动并定位光标。
 * - 按 projectId + filePath 缓存 Monaco view state，跨 Activity 切换后恢复阅读位置。
 */
export function CodeContent({
  projectId,
  tab,
  contentFontSize,
  messages,
  theme,
  revealRequest = null,
  viewMode = "source",
}: {
  projectId: number;
  tab: CodeFileTab;
  contentFontSize: number;
  messages: ReturnType<typeof useI18n>["messages"];
  theme: "light" | "dark";
  revealRequest?: CodeRevealRequest | null;
  viewMode?: "source" | "preview";
}) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const appliedRevealTokenRef = useRef<number | null>(null);
  const projectIdRef = useRef(projectId);
  const filePathRef = useRef(tab.filePath);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    filePathRef.current = tab.filePath;
  }, [tab.filePath]);

  const persistViewState = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    setCodeEditorViewState(
      projectIdRef.current,
      filePathRef.current,
      editor.saveViewState(),
    );
  }, []);

  const applyReveal = useCallback(
    (lineNumber: number) => {
      const editor = editorRef.current;
      if (!editor || lineNumber < 1) return;
      editor.revealLineInCenter(lineNumber);
      editor.setPosition({ lineNumber, column: 1 });
      editor.focus();
      persistViewState();
    },
    [persistViewState],
  );

  const restoreSavedViewState = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const savedViewState = getCodeEditorViewState(
      projectIdRef.current,
      filePathRef.current,
    );
    if (!savedViewState) return;
    editor.restoreViewState(savedViewState);
  }, []);

  useEffect(() => {
    if (!revealRequest) return;
    if (revealRequest.filePath !== tab.filePath) return;
    if (
      tab.isLoading ||
      !tab.content ||
      tab.content.isBinary ||
      tab.content.isTooLarge
    ) {
      return;
    }
    if (appliedRevealTokenRef.current === revealRequest.token) return;
    appliedRevealTokenRef.current = revealRequest.token;
    applyReveal(revealRequest.lineNumber);
  }, [applyReveal, revealRequest, tab.content, tab.filePath, tab.isLoading]);

  // 复检文件内容后 Monaco 可能重设 value 并回顶，需再次恢复阅读位置。
  useEffect(() => {
    if (
      tab.isLoading ||
      !tab.content ||
      tab.content.isBinary ||
      tab.content.isTooLarge
    ) {
      return;
    }
    if (revealRequest && revealRequest.filePath === tab.filePath) {
      return;
    }
    restoreSavedViewState();
  }, [
    restoreSavedViewState,
    revealRequest,
    tab.content,
    tab.filePath,
    tab.isLoading,
  ]);

  useEffect(() => {
    return () => {
      persistViewState();
    };
  }, [persistViewState, tab.filePath]);

  if (tab.isLoading) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.loadingFile}
      </p>
    );
  }
  if (tab.errorMessage) {
    return (
      <p className="code-workspace__file-error" role="alert">
        {tab.errorMessage}
      </p>
    );
  }
  if (!tab.content) {
    return null;
  }
  if (tab.content.isBinary || tab.content.isTooLarge) {
    return (
      <p className="session-viewer-state">
        {tab.content.isBinary
          ? messages.agentsFeature.binaryPreviewUnavailable
          : messages.agentsFeature.largeFilePreviewUnavailable}
      </p>
    );
  }

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    if (
      revealRequest &&
      revealRequest.filePath === tab.filePath &&
      revealRequest.lineNumber >= 1
    ) {
      appliedRevealTokenRef.current = revealRequest.token;
      applyReveal(revealRequest.lineNumber);
    } else {
      restoreSavedViewState();
    }

    const scrollDisposable = editor.onDidScrollChange(() => {
      persistViewState();
    });
    editor.onDidDispose(() => {
      scrollDisposable.dispose();
    });
  };

  if (viewMode === "preview") {
    return (
      <div
        className="code-workspace__markdown-preview"
        style={{ fontSize: contentFontSize }}
      >
        <CodeMarkdownPreview content={tab.content.content} theme={theme} />
      </div>
    );
  }

  return (
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
      onMount={onMount}
    />
  );
}
