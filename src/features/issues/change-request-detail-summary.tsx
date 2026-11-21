import type { JSX } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import type { ChangeRequestDetail } from "./change-request-commands";

export function ChangeRequestDetailSummary({
  detail,
}: {
  detail: ChangeRequestDetail;
}): JSX.Element {
  const { t } = useI18n();
  const showChanges = detail.additions != null || detail.deletions != null;
  return (
    <section
      className="change-request-panel"
      aria-label={t("issues.changeRequests.summary")}
    >
      <h3>{t("issues.changeRequests.summary")}</h3>
      <dl className="change-request-summary">
        <div>
          <dt>{t("issues.changeRequests.mergeStatus")}</dt>
          <dd>
            <span
              className={`change-request-state-chip change-request-state-chip--${detail.state}`}
            >
              {mergeStatusLabel(detail.state, t)}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t("issues.changeRequests.branches")}</dt>
          <dd className="mono">
            {`${detail.sourceBranch} → ${detail.targetBranch}`}
          </dd>
        </div>
        {detail.authorLogin == null ? null : (
          <div>
            <dt>{t("issues.changeRequests.author")}</dt>
            <dd>{detail.authorLogin}</dd>
          </div>
        )}
        {detail.commitCount == null ? null : (
          <div>
            <dt>{t("issues.changeRequests.commits")}</dt>
            <dd>
              {t("issues.changeRequests.commitCount", {
                count: detail.commitCount,
              })}
            </dd>
          </div>
        )}
        {showChanges ? (
          <div>
            <dt>{t("issues.changeRequests.changes")}</dt>
            <dd>
              {t("issues.changeRequests.additionsDeletions", {
                additions: detail.additions ?? 0,
                deletions: detail.deletions ?? 0,
              })}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function mergeStatusLabel(state: string, t: (key: string) => string): string {
  switch (state) {
    case "open":
      return t("issues.changeRequests.open");
    case "closed":
      return t("issues.changeRequests.statusClosed");
    case "draft":
      return t("issues.changeRequests.statusDraft");
    case "merged":
      return t("issues.changeRequests.merged");
    default:
      return state;
  }
}
