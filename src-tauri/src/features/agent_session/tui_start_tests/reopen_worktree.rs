//! 已完成 Issue 重开时的 worktree：目录还在则沿用，目录已删则按基线最新提交重建。

use std::fs;
use std::process::Command;

use super::reopen::{issue_status, point_session_at_worktree};
use super::resume::seed_stopped_tui_session;
use super::*;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::types::agent_session::{ResumeAgentSessionInput, WorkspaceMode};
use crate::types::errors::CommandErrorCode;

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
    let mut cwd = String::new();
    while std::time::Instant::now() < deadline {
        if let Ok(body) = fs::read_to_string(&marker) {
            if !body.trim().is_empty() {
                cwd = body;
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    assert!(!cwd.trim().is_empty(), "cwd marker");
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
    assert_eq!(String::from_utf8_lossy(&head.stdout).trim(), "issue-1");
    let kept = Command::new("git")
        .args(["rev-parse", "kept-branch"])
        .current_dir(&repo_dir)
        .output()
        .expect("kept-branch");
    let created = Command::new("git")
        .args(["rev-parse", "issue-1"])
        .current_dir(&worktree_dir)
        .output()
        .expect("issue branch");
    assert_eq!(
        String::from_utf8_lossy(&created.stdout).trim(),
        String::from_utf8_lossy(&kept.stdout).trim()
    );

    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find")
        .expect("session");
    assert_eq!(record.workspace_branch.as_deref(), Some("issue-1"));
    assert_eq!(record.target_branch.as_deref(), Some("kept-branch"));
    assert_eq!(record.workspace_mode, WorkspaceMode::Worktree);

    let _ = pty.kill(session_id);
}

#[test]
fn reopen_completed_tui_recreates_missing_worktree_from_latest_base_without_checking_out_master() {
    let temp_dir = tempdir().expect("temp");
    let origin_dir = temp_dir.path().join("origin.git");
    let repo_dir = temp_dir.path().join("repo");
    let remote_clone = temp_dir.path().join("remote-clone");
    create_git_repo(&repo_dir);
    run_git(&repo_dir, &["branch", "-M", "master"]);
    run_git(
        &repo_dir,
        &[
            "init",
            "--bare",
            "-b",
            "master",
            origin_dir.to_string_lossy().as_ref(),
        ],
    );
    run_git(
        &repo_dir,
        &[
            "remote",
            "add",
            "origin",
            origin_dir.to_string_lossy().as_ref(),
        ],
    );
    run_git(&repo_dir, &["push", "-u", "origin", "master"]);
    run_git(
        &repo_dir,
        &[
            "clone",
            origin_dir.to_string_lossy().as_ref(),
            remote_clone.to_string_lossy().as_ref(),
        ],
    );
    run_git(
        &remote_clone,
        &["config", "user.email", "redwhisk@example.test"],
    );
    run_git(&remote_clone, &["config", "user.name", "RedWhisk Test"]);
    fs::write(remote_clone.join("latest.txt"), "latest\n").expect("write latest");
    run_git(&remote_clone, &["add", "latest.txt"]);
    run_git(&remote_clone, &["commit", "-m", "latest"]);
    run_git(&remote_clone, &["push", "origin", "HEAD:master"]);
    let latest = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&remote_clone)
        .output()
        .expect("remote head");
    let latest = String::from_utf8_lossy(&latest.stdout).trim().to_string();
    let local_master = Command::new("git")
        .args(["rev-parse", "master"])
        .current_dir(&repo_dir)
        .output()
        .expect("local master");
    let local_master = String::from_utf8_lossy(&local_master.stdout)
        .trim()
        .to_string();
    assert_ne!(local_master, latest, "local master must stay behind origin");

    let worktree_dir = repo_dir.join(".worktrees").join("issue-1");
    let script = temp_dir.path().join("fake-tui.sh");
    write_sleep_script(&script);
    let database = open_db(temp_dir.path());
    let session_id = seed_stopped_tui_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        Some("thread-latest"),
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
                workspace_branch: Some("master".to_string()),
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect("recreate missing worktree from latest master");

    assert!(
        worktree_dir.is_dir(),
        "worktree directory must be recreated"
    );
    assert!(
        worktree_dir.join("latest.txt").is_file(),
        "new worktree must contain the fetched latest commit"
    );
    let worktree_head = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&worktree_dir)
        .output()
        .expect("worktree head");
    assert_eq!(
        String::from_utf8_lossy(&worktree_head.stdout).trim(),
        latest
    );
    let worktree_branch = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&worktree_dir)
        .output()
        .expect("worktree branch");
    assert_eq!(
        String::from_utf8_lossy(&worktree_branch.stdout).trim(),
        "issue-1"
    );
    let repo_branch = Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(&repo_dir)
        .output()
        .expect("repo branch");
    assert_eq!(
        String::from_utf8_lossy(&repo_branch.stdout).trim(),
        "master"
    );
    let repo_head = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repo_dir)
        .output()
        .expect("repo head");
    assert_eq!(
        String::from_utf8_lossy(&repo_head.stdout).trim(),
        local_master,
        "recreating the worktree must not move the already checked-out master"
    );
    assert!(
        !repo_dir.join("latest.txt").exists(),
        "latest commit stays out of the main checkout"
    );

    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find")
        .expect("session");
    assert_eq!(record.workspace_branch.as_deref(), Some("issue-1"));
    assert_eq!(record.target_branch.as_deref(), Some("master"));
    assert_eq!(issue_status(&database.connection), "running");

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
