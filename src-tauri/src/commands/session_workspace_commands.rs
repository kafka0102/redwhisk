use tauri::State;

use crate::app_state::AppState;
use crate::core::session_workspace_service::SessionWorkspaceService;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::session_workspace::{
    ProjectWorkspaceInput, ProjectWorkspacePathInput, ProjectWorktreeChangesResponse,
    ProjectWorktreeCommitHistoryResponse, ProjectWorktreeFileTreeResponse, WorkspaceDiffContent,
    WorkspaceFileContent,
};

#[tauri::command]
pub fn get_project_worktree_changes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspaceInput,
) -> Result<ProjectWorktreeChangesResponse, CommandError> {
    with_session_workspace_service(app, state, |service| service.get_changes(input))
}

#[tauri::command]
pub fn get_project_worktree_file_tree(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspaceInput,
) -> Result<ProjectWorktreeFileTreeResponse, CommandError> {
    with_session_workspace_service(app, state, |service| service.get_file_tree(input))
}

#[tauri::command]
pub fn get_project_worktree_commit_history(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspaceInput,
) -> Result<ProjectWorktreeCommitHistoryResponse, CommandError> {
    with_session_workspace_service(app, state, |service| service.get_commit_history(input))
}

#[tauri::command]
pub fn read_project_worktree_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspacePathInput,
) -> Result<WorkspaceFileContent, CommandError> {
    with_session_workspace_service(app, state, |service| service.read_file(input))
}

#[tauri::command]
pub fn read_project_worktree_diff(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspacePathInput,
) -> Result<WorkspaceDiffContent, CommandError> {
    with_session_workspace_service(app, state, |service| service.read_diff(input))
}

fn with_session_workspace_service<T>(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    action: impl FnOnce(SessionWorkspaceService<'_>) -> Result<T, CommandError>,
) -> Result<T, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "工作区读取失败。",
        ).with_reason("workspaceReadFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "工作区读取失败。",
            ).with_reason("workspaceReadFailed")
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
                "工作区读取失败。",
            ).with_reason("workspaceReadFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

    let service = SessionWorkspaceService::new(
        crate::db::project_repository::ProjectRepository::new(&database.connection),
        crate::db::agent_session_repository::AgentSessionRepository::new(&database.connection),
    );
    action(service)
}
