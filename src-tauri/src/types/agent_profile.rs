use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    Codex,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileRecord {
    pub id: i64,
    pub name: String,
    pub agent_type: AgentType,
    pub command: String,
    pub default_args: Vec<String>,
    pub default_skill: String,
    pub prompt_template: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentProfileInput {
    pub id: Option<i64>,
    pub name: String,
    pub agent_type: AgentType,
    pub command: String,
    pub default_args: Vec<String>,
    pub default_skill: String,
    pub prompt_template: String,
    pub enabled: bool,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAgentOverrideRecord {
    pub id: i64,
    pub project_id: i64,
    pub agent_profile_id: i64,
    pub default_args: Vec<String>,
    pub default_skill: String,
    pub prompt_template: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAgentOverrideListResponse {
    pub overrides: Vec<ProjectAgentOverrideRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectAgentOverridesInput {
    pub project_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectAgentOverrideInput {
    pub project_id: i64,
    pub agent_profile_id: i64,
    pub default_args: Vec<String>,
    pub default_skill: String,
    pub prompt_template: String,
    pub enabled: bool,
}
