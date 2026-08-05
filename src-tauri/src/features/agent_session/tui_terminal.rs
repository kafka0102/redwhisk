//! Agent Session TUI 终端 I/O（对齐 project terminal transport，热路径尽量不碰 DB）。

use std::path::Path;

use crate::agent::pty_session_manager::{read_terminal_snapshot, PtySessionManager};
use crate::types::agent_session_terminal::{
    ReadAgentSessionTerminalInput, ReadAgentSessionTerminalResult,
    ResizeAgentSessionTerminalInput, RestoreAgentSessionTerminalInput,
    RestoreAgentSessionTerminalResult, SubscribeAgentSessionTerminalOutputInput,
    WriteAgentSessionTerminalInput,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

use super::service::{inactive_terminal_error, AgentSessionService};
use super::terminal_archive_clean::markdown_labels_to_plain_text;

impl AgentSessionService<'_> {
    /// 热路径：仅内存 PTY，不打开 SQLite。
    pub fn write_agent_session_terminal(
        input: WriteAgentSessionTerminalInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        if input.data.is_empty() {
            return Ok(());
        }
        if !pty_sessions.contains(input.session_id) {
            return Err(inactive_terminal_error(
                "session not found".to_string(),
            ));
        }
        pty_sessions
            .write_input(input.session_id, &input.data)
            .map_err(inactive_terminal_error)
    }

    /// 热路径：仅内存 PTY。
    pub fn resize_agent_session_terminal(
        input: ResizeAgentSessionTerminalInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        if !pty_sessions.contains(input.session_id) {
            return Err(inactive_terminal_error(
                "session not found".to_string(),
            ));
        }
        pty_sessions
            .resize(input.session_id, input.rows, input.cols)
            .map_err(inactive_terminal_error)
    }

    /// 热路径：restore 只读内存 ring buffer。
    pub fn restore_agent_session_terminal(
        input: RestoreAgentSessionTerminalInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<RestoreAgentSessionTerminalResult, CommandError> {
        if !pty_sessions.contains(input.session_id) {
            return Ok(RestoreAgentSessionTerminalResult {
                session_id: input.session_id,
                sequence: 0,
                chunks: Vec::new(),
                is_complete: false,
                is_active: false,
            });
        }

        match pty_sessions.restore_snapshot(input.session_id) {
            Ok(snapshot) => Ok(RestoreAgentSessionTerminalResult {
                session_id: snapshot.session_id,
                sequence: snapshot.sequence,
                // 前端 catch-up 走磁盘 log，不消费 chunks；避免超大 IPC。
                chunks: Vec::new(),
                is_complete: snapshot.is_complete,
                is_active: true,
            }),
            Err(error) if error == "session not found" => Ok(RestoreAgentSessionTerminalResult {
                session_id: input.session_id,
                sequence: 0,
                chunks: Vec::new(),
                is_complete: false,
                is_active: false,
            }),
            Err(error) => Err(inactive_terminal_error(error)),
        }
    }

    /// 热路径：仅内存。
    pub fn subscribe_agent_session_terminal_output(
        input: SubscribeAgentSessionTerminalOutputInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        if !pty_sessions.contains(input.session_id) {
            return Ok(());
        }
        pty_sessions.add_output_subscriber(input.session_id);
        Ok(())
    }

    /// 热路径：仅内存。
    pub fn unsubscribe_agent_session_terminal_output(
        input: SubscribeAgentSessionTerminalOutputInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        let _ = input.project_id;
        pty_sessions.remove_output_subscriber(input.session_id);
        Ok(())
    }

    /// 读日志快照：需要 DB 取 log_path。
    pub fn read_agent_session_terminal(
        &self,
        input: ReadAgentSessionTerminalInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<ReadAgentSessionTerminalResult, CommandError> {
        let session = self.find_project_session(input.project_id, input.session_id)?;
        let is_active = pty_sessions.contains(input.session_id);
        if is_active {
            let _ = pty_sessions.flush_log(input.session_id);
        }
        let snapshot = read_terminal_snapshot(
            Path::new(&session.log_path),
            input.max_bytes.unwrap_or(32_768),
        )
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "读取 Agent Session 终端快照失败。",
            )
            .with_reason("terminalSnapshotReadFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error))
        })?;

        // 归档纯文本回看：存量日志可能仍含 Markdown 标签；仅 inactive 且路径含
        // session-logs/archive 时做标签→普通文本，不碰 live PTY 原始字节。
        let snapshot = if !is_active && log_path_looks_like_issue_archive(&session.log_path) {
            markdown_labels_to_plain_text(&snapshot)
        } else {
            snapshot
        };

        Ok(ReadAgentSessionTerminalResult {
            session_id: input.session_id,
            snapshot,
            is_active,
        })
    }
}

/// 路径是否含连续段 `session-logs` + `archive`（不依赖 data_dir，读侧热路径）。
fn log_path_looks_like_issue_archive(log_path: &str) -> bool {
    let mut saw_session_logs = false;
    for component in Path::new(log_path).components() {
        let name = component.as_os_str();
        if name == "session-logs" {
            saw_session_logs = true;
            continue;
        }
        if saw_session_logs && name == "archive" {
            return true;
        }
        saw_session_logs = false;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::log_path_looks_like_issue_archive;
    use super::markdown_labels_to_plain_text;

    #[test]
    fn archive_path_detection_matches_issue_archive_layout() {
        assert!(log_path_looks_like_issue_archive(
            "/Users/x/.redwhisk/session-logs/archive/project-2/archive-project-2-issue-33-session-44.log"
        ));
        assert!(!log_path_looks_like_issue_archive(
            "/Users/x/.redwhisk/session-logs/project-2/runtime.log"
        ));
        assert!(!log_path_looks_like_issue_archive(
            "/tmp/other-archive/session-logs/runtime.log"
        ));
    }

    #[test]
    fn archived_snapshot_markdown_becomes_plain_for_display() {
        let raw = "• <issue-comment>\n\n  **完成**\n\n## 结果\n\n正文\n\n</issue-comment>\n";
        let plain = markdown_labels_to_plain_text(raw);
        assert!(!plain.contains("## "));
        assert!(!plain.contains("**"));
        assert!(!plain.contains("<issue-comment>"));
        assert!(plain.contains("完成"));
        assert!(plain.contains("结果"));
    }
}
