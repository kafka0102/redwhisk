import { Editor } from "@monaco-editor/react";

import { useI18n } from "../../shared/i18n/i18n";
import type { CodeFileTab } from "./code-workspace-cache";

/**
 * 文件内容渲染区：根据 tab 状态展示加载/错误/二进制/过大/正常态。
 *
 * - 加载中：loadingFile 文案。
 * - 加载失败：file-error 红色 alert（受 `resolveFileLoadErrorMessage` 解析的 errorMessage 驱动）。
 * - 二进制或过大：占位提示，不进入 Monaco。
 * - 正常：Monaco 只读 Editor，字号跟随 `contentFontSize`，主题跟随全局 `theme`。
 */
export function CodeContent({
  tab,
  contentFontSize,
  messages,
  theme,
}: {
  tab: CodeFileTab;
  contentFontSize: number;
  messages: ReturnType<typeof useI18n>["messages"];
  theme: "light" | "dark";
}) {
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
    />
  );
}
