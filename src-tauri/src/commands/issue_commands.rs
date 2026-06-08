use tauri::{Manager, State};

use crate::app_state::AppState;
use crate::core::agent_session_service::AgentSessionService;
use crate::core::issue_service::IssueService;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{
    CompleteIssueManualInput, CreateIssueInput, IssueListResponse, IssueRecord,
    MarkIssueReviewInput, UpdateIssueInput,
};

#[tauri::command]
pub fn list_issues(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<IssueListResponse, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    AgentSessionService::reconcile_unrecoverable_running_sessions_in_data_dir(
        &data_dir,
        project_id,
        &state.pty_sessions,
    )?;
    IssueService::list_issues_in_data_dir(data_dir, project_id)
}

#[tauri::command]
pub fn create_issue(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CreateIssueInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    IssueService::create_issue_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn update_issue(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: UpdateIssueInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    IssueService::update_issue_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn mark_issue_review(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: MarkIssueReviewInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    IssueService::mark_issue_review_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn complete_issue_manual(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CompleteIssueManualInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    AgentSessionService::complete_issue_manual_in_data_dir(data_dir, input, &state.pty_sessions)
}

fn prepare_issue_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<std::path::PathBuf, CommandError> {
    let data_dir = app.path().app_data_dir().map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}
