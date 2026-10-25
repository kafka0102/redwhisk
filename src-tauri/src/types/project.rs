use serde::{Deserialize, Serialize};

use crate::types::session_workspace::CodeWorkspaceRoot;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectCompletionAction {
    MergeToBase,
    OpenPullRequest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectPrTarget {
    IssueBase,
    RepoDefault,
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
pub struct RemoveProjectFromListInput {
    pub project_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectInput {
    pub project_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectSettingsInput {
    pub project_id: i64,
    pub name: String,
    pub repo_path: String,
    pub worktree_location: ProjectWorktreeLocation,
    pub worktree_setup_command: String,
    pub completion_action: ProjectCompletionAction,
    pub pr_target: ProjectPrTarget,
    pub pr_draft: bool,
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
    pub worktree_location: ProjectWorktreeLocation,
    pub worktree_setup_command: String,
    pub completion_action: ProjectCompletionAction,
    pub pr_target: ProjectPrTarget,
    pub pr_draft: bool,
    pub created_at: i64,
    pub last_opened_at: i64,
    #[serde(skip)]
    pub removed_at: Option<i64>,
    #[serde(default)]
    pub code_workspaces: Vec<CodeWorkspaceRoot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectForgeInspection {
    pub host: String,
    pub remote_label: Option<String>,
    pub cli_installed: bool,
    pub cli_authenticated: bool,
    pub repo_default_branch: Option<String>,
    pub completion_action: ProjectCompletionAction,
    pub pr_target: ProjectPrTarget,
    pub pr_draft: bool,
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
    pub worktree_location: ProjectWorktreeLocation,
    pub worktree_setup_command: String,
    pub completion_action: ProjectCompletionAction,
    pub pr_target: ProjectPrTarget,
    pub pr_draft: bool,
    pub created_at: i64,
    pub last_opened_at: i64,
    pub path_status: ProjectPathStatus,
    pub has_open_window: bool,
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
