import type { WorkspaceDiffTab } from "./diff-viewer";
import type { WorkspaceDiffContent } from "./workspace-commands";

/**
 * diff 面板当前的渲染状态：
 * - `none`：未选中变更文件，或还没有 diff 内容
 * - `loading`：正在取数
 * - `error`：取数失败，文案在 `message`
 * - `unavailable`：二进制 / 过大文件不可预览
 * - `content`：有可渲染的原 / 新内容
 */
export type WorkspaceDiffAvailability =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unavailable"; fileName: string; isBinary: boolean }
  | {
      kind: "content";
      fileName: string;
      filePath: string;
      diff: WorkspaceDiffContent;
    };

/**
 * 判定 diff 面板状态。详情视图与摘要视图共用本判定，保证加载 / 错误 /
 * 不可预览 / 无内容四态在两个视图里语义一致。
 */
export function getDiffAvailability(
  tab: WorkspaceDiffTab | null,
): WorkspaceDiffAvailability {
  if (!tab) {
    return { kind: "none" };
  }
  if (tab.isLoading) {
    return { kind: "loading" };
  }
  if (tab.errorMessage) {
    return { kind: "error", message: tab.errorMessage };
  }
  if (!tab.diff) {
    return { kind: "none" };
  }
  if (tab.diff.isBinary || tab.diff.isTooLarge) {
    return {
      kind: "unavailable",
      fileName: tab.fileName,
      isBinary: tab.diff.isBinary,
    };
  }
  return {
    kind: "content",
    fileName: tab.fileName,
    filePath: tab.filePath,
    diff: tab.diff,
  };
}
