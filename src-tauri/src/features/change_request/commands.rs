use std::path::Path;

use tauri::Emitter;
use tauri::State;

use super::detail::close_change_request as close_on_connection;
use super::detail::get_project_change_request as get_on_connection;
use super::detail::mark_change_request_ready as mark_ready_on_connection;
use super::detail::request_change_request_review as request_review_on_connection;
use super::links::link_change_request_issue as link_on_connection;
use super::list::list_project_change_requests as list_on_connection;
use super::sync::sync_connected_change_requests;
use crate::app_state::AppState;
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::features::issue::ProjectIssueForge;
use crate::features::project::commands::prepare_project_data_dir;
use crate::types::change_request::{
    ChangeRequestDetail, ChangeRequestListResponse, ChangeRequestSyncChangedEvent,
    ChangeRequestSyncResult, CHANGE_REQUEST_SYNC_CHANGED_EVENT,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

#[tauri::command]
pub async fn list_project_change_requests(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
    filter: Option<String>,
    viewer_login: Option<String>,
) -> Result<ChangeRequestListResponse, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    let filter = filter.unwrap_or_default();
    let viewer_login = viewer_login.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        list_project_change_requests_in_data_dir(&data_dir, project_id, &filter, &viewer_login)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Change request query failed.",
        )
        .with_reason("queryFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

pub(crate) fn list_project_change_requests_in_data_dir(
    data_dir: &Path,
    project_id: i64,
    filter: &str,
    viewer_login: &str,
) -> Result<ChangeRequestListResponse, CommandError> {
    let database = DatabaseConfig::new(data_dir)
        .open()
        .map_err(CommandError::from)?;
    MigrationRunner::default()
        .run(&database.connection)
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::IssuePersistenceFailed,
                "Change request query failed.",
            )
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
    list_on_connection(&database.connection, project_id, filter, viewer_login)
}

#[tauri::command]
pub async fn sync_project_change_requests(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<ChangeRequestSyncResult, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = sync_project_change_requests_in_data_dir(&data_dir, project_id)?;
        emit_change_request_sync_changed(
            &app_handle,
            &ChangeRequestSyncChangedEvent {
                project_id,
                outcome: result.outcome,
            },
        );
        Ok(result)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Failed to sync change requests.",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn get_project_change_request(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
    provider: String,
    number: i64,
) -> Result<ChangeRequestDetail, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        get_project_change_request_in_data_dir(&data_dir, project_id, &provider, number)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Failed to load change request detail.",
        )
        .with_reason("changeRequestDetailFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn mark_change_request_ready(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
    provider: String,
    number: i64,
) -> Result<ChangeRequestDetail, CommandError> {
    run_action(app, state, project_id, provider, move |opened, provider| {
        mark_ready_on_connection(
            &opened.database.connection,
            project_id,
            &provider,
            number,
            &opened.forge,
            now_millis(),
        )
    })
    .await
}

#[tauri::command]
pub async fn request_change_request_review(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
    provider: String,
    number: i64,
    reviewer: String,
) -> Result<ChangeRequestDetail, CommandError> {
    run_action(app, state, project_id, provider, move |opened, provider| {
        request_review_on_connection(
            &opened.database.connection,
            project_id,
            &provider,
            number,
            &reviewer,
            &opened.forge,
            now_millis(),
        )
    })
    .await
}

#[tauri::command]
pub async fn close_change_request(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
    provider: String,
    number: i64,
) -> Result<ChangeRequestDetail, CommandError> {
    run_action(app, state, project_id, provider, move |opened, provider| {
        close_on_connection(
            &opened.database.connection,
            project_id,
            &provider,
            number,
            &opened.forge,
            now_millis(),
        )
    })
    .await
}

#[tauri::command]
pub async fn link_change_request_issue(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
    change_request_id: i64,
    issue_id: i64,
) -> Result<(), CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        link_change_request_issue_in_data_dir(&data_dir, project_id, change_request_id, issue_id)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Failed to link change request.",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

