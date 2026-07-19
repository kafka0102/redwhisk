import { Editor, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import type { CodeFileTab } from "./code-workspace-cache";

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
 */
export function CodeContent({
  tab,
  contentFontSize,
  messages,
  theme,
  revealRequest = null,
}: {
  tab: CodeFileTab;
  contentFontSize: number;
  messages: ReturnType<typeof useI18n>["messages"];
  theme: "light" | "dark";
  revealRequest?: CodeRevealRequest | null;
}) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const applyReveal = (lineNumber: number) => {
    const editor = editorRef.current;
    if (!editor || lineNumber < 1) return;
    editor.revealLineInCenter(lineNumber);
    editor.setPosition({ lineNumber, column: 1 });
    editor.focus();
  };

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
    applyReveal(revealRequest.lineNumber);
  }, [revealRequest, tab.content, tab.filePath, tab.isLoading]);

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
      applyReveal(revealRequest.lineNumber);
    }
  };

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
