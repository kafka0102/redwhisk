use serde::{Deserialize, Serialize};

use crate::types::agent_profile::AgentType;
use crate::types::agent_session_stream::{AgentMode, AgentModel, AgentTimelineItem};
use crate::types::issue::IssueStatus;
use crate::types::project::ProjectCompletionPolicy;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceMode {
    CurrentBranch,
    Worktree,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentSessionInput {
    pub project_id: i64,
    pub issue_id: i64,
    pub agent_profile_id: i64,
    pub prompt_snapshot: String,
    pub completion_policy_override: Option<ProjectCompletionPolicy>,
    pub workspace_mode: Option<WorkspaceMode>,
    pub target_branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentSessionResult {
    pub session_id: i64,
    pub issue_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartStandaloneAgentSessionInput {
    pub project_id: i64,
    pub title: String,
    pub agent_profile_id: i64,
    pub prompt_snapshot: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartStandaloneAgentSessionResult {
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAgentSessionTerminalInput {
    pub project_id: i64,
    pub session_id: i64,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAgentSessionTerminalResult {
    pub session_id: i64,
    pub snapshot: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreAgentSessionTerminalInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreAgentSessionTerminalResult {
    pub session_id: i64,
    pub sequence: u64,
    pub chunks: Vec<Vec<u8>>,
    pub is_complete: bool,
    pub is_active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteAgentSessionTerminalInput {
    pub project_id: i64,
    pub session_id: i64,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAgentSessionAttentionInput {
    pub project_id: i64,
    pub session_id: i64,
    pub attention: AgentSessionAttention,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAgentSessionAttentionResult {
    pub session_id: i64,
    pub attention: AgentSessionAttention,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InjectAgentSessionPromptInput {
    pub project_id: i64,
    pub session_id: i64,
    pub prompt: String,
    pub kind: AgentSessionPromptKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InjectAgentSessionPromptResult {
    pub session_id: i64,
    pub codex_session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeAgentSessionTerminalInput {
    pub project_id: i64,
    pub session_id: i64,
    pub rows: u16,
    pub cols: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionListResponse {
    pub sessions: Vec<AgentSessionListItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionListItem {
    pub session_id: i64,
    pub issue_id: Option<i64>,
    pub issue_title: Option<String>,
    pub issue_status: Option<IssueStatus>,
    pub agent_profile_id: i64,
    pub can_complete_clean: bool,
    pub can_complete_agent_commit: bool,
    pub title: Option<String>,
    pub agent_type: AgentType,
    pub status: AgentSessionStatus,
    pub attention: AgentSessionAttention,
    pub is_turn_running: bool,
    pub log_path: String,
    pub latest_output: Option<String>,
    pub last_active_at: i64,
    pub started_at: i64,
    pub closed_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRecord {
    pub id: i64,
    pub project_id: i64,
    pub issue_id: Option<i64>,
    pub title: Option<String>,
    pub agent_profile_id: i64,
    pub codex_session_id: Option<String>,
    pub status: AgentSessionStatus,
    pub attention: AgentSessionAttention,
    pub working_dir: String,
    pub command_snapshot: String,
    pub prompt_snapshot: String,
    pub workspace_mode: WorkspaceMode,
    pub target_branch: Option<String>,
    pub workspace_branch: Option<String>,
    pub workspace_path: Option<String>,
    pub completion_policy: Option<ProjectCompletionPolicy>,
    pub worktree_root_path: Option<String>,
    pub log_path: String,
    pub latest_output: Option<String>,
    pub last_active_at: i64,
    pub started_at: i64,
    pub closed_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSessionStatus {
    Running,
    Closed,
    Crashed,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSessionAttention {
    None,
    Requested,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSessionPromptKind {
    FollowUp,
    Completion,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitBranchListInput {
    pub project_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitBranchListResult {
    pub current_branch: String,
    pub local_branches: Vec<String>,
}

// ---------------------------------------------------------------------------
// 结构化 Agent Session（codex app-server JSON-RPC 路径）命令 DTO
//
// 与现有 PTY 路径（StartAgentSessionInput 等）并存。这些 DTO 对应任务 3
// 新增的 11 个 `#[tauri::command]`，载荷按 camelCase 序列化，与前端 TS
// 镜像（`agent-session-commands.ts`）保持一致。
// ---------------------------------------------------------------------------

/// 权限决策字面量，对应 codex server→client request 的 accept/decline/cancel。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentPermissionDecision {
    Accept,
    Decline,
    Cancel,
}

impl AgentPermissionDecision {
    pub fn from_str_literal(value: &str) -> Option<Self> {
        match value {
            "accept" => Some(Self::Accept),
            "decline" => Some(Self::Decline),
            "cancel" => Some(Self::Cancel),
            _ => None,
        }
    }
}

/// 启动结构化 Agent Session。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartStructuredAgentSessionInput {
    pub project_id: i64,
    /// 会话标题（独立会话用，关联 issue 的场景留空）。
    pub title: Option<String>,
    /// agent 类型（缺省 Codex）。决定走哪种 provider 实现。
    #[serde(default)]
    pub agent_type: Option<AgentType>,
    /// 协作模式：auto / full-access / read-only。缺省 auto。
    pub mode: Option<String>,
    /// 初始模型 id（缺省由 agent 选默认）。
    pub model: Option<String>,
    /// 初始 reasoning effort：low / medium / high。
    pub effort: Option<String>,
    /// 续接已存在的 agent threadId（缺省则新建 thread）。
    pub resume_from_codex_session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartStructuredAgentSessionResult {
    pub session_id: i64,
    pub thread_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAgentMessageInput {
    pub project_id: i64,
    pub session_id: i64,
    pub message: String,
    /// 随消息发送的附件。空 vec 表示纯文本消息（向后兼容旧前端不发该字段）。
    #[serde(default)]
    pub attachments: Vec<AgentMessageAttachment>,
}

/// 随用户消息发送的单个附件。
///
/// 协议中立类型：只携带落盘路径、展示名、种类，具体 agent 实现（codex /
/// 未来 claude）负责把它编码进各自协议的输入块。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageAttachment {
    /// `save_agent_attachment` 返回的落盘绝对路径。
    pub path: String,
    /// 经过 sanitize 的展示名。
    pub display_name: String,
    pub kind: AgentAttachmentKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAgentTurnInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondAgentPermissionInput {
    pub project_id: i64,
    pub session_id: i64,
    pub request_id: String,
    /// accept / decline / cancel。
    pub decision: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAgentModelInput {
    pub project_id: i64,
    pub session_id: i64,
    pub model_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAgentThinkingInput {
    pub project_id: i64,
    pub session_id: i64,
    /// None 表示关闭 Think 模式；Some(low|medium|high) 表示开启。
    pub effort: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAgentModeInput {
    pub project_id: i64,
    pub session_id: i64,
    pub mode_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentModelsInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentModelsResult {
    pub models: Vec<AgentModel>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentModesResult {
    pub modes: Vec<AgentMode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentModesInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentAttachmentInput {
    pub project_id: i64,
    pub session_id: i64,
    /// 前端经 `@tauri-apps/plugin-dialog` 拿到的本地源路径。
    pub source_path: String,
    /// 展示名（通常为源文件名）。
    pub display_name: String,
}

/// 附件种类字面量，镜像 `IssueAttachmentKind` 的字符串值。
///
/// 同时实现 `Serialize`（落盘结果返回）与 `Deserialize`（随消息发送入参），
/// 使 `AgentMessageAttachment` 可跨命令边界往返。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentAttachmentKind {
    Image,
    Pdf,
    Word,
    Text,
    Generic,
}

impl From<crate::types::issue::IssueAttachmentKind> for AgentAttachmentKind {
    fn from(value: crate::types::issue::IssueAttachmentKind) -> Self {
        use crate::types::issue::IssueAttachmentKind;
        match value {
            IssueAttachmentKind::Image => Self::Image,
            IssueAttachmentKind::Pdf => Self::Pdf,
            IssueAttachmentKind::Word => Self::Word,
            IssueAttachmentKind::Text => Self::Text,
            IssueAttachmentKind::Generic => Self::Generic,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentAttachmentResult {
    /// 附件落盘后的绝对路径。
    pub path: String,
    /// 经过 sanitize 的展示名。
    pub display_name: String,
    pub kind: AgentAttachmentKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAgentTimelineInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAgentTimelineResult {
    pub items: Vec<AgentTimelineItem>,
}
