use serde::{Deserialize, Serialize};

use crate::types::agent_session::{AgentSessionAttention, AgentSessionStatus};
use crate::types::project_label::ProjectLabelScope;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueAttachmentKind {
    Image,
    Pdf,
    Word,
    Text,
    Generic,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueAttachmentRecord {
    pub id: i64,
    pub issue_id: i64,
    pub display_name: String,
    pub stored_name: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub mime_type: Option<String>,
    pub file_size: i64,
    pub kind: IssueAttachmentKind,
    pub is_previewable: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueAttachmentInput {
    pub attachment_id: Option<i64>,
    pub temp_token: Option<String>,
    pub source_path: Option<String>,
    pub display_name: String,
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueLabelRecord {
    pub id: i64,
    pub name: String,
    pub scope: ProjectLabelScope,
    pub project_id: Option<i64>,
    pub color: String,
    pub workflow_skill: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIssueInput {
    pub project_id: i64,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub attachments: Vec<IssueAttachmentInput>,
    #[serde(default)]
    pub label_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateIssueInput {
    pub project_id: i64,
    pub issue_id: i64,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub attachments: Vec<IssueAttachmentInput>,
    #[serde(default)]
    pub label_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkIssueReviewInput {
    pub project_id: i64,
    pub issue_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvanceIssueStatusInput {
    pub project_id: i64,
    pub issue_id: i64,
    pub target_status: IssueStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteIssueManualInput {
    pub project_id: i64,
    pub issue_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteIssueCleanInput {
    pub project_id: i64,
    pub issue_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareAgentCommitCompletionInput {
    pub project_id: i64,
    pub issue_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAgentCommitPromptInput {
    pub project_id: i64,
    pub issue_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectAgentCommitCompletionInput {
    pub project_id: i64,
    pub issue_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetIssueSummaryInput {
    pub project_id: i64,
    pub issue_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteIssueInput {
    pub project_id: i64,
    pub issue_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteIssueResult {
    pub issue_id: i64,
    pub linked_session_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetIssueWorktreeStatusInput {
    pub project_id: i64,
    pub issue_id: i64,
}

/// Issue 关联 worktree 的残留状态。
///
/// `exists` 以最近一次 worktree session 的 `workspace_path` 目录是否存在为准；
/// `can_delete` 仅在目录存在且 worktree 由 RedWhisk 管理时为真，前端据此决定
/// 是否弹出"删除同名 worktree"确认框。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueWorktreeStatusResult {
    pub exists: bool,
    pub can_delete: bool,
    pub workspace_path: Option<String>,
    pub workspace_branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteIssueWorktreeInput {
    pub project_id: i64,
    pub issue_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteIssueWorktreeResult {
    pub issue_id: i64,
    pub deleted: bool,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommitChangedFileSummary {
    pub status: String,
    pub path: String,
    pub old_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommitCompletionPreview {
    pub issue_id: i64,
    pub session_id: i64,
    pub option: String,
    pub head: String,
    pub changed_files_count: usize,
    pub changed_files: Vec<AgentCommitChangedFileSummary>,
    pub completion_prompt: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAgentCommitPromptResult {
    pub issue_id: i64,
    pub session_id: i64,
    pub codex_session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectAgentCommitCompletionOutcome {
    Completed,
    NoCommitDetected,
    /// 检测到新 commit，但需用户确认是否继续标记完成（phase → ConfirmingContinueAfterCommit）。
    CommitDetected,
    GitOperationBlocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectAgentCommitCompletionResult {
    pub outcome: DetectAgentCommitCompletionOutcome,
    pub issue: IssueRecord,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSummaryCompletionInfo {
    pub option: String,
    pub result: String,
    pub commit_hash: Option<String>,
    pub failure_reason: Option<String>,
    pub head_before: Option<String>,
    pub head_after: Option<String>,
    pub changed_files_json: Option<String>,
    pub created_at: i64,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSummaryRecord {
    pub issue: IssueRecord,
    pub session_started_at: Option<i64>,
    pub session_closed_at: Option<i64>,
    pub completion: Option<IssueSummaryCompletionInfo>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueListResponse {
    pub issues: Vec<IssueRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueRecord {
    pub id: i64,
    pub project_id: i64,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub attachments: Vec<IssueAttachmentRecord>,
    #[serde(default)]
    pub labels: Vec<IssueLabelRecord>,
    #[serde(skip)]
    pub label_ids: Vec<i64>,
    pub status: IssueStatus,
    pub linked_session_id: Option<i64>,
    pub linked_session_status: Option<AgentSessionStatus>,
    pub linked_session_attention: Option<AgentSessionAttention>,
    pub linked_session_log_path: Option<String>,
    pub linked_session_latest_output: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IssueStatus {
    Backlog,
    Running,
    Review,
    Completed,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewIssueAttachmentInput {
    pub project_id: i64,
    pub attachment_id: Option<i64>,
    pub source_path: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportIssueAttachmentInput {
    pub project_id: i64,
    pub attachment_id: Option<i64>,
    pub source_path: Option<String>,
    pub display_name: Option<String>,
    pub target_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveIssueAttachmentDraftInput {
    pub source_path: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveIssueAttachmentDraftResult {
    pub path: String,
    pub display_name: String,
    pub kind: IssueAttachmentKind,
    pub is_previewable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueAttachmentPreview {
    pub attachment_id: Option<i64>,
    pub display_name: String,
    pub kind: IssueAttachmentKind,
    pub is_previewable: bool,
    pub text_content: Option<String>,
    pub absolute_path: Option<String>,
}
