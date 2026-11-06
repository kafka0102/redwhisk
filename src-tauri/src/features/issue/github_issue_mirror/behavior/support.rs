use rusqlite::{params, Connection};

use crate::db::issue_external_ref_repository::IssueExternalRefRepository;
use crate::db::migrations::MigrationRunner;
use crate::types::issue_mirror::IssueSyncResult;

use super::super::port::{FixedForge, RemoteIssue, RemoteIssueState};
use super::super::sync::sync_project_issues;

pub struct Harness {
    pub connection: Connection,
    pub project_id: i64,
}

pub fn ready_github_project(scope: &str, label: Option<&str>) -> Harness {
    let connection = open_database();
    let project_id = insert_project(&connection);
    connection
        .execute(
            "UPDATE projects
             SET issue_source_mode = 'mixed', issue_sync_scope = ?1, issue_sync_label = ?2
             WHERE id = ?3",
            params![scope, label, project_id],
        )
        .expect("scope");
    connection
        .execute(
            "INSERT INTO project_forge_connections (
                project_id, provider, host_url, repo_path, login, auth_status,
                cli_installed, cli_authenticated, checked_at
             ) VALUES (?1, 'github', 'https://github.com/', 'acme/redwhisk', 'octocat', 'ready', 1, 1, 1)",
            params![project_id],
        )
        .expect("connection");
    Harness {
        connection,
        project_id,
    }
}

pub fn ready_gitlab_project(scope: &str, label: Option<&str>) -> Harness {
    let harness = ready_github_project(scope, label);
    harness
        .connection
        .execute(
            "UPDATE project_forge_connections
             SET provider = 'gitlab',
                 host_url = 'https://gitlab.example.com/',
                 repo_path = 'acme/redwhisk',
                 auth_status = 'ready'
             WHERE project_id = ?1",
            params![harness.project_id],
        )
        .expect("gitlab connection");
    harness
}

pub fn issue_row_count(connection: &Connection, project_id: i64) -> i64 {
    IssueExternalRefRepository::new(connection)
        .issue_count(project_id)
        .expect("count")
}

pub fn last_sync_error(connection: &Connection, project_id: i64) -> Option<String> {
    connection
        .query_row(
            "SELECT last_issue_sync_error FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .expect("sync error")
}

pub fn open_database() -> Connection {
    let connection = Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("foreign keys");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrate");
    connection
}

pub fn insert_project(connection: &Connection) -> i64 {
    connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at)
             VALUES ('App', '/tmp/app', 1, 1)",
            [],
        )
        .expect("project");
    connection.last_insert_rowid()
}

pub fn set_auth(connection: &Connection, project_id: i64, provider: &str, auth_status: &str) {
    connection
        .execute(
            "UPDATE project_forge_connections
             SET provider = ?1, auth_status = ?2
             WHERE project_id = ?3",
            params![provider, auth_status, project_id],
        )
        .expect("auth");
}

pub fn set_mode(connection: &Connection, project_id: i64, mode: &str) {
    connection
        .execute(
            "UPDATE projects SET issue_source_mode = ?1 WHERE id = ?2",
            params![mode, project_id],
        )
        .expect("mode");
}

pub fn seed_remote_issue(
    connection: &Connection,
    project_id: i64,
    status: &str,
    external_id: &str,
    external_number: i64,
    remote_state: &str,
    deleted: bool,
) -> i64 {
    connection
        .execute(
            "INSERT INTO issues (
                project_id, number, title, description, status, source, created_at, updated_at,
                status_changed_at, del
             ) VALUES (?1, ?2, 'keep-title', 'keep-body', ?3, 'remote', 10, 20, 20, ?4)",
            params![
                project_id,
                external_number,
                status,
                if deleted { 1 } else { 0 }
            ],
        )
        .expect("issue");
    let issue_id = connection.last_insert_rowid();
    connection
        .execute(
            "INSERT INTO issue_external_refs (
                issue_id, project_id, provider, host, repo, external_id, external_number,
                external_url, remote_state, remote_updated_at, synced_at, sync_status
             ) VALUES (
                ?1, ?2, 'github', 'github.com', 'acme/redwhisk', ?3, ?4,
                'https://github.com/acme/redwhisk/issues/1', ?5, 10, 10, 'synced'
             )",
            params![
                issue_id,
                project_id,
                external_id,
                external_number,
                remote_state
            ],
        )
        .expect("ref");
    issue_id
}

pub fn remote_issue(number: i64, state: RemoteIssueState, title: &str) -> RemoteIssue {
    RemoteIssue {
        external_id: format!("issue-{number}"),
        number,
        title: title.to_string(),
        body: "body".to_string(),
        state,
        is_pull_request: false,
        url: format!("https://github.com/acme/redwhisk/issues/{number}"),
        author_login: Some("octocat".to_string()),
        assignees: vec!["me".to_string()],
        labels: vec!["bug".to_string()],
        updated_at: 30,
    }
}

pub fn sync_with(harness: &Harness, issues: Vec<RemoteIssue>) -> IssueSyncResult {
    let forge = FixedForge::new(issues);
    let result =
        sync_project_issues(&harness.connection, harness.project_id, &forge, 5_000).expect("sync");
    let _ = forge;
    result
}

pub fn sync_forge(harness: &Harness, forge: &FixedForge) -> IssueSyncResult {
    sync_project_issues(&harness.connection, harness.project_id, forge, 5_000).expect("sync")
}

pub fn action_count(connection: &Connection, issue_id: i64) -> i64 {
    IssueExternalRefRepository::new(connection)
        .remote_status_action_count(issue_id)
        .expect("actions")
}

pub fn issue_status(connection: &Connection, issue_id: i64) -> String {
    connection
        .query_row(
            "SELECT status FROM issues WHERE id = ?1",
            params![issue_id],
            |row| row.get(0),
        )
        .expect("status")
}

pub fn issue_deleted(connection: &Connection, issue_id: i64) -> i64 {
    connection
        .query_row(
            "SELECT del FROM issues WHERE id = ?1",
            params![issue_id],
            |row| row.get(0),
        )
        .expect("del")
}
