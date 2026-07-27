import { DiffEditor } from "@monaco-editor/react";

import { useI18n } from "../i18n/i18n";
import { useMonacoEditorReady } from "../use-monaco-editor-ready";
import { estimateDiffEditorContentHeightPx } from "./estimate-diff-editor-content-height";
import type {
  WorkspaceChangeKind,
  WorkspaceDiffContent,
} from "./workspace-commands";

/**
 * Diff 渲染所需的最小输入契约：加载 / 错误 / 空 / diff 四态字段。
 * agent 会话变更面板与代码工作区变更页共用本渲染件，各自只负责产出该结构。
 */
export interface WorkspaceDiffTab {
  fileName: string;
  filePath: string;
  diff: WorkspaceDiffContent | null;
  isLoading: boolean;
  errorMessage: string | null;
}

interface DiffViewerProps {
  /** null 表示尚未选中变更文件，渲染空态提示。 */
  tab: WorkspaceDiffTab | null;
  /** 是否显示顶部 kind + path 状态条；多 diff 面板头已含路径时传 false。默认 true。 */
  showStatusBar?: boolean;
  /**
   * 高度模式：
   * - `fill`（默认）：`height: 100%` 填满父级（单文件 diff）
   * - `content`：按行数 × 字号推算像素高度（multi-diff 内容撑开）
   */
  heightMode?: "fill" | "content";
}

const CHANGE_KIND_KEY: Record<WorkspaceChangeKind, string> = {
  added: "agentsFeature.changeKindAdded",
  untracked: "agentsFeature.changeKindAdded",
  deleted: "agentsFeature.changeKindDeleted",
  renamed: "agentsFeature.changeKindRenamed",
  copied: "agentsFeature.changeKindCopied",
  binary: "agentsFeature.changeKindBinary",
  modified: "agentsFeature.changeKindModified",
};

export function DiffViewer({
  tab,
  showStatusBar = true,
  heightMode = "fill",
}: DiffViewerProps) {
  const { messages, t, contentFontSize, theme } = useI18n();
  const isMonacoReady = useMonacoEditorReady();

  if (!tab) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.selectChangedFile}
      </p>
    );
  }

  if (tab.isLoading) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.loadingDiff}
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

  if (!tab.diff) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.selectChangedFile}
      </p>
    );
  }

  if (tab.diff.isBinary || tab.diff.isTooLarge) {
    return (
      <section
        className="session-viewer-state"
        aria-label={messages.agentsFeature.diffUnavailable}
      >
        <h3>{tab.fileName}</h3>
        <p>
          {tab.diff.isBinary
            ? messages.agentsFeature.binaryPreviewUnavailable
            : messages.agentsFeature.largeFilePreviewUnavailable}
        </p>
      </section>
    );
  }

  if (!isMonacoReady) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.loadingDiff}
      </p>
    );
  }

  const editorHeight =
    heightMode === "content"
      ? `${estimateDiffEditorContentHeightPx(
          tab.diff.originalContent,
          tab.diff.modifiedContent,
          contentFontSize,
        )}px`
      : "100%";

  return (
    <section
      aria-label={messages.agentsFeature.diffView(tab.fileName)}
      className={
        showStatusBar
          ? "session-diff-viewer"
          : "session-diff-viewer session-diff-viewer--bare"
      }
      style={heightMode === "content" ? { height: editorHeight } : undefined}
    >
      {showStatusBar ? (
        <div className="session-diff-viewer__status">
          {t(CHANGE_KIND_KEY[tab.diff.kind])} {tab.filePath}
        </div>
      ) : null}
      <DiffEditor
        height={editorHeight}
        theme={theme === "dark" ? "vs-dark" : "light"}
        language={tab.diff.language ?? undefined}
        modified={tab.diff.modifiedContent}
        original={tab.diff.originalContent}
        options={{
          fontSize: contentFontSize,
          minimap: { enabled: false },
          readOnly: true,
          renderSideBySide:
            tab.diff.kind !== "added" && tab.diff.kind !== "untracked",
          scrollBeyondLastLine: false,
          ...(heightMode === "content"
            ? {
                scrollbar: {
                  vertical: "hidden" as const,
                  handleMouseWheel: false,
                },
                overviewRulerLanes: 0,
              }
            : {}),
        }}
      />
    </section>
  );
}
