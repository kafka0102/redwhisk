import type { TFunction } from "i18next";

import { formatRelativeTime } from "../../shared/time/relative-time";
import type { ChangeRequestListRow } from "./change-request-commands";

export type ChangeRequestTone = "danger" | "warning" | "success" | "muted";

export function changeRequestCheck(
  row: ChangeRequestListRow,
  t: TFunction,
): { text: string; tone: ChangeRequestTone } {
  return changeRequestChecksSummary(
    row.checksOk,
    row.checksFailed,
    row.checksPending,
    t,
  );
}

export function changeRequestChecksSummary(
  checksOk: number | null,
  checksFailed: number | null,
  checksPending: number | null,
  t: TFunction,
): { text: string; tone: ChangeRequestTone } {
  if (checksOk == null || checksFailed == null || checksPending == null) {
    return { text: t("issues.changeRequests.checksUnknown"), tone: "muted" };
  }
  if (checksFailed > 0) {
    return {
      text: t("issues.changeRequests.checksRatio", {
        ok: checksOk,
        total: checksOk + checksFailed,
      }),
      tone: "danger",
    };
  }
  if (checksPending > 0) {
    return {
      text: t("issues.changeRequests.checksPending", {
        ok: checksOk,
        pending: checksPending,
      }),
      tone: "warning",
    };
  }
  return {
    text: t("issues.changeRequests.checksRatio", {
      ok: checksOk,
      total: checksOk,
    }),
    tone: "success",
  };
}

export function changeRequestReview(
  row: ChangeRequestListRow,
  t: TFunction,
): { text: string; tone: ChangeRequestTone } {
  switch (row.reviewDecision) {
    case "approved":
      return { text: t("issues.changeRequests.approved"), tone: "success" };
    case "changes_requested":
      return {
        text: t("issues.changeRequests.changesRequested"),
        tone: "danger",
      };
    case "review_required":
      return {
        text: t("issues.changeRequests.reviewRequired"),
        tone: "warning",
      };
    case "pending":
      if ((row.checksPending ?? 0) > 0) {
        return {
          text: t("issues.changeRequests.waitingForChecks"),
          tone: "muted",
        };
      }
      return { text: t("issues.changeRequests.reviewUnknown"), tone: "muted" };
    default:
      return { text: t("issues.changeRequests.reviewUnknown"), tone: "muted" };
  }
}

export function changeRequestTime(
  remoteUpdatedAt: number,
  now: number,
  t: TFunction,
): string {
  return formatRelativeTime(
    remoteUpdatedAt,
    {
      justNow: t("issues.changeRequests.justNow"),
      minutesAgo: (minutes) =>
        t(
          minutes === 1
            ? "issues.changeRequests.minuteAgo"
            : "issues.changeRequests.minutesAgo",
          { count: minutes },
        ),
      hoursAgo: (hours) =>
        t(
          hours === 1
            ? "issues.changeRequests.hourAgo"
            : "issues.changeRequests.hoursAgo",
          { count: hours },
        ),
      daysAgo: (days) =>
        t(
          days === 1
            ? "issues.changeRequests.dayAgo"
            : "issues.changeRequests.daysAgo",
          { count: days },
        ),
      monthsAgo: (months) =>
        t(
          months === 1
            ? "issues.changeRequests.monthAgo"
            : "issues.changeRequests.monthsAgo",
          { count: months },
        ),
      yearsAgo: (years) =>
        t(
          years === 1
            ? "issues.changeRequests.yearAgo"
            : "issues.changeRequests.yearsAgo",
          { count: years },
        ),
    },
    now,
  );
}
