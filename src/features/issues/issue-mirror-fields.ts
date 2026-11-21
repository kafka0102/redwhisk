import type { IssueRecord } from "./issue-commands";
import type { IssueBoardRecord } from "./issue-mirror-commands";

const ISSUE_MIRROR_FIELDS = [
  "source",
  "provider",
  "externalNumber",
  "remoteState",
  "remoteLabels",
  "syncStatus",
  "remoteClosedWhileRunning",
  "remoteReopened",
  "pullRequestUrl",
  "remoteAssignee",
] as const;

type IssueMirrorField = (typeof ISSUE_MIRROR_FIELDS)[number];
type IssueMirrorCarrier = IssueRecord &
  Partial<Pick<IssueBoardRecord, IssueMirrorField>>;

function hasOwnMirrorField(value: object, field: IssueMirrorField): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function copyMirrorField<Field extends IssueMirrorField>(
  target: IssueMirrorCarrier,
  source: IssueMirrorCarrier,
  field: Field,
): void {
  target[field] = source[field];
}

export function retainIssueMirrorFields(
  previous: IssueBoardRecord,
  next: IssueRecord,
): IssueBoardRecord {
  const incoming = next as IssueMirrorCarrier;
  const retained: IssueMirrorCarrier = { ...incoming };
  for (const field of ISSUE_MIRROR_FIELDS) {
    if (!hasOwnMirrorField(incoming, field)) {
      copyMirrorField(retained, previous, field);
    }
  }
  return retained as IssueBoardRecord;
}

export function toBoardIssues(
  issues: readonly IssueRecord[],
): IssueBoardRecord[] {
  return issues.map((issue) => toBoardRecord(issue));
}

export function toCreatedBoardRecord(issue: IssueRecord): IssueBoardRecord {
  if (Object.prototype.hasOwnProperty.call(issue, "source")) {
    return toBoardRecord(issue);
  }
  return toBoardRecord({ ...issue, source: "local" });
}

type BoardRecordInput = IssueRecord &
  Partial<
    Pick<
      IssueBoardRecord,
      | "source"
      | "provider"
      | "externalNumber"
      | "remoteState"
      | "remoteLabels"
      | "syncStatus"
      | "remoteClosedWhileRunning"
      | "remoteReopened"
      | "pullRequestUrl"
      | "remoteAssignee"
    >
  >;

export interface IssueMirrorView {
  source: "local" | "remote";
  externalNumber: number | null;
  provider: "github" | "gitlab" | null;
  pullRequestUrl: string | null;
  remoteLabels: string[];
  syncStatus: string | null;
  remoteClosedWhileRunning: boolean;
  remoteReopened: boolean;
}

export function toBoardRecord(issue: BoardRecordInput): IssueBoardRecord {
  const source =
    issue.source === "local" || issue.source === "remote" ? issue.source : "";
  return {
    ...issue,
    source,
    provider: issue.provider ?? null,
    externalNumber: issue.externalNumber ?? null,
    remoteState: issue.remoteState ?? null,
    remoteLabels: issue.remoteLabels ?? [],
    syncStatus: issue.syncStatus ?? null,
    remoteClosedWhileRunning: issue.remoteClosedWhileRunning ?? false,
    remoteReopened: issue.remoteReopened ?? false,
    pullRequestUrl: issue.pullRequestUrl ?? null,
    remoteAssignee: issue.remoteAssignee ?? null,
  };
}

export function readIssueMirror(issue: IssueBoardRecord): IssueMirrorView {
  return {
    source: issue.source === "remote" ? "remote" : "local",
    externalNumber: issue.externalNumber,
    provider:
      issue.provider === "gitlab"
        ? "gitlab"
        : issue.provider === "github"
          ? "github"
          : null,
    pullRequestUrl:
      issue.pullRequestUrl != null && issue.pullRequestUrl.length > 0
        ? issue.pullRequestUrl
        : null,
    remoteLabels: issue.remoteLabels,
    syncStatus: issue.syncStatus,
    remoteClosedWhileRunning: issue.remoteClosedWhileRunning,
    remoteReopened: issue.remoteReopened,
  };
}

export function issueNumberLabel(
  issueNumber: number,
  mirror: IssueMirrorView,
): string {
  if (mirror.source === "remote" && mirror.externalNumber != null) {
    const prefix = mirror.provider === "gitlab" ? "GL" : "GH";
    return `${prefix} #${mirror.externalNumber}`;
  }
  return `#${issueNumber}`;
}

export function issueForgeBadgeKey(
  mirror: IssueMirrorView,
): "issues.githubBadge" | "issues.gitlabBadge" | "issues.localBadge" {
  if (mirror.source !== "remote") {
    return "issues.localBadge";
  }
  return mirror.provider === "gitlab"
    ? "issues.gitlabBadge"
    : "issues.githubBadge";
}

export function linkedRequestLabel(mirror: IssueMirrorView): string | null {
  if (mirror.source !== "remote" || mirror.pullRequestUrl == null) {
    return null;
  }
  const path = mirror.pullRequestUrl.split(/[?#]/, 1)[0] ?? "";
  const segment = path.split("/").pop() ?? "";
  if (!/^\d+$/.test(segment)) {
    return null;
  }
  const prefix = mirror.provider === "gitlab" ? "MR" : "PR";
  return `${prefix} #${segment}`;
}

export function formatIssueAge(
  epochMilliseconds: number,
  now: number,
  labels: {
    justNow: string;
    minutesAgo: (minutes: number) => string;
    hoursAgo: (hours: number) => string;
    daysAgo: (days: number) => string;
  },
): string {
  const seconds = Math.max(0, Math.floor((now - epochMilliseconds) / 1000));
  if (seconds < 60) {
    return labels.justNow;
  }
  if (seconds < 3_600) {
    return labels.minutesAgo(Math.floor(seconds / 60));
  }
  if (seconds < 86_400) {
    return labels.hoursAgo(Math.floor(seconds / 3_600));
  }
  return labels.daysAgo(Math.floor(seconds / 86_400));
}
