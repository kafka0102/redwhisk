/** 签出分支列表相对时间（分钟/小时/天/月）。 */
export function formatBranchRelativeTime(
  committedAtMs: number,
  t: (key: string, options?: Record<string, unknown>) => string,
  nowMs: number = Date.now(),
): string {
  const seconds = Math.max(0, Math.floor((nowMs - committedAtMs) / 1_000));
  if (seconds < 60) {
    return t("changesCheckout.justNow");
  }
  if (seconds < 3_600) {
    return t("changesCheckout.minutesAgo", {
      minutes: Math.floor(seconds / 60),
    });
  }
  if (seconds < 86_400) {
    return t("changesCheckout.hoursAgo", {
      hours: Math.floor(seconds / 3_600),
    });
  }
  if (seconds < 2_592_000) {
    return t("changesCheckout.daysAgo", {
      days: Math.floor(seconds / 86_400),
    });
  }
  return t("changesCheckout.monthsAgo", {
    months: Math.max(1, Math.floor(seconds / 2_592_000)),
  });
}
