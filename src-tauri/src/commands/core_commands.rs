use crate::local_data_service::LocalDataService;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::local_data::LocalDataStatus;
use tauri_plugin_clipboard_manager::ClipboardExt;

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

/// 写入系统剪贴板纯文本。
///
/// macOS 的 `NSPasteboard.clearContents` 会进 `_NSPasteboardDeclareTypes`。
/// 插件的 async command 跑在 tokio worker 上，和主线程的 WebKit 剪贴板并发改
/// owner 表，会在 `objc_retain` 里崩。这里在 macOS 上把写入切回主线程。
/// Linux 不能在主线程写剪贴板，否则可能死锁，所以仍在调用线程写。
#[tauri::command]
pub async fn write_clipboard_text(app: tauri::AppHandle, text: String) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || write_clipboard_text_blocking(app, text))
        .await
        .unwrap_or_else(|_| Err(clipboard_command_error("clipboard task dropped")))
}

fn write_clipboard_text_blocking(app: tauri::AppHandle, text: String) -> Result<(), CommandError> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let app_for_main = app.clone();
        app.run_on_main_thread(move || {
            let outcome = app_for_main
                .clipboard()
                .write_text(text)
                .map_err(|error| error.to_string());
            let _ = tx.send(outcome);
        })
        .map_err(|error| clipboard_command_error(&error.to_string()))?;
        return match rx.recv() {
            Ok(Ok(())) => Ok(()),
            Ok(Err(message)) => Err(clipboard_command_error(&message)),
            Err(_) => Err(clipboard_command_error("clipboard write dropped")),
        };
    }
    #[cfg(not(target_os = "macos"))]
    {
        app.clipboard()
            .write_text(text)
            .map_err(|error| clipboard_command_error(&error.to_string()))
    }
}

fn clipboard_command_error(message: &str) -> CommandError {
    CommandError::new(
        CommandErrorCode::UnknownCommandError,
        "Clipboard write failed.",
    )
    .with_reason("clipboardWriteFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", message.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{clipboard_command_error, CommandError, CommandErrorCode};

    #[test]
    fn write_clipboard_text_rejects_pasteboard_error() {
        let result: Result<(), CommandError> = Err(clipboard_command_error(
            "NSPasteboard#writeObjects: returned false",
        ));
        let error = result.expect_err("write_clipboard_text");
        assert_eq!(error.code, CommandErrorCode::UnknownCommandError);
        assert_eq!(error.reason.as_deref(), Some("clipboardWriteFailed"));
        assert_eq!(error.message, "Clipboard write failed.");
    }
}
