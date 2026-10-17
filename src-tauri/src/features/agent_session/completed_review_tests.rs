//! 完成回看查看服务：已完成 Issue 拉起只读交互式 resume，不改业务状态与日志。

use std::fs;
use std::path::Path;

use rusqlite::params;

use crate::agent::pty_session_manager::PtySessionManager;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::issue_repository::IssueRepository;
use crate::features::agent_session::service::AgentSessionService;
use crate::types::agent_session::AgentSessionStatus;
use crate::types::agent_session_completed_review::OpenCompletedReviewInput;
use crate::types::errors::CommandErrorCode;
use crate::types::issue::IssueStatus;

use super::tui_start_tests::{create_git_repo, open_db, service, write_sleep_script};

const ARCHIVE_BODY: &str = "archived-session-body\n";
const RUNTIME_BODY: &str = "original-runtime-log\n";

struct CompletedReviewSeed {
    session_id: i64,
    archive_path: String,
    runtime_path: String,
}

fn seed_completed_review(
    connection: &rusqlite::Connection,
    repo_path: &str,
    agent_type: &str,
    command_snapshot: &str,
    display_mode: &str,
    provider_session_id: Option<&str>,
    workspace_path: &str,
    session_status: &str,
) -> CompletedReviewSeed {
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
               101, 'Review Agent', ?1, ?2, 'project', 1, 'full-access', 1,
               '', '', 0, ?3, 1
             )",
            params![agent_type, command_snapshot, display_mode],
        )
        .expect("profile");
    connection
        .execute(
            "INSERT INTO issues (
               id, project_id, number, title, description, status, created_at, updated_at, del
             ) VALUES (11, 1, 1, 'Done', 'd', 'completed', 1, 1, 0)",
            [],
        )
        .expect("issue");
    let archive_path = format!("{repo_path}/session-logs/archive/session.log");
    let runtime_path = format!("{repo_path}/session-logs/runtime/session.log");
    fs::create_dir_all(Path::new(&archive_path).parent().expect("archive parent"))
        .expect("archive dir");
    fs::create_dir_all(Path::new(&runtime_path).parent().expect("runtime parent"))
        .expect("runtime dir");
    fs::write(&archive_path, ARCHIVE_BODY).expect("archive body");
    fs::write(&runtime_path, RUNTIME_BODY).expect("runtime body");
    connection
        .execute(
            "INSERT INTO agent_sessions (
               id, project_id, number, issue_id, title, agent_profile_id, provider_session_id,
               status, attention, working_dir, workspace_path, command_snapshot, prompt_snapshot,
               log_path, runtime_log_path, last_active_at, started_at, display_mode, del
             ) VALUES (
               40, 1, 1, 11, NULL, 101, ?1,
               ?2, 'none', ?3, ?3, ?4, '', ?5, ?6,
               1, 1, ?7, 0
             )",
            params![
                provider_session_id,
                session_status,
                workspace_path,
                command_snapshot,
                archive_path,
                runtime_path,
                display_mode
            ],
        )
        .expect("session");
    CompletedReviewSeed {
        session_id: 40,
        archive_path,
        runtime_path,
    }
}

fn open_review(
    service: &AgentSessionService<'_>,
    data_dir: &Path,
    session_id: i64,
    pty: &PtySessionManager,
) -> Result<
    crate::types::agent_session_completed_review::OpenCompletedReviewResult,
    crate::types::errors::CommandError,
> {
    service.open_completed_review(
        data_dir,
        OpenCompletedReviewInput {
            project_id: 1,
            session_id,
        },
        pty,
    )
}

fn assert_unchanged_records(connection: &rusqlite::Connection, seed: &CompletedReviewSeed) {
    let session = AgentSessionRepository::new(connection)
        .find_by_id(seed.session_id)
        .expect("find session")
        .expect("session");
    assert_ne!(session.status, AgentSessionStatus::Running);
    assert_eq!(session.log_path, seed.archive_path);
    assert_eq!(
        session.runtime_log_path.as_deref(),
        Some(seed.runtime_path.as_str())
    );
    let issue = IssueRepository::new(connection)
        .find_by_id(11)
        .expect("find issue")
        .expect("issue");
    assert_eq!(issue.status, IssueStatus::Completed);
    let session_events: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM session_events WHERE session_id = ?1",
            params![seed.session_id],
            |row| row.get(0),
        )
        .expect("session events");
    assert_eq!(session_events, 0);
    let issue_actions: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM issue_actions WHERE issue_id = 11",
            [],
            |row| row.get(0),
        )
        .expect("issue actions");
    assert_eq!(issue_actions, 0);
    assert_eq!(
        fs::read_to_string(&seed.archive_path).expect("archive"),
        ARCHIVE_BODY
    );
    assert_eq!(
        fs::read_to_string(&seed.runtime_path).expect("runtime"),
        RUNTIME_BODY
    );
}

