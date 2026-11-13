use rusqlite::{params, Connection};

use super::writeback::{
    apply_completion_writeback, merge_request, CompletionMethod, CompletionWriteback, FakeForge,
    WritebackBook,
};
use super::writeback_store::{
    after_local_completion, apply_persisted_writeback, detail_writeback,
    retry_issue_completion_writeback_on,
};
use crate::db::migrations::MigrationRunner;
use crate::features::issue::detail_read::read_issue_detail;
use crate::features::issue::github_issue_mirror::{
    with_captured_forge_dirs, ForgeIssueError, RemoteIssueState,
};
use crate::types::errors::CommandErrorCode;
use crate::types::issue_completion::CloseoutAction;
use crate::types::issue_detail::GetIssueDetailInput;

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

fn insert_completed(connection: &Connection, project_id: i64) -> i64 {
    connection
        .execute(
            "INSERT INTO issues (
                project_id, number, title, description, status, source, created_at, updated_at,
                status_changed_at, del
             ) VALUES (?1, 12, 'flow', 'body', 'completed', 'remote', 10, 20, 20, 0)",
            params![project_id],
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
                ?1, ?2, 'github', 'github.com', 'acme/redwhisk', 'ISSUE_12', 12,
                'https://github.com/acme/redwhisk/issues/12', 'open', '[]', '[]', 10, 10, 'synced'
             )",
            params![issue_id, project_id],
        )
        .expect("ref");
    issue_id
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

fn status_of(connection: &Connection, issue_id: i64) -> String {
    connection
        .query_row(
            "SELECT status FROM issues WHERE id = ?1",
            params![issue_id],
            |row| row.get(0),
        )
        .expect("status")
}

fn remote_state_of(connection: &Connection, issue_id: i64) -> String {
    connection
        .query_row(
            "SELECT remote_state FROM issue_external_refs WHERE issue_id = ?1",
            params![issue_id],
            |row| row.get(0),
        )
        .expect("remote")
}

#[test]
fn close_switch_off_keeps_remote_open() {
    let forge = FakeForge::open();
    let mut book = WritebackBook::default();
    apply_completion_writeback(&forge, &mut book, &merge_request(false, false)).expect("writeback");
    assert_eq!(forge.close_count(), 0);
}

#[test]
fn open_pull_request_keeps_remote_open() {
    let forge = FakeForge::open();
    let mut book = WritebackBook::default();
    let mut request = merge_request(true, false);
    request.completion = CompletionMethod::OpenPullRequest;
    request.existing_open_pull_request =
        Some("https://github.com/acme/redwhisk/pull/9".to_string());
    apply_completion_writeback(&forge, &mut book, &request).expect("writeback");
    assert_eq!(forge.close_count(), 0);
    assert_eq!(
        book.linked_pull_request.as_deref(),
        Some("https://github.com/acme/redwhisk/pull/9")
    );
}

#[test]
fn summary_switch_on_comments_once() {
    let forge = FakeForge::open();
    let mut book = WritebackBook::default();
    let request = merge_request(false, true);
    apply_completion_writeback(&forge, &mut book, &request).expect("first");
    apply_completion_writeback(&forge, &mut book, &request).expect("repeat");
    assert_eq!(forge.comments(), vec!["Shipped the flow".to_string()]);
}

#[test]
fn remote_comment_uses_delivery_summary_not_latest_comment() {
    let connection = memory();
    let project_id = insert_project(&connection);
    let issue_id = insert_completed(&connection, project_id);
    set_switches(&connection, project_id, false, true);
    connection
        .execute(
            "INSERT INTO issue_comments (
                issue_id, body, linked_session_id, linked_turn_id, created_at
             ) VALUES (?1, 'Shipped the flow', 7, 'turn-1', 1)",
            params![issue_id],
        )
        .expect("summary comment");
    connection
        .execute(
            "INSERT INTO issue_comments (issue_id, body, created_at)
             VALUES (?1, 'please rename', 2)",
            params![issue_id],
        )
        .expect("human comment");

    let summary = super::writeback_store::load_summary(&connection, issue_id).expect("summary");
    let forge = FakeForge::open();
    let mut request = merge_request(false, true);
    request.summary = summary;
    apply_persisted_writeback(
        &connection,
        &forge,
        issue_id,
        CompletionMethod::MergeToBase,
        &request,
    )
    .expect("writeback");
    assert_eq!(forge.comments(), vec!["Shipped the flow".to_string()]);
}

#[test]
fn summary_switch_off_comments_nothing() {
    let forge = FakeForge::open();
    let mut book = WritebackBook::default();
    apply_completion_writeback(&forge, &mut book, &merge_request(false, false)).expect("writeback");
    assert!(forge.comments().is_empty());
}

#[test]
fn repeated_completion_keeps_one_summary_comment() {
    let forge = FakeForge::open();
    let mut book = WritebackBook::default();
    let request = merge_request(true, true);
    apply_completion_writeback(&forge, &mut book, &request).expect("first");
    apply_completion_writeback(&forge, &mut book, &request).expect("repeat");
    assert_eq!(forge.comments().len(), 1);
    assert_eq!(forge.close_count(), 1);
}

#[test]
fn already_closed_remote_is_not_closed_again() {
    let forge = FakeForge::open();
    let mut book = WritebackBook::default();
    let mut request = merge_request(true, false);
    request.remote_state = RemoteIssueState::Closed;
    apply_completion_writeback(&forge, &mut book, &request).expect("writeback");
    assert_eq!(forge.close_count(), 0);
    request.remote_state = RemoteIssueState::Open;
    apply_completion_writeback(&forge, &mut book, &request).expect("reopen");
    assert_eq!(forge.close_count(), 0);
}

