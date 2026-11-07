use std::path::Path;

use tauri::State;

use super::list::list_project_change_requests as list_on_connection;
use crate::app_state::AppState;
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::features::project::commands::prepare_project_data_dir;
use crate::types::change_request::ChangeRequestListResponse;
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
