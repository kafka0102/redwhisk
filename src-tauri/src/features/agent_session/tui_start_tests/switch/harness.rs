//! 展示形式切换：替换快照、用同一 Provider 会话标识按新模式拉起、切到 json 回填轮次。

pub(super) use std::fs;
pub(super) use std::sync::atomic::{AtomicUsize, Ordering};
pub(super) use std::sync::Arc;

use rusqlite::{params, Connection};
pub(super) use tempfile::tempdir;

pub(super) use super::super::{create_git_repo, open_db, service, write_sleep_script};
pub(super) use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::provider_factory::{
    AgentSessionProviderFactory, AgentSessionStartRequest, StartedSession, ThreadIdBackfill,
};
pub(super) use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
pub(super) use crate::agent::session_registry::AgentSessionRegistry;
pub(super) use crate::db::agent_session_repository::AgentSessionRepository;
pub(super) use crate::features::agent_session::display_mode_switch::NativeSessionHomes;
use crate::features::agent_session::timeline::read_timeline_from_log_path;
use crate::types::agent_session::{AgentMessageAttachment, AgentPermissionDecision};
pub(super) use crate::types::agent_session::{
    AgentSessionStatus, ResumeAgentSessionInput, SwitchAgentSessionDisplayModeInput,
};
use crate::types::agent_session_stream::{AgentMode, AgentModel, AgentTimelineItem};
pub(super) use crate::types::errors::CommandErrorCode;

pub(super) struct RecordingFactory {
    pub(super) resume_thread_ids: std::sync::Mutex<Vec<Option<String>>>,
    pub(super) sends: Arc<AtomicUsize>,
    pub(super) fail_start: bool,
}

impl Default for RecordingFactory {
    fn default() -> Self {
        Self {
            resume_thread_ids: std::sync::Mutex::new(Vec::new()),
            sends: Arc::new(AtomicUsize::new(0)),
            fail_start: false,
        }
    }
}

impl AgentSessionProviderFactory for RecordingFactory {
    fn start(
        &self,
        request: AgentSessionStartRequest,
    ) -> Result<StartedSession, AgentSessionError> {
        self.resume_thread_ids
            .lock()
            .expect("lock")
            .push(request.resume_thread_id.clone());
        if self.fail_start {
            return Err(AgentSessionError::Protocol(
                "thread already has an active writer".to_string(),
            ));
        }
        Ok(StartedSession {
            handle: Arc::new(IdleHandle {
                thread_id: request.resume_thread_id.clone().unwrap_or_default(),
                sends: Arc::clone(&self.sends),
            }),
            thread_id: request.resume_thread_id,
            backfill: ThreadIdBackfill::WhenPresent,
        })
    }
}

pub(super) struct IdleHandle {
    thread_id: String,
    sends: Arc<AtomicUsize>,
}

