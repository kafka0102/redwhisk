import { useState, type JSX } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import { ChangeRequestActionDialogs } from "./change-request-detail-actions";
import { ChangeRequestDetailChecks } from "./change-request-detail-checks";
import { ChangeRequestDetailDiscussion } from "./change-request-detail-discussion";
import { ChangeRequestDetailFiles } from "./change-request-detail-files";
import { ChangeRequestDetailHeader } from "./change-request-detail-header";
import { ChangeRequestDetailMerge } from "./change-request-detail-merge";
import { ChangeRequestDetailOverview } from "./change-request-detail-overview";
import { ChangeRequestDetailSummary } from "./change-request-detail-summary";
import { ChangeRequestDetailTabs } from "./change-request-detail-tabs";
import type { ChangeRequestDetailTab } from "./change-request-detail-model";
import { useChangeRequestDetail } from "./use-change-request-detail";
import { useChangeRequestActions } from "./use-change-request-actions";
import type { ChangeRequestDetail } from "./change-request-commands";

export interface ChangeRequestDetailListRow {
  number: number;
  title: string;
  url: string;
  provider: string;
  state: string;
}

export function ChangeRequestDetailPage({
  projectId,
  provider,
  number,
  listRow,
  onBack,
  onOpenIssue,
}: {
  projectId: number;
  provider: string;
  number: number;
  listRow?: ChangeRequestDetailListRow;
  onBack: () => void;
  onOpenIssue?: (issueId: number) => void;
}): JSX.Element {
  const { detail, setDetail } = useChangeRequestDetail({
    projectId,
    provider,
    number,
  });
  if (detail == null) {
    return <ChangeRequestDetailLoading listRow={listRow} onBack={onBack} />;
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

function ChangeRequestDetailLoading({
  listRow,
  onBack,
}: {
  listRow?: ChangeRequestDetailListRow;
  onBack: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <section
      className="change-request-detail"
      aria-busy="true"
      aria-label={t("issues.changeRequests.detailRegion")}
    >
      {listRow == null ? null : (
        <ChangeRequestDetailHeader
          number={listRow.number}
          title={listRow.title}
          url={listRow.url}
          provider={listRow.provider}
          state={listRow.state}
          showActions={false}
          onBack={onBack}
        />
      )}
      <div className="change-request-detail__loading">
        <div className="change-request-detail__loading-box" role="status">
          {t("issues.changeRequests.loadingDetail")}
        </div>
      </div>
    </section>
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
        number={detail.number}
        title={detail.title}
        url={detail.url}
        provider={detail.provider}
        state={detail.state}
        showActions
        pending={actions.pending}
        readySupported={detail.readySupported}
        reviewSupported={detail.reviewSupported}
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
        <aside className="change-request-detail__side">
          <ChangeRequestDetailSummary detail={detail} />
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
