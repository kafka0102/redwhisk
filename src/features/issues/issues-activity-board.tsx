import type { ComponentProps, JSX, ReactNode } from "react";

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
  return (
    <>
      <IssueBoardHeader
        actions={actions}
        issueCount={issueCount}
        pane={pane}
        projectId={projectId}
        sourceMode={sourceMode}
        onPaneChange={onPaneChange}
      />
      {pane === "pullRequests" ? (
        <ChangeRequestPanel
          projectId={projectId}
          sourceMode={sourceMode}
          onOpenProjectSettings={onOpenProjectSettings}
        />
      ) : (
        <IssuesKanban {...kanban} sourceMode={sourceMode} />
      )}
    </>
  );
}
