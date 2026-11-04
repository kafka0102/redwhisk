use tauri::State;

use super::commands::prepare_project_data_dir;
use super::issue_source::{
    get_project_issue_source_settings_in_data_dir, inspect_project_issue_connection_in_data_dir,
    update_project_issue_source_settings_in_data_dir,
};
use crate::app_state::AppState;
use crate::types::errors::CommandError;
use crate::types::project_issue_source::{
    ProjectIssueSourceSettings, UpdateProjectIssueSourceSettingsInput,
};

#[tauri::command]
pub fn get_project_issue_source_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<ProjectIssueSourceSettings, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    get_project_issue_source_settings_in_data_dir(data_dir, project_id)
}

#[tauri::command]
pub fn update_project_issue_source_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: UpdateProjectIssueSourceSettingsInput,
) -> Result<ProjectIssueSourceSettings, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    update_project_issue_source_settings_in_data_dir(data_dir, input)
}

#[tauri::command]
pub async fn inspect_project_issue_connection(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<ProjectIssueSourceSettings, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        inspect_project_issue_connection_in_data_dir(data_dir, project_id)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            crate::types::errors::CommandErrorCode::ProjectPersistenceFailed,
            "Failed to inspect the issue connection.",
        )
        .with_reason("joinFailed")
        .with_detail(
            crate::types::errors::ErrorDetail::new("Cause")
                .with_value("message", error.to_string()),
        )
    })?
}
