import type { TFunction } from "i18next";

import type { ChangeRequestListRow } from "./change-request-commands";

export type ChangeRequestTone = "danger" | "warning" | "success" | "muted";

const SHANGHAI_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

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
  const day = SHANGHAI_DAY.format(remoteUpdatedAt);
  const today = SHANGHAI_DAY.format(now);
  if (day !== today) {
    const yesterday = SHANGHAI_DAY.format(now - 24 * 60 * 60 * 1000);
    if (day === yesterday) {
      return t("issues.changeRequests.yesterday");
    }
  }
  const elapsed = Math.max(0, now - remoteUpdatedAt);
  if (elapsed < 60 * 60 * 1000) {
    return t("issues.changeRequests.minutesAgo", {
      count: Math.floor(elapsed / 60000),
    });
  }
  return t("issues.changeRequests.hoursAgo", {
    count: Math.floor(elapsed / 3600000),
  });
}
