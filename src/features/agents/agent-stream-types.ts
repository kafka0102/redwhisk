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
      /** 这一条最新一次快照在会话日志中的起始字节。 */
      logOffset?: number;
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
  /** 刚写入的会话日志行起始字节。只在实时广播里出现。 */
  logOffset?: number;
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
      /** 子智能体 thread id。缺省表示主智能体。 */
      subagentId?: string;
    }
  | {
      type: "reasoning";
      text: string;
      durationMs?: number;
      /** 子智能体 thread id。缺省表示主智能体。 */
      subagentId?: string;
    }
  | {
      type: "tool_call";
      callId: string;
      name: string;
      detail: ToolCallDetail;
      status: ToolCallStatus;
      error?: string;
      /** 子智能体 thread id。缺省表示主智能体。 */
      subagentId?: string;
    }
  | { type: "todo"; items: TodoItem[] }
  | { type: "error"; message: string }
  | {
      type: "compaction";
      status: CompactionStatus;
      /** 子智能体 thread id。缺省表示主智能体。 */
      subagentId?: string;
    }
  | {
      type: "subagent_roster";
      subagentId: string;
      status: SubagentRosterStatus;
    };

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
  | {
      type: "collab_agent";
      prompt?: string;
      receiverThreadIds: string[];
      senderThreadId?: string;
    }
  | { type: "plan"; text: string }
  | { type: "unknown"; rawInput?: string; rawOutput?: string };

export type ToolCallStatus = "running" | "completed" | "failed" | "canceled";
export type SearchMode = "content" | "files_with_matches" | "count";
export type CompactionStatus = "loading" | "completed";
export type SubagentRosterStatus = "running" | "ended";

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
  sessionTokenInput?: number;
  sessionTokenOutput?: number;
  sessionTokenCache?: number;
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
  /** 发给 LLM 的模型参数；缺省时与 modelId 相同。 */
  wireModel?: string;
  displayName?: string;
  isDefault?: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts: string[];
}

// ---------------------------------------------------------------------------
// 命令结果类型（镜像 `types/agent_session.rs` 的 List*Result /
// Save*Result，与 `agent-session-commands.ts` 配套）
// ---------------------------------------------------------------------------

/** Agent UI 能力投影，由后端 list_agent_models 下发（与 Rust AgentUiCapabilities 对齐）。 */
export interface AgentUiCapabilities {
  modelTypeLabel: string;
  canShowModel: boolean;
  supportsModelSwitching: boolean;
  supportsReasoningEffort: boolean;
  supportsModes: boolean;
  /** 是否支持 TUI 路径的 Agent Session 续接（ADR-0033）。 */
  supportsTuiResume: boolean;
}

export interface ListAgentModelsResult {
  models: AgentModel[];
  /** 模型列表是否只读（第三方接口不允许切换）。 */
  isReadOnly?: boolean;
  /** Provider UI 能力（模型展示 / Think / modes 等）。 */
  capabilities: AgentUiCapabilities;
}

export interface ListAgentModesResult {
  modes: AgentMode[];
}

export interface SaveAgentAttachmentResult {
  path: string;
  displayName: string;
  kind: AgentAttachmentKindLiteral;
}

export interface TimelineHistoryItem {
  item: AgentTimelineItem;
  /** 这一条最新一次快照在会话日志中的起始字节。 */
  logOffset?: number | null;
  /** 写入这条快照时所属的 Turn。新 Turn 以 `turn_started` 计。 */
  turnId?: string | null;
}

export interface ReadAgentTimelineResult {
  items: TimelineHistoryItem[];
  effort: string | null;
  model: string | null;
  /** 打开窗口内最后一条快照的起始字节。没有条目时缺省。 */
  windowEndOffset?: number | null;
  /** 游标对不上当前日志时，调用方应整份替换。 */
  resetRequired?: boolean;
  /** 打开窗口内仍待用户审批的请求（已被解决的不会出现）。 */
  pendingPermissions?: AgentPermissionRequest[];
}

export type AgentAttachmentKindLiteral =
  | "image"
  | "pdf"
  | "word"
  | "text"
  | "generic";
