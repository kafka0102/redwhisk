use std::path::Path;

use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_registry::AgentSessionRegistry;
use tauri::State;

use super::service::IssueService;
use crate::app_state::AppState;
use crate::features::agent_session::AgentSessionService;
use crate::types::agent_session::AgentSessionStatus;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{
    AdvanceIssueStatusInput, AgentCommitCompletionPreview, CompleteIssueCleanInput,
    CompleteIssueManualInput, CreateIssueInput, DeleteIssueInput, DeleteIssueResult,
    DeleteIssueWorktreeInput, DeleteIssueWorktreeResult, DetectAgentCommitCompletionInput,
    DetectAgentCommitCompletionResult, ExportIssueAttachmentInput, GetIssueSummaryInput,
    GetIssueTimelineInput, GetIssueWorktreeStatusInput, IssueAttachmentPreview, IssueListResponse,
    IssueRecord, IssueStatus, IssueSummaryRecord, IssueTimelineResponse, IssueWorktreeStatusResult,
    MarkIssueReviewInput, PrepareAgentCommitCompletionInput, PreviewIssueAttachmentInput,
    SaveIssueAttachmentDraftInput, SaveIssueAttachmentDraftResult, SendAgentCommitPromptInput,
    SendAgentCommitPromptResult, UpdateIssueInput,
};
use crate::types::issue_completion::{CompleteIssueFlowInput, CompleteIssueFlowResult};

