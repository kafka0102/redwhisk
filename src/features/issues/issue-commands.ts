import { invokeCommand } from "../../shared/commands/command-client";

export type IssueStatus = "backlog" | "running" | "review" | "completed";
export type AgentSessionStatus = "running" | "closed" | "crashed" | "stopped";
export type AgentSessionAttention = "none" | "requested";

export interface IssueRecord {
  id: number;
  projectId: number;
  title: string;
  description: string;
  status: IssueStatus;
  linkedSessionId?: number | null;
  linkedSessionStatus?: AgentSessionStatus | null;
  linkedSessionAttention?: AgentSessionAttention | null;
  createdAt: number;
  updatedAt: number;
}

export interface IssueListResponse {
  issues: IssueRecord[];
}

export interface ListIssuesInput {
  projectId: number;
}

export interface CreateIssueInput {
  projectId: number;
  title: string;
  description: string;
}

export interface UpdateIssueInput {
  projectId: number;
  issueId: number;
  title: string;
  description: string;
}

export interface MarkIssueReviewInput {
  projectId: number;
  issueId: number;
}

export interface StartAgentSessionInput {
  projectId: number;
  issueId: number;
  agentProfileId: number;
  promptSnapshot: string;
}

export interface StartAgentSessionResult {
  sessionId?: number | null;
  issueId: number;
}

export function listIssues(input: ListIssuesInput): Promise<IssueListResponse> {
  return invokeCommand<IssueListResponse>("list_issues", {
    projectId: input.projectId,
  });
}

export function createIssue(input: CreateIssueInput): Promise<IssueRecord> {
  return invokeCommand<IssueRecord>("create_issue", { input });
}

export function updateIssue(input: UpdateIssueInput): Promise<IssueRecord> {
  return invokeCommand<IssueRecord>("update_issue", { input });
}

export function markIssueReview(
  input: MarkIssueReviewInput,
): Promise<IssueRecord> {
  return invokeCommand<IssueRecord>("mark_issue_review", { input });
}

export function startAgentSession(
  input: StartAgentSessionInput,
): Promise<StartAgentSessionResult> {
  return invokeCommand<StartAgentSessionResult>("start_agent_session", {
    input,
  });
}
