//! 已完成 Issue 的只读交互式 resume。不改 Issue / Session 状态，也不写日志。

use std::path::Path;

use crate::agent::descriptor_for;
use crate::agent::pty_session_manager::{PtyCommandMode, PtySessionManager, PtySpawnRequest};
use crate::types::agent_session_completed_review::{
    OpenCompletedReviewInput, OpenCompletedReviewResult,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::IssueStatus;

use super::service::{agent_session_database_error, preferred_session_cwd, AgentSessionService};
use super::tui_hook_env::tui_hook_spawn_env;

const STARTUP_CHECK_TOTAL_MS: u64 = 500;
const STARTUP_CHECK_INTERVAL_MS: u64 = 25;

pub(super) fn open_completed_review(
    service: &AgentSessionService<'_>,
    _data_dir: &Path,
    input: OpenCompletedReviewInput,
    pty_sessions: &PtySessionManager,
) -> Result<OpenCompletedReviewResult, CommandError> {
    let session = service.find_project_session(input.project_id, input.session_id)?;
    let issue_id = session.issue_id.ok_or_else(|| {
        CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "未关联 Issue 的 Session 不能回看。",
        )
        .with_reason("missingLinkedIssue")
        .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id))
    })?;
    let issue = service
        .issue_repository
        .find_by_id(issue_id)
        .map_err(agent_session_database_error)?
        .ok_or_else(|| {
            CommandError::new(CommandErrorCode::IssueNotFound, "Issue 不存在。")
                .with_reason("issueNotFound")
                .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue_id))
        })?;
    if issue.status != IssueStatus::Completed {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "只有已完成 Issue 可以进入完成回看。",
        )
        .with_reason("completedReviewRequiresCompletedIssue")
        .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue_id)));
    }

    let thread_id = session
        .provider_session_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "当前 Session 缺少可续接的会话标识。",
            )
            .with_reason("missingResumeSessionId")
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id))
        })?;
    let profile = service
        .agent_profile_repository
        .find_profile_by_id(session.agent_profile_id)
        .map_err(agent_session_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::AgentProfileValidationFailed,
                "Agent Profile 不存在。",
            )
            .with_reason("profileNotFound")
            .with_detail(
                ErrorDetail::new("AgentProfile")
                    .with_value("agentProfileId", session.agent_profile_id),
            )
        })?;
    let descriptor = descriptor_for(&profile.agent_type);
    if !descriptor.ui_capabilities().supports_tui_resume {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "当前 Agent 不支持交互式会话续接。",
        )
        .with_reason("tuiResumeNotSupported")
        .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id)));
    }

    let cwd = preferred_session_cwd(&session);
    if !Path::new(&cwd).is_dir() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "完成回看的工作区目录不存在。",
        )
        .with_reason("workspaceMissingForCompletedReview")
        .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id))
        .with_detail(ErrorDetail::new("Workspace").with_value("path", cwd)));
    }

    let command = descriptor.build_tui_resume_command(&session.command_snapshot, &thread_id);
    if pty_sessions.contains(session.id) {
        return Ok(OpenCompletedReviewResult {
            session_id: session.id,
            command,
            working_dir: cwd,
        });
    }

    let pending = pty_sessions
        .spawn_pending(&PtySpawnRequest {
            mode: PtyCommandMode::ExecReplace,
            command: command.clone(),
            working_dir: cwd.clone(),
            log_path: String::new(),
            discard_log: true,
            initial_prompt: None,
            rows: 32,
            cols: 120,
            startup_check_total_ms: STARTUP_CHECK_TOTAL_MS,
            startup_check_interval_ms: STARTUP_CHECK_INTERVAL_MS,
            extra_env: tui_hook_spawn_env(profile.agent_type.as_db_str(), session.id)
                .into_iter()
                .collect(),
        })
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionStartFailed,
                "完成回看启动失败。",
            )
            .with_reason("completedReviewSpawnFailed")
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id))
            .with_detail(ErrorDetail::new("Cause").with_value("message", error))
        })?;

    if let Err(error) =
        pty_sessions.register_for_project(input.project_id, session.id, pending, |_exit_status| {})
    {
        error.pending.terminate();
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionStartFailed,
            "完成回看注册失败。",
        )
        .with_reason("completedReviewSpawnFailed")
        .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id))
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.message)));
    }

    Ok(OpenCompletedReviewResult {
        session_id: session.id,
        command,
        working_dir: cwd,
    })
}
