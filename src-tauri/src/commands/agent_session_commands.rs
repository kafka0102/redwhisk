use tauri::{Manager, State};

use crate::app_state::AppState;
use crate::core::agent_session_service::AgentSessionService;
use crate::types::agent_session::{
    AgentSessionListResponse, ReadAgentSessionTerminalInput, ReadAgentSessionTerminalResult,
    ResizeAgentSessionTerminalInput, StartAgentSessionInput, StartAgentSessionResult,
    WriteAgentSessionTerminalInput,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

#[tauri::command]
pub fn list_agent_sessions(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<AgentSessionListResponse, CommandError> {
    let data_dir = app.path().app_data_dir().map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 查询失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 查询失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    AgentSessionService::list_agent_sessions_in_data_dir(data_dir, project_id)
}

#[tauri::command]
pub fn start_agent_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: StartAgentSessionInput,
) -> Result<StartAgentSessionResult, CommandError> {
    let data_dir = app.path().app_data_dir().map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 启动失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 启动失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    let database = crate::db::connection::DatabaseConfig::new(&data_dir)
        .open()
        .map_err(CommandError::from)?;
    crate::db::migrations::MigrationRunner::default()
        .run(&database.connection)
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 启动失败。",
            )
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

    AgentSessionService::new(
        crate::db::issue_repository::IssueRepository::new(&database.connection),
        crate::db::project_repository::ProjectRepository::new(&database.connection),
        crate::db::agent_profile_repository::AgentProfileRepository::new(&database.connection),
        crate::db::agent_session_repository::AgentSessionRepository::new(&database.connection),
    )
    .start_agent_session_with_pty(data_dir, input, &state.pty_sessions)
}

#[tauri::command]
pub fn read_agent_session_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ReadAgentSessionTerminalInput,
) -> Result<ReadAgentSessionTerminalResult, CommandError> {
    let data_dir = app.path().app_data_dir().map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 终端读取失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    AgentSessionService::read_terminal_snapshot_in_data_dir(
        data_dir,
        input.project_id,
        input.session_id,
        input.max_bytes.unwrap_or(32_768),
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn write_agent_session_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: WriteAgentSessionTerminalInput,
) -> Result<(), CommandError> {
    let data_dir = app.path().app_data_dir().map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 终端写入失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    AgentSessionService::write_terminal_input_in_data_dir(data_dir, input, &state.pty_sessions)
}

#[tauri::command]
pub fn resize_agent_session_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ResizeAgentSessionTerminalInput,
) -> Result<(), CommandError> {
    let data_dir = app.path().app_data_dir().map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 终端调整失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    AgentSessionService::resize_terminal_in_data_dir(data_dir, input, &state.pty_sessions)
}