impl AgentSessionHandle for IdleHandle {
    fn send_message(
        &self,
        _text: String,
        _attachments: Vec<AgentMessageAttachment>,
    ) -> Result<(), AgentSessionError> {
        self.sends.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn cancel_turn(&self) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn respond_permission(
        &self,
        _request_id: &str,
        _decision: AgentPermissionDecision,
    ) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn set_model(&self, _model_id: String) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn set_effort(&self, _effort: Option<String>) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn set_mode(&self, _mode_id: &str) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn list_models(&self) -> Result<Vec<AgentModel>, AgentSessionError> {
        Ok(Vec::new())
    }

    fn list_modes(&self) -> Vec<AgentMode> {
        Vec::new()
    }

    fn read_timeline(&self) -> Result<Vec<AgentTimelineItem>, AgentSessionError> {
        Ok(Vec::new())
    }

    fn shutdown(&self) {}

    fn thread_id(&self) -> Option<String> {
        Some(self.thread_id.clone())
    }
}

pub(super) fn seed_switch_session(
    connection: &Connection,
    repo_path: &str,
    command_snapshot: &str,
    provider_session_id: Option<&str>,
    session_status: &str,
    issue_status: &str,
    agent_type: &str,
    display_mode: &str,
    profile_display_mode: &str,
) -> i64 {
    connection
        .execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (1, 'Demo', ?1, 1, 1)",
            params![repo_path],
        )
        .expect("project");
    connection
        .execute(
            "INSERT INTO agent_profiles (
               id, name, agent_type, command, scope, project_id, mode, dangerous,
               default_skill, prompt_template, del, display_mode, enabled
             ) VALUES (
               101, 'Agent', ?1, ?2, 'project', 1, 'full-access', 1,
               '', '', 0, ?3, 1
             )",
            params![agent_type, command_snapshot, profile_display_mode],
        )
        .expect("profile");
    connection
        .execute(
            "INSERT INTO issues (
               id, project_id, number, title, description, status, created_at, updated_at, del
             ) VALUES (11, 1, 1, 'Issue', 'd', ?1, 1, 1, 0)",
            params![issue_status],
        )
        .expect("issue");
    let log_path = if display_mode == "json" {
        format!("{repo_path}/session.jsonl")
    } else {
        format!("{repo_path}/session-tui.log")
    };
    connection
        .execute(
            "INSERT INTO agent_sessions (
               id, project_id, number, issue_id, title, agent_profile_id, provider_session_id,
               status, attention, working_dir, command_snapshot, prompt_snapshot, log_path,
               last_active_at, started_at, display_mode, del
             ) VALUES (
               40, 1, 1, 11, NULL, 101, ?1,
               ?2, 'none', ?3, ?4, '', ?5,
               1, 1, ?6, 0
             )",
            params![
                provider_session_id,
                session_status,
                repo_path,
                command_snapshot,
                log_path,
                display_mode
            ],
        )
        .expect("session");
    40
}

pub(super) fn write_codex_rollout(codex_home: &std::path::Path, provider_session_id: &str) {
    let dir = codex_home.join("sessions/2026/10/16");
    fs::create_dir_all(&dir).expect("sessions dir");
    let path = dir.join(format!(
        "rollout-2026-10-16T00-00-00-{provider_session_id}.jsonl"
    ));
    let lines = [
        format!(
            r#"{{"type":"session_meta","payload":{{"id":"{provider_session_id}","cwd":"/tmp"}}}}"#
        ),
        r#"{"type":"event_msg","payload":{"type":"item_completed","turn_id":"t1","item":{"type":"UserMessage","content":[{"type":"text","text":"fix the login"}]}}}"#.to_string(),
        r#"{"type":"event_msg","payload":{"type":"item_completed","turn_id":"t1","item":{"type":"FunctionCall","content":[{"type":"text","text":"SECRET_TOOL"}]}}}"#.to_string(),
        r#"{"type":"event_msg","payload":{"type":"item_completed","turn_id":"t1","item":{"type":"AgentMessage","content":[{"type":"text","text":"login is fixed"}]}}}"#.to_string(),
        r#"{"type":"event_msg","payload":{"type":"item_completed","turn_id":"t2","item":{"type":"UserMessage","content":[{"type":"text","text":"add a test"}]}}}"#.to_string(),
        r#"{"type":"event_msg","payload":{"type":"item_completed","turn_id":"t2","item":{"type":"AgentMessage","content":[{"type":"text","text":"test added"}]}}}"#.to_string(),
    ];
    fs::write(path, lines.join("\n")).expect("rollout");
}

pub(super) fn profile_display_mode(connection: &Connection) -> String {
    connection
        .query_row(
            "SELECT display_mode FROM agent_profiles WHERE id = 101",
            [],
            |row| row.get(0),
        )
        .expect("profile mode")
}

pub(super) fn timeline_texts(log_path: &str) -> Vec<String> {
    read_timeline_from_log_path(log_path)
        .expect("timeline")
        .items
        .into_iter()
        .map(|entry| match entry.item {
            AgentTimelineItem::UserMessage { text, .. } => text,
            AgentTimelineItem::AssistantMessage { text, .. } => text.as_str().to_string(),
            other => panic!("unexpected timeline item: {other:?}"),
        })
        .collect()
}
