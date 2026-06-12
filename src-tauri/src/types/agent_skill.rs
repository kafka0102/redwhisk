use serde::{Deserialize, Serialize};

use crate::types::agent_profile::AgentType;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSkillScope {
    Project,
    Global,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSkillRefreshStatus {
    Idle,
    Loading,
    Ready,
    Failed,
}

impl Default for AgentSkillRefreshStatus {
    fn default() -> Self {
        Self::Idle
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillRecord {
    pub name: String,
    pub path: String,
    pub agent_type: AgentType,
    pub scope: AgentSkillScope,
    pub project_id: Option<i64>,
    pub source_root: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentSkillsInput {
    pub agent_type: Option<AgentType>,
    pub project_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshAgentSkillsInput {
    pub project_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillListResponse {
    pub skills: Vec<AgentSkillRecord>,
    pub global_status: AgentSkillRefreshStatus,
    pub project_status: AgentSkillRefreshStatus,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillsUpdatedEvent {
    pub scope: AgentSkillScope,
    pub project_id: Option<i64>,
}
