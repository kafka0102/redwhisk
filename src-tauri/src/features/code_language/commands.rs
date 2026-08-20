use tauri::{Manager, State};

use super::host::LanguageHost;
use super::registry::CodeLanguageHostRegistry;
use super::resolver::resolve_bundled_runtime;
use super::workspace::validate_code_language_workspace;
use crate::agent::command_detector::run_command_lookup;
use crate::app_state::AppState;
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::types::code_language::{CodeLanguageHostInput, CodeLanguageHostStatus};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

#[tauri::command]
pub async fn ensure_code_language_host(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CodeLanguageHostInput,
) -> Result<CodeLanguageHostStatus, CommandError> {
    let data_dir = prepare_data_dir(&app, &state)?;
    let resource_dir = app.path().resource_dir().ok();
    let registry = state.code_language_hosts.clone();
    tauri::async_runtime::spawn_blocking(move || {
        ensure_host_blocking(data_dir, resource_dir, registry, input)
    })
    .await
    .map_err(|error| join_error(error.to_string()))?
}

#[tauri::command]
pub async fn stop_code_language_host(
    state: State<'_, AppState>,
    input: CodeLanguageHostInput,
) -> Result<(), CommandError> {
    let registry = state.code_language_hosts.clone();
    let workspace_path = std::path::Path::new(input.workspace_path.trim())
        .canonicalize()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| input.workspace_path.trim().to_string());
    tauri::async_runtime::spawn_blocking(move || {
        registry.stop(input.project_id, &workspace_path);
        Ok(())
    })
    .await
    .map_err(|error| join_error(error.to_string()))?
}

fn ensure_host_blocking(
    data_dir: std::path::PathBuf,
    resource_dir: Option<std::path::PathBuf>,
    registry: CodeLanguageHostRegistry,
    input: CodeLanguageHostInput,
) -> Result<CodeLanguageHostStatus, CommandError> {
    let project = find_project(&data_dir, input.project_id)?;
    let workspace = validate_code_language_workspace(&input.workspace_path, &project.repo_path)?;
    let bundled = resolve_bundled_runtime(resource_dir.as_deref());
    let workspace_path = workspace.to_string_lossy().into_owned();
    Ok(registry.ensure(
        input.project_id,
        &workspace_path,
        bundled.as_ref(),
        || run_command_lookup("node"),
        LanguageHost::spawn,
    ))
}

fn find_project(
    data_dir: &std::path::Path,
    project_id: i64,
) -> Result<crate::types::project::ProjectSummary, CommandError> {
    let database = DatabaseConfig::new(data_dir)
        .open()
        .map_err(CommandError::from)?;
    MigrationRunner::default()
        .run(&database.connection)
        .map_err(|error| {
            CommandError::from(crate::db::connection::DatabaseError::Migration(error))
        })?;
    ProjectRepository::new(&database.connection)
        .find_by_id(project_id)
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::CodeLanguageValidationFailed,
                "代码语言智能校验失败。",
            )
            .with_reason("projectQueryFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?
        .ok_or_else(|| {
            CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
        })
}

fn prepare_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<std::path::PathBuf, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::CodeLanguageValidationFailed,
            "代码语言智能校验失败。",
        )
        .with_reason("dataDirUnavailable")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::CodeLanguageValidationFailed,
                "代码语言智能校验失败。",
            )
            .with_reason("dataDirUnavailable")
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}

fn join_error(message: String) -> CommandError {
    CommandError::new(
        CommandErrorCode::CodeLanguageValidationFailed,
        "代码语言智能校验失败。",
    )
    .with_reason("joinFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", message))
}
