use tauri::{Manager, State};

use crate::app_state::AppState;
use crate::core::project_terminal_service::ProjectTerminalService;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project_terminal::{
    CloseProjectTerminalInput, CreateProjectTerminalInput, CreateProjectTerminalResult,
    ReadProjectTerminalInput, ReadProjectTerminalResult, ResizeProjectTerminalInput,
    RestoreProjectTerminalInput, RestoreProjectTerminalResult, WriteProjectTerminalInput,
};

#[tauri::command]
pub fn create_project_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CreateProjectTerminalInput,
) -> Result<CreateProjectTerminalResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::create_terminal_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn read_project_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ReadProjectTerminalInput,
) -> Result<ReadProjectTerminalResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::read_terminal_snapshot_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn write_project_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: WriteProjectTerminalInput,
) -> Result<(), CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::write_terminal_input_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn restore_project_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: RestoreProjectTerminalInput,
) -> Result<RestoreProjectTerminalResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::restore_terminal_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn resize_project_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ResizeProjectTerminalInput,
) -> Result<(), CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::resize_terminal_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn close_project_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CloseProjectTerminalInput,
) -> Result<(), CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::close_terminal_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

fn prepare_project_terminal_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<std::path::PathBuf, CommandError> {
    let data_dir = app.path().app_data_dir().map_err(|error| {
        CommandError::new(
            CommandErrorCode::ProjectTerminalPersistenceFailed,
            "Project Terminal 保存失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::ProjectTerminalPersistenceFailed,
                "Project Terminal 保存失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}
