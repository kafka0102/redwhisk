use serde::{Deserialize, Serialize};

use crate::types::agent_profile::AgentType;
use crate::types::agent_skill::AgentSkillScope;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAgentSkillPath {
    pub agent_type: AgentType,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAgentSkillRecord {
    pub id: i64,
    pub name: String,
    pub scope: AgentSkillScope,
    pub project_id: Option<i64>,
    pub skill_paths: Vec<SavedAgentSkillPath>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSavedAgentSkillInput {
    pub id: Option<i64>,
    pub name: String,
    pub scope: AgentSkillScope,
    pub project_id: Option<i64>,
    pub skill_paths: Vec<SavedAgentSkillPath>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSavedAgentSkillsInput {
    pub scope: Option<AgentSkillScope>,
    pub project_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAgentSkillListResponse {
    pub skills: Vec<SavedAgentSkillRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSavedAgentSkillInput {
    pub id: i64,
}
