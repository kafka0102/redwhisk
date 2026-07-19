/**
 * Rust 类型名 → TS interface 名映射。
 * 仅登记「名字不同但契约对应」的对；未登记的 Rust 类型要求 TS 侧存在同名 interface。
 *
 * 根因分两类：
 * - 历史命名差异（前端先于后端定型，前端名沿用下来）
 * - Rust 用 struct 名 + TS 用 type alias 指向同 shape 的另一类型
 */
export const rustToTsName: Record<string, string> = {
  // Rust 用 ProjectSummary（聚合 + codeWorkspaces），前端历史用 ProjectRecord 表示同一 IPC 负载。
  ProjectSummary: "ProjectRecord",

  // issue 域：Rust struct 名聚焦「跨边界负载」，TS 沿用前端 form / preview 命名。
  // IssueAttachmentInput(Rust) ↔ IssueAttachmentDraftInput(TS)：同 shape（attachmentId/tempToken/sourcePath/displayName/mimeType）。
  IssueAttachmentInput: "IssueAttachmentDraftInput",
  // IssueAttachmentPreview(Rust) ↔ IssueAttachmentPreviewRecord(TS)：同 shape，TS 缺 isPreviewable 字段在 Task 4 补齐。
  IssueAttachmentPreview: "IssueAttachmentPreviewRecord",

  // project_terminal 域：Rust CreateProjectTerminalResult 与 ProjectTerminalSummary 字段完全一致，
  // TS 用 `type CreateProjectTerminalResult = ProjectTerminalSummary` 别名，parity 检查时映射到具名 interface。
  CreateProjectTerminalResult: "ProjectTerminalSummary",

  // agent_session 域：Rust enum 名聚焦「决策 / 类型」，TS union 字面量沿用前端 `*Literal` 命名。
  AgentPermissionDecision: "AgentPermissionDecisionLiteral",
  AgentAttachmentKind: "AgentAttachmentKindLiteral",
};

/**
 * Rust 侧存在、但前端不需要 mirror 的类型白名单。
 *
 * 登记准则（AGENTS.md §6）：每条必须有「根因」注释，说明前端为何不需要 typed mirror：
 * - Rust 内部辅助类型（不跨 IPC 边界）；
 * - 跨 Tauri event 边界但前端无消费方；
 * - TS 用动态类型（string / index signature / inline literal）覆盖契约；
 * - serde flatten 等无法用 TS interface 直接 mirror 的特殊语义。
 */
export const rustOnlyAllowlist: ReadonlySet<string> = new Set<string>([
  // ===== issue 域：Rust 内部 DB / 视图模型派生源 =====
  // issue_actions 表的原始行（含 payloadJson）；前端消费的是后端派生的视图模型
  // IssueTimelineEntry / IssueTimelineActionType，不直接读 IssueActionRecord。
  "IssueActionRecord",
  "IssueActionType",

  // ===== agent_session 域：Rust service 内部 =====
  // AgentSessionRecord 仅在 Rust service 内部作为数据载体（find_project_session 等返回），
  // IPC 命令返回的是 AgentSessionListItem 投影。前端从不直接消费 AgentSessionRecord。
  "AgentSessionRecord",

  // AgentSkillsUpdatedEvent 经 `app.emit(AGENT_SKILLS_UPDATED_EVENT, ...)` 广播，
  // 但前端无任何 listen 订阅（前端走 refreshAgentSkills 命令主动拉取）。
  "AgentSkillsUpdatedEvent",

  // ===== completion_attempt：Rust DB 记录，前端用视图模型 =====
  // issue_completion_attempts 表的原始行；前端展示用 IssueSummaryCompletionInfo（聚合视图）。
  "CompletionAttemptRecord",
  "CompletionAttemptOption",
  "CompletionAttemptResult",

  // ===== session_event：Rust DB 记录，前端用结构化事件流 =====
  // session_events 表的原始行（含 payloadJson）；前端消费结构化的 AgentStreamEvent 等，
  // 不直接读 SessionEventRecord。
  "SessionEventRecord",
  "SessionEventType",

  // ===== project_terminal_config：Rust 内部配置载体 =====
  // ProjectTerminalConfig 仅在 Rust service 内部使用；IPC 命令返回 ProjectTerminalSummary 投影，
  // 前端不直接消费 config 行。
  "ProjectTerminalConfig",

  // ===== errors 域 =====
  // CommandError 的 TS mirror 在 src/shared/commands/command-error.ts（不在 *-commands.ts 范围），
  // 字段（code/message/reason?/details?）与 Rust 完全匹配；TS 用 `code: string` 而非 enum，
  // 因为 CommandErrorCode 字面量散布在各处错误处理代码中按需引用。
  "CommandError",
  "CommandErrorCode",
  // ErrorDetail 用 `#[serde(flatten)]`：Rust 结构体（detail_type + values）序列化为
  // `{"@type": "...", ...flattened values}`。TS 侧用 CommandErrorDetail 的 index signature
  // (`[key: string]: unknown`) 覆盖，无法用普通 interface mirror。flatten 语义无法在 parity
  // 工具中表达，登记 allowlist 跳过。
  "ErrorDetail",

  // ===== session_workspace 域 =====
  // WorkspaceFileTreeNode.kind 用内联字面量 `"directory" | "file"`，未抽成具名 union；
  // parity 工具看不到内联字面量集合，登记 allowlist 跳过（前端已正确表达契约）。
  "WorkspaceFileTreeNodeKind",
]);
