import { Editor, type OnMount } from "@monaco-editor/react";

import { CodeMarkdownPreview } from "./code-markdown-preview";
import { useCallback, useEffect, useRef } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import type { CodeLanguageUnavailableReason } from "./code-language-commands";
import { syncCodeLanguageMarkersToModel } from "./code-language-markers";
import { toCodeLanguageFileUri } from "./code-language-uri";
import { applyCodeLanguageNavigationActions } from "./code-language-navigation-actions";
import { isCodeLanguageFile } from "./is-code-language-file";
import { useMonacoEditorReady } from "../../shared/use-monaco-editor-ready";
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
 * - 正常：Monaco Editor（按 tab.isEditable 只读/可编辑），字号跟随 `contentFontSize`，主题跟随全局 `theme`。
 * - 可选 revealRequest：打开匹配行时滚动并定位光标。
 * - 按 projectId + filePath 缓存 Monaco view state，跨 Activity 切换后恢复阅读位置。
 */
export function CodeContent({
  projectId,
  tab,
  contentFontSize,
  messages,
  theme,
  onContentChange,
  revealRequest = null,
  unavailableReason = null,
  viewMode = "source",
  workspacePath = null,
}: {
  projectId: number;
  tab: CodeFileTab;
  contentFontSize: number;
  messages: ReturnType<typeof useI18n>["messages"];
  theme: "light" | "dark";
  onContentChange?: (value: string) => void;
  revealRequest?: CodeRevealRequest | null;
  unavailableReason?: CodeLanguageUnavailableReason | null;
  viewMode?: "source" | "preview";
  workspacePath?: string | null;
}) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const appliedRevealTokenRef = useRef<number | null>(null);
  const projectIdRef = useRef(projectId);
  const filePathRef = useRef(tab.filePath);
  const isMonacoReady = useMonacoEditorReady();
  const { t } = useI18n();

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

  // 仅在磁盘加载身份变化时恢复阅读位置（静默复检/换文件/加载完成）。
  // 不可依赖 tab.content 整体：本地编辑每次改 content 字符串会误触发 restore，导致光标跳行。
  const contentLoadKey =
    tab.content == null || tab.content.isBinary || tab.content.isTooLarge
      ? null
      : `${tab.filePath}:${tab.content.sizeBytes}:${tab.content.modifiedAt ?? "na"}`;

  useEffect(() => {
    if (tab.isLoading || contentLoadKey == null) {
      return;
    }
    if (revealRequest && revealRequest.filePath === tab.filePath) {
      return;
    }
    restoreSavedViewState();
  }, [
    contentLoadKey,
    restoreSavedViewState,
    revealRequest,
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

  const isLanguageFile = isCodeLanguageFile({
    isBinary: tab.content.isBinary,
    isTooLarge: tab.content.isTooLarge,
    language: tab.content.language,
  });
  const fileUri = workspacePath
    ? toCodeLanguageFileUri(workspacePath, tab.filePath)
    : undefined;

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    if (fileUri && isLanguageFile) {
      syncCodeLanguageMarkersToModel(fileUri);
    }
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
    const navigationDisposable = applyCodeLanguageNavigationActions(editor, {
      goToDefinition: t("codeLanguage.goToDefinition"),
      findReferences: t("codeLanguage.findReferences"),
    });
    editor.onDidDispose(() => {
      scrollDisposable.dispose();
      navigationDisposable.dispose();
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

  if (!isMonacoReady) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.loadingFile}
      </p>
    );
  }

  const isReadOnly = !tab.isEditable;
  const unavailableMessage = unavailableReason
    ? t(`codeLanguage.unavailable.${unavailableReason}`)
    : null;

  return (
    <div className="code-workspace__editor-pane">
      {unavailableMessage ? (
        <p className="code-workspace__language-unavailable" role="status">
          {unavailableMessage}
        </p>
      ) : null}
      <Editor
        height="100%"
        path={fileUri}
        theme={theme === "dark" ? "vs-dark" : "light"}
        language={tab.content.language ?? undefined}
        options={{
          readOnly: isReadOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: contentFontSize,
          // 关闭词丛高亮，避免 env 等重复 token 误闪选。TS/JS 诊断来自代码根语言宿主。
          occurrencesHighlight: "off",
          selectionHighlight: false,
          renderValidationDecorations: isLanguageFile ? "on" : "off",
          gotoLocation: {
            multiple: "peek",
            multipleDefinitions: "peek",
            multipleReferences: "peek",
          },
        }}
        value={tab.content.content}
        onChange={(value) => {
          if (isReadOnly || value == null) {
            return;
          }
          onContentChange?.(value);
        }}
        onMount={onMount}
      />
    </div>
  );
}
