use rusqlite::{params, Connection};
use std::path::PathBuf;

use super::github_issue_mirror::{
    with_captured_forge_invocations, with_scripted_forge_output, with_simulated_forge_failure,
    ForgeIssueError,
};
use super::service::IssueService;
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::types::errors::CommandErrorCode;
use crate::types::issue::DeleteIssueInput;

fn setup() -> (Connection, i64, PathBuf) {
    let repo = tempfile::tempdir().expect("repo").keep();
    let connection = Connection::open_in_memory().expect("db");
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("fk");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrate");
    connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at)
             VALUES ('App', ?1, 1, 1)",
            params![repo.to_string_lossy().to_string()],
        )
        .expect("project");
    let project_id = connection.last_insert_rowid();
    (connection, project_id, repo)
}

fn service(connection: &Connection) -> IssueService<'_> {
    IssueService::new(
        IssueRepository::new(connection),
        ProjectRepository::new(connection),
    )
}

fn input(project_id: i64, issue_id: i64, sync_delete_host: bool) -> DeleteIssueInput {
    DeleteIssueInput {
        project_id,
        issue_id,
        sync_delete_host,
    }
}

fn insert_issue(connection: &Connection, project_id: i64, number: i64, source: &str) -> i64 {
    connection
        .execute(
            "INSERT INTO issues (
                project_id, number, title, description, status, source, created_at, updated_at,
                status_changed_at, del
             ) VALUES (?1, ?2, 'Issue', '', 'backlog', ?3, 10, 20, 20, 0)",
            params![project_id, number, source],
        )
        .expect("issue");
    connection.last_insert_rowid()
}

fn insert_remote(
    connection: &Connection,
    project_id: i64,
    local_number: i64,
    provider: &str,
    external_number: i64,
) -> i64 {
    let issue_id = insert_issue(connection, project_id, local_number, "remote");
    connection
        .execute(
            "INSERT INTO issue_external_refs (
                issue_id, project_id, provider, host, repo, external_id, external_number,
                external_url, remote_state, remote_updated_at, synced_at, sync_status
             ) VALUES (
                ?1, ?2, ?3, 'example.test', 'acme/redwhisk', ?4, ?5,
                'https://example.test/issues/128', 'open', 10, 10, 'synced'
             )",
            params![
                issue_id,
                project_id,
                provider,
                format!("{provider}-{external_number}"),
                external_number
            ],
        )
        .expect("ref");
    issue_id
}

fn deleted(connection: &Connection, issue_id: i64) -> bool {
    connection
        .query_row("SELECT del FROM issues WHERE id = ?1", [issue_id], |row| {
            row.get::<_, i64>(0)
        })
        .expect("del")
        == 1
}

fn assert_delete_args(args: &[String], number: &str) {
    assert!(args.iter().any(|arg| arg == "issue"));
    assert!(args.iter().any(|arg| arg == "delete"));
    assert!(args.iter().any(|arg| arg == number));
    assert!(args.iter().any(|arg| arg == "--yes"));
    assert!(!args.iter().any(|arg| arg == "close"));
}

