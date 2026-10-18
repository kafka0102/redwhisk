//! Issue 未完成时切换 Session 展示形式快照（ADR-0053）。
//!
//! 终止当前进程，改这一条 Session 的快照，再用同一个 Provider 会话标识按新形式拉起。
//! 不改 Agent profile 的默认展示形式，也不自动发送「继续」。

use std::path::Path;

use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::descriptor_for;
use crate::agent::provider_factory::AgentSessionProviderFactory;
use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_registry::AgentSessionRegistry;
use crate::types::agent_session::{
    AgentSessionRecord, SwitchAgentSessionDisplayModeInput, SwitchAgentSessionDisplayModeResult,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{IssueRecord, IssueStatus};

use super::display_mode_switch_backfill::{completed_turns, write_backfill_jsonl};
use super::display_mode_switch_relaunch::{relaunch_structured, relaunch_tui};
use super::lifecycle::{parse_session_display_mode, SessionDisplayMode};
use super::log_path::build_issue_runtime_structured_log_path;
use super::service::{agent_session_database_error, AgentSessionService};

/// 本机会话记录根。测试传入临时目录；缺省时 Codex 用 `CODEX_HOME`，其余用用户 home。
#[derive(Clone, Copy, Default)]
pub struct NativeSessionHomes<'a> {
    pub codex_home: Option<&'a Path>,
    pub user_home: Option<&'a Path>,
}

impl<'connection> AgentSessionService<'connection> {
    pub fn switch_agent_session_display_mode(
        &self,
        data_dir: &Path,
        input: SwitchAgentSessionDisplayModeInput,
        agent_registry: &AgentSessionRegistry,
        broadcaster: &AgentEventBroadcaster,
        pty_sessions: &PtySessionManager,
        factory: &dyn AgentSessionProviderFactory,
        homes: NativeSessionHomes<'_>,
    ) -> Result<SwitchAgentSessionDisplayModeResult, CommandError> {
        let session = self.find_project_session(input.project_id, input.session_id)?;
        let issue = self.unfinished_issue(&session)?;
        let profile = self
            .agent_profile_repository
            .find_profile_by_id(session.agent_profile_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "Agent profile does not exist.",
                )
                .with_reason("profileNotFound")
                .with_detail(
                    ErrorDetail::new("AgentProfile")
                        .with_value("agentProfileId", session.agent_profile_id),
                )
            })?;
        let agent_type = profile.agent_type.clone();
        let current = parse_session_display_mode(&session.display_mode)?;
        let target = opposite_display_mode(current);
        let descriptor = descriptor_for(&agent_type);
        descriptor
            .accepted_display_mode(target.as_db_str())
            .map_err(|_| display_mode_switch_rejected(session.id, "displayModeNotSwitchable"))?;
        let provider_session_id = super::service::backfill_missing_grok_provider_session_id(
            self,
            data_dir,
            &session,
            &agent_type,
        )
        .ok_or_else(|| display_mode_switch_rejected(session.id, "missingResumeSessionId"))?;

        let log_path = if target == SessionDisplayMode::Json {
            let path = build_issue_runtime_structured_log_path(
                data_dir,
                session.project_id,
                issue.number,
                session.number,
            )?;
            write_backfill_jsonl(
                &path,
                &completed_turns(&session, &agent_type, homes, &provider_session_id),
                session.project_id,
                session.id,
            )?;
            path
        } else {
            session.log_path.clone()
        };

        // 先摘注册再杀进程。退出回调会把 Session 标成已结束，不能盖过随后的拉起。
        release_live_session(agent_registry, pty_sessions, session.id);
        self.persist_display_mode_snapshot(&session, target, &log_path)?;
        let mut relaunched = session.clone();
        relaunched.display_mode = target.as_db_str().to_string();
        relaunched.log_path = log_path;

        match target {
            SessionDisplayMode::Json => relaunch_structured(
                self,
                data_dir,
                &relaunched,
                &profile,
                &provider_session_id,
                agent_registry,
                broadcaster,
                factory,
            )?,
            SessionDisplayMode::Tui => relaunch_tui(
                self,
                data_dir,
                &relaunched,
                &agent_type,
                &provider_session_id,
                agent_registry,
                pty_sessions,
            )?,
        }

        Ok(SwitchAgentSessionDisplayModeResult {
            session_id: session.id,
            display_mode: target.as_db_str().to_string(),
            provider_session_id,
        })
    }

    fn unfinished_issue(&self, session: &AgentSessionRecord) -> Result<IssueRecord, CommandError> {
        let Some(issue_id) = session.issue_id else {
            return Err(display_mode_switch_rejected(
                session.id,
                "missingLinkedIssue",
            ));
        };
        let issue = self
            .issue_repository
            .find_by_id(issue_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::IssueNotFound, "Issue does not exist.")
                    .with_reason("issueNotFound")
                    .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue_id))
            })?;
        match issue.status {
            IssueStatus::Running | IssueStatus::Review => Ok(issue),
            IssueStatus::Completed | IssueStatus::Backlog => Err(display_mode_switch_rejected(
                session.id,
                "issueNotSwitchable",
            )),
        }
    }

    fn persist_display_mode_snapshot(
        &self,
        session: &AgentSessionRecord,
        target: SessionDisplayMode,
        log_path: &str,
    ) -> Result<(), CommandError> {
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(agent_session_database_error)?;
        let changed = transaction
            .execute(
                "UPDATE agent_sessions
                 SET display_mode = ?1, log_path = ?2
                 WHERE id = ?3 AND del = 0",
                rusqlite::params![target.as_db_str(), log_path, session.id],
            )
            .map_err(agent_session_database_error)?;
        if changed == 0 {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Failed to update the session display mode.",
            )
            .with_reason("displayModeUpdateFailed")
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id)));
        }
        transaction.commit().map_err(agent_session_database_error)?;
        Ok(())
    }
}

fn opposite_display_mode(current: SessionDisplayMode) -> SessionDisplayMode {
    match current {
        SessionDisplayMode::Json => SessionDisplayMode::Tui,
        SessionDisplayMode::Tui => SessionDisplayMode::Json,
    }
}

impl SessionDisplayMode {
    fn as_db_str(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Tui => "tui",
        }
    }
}

pub(super) fn display_mode_switch_rejected(session_id: i64, reason: &'static str) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionValidationFailed,
        "This session cannot switch display mode.",
    )
    .with_reason(reason)
    .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id))
}

fn release_live_session(
    agent_registry: &AgentSessionRegistry,
    pty_sessions: &PtySessionManager,
    session_id: i64,
) {
    if let Some(handle) = agent_registry.unregister(session_id) {
        handle.shutdown();
    }
    if pty_sessions.contains(session_id) {
        let _ = pty_sessions.kill(session_id);
        pty_sessions.forget(session_id);
    }
}
