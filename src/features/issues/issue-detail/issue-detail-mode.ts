import type { DialogMode } from "../issue-activity-types";
import type { IssueRecord } from "../issue-commands";
import {
  issueNumberLabel,
  readIssueMirror,
  toBoardRecord,
} from "../issue-mirror-fields";

export function isDirectLocalBacklog(issue: IssueRecord | null): boolean {
  if (issue == null || issue.status !== "backlog") {
    return false;
  }
  return (issue as { source?: string | null }).source === "local";
}

export function isIssueEditorOpen(input: {
  dialogMode: DialogMode | null;
  issue: IssueRecord | null;
  readOnlyEditRequested: boolean;
}): boolean {
  if (input.dialogMode == null) {
    return false;
  }
  if (input.dialogMode === "create") {
    return true;
  }
  if (input.readOnlyEditRequested) {
    return true;
  }
  return isDirectLocalBacklog(input.issue);
}

export function issueDetailTitleParts(issue: IssueRecord): {
  numberLabel: string;
  title: string;
} {
  const mirror = readIssueMirror(toBoardRecord(issue));
  return {
    numberLabel: issueNumberLabel(issue.number, mirror),
    title: issue.title,
  };
}

export function issueDetailHeading(issue: IssueRecord): string {
  const parts = issueDetailTitleParts(issue);
  return `${parts.numberLabel} · ${parts.title}`;
}
