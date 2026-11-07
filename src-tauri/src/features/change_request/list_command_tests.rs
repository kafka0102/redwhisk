use rusqlite::{params, Connection};

use crate::db::migrations::MigrationRunner;
use crate::types::change_request::ChangeRequestListResponse;
use crate::types::errors::CommandErrorCode;

struct SampleRow {
    number: i64,
    state: &'static str,
    author: &'static str,
    reviewers: &'static str,
    review: &'static str,
    checks: Option<(i64, i64, i64)>,
    updated_at: i64,
}

const SAMPLE: [SampleRow; 8] = [
    SampleRow {
        number: 132,
        state: "open",
        author: "yujianjia",
        reviewers: "[\"yujianjia\"]",
        review: "review_required",
        checks: Some((3, 1, 0)),
        updated_at: 1_794_063_480_000,
    },
    SampleRow {
        number: 131,
        state: "open",
        author: "maya",
        reviewers: "[\"yujianjia\"]",
        review: "review_required",
        checks: Some((4, 0, 0)),
        updated_at: 1_794_063_000_000,
    },
    SampleRow {
        number: 130,
        state: "draft",
        author: "lin",
        reviewers: "[\"yujianjia\"]",
        review: "review_required",
        checks: Some((0, 0, 0)),
        updated_at: 1_794_062_400_000,
    },
    SampleRow {
        number: 129,
        state: "open",
        author: "maya",
        reviewers: "[]",
        review: "approved",
        checks: Some((4, 0, 0)),
        updated_at: 1_794_061_800_000,
    },
    SampleRow {
        number: 128,
        state: "open",
        author: "yujianjia",
        reviewers: "[]",
        review: "none",
        checks: None,
        updated_at: 1_794_056_400_000,
    },
    SampleRow {
        number: 127,
        state: "draft",
        author: "yujianjia",
        reviewers: "[]",
        review: "pending",
        checks: Some((2, 0, 1)),
        updated_at: 1_794_052_800_000,
    },
    SampleRow {
        number: 125,
        state: "merged",
        author: "lin",
        reviewers: "[]",
        review: "approved",
        checks: Some((4, 0, 0)),
        updated_at: 1_793_977_200_000,
    },
    SampleRow {
        number: 124,
        state: "closed",
        author: "maya",
        reviewers: "[]",
        review: "none",
        checks: Some((0, 0, 0)),
        updated_at: 1_793_491_200_000,
    },
];

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

fn insert_sample(connection: &Connection, project_id: i64) {
    for row in &SAMPLE {
        let checks_ok = row.checks.map(|checks| checks.0);
        let checks_failed = row.checks.map(|checks| checks.1);
        let checks_pending = row.checks.map(|checks| checks.2);
        connection
            .execute(
                "INSERT INTO change_requests (
                    project_id, provider, host, repo, external_id, number, url, title,
                    state, author_login, source_branch, target_branch, review_decision,
                    requested_reviewers_json, checks_ok, checks_failed, checks_pending,
                    remote_updated_at, synced_at
                 ) VALUES (
                    ?1, 'github', 'github.com', 'acme/redwhisk', ?2, ?2,
                    'https://github.com/acme/redwhisk/pull/' || ?2, ?3,
                    ?4, ?5, 'feat/remote-issue', 'main', ?6,
                    ?7, ?8, ?9, ?10, ?11, ?11
                 )",
                params![
                    project_id,
                    row.number,
                    format!("Change {}", row.number),
                    row.state,
                    row.author,
                    row.review,
                    row.reviewers,
                    checks_ok,
                    checks_failed,
                    checks_pending,
                    row.updated_at,
                ],
            )
            .expect("change request");
    }
}

#[test]
fn review_requested_filter_returns_three_rows_and_tab_count_eight() {
    let connection = open_memory();
    let project_id = insert_project(&connection);
    insert_sample(&connection, project_id);

    let response = super::list_project_change_requests(
        &connection,
        project_id,
        "review_requested",
        "yujianjia",
    )
    .expect("list_project_change_requests");

    assert_eq!(response.tab_count, 8);
    assert_eq!(
        response
            .rows
            .iter()
            .map(|row| row.number)
            .collect::<Vec<_>>(),
        vec![132, 131, 130]
    );
    assert_eq!(response.counts.review_requested, 3);
    assert_eq!(response.counts.created_by_me, 3);
    assert_eq!(response.counts.all_open, 6);
    assert_eq!(response.counts.recently_merged, 1);
}

