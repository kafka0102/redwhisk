use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    Codex,
    Claude,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentScope {
    Project,
    Global,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileRecord {
    pub id: i64,
    pub name: String,
    pub agent_type: AgentType,
    pub command: String,
    pub scope: AgentScope,
    pub project_id: Option<i64>,
    pub mode: String,
    pub dangerous: bool,
    pub default_skill: String,
    pub prompt_template: String,
    pub del: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentProfileInput {
    pub id: Option<i64>,
    pub name: String,
    pub agent_type: AgentType,
    pub command: String,
    pub scope: AgentScope,
    pub project_id: Option<i64>,
    pub mode: String,
    pub dangerous: bool,
    pub default_skill: String,
    pub prompt_template: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileListResponse {
    pub profiles: Vec<AgentProfileRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommandCheckResult {
    pub command: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestAgentCommandInput {
    pub command: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentProfilesInput {
    pub scope: AgentScope,
    pub project_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAgentProfileInput {
    pub id: i64,
}
