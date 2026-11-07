use rusqlite::{params, Connection};

use crate::db::migrations::MigrationRunner;
use crate::types::change_request::ChangeRequestListResponse;

#[test]
fn list_project_change_requests_upgrades_known_urls_without_inventing_rows() {
    let connection = open_memory();
    let project_id = insert_project(&connection);
    let github_id = insert_change_request(&connection, project_id, "github", "github.com", 132);
    let gitlab_id = insert_change_request(&connection, project_id, "gitlab", "gitlab.com", 7);
    let github_issue = insert_issue(&connection, project_id, 1);
    let gitlab_issue = insert_issue(&connection, project_id, 2);
    let unknown_issue = insert_issue(&connection, project_id, 3);
    let missing_issue = insert_issue(&connection, project_id, 4);
    insert_pull_request(
        &connection,
        github_issue,
        "https://github.com/acme/redwhisk/pull/132",
    );
    insert_pull_request(
        &connection,
        gitlab_issue,
        "https://gitlab.com/acme/redwhisk/-/merge_requests/7",
    );
    insert_pull_request(&connection, unknown_issue, "https://example.com/not-a-pr");
    insert_pull_request(
        &connection,
        missing_issue,
        "https://github.com/acme/redwhisk/pull/999",
    );

    let first =
        super::list_project_change_requests(&connection, project_id, "all_open", "yujianjia")
            .expect("list_project_change_requests");
    let second =
        super::list_project_change_requests(&connection, project_id, "all_open", "yujianjia")
            .expect("list_project_change_requests");

    assert_eq!(first.tab_count, 2);
    assert_eq!(second.tab_count, 2);
    assert_eq!(first.pull_request_refs, second.pull_request_refs);
    assert_eq!(
        ref_id(&first, "https://github.com/acme/redwhisk/pull/132"),
        Some(github_id)
    );
    assert_eq!(
        ref_id(
            &first,
            "https://gitlab.com/acme/redwhisk/-/merge_requests/7"
        ),
        Some(gitlab_id)
    );
    assert_eq!(ref_id(&first, "https://example.com/not-a-pr"), None);
    assert_eq!(
        ref_id(&first, "https://github.com/acme/redwhisk/pull/999"),
        None
    );
    assert_eq!(first.rows.len(), 2);
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

fn insert_issue(connection: &Connection, project_id: i64, number: i64) -> i64 {
    connection
        .execute(
            "INSERT INTO issues (
                project_id, number, title, description, status, source, created_at, updated_at,
                status_changed_at, del
             ) VALUES (?1, ?2, 'issue', '', 'backlog', 'local', 10, 20, 20, 0)",
            params![project_id, number],
        )
        .expect("issue");
    connection.last_insert_rowid()
}

fn insert_change_request(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    host: &str,
    number: i64,
) -> i64 {
    connection
        .execute(
            "INSERT INTO change_requests (
                project_id, provider, host, repo, external_id, number, url, title,
                state, author_login, source_branch, target_branch, review_decision,
                requested_reviewers_json, checks_ok, checks_failed, checks_pending,
                remote_updated_at, synced_at
             ) VALUES (
                ?1, ?2, ?3, 'acme/redwhisk', ?4, ?4,
                'https://example.com/' || ?4, 'Change',
                'open', 'lin', 'feat/remote-issue', 'main', 'none',
                '[]', 0, 0, 0, 1, 1
             )",
            params![project_id, provider, host, number],
        )
        .expect("change request");
    connection.last_insert_rowid()
}

fn insert_pull_request(connection: &Connection, issue_id: i64, url: &str) {
    connection
        .execute(
            "INSERT INTO issue_pull_requests (issue_id, url, created_at) VALUES (?1, ?2, 1)",
            params![issue_id, url],
        )
        .expect("pull request");
}

fn ref_id(response: &ChangeRequestListResponse, url: &str) -> Option<i64> {
    response
        .pull_request_refs
        .iter()
        .find(|pull| pull.url == url)
        .and_then(|pull| pull.change_request_id)
}
