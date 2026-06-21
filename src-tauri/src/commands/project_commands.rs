use tauri::{Manager, State};

use crate::app_state::AppState;
use crate::commands::agent_skill_commands::trigger_project_skill_refresh;
use crate::core::project_service::ProjectService;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project::{
    CreateProjectInput, OpenProjectInput, OpenProjectWindowResponse, ProjectListResponse,
    ProjectSummary, UpdateProjectCompletionPolicyInput, UpdateProjectSettingsInput,
    ValidateProjectRepoPathInput, ValidateProjectRepoPathResponse,
};

#[tauri::command]
pub fn create_project(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CreateProjectInput,
) -> Result<ProjectSummary, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    let project = ProjectService::create_project_in_data_dir(data_dir, input)?;
    trigger_project_skill_refresh(
        app,
        state.agent_skills.clone(),
        project.id,
        std::path::PathBuf::from(&project.repo_path),
    );
    Ok(project)
}

#[tauri::command]
pub fn list_projects(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ProjectListResponse, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    ProjectService::list_projects_in_data_dir(data_dir)
}

#[tauri::command]
pub fn open_project(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: OpenProjectInput,
) -> Result<ProjectSummary, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    let project = ProjectService::open_project_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )?;
    trigger_project_skill_refresh(
        app,
        state.agent_skills.clone(),
        project.id,
        std::path::PathBuf::from(&project.repo_path),
    );
    Ok(project)
}

#[tauri::command]
pub fn update_project_completion_policy(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: UpdateProjectCompletionPolicyInput,
) -> Result<ProjectSummary, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    ProjectService::update_project_completion_policy_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn update_project_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: UpdateProjectSettingsInput,
) -> Result<ProjectSummary, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    ProjectService::update_project_settings_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn validate_project_repo_path(
    input: ValidateProjectRepoPathInput,
) -> Result<ValidateProjectRepoPathResponse, CommandError> {
    ProjectService::validate_project_repo_path(&input.repo_path)
}

#[tauri::command]
pub async fn open_project_window(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: OpenProjectInput,
) -> Result<OpenProjectWindowResponse, CommandError> {
    let data_dir = prepare_project_data_dir(&app, &state)?;
    let project = ProjectService::open_project_for_window_in_data_dir(
        &data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )?;
    let window_label = format!("project-{}", project.id);

    if let Some(existing_window) = app.get_webview_window(&window_label) {
        existing_window.show().map_err(|error| {
            project_window_error(project.id, "Project 窗口显示失败。", error.to_string())
        })?;
        existing_window.set_focus().map_err(|error| {
            project_window_error(project.id, "Project 窗口聚焦失败。", error.to_string())
        })?;
    } else {
        tauri::WebviewWindowBuilder::new(
            &app,
            window_label.clone(),
            tauri::WebviewUrl::App(format!("index.html?projectId={}", project.id).into()),
        )
        .title(format!("RedWhisk - {}", project.name))
        .inner_size(800.0, 600.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 22.0))
        .build()
        .map_err(|error| {
            project_window_error(project.id, "Project 窗口打开失败。", error.to_string())
        })?;
    }

    ProjectService::record_project_opened_in_data_dir(data_dir, project.id)?;

    Ok(OpenProjectWindowResponse {
        project_id: project.id,
        window_label,
    })
}

fn project_window_error(project_id: i64, message: &str, cause: String) -> CommandError {
    CommandError::new(CommandErrorCode::ProjectPersistenceFailed, message)
        .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
        .with_detail(ErrorDetail::new("Cause").with_value("message", cause))
}

fn prepare_project_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<std::path::PathBuf, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::ProjectPersistenceFailed,
            "Project 保存失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::ProjectPersistenceFailed,
                "Project 保存失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}
