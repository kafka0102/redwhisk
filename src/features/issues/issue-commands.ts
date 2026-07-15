import { invokeCommand } from "../../shared/commands/command-client";

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
  workflowSkill: string | null;
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
  /** 项目内自增编号（展示给人看）；与全局 id 区分。 */
  number: number;
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

export interface IssueStatusTotals {
  backlog: number;
  running: number;
  review: number;
  completed: number;
}

export interface IssueListResponse {
  issues: IssueRecord[];
  /** 看板首屏各状态 Issue 总数；仅 perStatusLimit 路径返回。 */
  statusTotals?: IssueStatusTotals;
}

export type IssueTimelineActionType =
  | "issue_created"
  | "agent_session_started"
  | "issue_review_marked"
  | "issue_status_changed"
  | "issue_completed";

export interface IssueTimelineActor {
  name: string;
  avatarPath?: string | null;
  /** 操作者类型：`user` 或 `agent`，前端按此切换头像来源。 */
  actorKind: string;
  /** Agent 操作者的类型（如 `codex` / `claude`）；用户操作者为 `undefined`。 */
  agentType?: string;
}

export interface IssueTimelineEntry {
  actionType: IssueTimelineActionType;
  actor: IssueTimelineActor;
  createdAt: number;
}

export interface IssueTimelineResponse {
  entries: IssueTimelineEntry[];
}

export interface GetIssueTimelineInput {
  projectId: number;
  issueId: number;
}

