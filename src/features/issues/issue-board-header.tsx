import type { JSX, ReactNode } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import type { ForgeProvider } from "../settings/issue-source-commands";

export type IssueBoardPane = "issues" | "pullRequests";

export function IssueBoardHeader({
  actions,
  issueCount,
  pane,
  onPaneChange,
  sourceMode = null,
  provider = null,
  pullRequestCount = null,
}: {
  actions?: ReactNode;
  issueCount: number;
  pane: IssueBoardPane;
  onPaneChange: (pane: IssueBoardPane) => void;
  sourceMode?: "local" | "remote" | "mixed" | null;
  provider?: ForgeProvider | null;
  pullRequestCount?: number | null;
}): JSX.Element {
  const { t } = useI18n();
  const visiblePullRequestCount =
    sourceMode === "local"
      ? 0
      : sourceMode === "remote" || sourceMode === "mixed"
        ? pullRequestCount
        : null;
  const tabLabel = t(
    provider === "gitlab"
      ? "issues.mergeRequestsTab"
      : "issues.pullRequestsTab",
  );
  return (
    <header className="issue-surface-header issue-surface-header--activity">
      <div
        aria-label={t("issues.boardTabs")}
        className="issue-board-tabs"
        role="tablist"
      >
        <button
          aria-selected={pane === "issues"}
          className="issue-board-tab"
          role="tab"
          type="button"
          onClick={() => onPaneChange("issues")}
        >
          {t("issues.title")}
          <span aria-hidden="true" className="issue-board-tab__count">
            {issueCount}
          </span>
        </button>
        <button
          aria-selected={pane === "pullRequests"}
          className="issue-board-tab"
          role="tab"
          type="button"
          onClick={() => onPaneChange("pullRequests")}
        >
          {tabLabel}
          {visiblePullRequestCount == null ? null : (
            <span aria-hidden="true" className="issue-board-tab__count">
              {visiblePullRequestCount}
            </span>
          )}
        </button>
      </div>
      {actions ? (
        <div className="issue-surface-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}
