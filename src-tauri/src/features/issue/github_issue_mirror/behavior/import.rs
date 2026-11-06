use std::sync::Mutex;

use chrono::TimeZone;
use rusqlite::{params, Connection};

use crate::db::issue_external_ref_repository::IssueExternalRefRepository;
use crate::db::migrations::MigrationRunner;
use crate::types::issue::IssueStatus;
use crate::types::issue_mirror::IssueSyncOutcome;

use super::super::board::{list_board_issues, list_board_page, IssueBoardRecord};
use super::super::cli::github_issue_list_args;
use super::super::parse::parse_github_issue_list;
use super::super::port::{
    FixedForge, ForgeIssueError, ForgeIssueListQuery, ForgeIssuePort, RemoteIssue, RemoteIssueState,
};
use super::super::sync::sync_project_issues;
use super::support::{
    action_count, insert_project, issue_deleted, open_database, ready_github_project, remote_issue,
    seed_remote_issue, sync_forge, sync_with,
};

const PR_AND_ISSUE: &str = r#"[
  {
    "id": "PR_1",
    "number": 9,
    "title": "A pull request",
    "body": "not an issue",
    "state": "OPEN",
    "updatedAt": "2026-11-05T00:00:00Z",
    "url": "https://github.com/acme/redwhisk/pull/9",
    "pull_request": { "url": "https://github.com/acme/redwhisk/pull/9" }
  },
  {
    "id": "ISSUE_8",
    "number": 8,
    "title": "A real issue",
    "body": "keep",
    "state": "OPEN",
    "updatedAt": "2026-11-05T00:00:00Z",
    "url": "https://github.com/acme/redwhisk/issues/8",
    "labels": [{ "name": "bug" }]
  }
]"#;

#[test]
fn migration_keeps_existing_local_issue_fields() {
    let connection = Connection::open_in_memory().expect("db");
    let _ = connection.execute_batch("PRAGMA foreign_keys = ON;");
    MigrationRunner::runner_skipping(&["0061_issue_external_refs"])
        .run(&connection)
        .expect("before");
    let project_id = insert_project(&connection);
    connection
        .execute(
            "INSERT INTO issues (
                project_id, number, title, description, status, source, created_at, updated_at, del
             ) VALUES (?1, 4, 'keep-title', 'keep-body', 'review', 'local', 10, 20, 1)",
            params![project_id],
        )
        .expect("legacy issue");
    MigrationRunner::default()
        .run(&connection)
        .expect("upgrade");
    let row: (String, String, i64, String) = connection
        .query_row(
            "SELECT title, status, del, source FROM issues WHERE project_id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("row");
    assert_eq!(
        row,
        (
            "keep-title".to_string(),
            "review".to_string(),
            1,
            "local".to_string()
        )
    );
}

#[test]
fn second_sync_keeps_the_same_issue_id() {
    let harness = ready_github_project("all_open", None);
    let first = sync_with(
        &harness,
        vec![remote_issue(17, RemoteIssueState::Open, "Once")],
    );
    assert_eq!(first.outcome, IssueSyncOutcome::Synced);
    let listed = list_board_issues(&harness.connection, harness.project_id).expect("list");
    let issue_id = listed[0].id;
    sync_with(
        &harness,
        vec![remote_issue(17, RemoteIssueState::Open, "Twice")],
    );
    let again = list_board_issues(&harness.connection, harness.project_id).expect("list");
    assert_eq!(again.len(), 1);
    assert_eq!(again[0].id, issue_id);
    assert_eq!(again[0].title, "Twice");
    assert_eq!(
        IssueExternalRefRepository::new(&harness.connection)
            .issue_count(harness.project_id)
            .expect("count"),
        1
    );
}

#[test]
fn deleted_issue_stays_deleted_and_off_the_board() {
    let harness = ready_github_project("all_open", None);
    let issue_id = seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "backlog",
        "issue-17",
        17,
        "open",
        true,
    );
    sync_with(
        &harness,
        vec![remote_issue(17, RemoteIssueState::Open, "Revive")],
    );
    assert_eq!(issue_deleted(&harness.connection, issue_id), 1);
    let listed = list_board_issues(&harness.connection, harness.project_id).expect("list");
    assert!(listed.is_empty());
    let title: String = harness
        .connection
        .query_row(
            "SELECT title FROM issues WHERE id = ?1",
            params![issue_id],
            |row| row.get(0),
        )
        .expect("title");
    assert_eq!(title, "keep-title");
}

