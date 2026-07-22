use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;

use rusqlite::{params, Connection};
use tempfile::tempdir;

use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_registry::AgentSessionRegistry;
use crate::db::agent_profile_repository::AgentProfileRepository;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::features::agent_session::service::AgentSessionService;
use crate::types::agent_session::{StartAgentSessionInput, WorkspaceMode};
use crate::types::agent_session_terminal::WriteAgentSessionTerminalInput;
use crate::types::agent_session::AgentSessionStatus;

pub(super) fn create_git_repo(repo_dir: &Path) {
    fs::create_dir_all(repo_dir).expect("create repo dir");
    run_git(repo_dir, &["init"]);
    run_git(repo_dir, &["config", "user.email", "redwhisk@example.test"]);
    run_git(repo_dir, &["config", "user.name", "RedWhisk Test"]);
    run_git(repo_dir, &["checkout", "-b", "main"]);
    fs::write(repo_dir.join("base.txt"), "base\n").expect("write base");
    run_git(repo_dir, &["add", "base.txt"]);
    run_git(repo_dir, &["commit", "-m", "initial"]);
}

pub(super) fn run_git(repo_dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_dir)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

pub(super) fn write_sleep_script(path: &Path) {
    fs::write(
        path,
        "#!/bin/sh\n# keep PTY alive for test\nsleep 30\n",
    )
    .expect("write script");
    let mut perms = fs::metadata(path).expect("meta").permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms).expect("chmod");
}

pub(super) fn open_db(data_dir: &Path) -> crate::db::connection::Database {
    let database = DatabaseConfig::new(data_dir).open().expect("open db");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrate");
    database
}

pub(super) fn seed_project_issue_profile(
    connection: &Connection,
    repo_path: &str,
    command: &str,
    display_mode: &str,
) {
    connection
        .execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (1, 'Demo', ?1, 1, 1)",
            params![repo_path],
        )
        .expect("insert project");
    connection
        .execute(
            "INSERT INTO agent_profiles (
               id, name, agent_type, command, scope, project_id, mode, dangerous,
               default_skill, prompt_template, del, display_mode, enabled
             ) VALUES (
               101, 'Codex TUI', 'codex', ?1, 'project', 1, 'full-access', 1,
               '', '', 0, ?2, 1
             )",
            params![command, display_mode],
        )
        .expect("insert profile");
    connection
        .execute(
            "INSERT INTO issues (
               id, project_id, number, title, description, status, created_at, updated_at, del
             ) VALUES (11, 1, 1, 'Issue One', 'desc', 'backlog', 1, 1, 0)",
            [],
        )
        .expect("insert issue");
}

pub(super) fn service<'a>(connection: &'a Connection) -> AgentSessionService<'a> {
    AgentSessionService::new(
        IssueRepository::new(connection),
        ProjectRepository::new(connection),
        AgentProfileRepository::new(connection),
        AgentSessionRepository::new(connection),
    )
}

mod issue;
