use serde::{Deserialize, Serialize};

use crate::types::project_issue_source::{IssueSourceMode, IssueSyncScope, ProjectIssueConnection};
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
    /// 缺省时新建走列默认：合并到 base、Issue base、草稿列默认、不确认。
    #[serde(default)]
    pub completion_action: Option<ProjectCompletionAction>,
    #[serde(default)]
    pub pr_target: Option<ProjectPrTarget>,
    #[serde(default)]
    pub pr_draft: Option<bool>,
    #[serde(default)]
    pub confirm_completion_action: Option<bool>,
    /// 扁平进创建入参。缺省字段沿用列默认，不单独成嵌套对象。
    #[serde(flatten, default)]
    pub issue_source: CreateProjectIssueSourceInput,
}

impl Default for CreateProjectInput {
    fn default() -> Self {
        Self {
            name: String::new(),
            repo_path: String::new(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: String::new(),
            completion_action: None,
            pr_target: None,
            pr_draft: None,
            confirm_completion_action: None,
            issue_source: CreateProjectIssueSourceInput::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CreateProjectIssueSourceInput {
    pub issue_source_mode: Option<IssueSourceMode>,
    pub issue_sync_scope: Option<IssueSyncScope>,
    pub issue_sync_label: Option<String>,
    pub issue_sync_enabled: Option<bool>,
    pub issue_sync_interval_seconds: Option<i64>,
    pub issue_writeback_close_on_complete: Option<bool>,
    pub issue_writeback_close_on_pr_merge: Option<bool>,
    pub issue_writeback_comment: Option<bool>,
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
    /// 缺省表示不改已保存的完成设置，避免探测未完成时写回默认值。
    #[serde(default)]
    pub completion_action: Option<ProjectCompletionAction>,
    #[serde(default)]
    pub pr_target: Option<ProjectPrTarget>,
    #[serde(default)]
    pub pr_draft: Option<bool>,
    /// 缺省表示不改已保存的是否确认，避免旧客户端把值写回否。
    #[serde(default)]
    pub confirm_completion_action: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateProjectRepoPathInput {
    pub repo_path: String,
    /// 打开后才探测连接，并且不写项目 Forge 连接。
    #[serde(default)]
    pub probe_connection: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateProjectRepoPathResponse {
    pub repo_path: String,
    pub suggested_name: String,
    pub host: String,
    pub completion_action: ProjectCompletionAction,
    pub confirm_completion_action: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_project: Option<ValidatedExistingProject>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection: Option<ProjectIssueConnection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_default_branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedExistingProject {
    pub id: i64,
    pub removed: bool,
    pub name: String,
    pub worktree_location: ProjectWorktreeLocation,
    pub worktree_setup_command: String,
    pub issue_source_mode: IssueSourceMode,
    pub issue_sync_scope: IssueSyncScope,
    pub issue_sync_label: Option<String>,
    pub issue_sync_enabled: bool,
    pub issue_sync_interval_seconds: i64,
    pub issue_writeback_close_on_complete: bool,
    pub issue_writeback_close_on_pr_merge: bool,
    pub issue_writeback_comment: bool,
    pub completion_action: ProjectCompletionAction,
    pub pr_target: ProjectPrTarget,
    pub pr_draft: bool,
    pub confirm_completion_action: bool,
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
    pub confirm_completion_action: bool,
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
    pub confirm_completion_action: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCompletionCard {
    pub host: String,
    pub repo_default_branch: Option<String>,
    pub completion_action: ProjectCompletionAction,
    pub pr_target: ProjectPrTarget,
    pub pr_draft: bool,
    pub confirm_completion_action: bool,
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
    pub confirm_completion_action: bool,
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
