use tauri::{Manager, State};

use crate::app_state::AppState;
use crate::features::project_terminal::ProjectTerminalService;
use crate::features::settings::agent_skill_commands::trigger_project_skill_refresh;
use super::service::ProjectService;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project::{
    CreateProjectInput, OpenProjectInput, OpenProjectWindowResponse, ProjectListResponse,
    ProjectSummary, UpdateProjectSettingsInput, ValidateProjectRepoPathInput,
    ValidateProjectRepoPathResponse,
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
pub async fn list_projects(
    app: tauri::AppHandle,
) -> Result<ProjectListResponse, CommandError> {
    let data_dir = project_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        ProjectService::list_projects_in_data_dir(data_dir)
    })
    .await
    .map_err(project_join_error)?
}

#[tauri::command]
pub async fn open_project(
    app: tauri::AppHandle,
    caller_window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    input: OpenProjectInput,
) -> Result<ProjectSummary, CommandError> {
    let window_label = caller_window.label().to_string();
    let data_dir = project_data_dir(&app)?;
    let restore_data_dir = data_dir.clone();
    let project_terminals = state.project_terminals.clone();
    let pty_sessions = state.pty_sessions.clone();
    let project = tauri::async_runtime::spawn_blocking(move || {
        ProjectService::open_project_in_data_dir(data_dir, input)
    })
    .await
    .map_err(project_join_error)??;

    // 登记该项目当前显示在调用方窗口，切换菜单据此去重聚焦（含 main 原地占用的情况）。
    state.record_project_window(project.id, window_label);

    // 终端恢复可能包含交互 shell PATH 解析与 PTY 启动（冷启动可达数秒），
    // 不阻塞 open_project 返回，工作台可先渲染。
    let project_id = project.id;
    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            ProjectTerminalService::restore_project_terminals_in_data_dir(
                restore_data_dir,
                project_id,
                &project_terminals,
                &pty_sessions,
            )
        })
        .await;
    });

    trigger_project_skill_refresh(
        app,
        state.agent_skills.clone(),
        project.id,
        std::path::PathBuf::from(&project.repo_path),
    );
    Ok(project)
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
    let project_id = input.project_id;

    // 已打开则聚焦：优先查窗口归属映射（覆盖项目被 main 原地占用的情况），再兜底 project-{id} label。
    if let Some(label) = state.find_project_window(project_id) {
        if let Some(existing_window) = app.get_webview_window(&label) {
            focus_existing_window(&existing_window, project_id)?;
            return Ok(OpenProjectWindowResponse {
                project_id,
                window_label: label,
            });
        }
        state.forget_project_window(project_id);
    }
    let fallback_label = format!("project-{}", project_id);
    if let Some(existing_window) = app.get_webview_window(&fallback_label) {
        focus_existing_window(&existing_window, project_id)?;
        state.record_project_window(project_id, fallback_label.clone());
        return Ok(OpenProjectWindowResponse {
            project_id,
            window_label: fallback_label,
        });
    }

    // 轻量打开：仅取项目记录用于窗口标题，不做恢复终端 / worktree 探测 / 更新 last_opened
    // ——这些由新窗口启动后的 open_project 完成并登记其窗口归属，避免一次切换跑两遍重活。
    let data_dir = project_data_dir(&app)?;
    let project = tauri::async_runtime::spawn_blocking(move || {
        ProjectService::project_for_window_in_data_dir(data_dir, input)
    })
    .await
    .map_err(project_join_error)??;

    let window_label = format!("project-{}", project.id);
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
            .with_reason("windowOpenFailed")
    })?;

    state.record_project_window(project.id, window_label.clone());
    Ok(OpenProjectWindowResponse {
        project_id: project.id,
        window_label,
    })
}

fn focus_existing_window(
    window: &tauri::WebviewWindow,
    project_id: i64,
) -> Result<(), CommandError> {
    window.show().map_err(|error| {
        project_window_error(project_id, "Project 窗口显示失败。", error.to_string())
            .with_reason("windowShowFailed")
    })?;
    window.set_focus().map_err(|error| {
        project_window_error(project_id, "Project 窗口聚焦失败。", error.to_string())
            .with_reason("windowFocusFailed")
    })?;
    Ok(())
}

fn project_window_error(project_id: i64, message: &str, cause: String) -> CommandError {
    CommandError::new(CommandErrorCode::ProjectPersistenceFailed, message)
        .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
        .with_detail(ErrorDetail::new("Cause").with_value("message", cause))
}

fn project_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, CommandError> {
    crate::local_data_path::redwhisk_data_dir(app).map_err(|error| {
        CommandError::new(CommandErrorCode::ProjectPersistenceFailed, "Project 保存失败。")
            .with_reason("saveFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })
}

/// spawn_blocking 任务 Join 失败（panic / 取消）的错误映射。
fn project_join_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(CommandErrorCode::ProjectPersistenceFailed, "Project 操作失败。")
        .with_reason("joinFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn prepare_project_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<std::path::PathBuf, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::ProjectPersistenceFailed,
            "Project 保存失败。",
        ).with_reason("saveFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::ProjectPersistenceFailed,
                "Project 保存失败。",
            ).with_reason("saveFailed")
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}
