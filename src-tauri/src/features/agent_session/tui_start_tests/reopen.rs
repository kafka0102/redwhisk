//! 已完成 Issue 显式重开的 TUI 续接：同一对话、归档灌入、worktree 重建。

use std::fs;
use std::process::Command;

use super::resume::seed_stopped_tui_session;
use super::*;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::types::agent_session::{AgentSessionStatus, ResumeAgentSessionInput, WorkspaceMode};
use crate::types::errors::CommandErrorCode;
use rusqlite::params;

fn point_session_at_worktree(connection: &Connection, session_id: i64, worktree_dir: &str) {
    connection
        .execute(
            "UPDATE agent_sessions
             SET workspace_mode = 'worktree',
                 worktree_owner = 'redwhisk',
                 workspace_branch = 'issue-1',
                 workspace_path = ?1,
                 working_dir = ?1
             WHERE id = ?2",
            params![worktree_dir, session_id],
        )
        .expect("point session at worktree");
}

fn issue_status(connection: &Connection) -> String {
    connection
        .query_row("SELECT status FROM issues WHERE id = 11", [], |row| {
            row.get(0)
        })
        .expect("issue status")
}

#[test]
fn reopen_completed_tui_session_resumes_same_conversation_and_marks_issue_running() {
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
        Some("thread-reopen"),
        "closed",
        "completed",
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
                reopen_completed: true,
                workspace_branch: None,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect("explicit reopen resumes the same conversation");

    assert_eq!(result.session_id, session_id);
    assert_eq!(result.thread_id, "thread-reopen");
    assert!(pty.contains(session_id));
    assert_eq!(issue_status(&database.connection), "running");

    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find")
        .expect("session");
    assert_eq!(record.status, AgentSessionStatus::Running);
    assert_eq!(record.provider_session_id.as_deref(), Some("thread-reopen"));

    let _ = pty.kill(session_id);
}

#[test]
fn reopen_completed_tui_session_prefixes_runtime_log_with_archive_and_keeps_archive() {
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
        Some("thread-archive"),
        "closed",
        "completed",
    );
    let archive_path =
        crate::features::agent_session::build_issue_archive_log_path(temp_dir.path(), 1, 1, 1)
            .expect("archive path");
    let archive_body = "prior conclusion\n";
    fs::write(&archive_path, archive_body).expect("write archive");
    database
        .connection
        .execute(
            "UPDATE agent_sessions SET log_path = ?1 WHERE id = ?2",
            params![archive_path, session_id],
        )
        .expect("point session at archive");

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    service
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id: 1,
                session_id,
                reopen_completed: true,
                workspace_branch: None,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect("reopen seeds runtime log from archive");

    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find")
        .expect("session");
    assert_ne!(record.log_path, archive_path);
    let runtime = fs::read_to_string(&record.log_path).expect("runtime log");
    assert!(
        runtime.starts_with(archive_body),
        "runtime log should start with the archived text, got {runtime:?}"
    );
    assert_eq!(
        fs::read_to_string(&archive_path).expect("archive remains"),
        archive_body
    );

    let _ = pty.kill(session_id);
}

#[test]
fn reopen_completed_tui_keeps_issue_completed_when_resume_spawn_fails() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let database = open_db(temp_dir.path());
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        "/no/such/redwhisk-resume-binary",
        Some("thread-fail"),
        "closed",
        "completed",
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
                reopen_completed: true,
                workspace_branch: None,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect_err("failed spawn must not reopen");

    assert_eq!(error.code, CommandErrorCode::AgentSessionStartFailed);
    assert_eq!(issue_status(&database.connection), "completed");
    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find")
        .expect("session");
    assert_ne!(record.status, AgentSessionStatus::Running);
}

#[test]
fn reopen_completed_tui_rejects_agent_without_tui_resume_and_keeps_completed() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let database = open_db(temp_dir.path());
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        "dsh",
        Some("thread-deepseek"),
        "closed",
        "completed",
    );
    database
        .connection
        .execute(
            "UPDATE agent_profiles SET agent_type = 'deepseek', command = 'dsh', name = 'DeepSeek' WHERE id = 101",
            [],
        )
        .expect("switch profile to deepseek");

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
                reopen_completed: true,
                workspace_branch: None,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect_err("deepseek tui resume is unsupported");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(error.reason.as_deref(), Some("tuiResumeNotSupported"));
    assert_eq!(issue_status(&database.connection), "completed");
    assert!(!pty.contains(session_id));
}

