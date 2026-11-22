import { formatRelativeTime } from "../../shared/time/relative-time";

/** 签出分支列表相对时间（分钟/小时/天/月/年）。 */
export function formatBranchRelativeTime(
  committedAtMs: number,
  t: (key: string, options?: Record<string, unknown>) => string,
  nowMs: number = Date.now(),
): string {
  return formatRelativeTime(
    committedAtMs,
    {
      justNow: t("changesCheckout.justNow"),
      minutesAgo: (minutes) => t("changesCheckout.minutesAgo", { minutes }),
      hoursAgo: (hours) => t("changesCheckout.hoursAgo", { hours }),
      daysAgo: (days) => t("changesCheckout.daysAgo", { days }),
      monthsAgo: (months) => t("changesCheckout.monthsAgo", { months }),
      yearsAgo: (years) => t("changesCheckout.yearsAgo", { years }),
    },
    nowMs,
  );
}
