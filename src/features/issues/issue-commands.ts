import { invokeCommand } from "../../shared/commands/command-client";

export type IssueStatus = "backlog" | "running" | "review" | "completed";

export interface IssueRecord {
  id: number;
  projectId: number;
  title: string;
  description: string;
  status: IssueStatus;
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

export interface StartAgentSessionInput {
  projectId: number;
  issueId: number;
  agentProfileId: number;
  promptSnapshot: string;
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

export function startAgentSession(
  input: StartAgentSessionInput,
): Promise<void> {
  return invokeCommand<void>("start_agent_session", { input });
}
