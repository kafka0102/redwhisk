import type { JSX } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { useI18n } from "../../shared/i18n/i18n";
import type { ChangeRequestDetail } from "./change-request-commands";
import { hostLabel, isMerged } from "./change-request-detail-model";

export function ChangeRequestDetailHeader({
  detail,
  onBack,
}: {
  detail: ChangeRequestDetail;
  onBack: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const host = hostLabel(detail.provider);
  const merged = isMerged(detail.state);
  return (
    <header className="change-request-detail__header">
      <div className="change-request-detail__heading">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          {t("issues.changeRequests.backToList")}
        </Button>
        <div>
          <h2>
            #{detail.number} · {detail.title}
          </h2>
          <p className="change-request-detail__sub">
            <span
              className={`change-request-state-chip change-request-state-chip--${detail.state}`}
            >
              {detail.state}
            </span>
            <span className="mono">{detail.sourceBranch}</span>
            <span>→</span>
            <span className="mono">{detail.targetBranch}</span>
            {detail.authorLogin ? <span>{detail.authorLogin}</span> : null}
            {detail.commitCount == null ? null : (
              <span>
                {t("issues.changeRequests.commitCount", {
                  count: detail.commitCount,
                })}
              </span>
            )}
            {detail.additions == null && detail.deletions == null ? null : (
              <span>
                {t("issues.changeRequests.additionsDeletions", {
                  additions: detail.additions ?? 0,
                  deletions: detail.deletions ?? 0,
                })}
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="change-request-detail__actions">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void openUrl(detail.url);
          }}
        >
          {t("issues.changeRequests.openOnHost", { host })}
        </Button>
        {merged ? null : (
          <>
            <Button type="button" variant="secondary" size="sm" disabled>
              {t("issues.changeRequests.markReady")}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled>
              {t("issues.changeRequests.requestReview")}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled>
              {t("issues.changeRequests.close")}
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
