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
