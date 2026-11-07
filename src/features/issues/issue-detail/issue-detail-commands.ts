import { invokeCommand } from "../../../shared/commands/command-client";

export interface GetIssueDetailInput {
  projectId: number;
  issueId: number;
}

export interface IssueDetailProjection {
  provider: string;
  repo: string;
  externalUrl: string;
  remoteState: string;
  authorLogin: string | null;
  assignees: string[];
  labels: string[];
}

export interface LinkedChangeRequestSummary {
  url: string;
  number: number | null;
  state: string | null;
  checksLabel: string | null;
  title: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
}

export interface IssueDetailRecord {
  projection: IssueDetailProjection | null;
  linkedChangeRequest: LinkedChangeRequestSummary | null;
  writebackPending: boolean;
  writebackError: string | null;
}

export interface RetryIssueCompletionWritebackInput {
  projectId: number;
  issueId: number;
}

export function getIssueDetail(
  input: GetIssueDetailInput,
): Promise<IssueDetailRecord> {
  return invokeCommand<IssueDetailRecord>("get_issue_detail", { input });
}

export function retryIssueCompletionWriteback(
  input: RetryIssueCompletionWritebackInput,
): Promise<void> {
  return invokeCommand<void>("retry_issue_completion_writeback", { input });
}
