use serde::{Deserialize, Serialize};

use crate::types::agent_profile::AgentType;
use crate::types::agent_session_stream::{AgentMode, AgentModel, AgentTimelineItem};
use crate::types::issue::IssueStatus;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceMode {
    CurrentBranch,
    Worktree,
}

pub fn workspace_mode_to_str(value: &WorkspaceMode) -> &'static str {
    match value {
        WorkspaceMode::CurrentBranch => "current_branch",
        WorkspaceMode::Worktree => "worktree",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeOwner {
    Redwhisk,
    External,
}

impl WorktreeOwner {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Redwhisk => "redwhisk",
            Self::External => "external",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentSessionInput {
    pub project_id: i64,
    pub issue_id: i64,
    pub agent_profile_id: i64,
    pub prompt_snapshot: String,
    pub workflow_skill_name: Option<String>,
    pub workspace_mode: Option<WorkspaceMode>,
    pub target_branch: Option<String>,
    pub worktree_setup_command: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentSessionResult {
    pub session_id: i64,
    pub issue_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAgentSessionInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAgentSessionResult {
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentSessionTitleInput {
    pub project_id: i64,
    pub session_id: i64,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentSessionTitleResult {
    pub session_id: i64,
    pub title: String,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionListResponse {
    pub sessions: Vec<AgentSessionListItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionListItem {
    pub session_id: i64,
    pub number: i64,
    pub project_id: i64,
    pub issue_id: Option<i64>,
    pub issue_number: Option<i64>,
    pub issue_title: Option<String>,
    pub issue_status: Option<IssueStatus>,
    pub agent_profile_id: i64,
    pub agent_profile_name: String,
    pub can_complete_clean: bool,
    pub can_complete_agent_commit: bool,
    pub title: Option<String>,
    pub agent_type: AgentType,
    pub display_mode: String,
    pub status: AgentSessionStatus,
    pub attention: AgentSessionAttention,
    pub is_turn_running: bool,
    pub workspace_mode: WorkspaceMode,
    pub working_dir: String,
    pub workspace_path: Option<String>,
    pub origin_branch: Option<String>,
    pub workspace_branch: Option<String>,
    pub worktree_owner: WorktreeOwner,
    pub log_path: String,
    pub latest_output: Option<String>,
    pub workflow_skill_name: Option<String>,
    pub last_active_at: i64,
    pub started_at: i64,
    pub closed_at: Option<i64>,
    pub processing_ms: i64,
    pub last_output_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRecord {
    pub id: i64,
    pub number: i64,
    pub project_id: i64,
    pub issue_id: Option<i64>,
    pub title: Option<String>,
    pub agent_profile_id: i64,
    pub workflow_skill_name: Option<String>,
    pub codex_session_id: Option<String>,
    pub status: AgentSessionStatus,
    pub attention: AgentSessionAttention,
    pub working_dir: String,
    pub command_snapshot: String,
    pub prompt_snapshot: String,
    pub display_mode: String,
    pub workspace_mode: WorkspaceMode,
    pub target_branch: Option<String>,
    pub workspace_branch: Option<String>,
    pub workspace_path: Option<String>,
    pub origin_branch: Option<String>,
    pub worktree_owner: WorktreeOwner,
    pub worktree_root_path: Option<String>,
    pub worktree_setup_command: Option<String>,
    pub log_path: String,
    pub latest_output: Option<String>,
    pub last_active_at: i64,
    pub started_at: i64,
    pub closed_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSessionStatus {
    Running,
    Closed,
    Crashed,
    Stopped,
}

pub fn format_agent_session_status_for_summary(status: &AgentSessionStatus) -> &'static str {
    match status {
        AgentSessionStatus::Running => "running",
        AgentSessionStatus::Closed => "closed",
        AgentSessionStatus::Crashed => "crashed",
        AgentSessionStatus::Stopped => "stopped",
    }
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


#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeStructuredAgentSessionInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeStructuredAgentSessionResult {
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
    /// reasoning effort 由 Agent 模型声明，常见值为 low / medium / high / xhigh。
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

/// Agent UI 能力投影：由 provider descriptor 提供，经 list_agent_models 下发。
///
/// 前端不得再维护静态双表；composer 控件显隐以本结构为准。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUiCapabilities {
    pub model_type_label: String,
    pub can_show_model: bool,
    pub supports_model_switching: bool,
    pub supports_reasoning_effort: bool,
    pub supports_modes: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentModelsResult {
    pub models: Vec<AgentModel>,
    /// 模型列表是否只读（第三方接口不允许切换）。
    ///
    /// Codex / Claude 官方模型为 false；Claude 第三方接口为 true。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_read_only: Option<bool>,
    /// Provider UI 能力（模型展示 / Think / modes 等）。
    pub capabilities: AgentUiCapabilities,
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
    pub effort: Option<String>,
}

