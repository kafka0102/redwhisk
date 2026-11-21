import type { IssueRecord } from "./issue-commands";
import {
  readIssueMirror,
  toBoardRecord,
  type IssueMirrorView,
} from "./issue-mirror-fields";

export type IssueBoardView = "board" | "list";
export type IssueListBucket = "open" | "closed";

export function issueListBucket(issue: IssueRecord): IssueListBucket {
  const record = toBoardRecord(issue);
  if (record.source !== "remote") {
    return issue.status === "completed" ? "closed" : "open";
  }
  return record.remoteState === "open" ? "open" : "closed";
}

export function issueTitleMatches(title: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  return title.toLowerCase().includes(needle);
}

export function filterIssuesByTitle(
  issues: readonly IssueRecord[],
  query: string,
): IssueRecord[] {
  return issues.filter((issue) => issueTitleMatches(issue.title, query));
}

export function issueBoardNumberLabel(
  issueNumber: number,
  mirror: IssueMirrorView,
): string {
  if (mirror.source === "remote" && mirror.externalNumber != null) {
    return `#${mirror.externalNumber}`;
  }
  return `#${issueNumber}`;
}

export function readIssueMirrorView(issue: IssueRecord): IssueMirrorView {
  return readIssueMirror(toBoardRecord(issue));
}