#[tauri::command]
pub async fn list_issues(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
    limit: Option<i64>,
    offset: Option<i64>,
    status: Option<IssueStatus>,
    per_status_limit: Option<i64>,
) -> Result<IssueListResponse, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let pty_sessions = state.pty_sessions.clone();
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        AgentSessionService::reconcile_unrecoverable_running_sessions_in_data_dir(
            &data_dir,
            project_id,
            &pty_sessions,
            &agent_sessions,
        )?;
        // 首屏：四个状态各取前 N 条，单次返回扁平列表。
        if let Some(per_status_limit) = per_status_limit {
            return IssueService::list_issues_per_status_in_data_dir(
                data_dir,
                project_id,
                per_status_limit,
            );
        }
        // 滚动加载下一页：按状态 + limit/offset 取数。
        if status.is_some() || limit.is_some() || offset.is_some() {
            return IssueService::list_issues_page_in_data_dir(
                data_dir, project_id, status, limit, offset,
            );
        }
        IssueService::list_issues_in_data_dir(data_dir, project_id)
    })
    .await
    .map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 查询失败。")
            .with_reason("queryFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn create_issue(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CreateIssueInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        IssueService::create_issue_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
            .with_reason("saveFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn update_issue(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: UpdateIssueInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        IssueService::update_issue_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
            .with_reason("saveFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn preview_issue_attachment(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: PreviewIssueAttachmentInput,
) -> Result<IssueAttachmentPreview, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        IssueService::preview_issue_attachment_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Issue 附件预览失败。",
        )
        .with_reason("attachmentPreviewFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn export_issue_attachment(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ExportIssueAttachmentInput,
) -> Result<(), CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        IssueService::export_issue_attachment_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Issue 附件导出失败。",
        )
        .with_reason("attachmentExportFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn save_issue_attachment_draft(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SaveIssueAttachmentDraftInput,
) -> Result<SaveIssueAttachmentDraftResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        IssueService::save_issue_attachment_draft_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Issue 附件草稿保存失败。",
        )
        .with_reason("attachmentDraftSaveFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn mark_issue_review(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: MarkIssueReviewInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        IssueService::mark_issue_review_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Issue 状态更新失败。",
        )
        .with_reason("statusUpdateFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn advance_issue_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: AdvanceIssueStatusInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let pty_sessions = state.pty_sessions.clone();
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let previous_issue = IssueService::list_issues_in_data_dir(&data_dir, input.project_id)?
            .issues
            .into_iter()
            .find(|issue| issue.id == input.issue_id);
        let issue = IssueService::advance_issue_status_in_data_dir(data_dir, input)?;

        shutdown_issue_session_after_status_change(
            &pty_sessions,
            &agent_sessions,
            previous_issue.as_ref(),
            &issue,
        );

        Ok(issue)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Issue 状态更新失败。",
        )
        .with_reason("statusUpdateFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn complete_issue_manual(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CompleteIssueManualInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let pty_sessions = state.pty_sessions.clone();
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let issue = AgentSessionService::complete_issue_manual_in_data_dir(
            data_dir,
            input,
            &pty_sessions,
            &agent_sessions,
        )?;
        shutdown_closed_issue_session(&pty_sessions, &agent_sessions, &issue);
        Ok(issue)
    })
    .await
    .map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 完成失败。")
            .with_reason("completeFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn complete_issue_clean(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CompleteIssueCleanInput,
) -> Result<IssueRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let pty_sessions = state.pty_sessions.clone();
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let issue = AgentSessionService::complete_issue_clean_in_data_dir(
            data_dir,
            input,
            &pty_sessions,
            &agent_sessions,
        )?;
        shutdown_closed_issue_session(&pty_sessions, &agent_sessions, &issue);
        Ok(issue)
    })
    .await
    .map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 完成失败。")
            .with_reason("completeFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn complete_issue_flow(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CompleteIssueFlowInput,
) -> Result<CompleteIssueFlowResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let pty_sessions = state.pty_sessions.clone();
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = IssueService::complete_issue_flow_in_data_dir(
            data_dir,
            input,
            &pty_sessions,
            &agent_sessions,
        )?;
        if result.action == crate::types::issue_completion::CompleteIssueFlowAction::Completed {
            shutdown_closed_issue_session(&pty_sessions, &agent_sessions, &result.issue);
        }
        Ok(result)
    })
    .await
    .map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 完成失败。")
            .with_reason("completeFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn prepare_agent_commit_completion(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: PrepareAgentCommitCompletionInput,
) -> Result<AgentCommitCompletionPreview, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        IssueService::prepare_agent_commit_completion_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Issue 完成预检失败。",
        )
        .with_reason("completePrecheckFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn send_agent_commit_prompt(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SendAgentCommitPromptInput,
) -> Result<SendAgentCommitPromptResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let pty_sessions = state.pty_sessions.clone();
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        IssueService::send_agent_commit_prompt_in_data_dir(
            data_dir,
            input,
            &pty_sessions,
            &agent_sessions,
        )
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Issue 自动提交失败。",
        )
        .with_reason("autoCommitFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn detect_agent_commit_completion(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DetectAgentCommitCompletionInput,
) -> Result<DetectAgentCommitCompletionResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let pty_sessions = state.pty_sessions.clone();
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        AgentSessionService::reconcile_unrecoverable_running_sessions_in_data_dir(
            &data_dir,
            input.project_id,
            &pty_sessions,
            &agent_sessions,
        )?;
        IssueService::detect_agent_commit_completion_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Issue 完成检测失败。",
        )
        .with_reason("completeDetectionFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn get_issue_summary(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: GetIssueSummaryInput,
) -> Result<IssueSummaryRecord, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let pty_sessions = state.pty_sessions.clone();
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        AgentSessionService::reconcile_unrecoverable_running_sessions_in_data_dir(
            &data_dir,
            input.project_id,
            &pty_sessions,
            &agent_sessions,
        )?;
        IssueService::get_issue_summary_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Issue 摘要读取失败。",
        )
        .with_reason("summaryReadFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn get_issue_timeline(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: GetIssueTimelineInput,
) -> Result<IssueTimelineResponse, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        IssueService::get_issue_timeline_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Issue 时间轴读取失败。",
        )
        .with_reason("timelineReadFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn delete_issue(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DeleteIssueInput,
) -> Result<DeleteIssueResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let pty_sessions = state.pty_sessions.clone();
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = IssueService::delete_issue_in_data_dir(data_dir, input)?;

        if let Some(session_id) = result.linked_session_id {
            shutdown_runtime_session(&pty_sessions, &agent_sessions, session_id);
        }

        crate::features::agent_session::remove_session_log_file(
            result.linked_session_log_path.as_deref(),
        );

        if let Some(cleanup) = result.worktree_cleanup.as_ref() {
            if Path::new(&cleanup.workspace_path).exists() {
                let _ = crate::git::worktree::cleanup_worktree(
                    &cleanup.repo_path,
                    &cleanup.workspace_path,
                    &cleanup.workspace_branch,
                );
            }
        }

        Ok(result)
    })
    .await
    .map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 删除失败。")
            .with_reason("deleteFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn get_issue_worktree_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: GetIssueWorktreeStatusInput,
) -> Result<IssueWorktreeStatusResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        AgentSessionService::get_issue_worktree_status_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Worktree 状态查询失败。",
        )
        .with_reason("worktreeStatusQueryFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn delete_issue_worktree(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DeleteIssueWorktreeInput,
) -> Result<DeleteIssueWorktreeResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let project_id = input.project_id;
    let event_data_dir = data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = AgentSessionService::delete_issue_worktree_in_data_dir(data_dir, input)?;
        crate::features::agent_session::workspace_commands::emit_code_workspace_roots_updated(
            &app,
            &event_data_dir,
            project_id,
        );
        Ok(result)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssuePersistenceFailed,
            "Worktree 删除失败。",
        )
        .with_reason("worktreeDeleteFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

fn prepare_issue_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<std::path::PathBuf, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(app).map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
            .with_reason("saveFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
                .with_reason("saveFailed")
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}

fn shutdown_issue_session_after_status_change(
    pty_sessions: &PtySessionManager,
    agent_sessions: &AgentSessionRegistry,
    previous_issue: Option<&IssueRecord>,
    issue: &IssueRecord,
) {
    if issue.linked_session_status == Some(AgentSessionStatus::Closed) {
        if let Some(session_id) = issue.linked_session_id {
            shutdown_runtime_session(pty_sessions, agent_sessions, session_id);
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
            shutdown_runtime_session(pty_sessions, agent_sessions, session_id);
        }
    }
}

fn shutdown_closed_issue_session(
    pty_sessions: &PtySessionManager,
    agent_sessions: &AgentSessionRegistry,
    issue: &IssueRecord,
) {
    if issue.linked_session_status == Some(AgentSessionStatus::Closed) {
        if let Some(session_id) = issue.linked_session_id {
            shutdown_runtime_session(pty_sessions, agent_sessions, session_id);
        }
    }
}

fn shutdown_runtime_session(
    pty_sessions: &PtySessionManager,
    agent_sessions: &AgentSessionRegistry,
    session_id: i64,
) {
    if pty_sessions.contains(session_id) {
        let _ = pty_sessions.kill(session_id);
    }

    if let Some(handle) = agent_sessions.unregister(session_id) {
        handle.shutdown();
    }
}
