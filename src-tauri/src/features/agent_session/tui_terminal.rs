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
                chunks: snapshot.chunks,
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

        Ok(ReadAgentSessionTerminalResult {
            session_id: input.session_id,
            snapshot,
            is_active,
        })
    }
}
