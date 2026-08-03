//! TUI resume_agent_session 行为：门禁、幂等、PTY 续接与 command_snapshot 不变。

use super::*;
use crate::types::agent_session::{AgentSessionStatus, ResumeAgentSessionInput};
use crate::types::errors::CommandErrorCode;
use rusqlite::params;

fn seed_stopped_tui_session(
    connection: &Connection,
    repo_path: &str,
    command_snapshot: &str,
    provider_session_id: Option<&str>,
    session_status: &str,
    issue_status: &str,
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
               101, 'Codex TUI', 'codex', 'codex', 'project', 1, 'full-access', 1,
               '', '', 0, 'tui', 1
             )",
            [],
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
    let log_path = format!("{repo_path}/session-tui.log");
    connection
        .execute(
            "INSERT INTO agent_sessions (
               id, project_id, number, issue_id, title, agent_profile_id, provider_session_id,
               status, attention, working_dir, command_snapshot, prompt_snapshot, log_path,
               last_active_at, started_at, display_mode, del
             ) VALUES (
               40, 1, 1, 11, NULL, 101, ?1,
               ?2, 'none', ?3, ?4, '', ?5,
               1, 1, 'tui', 0
             )",
            params![
                provider_session_id,
                session_status,
                repo_path,
                command_snapshot,
                log_path
            ],
        )
        .expect("session");
    40
}

#[test]
fn resume_tui_rejects_missing_provider_session_id() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let database = open_db(temp_dir.path());
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        "codex --dangerously-bypass-approvals-and-sandbox",
        None,
        "stopped",
        "running",
    );

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    let error = service
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id: 1,
                session_id,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect_err("missing provider session id");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(error.reason.as_deref(), Some("missingResumeSessionId"));
    assert!(!pty.contains(session_id));
}

#[test]
fn resume_tui_rejects_closed_session() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let database = open_db(temp_dir.path());
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        "codex",
        Some("thread-closed"),
        "closed",
        "running",
    );

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    let error = service
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id: 1,
                session_id,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect_err("closed session cannot resume");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(error.reason.as_deref(), Some("closedSessionCannotResume"));
    assert!(!pty.contains(session_id));
}

#[test]
fn resume_tui_rejects_workspace_missing_with_stable_reason() {
    let temp_dir = tempdir().expect("temp");
    let missing_workspace = temp_dir.path().join("gone-workspace");
    let database = open_db(temp_dir.path());
    // project repo also missing so restore/fallback cannot recover.
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &missing_workspace.to_string_lossy(),
        "codex",
        Some("thread-ws"),
        "stopped",
        "running",
    );

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    let error = service
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id: 1,
                session_id,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect_err("missing workspace");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(error.reason.as_deref(), Some("workspaceMissingForResume"));
    assert!(!pty.contains(session_id));
}

#[test]
fn resume_tui_spawns_pty_marks_running_keeps_command_snapshot() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let script = temp_dir.path().join("fake-tui.sh");
    write_sleep_script(&script);

    let database = open_db(temp_dir.path());
    let command_snapshot = script.to_string_lossy().to_string();
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &command_snapshot,
        Some("thread-resume-1"),
        "stopped",
        "running",
    );
    let log_path: String = database
        .connection
        .query_row(
            "SELECT log_path FROM agent_sessions WHERE id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .expect("log path");
    fs::write(&log_path, "prior output\n").expect("seed log");

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    let result = service
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id: 1,
                session_id,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect("tui resume");

    assert_eq!(result.session_id, session_id);
    assert_eq!(result.thread_id, "thread-resume-1");
    assert!(pty.contains(session_id), "must register PTY");

    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find")
        .expect("session");
    assert_eq!(record.status, AgentSessionStatus::Running);
    assert_eq!(record.command_snapshot, command_snapshot);
    assert_eq!(record.display_mode, "tui");
    assert_eq!(record.provider_session_id.as_deref(), Some("thread-resume-1"));
    assert_eq!(record.log_path, log_path);

    let _ = pty.kill(session_id);
}

#[test]
fn resume_tui_short_circuits_when_pty_already_active() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let script = temp_dir.path().join("fake-tui.sh");
    write_sleep_script(&script);

    let database = open_db(temp_dir.path());
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        Some("thread-live"),
        "running",
        "review",
    );

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    // 先真正拉起一次，模拟 PTY 仍在。
    service
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id: 1,
                session_id,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect("first resume");
    assert!(pty.contains(session_id));

    let result = service
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id: 1,
                session_id,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect("second resume short-circuits");
    assert_eq!(result.session_id, session_id);
    assert_eq!(result.thread_id, "thread-live");

    let _ = pty.kill(session_id);
}

#[test]
fn resume_tui_short_circuits_when_mark_starting() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let database = open_db(temp_dir.path());
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        "codex",
        Some("thread-starting"),
        "stopped",
        "running",
    );

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();
    registry.mark_starting(session_id);

    let result = service
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id: 1,
                session_id,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect("starting short-circuit");
    assert_eq!(result.session_id, session_id);
    assert_eq!(result.thread_id, "thread-starting");
    assert!(!pty.contains(session_id), "must not spawn while starting");
}

#[test]
fn resume_tui_allows_running_session_without_pty() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let script = temp_dir.path().join("fake-tui.sh");
    write_sleep_script(&script);

    let database = open_db(temp_dir.path());
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        Some("thread-running-no-pty"),
        "running",
        "running",
    );

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    let result = service
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id: 1,
                session_id,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect("running without pty can resume");
    assert_eq!(result.thread_id, "thread-running-no-pty");
    assert!(pty.contains(session_id));

    let _ = pty.kill(session_id);
}
