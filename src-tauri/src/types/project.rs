use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectCompletionPolicy {
    Manual,
    AgentAutoCommit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectWorktreeLocation {
    RepoSibling,
    RepoInternal,
    UserHome,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub repo_path: String,
    pub completion_policy: ProjectCompletionPolicy,
    pub worktree_location: ProjectWorktreeLocation,
    pub worktree_setup_command: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectInput {
    pub project_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectCompletionPolicyInput {
    pub project_id: i64,
    pub completion_policy: ProjectCompletionPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectSettingsInput {
    pub project_id: i64,
    pub name: String,
    pub repo_path: String,
    pub completion_policy: ProjectCompletionPolicy,
    pub worktree_location: ProjectWorktreeLocation,
    pub worktree_setup_command: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateProjectRepoPathInput {
    pub repo_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateProjectRepoPathResponse {
    pub repo_path: String,
    pub suggested_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: i64,
    pub name: String,
    pub repo_path: String,
    pub completion_policy: ProjectCompletionPolicy,
    pub worktree_location: ProjectWorktreeLocation,
    pub worktree_setup_command: String,
    pub created_at: i64,
    pub last_opened_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListResponse {
    pub projects: Vec<ProjectListItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListItem {
    pub id: i64,
    pub name: String,
    pub repo_path: String,
    pub completion_policy: ProjectCompletionPolicy,
    pub worktree_location: ProjectWorktreeLocation,
    pub worktree_setup_command: String,
    pub created_at: i64,
    pub last_opened_at: i64,
    pub path_status: ProjectPathStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectPathStatus {
    Available,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectWindowResponse {
    pub project_id: i64,
    pub window_label: String,
}
