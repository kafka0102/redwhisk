use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTerminalConfig {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub working_dir: String,
    pub launch_command: String,
    pub created_at: i64,
    pub updated_at: i64,
}
