import { invokeCommand } from "../../shared/commands/command-client";
import type {
  AgentAttachmentKindLiteral,
  ListAgentModelsResult,
  ListAgentModesResult,
  ReadAgentTimelineResult,
  SaveAgentAttachmentResult,
} from "./agent-stream-types";

export type AgentType = "codex" | "claude" | "claude_code";
export type AgentSessionStatus = "running" | "closed" | "crashed" | "stopped";
export type AgentSessionAttention = "none" | "requested";
export type IssueStatus = "backlog" | "running" | "review" | "completed";
export type WorkspaceMode = "current_branch" | "worktree";

export interface AgentSessionListItem {
  sessionId: number;
  /** 项目内 session 自增编号（用于日志命名等，不在 UI 展示）。 */
  number: number;
  projectId?: number;
  issueId: number | null;
  /** 关联 Issue 的项目内编号（展示用）；与全局 issueId 区分。无关联 Issue 时为 null。 */
  issueNumber: number | null;
  issueTitle: string | null;
  issueStatus?: IssueStatus | null;
  agentProfileId?: number;
  agentProfileName?: string | null;
  workflowSkillName?: string | null;
  canCompleteClean?: boolean;
  canCompleteAgentCommit?: boolean;
  title: string | null;
  agentType: AgentType;
  status: AgentSessionStatus;
  attention: AgentSessionAttention;
  isTurnRunning?: boolean;
  workspaceMode?: WorkspaceMode;
  workingDir?: string;
  workspacePath?: string | null;
  originBranch?: string | null;
  workspaceBranch?: string | null;
  logPath?: string | null;
  latestOutput?: string | null;
  lastActiveAt: number;
  startedAt: number;
  closedAt: number | null;
  processingMs?: number;
  lastOutputAt?: number | null;
}

export interface AgentSessionListResponse {
  sessions: AgentSessionListItem[];
}

export interface SetAgentSessionAttentionInput {
  projectId: number;
  sessionId: number;
  attention: AgentSessionAttention;
}

export interface SetAgentSessionAttentionResult {
  sessionId: number;
  attention: AgentSessionAttention;
}

export type AgentSessionPromptKind = "follow_up" | "completion";

export interface InjectAgentSessionPromptInput {
  projectId: number;
  sessionId: number;
  prompt: string;
  kind: AgentSessionPromptKind;
}

export interface InjectAgentSessionPromptResult {
  sessionId: number;
  codexSessionId: string | null;
}

export interface DeleteAgentSessionInput {
  projectId: number;
  sessionId: number;
}

export interface DeleteAgentSessionResult {
  sessionId: number;
}

export interface UpdateAgentSessionTitleInput {
  projectId: number;
  sessionId: number;
  title: string;
}

export interface UpdateAgentSessionTitleResult {
  sessionId: number;
  title: string;
}

export function listAgentSessions(
  projectId: number,
  options?: { status?: AgentSessionStatus },
): Promise<AgentSessionListResponse> {
  return invokeCommand<AgentSessionListResponse>("list_agent_sessions", {
    projectId,
    status: options?.status,
  });
}

export function setAgentSessionAttention(
  input: SetAgentSessionAttentionInput,
): Promise<SetAgentSessionAttentionResult> {
  return invokeCommand<SetAgentSessionAttentionResult>(
    "set_agent_session_attention",
    { input },
  );
}

export function injectAgentSessionPrompt(
  input: InjectAgentSessionPromptInput,
): Promise<InjectAgentSessionPromptResult> {
  return invokeCommand<InjectAgentSessionPromptResult>(
    "inject_agent_session_prompt",
    { input },
  );
}

export function deleteAgentSession(
  input: DeleteAgentSessionInput,
): Promise<DeleteAgentSessionResult> {
  return invokeCommand<DeleteAgentSessionResult>("delete_agent_session", {
    input,
  });
}

export function updateAgentSessionTitle(
  input: UpdateAgentSessionTitleInput,
): Promise<UpdateAgentSessionTitleResult> {
  return invokeCommand<UpdateAgentSessionTitleResult>(
    "update_agent_session_title",
    {
      input,
    },
  );
}

// ---------------------------------------------------------------------------
// 结构化 Agent Session（codex app-server JSON-RPC 路径）命令
//
// 与上面 PTY 路径的命令并存。这些命令对应任务 3 新增的 11 个 Rust
// `#[tauri::command]`，DTO 与 `src-tauri/src/types/agent_session.rs` 镜像。
// 事件流类型见 `agent-stream-types.ts`（镜像
// `src-tauri/src/types/agent_session_stream.rs`）。
// ---------------------------------------------------------------------------

export type AgentPermissionDecisionLiteral = "accept" | "decline" | "cancel";
export type { AgentAttachmentKindLiteral } from "./agent-stream-types";

