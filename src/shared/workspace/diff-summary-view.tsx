import type { TFunction } from "i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { useI18n } from "../i18n/i18n";
import { getDiffAvailability } from "./diff-availability";
import {
  computeDiffHunks,
  type DiffHunk,
  type DiffHunkLineKind,
} from "./diff-hunks";
import { DiffViewer, type WorkspaceDiffTab } from "./diff-viewer";

interface DiffSummaryViewProps {
  tab: WorkspaceDiffTab;
}

/**
 * 提交变更摘要视图的单文件面板体：把该文件按 hunk 渲染成多个可折叠部分。
 * 折叠态只存本组件内存（面板卸载即重置），不持久化、不跨提交记忆。
 * 加载 / 错误 / 二进制 / 过大 / 未选中沿用详情视图渲染件，保证两侧语义与文案一致。
 */
export function DiffSummaryView({ tab }: DiffSummaryViewProps) {
  const { t } = useI18n();
  const [collapsedHunks, setCollapsedHunks] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const availability = getDiffAvailability(tab);
  // 只有 content 态才有可切分的原 / 新全文；其余状态交回 DiffViewer 渲染。
  const diff = availability.kind === "content" ? availability.diff : null;
  const hunks = useMemo(
    () =>
      diff ? computeDiffHunks(diff.originalContent, diff.modifiedContent) : [],
    [diff],
  );

  if (availability.kind !== "content") {
    return <DiffViewer tab={tab} showStatusBar={false} heightMode="content" />;
  }

  if (hunks.length === 0) {
    return (
      <p className="session-viewer-state">
        {t("agentsFeature.diffSummaryNoContentChange")}
      </p>
    );
  }

  const toggleHunk = (index: number) => {
    setCollapsedHunks((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="diff-summary">
      {hunks.map((hunk, index) => (
        <DiffSummaryHunk
          // hunk 只按文件内容顺序定位，折叠态同样以位置为键。
          key={index}
          hunk={hunk}
          isCollapsed={collapsedHunks.has(index)}
          onToggle={() => toggleHunk(index)}
        />
      ))}
    </div>
  );
}

interface DiffSummaryHunkProps {
  hunk: DiffHunk;
  isCollapsed: boolean;
  onToggle: () => void;
}

function DiffSummaryHunk({
  hunk,
  isCollapsed,
  onToggle,
}: DiffSummaryHunkProps) {
  const { t } = useI18n();
  const hasNewLines = hunk.newCount > 0;
  const hasRemovedLines = hunk.lines.some((line) => line.kind === "removed");
  const newRangeEnd = hunk.newStart + hunk.newCount - 1;
  const oldRangeEnd = hunk.oldStart + hunk.oldCount - 1;
  // 主标签取新文件范围；纯删除 hunk 没有新侧行，改用原文件范围作为主标签。
  const mainLabel = hasNewLines
    ? formatNewLineRange(t, hunk.newStart, newRangeEnd)
    : formatOriginalLineRange(t, hunk.oldStart, oldRangeEnd);
  // 含删除行时才附原文件范围，用于对照改动前后的位置关系。
  const originalLabel =
    hasNewLines && hasRemovedLines
      ? formatOriginalLineRange(t, hunk.oldStart, oldRangeEnd)
      : null;
  const toggleLabel = isCollapsed
    ? t("agentsFeature.diffSummaryExpandHunk", { range: mainLabel })
    : t("agentsFeature.diffSummaryCollapseHunk", { range: mainLabel });

  return (
    <section className="diff-summary__hunk">
      <button
        aria-expanded={!isCollapsed}
        aria-label={toggleLabel}
        className="diff-summary__hunk-header"
        type="button"
        onClick={onToggle}
      >
        {isCollapsed ? (
          <ChevronRight aria-hidden="true" size={14} strokeWidth={1.8} />
        ) : (
          <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
        )}
        <span className="diff-summary__hunk-range">{mainLabel}</span>
        {originalLabel ? (
          <span className="diff-summary__hunk-original-range">
            {originalLabel}
          </span>
        ) : null}
      </button>
      {isCollapsed ? null : (
        <div className="diff-summary__lines">
          {hunk.lines.map((line, index) => (
            <div
              className={`diff-summary__line diff-summary__line--${line.kind}`}
              key={index}
            >
              <span className="diff-summary__line-number">
                {line.oldLineNumber ?? ""}
              </span>
              <span className="diff-summary__line-number">
                {line.newLineNumber ?? ""}
              </span>
              <span className="diff-summary__marker">
                {getLineMarker(line.kind)}
              </span>
              <span className="diff-summary__text">{line.text}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function getLineMarker(kind: DiffHunkLineKind): string {
  if (kind === "added") {
    return "+";
  }
  return kind === "removed" ? "-" : "";
}

function formatNewLineRange(t: TFunction, start: number, end: number): string {
  return start === end
    ? t("agentsFeature.diffSummaryLineLabel", { line: start })
    : t("agentsFeature.diffSummaryLineRangeLabel", { start, end });
}

function formatOriginalLineRange(
  t: TFunction,
  start: number,
  end: number,
): string {
  return start === end
    ? t("agentsFeature.diffSummaryOriginalLineLabel", { line: start })
    : t("agentsFeature.diffSummaryOriginalLineRangeLabel", { start, end });
}
