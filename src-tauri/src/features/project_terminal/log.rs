use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project_terminal::{ReadProjectTerminalInput, ReadProjectTerminalResult};

use crate::agent::pty_session_manager::PtySessionManager;

use super::registry::ProjectTerminalRegistry;

pub(super) enum SnapshotLoadError {
    Command(CommandError),
    Io(String),
}

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
///
/// 另一个仍在运行的 RedWhisk（例如 release 与 `pnpm tauri dev` 同时开）会握着
/// 同一批日志 fd。这里若按路径删掉，对端的 catch-up 会读到空文件，终端就停在
/// 最后一屏，直到用户再按键才有新的 live 输出。仍被打开的文件留下。
pub fn purge_terminal_log_dir(data_dir: impl AsRef<Path>) {
    let log_dir = data_dir.as_ref().join(PROJECT_TERMINAL_LOG_DIR_NAME);
    let Ok(entries) = fs::read_dir(&log_dir) else {
        return;
    };
    // lsof 起不来时无法判断哪些日志还活着，宁可不删，避免再次把正在写的日志摘掉。
    let Some(open_paths) = open_log_paths(&log_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && !open_paths.contains(&canonical_log_path(&path)) {
            let _ = fs::remove_file(path);
        }
    }
}

/// 磁盘日志被摘掉或还是空文件时，用 PTY 内存缓冲补 catch-up。
/// 缓冲只保留最近一段；有磁盘内容时仍以磁盘 tail 为准。
pub(super) fn read_project_terminal_snapshot(
    input: ReadProjectTerminalInput,
    registry: &ProjectTerminalRegistry,
    pty_sessions: &PtySessionManager,
) -> Result<ReadProjectTerminalResult, SnapshotLoadError> {
    let session = registry
        .find(input.project_id, input.session_id)
        .map_err(SnapshotLoadError::Command)?;
    let is_active = session.is_active && pty_sessions.contains(input.session_id);
    if is_active {
        let _ = pty_sessions.flush_log(input.session_id);
    }
    let max_bytes = input.max_bytes.unwrap_or(32_768);
    let restore_chunks = if is_active {
        pty_sessions
            .restore_snapshot(input.session_id)
            .map(|snapshot| snapshot.chunks)
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let snapshot =
        catch_up_terminal_snapshot(Path::new(&session.log_path), max_bytes, &restore_chunks)
            .map_err(SnapshotLoadError::Io)?;

    Ok(ReadProjectTerminalResult {
        session_id: input.session_id,
        snapshot,
        is_active,
    })
}

pub(super) fn catch_up_terminal_snapshot(
    log_path: &Path,
    max_bytes: usize,
    restore_chunks: &[Vec<u8>],
) -> Result<String, String> {
    let from_disk = crate::agent::pty_session_manager::read_terminal_snapshot(log_path, max_bytes)?;
    if !from_disk.is_empty() || restore_chunks.is_empty() {
        return Ok(from_disk);
    }
    let bytes = restore_chunks.concat();
    let tail = crate::agent::terminal_log_tail::take_terminal_log_tail(&bytes, max_bytes);
    Ok(String::from_utf8_lossy(tail).into_owned())
}

fn open_log_paths(log_dir: &Path) -> Option<std::collections::HashSet<PathBuf>> {
    let output = Command::new("lsof")
        .args(["-n", "-P", "-Fn", "+D"])
        .arg(log_dir)
        .output()
        .ok()?;
    let mut open_paths = std::collections::HashSet::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some(raw) = line.strip_prefix('n') else {
            continue;
        };
        if raw.is_empty() {
            continue;
        }
        open_paths.insert(canonical_log_path(Path::new(raw)));
    }
    Some(open_paths)
}

fn canonical_log_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::{
        catch_up_terminal_snapshot, purge_terminal_log_dir, PROJECT_TERMINAL_LOG_DIR_NAME,
    };

    #[test]
    fn purge_keeps_log_files_still_open_in_a_live_process() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let log_dir = temp_dir.path().join(PROJECT_TERMINAL_LOG_DIR_NAME);
        std::fs::create_dir_all(&log_dir).expect("log dir");
        let live_path = log_dir.join("project-8-terminal-28.log");
        let stale_path = log_dir.join("project-8-terminal-29.log");
        let mut live_file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&live_path)
            .expect("open live log");
        live_file.write_all(b"prompt\n").expect("write live log");
        live_file.flush().expect("flush live log");
        std::fs::write(&stale_path, b"old").expect("write stale log");

        purge_terminal_log_dir(temp_dir.path());

        assert!(
            live_path.exists(),
            "a log still held open by a running app must not be deleted"
        );
        assert_eq!(
            std::fs::read(&live_path).expect("read live log"),
            b"prompt\n"
        );
        assert!(
            !stale_path.exists(),
            "a closed log from a previous run is still removed"
        );
    }

    #[test]
    fn catch_up_uses_restore_buffer_when_log_file_is_missing() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let missing = temp_dir.path().join("project-8-terminal-28.log");
        let chunks = vec![
            b"llm.request.start\n".to_vec(),
            "llm.request.finish\ncommand done\n".as_bytes().to_vec(),
        ];

        let snapshot = catch_up_terminal_snapshot(&missing, 1024, &chunks).expect("snapshot");

        assert!(snapshot.contains("llm.request.finish"));
        assert!(snapshot.contains("command done"));
    }

    #[test]
    fn catch_up_prefers_disk_tail_when_log_file_exists() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let log_path = temp_dir.path().join("terminal.log");
        std::fs::write(&log_path, b"from-disk\n").expect("write log");

        let snapshot = catch_up_terminal_snapshot(&log_path, 1024, &[b"from-memory\n".to_vec()])
            .expect("snapshot");

        assert!(snapshot.contains("from-disk"));
        assert!(!snapshot.contains("from-memory"));
    }
}
