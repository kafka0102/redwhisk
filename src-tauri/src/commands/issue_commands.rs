use tauri::State;

use crate::app_state::AppState;
use crate::core::agent_session_service::AgentSessionService;
use crate::core::issue_service::IssueService;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{
    AdvanceIssueStatusInput, AgentCommitCompletionPreview, CompleteIssueCleanInput,
    CompleteIssueManualInput, CreateIssueInput, DeleteIssueInput, DeleteIssueResult,
    DetectAgentCommitCompletionInput, DetectAgentCommitCompletionResult,
    ExportIssueAttachmentInput, GetIssueSummaryInput, IssueAttachmentPreview, IssueListResponse,
    IssueRecord, IssueSummaryRecord, MarkIssueReviewInput, PrepareAgentCommitCompletionInput,
    PreviewIssueAttachmentInput, SendAgentCommitPromptInput, SendAgentCommitPromptResult,
    UpdateIssueInput,
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
        &state.agent_sessions,
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
pub fn preview_issue_attachment(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: PreviewIssueAttachmentInput,
) -> Result<IssueAttachmentPreview, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    IssueService::preview_issue_attachment_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn export_issue_attachment(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ExportIssueAttachmentInput,
) -> Result<(), CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    IssueService::export_issue_attachment_in_data_dir(data_dir, input)
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
pub fn advance_issue_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: AdvanceIssueStatusInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let issue = IssueService::advance_issue_status_in_data_dir(data_dir, input)?;

    if let Some(session_id) = issue.linked_session_id {
        if issue.linked_session_status
            == Some(crate::types::agent_session::AgentSessionStatus::Closed)
            && state.pty_sessions.contains(session_id)
        {
            let _ = state.pty_sessions.kill(session_id);
        }
    }

    Ok(issue)
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

#[tauri::command]
pub fn complete_issue_clean(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CompleteIssueCleanInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    AgentSessionService::complete_issue_clean_in_data_dir(data_dir, input, &state.pty_sessions)
}

#[tauri::command]
pub fn prepare_agent_commit_completion(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: PrepareAgentCommitCompletionInput,
) -> Result<AgentCommitCompletionPreview, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    IssueService::prepare_agent_commit_completion_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn send_agent_commit_prompt(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SendAgentCommitPromptInput,
) -> Result<SendAgentCommitPromptResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    IssueService::send_agent_commit_prompt_in_data_dir(
        data_dir,
        input,
        &state.pty_sessions,
        &state.agent_sessions,
    )
}

#[tauri::command]
pub fn detect_agent_commit_completion(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DetectAgentCommitCompletionInput,
) -> Result<DetectAgentCommitCompletionResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    AgentSessionService::reconcile_unrecoverable_running_sessions_in_data_dir(
        &data_dir,
        input.project_id,
        &state.pty_sessions,
        &state.agent_sessions,
    )?;
    IssueService::detect_agent_commit_completion_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn get_issue_summary(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: GetIssueSummaryInput,
) -> Result<IssueSummaryRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    AgentSessionService::reconcile_unrecoverable_running_sessions_in_data_dir(
        &data_dir,
        input.project_id,
        &state.pty_sessions,
        &state.agent_sessions,
    )?;
    IssueService::get_issue_summary_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn delete_issue(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DeleteIssueInput,
) -> Result<DeleteIssueResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let result = IssueService::delete_issue_in_data_dir(data_dir, input)?;

    if let Some(session_id) = result.linked_session_id {
        if state.pty_sessions.contains(session_id) {
            let _ = state.pty_sessions.kill(session_id);
        }
    }

    Ok(result)
}

fn prepare_issue_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<std::path::PathBuf, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(app).map_err(|error| {
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
