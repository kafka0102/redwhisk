import type { JSX } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { useI18n } from "../../../shared/i18n/i18n";
import { IssueReadonlySessionPanel } from "./issue-readonly-session-panel";
import type {
  IssueDetailProjection,
  LinkedChangeRequestSummary,
} from "./issue-detail-commands";

export function IssueReadOnlyLabelRow({
  labels,
}: {
  labels: string[];
}): JSX.Element | null {
  const { messages } = useI18n();
  if (labels.length === 0) {
    return null;
  }
  return (
    <div
      aria-label={messages.issues.labels}
      className="issue-detail__readonly-labels"
      role="group"
    >
      {labels.map((label) => (
        <span className="issue-detail__readonly-label" key={label}>
          {label}
        </span>
      ))}
    </div>
  );
}

export function IssueDetailSideCards({
  projection,
  linkedChangeRequest,
  linkedSessionId,
  projectId,
  canOpenSession,
  onOpenSession,
  issueStatus,
  writebackPending,
  writebackError,
  onRetryWriteback,
}: {
  projection: IssueDetailProjection | null;
  linkedChangeRequest: LinkedChangeRequestSummary | null;
  linkedSessionId: number | null;
  projectId: number;
  canOpenSession: boolean;
  onOpenSession: () => void;
  issueStatus: string | null;
  writebackPending: boolean;
  writebackError: string | null;
  onRetryWriteback: () => void;
}): JSX.Element | null {
  const { messages } = useI18n();
  const hasSession = linkedSessionId != null;
  if (projection == null && linkedChangeRequest == null && !hasSession) {
    return null;
  }
  const pendingMerge =
    issueStatus === "completed" &&
    projection != null &&
    projection.remoteState !== "closed" &&
    linkedChangeRequest != null &&
    (linkedChangeRequest.state == null ||
      linkedChangeRequest.state.toLowerCase() === "open");
  return (
    <div className="issue-page__side issue-page__side--readonly">
      {projection != null ? (
        <IssueHostCard
          pendingMerge={pendingMerge}
          projection={projection}
          writebackError={writebackError}
          writebackPending={writebackPending}
          onRetryWriteback={onRetryWriteback}
        />
      ) : null}
      {linkedChangeRequest != null ? (
        <IssueLinkedChangeRequestCard
          provider={projection?.provider ?? null}
          request={linkedChangeRequest}
        />
      ) : null}
      {hasSession ? (
        <aside
          aria-label={messages.agentsFeature.sessionInfo}
          className="issue-page__side"
        >
          <IssueReadonlySessionPanel
            canOpenSession={canOpenSession}
            linkedSessionId={linkedSessionId}
            projectId={projectId}
            onOpenSession={onOpenSession}
          />
        </aside>
      ) : null}
    </div>
  );
}

function IssueHostCard({
  projection,
  pendingMerge,
  writebackPending,
  writebackError,
  onRetryWriteback,
}: {
  projection: IssueDetailProjection;
  pendingMerge: boolean;
  writebackPending: boolean;
  writebackError: string | null;
  onRetryWriteback: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const hostName = projection.provider === "gitlab" ? "GitLab" : "GitHub";
  const openLabel =
    projection.provider === "gitlab"
      ? t("issues.openGitlab")
      : t("issues.openGithub");
  return (
    <section aria-label={hostName} className="issue-detail-side-card">
      <div className="issue-detail-side-card__header">
        <h3>{hostName}</h3>
        <Button
          size="sm"
          type="button"
          variant="secondary"
          onClick={() => {
            void openUrl(projection.externalUrl);
          }}
        >
          {openLabel}
        </Button>
      </div>
      <dl>
        <div>
          <dt>{t("issues.detailRepo")}</dt>
          <dd>{projection.repo}</dd>
        </div>
        <div>
          <dt>{t("issues.detailRemoteState")}</dt>
          <dd>
            {pendingMerge
              ? t("issues.pullRequestPendingMerge")
              : remoteStateLabel(
                  projection.remoteState,
                  t("issues.remoteStateUnavailable"),
                )}
          </dd>
        </div>
        {writebackPending ? (
          <div>
            <dt>{t("issues.writebackPending")}</dt>
            <dd>
              {writebackError == null
                ? t("issues.writebackPending")
                : t(`errors.FORGE_UNAVAILABLE.${writebackError}`)}
            </dd>
            <Button
              size="sm"
              type="button"
              variant="secondary"
              onClick={onRetryWriteback}
            >
              {t("issues.retryWriteback")}
            </Button>
          </div>
        ) : null}
        <div>
          <dt>{t("issues.detailAuthor")}</dt>
          <dd>{projection.authorLogin ?? t("issues.assigneeEmpty")}</dd>
        </div>
        <div>
          <dt>{t("issues.detailAssignees")}</dt>
          <dd>
            {projection.assignees.length === 0
              ? t("issues.assigneeEmpty")
              : projection.assignees.join(", ")}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function IssueLinkedChangeRequestCard({
  provider,
  request,
}: {
  provider: string | null;
  request: LinkedChangeRequestSummary;
}): JSX.Element {
  const { t } = useI18n();
  const openLabel =
    provider === "gitlab" ? t("issues.openGitlab") : t("issues.openGithub");
  return (
    <section
      aria-label={t("issues.linkedChangeRequest")}
      className="issue-detail-side-card"
    >
      <div className="issue-detail-side-card__header">
        <h3>{t("issues.linkedChangeRequest")}</h3>
        {request.state != null && request.state.length > 0 ? (
          <span>{request.state}</span>
        ) : null}
      </div>
      <Button
        size="sm"
        type="button"
        variant="secondary"
        onClick={() => {
          void openUrl(request.url);
        }}
      >
        {openLabel}
      </Button>
    </section>
  );
}

function remoteStateLabel(state: string, unavailable: string): string {
  if (state === "open" || state === "closed") {
    return state;
  }
  return unavailable;
}
