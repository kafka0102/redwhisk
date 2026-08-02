use tauri::{AppHandle, Emitter, State};

use crate::app_state::AppState;
use super::{dismiss_update_prompt_in_data_dir, get_update_status_in_data_dir};
use crate::types::app_update::{DismissUpdatePromptInput, GetUpdateStatusInput, UpdateStatus};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

/// 多窗口同步版本提醒状态时广播的事件名。
pub const UPDATE_PROMPT_CHANGED_EVENT: &str = "update-prompt-changed";

#[tauri::command]
pub async fn get_update_status(
    app: AppHandle,
    state: State<'_, AppState>,
    input: GetUpdateStatusInput,
) -> Result<UpdateStatus, CommandError> {
    let data_dir = prepare_update_data_dir(&app, &state)?;
    let current_version = app.package_info().version.to_string();
    let force_refresh = input.force_refresh;
    let status = tauri::async_runtime::spawn_blocking(move || {
        get_update_status_in_data_dir(data_dir, current_version, force_refresh)
    })
    .await
    .map_err(update_join_error)??;

    if force_refresh {
        let _ = app.emit(UPDATE_PROMPT_CHANGED_EVENT, &status);
    }

    Ok(status)
}

#[tauri::command]
pub async fn dismiss_update_prompt(
    app: AppHandle,
    state: State<'_, AppState>,
    input: DismissUpdatePromptInput,
) -> Result<UpdateStatus, CommandError> {
    let data_dir = prepare_update_data_dir(&app, &state)?;
    let current_version = app.package_info().version.to_string();
    let status = tauri::async_runtime::spawn_blocking(move || {
        dismiss_update_prompt_in_data_dir(data_dir, current_version, input)
    })
    .await
    .map_err(update_join_error)??;
    let _ = app.emit(UPDATE_PROMPT_CHANGED_EVENT, &status);
    Ok(status)
}

fn prepare_update_data_dir(
    app: &AppHandle,
    state: &State<'_, AppState>,
) -> Result<std::path::PathBuf, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AppUpdatePersistenceFailed,
            "打开本地数据失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AppUpdatePersistenceFailed,
                "打开本地数据失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}

fn update_join_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::AppUpdatePersistenceFailed,
        "检查更新失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
