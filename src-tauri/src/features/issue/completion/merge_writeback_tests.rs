use std::collections::HashMap;

use rusqlite::{params, Connection};

use super::merge_writeback::write_back_merged_change_request;
use super::writeback::{
    apply_completion_writeback, CompletionForge, CompletionMethod, CompletionWriteback, FakeForge,
    WritebackBook,
};
use super::writeback_store::retry_issue_completion_writeback_with;
use crate::db::migrations::MigrationRunner;
use crate::features::issue::github_issue_mirror::{ForgeIssueError, RemoteIssueState};

fn memory() -> Connection {
    let connection = Connection::open_in_memory().expect("memory");
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("fk");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrate");
    connection
}

fn insert_project(connection: &Connection) -> i64 {
    connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at)
             VALUES ('App', '/tmp/app', 1, 1)",
            [],
        )
        .expect("project");
    connection.last_insert_rowid()
}

fn set_switches(connection: &Connection, project_id: i64, close: bool, comment: bool) {
    connection
        .execute(
            "UPDATE projects
             SET issue_writeback_close_on_complete = ?2, issue_writeback_comment = ?3
             WHERE id = ?1",
            params![project_id, i64::from(close), i64::from(comment)],
        )
        .expect("switches");
}

fn insert_open_remote(connection: &Connection, project_id: i64, number: i64) -> i64 {
    connection
        .execute(
            "INSERT INTO issues (
                project_id, number, title, description, status, source, created_at, updated_at,
                status_changed_at, del
             ) VALUES (?1, ?2, 'flow', 'body', 'completed', 'remote', 10, 20, 20, 0)",
            params![project_id, number],
        )
        .expect("issue");
    let issue_id = connection.last_insert_rowid();
    connection
        .execute(
            "INSERT INTO issue_external_refs (
                issue_id, project_id, provider, host, repo, external_id, external_number,
                external_url, remote_state, remote_assignees_json, remote_labels_json,
                remote_updated_at, synced_at, sync_status
             ) VALUES (
                ?1, ?2, 'github', 'github.com', 'acme/redwhisk', ?3, ?4,
                ?5, 'open', '[]', '[]', 10, 10, 'synced'
             )",
            params![
                issue_id,
                project_id,
                format!("ISSUE_{number}"),
                number,
                format!("https://github.com/acme/redwhisk/issues/{number}"),
            ],
        )
        .expect("ref");
    issue_id
}

fn insert_change_request(connection: &Connection, project_id: i64, state: &str) -> i64 {
    connection
        .execute(
            "INSERT INTO change_requests (
                project_id, provider, host, repo, external_id, number, url, title,
                state, source_branch, target_branch, remote_updated_at, synced_at
             ) VALUES (
                ?1, 'github', 'github.com', 'acme/redwhisk', 'pr-7', 7,
                'https://github.com/acme/redwhisk/pull/7', 'Ship the flow',
                ?2, 'feat/flow', 'main', 30, 30
             )",
            params![project_id, state],
        )
        .expect("change request");
    connection.last_insert_rowid()
}

fn link(connection: &Connection, change_request_id: i64, issue_id: i64) {
    connection
        .execute(
            "INSERT INTO change_request_issue_links (
                change_request_id, issue_id, link_kind, created_at
             ) VALUES (?1, ?2, 'closing', 1)",
            params![change_request_id, issue_id],
        )
        .expect("link");
}

fn insert_summary(connection: &Connection, issue_id: i64) {
    connection
        .execute(
            "INSERT INTO issue_comments (
                issue_id, body, linked_session_id, linked_turn_id, created_at
             ) VALUES (?1, 'Shipped the flow', ?1, 'delivery', 30)",
            params![issue_id],
        )
        .expect("summary");
}

fn status_of(connection: &Connection, issue_id: i64) -> String {
    connection
        .query_row(
            "SELECT status FROM issues WHERE id = ?1",
            params![issue_id],
            |row| row.get(0),
        )
        .expect("status")
}

fn forges_for(issue_ids: &[i64]) -> HashMap<i64, FakeForge> {
    issue_ids
        .iter()
        .map(|issue_id| (*issue_id, FakeForge::open()))
        .collect()
}

