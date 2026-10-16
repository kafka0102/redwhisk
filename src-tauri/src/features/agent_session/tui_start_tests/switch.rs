//! 展示形式切换：替换快照、用同一 Provider 会话标识按新模式拉起、切到 json 回填轮次。

use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use rusqlite::{params, Connection};
use tempfile::tempdir;

use super::{create_git_repo, open_db, service, write_sleep_script};
use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::provider_factory::{
    AgentSessionProviderFactory, AgentSessionStartRequest, StartedSession, ThreadIdBackfill,
};
use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::agent::session_registry::AgentSessionRegistry;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::features::agent_session::display_mode_switch::NativeSessionHomes;
use crate::features::agent_session::timeline::read_timeline_from_log_path;
use crate::types::agent_session::{
    AgentMessageAttachment, AgentPermissionDecision, AgentSessionStatus,
    ResumeAgentSessionInput, SwitchAgentSessionDisplayModeInput,
};
use crate::types::agent_session_stream::{AgentMode, AgentModel, AgentTimelineItem};
use crate::types::errors::CommandErrorCode;

struct RecordingFactory {
    resume_thread_ids: std::sync::Mutex<Vec<Option<String>>>,
    sends: Arc<AtomicUsize>,
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
        Ok(StartedSession {
            handle: Arc::new(IdleHandle {
                thread_id: request.resume_thread_id.unwrap_or_default(),
                sends: Arc::clone(&self.sends),
            }),
            thread_id: request.resume_thread_id,
            backfill: ThreadIdBackfill::WhenPresent,
        })
    }
}

struct IdleHandle {
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

fn seed_switch_session(
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

fn write_codex_rollout(codex_home: &std::path::Path, provider_session_id: &str) {
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

fn profile_display_mode(connection: &Connection) -> String {
    connection
        .query_row(
            "SELECT display_mode FROM agent_profiles WHERE id = 101",
            [],
            |row| row.get(0),
        )
        .expect("profile mode")
}

fn timeline_texts(log_path: &str) -> Vec<String> {
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

#[test]
fn switch_from_live_tui_replaces_snapshot_relaunches_same_provider_session_and_backfills_json() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let script = temp_dir.path().join("fake-tui.sh");
    write_sleep_script(&script);
    let codex_home = temp_dir.path().join("codex-home");
    let provider_session_id = "thread-switch-1";
    write_codex_rollout(&codex_home, provider_session_id);

    let database = open_db(temp_dir.path());
    let session_id = seed_switch_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        Some(provider_session_id),
        "stopped",
        "running",
        "codex",
        "tui",
        "tui",
    );
    let agent = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();
    agent
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id: 1,
                session_id,
                reopen_completed: false,
                workspace_branch: None,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect("live tui");
    assert!(pty.contains(session_id));

    let factory = RecordingFactory {
        resume_thread_ids: std::sync::Mutex::new(Vec::new()),
        sends: Arc::new(AtomicUsize::new(0)),
    };
    let result = agent
        .switch_agent_session_display_mode(
            temp_dir.path(),
            SwitchAgentSessionDisplayModeInput {
                project_id: 1,
                session_id,
            },
            &registry,
            &broadcaster,
            &pty,
            &factory,
            NativeSessionHomes {
                codex_home: Some(&codex_home),
                user_home: None,
            },
        )
        .expect("switch to json");

    assert_eq!(result.session_id, session_id);
    assert_eq!(result.display_mode, "json");
    assert_eq!(result.provider_session_id, provider_session_id);
    assert_eq!(
        factory.resume_thread_ids.lock().expect("lock").as_slice(),
        &[Some(provider_session_id.to_string())]
    );
    assert_eq!(factory.sends.load(Ordering::SeqCst), 0);
    assert!(!pty.contains(session_id));

    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find")
        .expect("session");
    assert_eq!(record.display_mode, "json");
    assert_eq!(
        record.provider_session_id.as_deref(),
        Some(provider_session_id)
    );
    assert_eq!(record.status, AgentSessionStatus::Running);
    assert_eq!(profile_display_mode(&database.connection), "tui");
    let texts = timeline_texts(&record.log_path);
    assert_eq!(
        texts,
        vec![
            "fix the login".to_string(),
            "login is fixed".to_string(),
            "add a test".to_string(),
            "test added".to_string(),
        ]
    );
    assert!(texts.iter().all(|text| !text.contains("SECRET_TOOL")));
}

#[test]
fn switch_from_stopped_json_relaunches_tui_with_same_provider_session_without_changing_profile() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let script = temp_dir.path().join("fake-tui.sh");
    fs::write(
        &script,
        "#!/bin/sh\nprintf '%s\\n' \"$*\" > \"$PWD/argv.txt\"\nsleep 30\n",
    )
    .expect("script");
    let mut perms = fs::metadata(&script).expect("meta").permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut perms, 0o755);
    fs::set_permissions(&script, perms).expect("chmod");