#[test]
fn fixture_imports_the_issue_and_drops_the_pull_request() {
    let harness = ready_github_project("all_open", None);
    let parsed = parse_github_issue_list(PR_AND_ISSUE).expect("fixture");
    let forge = FixedForge::new(parsed);
    sync_forge(&harness, &forge);
    assert_eq!(forge.calls().len(), 1);
    let listed = list_board_issues(&harness.connection, harness.project_id).expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].external_number, Some(8));
    assert_eq!(listed[0].remote_labels, vec!["bug".to_string()]);
}

#[test]
fn open_issue_is_backlog_and_closed_issue_is_completed_without_a_session() {
    let harness = ready_github_project("all", None);
    sync_with(
        &harness,
        vec![
            remote_issue(3, RemoteIssueState::Open, "Open"),
            remote_issue(4, RemoteIssueState::Closed, "Closed"),
        ],
    );
    let mut listed = list_board_issues(&harness.connection, harness.project_id).expect("list");
    listed.sort_by_key(|issue| issue.external_number);
    assert_eq!(listed[0].status, IssueStatus::Backlog);
    assert_eq!(listed[1].status, IssueStatus::Completed);
    let sessions: i64 = harness
        .connection
        .query_row("SELECT COUNT(*) FROM agent_sessions", [], |row| row.get(0))
        .expect("sessions");
    assert_eq!(sessions, 0);
    assert_eq!(action_count(&harness.connection, listed[1].id), 0);
}

#[test]
fn incremental_sync_excludes_same_day_updates_before_the_success_time() {
    let success_at = utc_millis("2026-11-05T12:00:00Z");
    let morning = utc_millis("2026-11-05T09:00:00Z");
    let afternoon = utc_millis("2026-11-05T13:00:00Z");
    let harness = ready_github_project("all_open", None);
    harness
        .connection
        .execute(
            "UPDATE projects SET last_issue_synced_at = ?1 WHERE id = ?2",
            params![success_at, harness.project_id],
        )
        .expect("clock");

    let mut issues = Vec::new();
    for number in 1..=200 {
        let mut issue = remote_issue(number, RemoteIssueState::Open, "morning");
        issue.updated_at = morning;
        issues.push(issue);
    }
    let mut later = remote_issue(201, RemoteIssueState::Open, "afternoon");
    later.updated_at = afternoon;
    issues.push(later);

    let forge = SearchWindowForge::new(issues);
    sync_project_issues(&harness.connection, harness.project_id, &forge, success_at).expect("sync");

    let query = forge.calls()[0].clone();
    assert_eq!(query.updated_after, Some(success_at));
    assert_eq!(query.limit, 200);
    let args = github_issue_list_args(&query);
    let search = arg_value(&args, "--search").expect("search");
    assert_eq!(
        search, "updated:>=2026-11-05T12:00:00Z",
        "incremental window must be the success time, not the UTC date"
    );

    let numbers: Vec<i64> = list_board_issues(&harness.connection, harness.project_id)
        .expect("list")
        .into_iter()
        .filter_map(|issue| issue.external_number)
        .collect();
    assert!(
        numbers.iter().all(|number| *number > 200),
        "issues updated at 09:00Z must not be imported, got {numbers:?}"
    );
    assert_eq!(
        numbers,
        vec![201],
        "the 09:00Z issues must not occupy the 200 limit ahead of 13:00Z"
    );
}

#[test]
fn gitlab_sync_imports_one_issue_with_provider_gitlab() {
    let connection = open_database();
    let project_id = insert_project(&connection);
    connection
        .execute(
            "UPDATE projects
             SET issue_source_mode = 'mixed', issue_sync_scope = 'all_open'
             WHERE id = ?1",
            params![project_id],
        )
        .expect("scope");
    connection
        .execute(
            "INSERT INTO project_forge_connections (
                project_id, provider, host_url, repo_path, login, auth_status,
                cli_installed, cli_authenticated, checked_at
             ) VALUES (?1, 'gitlab', 'https://gitlab.example.com/', 'acme/redwhisk', 'octocat', 'ready', 1, 1, 1)",
            params![project_id],
        )
        .expect("connection");
    let forge = FixedForge::new(vec![remote_issue(
        8,
        RemoteIssueState::Open,
        "GitLab issue",
    )]);
    sync_project_issues(&connection, project_id, &forge, 5_000).expect("sync");
    let listed = list_board_issues(&connection, project_id).expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].external_number, Some(8));
    assert_eq!(listed[0].title, "GitLab issue");
    assert_eq!(listed[0].status, IssueStatus::Backlog);
    assert_eq!(listed[0].source, "remote");
    assert_eq!(listed[0].provider.as_deref(), Some("gitlab"));
}