#[test]
fn empty_filter_matches_review_requested_rows() {
    let connection = open_memory();
    let project_id = insert_project(&connection);
    insert_sample(&connection, project_id);

    let response = super::list_project_change_requests(&connection, project_id, "", "yujianjia")
        .expect("list_project_change_requests");

    assert_eq!(row_numbers(&response), vec![132, 131, 130]);
    assert_eq!(response.tab_count, 8);
}

#[test]
fn other_filters_skip_closed_124_and_keep_tab_count() {
    let connection = open_memory();
    let project_id = insert_project(&connection);
    insert_sample(&connection, project_id);

    let created =
        super::list_project_change_requests(&connection, project_id, "created_by_me", "yujianjia")
            .expect("list_project_change_requests");
    let open =
        super::list_project_change_requests(&connection, project_id, "all_open", "yujianjia")
            .expect("list_project_change_requests");
    let merged = super::list_project_change_requests(
        &connection,
        project_id,
        "recently_merged",
        "yujianjia",
    )
    .expect("list_project_change_requests");

    assert_eq!(row_numbers(&created), vec![132, 128, 127]);
    assert_eq!(row_numbers(&open), vec![132, 131, 130, 129, 128, 127]);
    assert_eq!(row_numbers(&merged), vec![125]);
    assert_eq!(created.tab_count, 8);
    assert_eq!(open.counts.recently_merged, 1);
    assert!(!row_numbers(&created).contains(&124));
    assert!(!row_numbers(&open).contains(&124));
    assert!(!row_numbers(&merged).contains(&124));
}

#[test]
fn blank_viewer_login_zeroes_personal_filters_only() {
    let connection = open_memory();
    let project_id = insert_project(&connection);
    insert_sample(&connection, project_id);

    let response =
        super::list_project_change_requests(&connection, project_id, "review_requested", "  ")
            .expect("list_project_change_requests");

    assert!(response.rows.is_empty());
    assert_eq!(response.tab_count, 8);
    assert_eq!(response.counts.review_requested, 0);
    assert_eq!(response.counts.created_by_me, 0);
    assert_eq!(response.counts.all_open, 6);
    assert_eq!(response.counts.recently_merged, 1);
}

#[test]
fn list_project_change_requests_rejects_unknown_project_and_filter() {
    let connection = open_memory();
    let missing =
        super::list_project_change_requests(&connection, 404, "review_requested", "yujianjia")
            .expect_err("list_project_change_requests");
    assert_eq!(missing.code, CommandErrorCode::ProjectNotFound);
    assert_eq!(missing.message, "Project not found.");

    let project_id = insert_project(&connection);
    insert_sample(&connection, project_id);
    let invalid = super::list_project_change_requests(&connection, project_id, "nope", "yujianjia")
        .expect_err("list_project_change_requests");
    assert_eq!(
        invalid.reason.as_deref(),
        Some("changeRequestFilterInvalid")
    );
    let empty = super::list_project_change_requests(&connection, project_id, "", "yujianjia")
        .expect("list_project_change_requests");
    assert_eq!(row_numbers(&empty), vec![132, 131, 130]);
}

fn row_numbers(response: &ChangeRequestListResponse) -> Vec<i64> {
    response.rows.iter().map(|row| row.number).collect()
}

