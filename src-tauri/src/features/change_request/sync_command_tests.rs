use rusqlite::{params, Connection};

use crate::db::migrations::MigrationRunner;
use crate::features::issue::{FixedForge, ForgeIssueError, RemoteChangeRequest};
use crate::features::try_acquire_project_sync;
use crate::types::change_request::ChangeRequestListResponse;
use crate::types::errors::CommandErrorCode;

const CLOCK_MS: i64 = 1_794_063_600_000;
const WINDOW_START_MS: i64 = 1_791_471_600_000;
const ONE_SECOND_EARLIER_MS: i64 = 1_791_471_599_000;
const OLD_MS: i64 = 1_767_225_600_000;

#[test]
fn merged_at_window_start_is_stored_and_one_second_earlier_is_not() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = FixedForge::new(Vec::new()).with_change_requests(vec![
        merged_request(126, WINDOW_START_MS),
        merged_request(120, ONE_SECOND_EARLIER_MS),
    ]);

    super::sync_project_change_requests(&connection, project_id, &forge, CLOCK_MS)
        .expect("sync_project_change_requests");

    let listed =
        super::list_project_change_requests(&connection, project_id, "closed", "yujianjia")
            .expect("list_project_change_requests");

    assert_eq!(row_numbers(&listed), vec![126]);
    assert_eq!(listed.tab_count, 1);
    assert_eq!(listed.counts.closed, 1);
}

#[test]
fn open_and_draft_before_the_window_are_stored() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = FixedForge::new(Vec::new()).with_change_requests(vec![
        change_request(10, "open", OLD_MS),
        change_request(11, "draft", OLD_MS),
    ]);

    super::sync_project_change_requests(&connection, project_id, &forge, CLOCK_MS)
        .expect("sync_project_change_requests");

    let listed = super::list_project_change_requests(&connection, project_id, "open", "yujianjia")
        .expect("list_project_change_requests");

    assert_eq!(row_numbers(&listed), vec![11, 10]);
    assert_eq!(listed.tab_count, 2);
    assert_eq!(listed.counts.open, 2);
}

#[test]
fn github_and_gitlab_fixtures_store_open_draft_merged_and_closed() {
    let connection = open_memory();
    let github_project = insert_remote_project(&connection);
    let github = super::parse_github_pull_request_list(GITHUB_PR_LIST).expect("github fixture");
    let github_forge = FixedForge::new(Vec::new()).with_change_requests(github);
    super::sync_project_change_requests(&connection, github_project, &github_forge, CLOCK_MS)
        .expect("sync_project_change_requests");
    assert_stored_states(&connection, github_project, 201, 202, 203, 204);

    let gitlab_project = insert_gitlab_project(&connection);
    let gitlab = super::parse_gitlab_merge_request_list(GITLAB_MR_LIST).expect("gitlab fixture");
    let gitlab_forge = FixedForge::new(Vec::new()).with_change_requests(gitlab);
    super::sync_project_change_requests(&connection, gitlab_project, &gitlab_forge, CLOCK_MS)
        .expect("sync_project_change_requests");
    assert_stored_states(&connection, gitlab_project, 301, 302, 303, 304);
}

#[test]
fn syncing_the_same_number_twice_keeps_one_row_and_the_second_title() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let first = FixedForge::new(Vec::new()).with_change_requests(vec![titled(132, "First")]);
    super::sync_project_change_requests(&connection, project_id, &first, CLOCK_MS)
        .expect("sync_project_change_requests");
    let second = FixedForge::new(Vec::new()).with_change_requests(vec![titled(132, "Second")]);
    super::sync_project_change_requests(&connection, project_id, &second, CLOCK_MS)
        .expect("sync_project_change_requests");

    let listed = super::list_project_change_requests(&connection, project_id, "open", "yujianjia")
        .expect("list_project_change_requests");

    assert_eq!(row_numbers(&listed), vec![132]);
    assert_eq!(listed.rows[0].title, "Second");
    assert_eq!(listed.tab_count, 1);
}

#[test]
fn forge_failure_keeps_existing_rows_and_reports_cache_failed() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let seeded = FixedForge::new(Vec::new()).with_change_requests(
        (1..=8)
            .map(|number| change_request(number, "open", CLOCK_MS))
            .collect(),
    );
    super::sync_project_change_requests(&connection, project_id, &seeded, CLOCK_MS)
        .expect("sync_project_change_requests");
    let failing = FixedForge::failing(ForgeIssueError::CommandFailed);
    let failed = super::sync_project_change_requests(&connection, project_id, &failing, CLOCK_MS)
        .expect("sync_project_change_requests");

    assert_eq!(failed.outcome, super::ChangeRequestSyncOutcome::CacheFailed);
    assert_eq!(failed.error_code.as_deref(), Some("cache_failed"));
    let listed = super::list_project_change_requests(&connection, project_id, "open", "yujianjia")
        .expect("list_project_change_requests");
    assert_eq!(listed.tab_count, 8);
    assert_eq!(listed.rows.len(), 8);
}

