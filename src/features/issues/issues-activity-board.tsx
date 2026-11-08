import { useState, type ComponentProps, type JSX, type ReactNode } from "react";

import { IssueBoardHeader, type IssueBoardPane } from "./issue-board-header";
import { ChangeRequestPanel } from "./change-request-panel";
import { IssuesKanban } from "./issues-kanban";

export function IssuesActivityBoard({
  actions,
  issueCount,
  pane,
  onPaneChange,
  projectId,
  sourceMode,
  onOpenProjectSettings,
  ...kanban
}: {
  actions?: ReactNode;
  issueCount: number;
  pane: IssueBoardPane;
  onPaneChange: (pane: IssueBoardPane) => void;
  projectId: number;
  sourceMode: "local" | "remote" | "mixed" | null;
  onOpenProjectSettings?: () => void;
} & ComponentProps<typeof IssuesKanban>): JSX.Element {
  const [detailOpen, setDetailOpen] = useState(false);
  return (
    <>
      {detailOpen ? null : (
        <IssueBoardHeader
          actions={actions}
          issueCount={issueCount}
          pane={pane}
          projectId={projectId}
          sourceMode={sourceMode}
          onPaneChange={onPaneChange}
        />
      )}
      {pane === "pullRequests" ? (
        <ChangeRequestPanel
          projectId={projectId}
          sourceMode={sourceMode}
          onOpenProjectSettings={onOpenProjectSettings}
          onDetailOpenChange={setDetailOpen}
        />
      ) : (
        <IssuesKanban {...kanban} sourceMode={sourceMode} />
      )}
    </>
  );
}