#[test]
fn board_list_includes_pull_request_url_from_table() {
    let connection = open_database();
    let project_id = insert_project(&connection);
    let linked_id = insert_board_issue(&connection, project_id, 1, "linked");
    let unlinked_id = insert_board_issue(&connection, project_id, 2, "unlinked");
    connection
        .execute(
            "INSERT INTO issue_pull_requests (issue_id, url, created_at) VALUES (?1, ?2, ?3)",
            params![
                linked_id,
                "https://github.com/acme/redwhisk/pull/124",
                30_i64
            ],
        )
        .expect("pull request");

    let listed = list_board_page(&connection, project_id, None, None, None, None, None)
        .expect("list")
        .issues;
    let linked = listed
        .iter()
        .find(|issue| issue.issue.id == linked_id)
        .expect("linked issue");
    let unlinked = listed
        .iter()
        .find(|issue| issue.issue.id == unlinked_id)
        .expect("unlinked issue");

    assert_eq!(
        serialized_pull_request_url(linked).as_deref(),
        Some("https://github.com/acme/redwhisk/pull/124")
    );
    assert_eq!(serialized_pull_request_url(unlinked), None);
}

fn insert_board_issue(connection: &Connection, project_id: i64, number: i64, title: &str) -> i64 {
    connection
        .execute(
            "INSERT INTO issues (
                project_id, number, title, description, status, created_at, updated_at
             ) VALUES (?1, ?2, ?3, 'body', 'backlog', 10, 20)",
            params![project_id, number, title],
        )
        .expect("issue");
    connection.last_insert_rowid()
}

fn serialized_pull_request_url(record: &IssueBoardRecord) -> Option<String> {
    serde_json::to_value(record)
        .expect("board record")
        .get("pullRequestUrl")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

struct SearchWindowForge {
    issues: Vec<RemoteIssue>,
    calls: Mutex<Vec<ForgeIssueListQuery>>,
}

impl SearchWindowForge {
    fn new(issues: Vec<RemoteIssue>) -> Self {
        Self {
            issues,
            calls: Mutex::new(Vec::new()),
        }
    }

    fn calls(&self) -> Vec<ForgeIssueListQuery> {
        self.calls.lock().expect("calls").clone()
    }
}

impl ForgeIssuePort for SearchWindowForge {
    fn list_issues(
        &self,
        query: &ForgeIssueListQuery,
    ) -> Result<Vec<RemoteIssue>, ForgeIssueError> {
        self.calls.lock().expect("calls").push(query.clone());
        Ok(issues_matching_github_args(
            &github_issue_list_args(query),
            &self.issues,
        ))
    }
}

fn issues_matching_github_args(args: &[String], issues: &[RemoteIssue]) -> Vec<RemoteIssue> {
    let limit = arg_value(args, "--limit")
        .unwrap_or("0")
        .parse::<usize>()
        .unwrap_or(0);
    let cutoff = arg_value(args, "--search")
        .map(search_cutoff_millis)
        .unwrap_or(i64::MIN);
    issues
        .iter()
        .filter(|issue| issue.updated_at >= cutoff)
        .take(limit)
        .cloned()
        .collect()
}

fn search_cutoff_millis(search: &str) -> i64 {
    let Some(raw) = search.strip_prefix("updated:>=") else {
        return i64::MIN;
    };
    if let Ok(instant) = chrono::DateTime::parse_from_rfc3339(raw) {
        return instant.timestamp_millis();
    }
    let Ok(date) = chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d") else {
        return i64::MIN;
    };
    let midnight = date.and_hms_opt(0, 0, 0).expect("midnight");
    chrono::Utc.from_utc_datetime(&midnight).timestamp_millis()
}

fn arg_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].as_str())
}

fn utc_millis(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .expect("rfc3339")
        .timestamp_millis()
}
