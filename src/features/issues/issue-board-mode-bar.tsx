import type { JSX, Ref } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import type { IssueBoardView, IssueListBucket } from "./issue-board-list-model";

export function IssueBoardModeBar({
  view,
  bucket,
  titleQuery,
  openCount,
  closedCount,
  onViewChange,
  onBucketChange,
  onTitleQueryChange,
  showCreate,
  onCreateIssue,
  createButtonRef,
}: {
  view: IssueBoardView;
  bucket: IssueListBucket;
  titleQuery: string;
  openCount: number;
  closedCount: number;
  onViewChange: (view: IssueBoardView) => void;
  onBucketChange: (bucket: IssueListBucket) => void;
  onTitleQueryChange: (query: string) => void;
  showCreate: boolean;
  onCreateIssue: (trigger: HTMLElement | null) => void;
  createButtonRef: Ref<HTMLButtonElement | null>;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="issue-board-mode">
      {view === "list" ? (
        <div
          aria-label={t("issues.issueStateFilters")}
          className="issue-board-mode__filters"
          role="group"
        >
          <FilterButton
            count={openCount}
            label={t("issues.filterOpen")}
            pressed={bucket === "open"}
            onClick={() => onBucketChange("open")}
          />
          <FilterButton
            count={closedCount}
            label={t("issues.filterClosed")}
            pressed={bucket === "closed"}
            onClick={() => onBucketChange("closed")}
          />
        </div>
      ) : (
        <div />
      )}
      <div className="issue-board-mode__tools">
        <input
          aria-label={t("issues.searchTitles")}
          className="issue-board-mode__search"
          placeholder={t("issues.searchTitles")}
          type="text"
          value={titleQuery}
          onChange={(event) => onTitleQueryChange(event.target.value)}
        />
        <button
          aria-label={t("issues.boardView")}
          aria-pressed={view === "board"}
          className="issue-board-mode__view"
          title={t("issues.boardView")}
          type="button"
          onClick={() => onViewChange("board")}
        >
          <BoardGlyph />
        </button>
        <button
          aria-label={t("issues.listView")}
          aria-pressed={view === "list"}
          className="issue-board-mode__view"
          title={t("issues.listView")}
          type="button"
          onClick={() => onViewChange("list")}
        >
          <ListGlyph />
        </button>
        {showCreate ? (
          <button
            ref={createButtonRef}
            aria-label={t("issues.newIssue")}
            className="issue-board-mode__create"
            title={t("issues.newIssue")}
            type="button"
            onClick={(event) => onCreateIssue(event.currentTarget)}
          >
            {t("issues.newIssue")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FilterButton({
  label,
  count,
  pressed,
  onClick,
}: {
  label: string;
  count: number;
  pressed: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      aria-pressed={pressed}
      className="issue-board-mode__filter"
      type="button"
      onClick={onClick}
    >
      {label} <span className="issue-board-mode__count">{count}</span>
    </button>
  );
}

function BoardGlyph(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
    >
      <rect
        height="18"
        rx="1"
        stroke="currentColor"
        strokeWidth="2"
        width="5"
        x="3"
        y="3"
      />
      <rect
        height="12"
        rx="1"
        stroke="currentColor"
        strokeWidth="2"
        width="5"
        x="10"
        y="3"
      />
      <rect
        height="8"
        rx="1"
        stroke="currentColor"
        strokeWidth="2"
        width="4"
        x="17"
        y="3"
      />
    </svg>
  );
}

function ListGlyph(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
    >
      <path
        d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}
