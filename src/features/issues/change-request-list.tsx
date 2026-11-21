import type { JSX, ReactNode } from "react";
import { GitPullRequest } from "lucide-react";

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

const FILTERS: ChangeRequestFilter[] = ["open", "closed"];

export function ChangeRequestList({
  sourceMode,
  provider = null,
  response,
  filter = "open",
  now,
  syncSlot = null,
  onFilterChange,
  onOpenProjectSettings,
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
              <span aria-hidden="true" className="issue-board-tab__count">
                {filterCount(item, response)}
              </span>
            </button>
          ))}
        </div>
        {syncSlot}
      </div>
      {rows.length === 0 ? (
        <div className="issue-pull-requests-empty">
          <GitPullRequest aria-hidden="true" size={28} strokeWidth={1.8} />
          <p>{t(emptyLabel(filter, provider))}</p>
        </div>
      ) : (
        <>
          <div className="change-request-head">
            <span>{t("issues.changeRequests.columnTitle")}</span>
            <span>{t("issues.changeRequests.columnChecks")}</span>
            <span>{t("issues.changeRequests.columnLinks")}</span>
          </div>
          {rows.map((row) => (
            <ChangeRequestRow
              key={row.id}
              now={now}
              row={row}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </>
      )}
    </section>
  );
}

function ChangeRequestRow({
  row,
  now,
  onOpenDetail,
}: {
  row: ChangeRequestListRow;
  now: number;
  onOpenDetail?: (row: ChangeRequestListRow) => void;
}): JSX.Element {
  const { t } = useI18n();
  const check = changeRequestCheck(row, t);
  const review = changeRequestReview(row, t);
  const reviewTone = review.tone === "muted" ? "neutral" : review.tone;
  const author = row.authorLogin ?? "";
  return (
    <div className="change-request-row" role="row">
      <div className="change-request-title" onClick={() => onOpenDetail?.(row)}>
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
          <span
            key={link.issueId}
            className="change-request-link"
            title={link.label}
          >
            {link.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function filterLabel(filter: ChangeRequestFilter): string {
  return filter === "closed"
    ? "issues.changeRequests.filterClosed"
    : "issues.changeRequests.filterOpen";
}

function filterCount(
  filter: ChangeRequestFilter,
  response: ChangeRequestListResponse | null,
): number {
  if (response == null) {
    return 0;
  }
  return filter === "closed" ? response.counts.closed : response.counts.open;
}

function emptyLabel(
  filter: ChangeRequestFilter,
  provider: ForgeProvider | null,
): string {
  const gitlab = provider === "gitlab";
  if (filter === "closed") {
    return gitlab
      ? "issues.changeRequests.emptyMergeClosed"
      : "issues.changeRequests.emptyClosed";
  }
  return gitlab
    ? "issues.changeRequests.emptyMergeAllOpen"
    : "issues.changeRequests.emptyAllOpen";
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
