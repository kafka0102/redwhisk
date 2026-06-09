use serde::{Deserialize, Serialize};

use crate::types::agent_session::{AgentSessionAttention, AgentSessionStatus};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIssueInput {
    pub project_id: i64,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateIssueInput {
    pub project_id: i64,
    pub issue_id: i64,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkIssueReviewInput {
    pub project_id: i64,
    pub issue_id: i64,
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
    pub status: IssueStatus,
    pub linked_session_id: Option<i64>,
    pub linked_session_status: Option<AgentSessionStatus>,
    pub linked_session_attention: Option<AgentSessionAttention>,
    pub linked_session_log_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IssueStatus {
    Backlog,
    Running,
    Review,
    Completed,
}
