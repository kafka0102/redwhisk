import {
  getCommandErrorMessage,
  toCommandError,
} from "../../shared/commands/command-error";
import { type useI18n } from "../../shared/i18n/i18n";

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
