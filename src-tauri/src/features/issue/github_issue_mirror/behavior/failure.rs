use std::fs;

use tempfile::tempdir;

use crate::db::connection::DATABASE_FILE_NAME;
use crate::db::migrations::MigrationRunner;
use crate::features::issue::commands::{
    get_issue_sync_status_in_data_dir, sync_project_issues_in_data_dir,
};
use crate::types::errors::CommandErrorCode;
use crate::types::issue::IssueStatus;
use crate::types::issue_mirror::IssueSyncOutcome;

use super::super::board::list_board_issues;
use super::super::port::{FixedForge, ForgeIssueError, RemoteIssueState};
use super::support::{
    ready_github_project, remote_issue, seed_remote_issue, set_auth, set_mode, sync_forge,
};

#[test]
fn scope_query_uses_saved_filters_and_limits() {
    let assigned = ready_github_project("assigned_to_me", None);
    let forge = FixedForge::new(vec![]);
    sync_forge(&assigned, &forge);
    assert_eq!(forge.calls()[0].assignee.as_deref(), Some("@me"));
    assert_eq!(forge.calls()[0].states, vec![RemoteIssueState::Open]);
    assert_eq!(forge.calls()[0].limit, 500);
    assert_eq!(forge.calls()[0].updated_after, None);

    let open = ready_github_project("all_open", None);
    let forge = FixedForge::new(vec![]);
    sync_forge(&open, &forge);
    assert!(forge.calls()[0].assignee.is_none());
    assert_eq!(forge.calls()[0].states, vec![RemoteIssueState::Open]);

    let labeled = ready_github_project("label", Some("bug"));
    let forge = FixedForge::new(vec![]);
    sync_forge(&labeled, &forge);
    assert_eq!(forge.calls()[0].label.as_deref(), Some("bug"));
    assert_eq!(forge.calls()[0].states, vec![RemoteIssueState::Open]);

    let all = ready_github_project("all", None);
    let forge = FixedForge::new(vec![remote_issue(1, RemoteIssueState::Open, "First")]);
    sync_forge(&all, &forge);
    assert_eq!(
        forge.calls()[0].states,
        vec![RemoteIssueState::Open, RemoteIssueState::Closed]
    );
    assert_eq!(forge.calls()[0].limit, 500);
    let again = FixedForge::new(vec![]);
    sync_forge(&all, &again);
    assert_eq!(again.calls()[0].limit, 200);
    assert_eq!(again.calls()[0].updated_after, Some(5_000));
}

#[test]
fn blank_label_scope_does_not_call_the_list() {
    let harness = ready_github_project("label", Some("   "));
    let forge = FixedForge::new(vec![]);
    let error =
        super::super::sync::sync_project_issues(&harness.connection, harness.project_id, &forge, 1)
            .expect_err("label");
    assert_eq!(error.reason.as_deref(), Some("issueSyncLabelRequired"));
    assert_eq!(error.message, "Issue sync label is required.");
    assert!(forge.calls().is_empty());
}

#[test]
fn expired_credentials_keep_the_cached_issue() {
    let harness = ready_github_project("all_open", None);
    let issue_id = seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "backlog",
        "issue-4",
        4,
        "open",
        false,
    );
    set_auth(&harness.connection, harness.project_id, "github", "expired");
    let forge = FixedForge::new(vec![]);
    let result = sync_forge(&harness, &forge);
    assert_eq!(result.outcome, IssueSyncOutcome::CredentialExpired);
    assert!(forge.calls().is_empty());
    let listed = list_board_issues(&harness.connection, harness.project_id).expect("list");
    assert_eq!(listed[0].id, issue_id);
    assert_eq!(listed[0].external_number, Some(4));
}

#[test]
fn command_failure_keeps_cached_issues_without_marking_every_card() {
    let harness = ready_github_project("all_open", None);
    seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "backlog",
        "issue-4",
        4,
        "open",
        false,
    );
    let forge = FixedForge::failing(ForgeIssueError::Unparseable);
    let result = sync_forge(&harness, &forge);
    assert_eq!(result.outcome, IssueSyncOutcome::CacheFailed);
    let listed = list_board_issues(&harness.connection, harness.project_id).expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].sync_status.as_deref(), Some("synced"));
    assert_ne!(listed[0].sync_status.as_deref(), Some("error"));
}