export interface ListIssuesInput {
  projectId: number;
  /** 滚动加载下一页时按状态过滤。 */
  status?: IssueStatus;
  /** 单页条数。 */
  limit?: number;
  /** 偏移量，与 limit 配合实现分页。 */
  offset?: number;
  /** 看板首屏：四个状态各自取前 N 条，单次返回扁平列表。 */
  perStatusLimit?: number;
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

export interface DeleteIssueWorktreeCleanup {
  repoPath: string;
  workspacePath: string;
  workspaceBranch: string;
}

export interface DeleteIssueResult {
  issueId: number;
  linkedSessionId?: number | null;
  linkedSessionLogPath?: string | null;
  worktreeCleanup?: DeleteIssueWorktreeCleanup | null;
}

export interface GetIssueWorktreeStatusInput {
  projectId: number;
  issueId: number;
}

/** Issue 关联 worktree 的残留状态（后端 `IssueWorktreeStatusResult`）。 */
export interface IssueWorktreeStatusResult {
  exists: boolean;
  canDelete: boolean;
  workspacePath?: string | null;
  workspaceBranch?: string | null;
}

export interface DeleteIssueWorktreeInput {
  projectId: number;
  issueId: number;
}

export interface DeleteIssueWorktreeResult {
  issueId: number;
  deleted: boolean;
  workspacePath?: string | null;
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

export interface SaveIssueAttachmentDraftInput {
  sourcePath: string;
  displayName: string;
}

export interface SaveIssueAttachmentDraftResult {
  path: string;
  displayName: string;
  kind: IssueAttachmentKind;
  isPreviewable: boolean;
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
  | "commit_detected"
  | "git_operation_blocked";

export interface DetectAgentCommitCompletionResult {
  outcome: DetectAgentCommitCompletionOutcome;
  issue: IssueRecord;
  message: string;
}

/** dirty 工作区三选项。 */
export type DirtyWorkspaceOption = "auto_commit" | "skip" | "cancel";

/** 完成流程 phase（与后端 `IssueCompletionPhase` 对应）。 */
export type IssueCompletionPhase =
  | "detecting_workspace"
  | "prompting_dirty_decision"
  | "auto_committing"
  | "confirming_continue_after_commit"
  | "reconciling_worktree"
  | "confirming_worktree_cleanup"
  | "completed"
  | "cancelled"
  | "blocked";

export type CompleteIssueFlowAction =
  | "completed"
  | "prompt_dirty_decision"
  | "waiting_auto_commit"
  | "confirm_continue_after_commit"
  | "confirm_worktree_cleanup"
  | "blocked"
  | "cancelled";

export interface CompleteIssueFlowInput {
  projectId: number;
  issueId: number;
  /** dirty 三选项；仅在与 `prompting_dirty_decision` 继续时使用。 */
  dirtyDecision?: DirtyWorkspaceOption | null;
  /** 用户选了「不提交（忽略未提交改动）」。 */
  ignoreDirty?: boolean | null;
  /** 用户在弹框中确认/修正的分支名（情况三/session 关闭时手填兜底）。 */
  branchName?: string | null;
  /** 用户在弹框中确认/修正的实际执行路径（兜底用）。 */
  actualPath?: string | null;
  /** 「确定继续标记完成吗」确认；仅在 `confirming_continue_after_commit` 继续时使用。 */
  continueAfterCommit?: boolean | null;
  /** External worktree 删除确认；仅在 `confirming_worktree_cleanup` 继续时使用。 */
  worktreeCleanupDecision?: boolean | null;
}

export interface IssueCompletionFlowRecord {
  id: number;
  issueId: number;
  sessionId?: number | null;
  phase: IssueCompletionPhase;
  ignoreDirty: boolean;
  dirtyDecision?: DirtyWorkspaceOption | null;
  continueAfterCommit?: boolean | null;
  worktreeCleanupDecision?: boolean | null;
  baseBranch?: string | null;
  workspaceBranch?: string | null;
  workspacePath?: string | null;
  actualPath?: string | null;
  failureReason?: string | null;
  updatedAt: number;
}

export interface CompleteIssueFlowResult {
  action: CompleteIssueFlowAction;
  issue: IssueRecord;
  flow?: IssueCompletionFlowRecord | null;
  message: string;
  mergeBlockReason?: string | null;
  /** 弹框预填的基线分支（origin / workspace 分支）。 */
  targetBranch?: string | null;
  workspaceBranch?: string | null;
  workspacePath?: string | null;
  /** 完成时解析出的实际执行路径。 */
  actualPath?: string | null;
  /** 实际路径与启动快照不同（运行中漂移到新 worktree）。 */
  drifted: boolean;
  sessionId?: number | null;
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
  workflowSkillName?: string | null;
  workspaceMode?: WorkspaceMode;
  targetBranch?: string | null;
  worktreeSetupCommand?: string | null;
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
    status: input.status,
    limit: input.limit,
    offset: input.offset,
    perStatusLimit: input.perStatusLimit,
  });
}

export function createIssue(input: CreateIssueInput): Promise<IssueRecord> {
  return invokeCommand<IssueRecord>("create_issue", { input });
}

export function getIssueTimeline(
  input: GetIssueTimelineInput,
): Promise<IssueTimelineResponse> {
  return invokeCommand<IssueTimelineResponse>("get_issue_timeline", { input });
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

export function completeIssueFlow(
  input: CompleteIssueFlowInput,
): Promise<CompleteIssueFlowResult> {
  return invokeCommand<CompleteIssueFlowResult>("complete_issue_flow", {
    input,
  });
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

export function getIssueWorktreeStatus(
  input: GetIssueWorktreeStatusInput,
): Promise<IssueWorktreeStatusResult> {
  return invokeCommand<IssueWorktreeStatusResult>("get_issue_worktree_status", {
    input,
  });
}

export function deleteIssueWorktree(
  input: DeleteIssueWorktreeInput,
): Promise<DeleteIssueWorktreeResult> {
  return invokeCommand<DeleteIssueWorktreeResult>("delete_issue_worktree", {
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

export function saveIssueAttachmentDraft(
  input: SaveIssueAttachmentDraftInput,
): Promise<SaveIssueAttachmentDraftResult> {
  return invokeCommand<SaveIssueAttachmentDraftResult>(
    "save_issue_attachment_draft",
    { input },
  );
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
