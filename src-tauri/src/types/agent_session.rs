use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRecord {
    pub id: i64,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSessionAttention {
    None,
    Requested,
}
