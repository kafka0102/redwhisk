import {
  isCommandError,
  toCommandError,
} from "../../../shared/commands/command-error";

/**
 * TUI resume 失败后允许手动重试的 reason 白名单。
 * 门禁类 / closed / 不支持 等不在此列，不展示重试。
 */
export const TUI_RESUME_RETRYABLE_REASONS = new Set<string>([
  "missingResumeSessionId",
  "workspaceMissingForResume",
  "tuiResumeSpawnFailed",
]);

export function isTuiResumeRetryableReason(
  reason: string | undefined,
): boolean {
  return reason != null && TUI_RESUME_RETRYABLE_REASONS.has(reason);
}

export function getTuiResumeErrorReason(error: unknown): string | undefined {
  if (isCommandError(error) || (error && typeof error === "object")) {
    return toCommandError(error).reason;
  }
  return undefined;
}

export function shouldAutoResumeTuiSession(input: {
  isActive: boolean;
  sessionStatus: string | undefined;
  issueStatus: string | null | undefined;
  supportsTuiResume: boolean;
  isPtyActive: boolean;
}): boolean {
  if (!input.isActive) {
    return false;
  }
  if (input.sessionStatus === "closed") {
    return false;
  }
  if (input.issueStatus !== "running" && input.issueStatus !== "review") {
    return false;
  }
  if (!input.supportsTuiResume) {
    return false;
  }
  if (input.isPtyActive) {
    return false;
  }
  return true;
}
