//! 变更页创建 PR/MR。不走 Issue 完成，也不改 Issue 状态。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::commands::prepare_project_data_dir;
use super::service::ProjectService;
use crate::app_state::AppState;
use crate::git::change_request::view_change_request;
use crate::git::change_request::{
    current_branch_name, local_branch_names, publish_change_request, suggested_change_request_text,
    workspace_belongs_to_repo, ChangeRequestInput,
};
use crate::git::forge::{cli_is_installed, detect_forge_host, inspect_forge_remote, ForgeHost};
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
    pub current_branch: Option<String>,
    pub repo_default_branch: Option<String>,
    pub branches: Vec<String>,
    pub existing_url: Option<String>,
    pub title: String,
    pub body: String,
    pub completion_action: ProjectCompletionAction,
    pub pr_target: ProjectPrTarget,
    pub pr_draft: bool,
    pub confirm_completion_action: bool,
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
    let forge = inspect_forge_remote(&workspace);
    let current_branch = current_branch_name(&workspace);
    let (title, body) = suggested_change_request_text(&workspace);
    Ok(ChangeRequestPreview {
        host: forge.host.as_str().to_string(),
        current_branch,
        repo_default_branch: forge.repo_default_branch,
        branches: local_branch_names(&workspace),
        // 远端已有请求的查询会调用 gh/glab，不能在弹窗打开时阻塞；创建时会复用已有请求。
        existing_url: None,
        title,
        body,
        completion_action: project.completion_action,
        pr_target: project.pr_target,
        pr_draft: project.pr_draft,
        confirm_completion_action: project.confirm_completion_action,
    })
}

fn create_change_request_blocking(
    data_dir: PathBuf,
    input: CreateChangeRequestInput,
) -> Result<CreateChangeRequestResponse, CommandError> {
    let project = ProjectService::project_summary_in_data_dir(&data_dir, input.project_id)?;
    let workspace = ensure_workspace(&project.repo_path, &input.workspace_path)?;
    let forge = inspect_forge_remote(&workspace);
    if forge.host == ForgeHost::None {
        return Err(coded_error(
            "forgeUnknown",
            "GitHub or GitLab remote was not recognized.",
        ));
    }
    if !forge.host.cli_name().is_some_and(cli_is_installed) {
        return Err(coded_error(
            "forgeCliMissing",
            "The required forge CLI is not installed.",
        ));
    }
    let head = current_branch_name(&workspace)
        .ok_or_else(|| coded_error("branchMissing", "The current branch does not exist."))?;
    let url = publish_change_request(ChangeRequestInput {
        repo_path: &workspace,
        host: forge.host,
        head: &head,
        base: &input.base,
        title: &input.title,
        body: &input.body,
        draft: input.draft,
    })
    .map_err(command_failed)?;
    Ok(CreateChangeRequestResponse { url })
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewChangeRequestInput {
    pub project_id: i64,
    pub reference: String,
}

#[tauri::command]
pub async fn view_project_change_request(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ViewChangeRequestInput,
) -> Result<crate::git::change_request::ChangeRequestStatus, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || view_change_request_blocking(data_dir, input))
        .await
        .map_err(join_error)?
}

fn view_change_request_blocking(
    data_dir: PathBuf,
    input: ViewChangeRequestInput,
) -> Result<crate::git::change_request::ChangeRequestStatus, CommandError> {
    let project = ProjectService::project_summary_in_data_dir(&data_dir, input.project_id)?;
    let repo = PathBuf::from(&project.repo_path);
    let host = detect_forge_host(&repo);
    view_change_request(&repo, host, &input.reference).map_err(command_failed)
}

fn ensure_workspace(repo_path: &str, workspace_path: &str) -> Result<PathBuf, CommandError> {
    let repo = PathBuf::from(repo_path);
    let workspace = PathBuf::from(workspace_path);
    if !workspace_belongs_to_repo(&repo, &workspace) {
        return Err(coded_error(
            "workspaceNotInProject",
            "The workspace does not belong to this project.",
        ));
    }
    Ok(workspace)
}

fn coded_error(reason: &str, message: &str) -> CommandError {
    CommandError::new(CommandErrorCode::ProjectValidationFailed, message).with_reason(reason)
}

fn command_failed(detail: String) -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectValidationFailed,
        "Failed to create or read the pull request or merge request.",
    )
    .with_reason("changeRequestFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", detail))
}

fn join_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectPersistenceFailed,
        "Project 操作失败。",
    )
    .with_reason("joinFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