#[test]
fn local_source_skips_without_calling_the_forge() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let seeded = FixedForge::new(Vec::new()).with_change_requests(vec![titled(132, "Kept")]);
    super::sync_project_change_requests(&connection, project_id, &seeded, CLOCK_MS)
        .expect("sync_project_change_requests");
    connection
        .execute(
            "UPDATE projects SET issue_source_mode = 'local' WHERE id = ?1",
            params![project_id],
        )
        .expect("local mode");
    let forge = FixedForge::failing(ForgeIssueError::Offline);
    let skipped = super::sync_project_change_requests(&connection, project_id, &forge, CLOCK_MS)
        .expect("sync_project_change_requests");

    assert_eq!(skipped.outcome, super::ChangeRequestSyncOutcome::Skipped);
    let listed = super::list_project_change_requests(&connection, project_id, "open", "yujianjia")
        .expect("list_project_change_requests");
    assert_eq!(listed.tab_count, 1);
    assert_eq!(listed.rows[0].title, "Kept");
}

#[test]
fn sync_project_change_requests_rejects_missing_project() {
    let connection = open_memory();
    let forge = FixedForge::new(Vec::new());
    let error = super::sync_project_change_requests(&connection, 404, &forge, CLOCK_MS)
        .expect_err("sync_project_change_requests");
    assert_eq!(error.code, CommandErrorCode::ProjectNotFound);
    assert_eq!(error.message, "Project not found.");
}

#[test]
fn held_project_lock_coalesces_without_clearing_rows() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let seeded = FixedForge::new(Vec::new()).with_change_requests(vec![titled(132, "Kept")]);
    super::sync_project_change_requests(&connection, project_id, &seeded, CLOCK_MS)
        .expect("sync_project_change_requests");
    let _guard = try_acquire_project_sync(&connection, project_id).expect("lock");
    let forge = FixedForge::failing(ForgeIssueError::Offline);
    let coalesced = super::sync_project_change_requests(&connection, project_id, &forge, CLOCK_MS)
        .expect("sync_project_change_requests");

    assert_eq!(
        coalesced.outcome,
        super::ChangeRequestSyncOutcome::Coalesced
    );
    assert_eq!(coalesced.error_code, None);
    let listed = super::list_project_change_requests(&connection, project_id, "open", "yujianjia")
        .expect("list_project_change_requests");
    assert_eq!(listed.tab_count, 1);
    assert_eq!(listed.rows[0].title, "Kept");
}

fn assert_stored_states(
    connection: &Connection,
    project_id: i64,
    open_number: i64,
    draft_number: i64,
    merged_number: i64,
    closed_number: i64,
) {
    let open = super::list_project_change_requests(connection, project_id, "open", "yujianjia")
        .expect("list_project_change_requests");
    let closed = super::list_project_change_requests(connection, project_id, "closed", "yujianjia")
        .expect("list_project_change_requests");
    assert_eq!(state_of(&open, open_number), "open");
    assert_eq!(state_of(&open, draft_number), "draft");
    assert_eq!(row_numbers(&closed), vec![closed_number, merged_number]);
    assert_eq!(state_of(&closed, merged_number), "merged");
    assert_eq!(state_of(&closed, closed_number), "closed");
    assert_eq!(open.tab_count, 4);
    assert!(!row_numbers(&open).contains(&closed_number));
    assert!(!row_numbers(&open).contains(&merged_number));
}

fn state_of(response: &ChangeRequestListResponse, number: i64) -> &str {
    response
        .rows
        .iter()
        .find(|row| row.number == number)
        .expect("row")
        .state
        .as_str()
}

fn merged_request(number: i64, updated_at: i64) -> RemoteChangeRequest {
    change_request(number, "merged", updated_at)
}

fn change_request(number: i64, state: &str, updated_at: i64) -> RemoteChangeRequest {
    RemoteChangeRequest {
        external_id: format!("pr-{number}"),
        number,
        title: format!("Change {number}"),
        body: String::new(),
        state: state.to_string(),
        url: format!("https://github.com/acme/redwhisk/pull/{number}"),
        author_login: Some("lin".to_string()),
        source_branch: "feat/window".to_string(),
        target_branch: "main".to_string(),
        updated_at,
    }
}

fn titled(number: i64, title: &str) -> RemoteChangeRequest {
    let mut request = change_request(number, "open", CLOCK_MS);
    request.title = title.to_string();
    request
}

