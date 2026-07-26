import {
  getCommandErrorMessage,
  toCommandError,
} from "../../shared/commands/command-error";
import { type useI18n } from "../../shared/i18n/i18n";
import type { CodeFileTab } from "./code-workspace-cache";

/** 工作区文件不可访问 / 不是文件 / 读取失败等「文件缺失」类错误原因集合。 */
export const MISSING_FILE_ERROR_REASONS = new Set([
  "filePathInaccessible",
  "pathNotFile",
  "workspaceFileReadFailed",
]);

/** 文件加载失败时解析用户可见错误信息：缺失类用统一文案，其它走 command error 文案。 */
export function resolveFileLoadErrorMessage(
  error: unknown,
  fileNotFoundMessage: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (isMissingWorkspaceFileError(error)) {
    return fileNotFoundMessage;
  }
  return getCommandErrorMessage(error, t);
}

/** 判断错误是否属于「工作区文件缺失」类（用于统一展示「文件不存在」文案）。 */
export function isMissingWorkspaceFileError(error: unknown): boolean {
  const reason = toCommandError(error).reason;
  return reason != null && MISSING_FILE_ERROR_REASONS.has(reason);
}

/** 当前 tab 是否可显示 markdown 源码/预览切换（语言为 markdown 且文本已成功加载）。 */
export function isMarkdownPreviewable(tab: CodeFileTab): boolean {
  if (tab.isLoading || tab.errorMessage || !tab.content) {
    return false;
  }
  if (tab.content.isBinary || tab.content.isTooLarge) {
    return false;
  }
  return tab.content.language === "markdown";
}

/** 当前 tab 是否允许进入轻量可编辑态（已成功加载的可预览文本）。 */
export function canEditCodeFileTab(tab: CodeFileTab): boolean {
  if (tab.isLoading || tab.errorMessage || !tab.content) {
    return false;
  }
  if (tab.content.isBinary || tab.content.isTooLarge) {
    return false;
  }
  return true;
}

/** 编辑按钮禁用原因；可编辑时返回 null。 */
export type CodeFileEditBlockReason =
  | "loading"
  | "unavailable"
  | "binary"
  | "tooLarge";

export function getCodeFileEditBlockReason(
  tab: CodeFileTab,
): CodeFileEditBlockReason | null {
  if (canEditCodeFileTab(tab)) {
    return null;
  }
  if (tab.isLoading) {
    return "loading";
  }
  if (tab.content?.isBinary) {
    return "binary";
  }
  if (tab.content?.isTooLarge) {
    return "tooLarge";
  }
  return "unavailable";
}

/** 兼容旧缓存：补齐 isDirty / isEditable / savedContent。 */
export function normalizeCodeFileTab(tab: CodeFileTab): CodeFileTab {
  return {
    ...tab,
    isDirty: tab.isDirty ?? false,
    isEditable: tab.isEditable ?? false,
    savedContent:
      tab.savedContent ?? (tab.isDirty ? null : (tab.content?.content ?? null)),
  };
}

/** 按 lastActiveAt 选出 LRU 淘汰候选（优先非当前激活）。 */
export function pickLruVictimPath(
  tabs: CodeFileTab[],
  previousActivePath: string | null,
  maxTabs: number,
): string | null {
  if (tabs.length < maxTabs) {
    return null;
  }
  return (
    tabs
      .filter((candidate) => candidate.filePath !== previousActivePath)
      .sort((left, right) => left.lastActiveAt - right.lastActiveAt)[0]
      ?.filePath ?? null
  );
}

/** 编辑按钮禁用原因对应的 title 文案。 */
export function resolveEditDisabledTitle(
  reason: CodeFileEditBlockReason | null,
  agentsFeature: {
    fileEditDisabledBinary: string;
    fileEditDisabledLoading: string;
    fileEditDisabledTooLarge: string;
    fileEditDisabledUnavailable: string;
  },
): string | undefined {
  switch (reason) {
    case "loading":
      return agentsFeature.fileEditDisabledLoading;
    case "binary":
      return agentsFeature.fileEditDisabledBinary;
    case "tooLarge":
      return agentsFeature.fileEditDisabledTooLarge;
    case "unavailable":
      return agentsFeature.fileEditDisabledUnavailable;
    default:
      return undefined;
  }
}
