use std::fs;
use std::path::{Path, PathBuf};

use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

pub(super) const PROJECT_TERMINAL_LOG_DIR_NAME: &str = "project-terminal-logs";

pub(super) fn terminal_log_path(
    data_dir: &Path,
    project_id: i64,
    session_id: i64,
) -> Result<PathBuf, CommandError> {
    let log_dir = data_dir.join(PROJECT_TERMINAL_LOG_DIR_NAME);
    std::fs::create_dir_all(&log_dir).map_err(|error| {
        CommandError::new(
            CommandErrorCode::ProjectTerminalPersistenceFailed,
            "Project Terminal 保存失败。",
        )
        .with_reason("saveFailed")
        .with_detail(
            ErrorDetail::new("Path").with_value("path", log_dir.to_string_lossy().to_string()),
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    Ok(log_dir.join(format!(
        "project-{project_id}-terminal-{}.log",
        session_id.abs()
    )))
}

/// 删除 Project Terminal 日志文件。路径为空、不存在或删除失败时静默跳过。
pub(super) fn remove_terminal_log_file(log_path: &str) {
    if log_path.is_empty() {
        return;
    }
    let path = Path::new(log_path);
    if !path.exists() {
        return;
    }
    let _ = fs::remove_file(path);
}

/// 启动时清空终端日志目录：删除 project-terminal-logs 下所有文件。
/// 目录不存在或单文件删除失败时静默跳过，不阻断启动；目录本身保留，
/// 后续创建终端时仍由 terminal_log_path 的 create_dir_all 兜底。
pub fn purge_terminal_log_dir(data_dir: impl AsRef<Path>) {
    let log_dir = data_dir.as_ref().join(PROJECT_TERMINAL_LOG_DIR_NAME);
    let Ok(entries) = fs::read_dir(&log_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let _ = fs::remove_file(&path);
        }
    }
}
