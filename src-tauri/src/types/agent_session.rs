use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentSessionInput {
    pub project_id: i64,
    pub issue_id: i64,
    pub agent_profile_id: i64,
    pub prompt_snapshot: String,
}
