import { invokeCommand } from "../../shared/commands/command-client";
import type {
  ListAgentModelsResult,
  ListAgentModesResult,
  ReadAgentTimelineResult,
  SaveAgentAttachmentResult,
} from "./agent-stream-types";

export type AgentType = "codex" | "claude" | "claude_code";
export type AgentSessionStatus = "running" | "closed" | "crashed" | "stopped";
export type AgentSessionAttention = "none" | "requested";
export type IssueStatus = "backlog" | "running" | "review" | "completed";

export interface AgentSessionListItem {
  sessionId: number;
  issueId: number | null;
  issueTitle: string | null;
  issueStatus?: IssueStatus | null;
  agentProfileId?: number;
  canCompleteClean?: boolean;
  canCompleteAgentCommit?: boolean;
  title: string | null;
  agentType: AgentType;
  status: AgentSessionStatus;
  attention: AgentSessionAttention;
  logPath?: string | null;
  latestOutput?: string | null;
  lastActiveAt: number;
  startedAt: number;
  closedAt: number | null;
}

export interface AgentSessionListResponse {
  sessions: AgentSessionListItem[];
}

export interface ReadAgentSessionTerminalInput {
  projectId: number;
  sessionId: number;
  maxBytes?: number;
}

export interface ReadAgentSessionTerminalResult {
  sessionId: number;
  snapshot: string;
  isActive: boolean;
}

export interface RestoreAgentSessionTerminalInput {
  projectId: number;
  sessionId: number;
}

export interface RestoreAgentSessionTerminalResult {
  sessionId: number;
  sequence: number;
  chunks: number[][];
  isComplete: boolean;
  isActive: boolean;
}

export interface WriteAgentSessionTerminalInput {
  projectId: number;
  sessionId: number;
  data: string;
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

export interface ResizeAgentSessionTerminalInput {
  projectId: number;
  sessionId: number;
  rows: number;
  cols: number;
}

export interface StartStandaloneAgentSessionInput {
  projectId: number;
  title: string;
  agentProfileId: number;
  promptSnapshot: string;
}

export interface StartStandaloneAgentSessionResult {
  sessionId: number;
}

export function listAgentSessions(
  projectId: number,
): Promise<AgentSessionListResponse> {
  return invokeCommand<AgentSessionListResponse>("list_agent_sessions", {
    projectId,
  });
}

export function readAgentSessionTerminal(
  input: ReadAgentSessionTerminalInput,
): Promise<ReadAgentSessionTerminalResult> {
  return invokeCommand<ReadAgentSessionTerminalResult>(
    "read_agent_session_terminal",
    { input },
  );
}

export function writeAgentSessionTerminal(
  input: WriteAgentSessionTerminalInput,
): Promise<void> {
  return invokeCommand("write_agent_session_terminal", { input });
}

export function restoreAgentSessionTerminal(
  input: RestoreAgentSessionTerminalInput,
): Promise<RestoreAgentSessionTerminalResult> {
  return invokeCommand<RestoreAgentSessionTerminalResult>(
    "restore_agent_session_terminal",
    { input },
  );
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

export function resizeAgentSessionTerminal(
  input: ResizeAgentSessionTerminalInput,
): Promise<void> {
  return invokeCommand("resize_agent_session_terminal", { input });
}

export function startStandaloneAgentSession(
  input: StartStandaloneAgentSessionInput,
): Promise<StartStandaloneAgentSessionResult> {
  return invokeCommand<StartStandaloneAgentSessionResult>(
    "start_standalone_agent_session",
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
  /** auto / full-access / read-only，缺省 auto。 */
  mode?: string;
  /** 初始模型 id，缺省由 codex 选默认。 */
  model?: string;
  /** low / medium / high。 */
  effort?: string;
  /** 续接已存在的 codex threadId，缺省则新建 thread。 */
  resumeFromCodexSessionId?: string;
}

export interface StartStructuredAgentSessionResult {
  sessionId: number;
  threadId: string;
}

export interface SendAgentMessageInput {
  projectId: number;
  sessionId: number;
  message: string;
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
  /** undefined 表示关闭 Think；low/medium/high 表示开启。 */
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

export function listAgentModes(): Promise<ListAgentModesResult> {
  return invokeCommand<ListAgentModesResult>("list_agent_modes");
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
