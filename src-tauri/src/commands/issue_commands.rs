use tauri::State;

use crate::app_state::AppState;
use crate::core::agent_session_service::AgentSessionService;
use crate::core::issue_service::IssueService;
use crate::types::agent_session::AgentSessionStatus;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{
    AdvanceIssueStatusInput, AgentCommitCompletionPreview, CompleteIssueCleanInput,
    CompleteIssueManualInput, CreateIssueInput, DeleteIssueInput, DeleteIssueResult,
    DeleteIssueWorktreeInput, DeleteIssueWorktreeResult, DetectAgentCommitCompletionInput,
    DetectAgentCommitCompletionResult, ExportIssueAttachmentInput, GetIssueSummaryInput,
    GetIssueWorktreeStatusInput, IssueAttachmentPreview, IssueListResponse, IssueRecord,
    IssueSummaryRecord, IssueWorktreeStatusResult, MarkIssueReviewInput,
    PrepareAgentCommitCompletionInput, PreviewIssueAttachmentInput, SaveIssueAttachmentDraftInput,
    SaveIssueAttachmentDraftResult, SendAgentCommitPromptInput, SendAgentCommitPromptResult,
    UpdateIssueInput,
};
use crate::types::issue_completion::{CompleteIssueFlowInput, CompleteIssueFlowResult};

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
pub fn save_issue_attachment_draft(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SaveIssueAttachmentDraftInput,
) -> Result<SaveIssueAttachmentDraftResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    IssueService::save_issue_attachment_draft_in_data_dir(data_dir, input)
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
    let previous_issue = IssueService::list_issues_in_data_dir(&data_dir, input.project_id)?
        .issues
        .into_iter()
        .find(|issue| issue.id == input.issue_id);
    let issue = IssueService::advance_issue_status_in_data_dir(data_dir, input)?;

    shutdown_issue_session_after_status_change(&state, previous_issue.as_ref(), &issue);

    Ok(issue)
}

#[tauri::command]
pub fn complete_issue_manual(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CompleteIssueManualInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let issue = AgentSessionService::complete_issue_manual_in_data_dir(
        data_dir,
        input,
        &state.pty_sessions,
    )?;
    shutdown_closed_issue_session(&state, &issue);
    Ok(issue)
}

#[tauri::command]
pub fn complete_issue_clean(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CompleteIssueCleanInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let issue = AgentSessionService::complete_issue_clean_in_data_dir(
        data_dir,
        input,
        &state.pty_sessions,
    )?;
    shutdown_closed_issue_session(&state, &issue);
    Ok(issue)
}

#[tauri::command]
pub fn complete_issue_flow(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CompleteIssueFlowInput,
) -> Result<CompleteIssueFlowResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let result = IssueService::complete_issue_flow_in_data_dir(
        data_dir,
        input,
        &state.pty_sessions,
        &state.agent_sessions,
    )?;
    if result.action == crate::types::issue_completion::CompleteIssueFlowAction::Completed {
        shutdown_closed_issue_session(&state, &result.issue);
    }
    Ok(result)
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

#[tauri::command]
pub fn get_issue_worktree_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: GetIssueWorktreeStatusInput,
) -> Result<IssueWorktreeStatusResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    AgentSessionService::get_issue_worktree_status_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn delete_issue_worktree(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DeleteIssueWorktreeInput,
) -> Result<DeleteIssueWorktreeResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    AgentSessionService::delete_issue_worktree_in_data_dir(data_dir, input)
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

fn shutdown_issue_session_after_status_change(
    state: &State<'_, AppState>,
    previous_issue: Option<&IssueRecord>,
    issue: &IssueRecord,
) {
    if issue.linked_session_status == Some(AgentSessionStatus::Closed) {
        if let Some(session_id) = issue.linked_session_id {
            shutdown_runtime_session(state, session_id);
        }
        return;
    }

    let Some(previous_issue) = previous_issue else {
        return;
    };
    if previous_issue.linked_session_status == Some(AgentSessionStatus::Running)
        && issue.linked_session_id.is_none()
    {
        if let Some(session_id) = previous_issue.linked_session_id {
            shutdown_runtime_session(state, session_id);
        }
    }
}

fn shutdown_closed_issue_session(state: &State<'_, AppState>, issue: &IssueRecord) {
    if issue.linked_session_status == Some(AgentSessionStatus::Closed) {
        if let Some(session_id) = issue.linked_session_id {
            shutdown_runtime_session(state, session_id);
        }
    }
}

fn shutdown_runtime_session(state: &State<'_, AppState>, session_id: i64) {
    if state.pty_sessions.contains(session_id) {
        let _ = state.pty_sessions.kill(session_id);
    }

    if let Some(handle) = state.agent_sessions.unregister(session_id) {
        handle.shutdown();
    }
}