#[test]
fn reopen_completed_tui_rejects_missing_provider_session_id_and_keeps_completed() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let database = open_db(temp_dir.path());
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        "codex",
        None,
        "closed",
        "completed",
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
                reopen_completed: true,
                workspace_branch: None,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect_err("missing provider session id");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(error.reason.as_deref(), Some("missingResumeSessionId"));
    assert_eq!(issue_status(&database.connection), "completed");
}

#[test]
fn reopen_completed_tui_resumes_in_existing_worktree_directory() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let worktree_dir = repo_dir.join(".worktrees").join("issue-1");
    run_git(&repo_dir, &["branch", "issue-1"]);
    run_git(
        &repo_dir,
        &[
            "worktree",
            "add",
            &worktree_dir.to_string_lossy(),
            "issue-1",
        ],
    );
    let script = temp_dir.path().join("fake-tui.sh");
    write_sleep_script(&script);
    let marker = temp_dir.path().join("cwd.txt");
    fs::write(
        &script,
        format!("#!/bin/sh\npwd > {}\nsleep 30\n", marker.to_string_lossy()),
    )
    .expect("rewrite script");

    let database = open_db(temp_dir.path());
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        Some("thread-worktree"),
        "closed",
        "completed",
    );
    point_session_at_worktree(
        &database.connection,
        session_id,
        &worktree_dir.to_string_lossy(),
    );

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    service
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id: 1,
                session_id,
                reopen_completed: true,
                workspace_branch: None,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect("resume in existing worktree");

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    while !marker.exists() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    let cwd = fs::read_to_string(&marker).expect("cwd marker");
    let actual = std::fs::canonicalize(cwd.trim()).expect("canonicalize resumed cwd");
    let expected = std::fs::canonicalize(&worktree_dir).expect("canonicalize worktree");
    assert_eq!(actual, expected);

    let _ = pty.kill(session_id);
}

#[test]
fn reopen_completed_tui_rebuilds_missing_worktree_from_given_existing_branch() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let worktree_dir = repo_dir.join(".worktrees").join("issue-1");
    run_git(&repo_dir, &["branch", "kept-branch"]);
    let script = temp_dir.path().join("fake-tui.sh");
    write_sleep_script(&script);

    let database = open_db(temp_dir.path());
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        Some("thread-rebuild"),
        "closed",
        "completed",
    );
    point_session_at_worktree(
        &database.connection,
        session_id,
        &worktree_dir.to_string_lossy(),
    );

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    service
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id: 1,
                session_id,
                reopen_completed: true,
                workspace_branch: Some("kept-branch".to_string()),
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect("rebuild missing worktree from existing branch");

    assert!(
        worktree_dir.is_dir(),
        "worktree directory must be recreated"
    );
    let head = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&worktree_dir)
        .output()
        .expect("rev-parse");
    assert_eq!(String::from_utf8_lossy(&head.stdout).trim(), "kept-branch");
    let branches = Command::new("git")
        .args(["branch", "--list", "issue-1"])
        .current_dir(&repo_dir)
        .output()
        .expect("branch list");
    assert!(
        String::from_utf8_lossy(&branches.stdout).trim().is_empty(),
        "must not create a same-named branch"
    );

    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find")
        .expect("session");
    assert_eq!(record.workspace_branch.as_deref(), Some("kept-branch"));
    assert_eq!(record.workspace_mode, WorkspaceMode::Worktree);

    let _ = pty.kill(session_id);
}

#[test]
fn reopen_completed_tui_rejects_missing_worktree_when_given_branch_does_not_exist() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let worktree_dir = repo_dir.join(".worktrees").join("issue-1");
    let script = temp_dir.path().join("fake-tui.sh");
    write_sleep_script(&script);

    let database = open_db(temp_dir.path());
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        Some("thread-missing-branch"),
        "closed",
        "completed",
    );
    point_session_at_worktree(
        &database.connection,
        session_id,
        &worktree_dir.to_string_lossy(),
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
                reopen_completed: true,
                workspace_branch: Some("gone-branch".to_string()),
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect_err("missing branch must not create a same-named branch");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(error.reason.as_deref(), Some("workspaceBranchMissing"));
    assert!(!worktree_dir.exists());
    let branches = Command::new("git")
        .args(["branch", "--list", "gone-branch"])
        .current_dir(&repo_dir)
        .output()
        .expect("branch list");
    assert!(String::from_utf8_lossy(&branches.stdout).trim().is_empty());
    assert_eq!(issue_status(&database.connection), "completed");
}
