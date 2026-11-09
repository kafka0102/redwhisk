import type { JSX, ReactNode } from "react";

import { useI18n } from "../../shared/i18n/i18n";

import type {
  ChangeRequestFilter,
  ChangeRequestListResponse,
  ChangeRequestListRow,
} from "./change-request-commands";
import {
  changeRequestCheck,
  changeRequestReview,
  changeRequestTime,
} from "./change-request-list-text";
import type { ForgeProvider } from "../settings/issue-source-commands";

const FILTERS: ChangeRequestFilter[] = [
  "review_requested",
  "created_by_me",
  "all_open",
  "recently_merged",
];

export function ChangeRequestList({
  sourceMode,
  provider = null,
  response,
  filter = "review_requested",
  now,
  syncSlot = null,
  onFilterChange,
  onOpenProjectSettings,
  onOpenUrl,
  onOpenDetail,
}: {
  sourceMode: "local" | "remote" | "mixed" | null;
  provider?: ForgeProvider | null;
  response: ChangeRequestListResponse | null;
  filter?: ChangeRequestFilter;
  now: number;
  syncSlot?: ReactNode;
  onFilterChange?: (filter: ChangeRequestFilter) => void;
  onOpenProjectSettings?: () => void;
  onOpenUrl?: (url: string) => void;
  onOpenDetail?: (row: ChangeRequestListRow) => void;
}): JSX.Element | null {
  const { t } = useI18n();
  if (sourceMode == null) {
    return null;
  }
  if (sourceMode === "local") {
    return (
      <section className="change-request-list change-request-empty">
        <button type="button" onClick={onOpenProjectSettings}>
          {t("issues.changeRequests.connectSettings")}
        </button>
      </section>
    );
  }

  const rows = response?.rows ?? [];
  return (
    <section
      className="change-request-list"
      aria-label={t(
        provider === "gitlab"
          ? "issues.mergeRequestsTab"
          : "issues.pullRequestsTab",
      )}
    >
      <div className="change-request-toolbar">
        <div
          className="change-request-filters"
          aria-label={t(
            provider === "gitlab"
              ? "issues.changeRequests.mergeFilters"
              : "issues.changeRequests.filters",
          )}
        >
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              className={`change-request-filter${item === filter ? " is-selected" : ""}`}
              aria-pressed={item === filter}
              onClick={() => onFilterChange?.(item)}
            >
              {t(filterLabel(item))}
            </button>
          ))}
        </div>
        {syncSlot}
      </div>
      <div className="change-request-head">
        <span>{t("issues.changeRequests.columnTitle")}</span>
        <span>{t("issues.changeRequests.columnChecks")}</span>
        <span>{t("issues.changeRequests.columnLinks")}</span>
      </div>
      {rows.length === 0 ? (
        <p>{t(emptyLabel(filter, provider))}</p>
      ) : (
        rows.map((row) => (
          <ChangeRequestRow
            key={row.id}
            now={now}
            row={row}
            onOpenUrl={onOpenUrl}
            onOpenDetail={onOpenDetail}
          />
        ))
      )}
    </section>
  );
}

function ChangeRequestRow({
  row,
  now,
  onOpenUrl,
  onOpenDetail,
}: {
  row: ChangeRequestListRow;
  now: number;
  onOpenUrl?: (url: string) => void;
  onOpenDetail?: (row: ChangeRequestListRow) => void;
}): JSX.Element {
  const { t } = useI18n();
  const check = changeRequestCheck(row, t);
  const review = changeRequestReview(row, t);
  const reviewTone = review.tone === "muted" ? "neutral" : review.tone;
  const author = row.authorLogin ?? "";
  return (
    <div
      className="change-request-row"
      role="row"
      onClick={() => onOpenDetail?.(row)}
    >
      <div className="change-request-title">
        <span
          className={`change-request-state change-request-state--${row.state}`}
          role="img"
          aria-label={stateLabel(row.state, t)}
        />
        <div>
          <h3>{row.title}</h3>
          <p>
            #{row.number} · {row.sourceBranch} → {row.targetBranch} · {author} ·{" "}
            {changeRequestTime(row.remoteUpdatedAt, now, t)}
          </p>
        </div>
      </div>
      <div>
        <p
          className={`change-request-check change-request-check--${check.tone}`}
        >
          {check.text}
        </p>
        <p
          className={`change-request-review change-request-review--${reviewTone}`}
        >
          {review.text}
        </p>
      </div>
      <div className="change-request-links">
        {row.linkedIssues.map((link) => (
          <span key={link.issueId} className="change-request-link">
            {link.label}
          </span>
        ))}
      </div>
      <a
        className="change-request-open"
        href={row.url}
        rel="noreferrer"
        target="_blank"
        onClick={(event) => {
          event.stopPropagation();
          onOpenUrl?.(row.url);
        }}
      >
        {t("issues.changeRequests.open")}
      </a>
    </div>
  );
}

function filterLabel(filter: ChangeRequestFilter): string {
  switch (filter) {
    case "created_by_me":
      return "issues.changeRequests.createdByMe";
    case "all_open":
      return "issues.changeRequests.allOpen";
    case "recently_merged":
      return "issues.changeRequests.recentlyMerged";
    default:
      return "issues.changeRequests.reviewRequested";
  }
}

function emptyLabel(
  filter: ChangeRequestFilter,
  provider: ForgeProvider | null,
): string {
  const gitlab = provider === "gitlab";
  switch (filter) {
    case "created_by_me":
      return gitlab
        ? "issues.changeRequests.emptyMergeCreatedByMe"
        : "issues.changeRequests.emptyCreatedByMe";
    case "all_open":
      return gitlab
        ? "issues.changeRequests.emptyMergeAllOpen"
        : "issues.changeRequests.emptyAllOpen";
    case "recently_merged":
      return gitlab
        ? "issues.changeRequests.emptyMergeRecentlyMerged"
        : "issues.changeRequests.emptyRecentlyMerged";
    default:
      return gitlab
        ? "issues.changeRequests.emptyMergeReviewRequested"
        : "issues.changeRequests.emptyReviewRequested";
  }
}

function stateLabel(state: string, t: (key: string) => string): string {
  switch (state) {
    case "draft":
      return t("issues.changeRequests.stateDraft");
    case "merged":
      return t("issues.changeRequests.stateMerged");
    case "closed":
      return t("issues.changeRequests.stateClosed");
    default:
      return t("issues.changeRequests.stateOpen");
  }
}
