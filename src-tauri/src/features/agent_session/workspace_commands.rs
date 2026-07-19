use serde::Serialize;
use tauri::{Emitter, State};

use crate::app_state::AppState;
use super::workspace::SessionWorkspaceService;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::session_workspace::{
    CodeWorkspaceRootsResponse, ProjectWorkspaceInput, ProjectWorkspacePathInput,
    ProjectWorktreeChangesResponse, ProjectWorktreeCommitHistoryResponse,
    ProjectWorktreeFileTreeResponse, WorkspaceContentSearchInput,
    WorkspaceContentSearchResponse, WorkspaceDiffContent, WorkspaceFileContent,
};

pub const CODE_WORKSPACE_ROOTS_UPDATED_EVENT: &str = "code-workspace-roots-updated";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeWorkspaceRootsUpdatedEvent {
    pub project_id: i64,
    pub roots: Vec<crate::types::session_workspace::CodeWorkspaceRoot>,
}

#[tauri::command]
pub async fn get_project_worktree_changes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspaceInput,
) -> Result<ProjectWorktreeChangesResponse, CommandError> {
    let data_dir = prepare_workspace_data_dir(&app, &state)?;
    run_workspace_blocking(data_dir, move |service| service.get_changes(input)).await
}

#[tauri::command]
pub async fn list_code_workspace_roots(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<CodeWorkspaceRootsResponse, CommandError> {
    let data_dir = prepare_workspace_data_dir(&app, &state)?;
    run_workspace_blocking(data_dir, move |service| {
        service.list_code_workspace_roots(project_id)
    })
    .await
}

#[tauri::command]
pub async fn get_project_worktree_file_tree(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspaceInput,
) -> Result<ProjectWorktreeFileTreeResponse, CommandError> {
    let data_dir = prepare_workspace_data_dir(&app, &state)?;
    run_workspace_blocking(data_dir, move |service| service.get_file_tree(input)).await
}

#[tauri::command]
pub async fn search_project_worktree_content(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: WorkspaceContentSearchInput,
) -> Result<WorkspaceContentSearchResponse, CommandError> {
    let data_dir = prepare_workspace_data_dir(&app, &state)?;
    run_workspace_blocking(data_dir, move |service| service.search_content(input)).await
}

#[tauri::command]
pub async fn get_project_worktree_commit_history(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspaceInput,
) -> Result<ProjectWorktreeCommitHistoryResponse, CommandError> {
    let data_dir = prepare_workspace_data_dir(&app, &state)?;
    run_workspace_blocking(data_dir, move |service| service.get_commit_history(input)).await
}

#[tauri::command]
pub async fn read_project_worktree_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspacePathInput,
) -> Result<WorkspaceFileContent, CommandError> {
    let data_dir = prepare_workspace_data_dir(&app, &state)?;
    run_workspace_blocking(data_dir, move |service| service.read_file(input)).await
}

#[tauri::command]
pub async fn read_project_worktree_diff(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspacePathInput,
) -> Result<WorkspaceDiffContent, CommandError> {
    let data_dir = prepare_workspace_data_dir(&app, &state)?;
    run_workspace_blocking(data_dir, move |service| service.read_diff(input)).await
}

/// 解析 data_dir 并完成幂等本地数据初始化。仅目录解析与迁移幂等检查，轻量，留在
/// async command 体内同步执行；真正阻塞的开库 / git / spawn 放入 `run_workspace_blocking`。
fn prepare_workspace_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<std::path::PathBuf, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "工作区读取失败。",
        )
        .with_reason("workspaceReadFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "工作区读取失败。",
            )
            .with_reason("workspaceReadFailed")
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}

/// 打开工作区数据库并跑迁移（阻塞，须在 `spawn_blocking` 内调用）。
fn open_workspace_database(
    data_dir: &std::path::Path,
) -> Result<crate::db::connection::Database, CommandError> {
    let database = crate::db::connection::DatabaseConfig::new(data_dir)
        .open()
        .map_err(CommandError::from)?;
    crate::db::migrations::MigrationRunner::default()
        .run(&database.connection)
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "工作区读取失败。",
            )
            .with_reason("workspaceReadFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
    Ok(database)
}

fn build_workspace_service(connection: &rusqlite::Connection) -> SessionWorkspaceService<'_> {
    SessionWorkspaceService::new(
        crate::db::project_repository::ProjectRepository::new(connection),
        crate::db::agent_session_repository::AgentSessionRepository::new(connection),
    )
}

/// 在 `spawn_blocking` 阻塞线程内开库、构造 service、执行 action。工作区命令均为
/// 阻塞型（DB + git 子进程），必须经阻塞线程池执行，避免占用 Tauri async 运行时
/// 导致并发命令串行化（曾表现为进入「变更」页时多个命令同时卡数秒）。
async fn run_workspace_blocking<T>(
    data_dir: std::path::PathBuf,
    action: impl FnOnce(SessionWorkspaceService<'_>) -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let database = open_workspace_database(&data_dir)?;
        let service = build_workspace_service(&database.connection);
        action(service)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "工作区读取失败。",
        )
        .with_reason("workspaceReadFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

pub fn emit_code_workspace_roots_updated(
    app: &tauri::AppHandle,
    data_dir: &std::path::Path,
    project_id: i64,
) {
    let Ok(database) = crate::db::connection::DatabaseConfig::new(data_dir).open() else {
        return;
    };
    if crate::db::migrations::MigrationRunner::default()
        .run(&database.connection)
        .is_err()
    {
        return;
    }
    let service = SessionWorkspaceService::new(
        crate::db::project_repository::ProjectRepository::new(&database.connection),
        crate::db::agent_session_repository::AgentSessionRepository::new(&database.connection),
    );
    let Ok(response) = service.list_code_workspace_roots(project_id) else {
        return;
    };
    let _ = app.emit(
        CODE_WORKSPACE_ROOTS_UPDATED_EVENT,
        CodeWorkspaceRootsUpdatedEvent {
            project_id,
            roots: response.roots,
        },
    );
}
