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
  decideEditorReadingPositionRestore,
  isEditorLayoutReady,
  readEditorReadingPosition,
  shouldPersistEditorReadingPosition,
  writeEditorReadingPosition,
} from "../../shared/workspace/editor-reading-position";
import {
  codeEditorReadingPositionKey,
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
 * - 按 projectId + filePath 缓存阅读位置，跨 Activity 切换后恢复（时序策略见共享 module）。
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
  const pendingRestoreRef = useRef(false);
  /** 最近一次已知布局高度：用于识别「零高度 → 真实高度」这一需要补做恢复的时刻。 */
  const layoutHeightRef = useRef(0);
  /** 已处理过的磁盘加载身份：同一身份只待恢复一次，避免重复 restore。 */
  const handledLoadKeyRef = useRef<string | null>(null);
  const isMonacoReady = useMonacoEditorReady();
  const { t } = useI18n();

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    filePathRef.current = tab.filePath;
  }, [tab.filePath]);

  const readingPositionKey = useCallback(
    () =>
      codeEditorReadingPositionKey(projectIdRef.current, filePathRef.current),
    [],
  );

  const persistReadingPosition = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // 零高度（容器尚未显示 / 布局塌陷）期间写缓存会把真实阅读位置覆盖成顶部。
    if (!shouldPersistEditorReadingPosition(editor.getLayoutInfo().height))
      return;
    const position = editor.saveViewState();
    if (!position) return;
    writeEditorReadingPosition(readingPositionKey(), position);
  }, [readingPositionKey]);

  const restoreReadingPosition = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const savedPosition = readEditorReadingPosition(readingPositionKey());
    const decision = decideEditorReadingPositionRestore({
      pending: pendingRestoreRef.current,
      layoutHeight: editor.getLayoutInfo().height,
      savedPosition,
    });
    if (decision === "wait") return;
    pendingRestoreRef.current = false;
    if (decision === "restore" && savedPosition) {
      editor.restoreViewState(savedPosition);
    }
  }, [readingPositionKey]);

  const applyReveal = useCallback(
    (lineNumber: number) => {
      const editor = editorRef.current;
      if (!editor || lineNumber < 1) return;
      editor.revealLineInCenter(lineNumber);
      editor.setPosition({ lineNumber, column: 1 });
      editor.focus();
      persistReadingPosition();
    },
    [persistReadingPosition],
  );

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
    if (handledLoadKeyRef.current === contentLoadKey) {
      return;
    }
    handledLoadKeyRef.current = contentLoadKey;
    if (revealRequest && revealRequest.filePath === tab.filePath) {
      // 定位到目标行时以 reveal 为准，不做阅读位置恢复。
      pendingRestoreRef.current = false;
      return;
    }
    pendingRestoreRef.current = true;
    restoreReadingPosition();
  }, [
    contentLoadKey,
    restoreReadingPosition,
    revealRequest,
    tab.filePath,
    tab.isLoading,
  ]);

  useEffect(() => {
    return () => {
      persistReadingPosition();
    };
  }, [persistReadingPosition, tab.filePath]);

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
    layoutHeightRef.current = editor.getLayoutInfo().height;
    handledLoadKeyRef.current = contentLoadKey;
    if (fileUri && isLanguageFile) {
      syncCodeLanguageMarkersToModel(fileUri);
    }
    if (
      revealRequest &&
      revealRequest.filePath === tab.filePath &&
      revealRequest.lineNumber >= 1
    ) {
      appliedRevealTokenRef.current = revealRequest.token;
      pendingRestoreRef.current = false;
      applyReveal(revealRequest.lineNumber);
    } else {
      pendingRestoreRef.current = true;
      restoreReadingPosition();
    }

    // 编辑器首次创建时容器仍是 display:none（布局高度 0），恢复阅读位置必须等布局就绪；
    // 布局由 0 变为真实高度时补做一次待恢复，覆盖「容器首次显示」与「隐藏后重新可见」。
    const layoutDisposable = editor.onDidLayoutChange(() => {
      const previousHeight = layoutHeightRef.current;
      const nextHeight = editor.getLayoutInfo().height;
      layoutHeightRef.current = nextHeight;
      if (
        !isEditorLayoutReady(previousHeight) &&
        isEditorLayoutReady(nextHeight)
      ) {
        pendingRestoreRef.current = true;
      }
      restoreReadingPosition();
    });
    const scrollDisposable = editor.onDidScrollChange(() => {
      persistReadingPosition();
    });
    const navigationDisposable = applyCodeLanguageNavigationActions(editor, {
      goToDefinition: t("codeLanguage.goToDefinition"),
      findReferences: t("codeLanguage.findReferences"),
    });
    editor.onDidDispose(() => {
      layoutDisposable.dispose();
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