#[test]
fn review_requested_rows_include_checks_and_wrapped_issue_labels() {
    let connection = open_memory();
    let project_id = insert_project(&connection);
    insert_sample(&connection, project_id);
    let github_issue = insert_issue(&connection, project_id, 128, "remote");
    insert_external_ref(&connection, github_issue, project_id, "github", 128);
    let local_issue = insert_issue(&connection, project_id, 12, "local");
    let gitlab_issue = insert_issue(&connection, project_id, 7, "remote");
    insert_external_ref(&connection, gitlab_issue, project_id, "gitlab", 7);
    link(&connection, project_id, 132, github_issue);
    link(&connection, project_id, 132, local_issue);
    link(&connection, project_id, 128, local_issue);
    link(&connection, project_id, 127, gitlab_issue);

    let response =
        super::list_project_change_requests(&connection, project_id, "all_open", "yujianjia")
            .expect("list_project_change_requests");
    let row_132 = response.rows.iter().find(|row| row.number == 132).unwrap();
    let row_128 = response.rows.iter().find(|row| row.number == 128).unwrap();
    let row_127 = response.rows.iter().find(|row| row.number == 127).unwrap();
    let row_130 = response.rows.iter().find(|row| row.number == 130).unwrap();

    assert_eq!(row_132.checks_ok, Some(3));
    assert_eq!(row_132.checks_failed, Some(1));
    assert_eq!(row_132.checks_pending, Some(0));
    assert_eq!(row_132.review_decision.as_deref(), Some("review_required"));
    assert_eq!(
        row_132
            .linked_issues
            .iter()
            .map(|link| link.label.as_str())
            .collect::<Vec<_>>(),
        vec!["#12", "GH #128"]
    );
    assert_eq!(row_130.checks_ok, Some(0));
    assert_eq!(row_130.checks_failed, Some(0));
    assert_eq!(row_130.checks_pending, Some(0));
    assert_eq!(row_128.checks_ok, None);
    assert_eq!(row_128.checks_failed, None);
    assert_eq!(row_128.checks_pending, None);
    assert_eq!(
        row_128
            .linked_issues
            .iter()
            .map(|link| link.label.as_str())
            .collect::<Vec<_>>(),
        vec!["#12"]
    );
    assert_eq!(row_127.checks_ok, Some(2));
    assert_eq!(row_127.checks_pending, Some(1));
    assert_eq!(row_127.review_decision.as_deref(), Some("pending"));
    assert_eq!(
        row_127
            .linked_issues
            .iter()
            .map(|link| link.label.as_str())
            .collect::<Vec<_>>(),
        vec!["GL #7"]
    );
}

#[test]
fn blank_argument_uses_saved_forge_login() {
    let connection = open_memory();
    let project_id = insert_project(&connection);
    insert_sample(&connection, project_id);
    connection
        .execute(
            "INSERT INTO project_forge_connections (
                project_id, provider, host_url, repo_path, login, auth_status,
                cli_installed, cli_authenticated, checked_at
             ) VALUES (?1, 'github', 'https://github.com/', 'acme/redwhisk', 'YuJianJia', 'ready', 1, 1, 1)",
            params![project_id],
        )
        .expect("forge login");

    let response =
        super::list_project_change_requests(&connection, project_id, "", "").expect("list");

    assert_eq!(row_numbers(&response), vec![132, 131, 130]);
}

fn insert_issue(connection: &Connection, project_id: i64, number: i64, source: &str) -> i64 {
    connection
        .execute(
            "INSERT INTO issues (
                project_id, number, title, description, status, source, created_at, updated_at,
                status_changed_at, del
             ) VALUES (?1, ?2, 'issue', '', 'backlog', ?3, 10, 20, 20, 0)",
            params![project_id, number, source],
        )
        .expect("issue");
    connection.last_insert_rowid()
}

fn insert_external_ref(
    connection: &Connection,
    issue_id: i64,
    project_id: i64,
    provider: &str,
    external_number: i64,
) {
    let host = if provider == "gitlab" {
        "gitlab.com"
    } else {
        "github.com"
    };
    connection
        .execute(
            "INSERT INTO issue_external_refs (
                issue_id, project_id, provider, host, repo, external_id, external_number,
                external_url, remote_state, remote_updated_at, synced_at, sync_status
             ) VALUES (
                ?1, ?2, ?3, ?4, 'acme/redwhisk', ?5, ?5,
                'https://example.com/issues/' || ?5, 'open', 10, 10, 'synced'
             )",
            params![issue_id, project_id, provider, host, external_number],
        )
        .expect("external ref");
}

fn link(connection: &Connection, project_id: i64, number: i64, issue_id: i64) {
    let change_request_id: i64 = connection
        .query_row(
            "SELECT id FROM change_requests WHERE project_id = ?1 AND number = ?2",
            params![project_id, number],
            |row| row.get(0),
        )
        .expect("change request id");
    connection
        .execute(
            "INSERT INTO change_request_issue_links (
                change_request_id, issue_id, link_kind, created_at
             ) VALUES (?1, ?2, 'manual', 1)",
            params![change_request_id, issue_id],
        )
        .expect("link");
}
