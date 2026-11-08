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
  provider: string;
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

export type ChangeRequestDetailStatus = "fresh" | "cached" | "unavailable";

export interface ChangeRequestReviewer {
  login: string;
  state: string | null;
}

export interface ChangeRequestFileChange {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
  patchStatus: string;
}

export interface ChangeRequestCheckRun {
  name: string;
  status: string;
  durationMs: number | null;
  logUrl: string | null;
}

export interface ChangeRequestDiscussionItem {
  author: string;
  kind: string;
  body: string;
  createdAt: number;
  state: string | null;
}

export interface ChangeRequestDetail {
  id: number;
  provider: string;
  number: number;
  title: string;
  url: string;
  state: string;
  body: string;
  authorLogin: string | null;
  sourceBranch: string;
  targetBranch: string;
  commitCount: number | null;
  additions: number | null;
  deletions: number | null;
  labels: string[];
  reviewers: ChangeRequestReviewer[];
  mergeable: string | null;
  mergeStateStatus: string | null;
  reviewDecision: string | null;
  blockingReasons: string[];
  mergeMethod: string | null;
  mergeCommitSha: string | null;
  detailStatus: ChangeRequestDetailStatus;
  detailError: string | null;
  files: ChangeRequestFileChange[];
  checks: ChangeRequestCheckRun[];
  reviews: ChangeRequestDiscussionItem[];
  comments: ChangeRequestDiscussionItem[];
  linkedIssues: ChangeRequestLinkedIssue[];
  readySupported: boolean;
  reviewSupported: boolean;
}

export function getProjectChangeRequest(input: {
  projectId: number;
  provider: string;
  number: number;
}): Promise<ChangeRequestDetail> {
  return invokeCommand<ChangeRequestDetail>(
    "get_project_change_request",
    input,
  );
}

export function markChangeRequestReady(input: {
  projectId: number;
  provider: string;
  number: number;
}): Promise<ChangeRequestDetail> {
  return invokeCommand<ChangeRequestDetail>("mark_change_request_ready", input);
}

export function requestChangeRequestReview(input: {
  projectId: number;
  provider: string;
  number: number;
  reviewer: string;
}): Promise<ChangeRequestDetail> {
  return invokeCommand<ChangeRequestDetail>(
    "request_change_request_review",
    input,
  );
}

export function closeChangeRequest(input: {
  projectId: number;
  provider: string;
  number: number;
}): Promise<ChangeRequestDetail> {
  return invokeCommand<ChangeRequestDetail>("close_change_request", input);
}
