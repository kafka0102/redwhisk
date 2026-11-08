import { useState, type JSX } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { useI18n } from "../../shared/i18n/i18n";
import { ChangeRequestDetailChecks } from "./change-request-detail-checks";
import { ChangeRequestDetailDiscussion } from "./change-request-detail-discussion";
import { ChangeRequestDetailFiles } from "./change-request-detail-files";
import { ChangeRequestDetailHeader } from "./change-request-detail-header";
import { ChangeRequestDetailMerge } from "./change-request-detail-merge";
import { ChangeRequestDetailOverview } from "./change-request-detail-overview";
import { ChangeRequestDetailTabs } from "./change-request-detail-tabs";
import type { ChangeRequestDetailTab } from "./change-request-detail-model";
import { hostLabel } from "./change-request-detail-model";
import { useChangeRequestDetail } from "./use-change-request-detail";

export function ChangeRequestDetailPage({
  projectId,
  provider,
  number,
  onBack,
}: {
  projectId: number;
  provider: string;
  number: number;
  onBack: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const { detail } = useChangeRequestDetail({ projectId, provider, number });
  const [tab, setTab] = useState<ChangeRequestDetailTab>("overview");
  if (detail == null) {
    return (
      <section className="change-request-detail" aria-busy="true">
        <p>{t("issues.changeRequests.loadingDetail")}</p>
      </section>
    );
  }
  return (
    <section
      className="change-request-detail"
      aria-label={t("issues.changeRequests.detailRegion")}
    >
      <ChangeRequestDetailHeader detail={detail} onBack={onBack} />
      {detail.detailStatus === "unavailable" ? (
        <p role="status">{t("issues.changeRequests.detailUnavailable")}</p>
      ) : null}
      {detail.detailStatus === "cached" ? (
        <p role="status">{t("issues.changeRequests.detailCached")}</p>
      ) : null}
      {detail.detailStatus === "unavailable" ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void openUrl(detail.url);
          }}
        >
          {t("issues.changeRequests.openOnHost", {
            host: hostLabel(detail.provider),
          })}
        </Button>
      ) : null}
      <ChangeRequestDetailTabs detail={detail} tab={tab} onTabChange={setTab} />
      <div className="change-request-detail__grid">
        <div>
          {tab === "overview" ? (
            <ChangeRequestDetailOverview detail={detail} />
          ) : null}
          {tab === "files" ? (
            <ChangeRequestDetailFiles detail={detail} />
          ) : null}
          {tab === "checks" ? (
            <ChangeRequestDetailChecks detail={detail} />
          ) : null}
          {tab === "discussion" ? (
            <ChangeRequestDetailDiscussion detail={detail} />
          ) : null}
        </div>
        <aside>
          <ChangeRequestDetailMerge detail={detail} />
        </aside>
      </div>
    </section>
  );
}
