// Codex session 结构化事件流的跨边界类型契约（TS 镜像）。
//
// 镜像 `src-tauri/src/types/agent_session_stream.rs`。命名约定：
// - union 用 `type` 字段做 snake_case 判别（与 Rust serde tag 一致）
// - enum 字面量用 snake_case 字符串联合
// - struct 用 camelCase interface
//
// 供 message-stream（任务 4）与 composer（任务 5）消费；本文件只定义
// 类型，不包含运行时逻辑。

// ---------------------------------------------------------------------------
// 顶层结构化事件（对应 `agent-session-stream-event` 广播载荷的 `event` 字段）
// ---------------------------------------------------------------------------

export type AgentStreamEvent =
  | { type: "thread_started"; threadId: string }
  | { type: "turn_started"; turnId: string | null }
  | {
      type: "turn_completed";
      turnId: string | null;
      usage: AgentUsage | null;
      /** SDK result.stop_reason（正常 end_turn）。异常终止时为 max_tokens / 空值等。 */
      stopReason?: string | null;
      /** SDK result.subtype（success / error_max_tokens 等）。 */
      subtype?: string | null;
    }
  | {
      type: "turn_failed";
      turnId: string | null;
      error: string;
      code?: string;
    }
  | { type: "turn_canceled"; turnId: string | null; reason: string }
  | {
      type: "timeline";
      item: AgentTimelineItem;
      turnId?: string;
      seq: number;
      timestamp: number;
    }
  | { type: "usage_updated"; usage: AgentUsage }
  | { type: "permission_requested"; request: AgentPermissionRequest }
  | { type: "permission_resolved"; requestId: string; resolution: string }
  | {
      type: "mode_changed";
      currentModeId: string;
      availableModes: AgentMode[];
    }
  | { type: "model_changed"; modelId: string }
  | { type: "effort_changed"; effort: string | null };

// ---------------------------------------------------------------------------
// 广播载荷 envelope
// ---------------------------------------------------------------------------

export interface AgentStreamEventEnvelope {
  projectId: number;
  sessionId: number;
  seq: number;
  epoch: string;
  event: AgentStreamEvent;
}

// ---------------------------------------------------------------------------
// Timeline 项（消息流核心载荷）
// ---------------------------------------------------------------------------

export type AgentTimelineItem =
  | {
      type: "user_message";
      text: string;
      messageId?: string;
    }
  | {
      type: "assistant_message";
      text: string;
      messageId?: string;
    }
  | { type: "reasoning"; text: string; durationMs?: number }
  | {
      type: "tool_call";
      callId: string;
      name: string;
      detail: ToolCallDetail;
      status: ToolCallStatus;
      error?: string;
    }
  | { type: "todo"; items: TodoItem[] }
  | { type: "error"; message: string }
  | { type: "compaction"; status: CompactionStatus };

export type ToolCallDetail =
  | {
      type: "shell";
      command: string;
      output?: string;
      exitCode?: number;
    }
  | { type: "read"; path: string; content?: string }
  | { type: "edit"; path: string; diff?: string }
  | { type: "write"; path: string; content?: string }
  | {
      type: "search";
      query: string;
      mode: SearchMode;
      matches: string[];
    }
  | { type: "sub_agent"; childSessionId?: string }
  | { type: "plan"; text: string }
  | { type: "unknown"; rawInput?: string; rawOutput?: string };

export type ToolCallStatus = "running" | "completed" | "failed" | "canceled";
export type SearchMode = "content" | "files_with_matches" | "count";
export type CompactionStatus = "loading" | "completed";

export interface TodoItem {
  text: string;
  completed: boolean;
}

// ---------------------------------------------------------------------------
// Token / 上下文窗口用量
// ---------------------------------------------------------------------------

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  contextWindowMaxTokens?: number;
  contextWindowUsedTokens?: number;
}

// ---------------------------------------------------------------------------
// 权限请求（server→client request 归一化）
// ---------------------------------------------------------------------------

export interface AgentPermissionRequest {
  id: string;
  turnId?: string;
  kind: PermissionKind;
  title?: string;
  description?: string;
  actions: AgentPermissionAction[];
}

export type PermissionKind = "tool" | "plan" | "question" | "mode" | "other";

export interface AgentPermissionAction {
  id: string;
  label: string;
  behavior: PermissionBehavior;
}

export type PermissionBehavior = "allow" | "deny";

// ---------------------------------------------------------------------------
// 协作模式 / 模型
// ---------------------------------------------------------------------------

export interface AgentMode {
  modeId: string;
  name?: string;
}

export interface AgentModel {
  modelId: string;
  displayName?: string;
  isDefault?: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts: string[];
}

// ---------------------------------------------------------------------------
// 命令结果类型（镜像 `types/agent_session.rs` 的 List*Result /
// Save*Result，与 `agent-session-commands.ts` 配套）
// ---------------------------------------------------------------------------

export interface ListAgentModelsResult {
  models: AgentModel[];
  /** 模型列表是否只读（第三方接口不允许切换）。 */
  isReadOnly?: boolean;
}

export interface ListAgentModesResult {
  modes: AgentMode[];
}

export interface SaveAgentAttachmentResult {
  path: string;
  displayName: string;
  kind: AgentAttachmentKindLiteral;
}

export interface ReadAgentTimelineResult {
  items: AgentTimelineItem[];
  effort: string | null;
}

export type AgentAttachmentKindLiteral =
  | "image"
  | "pdf"
  | "word"
  | "text"
  | "generic";
