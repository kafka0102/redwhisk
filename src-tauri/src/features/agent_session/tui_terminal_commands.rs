//! Agent Session TUI 终端 command 入口。

use tauri::State;

use crate::app_state::AppState;
use crate::types::agent_session_terminal::{
    ReadAgentSessionTerminalInput, ReadAgentSessionTerminalResult,
    ResizeAgentSessionTerminalInput, RestoreAgentSessionTerminalInput,
    RestoreAgentSessionTerminalResult, SubscribeAgentSessionTerminalOutputInput,
    WriteAgentSessionTerminalInput,
};
use crate::types::errors::CommandError;

use super::commands::{build_agent_session_service, open_agent_session_database};
use super::service::AgentSessionService;

#[tauri::command]
pub fn write_agent_session_terminal(
    state: State<'_, AppState>,
    input: WriteAgentSessionTerminalInput,
) -> Result<(), CommandError> {
    AgentSessionService::write_agent_session_terminal(input, &state.pty_sessions)
}

#[tauri::command]
pub fn resize_agent_session_terminal(
    state: State<'_, AppState>,
    input: ResizeAgentSessionTerminalInput,
) -> Result<(), CommandError> {
    AgentSessionService::resize_agent_session_terminal(input, &state.pty_sessions)
}

#[tauri::command]
pub fn restore_agent_session_terminal(
    state: State<'_, AppState>,
    input: RestoreAgentSessionTerminalInput,
) -> Result<RestoreAgentSessionTerminalResult, CommandError> {
    AgentSessionService::restore_agent_session_terminal(input, &state.pty_sessions)
}

#[tauri::command]
pub fn subscribe_agent_session_terminal_output(
    state: State<'_, AppState>,
    input: SubscribeAgentSessionTerminalOutputInput,
) -> Result<(), CommandError> {
    AgentSessionService::subscribe_agent_session_terminal_output(input, &state.pty_sessions)
}

#[tauri::command]
pub fn unsubscribe_agent_session_terminal_output(
    state: State<'_, AppState>,
    input: SubscribeAgentSessionTerminalOutputInput,
) -> Result<(), CommandError> {
    AgentSessionService::unsubscribe_agent_session_terminal_output(input, &state.pty_sessions)
}

#[tauri::command]
pub fn read_agent_session_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ReadAgentSessionTerminalInput,
) -> Result<ReadAgentSessionTerminalResult, CommandError> {
    let database = open_agent_session_database(&app)?;
    let service = build_agent_session_service(&database.connection);
    service.read_agent_session_terminal(input, &state.pty_sessions)
}
