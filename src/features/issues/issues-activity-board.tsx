import { useState, type ComponentProps, type JSX, type ReactNode } from "react";

import { IssueBoardHeader, type IssueBoardPane } from "./issue-board-header";
import { ChangeRequestPanel } from "./change-request-panel";
import { IssuesKanban } from "./issues-kanban";
import type { ForgeProvider } from "../settings/issue-source-commands";

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
          provider={provider}
          onPaneChange={onPaneChange}
        />
      )}
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
      ) : (
        <IssuesKanban {...kanban} sourceMode={sourceMode} />
      )}
    </>
  );
}
