use tauri::State;

use crate::app_state::AppState;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::local_data::LocalDataStatus;

#[tauri::command]
pub async fn initialize_local_data(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<LocalDataStatus, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::LocalDataInitializationFailed,
            "本地数据初始化失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    let mut service = state.local_data.lock().map_err(|_| {
        CommandError::new(
            CommandErrorCode::LocalDataInitializationFailed,
            "本地数据初始化失败。",
        )
    })?;

    service.initialize(data_dir).map_err(CommandError::from)
}
