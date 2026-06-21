use tauri::{Manager, State};

use crate::app_state::AppState;
use crate::core::settings_service::SettingsService;
use crate::types::agent_profile::{
    AgentCommandCheckResult, AgentProfileListResponse, AgentProfileRecord, DeleteAgentProfileInput,
    ListAgentProfilesInput, SaveAgentProfileInput, TestAgentCommandInput,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project_label::{
    DeleteProjectLabelInput, ListProjectLabelsInput, ProjectLabelListResponse, ProjectLabelRecord,
    SaveProjectLabelInput,
};

#[tauri::command]
pub fn detect_codex_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<AgentCommandCheckResult, CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    SettingsService::detect_codex_command_in_data_dir(data_dir)
}

#[tauri::command]
pub fn test_agent_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: TestAgentCommandInput,
) -> Result<AgentCommandCheckResult, CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    SettingsService::test_agent_command_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn list_agent_profiles(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ListAgentProfilesInput,
) -> Result<AgentProfileListResponse, CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    SettingsService::list_agent_profiles_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn save_agent_profile(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SaveAgentProfileInput,
) -> Result<AgentProfileRecord, CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    SettingsService::save_agent_profile_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn delete_agent_profile(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DeleteAgentProfileInput,
) -> Result<(), CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    SettingsService::delete_agent_profile_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn list_project_labels(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ListProjectLabelsInput,
) -> Result<ProjectLabelListResponse, CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    SettingsService::list_project_labels_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn save_project_label(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SaveProjectLabelInput,
) -> Result<ProjectLabelRecord, CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    SettingsService::save_project_label_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn delete_project_label(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DeleteProjectLabelInput,
) -> Result<(), CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    SettingsService::delete_project_label_in_data_dir(data_dir, input)
}

fn prepare_settings_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<std::path::PathBuf, CommandError> {
    let data_dir = app.path().app_data_dir().map_err(|error| {
        CommandError::new(
            CommandErrorCode::SettingsPersistenceFailed,
            "设置保存失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::SettingsPersistenceFailed,
                "设置保存失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}
