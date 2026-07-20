use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    Codex,
    Claude,
    #[serde(rename = "opencode")]
    OpenCode,
    Grok,
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
    pub display_mode: String,
    pub enabled: bool,
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
    pub display_mode: String,
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

/// 参数预览入参（ADR-0019）：依据 profile 的启动相关字段计算命令行参数。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAgentCommandArgsInput {
    pub agent_type: AgentType,
    pub command: String,
    pub mode: String,
    pub dangerous: bool,
}
