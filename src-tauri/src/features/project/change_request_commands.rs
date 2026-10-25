//! 变更页创建 PR/MR。不走 Issue 完成，也不改 Issue 状态。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::commands::prepare_project_data_dir;
use super::service::ProjectService;
use crate::app_state::AppState;
use crate::git::change_request::{
    current_branch_name, find_open_change_request, local_branch_names, publish_change_request,
    suggested_change_request_text, workspace_belongs_to_repo, ChangeRequestInput,
};
use crate::git::forge::{inspect_forge, ForgeHost};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project::{ProjectCompletionAction, ProjectPrTarget};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewChangeRequestInput {
    pub project_id: i64,
    pub workspace_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestPreview {
    pub host: String,
    pub cli_installed: bool,
    pub cli_authenticated: bool,
    pub current_branch: Option<String>,
    pub repo_default_branch: Option<String>,
    pub branches: Vec<String>,
    pub existing_url: Option<String>,
    pub title: String,
    pub body: String,
    pub completion_action: ProjectCompletionAction,
    pub pr_target: ProjectPrTarget,
    pub pr_draft: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChangeRequestInput {
    pub project_id: i64,
    pub workspace_path: String,
    pub base: String,
    pub title: String,
    pub body: String,
    pub draft: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChangeRequestResponse {
    pub url: String,
}

#[tauri::command]
pub async fn preview_change_request(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: PreviewChangeRequestInput,
) -> Result<ChangeRequestPreview, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || preview_change_request_blocking(data_dir, input))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn create_change_request(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CreateChangeRequestInput,
) -> Result<CreateChangeRequestResponse, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || create_change_request_blocking(data_dir, input))
        .await
        .map_err(join_error)?
}

fn preview_change_request_blocking(
    data_dir: PathBuf,
    input: PreviewChangeRequestInput,
) -> Result<ChangeRequestPreview, CommandError> {
    let project = ProjectService::project_summary_in_data_dir(&data_dir, input.project_id)?;
    let workspace = ensure_workspace(&project.repo_path, &input.workspace_path)?;
    let forge = inspect_forge(&workspace);
    let current_branch = current_branch_name(&workspace);
    let (title, body) = suggested_change_request_text(&workspace);
    let existing_url = current_branch
        .as_deref()
        .and_then(|head| find_open_change_request(&workspace, forge.host, head));
    Ok(ChangeRequestPreview {
        host: forge.host.as_str().to_string(),
        cli_installed: forge.cli_installed,
        cli_authenticated: forge.cli_authenticated,
        current_branch,
        repo_default_branch: forge.repo_default_branch,
        branches: local_branch_names(&workspace),
        existing_url,
        title,
        body,
        completion_action: project.completion_action,
        pr_target: project.pr_target,
        pr_draft: project.pr_draft,
    })
}

fn create_change_request_blocking(
    data_dir: PathBuf,
    input: CreateChangeRequestInput,
) -> Result<CreateChangeRequestResponse, CommandError> {
    let project = ProjectService::project_summary_in_data_dir(&data_dir, input.project_id)?;
    let workspace = ensure_workspace(&project.repo_path, &input.workspace_path)?;
    let forge = inspect_forge(&workspace);
    if forge.host == ForgeHost::None {
        return Err(validation_error("未识别 GitHub / GitLab 远程"));
    }
    let head = current_branch_name(&workspace).ok_or_else(|| validation_error("当前分支不存在"))?;
    let url = publish_change_request(ChangeRequestInput {
        repo_path: &workspace,
        host: forge.host,
        head: &head,
        base: &input.base,
        title: &input.title,
        body: &input.body,
        draft: input.draft,
    })
    .map_err(validation_error)?;
    Ok(CreateChangeRequestResponse { url })
}

fn ensure_workspace(repo_path: &str, workspace_path: &str) -> Result<PathBuf, CommandError> {
    let repo = PathBuf::from(repo_path);
    let workspace = PathBuf::from(workspace_path);
    if !workspace_belongs_to_repo(&repo, &workspace) {
        return Err(validation_error("工作区不属于当前项目"));
    }
    Ok(workspace)
}

fn validation_error(message: impl Into<String>) -> CommandError {
    let message = message.into();
    CommandError::new(CommandErrorCode::ProjectValidationFailed, message.clone())
        .with_detail(ErrorDetail::new("Cause").with_value("message", message))
}

fn join_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectPersistenceFailed,
        "Project 操作失败。",
    )
    .with_reason("joinFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
