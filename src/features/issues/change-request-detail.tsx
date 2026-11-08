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
import { ChangeRequestActionDialogs } from "./change-request-detail-actions";
import type { ChangeRequestDetailTab } from "./change-request-detail-model";
import { hostLabel } from "./change-request-detail-model";
import { useChangeRequestDetail } from "./use-change-request-detail";
import { useChangeRequestActions } from "./use-change-request-actions";
import type { ChangeRequestDetail } from "./change-request-commands";

export function ChangeRequestDetailPage({
  projectId,
  provider,
  number,
  onBack,
  onOpenIssue,
}: {
  projectId: number;
  provider: string;
  number: number;
  onBack: () => void;
  onOpenIssue?: (issueId: number) => void;
}): JSX.Element {
  const { t } = useI18n();
  const { detail, setDetail } = useChangeRequestDetail({
    projectId,
    provider,
    number,
  });
  if (detail == null) {
    return (
      <section className="change-request-detail" aria-busy="true">
        <p>{t("issues.changeRequests.loadingDetail")}</p>
      </section>
    );
  }
  return (
    <ChangeRequestDetailLoaded
      projectId={projectId}
      provider={provider}
      number={number}
      detail={detail}
      setDetail={setDetail}
      onBack={onBack}
      onOpenIssue={onOpenIssue}
    />
  );
}

function ChangeRequestDetailLoaded({
  projectId,
  provider,
  number,
  detail,
  setDetail,
  onBack,
  onOpenIssue,
}: {
  projectId: number;
  provider: string;
  number: number;
  detail: ChangeRequestDetail;
  setDetail: (detail: ChangeRequestDetail) => void;
  onBack: () => void;
  onOpenIssue?: (issueId: number) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<ChangeRequestDetailTab>("overview");
  const actions = useChangeRequestActions({
    projectId,
    provider,
    number,
    detail,
    setDetail,
  });
  return (
    <section
      className="change-request-detail"
      aria-label={t("issues.changeRequests.detailRegion")}
    >
      <ChangeRequestDetailHeader
        detail={detail}
        pending={actions.pending}
        onBack={onBack}
        onMarkReady={actions.markReady}
        onRequestReview={actions.openReview}
        onClose={actions.openClose}
      />
      {actions.error == null ? null : <p role="alert">{actions.error}</p>}
      <ChangeRequestActionDialogs
        dialog={actions.dialog}
        error={actions.dialog == null ? null : actions.error}
        reviewer={actions.reviewer}
        onReviewerChange={actions.setReviewer}
        onCancel={actions.cancel}
        onSubmitReview={actions.submitReview}
        onConfirmClose={actions.confirmClose}
      />
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
            <ChangeRequestDetailOverview
              detail={detail}
              onOpenIssue={onOpenIssue}
            />
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
          <ChangeRequestDetailMerge
            projectId={projectId}
            detail={detail}
            onDetail={setDetail}
          />
        </aside>
      </div>
    </section>
  );
}
