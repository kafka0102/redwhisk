use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTerminalShortcutCommandRecord {
    pub id: i64,
    pub project_id: i64,
    pub command: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectTerminalShortcutCommandsInput {
    pub project_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectTerminalShortcutCommandsResult {
    pub commands: Vec<ProjectTerminalShortcutCommandRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectTerminalShortcutCommandInput {
    pub id: Option<i64>,
    pub project_id: i64,
    pub command: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectTerminalShortcutCommandInput {
    pub id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadProjectTerminalCwdInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadProjectTerminalCwdResult {
    pub session_id: i64,
    pub cwd: Option<String>,
}
