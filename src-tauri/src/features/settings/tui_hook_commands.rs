use std::path::{Path, PathBuf};

use tauri::State;

use crate::app_state::AppState;
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::tui_hook_preference_repository::TuiHookPreferenceRepository;
use crate::features::agent_session::{
    apply_tui_hook_registration, channel_unavailable_error,
    detect_tui_hook_registration_with_flags, enable_codex_hooks_feature_file,
    uninstall_tui_hook_registration, TuiHookAgentKind, TuiHookRegistrationStatus,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TuiHookAgentInput {
    pub agent: TuiHookAgentKind,
}

#[tauri::command]
pub fn detect_tui_hook_registration(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<TuiHookRegistrationStatus, CommandError> {
    let data_dir = prepare_data_dir(&app, &state)?;
    detect_in_data_dir(
        &data_dir,
        &user_home()?,
        &current_exe_path()?,
        state.tui_hook_channel_available(),
    )
}

#[tauri::command]
pub fn install_tui_hook(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: TuiHookAgentInput,
) -> Result<TuiHookRegistrationStatus, CommandError> {
    if !state.tui_hook_channel_available() {
        return Err(channel_unavailable_error());
    }
    let data_dir = prepare_data_dir(&app, &state)?;
    install_in_data_dir(
        &data_dir,
        &user_home()?,
        &current_exe_path()?,
        input.agent,
        true,
    )
}

#[tauri::command]
pub fn uninstall_tui_hook(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: TuiHookAgentInput,
) -> Result<TuiHookRegistrationStatus, CommandError> {
    let data_dir = prepare_data_dir(&app, &state)?;
    uninstall_in_data_dir(
        &data_dir,
        &user_home()?,
        &current_exe_path()?,
        input.agent,
        state.tui_hook_channel_available(),
    )
}

#[tauri::command]
pub fn enable_codex_hooks_feature(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<TuiHookRegistrationStatus, CommandError> {
    let data_dir = prepare_data_dir(&app, &state)?;
    enable_feature_in_data_dir(
        &data_dir,
        &user_home()?,
        &current_exe_path()?,
        state.tui_hook_channel_available(),
    )
}

pub(crate) fn detect_in_data_dir(
    data_dir: &Path,
    home: &Path,
    command_path: &str,
    channel_available: bool,
) -> Result<TuiHookRegistrationStatus, CommandError> {
    let database = open_database(data_dir)?;
    let allowed = TuiHookPreferenceRepository::new(&database.connection)
        .registration_allowed()
        .map_err(preference_error)?;
    detect_tui_hook_registration_with_flags(home, command_path, channel_available, allowed)
        .map_err(hook_io_error)
}

pub(crate) fn install_in_data_dir(
    data_dir: &Path,
    home: &Path,
    command_path: &str,
    agent: TuiHookAgentKind,
    channel_available: bool,
) -> Result<TuiHookRegistrationStatus, CommandError> {
    apply_tui_hook_registration(home, agent, command_path, channel_available)?;
    let database = open_database(data_dir)?;
    TuiHookPreferenceRepository::new(&database.connection)
        .set_registration_allowed(true)
        .map_err(preference_error)?;
    detect_in_data_dir(data_dir, home, command_path, channel_available)
}

pub(crate) fn uninstall_in_data_dir(
    data_dir: &Path,
    home: &Path,
    command_path: &str,
    agent: TuiHookAgentKind,
    channel_available: bool,
) -> Result<TuiHookRegistrationStatus, CommandError> {
    uninstall_tui_hook_registration(home, agent, command_path).map_err(hook_io_error)?;
    detect_in_data_dir(data_dir, home, command_path, channel_available)
}

pub(crate) fn enable_feature_in_data_dir(
    data_dir: &Path,
    home: &Path,
    command_path: &str,
    channel_available: bool,
) -> Result<TuiHookRegistrationStatus, CommandError> {
    enable_codex_hooks_feature_file(&home.join(".codex").join("config.toml"))
        .map_err(hook_io_error)?;
    detect_in_data_dir(data_dir, home, command_path, channel_available)
}

fn current_exe_path() -> Result<String, CommandError> {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(hook_io_error)
}

fn user_home() -> Result<PathBuf, CommandError> {
    std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::SettingsPersistenceFailed,
                "Failed to update the TUI hook registration.",
            )
            .with_reason("homeUnavailable")
        })
}

fn prepare_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<PathBuf, CommandError> {
    super::commands::prepare_settings_data_dir_for_hooks(app, state)
}

fn open_database(data_dir: &Path) -> Result<crate::db::connection::Database, CommandError> {
    let database = DatabaseConfig::new(data_dir)
        .open()
        .map_err(CommandError::from)?;
    MigrationRunner::default()
        .run(&database.connection)
        .map_err(preference_error)?;
    Ok(database)
}

fn preference_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::SettingsPersistenceFailed,
        "Failed to save settings.",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn hook_io_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::SettingsPersistenceFailed,
        "Failed to update the TUI hook registration.",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
