import {
  useState,
  type ComponentProps,
  type JSX,
  type ReactNode,
  type Ref,
} from "react";

import { IssueBoardHeader, type IssueBoardPane } from "./issue-board-header";
import { ChangeRequestPanel } from "./change-request-panel";
import { IssuesKanban } from "./issues-kanban";
import type { ForgeProvider } from "../settings/issue-source-commands";
import { IssueBoardList } from "./issue-board-list";
import { IssueBoardModeBar } from "./issue-board-mode-bar";
import {
  filterIssuesByTitle,
  issueListBucket,
  type IssueBoardView,
  type IssueListBucket,
} from "./issue-board-list-model";

export function IssuesActivityBoard({
  actions,
  issueCount,
  pane,
  onPaneChange,
  projectId,
  sourceMode,
  provider = null,
  onOpenProjectSettings,
  openChangeRequest,
  onOpenChangeRequestConsumed,
  onOpenLinkedIssue,
  createButtonRef,
  showCreate = false,
  onCreateIssue,
  ...kanban
}: {
  actions?: ReactNode;
  issueCount: number;
  pane: IssueBoardPane;
  onPaneChange: (pane: IssueBoardPane) => void;
  projectId: number;
  sourceMode: "local" | "remote" | "mixed" | null;
  provider?: ForgeProvider | null;
  onOpenProjectSettings?: () => void;
  openChangeRequest?: { provider: string; number: number } | null;
  onOpenChangeRequestConsumed?: () => void;
  onOpenLinkedIssue?: (issueId: number) => void;
  createButtonRef: Ref<HTMLButtonElement | null>;
  showCreate?: boolean;
  onCreateIssue: (trigger: HTMLElement | null) => void;
} & ComponentProps<typeof IssuesKanban>): JSX.Element {
  const [detailOpen, setDetailOpen] = useState(false);
  const [view, setView] = useState<IssueBoardView>("board");
  const [bucket, setBucket] = useState<IssueListBucket>("open");
  const [titleQuery, setTitleQuery] = useState("");
  const filteredLanes = kanban.lanes.map((lane) => ({
    ...lane,
    issues: filterIssuesByTitle(lane.issues, titleQuery),
  }));
  const titleMatches = filteredLanes.flatMap((lane) => lane.issues);
  const openCount = titleMatches.filter(
    (issue) => issueListBucket(issue) === "open",
  ).length;
  const visibleIssues = titleMatches.filter(
    (issue) => issueListBucket(issue) === bucket,
  );
  const showIssueChrome = pane === "issues" && !detailOpen;
  return (
    <>
      {detailOpen ? null : (
        <IssueBoardHeader
          actions={actions}
          issueCount={issueCount}
          pane={pane}
          projectId={projectId}
          sourceMode={sourceMode}
          provider={provider}
          onPaneChange={onPaneChange}
        />
      )}
      {showIssueChrome ? (
        <IssueBoardModeBar
          bucket={bucket}
          closedCount={titleMatches.length - openCount}
          openCount={openCount}
          titleQuery={titleQuery}
          view={view}
          onBucketChange={setBucket}
          onTitleQueryChange={setTitleQuery}
          onViewChange={setView}
          createButtonRef={createButtonRef}
          showCreate={showCreate}
          onCreateIssue={onCreateIssue}
        />
      ) : null}
      {pane === "pullRequests" ? (
        <ChangeRequestPanel
          projectId={projectId}
          sourceMode={sourceMode}
          provider={provider}
          onOpenProjectSettings={onOpenProjectSettings}
          onDetailOpenChange={setDetailOpen}
          openDetail={openChangeRequest}
          onOpenDetailConsumed={onOpenChangeRequestConsumed}
          onOpenLinkedIssue={onOpenLinkedIssue}
        />
      ) : view === "list" ? (
        <IssueBoardList
          bucket={bucket}
          isLoading={kanban.isLoading}
          issues={visibleIssues}
          selectedIssueId={kanban.selectedIssueId}
          toDescriptionExcerpt={kanban.toDescriptionExcerpt}
          onOpenIssue={kanban.onOpenIssue}
        />
      ) : (
        <IssuesKanban
          {...kanban}
          lanes={filteredLanes}
          sourceMode={sourceMode}
        />
      )}
    </>
  );
}