#[test]
fn blank_title_marks_only_that_cached_issue() {
    let harness = ready_github_project("all", None);
    seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "backlog",
        "issue-4",
        4,
        "open",
        false,
    );
    seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "backlog",
        "issue-5",
        5,
        "open",
        false,
    );
    let mut blank = remote_issue(4, RemoteIssueState::Open, "   ");
    blank.external_id = "issue-4".to_string();
    let result = sync_forge(
        &harness,
        &FixedForge::new(vec![blank, remote_issue(5, RemoteIssueState::Open, "Kept")]),
    );
    assert_eq!(result.outcome, IssueSyncOutcome::Synced);
    let mut listed = list_board_issues(&harness.connection, harness.project_id).expect("list");
    listed.sort_by_key(|issue| issue.external_number);
    assert_eq!(listed[0].sync_status.as_deref(), Some("error"));
    assert_eq!(listed[0].title, "keep-title");
    assert_eq!(listed[1].sync_status.as_deref(), Some("synced"));
    assert_eq!(listed[1].title, "Kept");
    assert_eq!(listed[1].status, IssueStatus::Backlog);
}

#[test]
fn local_mode_skips_without_calling_the_list() {
    let harness = ready_github_project("all_open", None);
    set_mode(&harness.connection, harness.project_id, "local");
    let forge = FixedForge::new(vec![remote_issue(1, RemoteIssueState::Open, "Nope")]);
    let result = sync_forge(&harness, &forge);
    assert_eq!(result.outcome, IssueSyncOutcome::Skipped);
    assert!(forge.calls().is_empty());
}

#[test]
fn gitlab_connection_does_not_call_github_and_keeps_cache() {
    let harness = ready_github_project("all_open", None);
    seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "backlog",
        "issue-4",
        4,
        "open",
        false,
    );
    set_auth(&harness.connection, harness.project_id, "gitlab", "ready");
    let forge = FixedForge::new(vec![]);
    let result = sync_forge(&harness, &forge);
    assert_eq!(result.outcome, IssueSyncOutcome::CacheFailed);
    assert!(forge.calls().is_empty());
    assert_eq!(
        list_board_issues(&harness.connection, harness.project_id)
            .expect("list")
            .len(),
        1
    );
}

#[test]
fn sync_project_issues_missing_project() {
    let data_dir = tempdir().expect("data dir");
    let connection =
        rusqlite::Connection::open(data_dir.path().join(DATABASE_FILE_NAME)).expect("db");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrate");
    drop(connection);
    let error = sync_project_issues_in_data_dir(data_dir.path(), 404).expect_err("missing project");
    assert_eq!(error.code, CommandErrorCode::ProjectNotFound);
    assert_eq!(error.message, "Project not found.");
    let _ = fs::remove_dir_all(data_dir.path());
}

#[test]
fn get_issue_sync_status_missing_project() {
    let data_dir = tempdir().expect("data dir");
    let connection =
        rusqlite::Connection::open(data_dir.path().join(DATABASE_FILE_NAME)).expect("db");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrate");
    drop(connection);
    let error =
        get_issue_sync_status_in_data_dir(data_dir.path(), 404).expect_err("missing project");
    assert_eq!(error.code, CommandErrorCode::ProjectNotFound);
    assert_eq!(error.message, "Project not found.");
}

#[test]
fn get_issue_sync_status_returns_last_synced_at_and_sync_error() {
    let data_dir = tempdir().expect("data dir");
    let connection =
        rusqlite::Connection::open(data_dir.path().join(DATABASE_FILE_NAME)).expect("db");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrate");
    connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at)
             VALUES ('App', '/tmp/issue-sync-status', 1, 1)",
            [],
        )
        .expect("project");
    let project_id = connection.last_insert_rowid();
    let last_synced_at = chrono::DateTime::parse_from_rfc3339("2026-11-05T12:00:00Z")
        .expect("time")
        .timestamp_millis();
    connection
        .execute(
            "UPDATE projects
             SET last_issue_synced_at = ?1, last_issue_sync_error = ?2
             WHERE id = ?3",
            rusqlite::params![last_synced_at, "cache_failed", project_id],
        )
        .expect("clock");
    drop(connection);

    let status = get_issue_sync_status_in_data_dir(data_dir.path(), project_id).expect("status");
    let json = serde_json::to_value(&status).expect("json");
    assert_eq!(json["lastSyncedAt"], last_synced_at);
    assert_eq!(json["syncError"], "cache_failed");
    let _ = fs::remove_dir_all(data_dir.path());
}
