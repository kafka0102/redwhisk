import type { SessionSidePanelTab } from "../agents/session-workspace-types";

export interface IssueOpenRequest {
  issueId: number;
  source?: "issues" | "session";
  sessionId?: number;
  restoreSidePanel?: boolean;
  sidePanelTab?: SessionSidePanelTab;
}

export function getIssueOpenRequestId(
  request: IssueOpenRequest | number | null | undefined,
): number | null {
  if (typeof request === "number") {
    return request;
  }

  return request?.issueId ?? null;
}
