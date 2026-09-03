use crate::local_data_service::LocalDataService;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::local_data::LocalDataStatus;

#[tauri::command]
pub async fn initialize_local_data(app: tauri::AppHandle) -> Result<LocalDataStatus, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::LocalDataInitializationFailed,
            "本地数据初始化失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    // 开库 + 迁移是阻塞 IO，必须离开 async 运行时线程；新窗口冷启动时若堵在这里，
    // 会与其它 command 争用运行时，放大「正在打开项目…」空态时间。
    tauri::async_runtime::spawn_blocking(move || {
        LocalDataService::new()
            .initialize(data_dir)
            .map_err(CommandError::from)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::LocalDataInitializationFailed,
            "本地数据初始化失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}
