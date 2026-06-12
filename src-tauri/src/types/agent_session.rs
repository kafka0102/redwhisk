use serde::{Deserialize, Serialize};

use crate::types::agent_profile::AgentType;
use crate::types::issue::IssueStatus;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentSessionInput {
    pub project_id: i64,
    pub issue_id: i64,
    pub agent_profile_id: i64,
    pub prompt_snapshot: String,
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
    pub can_complete_clean: bool,
    pub can_complete_agent_commit: bool,
    pub title: Option<String>,
    pub agent_type: AgentType,
    pub status: AgentSessionStatus,
    pub attention: AgentSessionAttention,
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
