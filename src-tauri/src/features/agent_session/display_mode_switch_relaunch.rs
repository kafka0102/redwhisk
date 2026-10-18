//! 展示形式切换后，用同一个 Provider 会话标识按新形式拉起，不发送 prompt。

use std::path::Path;

use serde_json::json;

use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::descriptor_for;
use crate::agent::provider_factory::{AgentSessionProviderFactory, AgentSessionStartRequest};
use crate::agent::pty_session_manager::{
    PtyCommandMode, PtyExitStatus, PtySessionManager, PtySpawnRequest,
};
use crate::agent::session_registry::AgentSessionRegistry;
use crate::db::agent_profile_repository::AgentProfileRow;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::event_repository::EventRepository;
use crate::types::agent_profile::AgentType;
use crate::types::agent_session::AgentSessionRecord;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::session_event::SessionEventType;

use super::display_mode_switch::display_mode_switch_rejected;
use super::launch::start_provider_session;
use super::service::{
    agent_session_database_error, current_epoch_millis, preferred_session_cwd, AgentSessionService,
};
use super::tui_hook_env::tui_hook_spawn_env;

const STARTUP_CHECK_TOTAL_MS: u64 = 500;
const STARTUP_CHECK_INTERVAL_MS: u64 = 25;

pub(super) fn relaunch_structured(
    service: &AgentSessionService<'_>,
    data_dir: &Path,
    session: &AgentSessionRecord,
    profile: &AgentProfileRow,
    provider_session_id: &str,
    agent_registry: &AgentSessionRegistry,
    broadcaster: &AgentEventBroadcaster,
    factory: &dyn AgentSessionProviderFactory,
) -> Result<(), CommandError> {
    let agent_type = &profile.agent_type;
    let descriptor = descriptor_for(agent_type);
    let binary = if session.command_snapshot.trim().is_empty() {
        descriptor.fallback_command_when_snapshot_empty()
    } else {
        session.command_snapshot.clone()
    };
    let cwd = preferred_session_cwd(session);
    agent_registry.mark_starting(session.id);
    // 同 `resume_structured_agent_session`：切形态后沿用启动期模型。
    let resume_model = service.resume_model_arg(profile, data_dir, &binary, session.id)?;
    let runtime =
        descriptor.resolve_runtime_config(data_dir, &binary, resume_model.as_deref(), None);
    let started = match start_provider_session(
        factory,
        AgentSessionStartRequest {
            agent_type: agent_type.clone(),
            project_id: session.project_id,
            session_id: session.id,
            binary,
            cwd,
            // 同 `resume_structured_agent_session`：结构化 argv 现算，切形态后
            // 必须沿用 profile 权限策略，否则 provider 退回逐条问审批。
            mode_id: Some(profile.mode.clone()),
            dangerous: profile.dangerous,
            model: runtime.model,
            effort: runtime.effort,
            resume_thread_id: Some(provider_session_id.to_string()),
            broadcaster: broadcaster.clone(),
            config_home: runtime.config_home,
        },
    ) {
        Ok(started) => started,
        Err(error) => {
            agent_registry.unmark_starting(session.id);
            return Err(error);
        }
    };
    if let Err(error) =
        mark_switched_session_running(service, session, provider_session_id, &session.log_path)
    {
        agent_registry.unmark_starting(session.id);
        started.handle.shutdown();
        return Err(error);
    }
    broadcaster.register_session(session.id);
    agent_registry.register(session.project_id, session.id, started.handle);
    Ok(())
}