#[test]
fn completed_review_resumes_codex_in_existing_workspace_without_changing_state() {
    let temp_dir = tempfile::tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    let workspace = temp_dir.path().join("workspace");
    create_git_repo(&repo_dir);
    fs::create_dir_all(&workspace).expect("workspace");
    let script = temp_dir.path().join("codex");
    write_sleep_script(&script);
    let database = open_db(temp_dir.path());
    let seed = seed_completed_review(
        &database.connection,
        &repo_dir.to_string_lossy(),
        "codex",
        &script.to_string_lossy(),
        "tui",
        Some("thread-codex"),
        &workspace.to_string_lossy(),
        "stopped",
    );
    let service = service(&database.connection);
    let pty = PtySessionManager::new();

    let result = open_review(&service, temp_dir.path(), seed.session_id, &pty)
        .expect("completed review opens");

    assert_eq!(result.session_id, seed.session_id);
    assert_eq!(
        result.command,
        format!("{} resume thread-codex", script.display())
    );
    assert_eq!(result.working_dir, workspace.to_string_lossy());
    assert!(pty.contains(seed.session_id));
    assert_unchanged_records(&database.connection, &seed);
    let review_logs = fs::read_dir(temp_dir.path())
        .expect("data dir")
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .contains("completed-review")
        })
        .count();
    assert_eq!(review_logs, 0);
    let _ = pty.kill(seed.session_id);
}

#[test]
fn completed_review_resumes_grok_json_without_changing_display_mode() {
    let temp_dir = tempfile::tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    let workspace = temp_dir.path().join("workspace");
    create_git_repo(&repo_dir);
    fs::create_dir_all(&workspace).expect("workspace");
    let script = temp_dir.path().join("grok");
    write_sleep_script(&script);
    let database = open_db(temp_dir.path());
    let seed = seed_completed_review(
        &database.connection,
        &repo_dir.to_string_lossy(),
        "grok",
        &script.to_string_lossy(),
        "json",
        Some("grok-session"),
        &workspace.to_string_lossy(),
        "closed",
    );
    let service = service(&database.connection);
    let pty = PtySessionManager::new();

    let result = open_review(&service, temp_dir.path(), seed.session_id, &pty)
        .expect("json completed review opens");

    assert_eq!(
        result.command,
        format!("{} --resume grok-session", script.display())
    );
    assert_eq!(result.working_dir, workspace.to_string_lossy());
    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(seed.session_id)
        .expect("find")
        .expect("session");
    assert_eq!(session.display_mode, "json");
    assert_eq!(session.status, AgentSessionStatus::Closed);
    assert_eq!(
        fs::read_to_string(&seed.archive_path).expect("archive"),
        ARCHIVE_BODY
    );
    let _ = pty.kill(seed.session_id);
}

#[test]
fn completed_review_rejects_missing_workspace_without_starting() {
    let temp_dir = tempfile::tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let missing = temp_dir.path().join("missing-workspace");
    let script = temp_dir.path().join("codex");
    write_sleep_script(&script);
    let database = open_db(temp_dir.path());
    let seed = seed_completed_review(
        &database.connection,
        &repo_dir.to_string_lossy(),
        "codex",
        &script.to_string_lossy(),
        "tui",
        Some("thread-missing"),
        &missing.to_string_lossy(),
        "stopped",
    );
    let service = service(&database.connection);
    let pty = PtySessionManager::new();

    let error = open_review(&service, temp_dir.path(), seed.session_id, &pty)
        .expect_err("missing workspace");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(
        error.reason.as_deref(),
        Some("workspaceMissingForCompletedReview")
    );
    assert!(!pty.contains(seed.session_id));
    assert_unchanged_records(&database.connection, &seed);
}