export interface StartStructuredAgentSessionInput {
  projectId: number;
  title?: string;
  /** agent 类型，缺省 codex。决定走哪种 provider 实现。 */
  agentType?: AgentType;
  /** agent profile id，优先使用对应 profile 的配置。 */
  agentProfileId?: number;
  /** auto / full-access / read-only，缺省 full-access。 */
  mode?: string;
  /** 初始模型 id，缺省由 agent 选默认。 */
  model?: string;
  /** reasoning effort 由 Agent 模型声明，常见值为 low / medium / high / xhigh。 */
  effort?: string;
  /** 续接已存在的 agent threadId，缺省则新建 thread。 */
  resumeFromCodexSessionId?: string;
}

export interface StartStructuredAgentSessionResult {
  sessionId: number;
  threadId: string;
}

export interface ResumeStructuredAgentSessionInput {
  projectId: number;
  sessionId: number;
}

export interface ResumeStructuredAgentSessionResult {
  sessionId: number;
  threadId: string;
}

export interface AgentMessageAttachment {
  /** `saveAgentAttachment` 返回的落盘绝对路径。 */
  path: string;
  /** 经过 sanitize 的展示名。 */
  displayName: string;
  kind: AgentAttachmentKindLiteral;
}

export interface SendAgentMessageInput {
  projectId: number;
  sessionId: number;
  message: string;
  /** 随消息发送的已落盘附件；空数组表示纯文本消息。 */
  attachments: AgentMessageAttachment[];
}

export interface CancelAgentTurnInput {
  projectId: number;
  sessionId: number;
}

export interface RespondAgentPermissionInput {
  projectId: number;
  sessionId: number;
  requestId: string;
  /** accept / decline / cancel。 */
  decision: AgentPermissionDecisionLiteral;
}

export interface SetAgentModelInput {
  projectId: number;
  sessionId: number;
  modelId: string;
}

export interface SetAgentThinkingInput {
  projectId: number;
  sessionId: number;
  /** reasoning effort 由 Agent 模型声明，常见值为 low / medium / high / xhigh。 */
  effort?: string;
}

export interface SetAgentModeInput {
  projectId: number;
  sessionId: number;
  modeId: string;
}

export interface ListAgentModelsInput {
  projectId: number;
  sessionId: number;
}

export interface ListAgentModesInput {
  projectId: number;
  sessionId: number;
}

export interface SaveAgentAttachmentInput {
  projectId: number;
  sessionId: number;
  /** 本地源路径（由 `@tauri-apps/plugin-dialog` 的 open() 返回）。 */
  sourcePath: string;
  displayName: string;
}

export interface ReadAgentTimelineInput {
  projectId: number;
  sessionId: number;
}

export function startStructuredAgentSession(
  input: StartStructuredAgentSessionInput,
): Promise<StartStructuredAgentSessionResult> {
  return invokeCommand<StartStructuredAgentSessionResult>(
    "start_structured_agent_session",
    { input },
  );
}

export function resumeStructuredAgentSession(
  input: ResumeStructuredAgentSessionInput,
): Promise<ResumeStructuredAgentSessionResult> {
  return invokeCommand<ResumeStructuredAgentSessionResult>(
    "resume_structured_agent_session",
    { input },
  );
}

export function sendAgentMessage(input: SendAgentMessageInput): Promise<void> {
  return invokeCommand("send_agent_message", { input });
}

export function cancelAgentTurn(input: CancelAgentTurnInput): Promise<void> {
  return invokeCommand("cancel_agent_turn", { input });
}

export function respondAgentPermission(
  input: RespondAgentPermissionInput,
): Promise<void> {
  return invokeCommand("respond_agent_permission", { input });
}

export function setAgentModel(input: SetAgentModelInput): Promise<void> {
  return invokeCommand("set_agent_model", { input });
}

export function setAgentThinking(input: SetAgentThinkingInput): Promise<void> {
  return invokeCommand("set_agent_thinking", { input });
}

export function setAgentMode(input: SetAgentModeInput): Promise<void> {
  return invokeCommand("set_agent_mode", { input });
}

export function listAgentModels(
  input: ListAgentModelsInput,
): Promise<ListAgentModelsResult> {
  return invokeCommand<ListAgentModelsResult>("list_agent_models", { input });
}

export function listAgentModes(
  input: ListAgentModesInput,
): Promise<ListAgentModesResult> {
  return invokeCommand<ListAgentModesResult>("list_agent_modes", { input });
}

export function saveAgentAttachment(
  input: SaveAgentAttachmentInput,
): Promise<SaveAgentAttachmentResult> {
  return invokeCommand<SaveAgentAttachmentResult>("save_agent_attachment", {
    input,
  });
}

export function readAgentTimeline(
  input: ReadAgentTimelineInput,
): Promise<ReadAgentTimelineResult> {
  return invokeCommand<ReadAgentTimelineResult>("read_agent_timeline", {
    input,
  });
}
