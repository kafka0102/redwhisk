//! 把 Session 输入框的消息插入正在运行的 Turn。

use tauri::State;

use super::commands::{
    build_agent_session_service, open_agent_session_database, require_structured_handle,
};
use crate::app_state::AppState;
use crate::logging::CommandResultExt;
use crate::types::agent_session::SendAgentMessageInput;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

#[tauri::command]
pub async fn steer_agent_turn(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SendAgentMessageInput,
) -> Result<(), CommandError> {
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let database = open_agent_session_database(&app)?;
        let service = build_agent_session_service(&database.connection);
        service.find_project_session_record(input.project_id, input.session_id)?;
        let handle = require_structured_handle(&agent_sessions, input.session_id)?;
        // 插入成功不改 turn 来源，也不清空当前 Turn。
        handle
            .steer_turn(input.message, input.attachments)
            .map_err(super::service::agent_session_error_to_command_error)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 消息插入失败。",
        )
        .with_reason("turnSteerFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("steer_agent_turn")
}
