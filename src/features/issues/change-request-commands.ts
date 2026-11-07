import { invokeCommand } from "../../shared/commands/command-client";

export type ChangeRequestFilter =
  | "review_requested"
  | "created_by_me"
  | "all_open"
  | "recently_merged";

export interface ChangeRequestFilterCounts {
  reviewRequested: number;
  createdByMe: number;
  allOpen: number;
  recentlyMerged: number;
}

export interface ChangeRequestLinkedIssue {
  issueId: number;
  label: string;
  linkKind: string;
}

export const CHANGE_REQUEST_SYNC_CHANGED_EVENT = "change-request-sync-changed";

export type ChangeRequestSyncOutcome =
  | "synced"
  | "skipped"
  | "credential_expired"
  | "cache_failed"
  | "coalesced";

export interface ChangeRequestSyncResult {
  outcome: ChangeRequestSyncOutcome;
  errorCode: string | null;
}

export interface ChangeRequestSyncChangedEvent {
  projectId: number;
  outcome: ChangeRequestSyncOutcome;
}

export interface ChangeRequestListRow {
  id: number;
  number: number;
  title: string;
  url: string;
  state: string;
  authorLogin: string | null;
  sourceBranch: string;
  targetBranch: string;
  reviewDecision: string | null;
  checksOk: number | null;
  checksFailed: number | null;
  checksPending: number | null;
  remoteUpdatedAt: number;
  linkedIssues: ChangeRequestLinkedIssue[];
}

export interface IssuePullRequestRef {
  url: string;
  changeRequestId: number | null;
}

export interface ChangeRequestListResponse {
  rows: ChangeRequestListRow[];
  tabCount: number;
  counts: ChangeRequestFilterCounts;
  pullRequestRefs: IssuePullRequestRef[];
}

export function listProjectChangeRequests(input: {
  projectId: number;
  filter?: string;
  viewerLogin?: string;
}): Promise<ChangeRequestListResponse> {
  return invokeCommand<ChangeRequestListResponse>(
    "list_project_change_requests",
    {
      projectId: input.projectId,
      filter: input.filter,
      viewerLogin: input.viewerLogin,
    },
  );
}

export function syncProjectChangeRequests(
  projectId: number,
): Promise<ChangeRequestSyncResult> {
  return invokeCommand<ChangeRequestSyncResult>(
    "sync_project_change_requests",
    {
      projectId,
    },
  );
}

export function linkChangeRequestIssue(input: {
  projectId: number;
  changeRequestId: number;
  issueId: number;
}): Promise<void> {
  return invokeCommand<void>("link_change_request_issue", input);
}
