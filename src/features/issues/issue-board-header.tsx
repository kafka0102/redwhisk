import { useEffect, useState, type JSX, type ReactNode } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import { listProjectChangeRequests } from "./change-request-commands";
import type { ForgeProvider } from "../settings/issue-source-commands";

export type IssueBoardPane = "issues" | "pullRequests";

export function IssueBoardHeader({
  actions,
  issueCount,
  pane,
  onPaneChange,
  projectId,
  sourceMode = null,
  provider = null,
}: {
  actions?: ReactNode;
  issueCount: number;
  pane: IssueBoardPane;
  onPaneChange: (pane: IssueBoardPane) => void;
  projectId?: number;
  sourceMode?: "local" | "remote" | "mixed" | null;
  provider?: ForgeProvider | null;
}): JSX.Element {
  const { t } = useI18n();
  const pullRequestCount = usePullRequestCount(projectId, sourceMode);
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
          {pullRequestCount == null ? null : (
            <span aria-hidden="true" className="issue-board-tab__count">
              {pullRequestCount}
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

function usePullRequestCount(
  projectId: number | undefined,
  sourceMode: "local" | "remote" | "mixed" | null,
): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (
      projectId == null ||
      (sourceMode !== "remote" && sourceMode !== "mixed")
    ) {
      return;
    }
    let cancelled = false;
    void listProjectChangeRequests({ projectId })
      .then((response) => {
        if (!cancelled) {
          setCount(response.tabCount);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCount(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, sourceMode]);
  if (sourceMode === "local") {
    return 0;
  }
  if (sourceMode !== "remote" && sourceMode !== "mixed") {
    return null;
  }
  return count;
}