fn row_numbers(response: &ChangeRequestListResponse) -> Vec<i64> {
    response.rows.iter().map(|row| row.number).collect()
}

fn open_memory() -> Connection {
    let connection = Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("foreign keys");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrate");
    connection
}

fn insert_remote_project(connection: &Connection) -> i64 {
    connection
        .execute(
            "INSERT INTO projects (
                name, repo_path, created_at, last_opened_at, issue_source_mode, issue_sync_scope
             ) VALUES ('App', '/tmp/app', 1, 1, 'remote', 'all')",
            [],
        )
        .expect("project");
    let project_id = connection.last_insert_rowid();
    connection
        .execute(
            "INSERT INTO project_forge_connections (
                project_id, provider, host_url, repo_path, login, auth_status,
                cli_installed, cli_authenticated, checked_at
             ) VALUES (?1, 'github', 'https://github.com/', 'acme/redwhisk', 'yujianjia', 'ready', 1, 1, 1)",
            params![project_id],
        )
        .expect("forge connection");
    project_id
}

fn insert_gitlab_project(connection: &Connection) -> i64 {
    connection
        .execute(
            "INSERT INTO projects (
                name, repo_path, created_at, last_opened_at, issue_source_mode, issue_sync_scope
             ) VALUES ('App', '/tmp/gitlab', 1, 1, 'remote', 'all')",
            [],
        )
        .expect("gitlab project");
    let project_id = connection.last_insert_rowid();
    connection
        .execute(
            "INSERT INTO project_forge_connections (
                project_id, provider, host_url, repo_path, login, auth_status,
                cli_installed, cli_authenticated, checked_at
             ) VALUES (?1, 'gitlab', 'https://gitlab.com/', 'acme/redwhisk', 'yujianjia', 'ready', 1, 1, 1)",
            params![project_id],
        )
        .expect("gitlab connection");
    project_id
}

const GITHUB_PR_LIST: &str = r#"[
  {"id":"gh-201","number":201,"title":"Open","body":"","state":"OPEN","isDraft":false,"mergedAt":null,"url":"https://github.com/acme/redwhisk/pull/201","updatedAt":"2026-11-07T14:00:00Z","author":{"login":"lin"},"headRefName":"feat/open","baseRefName":"main"},
  {"id":"gh-202","number":202,"title":"Draft","body":"","state":"OPEN","isDraft":true,"mergedAt":null,"url":"https://github.com/acme/redwhisk/pull/202","updatedAt":"2026-11-07T14:00:00Z","author":{"login":"lin"},"headRefName":"feat/draft","baseRefName":"main"},
  {"id":"gh-203","number":203,"title":"Merged","body":"","state":"MERGED","isDraft":false,"mergedAt":"2026-11-06T15:00:00Z","url":"https://github.com/acme/redwhisk/pull/203","updatedAt":"2026-11-07T14:00:00Z","author":{"login":"lin"},"headRefName":"feat/merged","baseRefName":"main"},
  {"id":"gh-204","number":204,"title":"Closed","body":"","state":"CLOSED","isDraft":false,"mergedAt":null,"url":"https://github.com/acme/redwhisk/pull/204","updatedAt":"2026-11-07T14:00:00Z","author":{"login":"lin"},"headRefName":"feat/closed","baseRefName":"main"}
]"#;

const GITLAB_MR_LIST: &str = r#"[
  {"id":301,"iid":301,"title":"Open","description":"","state":"opened","draft":false,"merged_at":null,"web_url":"https://gitlab.com/acme/redwhisk/-/merge_requests/301","updated_at":"2026-11-07T14:00:00Z","author":{"username":"lin"},"source_branch":"feat/open","target_branch":"main"},
  {"id":302,"iid":302,"title":"Draft","description":"","state":"opened","draft":true,"merged_at":null,"web_url":"https://gitlab.com/acme/redwhisk/-/merge_requests/302","updated_at":"2026-11-07T14:00:00Z","author":{"username":"lin"},"source_branch":"feat/draft","target_branch":"main"},
  {"id":303,"iid":303,"title":"Merged","description":"","state":"merged","draft":false,"merged_at":"2026-11-06T15:00:00Z","web_url":"https://gitlab.com/acme/redwhisk/-/merge_requests/303","updated_at":"2026-11-07T14:00:00Z","author":{"username":"lin"},"source_branch":"feat/merged","target_branch":"main"},
  {"id":304,"iid":304,"title":"Closed","description":"","state":"closed","draft":false,"merged_at":null,"web_url":"https://gitlab.com/acme/redwhisk/-/merge_requests/304","updated_at":"2026-11-07T14:00:00Z","author":{"username":"lin"},"source_branch":"feat/closed","target_branch":"main"}
]"#;
