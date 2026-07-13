use tauri::State;

use crate::app_state::AppState;
use crate::core::project_terminal_service::ProjectTerminalService;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project_terminal::{
    CloseProjectTerminalInput, CreateProjectTerminalInput, CreateProjectTerminalResult,
    CreateTemporaryProjectTerminalInput, CreateTemporaryProjectTerminalResult,
    DeleteProjectTerminalConfigInput, DeleteProjectTerminalConfigResult, ListProjectTerminalsInput,
    ListProjectTerminalsResult, ReadProjectTerminalInput, ReadProjectTerminalResult,
    ResizeProjectTerminalInput, RestoreProjectTerminalInput, RestoreProjectTerminalResult,
    SubscribeProjectTerminalOutputInput, UpdateProjectTerminalConfigInput,
    UpdateProjectTerminalConfigResult, WriteProjectTerminalInput,
};
use crate::types::project_terminal_shortcut_command::{
    DeleteProjectTerminalShortcutCommandInput, ListProjectTerminalShortcutCommandsInput,
    ListProjectTerminalShortcutCommandsResult, ProjectTerminalShortcutCommandRecord,
    ReadProjectTerminalCwdInput, ReadProjectTerminalCwdResult,
    SaveProjectTerminalShortcutCommandInput,
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
pub fn create_temporary_project_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CreateTemporaryProjectTerminalInput,
) -> Result<CreateTemporaryProjectTerminalResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::create_temporary_terminal_for_agent_session_in_data_dir(
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
pub fn list_project_terminals(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ListProjectTerminalsInput,
) -> Result<ListProjectTerminalsResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::list_project_terminals_in_data_dir(
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
pub fn subscribe_project_terminal_output(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SubscribeProjectTerminalOutputInput,
) -> Result<(), CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::subscribe_terminal_output_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn unsubscribe_project_terminal_output(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SubscribeProjectTerminalOutputInput,
) -> Result<(), CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::unsubscribe_terminal_output_in_data_dir(
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

#[tauri::command]
pub fn update_project_terminal_config(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: UpdateProjectTerminalConfigInput,
) -> Result<UpdateProjectTerminalConfigResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::update_project_terminal_config_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn delete_project_terminal_config(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DeleteProjectTerminalConfigInput,
) -> Result<DeleteProjectTerminalConfigResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::delete_project_terminal_config_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn list_project_terminal_shortcut_commands(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ListProjectTerminalShortcutCommandsInput,
) -> Result<ListProjectTerminalShortcutCommandsResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::list_shortcut_commands_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn save_project_terminal_shortcut_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SaveProjectTerminalShortcutCommandInput,
) -> Result<ProjectTerminalShortcutCommandRecord, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::save_shortcut_command_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn delete_project_terminal_shortcut_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DeleteProjectTerminalShortcutCommandInput,
) -> Result<(), CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::delete_shortcut_command_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn read_project_terminal_cwd(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ReadProjectTerminalCwdInput,
) -> Result<ReadProjectTerminalCwdResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::read_terminal_cwd_in_data_dir(
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
    let data_dir = crate::local_data_path::redwhisk_data_dir(app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::ProjectTerminalPersistenceFailed,
            "Project Terminal 保存失败。",
        ).with_reason("saveFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::ProjectTerminalPersistenceFailed,
                "Project Terminal 保存失败。",
            ).with_reason("saveFailed")
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}
