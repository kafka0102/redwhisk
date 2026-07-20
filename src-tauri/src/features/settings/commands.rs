use tauri::State;

use crate::app_state::AppState;
use super::service::SettingsService;
use crate::types::agent_profile::{
    AgentCommandCheckResult, AgentProfileListResponse, AgentProfileRecord, DeleteAgentProfileInput,
    ListAgentProfilesInput, PreviewAgentCommandArgsInput, SaveAgentProfileInput,
    TestAgentCommandInput,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project_label::{
    DeleteProjectLabelInput, ListProjectLabelsInput, ProjectLabelListResponse, ProjectLabelRecord,
    SaveProjectLabelInput,
};
use crate::types::saved_agent_skill::{
    DeleteSavedAgentSkillInput, ListSavedAgentSkillsInput, SaveSavedAgentSkillInput,
    SavedAgentSkillListResponse, SavedAgentSkillRecord,
};
use crate::types::user_profile::{UpdateUserProfileInput, UserProfileRecord};

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

/// 预览给定 profile 启动 PTY 时实际带上的 CLI 参数（ADR-0019）。
///
/// 入参：`agentType` + `command` + `mode` + `dangerous`（profile 启动相关字段）。
/// 出参：`Vec<String>`，参数数组（不含命令本身）；opencode/grok 与 `dangerous=false` 返回空。
#[tauri::command]
pub fn preview_agent_command_args(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: PreviewAgentCommandArgsInput,
) -> Result<Vec<String>, CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    SettingsService::preview_agent_command_args_in_data_dir(data_dir, input)
}

#[tauri::command]
pub async fn list_project_labels(
    app: tauri::AppHandle,
    input: ListProjectLabelsInput,
) -> Result<ProjectLabelListResponse, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(CommandErrorCode::SettingsPersistenceFailed, "设置保存失败。")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        SettingsService::list_project_labels_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(CommandErrorCode::SettingsPersistenceFailed, "设置查询失败。")
            .with_reason("queryFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
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

#[tauri::command]
pub fn list_saved_agent_skills(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ListSavedAgentSkillsInput,
) -> Result<SavedAgentSkillListResponse, CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    SettingsService::list_saved_agent_skills_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn save_saved_agent_skill(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SaveSavedAgentSkillInput,
) -> Result<SavedAgentSkillRecord, CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    SettingsService::save_saved_agent_skill_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn delete_saved_agent_skill(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DeleteSavedAgentSkillInput,
) -> Result<(), CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    SettingsService::delete_saved_agent_skill_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn get_user_profile(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<UserProfileRecord, CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    super::user_profile::UserProfileService::get_profile_in_data_dir(data_dir)
}

#[tauri::command]
pub fn update_user_profile(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: UpdateUserProfileInput,
) -> Result<UserProfileRecord, CommandError> {
    let data_dir = prepare_settings_data_dir(&app, &state)?;
    super::user_profile::UserProfileService::update_profile_in_data_dir(
        data_dir, input,
    )
}

fn prepare_settings_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<std::path::PathBuf, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(app).map_err(|error| {
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