#[test]
fn omitted_sync_delete_host_soft_deletes_without_calling_the_host() {
    let parsed: DeleteIssueInput =
        serde_json::from_str(r#"{"projectId":1,"issueId":9}"#).expect("json");
    assert!(!parsed.sync_delete_host);

    let (connection, project_id, _repo) = setup();
    let issue_id = insert_remote(&connection, project_id, 7, "github", 128);
    let (result, invocations) = with_captured_forge_invocations(|| {
        service(&connection).delete_issue(input(project_id, issue_id, parsed.sync_delete_host))
    });
    result.expect("local delete");
    assert!(invocations.is_empty());
    assert!(deleted(&connection, issue_id));
}

#[test]
fn sync_delete_host_false_soft_deletes_github_issue_without_calling_the_host() {
    let (connection, project_id, _repo) = setup();
    let issue_id = insert_remote(&connection, project_id, 7, "github", 128);
    let (result, invocations) = with_captured_forge_invocations(|| {
        service(&connection).delete_issue(input(project_id, issue_id, false))
    });
    result.expect("local delete");
    assert!(invocations.is_empty());
    assert!(deleted(&connection, issue_id));
}

#[test]
fn sync_delete_host_github_deletes_external_number_then_soft_deletes_local_copy() {
    let (connection, project_id, repo) = setup();
    let issue_id = insert_remote(&connection, project_id, 7, "github", 128);
    let (result, invocations) = with_scripted_forge_output(vec![Ok(String::new())], || {
        service(&connection).delete_issue(input(project_id, issue_id, true))
    });
    result.expect("deleted");
    assert_eq!(invocations.len(), 1);
    assert_eq!(invocations[0].program, "gh");
    assert_delete_args(&invocations[0].args, "128");
    assert_eq!(invocations[0].dir, repo);
    assert_ne!(7, 128);
    assert!(deleted(&connection, issue_id));
}

#[test]
fn sync_delete_host_gitlab_uses_glab_delete_not_gh() {
    let (connection, project_id, repo) = setup();
    let issue_id = insert_remote(&connection, project_id, 7, "gitlab", 128);
    let (result, invocations) = with_scripted_forge_output(vec![Ok(String::new())], || {
        service(&connection).delete_issue(input(project_id, issue_id, true))
    });
    result.expect("deleted");
    assert_eq!(invocations.len(), 1);
    assert_eq!(invocations[0].program, "glab");
    assert_ne!(invocations[0].program, "gh");
    assert_delete_args(&invocations[0].args, "128");
    assert_eq!(invocations[0].dir, repo);
    assert!(deleted(&connection, issue_id));
}

fn assert_forge_failure_keeps_local(failure: ForgeIssueError, reason: &str) {
    let (connection, project_id, _repo) = setup();
    let issue_id = insert_remote(&connection, project_id, 7, "github", 128);
    let (error, invocations) = with_simulated_forge_failure(failure, || {
        service(&connection)
            .delete_issue(input(project_id, issue_id, true))
            .expect_err("host failure")
    });
    assert_eq!(error.code, CommandErrorCode::ForgeUnavailable);
    assert_eq!(error.reason.as_deref(), Some(reason));
    assert_ne!(
        error.reason.as_deref(),
        Some("syncDeleteHostNotFound").filter(|_| reason != "syncDeleteHostNotFound")
    );
    assert!(!deleted(&connection, issue_id));
    assert_eq!(invocations.len(), 1);
}

#[test]
fn sync_delete_host_not_found_keeps_the_local_copy() {
    assert_forge_failure_keeps_local(ForgeIssueError::NotFound, "syncDeleteHostNotFound");
}

#[test]
fn sync_delete_host_gone_keeps_the_local_copy() {
    assert_forge_failure_keeps_local(ForgeIssueError::Gone, "syncDeleteHostGone");
}

#[test]
fn sync_delete_host_unauthenticated_keeps_the_local_copy() {
    assert_forge_failure_keeps_local(
        ForgeIssueError::Unauthenticated,
        "syncDeleteHostUnauthenticated",
    );
}

#[test]
fn sync_delete_host_forbidden_keeps_the_local_copy() {
    assert_forge_failure_keeps_local(ForgeIssueError::Forbidden, "syncDeleteHostForbidden");
}

#[test]
fn sync_delete_host_offline_keeps_the_local_copy() {
    assert_forge_failure_keeps_local(ForgeIssueError::Offline, "syncDeleteHostOffline");
}

#[test]
fn sync_delete_host_cli_missing_keeps_the_local_copy() {
    assert_forge_failure_keeps_local(ForgeIssueError::CliMissing, "syncDeleteHostUnavailable");
}

#[test]
fn sync_delete_host_rate_limited_keeps_the_local_copy() {
    assert_forge_failure_keeps_local(ForgeIssueError::RateLimited, "syncDeleteHostUnavailable");
}

#[test]
fn sync_delete_host_command_failed_keeps_the_local_copy() {
    assert_forge_failure_keeps_local(ForgeIssueError::CommandFailed, "syncDeleteHostUnavailable");
}

#[test]
fn sync_delete_host_true_on_local_issue_does_not_call_host_or_soft_delete() {
    let (connection, project_id, _repo) = setup();
    let issue_id = insert_issue(&connection, project_id, 7, "local");
    let (error, invocations) = with_captured_forge_invocations(|| {
        service(&connection)
            .delete_issue(input(project_id, issue_id, true))
            .expect_err("not remote")
    });
    assert!(invocations.is_empty());
    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
    assert_eq!(error.reason.as_deref(), Some("syncDeleteHostNotRemote"));
    assert!(!deleted(&connection, issue_id));
}

#[test]
fn sync_delete_host_true_without_identity_does_not_call_host_or_soft_delete() {
    let (connection, project_id, _repo) = setup();
    let issue_id = insert_issue(&connection, project_id, 7, "remote");
    let (error, invocations) = with_captured_forge_invocations(|| {
        service(&connection)
            .delete_issue(input(project_id, issue_id, true))
            .expect_err("missing identity")
    });
    assert!(invocations.is_empty());
    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
    assert_eq!(
        error.reason.as_deref(),
        Some("syncDeleteHostIdentityMissing")
    );
    assert_ne!(error.reason.as_deref(), Some("syncDeleteHostNotRemote"));
    assert!(!deleted(&connection, issue_id));
}

#[test]
fn sync_delete_host_keeps_local_copy_when_local_delete_fails_before_commit() {
    let (connection, project_id, _repo) = setup();
    let issue_id = insert_remote(&connection, project_id, 7, "github", 128);
    connection
        .execute(
            "INSERT INTO agent_profiles (
                id, name, agent_type, command, scope, project_id, mode, dangerous,
                default_skill, prompt_template, del
             ) VALUES (100, 'Codex', 'codex', 'codex', 'project', ?1, 'full-auto', 1, '', '', 0)",
            params![project_id],
        )
        .expect("profile");
    connection
        .execute(
            "INSERT INTO agent_sessions (
                id, project_id, issue_id, agent_profile_id, status, attention,
                working_dir, command_snapshot, prompt_snapshot, log_path,
                last_active_at, started_at, closed_at, del
             ) VALUES (
                50, ?1, ?2, 100, 'running', 'none',
                '/tmp/repo', 'codex', '', '/tmp/s.log',
                13, 13, 99, 0
             )",
            params![project_id, issue_id],
        )
        .expect("session");

    let (error, invocations) = with_scripted_forge_output(vec![Ok(String::new())], || {
        service(&connection)
            .delete_issue(input(project_id, issue_id, true))
            .expect_err("local delete")
    });
    assert_eq!(invocations.len(), 1);
    assert_eq!(invocations[0].program, "gh");
    assert!(!deleted(&connection, issue_id));
    assert_ne!(error.reason.as_deref(), Some("syncDeleteHostNotFound"));
}