    let database = open_db(temp_dir.path());
    let provider_session_id = "thread-switch-2";
    let session_id = seed_switch_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        Some(provider_session_id),
        "stopped",
        "review",
        "codex",
        "json",
        "json",
    );
    let agent = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();
    let factory = RecordingFactory {
        resume_thread_ids: std::sync::Mutex::new(Vec::new()),
        sends: Arc::new(AtomicUsize::new(0)),
    };

    let result = agent
        .switch_agent_session_display_mode(
            temp_dir.path(),
            SwitchAgentSessionDisplayModeInput {
                project_id: 1,
                session_id,
            },
            &registry,
            &broadcaster,
            &pty,
            &factory,
            NativeSessionHomes {
                codex_home: None,
                user_home: None,
            },
        )
        .expect("switch to tui");

    assert_eq!(result.display_mode, "tui");
    assert_eq!(result.provider_session_id, provider_session_id);
    assert!(pty.contains(session_id));
    assert!(factory.resume_thread_ids.lock().expect("lock").is_empty());
    assert_eq!(factory.sends.load(Ordering::SeqCst), 0);
    let argv = fs::read_to_string(repo_dir.join("argv.txt")).expect("argv");
    assert!(argv.contains("resume"), "{argv}");
    assert!(argv.contains(provider_session_id), "{argv}");
    assert_eq!(profile_display_mode(&database.connection), "json");
    let _ = pty.kill(session_id);
}

#[test]
fn switch_to_json_succeeds_when_native_session_log_is_missing() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let script = temp_dir.path().join("fake-tui.sh");
    write_sleep_script(&script);
    let database = open_db(temp_dir.path());
    let session_id = seed_switch_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        Some("missing-thread"),
        "stopped",
        "running",
        "codex",
        "tui",
        "json",
    );
    let agent = service(&database.connection);
    let factory = RecordingFactory {
        resume_thread_ids: std::sync::Mutex::new(Vec::new()),
        sends: Arc::new(AtomicUsize::new(0)),
    };
    let result = agent
        .switch_agent_session_display_mode(
            temp_dir.path(),
            SwitchAgentSessionDisplayModeInput {
                project_id: 1,
                session_id,
            },
            &AgentSessionRegistry::new(),
            &AgentEventBroadcaster::new(),
            &PtySessionManager::new(),
            &factory,
            NativeSessionHomes {
                codex_home: Some(temp_dir.path()),
                user_home: None,
            },
        )
        .expect("switch still succeeds");
    assert_eq!(result.display_mode, "json");
    assert_eq!(result.provider_session_id, "missing-thread");
    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find")
        .expect("session");
    assert!(timeline_texts(&record.log_path).is_empty());
}

#[test]
fn switch_rejects_deepseek_and_completed_issue_without_changing_snapshot() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let database = open_db(temp_dir.path());
    let session_id = seed_switch_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        "dsh",
        Some("deepseek-session"),
        "stopped",
        "running",
        "deepseek",
        "json",
        "json",
    );
    let agent = service(&database.connection);
    let factory = RecordingFactory {
        resume_thread_ids: std::sync::Mutex::new(Vec::new()),
        sends: Arc::new(AtomicUsize::new(0)),
    };
    let error = agent
        .switch_agent_session_display_mode(
            temp_dir.path(),
            SwitchAgentSessionDisplayModeInput {
                project_id: 1,
                session_id,
            },
            &AgentSessionRegistry::new(),
            &AgentEventBroadcaster::new(),
            &PtySessionManager::new(),
            &factory,
            NativeSessionHomes {
                codex_home: None,
                user_home: None,
            },
        )
        .expect_err("deepseek cannot switch");
    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(
        AgentSessionRepository::new(&database.connection)
            .find_by_id(session_id)
            .expect("find")
            .expect("session")
            .display_mode,
        "json"
    );
    assert!(factory.resume_thread_ids.lock().expect("lock").is_empty());

    database
        .connection
        .execute(
            "UPDATE issues SET status = 'completed' WHERE id = 11",
            [],
        )
        .expect("complete");
    database
        .connection
        .execute(
            "UPDATE agent_profiles SET agent_type = 'codex' WHERE id = 101",
            [],
        )
        .expect("codex");
    let error = agent
        .switch_agent_session_display_mode(
            temp_dir.path(),
            SwitchAgentSessionDisplayModeInput {
                project_id: 1,
                session_id,
            },
            &AgentSessionRegistry::new(),
            &AgentEventBroadcaster::new(),
            &PtySessionManager::new(),
            &factory,
            NativeSessionHomes {
                codex_home: None,
                user_home: None,
            },
        )
        .expect_err("completed issue");
    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(
        AgentSessionRepository::new(&database.connection)
            .find_by_id(session_id)
            .expect("find")
            .expect("session")
            .display_mode,
        "json"
    );
}
