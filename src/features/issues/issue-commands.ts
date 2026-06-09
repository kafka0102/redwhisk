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
  linkedSessionLogPath?: string | null;
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

export interface CompleteIssueManualInput {
  projectId: number;
  issueId: number;
}

export interface CompleteIssueCleanInput {
  projectId: number;
  issueId: number;
}

export interface PrepareAgentCommitCompletionInput {
  projectId: number;
  issueId: number;
}

export interface SendAgentCommitPromptInput {
  projectId: number;
  issueId: number;
}

export interface DetectAgentCommitCompletionInput {
  projectId: number;
  issueId: number;
}

export interface AgentCommitChangedFileSummary {
  status: string;
  path: string;
  oldPath?: string | null;
}

export interface AgentCommitCompletionPreview {
  issueId: number;
  sessionId: number;
  option: string;
  head: string;
  changedFilesCount: number;
  changedFiles: AgentCommitChangedFileSummary[];
  completionPrompt: string;
}

export interface SendAgentCommitPromptResult {
  issueId: number;
  sessionId: number;
  codexSessionId?: string | null;
}

export type DetectAgentCommitCompletionOutcome =
  | "completed"
  | "no_commit_detected";

export interface DetectAgentCommitCompletionResult {
  outcome: DetectAgentCommitCompletionOutcome;
  issue: IssueRecord;
  message: string;
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

export function completeIssueManual(
  input: CompleteIssueManualInput,
): Promise<IssueRecord> {
  return invokeCommand<IssueRecord>("complete_issue_manual", { input });
}

export function completeIssueClean(
  input: CompleteIssueCleanInput,
): Promise<IssueRecord> {
  return invokeCommand<IssueRecord>("complete_issue_clean", { input });
}

export function prepareAgentCommitCompletion(
  input: PrepareAgentCommitCompletionInput,
): Promise<AgentCommitCompletionPreview> {
  return invokeCommand<AgentCommitCompletionPreview>(
    "prepare_agent_commit_completion",
    { input },
  );
}

export function sendAgentCommitPrompt(
  input: SendAgentCommitPromptInput,
): Promise<SendAgentCommitPromptResult> {
  return invokeCommand<SendAgentCommitPromptResult>(
    "send_agent_commit_prompt",
    {
      input,
    },
  );
}

export function detectAgentCommitCompletion(
  input: DetectAgentCommitCompletionInput,
): Promise<DetectAgentCommitCompletionResult> {
  return invokeCommand<DetectAgentCommitCompletionResult>(
    "detect_agent_commit_completion",
    {
      input,
    },
  );
}

export function startAgentSession(
  input: StartAgentSessionInput,
): Promise<StartAgentSessionResult> {
  return invokeCommand<StartAgentSessionResult>("start_agent_session", {
    input,
  });
}