fn write_back(
    connection: &Connection,
    change_request_id: i64,
    forges: &HashMap<i64, FakeForge>,
) -> Result<(), crate::types::errors::CommandError> {
    write_back_merged_change_request(connection, change_request_id, |issue_id| {
        forges
            .get(&issue_id)
            .map(|forge| forge as &dyn CompletionForge)
    })
}

#[test]
fn merged_change_request_closes_each_open_remote_issue_once() {
    let connection = memory();
    let project_id = insert_project(&connection);
    set_switches(&connection, project_id, true, false);
    let first = insert_open_remote(&connection, project_id, 128);
    let second = insert_open_remote(&connection, project_id, 129);
    let change_request_id = insert_change_request(&connection, project_id, "merged");
    link(&connection, change_request_id, first);
    link(&connection, change_request_id, second);
    let forges = forges_for(&[first, second]);

    write_back(&connection, change_request_id, &forges).expect("writeback");
    write_back(&connection, change_request_id, &forges).expect("sync again");

    assert_eq!(forges[&first].close_count(), 1);
    assert_eq!(forges[&second].close_count(), 1);
}

#[test]
fn close_switch_off_keeps_both_remote_issues_open() {
    let connection = memory();
    let project_id = insert_project(&connection);
    set_switches(&connection, project_id, false, false);
    let first = insert_open_remote(&connection, project_id, 128);
    let second = insert_open_remote(&connection, project_id, 129);
    let change_request_id = insert_change_request(&connection, project_id, "merged");
    link(&connection, change_request_id, first);
    link(&connection, change_request_id, second);
    let forges = forges_for(&[first, second]);

    write_back(&connection, change_request_id, &forges).expect("writeback");

    assert_eq!(forges[&first].close_count(), 0);
    assert_eq!(forges[&second].close_count(), 0);
}

#[test]
fn retry_after_auth_failure_closes_only_the_unfinished_remote_issue() {
    let connection = memory();
    let project_id = insert_project(&connection);
    set_switches(&connection, project_id, true, false);
    let failed = insert_open_remote(&connection, project_id, 128);
    let closed = insert_open_remote(&connection, project_id, 129);
    let change_request_id = insert_change_request(&connection, project_id, "merged");
    link(&connection, change_request_id, failed);
    link(&connection, change_request_id, closed);
    let mut forges = HashMap::new();
    forges.insert(failed, FakeForge::failing(ForgeIssueError::Unauthenticated));
    forges.insert(closed, FakeForge::open());

    let error = write_back(&connection, change_request_id, &forges).expect_err("partial");
    assert_eq!(error.reason.as_deref(), Some("writebackUnauthenticated"));
    assert_eq!(forges[&failed].close_count(), 0);
    assert_eq!(forges[&failed].attempts(), 1);
    assert_eq!(forges[&closed].close_count(), 1);

    forges[&failed].clear_error();
    retry_issue_completion_writeback_with(&connection, project_id, failed, &forges[&failed])
        .expect("retry");

    assert_eq!(forges[&failed].close_count(), 1);
    assert_eq!(forges[&closed].close_count(), 1);
}

#[test]
fn comment_switch_posts_shipped_summary_once_per_remote_issue() {
    let connection = memory();
    let project_id = insert_project(&connection);
    set_switches(&connection, project_id, false, true);
    let first = insert_open_remote(&connection, project_id, 128);
    let second = insert_open_remote(&connection, project_id, 129);
    insert_summary(&connection, first);
    insert_summary(&connection, second);
    let change_request_id = insert_change_request(&connection, project_id, "merged");
    link(&connection, change_request_id, first);
    link(&connection, change_request_id, second);
    let forges = forges_for(&[first, second]);

    write_back(&connection, change_request_id, &forges).expect("first");
    write_back(&connection, change_request_id, &forges).expect("again");

    assert_eq!(
        forges[&first].comments(),
        vec!["Shipped the flow".to_string()]
    );
    assert_eq!(
        forges[&second].comments(),
        vec!["Shipped the flow".to_string()]
    );
}

