export interface RelativeTimeFormatter {
  justNow: string;
  minutesAgo: (minutes: number) => string;
  hoursAgo: (hours: number) => string;
  daysAgo: (days: number) => string;
  monthsAgo: (months: number) => string;
  yearsAgo: (years: number) => string;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 12 * MONTH;

export function formatRelativeTime(
  timestampMs: number,
  formatter: RelativeTimeFormatter,
  nowMs: number = Date.now(),
): string {
  const elapsedMs = Math.max(0, nowMs - timestampMs);
  if (elapsedMs < MINUTE) {
    return formatter.justNow;
  }
  if (elapsedMs < HOUR) {
    return formatter.minutesAgo(Math.floor(elapsedMs / MINUTE));
  }
  if (elapsedMs < DAY) {
    return formatter.hoursAgo(Math.floor(elapsedMs / HOUR));
  }
  if (elapsedMs < MONTH) {
    return formatter.daysAgo(Math.floor(elapsedMs / DAY));
  }
  if (elapsedMs < YEAR) {
    return formatter.monthsAgo(Math.floor(elapsedMs / MONTH));
  }
  return formatter.yearsAgo(Math.floor(elapsedMs / YEAR));
}