struct OpenedProject {
    database: crate::db::connection::Database,
    forge: ProjectIssueForge,
}

async fn run_action<F>(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
    provider: String,
    action: F,
) -> Result<ChangeRequestDetail, CommandError>
where
    F: FnOnce(&OpenedProject, &str) -> Result<ChangeRequestDetail, CommandError> + Send + 'static,
{
    let data_dir = prepare_project_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let opened = open_project_forge(&data_dir, project_id)?;
        action(&opened, &provider)
    })
    .await
    .map_err(action_task_failed)?
}

fn open_project_forge(data_dir: &Path, project_id: i64) -> Result<OpenedProject, CommandError> {
    let database = open_database(data_dir)?;
    let repo_dir = crate::db::project_repository::ProjectRepository::new(&database.connection)
        .find_by_id(project_id)
        .map_err(persistence)?
        .map(|project| std::path::PathBuf::from(project.repo_path))
        .unwrap_or_default();
    let forge_provider =
        crate::db::project_issue_source_repository::ProjectIssueSourceRepository::new(
            &database.connection,
        )
        .get(project_id)
        .map_err(persistence)?
        .and_then(|settings| settings.connection.provider);
    Ok(OpenedProject {
        forge: ProjectIssueForge::new(forge_provider, repo_dir),
        database,
    })
}

fn action_task_failed(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::IssuePersistenceFailed,
        "Change request action failed.",
    )
    .with_reason("changeRequestActionFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn emit_change_request_sync_changed(app: &tauri::AppHandle, event: &ChangeRequestSyncChangedEvent) {
    let _ = app.emit(CHANGE_REQUEST_SYNC_CHANGED_EVENT, event);
}

fn sync_project_change_requests_in_data_dir(
    data_dir: &Path,
    project_id: i64,
) -> Result<ChangeRequestSyncResult, CommandError> {
    let database = open_database(data_dir)?;
    let repo_dir = crate::db::project_repository::ProjectRepository::new(&database.connection)
        .find_by_id(project_id)
        .map_err(persistence)?
        .map(|project| std::path::PathBuf::from(project.repo_path))
        .unwrap_or_default();
    sync_connected_change_requests(&database.connection, project_id, repo_dir, now_millis())
}

fn get_project_change_request_in_data_dir(
    data_dir: &Path,
    project_id: i64,
    provider: &str,
    number: i64,
) -> Result<ChangeRequestDetail, CommandError> {
    let database = open_database(data_dir)?;
    let repo_dir = crate::db::project_repository::ProjectRepository::new(&database.connection)
        .find_by_id(project_id)
        .map_err(persistence)?
        .map(|project| std::path::PathBuf::from(project.repo_path))
        .unwrap_or_default();
    let forge_provider =
        crate::db::project_issue_source_repository::ProjectIssueSourceRepository::new(
            &database.connection,
        )
        .get(project_id)
        .map_err(persistence)?
        .and_then(|settings| settings.connection.provider);
    let forge = ProjectIssueForge::new(forge_provider, repo_dir);
    get_on_connection(
        &database.connection,
        project_id,
        provider,
        number,
        &forge,
        now_millis(),
    )
}

fn link_change_request_issue_in_data_dir(
    data_dir: &Path,
    project_id: i64,
    change_request_id: i64,
    issue_id: i64,
) -> Result<(), CommandError> {
    let database = open_database(data_dir)?;
    link_on_connection(
        &database.connection,
        project_id,
        change_request_id,
        issue_id,
        now_millis(),
    )
}

fn open_database(data_dir: &Path) -> Result<crate::db::connection::Database, CommandError> {
    let database = DatabaseConfig::new(data_dir)
        .open()
        .map_err(CommandError::from)?;
    MigrationRunner::default()
        .run(&database.connection)
        .map_err(persistence)?;
    Ok(database)
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn persistence(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::IssuePersistenceFailed,
        "Failed to sync change requests.",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