#[test]
fn failed_writeback_keeps_local_completion_and_shows_pending() {
    let connection = memory();
    let project_id = insert_project(&connection);
    let issue_id = insert_completed(&connection, project_id);
    set_switches(&connection, project_id, false, true);
    let forge = FakeForge::failing(ForgeIssueError::Offline);
    let error = apply_persisted_writeback(
        &connection,
        &forge,
        issue_id,
        CompletionMethod::MergeToBase,
        &merge_request(false, true),
    )
    .expect_err("writeback");
    assert_eq!(error.reason.as_deref(), Some("writebackOffline"));
    assert_eq!(status_of(&connection, issue_id), "completed");
    let (pending, code) = detail_writeback(&connection, issue_id).expect("detail");
    assert!(pending);
    assert_eq!(code.as_deref(), Some("writebackOffline"));
    let detail = read_issue_detail(
        &connection,
        &GetIssueDetailInput {
            project_id,
            issue_id,
        },
    )
    .expect("read");
    assert!(detail.writeback_pending);
    assert_eq!(detail.writeback_error.as_deref(), Some("writebackOffline"));
    assert_ne!(
        detail.projection.expect("projection").remote_state,
        "closed"
    );
}

#[test]
fn retry_after_failure_still_comments_once() {
    let connection = memory();
    let project_id = insert_project(&connection);
    let issue_id = insert_completed(&connection, project_id);
    set_switches(&connection, project_id, false, true);
    let forge = FakeForge::failing(ForgeIssueError::Offline);
    apply_persisted_writeback(
        &connection,
        &forge,
        issue_id,
        CompletionMethod::MergeToBase,
        &merge_request(false, true),
    )
    .expect_err("first");
    forge.clear_error();
    apply_persisted_writeback(
        &connection,
        &forge,
        issue_id,
        CompletionMethod::MergeToBase,
        &merge_request(false, true),
    )
    .expect("retry");
    assert_eq!(forge.comments(), vec!["Shipped the flow".to_string()]);
    let (pending, _) = detail_writeback(&connection, issue_id).expect("detail");
    assert!(!pending);
    assert_eq!(status_of(&connection, issue_id), "completed");
}

#[test]
fn unauthenticated_writeback_fails_immediately() {
    assert_immediate_failure(ForgeIssueError::Unauthenticated, "writebackUnauthenticated");
}

#[test]
fn forbidden_writeback_fails_immediately() {
    assert_immediate_failure(ForgeIssueError::Forbidden, "writebackForbidden");
}

#[test]
fn offline_writeback_fails_immediately() {
    assert_immediate_failure(ForgeIssueError::Offline, "writebackOffline");
}

fn assert_immediate_failure(error: ForgeIssueError, reason: &str) {
    let connection = memory();
    let project_id = insert_project(&connection);
    let issue_id = insert_completed(&connection, project_id);
    let forge = FakeForge::failing(error);
    let failure = apply_persisted_writeback(
        &connection,
        &forge,
        issue_id,
        CompletionMethod::MergeToBase,
        &merge_request(true, false),
    )
    .expect_err("writeback");
    assert_eq!(failure.reason.as_deref(), Some(reason));
    assert_eq!(forge.attempts(), 1);
    assert_eq!(forge.close_count(), 0);
    assert_eq!(status_of(&connection, issue_id), "completed");
    assert_eq!(remote_state_of(&connection, issue_id), "open");
    let (pending, code) = detail_writeback(&connection, issue_id).expect("pending");
    assert!(pending);
    assert_eq!(code.as_deref(), Some(reason));
}

#[test]
fn retry_issue_completion_writeback_on_missing_issue_fails() {
    let connection = memory();
    let project_id = insert_project(&connection);
    let error = retry_issue_completion_writeback_on(&connection, project_id, 404)
        .expect_err("retry_issue_completion_writeback");
    assert_eq!(error.code, CommandErrorCode::IssueNotFound);
}

#[test]
fn open_pull_request_does_not_use_close_on_merge() {
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
    apply_completion_writeback(&forge, &mut book, &request).expect("writeback");
    assert_eq!(forge.close_count(), 0);
}

#[test]
fn completion_writeback_uses_project_repo_after_worktree_removal() {
    let connection = memory();
    let project_id = insert_project(&connection);
    let repo = tempfile::tempdir().expect("project repo");
    connection
        .execute(
            "UPDATE projects SET repo_path = ?2 WHERE id = ?1",
            params![project_id, repo.path().to_str().expect("repo path")],
        )
        .expect("repo path");
    let issue_id = insert_completed(&connection, project_id);
    set_switches(&connection, project_id, true, false);
    let removed_worktree = repo.path().join("removed-worktree");

    let (result, dirs) = with_captured_forge_dirs(|| {
        after_local_completion(
            &connection,
            issue_id,
            removed_worktree.to_str().expect("worktree path"),
            None,
            Some(CloseoutAction::MergeToBase),
        )
    });

    result.expect("writeback after worktree removal");
    assert_eq!(dirs, vec![repo.path().to_path_buf()]);
    assert_eq!(status_of(&connection, issue_id), "completed");
    assert_eq!(remote_state_of(&connection, issue_id), "closed");
    let (pending, code) = detail_writeback(&connection, issue_id).expect("pending");
    assert!(!pending);
    assert_eq!(code, None);
}