#[test]
fn comment_switch_off_posts_nothing() {
    let connection = memory();
    let project_id = insert_project(&connection);
    set_switches(&connection, project_id, true, false);
    let issue_id = insert_open_remote(&connection, project_id, 128);
    insert_summary(&connection, issue_id);
    let change_request_id = insert_change_request(&connection, project_id, "merged");
    link(&connection, change_request_id, issue_id);
    let forges = forges_for(&[issue_id]);

    write_back(&connection, change_request_id, &forges).expect("writeback");

    assert!(forges[&issue_id].comments().is_empty());
}

#[test]
fn open_pull_request_does_not_close_through_merge_writeback() {
    let connection = memory();
    let project_id = insert_project(&connection);
    set_switches(&connection, project_id, true, false);
    let issue_id = insert_open_remote(&connection, project_id, 128);
    let change_request_id = insert_change_request(&connection, project_id, "open");
    link(&connection, change_request_id, issue_id);
    let forges = forges_for(&[issue_id]);

    write_back(&connection, change_request_id, &forges).expect("submitted pull request");
    assert_eq!(forges[&issue_id].close_count(), 0);

    let forge = FakeForge::open();
    let mut book = WritebackBook::default();
    let request = CompletionWriteback {
        remote_state: RemoteIssueState::Open,
        close_remote_after_completion: true,
        comment_summary: false,
        completion: CompletionMethod::OpenPullRequest,
        local_completed: true,
        summary: String::new(),
        existing_open_pull_request: None,
        merged_change_request: false,
    };
    apply_completion_writeback(&forge, &mut book, &request).expect("submit pr");
    assert_eq!(forge.close_count(), 0);
}

#[test]
fn failed_writeback_keeps_successful_close_comment_and_completed_status() {
    let connection = memory();
    let project_id = insert_project(&connection);
    set_switches(&connection, project_id, true, true);
    let failed = insert_open_remote(&connection, project_id, 128);
    let closed = insert_open_remote(&connection, project_id, 129);
    insert_summary(&connection, failed);
    insert_summary(&connection, closed);
    let change_request_id = insert_change_request(&connection, project_id, "merged");
    link(&connection, change_request_id, failed);
    link(&connection, change_request_id, closed);
    let mut forges = HashMap::new();
    forges.insert(failed, FakeForge::failing(ForgeIssueError::Unauthenticated));
    forges.insert(closed, FakeForge::open());

    write_back(&connection, change_request_id, &forges).expect_err("partial");

    assert_eq!(forges[&failed].close_count(), 0);
    assert!(forges[&failed].comments().is_empty());
    assert_eq!(forges[&failed].attempts(), 1);
    assert_eq!(forges[&closed].close_count(), 1);
    assert_eq!(
        forges[&closed].comments(),
        vec!["Shipped the flow".to_string()]
    );
    assert_eq!(status_of(&connection, failed), "completed");
    assert_eq!(status_of(&connection, closed), "completed");
}

#[test]
fn second_sync_after_auth_failure_does_not_call_host_again() {
    let connection = memory();
    let project_id = insert_project(&connection);
    set_switches(&connection, project_id, true, false);
    let failed = insert_open_remote(&connection, project_id, 128);
    let closed = insert_open_remote(&connection, project_id, 129);
    let change_request_id = insert_change_request(&connection, project_id, "merged");
    link(&connection, change_request_id, failed);
    link(&connection, change_request_id, closed);
    let mut forges = HashMap::new();
    forges.insert(failed, FakeForge::failing(ForgeIssueError::Unauthenticated));
    forges.insert(closed, FakeForge::open());

    write_back(&connection, change_request_id, &forges).expect_err("first writeback");
    assert_eq!(forges[&failed].attempts(), 1);
    assert_eq!(forges[&failed].close_count(), 0);
    assert_eq!(forges[&closed].close_count(), 1);

    let _ = write_back(&connection, change_request_id, &forges);
    assert_eq!(forges[&failed].attempts(), 1);
    assert_eq!(forges[&failed].close_count(), 0);
    assert_eq!(forges[&closed].close_count(), 1);

    forges[&failed].clear_error();
    retry_issue_completion_writeback_with(&connection, project_id, failed, &forges[&failed])
        .expect("retry");

    assert_eq!(forges[&failed].close_count(), 1);
    assert_eq!(forges[&failed].attempts(), 2);
    assert_eq!(forges[&closed].close_count(), 1);
}
