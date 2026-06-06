use tauri::{Manager, State};

use crate::app_state::AppState;
use crate::core::agent_session_service::AgentSessionService;
use crate::types::agent_session::{
    AgentSessionListResponse, StartAgentSessionInput, StartAgentSessionResult,
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

    AgentSessionService::start_agent_session_in_data_dir(data_dir, input)
}
