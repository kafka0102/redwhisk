import type { JSX, ReactNode } from "react";

import { useI18n } from "../../shared/i18n/i18n";

export type IssueBoardPane = "issues" | "pullRequests";

export function IssueBoardHeader({
  actions,
  issueCount,
  pane,
  onPaneChange,
}: {
  actions?: ReactNode;
  issueCount: number;
  pane: IssueBoardPane;
  onPaneChange: (pane: IssueBoardPane) => void;
}): JSX.Element {
  const { t } = useI18n();
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
          {t("issues.pullRequestsTab")}
          <span aria-hidden="true" className="issue-board-tab__count">
            0
          </span>
        </button>
      </div>
      {actions ? (
        <div className="issue-surface-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}

export function IssuePullRequestsEmpty(): JSX.Element {
  const { t } = useI18n();
  return (
    <section
      aria-label={t("issues.pullRequestsTab")}
      className="issue-pull-requests-empty"
    >
      <h3>{t("issues.pullRequestsEmptyTitle")}</h3>
    </section>
  );
}
