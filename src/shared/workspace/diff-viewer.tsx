import { DiffEditor } from "@monaco-editor/react";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { useI18n } from "../i18n/i18n";
import { useMonacoEditorReady } from "../use-monaco-editor-ready";
import { getDiffAvailability } from "./diff-availability";
import { estimateDiffEditorContentHeightPx } from "./estimate-diff-editor-content-height";
import {
  isSvgDiffTextSwitchable,
  visualPreviewMimeType,
  type SvgPreviewView,
} from "./visual-file-preview-model";
import { VisualFilePreview } from "./visual-file-preview";
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

function SvgDiffTextToggle({
  filePath,
  mode,
  label,
  onToggle,
}: {
  filePath: string;
  mode: SvgPreviewView;
  label: string;
  onToggle: (filePath: string, mode: SvgPreviewView) => void;
}) {
  return (
    <button
      type="button"
      className="code-workspace__markdown-toggle"
      aria-label={label}
      aria-pressed={mode === "image"}
      onClick={() => onToggle(filePath, mode === "image" ? "text" : "image")}
    >
      {mode === "image" ? (
        <EyeOff aria-hidden="true" size={14} strokeWidth={1.9} />
      ) : (
        <Eye aria-hidden="true" size={14} strokeWidth={1.9} />
      )}
    </button>
  );
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
  const availability = getDiffAvailability(tab);
  const [svgView, setSvgView] = useState<{
    filePath: string;
    mode: SvgPreviewView;
  } | null>(null);

  if (availability.kind === "none") {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.selectChangedFile}
      </p>
    );
  }

  if (availability.kind === "loading") {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.loadingDiff}
      </p>
    );
  }

  if (availability.kind === "error") {
    return (
      <p className="session-viewer-state" role="alert">
        {availability.message}
      </p>
    );
  }

  if (availability.kind === "unavailable") {
    return (
      <section
        className="session-viewer-state"
        aria-label={messages.agentsFeature.diffUnavailable}
      >
        <h3>{availability.fileName}</h3>
        <p>
          {availability.isTooLarge
            ? messages.agentsFeature.largeFilePreviewUnavailable
            : messages.agentsFeature.binaryPreviewUnavailable}
        </p>
      </section>
    );
  }

  const previewDiff = availability.kind === "content" ? tab?.diff : null;
  const activeSvgView =
    svgView?.filePath === previewDiff?.filePath ? svgView : null;
  const svgViewMode = activeSvgView?.mode ?? "image";
  const showVisual =
    previewDiff?.previewKind != null &&
    !previewDiff.isTooLarge &&
    !(isSvgDiffTextSwitchable(previewDiff) && svgViewMode === "text");

  if (showVisual && previewDiff?.previewKind) {
    const kind = previewDiff.previewKind;
    const mimeType = visualPreviewMimeType(previewDiff.filePath, kind);
    const sides = [
      previewDiff.originalPreviewBytesBase64.length > 0
        ? {
            bytes: previewDiff.originalPreviewBytesBase64,
            label: messages.agentsFeature.diffPreviewBefore,
          }
        : null,
      previewDiff.modifiedPreviewBytesBase64.length > 0
        ? {
            bytes: previewDiff.modifiedPreviewBytesBase64,
            label: messages.agentsFeature.diffPreviewAfter,
          }
        : null,
    ].filter((side) => side != null);
    const canSwitchText = isSvgDiffTextSwitchable(previewDiff);

    return (
      <section
        aria-label={messages.agentsFeature.diffView(availability.fileName)}
        className={
          showStatusBar
            ? "session-diff-viewer"
            : "session-diff-viewer session-diff-viewer--bare"
        }
      >
        {showStatusBar || canSwitchText ? (
          <div className="session-diff-viewer__status">
            {showStatusBar ? (
              <span>
                {t(CHANGE_KIND_KEY[previewDiff.kind])} {availability.filePath}
              </span>
            ) : (
              <span />
            )}
            {canSwitchText ? (
              <SvgDiffTextToggle
                filePath={previewDiff.filePath}
                label={messages.agentsFeature.toggleSvgPreview}
                mode={svgViewMode}
                onToggle={(filePath, mode) => setSvgView({ filePath, mode })}
              />
            ) : null}
          </div>
        ) : null}
        <div
          className={
            sides.length > 1
              ? "visual-diff-preview"
              : "visual-diff-preview visual-diff-preview--single"
          }
        >
          {sides.map((side) => (
            <figure className="visual-diff-preview__side" key={side.label}>
              <figcaption>{side.label}</figcaption>
              <VisualFilePreview
                bytesBase64={side.bytes}
                failureMessage={messages.agentsFeature.visualPreviewLoadFailed}
                kind={kind}
                label={side.label}
                mimeType={mimeType}
              />
            </figure>
          ))}
        </div>
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

  const { diff, fileName, filePath } = availability;
  const editorHeight =
    heightMode === "content"
      ? `${estimateDiffEditorContentHeightPx(
          diff.originalContent,
          diff.modifiedContent,
          contentFontSize,
        )}px`
      : "100%";

  return (
    <section
      aria-label={messages.agentsFeature.diffView(fileName)}
      className={
        showStatusBar
          ? "session-diff-viewer"
          : "session-diff-viewer session-diff-viewer--bare"
      }
      style={heightMode === "content" ? { height: editorHeight } : undefined}
    >
      {showStatusBar || isSvgDiffTextSwitchable(diff) ? (
        <div className="session-diff-viewer__status">
          {showStatusBar ? (
            <span>
              {t(CHANGE_KIND_KEY[diff.kind])} {filePath}
            </span>
          ) : (
            <span />
          )}
          {isSvgDiffTextSwitchable(diff) ? (
            <SvgDiffTextToggle
              filePath={diff.filePath}
              label={messages.agentsFeature.toggleSvgPreview}
              mode={svgViewMode}
              onToggle={(filePath, mode) => setSvgView({ filePath, mode })}
            />
          ) : null}
        </div>
      ) : null}
      <DiffEditor
        height={editorHeight}
        theme={theme === "dark" ? "vs-dark" : "light"}
        language={diff.language ?? undefined}
        modified={diff.modifiedContent}
        original={diff.originalContent}
        options={{
          fontSize: contentFontSize,
          minimap: { enabled: false },
          readOnly: true,
          renderSideBySide: diff.kind !== "added" && diff.kind !== "untracked",
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
