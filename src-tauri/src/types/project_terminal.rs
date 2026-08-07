use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTerminalSummary {
    pub config_id: i64,
    pub session_id: i64,
    pub name: String,
    pub working_dir: String,
    pub launch_command: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectTerminalInput {
    pub project_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectTerminalResult {
    pub config_id: i64,
    pub session_id: i64,
    pub name: String,
    pub working_dir: String,
    pub launch_command: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTemporaryProjectTerminalInput {
    pub project_id: i64,
    pub agent_session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTemporaryProjectTerminalResult {
    pub session_id: i64,
    pub name: String,
    pub working_dir: String,
    pub launch_command: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectTerminalsInput {
    pub project_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectTerminalsResult {
    pub terminals: Vec<ProjectTerminalSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadProjectTerminalInput {
    pub project_id: i64,
    pub session_id: i64,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadProjectTerminalResult {
    pub session_id: i64,
    pub snapshot: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreProjectTerminalInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeProjectTerminalOutputInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreProjectTerminalResult {
    pub session_id: i64,
    pub sequence: u64,
    pub chunks: Vec<Vec<u8>>,
    pub is_complete: bool,
    pub is_active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteProjectTerminalInput {
    pub project_id: i64,
    pub session_id: i64,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeProjectTerminalInput {
    pub project_id: i64,
    pub session_id: i64,
    pub rows: u16,
    pub cols: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseProjectTerminalInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectTerminalConfigInput {
    pub project_id: i64,
    pub config_id: i64,
    pub name: String,
    pub working_dir: String,
    pub launch_command: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectTerminalConfigResult {
    pub terminal: ProjectTerminalSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectTerminalConfigInput {
    pub project_id: i64,
    pub config_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectTerminalConfigResult {
    pub config_id: i64,
    pub session_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureProjectTerminalsInput {
    pub project_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureProjectTerminalFailure {
    pub config_id: i64,
    pub name: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureProjectTerminalsResult {
    pub terminals: Vec<ProjectTerminalSummary>,
    pub shell_failures: Vec<EnsureProjectTerminalFailure>,
}