pub(super) fn relaunch_tui(
    service: &AgentSessionService<'_>,
    data_dir: &Path,
    session: &AgentSessionRecord,
    agent_type: &AgentType,
    provider_session_id: &str,
    agent_registry: &AgentSessionRegistry,
    pty_sessions: &PtySessionManager,
) -> Result<(), CommandError> {
    let descriptor = descriptor_for(agent_type);
    if !descriptor.ui_capabilities().supports_tui_resume {
        return Err(display_mode_switch_rejected(
            session.id,
            "tuiResumeNotSupported",
        ));
    }
    let resume_command =
        descriptor.build_tui_resume_command(&session.command_snapshot, provider_session_id);
    // 外层 `exec` 只作用于第一条命令，登录 shell 又会改写 cwd。
    // 用 `sh -c` 先进入仓库再 exec resume，argv 才会落在仓库里。
    let cwd = preferred_session_cwd(session);
    let resume_command = format!(
        "sh -c {}",
        shell_single_quote(&format!(
            "cd {} && exec {resume_command}",
            shell_single_quote(&cwd)
        ))
    );
    agent_registry.mark_starting(session.id);
    let pending = match pty_sessions.spawn_pending(&PtySpawnRequest {
        mode: PtyCommandMode::ExecReplace,
        command: resume_command,
        working_dir: cwd,
        log_path: session.log_path.clone(),
        discard_log: false,
        initial_prompt: None,
        rows: 32,
        cols: 120,
        startup_check_total_ms: STARTUP_CHECK_TOTAL_MS,
        startup_check_interval_ms: STARTUP_CHECK_INTERVAL_MS,
        extra_env: tui_hook_spawn_env(agent_type.as_db_str(), session.id)
            .into_iter()
            .collect(),
    }) {
        Ok(pending) => pending,
        Err(error) => {
            agent_registry.unmark_starting(session.id);
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionStartFailed,
                "Failed to start the session after switching display mode.",
            )
            .with_reason("displayModeSwitchSpawnFailed")
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id))
            .with_detail(ErrorDetail::new("Cause").with_value("message", error)));
        }
    };
    if let Err(error) =
        mark_switched_session_running(service, session, provider_session_id, &session.log_path)
    {
        agent_registry.unmark_starting(session.id);
        pending.terminate();
        return Err(error);
    }
    let session_id = session.id;
    let data_dir = data_dir.to_path_buf();
    let failure_data_dir = data_dir.clone();
    if let Err(error) = pty_sessions.register_for_project(
        session.project_id,
        session_id,
        pending,
        move |exit_status| {
            let _ = AgentSessionService::record_session_termination_in_data_dir(
                &data_dir,
                session_id,
                exit_status,
            );
        },
    ) {
        agent_registry.unmark_starting(session_id);
        error.pending.terminate();
        let _ = AgentSessionService::record_session_termination_in_data_dir(
            &failure_data_dir,
            session_id,
            PtyExitStatus { exit_code: None },
        );
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionStartFailed,
            "Failed to register the session after switching display mode.",
        )
        .with_reason("displayModeSwitchSpawnFailed")
        .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id))
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.message)));
    }
    agent_registry.unmark_starting(session_id);
    Ok(())
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn mark_switched_session_running(
    service: &AgentSessionService<'_>,
    session: &AgentSessionRecord,
    provider_session_id: &str,
    log_path: &str,
) -> Result<(), CommandError> {
    let resumed_at = current_epoch_millis()?;
    let transaction = service
        .issue_repository
        .connection()
        .unchecked_transaction()
        .map_err(agent_session_database_error)?;
    let updated =
        AgentSessionRepository::mark_running_in_transaction(&transaction, session.id, resumed_at)
            .map_err(agent_session_database_error)?;
    if updated.is_none() {
        transaction.commit().map_err(agent_session_database_error)?;
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Failed to mark the session running after switching display mode.",
        )
        .with_reason("displayModeSwitchRestoreFailed")
        .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id)));
    }
    let payload = json!({
        "sessionId": session.id,
        "issueId": session.issue_id,
        "status": "running",
        "displayModeSwitched": true,
        "providerSessionId": provider_session_id,
        "logPath": log_path,
    })
    .to_string();
    EventRepository::insert_session_event_in_transaction(
        &transaction,
        session.id,
        SessionEventType::SessionStarted,
        &payload,
        resumed_at,
    )
    .map_err(agent_session_database_error)?;
    transaction.commit().map_err(agent_session_database_error)?;
    Ok(())
}
