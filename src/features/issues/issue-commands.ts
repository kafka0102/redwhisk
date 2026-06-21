import { invokeCommand } from "../../shared/commands/command-client";
import type { ProjectCompletionPolicy } from "../project/project-commands";

export type IssueStatus = "backlog" | "running" | "review" | "completed";
export type AgentSessionStatus = "running" | "closed" | "crashed" | "stopped";
export type AgentSessionAttention = "none" | "requested";
export type IssueLabelScope = "project" | "global";
export type IssueAttachmentKind = "image" | "pdf" | "word" | "text" | "generic";

export interface IssueLabelRecord {
  id: number;
  name: string;
  scope: IssueLabelScope;
  projectId: number | null;
  color: string;
}

export interface IssueAttachmentRecord {
  id: number;
  issueId: number;
  displayName: string;
  relativePath: string;
  absolutePath: string;
  mimeType?: string | null;
  fileSize: number;
  kind: IssueAttachmentKind;
  isPreviewable: boolean;
  createdAt: number;
}

export interface IssueAttachmentDraftInput {
  attachmentId?: number | null;
  tempToken?: string | null;
  sourcePath?: string | null;
  displayName: string;
  mimeType?: string | null;
}

export interface IssueAttachmentPreviewRecord {
  attachmentId?: number | null;
  displayName: string;
  kind: IssueAttachmentKind;
  textContent?: string | null;
  absolutePath?: string | null;
}

export interface IssueRecord {
  id: number;
  projectId: number;
  title: string;
  description: string;
  attachments?: IssueAttachmentRecord[];
  labels?: IssueLabelRecord[];
  status: IssueStatus;
  linkedSessionId?: number | null;
  linkedSessionStatus?: AgentSessionStatus | null;
  linkedSessionAttention?: AgentSessionAttention | null;
  linkedSessionLogPath?: string | null;
  linkedSessionLatestOutput?: string | null;
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
  attachments?: IssueAttachmentDraftInput[];
  labelIds?: number[];
}

export interface UpdateIssueInput {
  projectId: number;
  issueId: number;
  title: string;
  description: string;
  attachments?: IssueAttachmentDraftInput[];
  labelIds?: number[];
}

export interface MarkIssueReviewInput {
  projectId: number;
  issueId: number;
}

export interface AdvanceIssueStatusInput {
  projectId: number;
  issueId: number;
  targetStatus: IssueStatus;
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

export interface GetIssueSummaryInput {
  projectId: number;
  issueId: number;
}

export interface DeleteIssueInput {
  projectId: number;
  issueId: number;
}

export interface DeleteIssueResult {
  issueId: number;
  linkedSessionId?: number | null;
}

export interface PreviewIssueAttachmentInput {
  projectId: number;
  attachmentId?: number;
  sourcePath?: string;
  displayName?: string;
}

export interface ExportIssueAttachmentInput {
  projectId: number;
  attachmentId?: number;
  sourcePath?: string;
  displayName?: string;
  targetPath: string;
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
  | "no_commit_detected"
  | "git_operation_blocked";

export interface DetectAgentCommitCompletionResult {
  outcome: DetectAgentCommitCompletionOutcome;
  issue: IssueRecord;
  message: string;
}

export interface IssueSummaryCompletionInfo {
  option: string;
  result: string;
  commitHash?: string | null;
  failureReason?: string | null;
  headBefore?: string | null;
  headAfter?: string | null;
  changedFilesJson?: string | null;
  createdAt: number;
  source: string;
}

export interface IssueSummaryRecord {
  issue: IssueRecord;
  sessionStartedAt?: number | null;
  sessionClosedAt?: number | null;
  completion?: IssueSummaryCompletionInfo | null;
  diagnostics: string[];
}

export interface StartAgentSessionInput {
  projectId: number;
  issueId: number;
  agentProfileId: number;
  promptSnapshot: string;
  completionPolicyOverride?: ProjectCompletionPolicy | null;
  workspaceMode?: WorkspaceMode;
  targetBranch?: string | null;
}

export interface StartAgentSessionResult {
  sessionId?: number | null;
  issueId: number;
}

export type WorkspaceMode = "current_branch" | "worktree";

export interface ProjectGitBranchListInput {
  projectId: number;
}

export interface ProjectGitBranchListResult {
  currentBranch: string;
  localBranches: string[];
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

export function advanceIssueStatus(
  input: AdvanceIssueStatusInput,
): Promise<IssueRecord> {
  return invokeCommand<IssueRecord>("advance_issue_status", { input });
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

export function getIssueSummary(
  input: GetIssueSummaryInput,
): Promise<IssueSummaryRecord> {
  return invokeCommand<IssueSummaryRecord>("get_issue_summary", {
    input,
  });
}

export function deleteIssue(
  input: DeleteIssueInput,
): Promise<DeleteIssueResult> {
  return invokeCommand<DeleteIssueResult>("delete_issue", {
    input,
  });
}

export function previewIssueAttachment(
  input: PreviewIssueAttachmentInput,
): Promise<IssueAttachmentPreviewRecord> {
  return invokeCommand<IssueAttachmentPreviewRecord>(
    "preview_issue_attachment",
    {
      input,
    },
  );
}

export function exportIssueAttachment(
  input: ExportIssueAttachmentInput,
): Promise<void> {
  return invokeCommand("export_issue_attachment", {
    input,
  });
}

export function startAgentSession(
  input: StartAgentSessionInput,
): Promise<StartAgentSessionResult> {
  return invokeCommand<StartAgentSessionResult>("start_agent_session", {
    input,
  });
}

export function getProjectGitBranches(
  input: ProjectGitBranchListInput,
): Promise<ProjectGitBranchListResult> {
  return invokeCommand<ProjectGitBranchListResult>("get_project_git_branches", {
    input,
  });
}
