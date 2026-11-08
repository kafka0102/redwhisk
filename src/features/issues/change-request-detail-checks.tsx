import type { JSX } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { useI18n } from "../../shared/i18n/i18n";
import type { ChangeRequestDetail } from "./change-request-commands";
import {
  checkCounts,
  formatDurationMs,
  sortedChecks,
} from "./change-request-detail-model";

export function ChangeRequestDetailChecks({
  detail,
}: {
  detail: ChangeRequestDetail;
}): JSX.Element {
  const { t } = useI18n();
  const counts = checkCounts(detail.checks);
  const summary =
    counts.failed > 0
      ? {
          text: t("issues.changeRequests.checksFailedSummary", {
            count: counts.failed,
          }),
          tone: "danger",
        }
      : counts.pending > 0
        ? {
            text: t("issues.changeRequests.checksPendingSummary", {
              count: counts.pending,
            }),
            tone: "warning",
          }
        : {
            text: t("issues.changeRequests.checksPassedSummary"),
            tone: "success",
          };
  return (
    <section className="change-request-panel">
      <div className="change-request-panel__header">
        <h3>{t("issues.changeRequests.checksTab")}</h3>
        <span
          className={`change-request-chip change-request-chip--${summary.tone}`}
        >
          {summary.text}
        </span>
      </div>
      <ul className="change-request-check-list">
        {sortedChecks(detail.checks).map((check) => (
          <li key={check.name} className="change-request-check-row">
            <div>
              <p>{check.name}</p>
              <p
                className={`change-request-check-status change-request-check-status--${check.status}`}
              >
                {statusLabel(check.status, t)}
                {formatDurationMs(check.durationMs)
                  ? ` · ${formatDurationMs(check.durationMs)}`
                  : ""}
              </p>
            </div>
            {check.logUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void openUrl(check.logUrl ?? "");
                }}
              >
                {t("issues.changeRequests.openLogs")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function statusLabel(status: string, t: (key: string) => string): string {
  if (status === "failed") {
    return t("issues.changeRequests.checkFailed");
  }
  if (status === "pending") {
    return t("issues.changeRequests.checkPending");
  }
  if (status === "passed") {
    return t("issues.changeRequests.checkPassed");
  }
  return status;
}
