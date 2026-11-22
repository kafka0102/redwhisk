import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./relative-time";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const zhFormatter = {
  justNow: "刚刚",
  minutesAgo: (minutes: number) => `${minutes} 分钟前`,
  hoursAgo: (hours: number) => `${hours} 小时前`,
  daysAgo: (days: number) => `${days} 天前`,
  monthsAgo: (months: number) => `${months} 个月前`,
  yearsAgo: (years: number) => `${years} 年前`,
};

function formatElapsed(elapsedMs: number): string {
  return formatRelativeTime(NOW - elapsedMs, zhFormatter, NOW);
}

describe("formatRelativeTime", () => {
  it("uses fixed floors for the minute and hour buckets", () => {
    expect(formatElapsed(0)).toBe("刚刚");
    expect(formatElapsed(59 * SECOND)).toBe("刚刚");
    expect(formatElapsed(MINUTE)).toBe("1 分钟前");
    expect(formatElapsed(59 * MINUTE)).toBe("59 分钟前");
    expect(formatElapsed(HOUR - SECOND)).toBe("59 分钟前");
    expect(formatElapsed(HOUR)).toBe("1 小时前");
    expect(formatElapsed(23 * HOUR)).toBe("23 小时前");
    expect(formatElapsed(DAY - SECOND)).toBe("23 小时前");
  });

  it("uses fixed floors for day, month, and year boundaries", () => {
    expect(formatElapsed(DAY)).toBe("1 天前");
    expect(formatElapsed(29 * DAY)).toBe("29 天前");
    expect(formatElapsed(30 * DAY)).toBe("1 个月前");
    expect(formatElapsed(359 * DAY)).toBe("11 个月前");
    expect(formatElapsed(360 * DAY)).toBe("1 年前");
    expect(formatElapsed(719 * DAY)).toBe("1 年前");
    expect(formatElapsed(720 * DAY)).toBe("2 年前");
  });

  it("clamps future timestamps to just now", () => {
    expect(formatElapsed(-MINUTE)).toBe("刚刚");
  });
});
