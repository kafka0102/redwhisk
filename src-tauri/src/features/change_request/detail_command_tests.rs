use rusqlite::{params, Connection};

use crate::db::migrations::MigrationRunner;
use crate::features::issue::{FixedForge, ForgeIssueError, RemoteChangeRequest};
use crate::types::errors::CommandErrorCode;
const CLOCK_MS: i64 = 1_794_063_600_000;

#[test]
fn detail_fetch_failure_keeps_existing_snapshot() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = FixedForge::new(Vec::new()).with_change_requests(vec![change_request(42)]);
    super::sync_project_change_requests(&connection, project_id, &forge, CLOCK_MS)
        .expect("sync_project_change_requests");
    let snapshot = existing_snapshot();
    write_snapshot(&connection, project_id, 42, &snapshot);

    let failing = FixedForge::new(Vec::new()).with_detail_error(ForgeIssueError::Offline);
    let result = super::get_project_change_request(
        &connection,
        project_id,
        "github",
        42,
        &failing,
        CLOCK_MS,
    )
    .expect("cached detail should still return");

    assert_eq!(result.detail_status, "cached");
    assert_eq!(read_snapshot(&connection, project_id, 42), snapshot);
    let listed = super::list_project_change_requests(&connection, project_id, "open", "yujianjia")
        .expect("list_project_change_requests");
    assert_eq!(row_numbers(&listed), vec![42]);
}

#[test]
fn detail_fetch_failure_without_snapshot_is_unavailable() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = FixedForge::new(Vec::new()).with_change_requests(vec![change_request(42)]);
    super::sync_project_change_requests(&connection, project_id, &forge, CLOCK_MS)
        .expect("sync_project_change_requests");

    let failing = FixedForge::new(Vec::new()).with_detail_error(ForgeIssueError::Offline);
    let result = super::get_project_change_request(
        &connection,
        project_id,
        "github",
        42,
        &failing,
        CLOCK_MS,
    )
    .expect("unavailable detail should still return");

    assert_eq!(result.detail_status, "unavailable");
    assert!(result.files.is_empty());
    assert!(result.checks.is_empty());
    assert!(result.reviews.is_empty());
    assert!(result.comments.is_empty());
    assert_eq!(result.url, "https://github.com/acme/redwhisk/pull/42");
    assert_eq!(result.detail_error.as_deref(), Some("offline"));
    let listed = super::list_project_change_requests(&connection, project_id, "open", "yujianjia")
        .expect("list_project_change_requests");
    assert_eq!(row_numbers(&listed), vec![42]);
}

#[test]
fn get_project_change_request_rejects_missing_row_as_not_found() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = FixedForge::new(Vec::new());
    let error =
        super::get_project_change_request(&connection, project_id, "github", 99, &forge, CLOCK_MS)
            .expect_err("get_project_change_request");
    assert_eq!(error.code, CommandErrorCode::IssueNotFound);
    assert_eq!(error.reason.as_deref(), Some("changeRequestNotFound"));
}

#[test]
fn get_project_change_request_rejects_invalid_provider_and_number() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = FixedForge::new(Vec::new());
    let empty =
        super::get_project_change_request(&connection, project_id, "", 42, &forge, CLOCK_MS)
            .expect_err("get_project_change_request");
    assert_eq!(empty.code, CommandErrorCode::ProjectValidationFailed);
    assert_eq!(empty.reason.as_deref(), Some("changeRequestDetailInvalid"));

    let numbered =
        super::get_project_change_request(&connection, project_id, "github", 0, &forge, CLOCK_MS)
            .expect_err("get_project_change_request");
    assert_eq!(numbered.code, CommandErrorCode::ProjectValidationFailed);
    assert_eq!(
        numbered.reason.as_deref(),
        Some("changeRequestDetailInvalid")
    );
}

#[test]
fn get_project_change_request_rejects_missing_project() {
    let connection = open_memory();
    let forge = FixedForge::new(Vec::new());
    let error = super::get_project_change_request(&connection, 404, "github", 42, &forge, CLOCK_MS)
        .expect_err("get_project_change_request");
    assert_eq!(error.code, CommandErrorCode::ProjectNotFound);
    assert_eq!(error.message, "Project not found.");
}

#[test]
fn github_and_gitlab_fixtures_cover_tabs_and_optional_gaps() {
    let connection = open_memory();
    let github_project = insert_remote_project(&connection);
    let github_details =
        super::parse_github_change_request_details(GITHUB_DETAIL).expect("github fixture");
    let github = FixedForge::new(Vec::new())
        .with_change_requests(vec![change_request(132)])
        .with_details(github_details);
    super::sync_project_change_requests(&connection, github_project, &github, CLOCK_MS)
        .expect("sync github");
    let github_detail = super::get_project_change_request(
        &connection,
        github_project,
        "github",
        132,
        &github,
        CLOCK_MS,
    )
    .expect("github detail");
    assert_eq!(github_detail.detail_status, "fresh");
    assert_eq!(github_detail.files.len(), 2);
    assert_eq!(github_detail.files[0].patch_status, "ready");
    assert_eq!(github_detail.files[1].patch_status, "too_large");
    assert_eq!(
        github_detail
            .checks
            .iter()
            .map(|check| check.name.as_str())
            .collect::<Vec<_>>(),
        vec!["test", "e2e", "lint"]
    );
    assert_eq!(github_detail.reviews.len(), 1);
    assert_eq!(github_detail.comments.len(), 1);
    assert_eq!(github_detail.blocking_reasons, vec!["Review required"]);
    assert_eq!(github_detail.commit_count, Some(2));
    assert_eq!(github_detail.labels, vec!["enhancement".to_string()]);

    let github_missing =
        super::parse_github_change_request_details(GITHUB_DETAIL_MISSING).expect("github missing");
    assert_eq!(github_missing.commit_count, None);
    assert!(github_missing.labels.is_empty());
    assert!(github_missing.reviewers.is_empty());

    let gitlab_project = insert_gitlab_project(&connection);
    let gitlab_details =
        super::parse_gitlab_change_request_details(GITLAB_DETAIL).expect("gitlab fixture");
    let gitlab = FixedForge::new(Vec::new())
        .with_change_requests(vec![gitlab_request(7)])
        .with_details(gitlab_details);
    super::sync_project_change_requests(&connection, gitlab_project, &gitlab, CLOCK_MS)
        .expect("sync gitlab");
    let gitlab_detail = super::get_project_change_request(
        &connection,
        gitlab_project,
        "gitlab",
        7,
        &gitlab,
        CLOCK_MS,
    )
    .expect("gitlab detail");
    assert_eq!(gitlab_detail.files.len(), 1);
    assert_eq!(gitlab_detail.checks.len(), 1);
    assert_eq!(gitlab_detail.reviews.len(), 1);
    assert_eq!(gitlab_detail.comments.len(), 1);
    let gitlab_missing =
        super::parse_gitlab_change_request_details(GITLAB_DETAIL_MISSING).expect("gitlab missing");
    assert_eq!(gitlab_missing.commit_count, None);
    assert!(gitlab_missing.labels.is_empty());
    assert!(gitlab_missing.reviewers.is_empty());
}

fn gitlab_request(number: i64) -> RemoteChangeRequest {
    let mut request = change_request(number);
    request.url = format!("https://gitlab.com/acme/redwhisk/-/merge_requests/{number}");
    request
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

const GITHUB_DETAIL: &str = r#"{
  "number": 132,
  "title": "Remote issue sync",
  "body": "Sync issues from GitHub.",
  "state": "OPEN",
  "url": "https://github.com/acme/redwhisk/pull/132",
  "author": {"login": "lin"},
  "headRefName": "feat/remote-issue",
  "baseRefName": "main",
  "commits": [{"oid": "aaa"}, {"oid": "bbb"}],
  "additions": 412,
  "deletions": 87,
  "labels": [{"name": "enhancement"}],
  "reviewers": [{"login": "maya", "state": "approved"}],
  "blockingReasons": ["Review required"],
  "files": [
    {"path": "src/lib.rs", "additions": 4, "deletions": 1, "patch": "+ok", "patchStatus": "ready"},
    {"path": "big.bin", "additions": 0, "deletions": 0, "patchStatus": "too_large"}
  ],
  "checks": [
    {"name": "test", "status": "failed", "durationMs": 134000, "logUrl": "https://example.test/test"},
    {"name": "e2e", "status": "pending", "durationMs": 80000, "logUrl": "https://example.test/e2e"},
    {"name": "lint", "status": "passed", "durationMs": 12000, "logUrl": "https://example.test/lint"}
  ],
  "reviews": [
    {"author": {"login": "maya"}, "state": "APPROVED", "body": "Looks good", "submittedAt": "2026-11-07T13:00:00Z"}
  ],
  "comments": [
    {"author": {"login": "lin"}, "body": "Will follow up", "createdAt": "2026-11-07T13:10:00Z"}
  ]
}"#;

const GITHUB_DETAIL_MISSING: &str = r#"{
  "number": 8,
  "title": "Sparse",
  "body": "",
  "state": "OPEN",
  "url": "https://github.com/acme/redwhisk/pull/8",
  "headRefName": "feat/sparse",
  "baseRefName": "main",
  "files": [],
  "checks": [],
  "reviews": [],
  "comments": []
}"#;

const GITLAB_DETAIL: &str = r#"{
  "iid": 7,
  "title": "Remote issue sync",
  "description": "Sync issues from GitLab.",
  "state": "opened",
  "web_url": "https://gitlab.com/acme/redwhisk/-/merge_requests/7",
  "author": {"username": "lin"},
  "source_branch": "feat/remote-issue",
  "target_branch": "main",
  "commits_count": 2,
  "labels": ["enhancement"],
  "reviewers": [{"username": "maya", "state": "approved"}],
  "blockingReasons": ["Review required"],
  "files": [
    {"path": "src/lib.rs", "additions": 4, "deletions": 1, "diff": "+ok", "patchStatus": "ready"}
  ],
  "checks": [
    {"name": "test", "status": "failed", "durationMs": 1000, "logUrl": "https://example.test/gl-test"}
  ],
  "reviews": [
    {"author": {"username": "maya"}, "state": "approved", "body": "ok", "created_at": "2026-11-07T13:00:00Z"}
  ],
  "notes": [
    {"author": {"username": "lin"}, "body": "note", "created_at": "2026-11-07T13:10:00Z"}
  ]
}"#;

const GITLAB_DETAIL_MISSING: &str = r#"{
  "iid": 9,
  "title": "Sparse",
  "description": "",
  "state": "opened",
  "web_url": "https://gitlab.com/acme/redwhisk/-/merge_requests/9",
  "source_branch": "feat/sparse",
  "target_branch": "main"
}"#;

fn existing_snapshot() -> StoredSnapshot {
    StoredSnapshot {
        files_json: r#"{"files":[{"path":"src/lib.rs","additions":1,"deletions":0,"patch":"keep","patchStatus":"ready"}],"labels":["keep"],"commitCount":2,"additions":1,"deletions":0,"blockingReasons":["Review required"],"reviewers":[{"login":"alice","state":"approved"}]}"#.to_string(),
        checks_json: r#"[{"name":"ci","status":"success","durationMs":12,"logUrl":"https://example.test/ci"}]"#.to_string(),
        reviews_json: r#"[{"author":"alice","kind":"review","body":"lgtm","createdAt":1,"state":"approved"}]"#.to_string(),
        comments_json: r#"[{"author":"bob","kind":"comment","body":"note","createdAt":2,"state":null}]"#.to_string(),
    }
}

fn write_snapshot(
    connection: &Connection,
    project_id: i64,
    number: i64,
    snapshot: &StoredSnapshot,
) {
    let change_request_id: i64 = connection
        .query_row(
            "SELECT id FROM change_requests WHERE project_id = ?1 AND number = ?2",
            params![project_id, number],
            |row| row.get(0),
        )
        .expect("change request id");
    connection
        .execute(
            "UPDATE change_request_details
             SET files_json = ?1, checks_json = ?2, reviews_json = ?3, comments_json = ?4
             WHERE change_request_id = ?5",
            params![
                snapshot.files_json,
                snapshot.checks_json,
                snapshot.reviews_json,
                snapshot.comments_json,
                change_request_id,
            ],
        )
        .expect("write snapshot");
    connection
        .execute(
            "UPDATE change_requests SET detail_synced_at = ?1 WHERE id = ?2",
            params![CLOCK_MS, change_request_id],
        )
        .expect("mark snapshot");
}

fn read_snapshot(connection: &Connection, project_id: i64, number: i64) -> StoredSnapshot {
    connection
        .query_row(
            "SELECT details.files_json, details.checks_json, details.reviews_json, details.comments_json
             FROM change_request_details details
             JOIN change_requests requests ON requests.id = details.change_request_id
             WHERE requests.project_id = ?1 AND requests.number = ?2",
            params![project_id, number],
            |row| {
                Ok(StoredSnapshot {
                    files_json: row.get(0)?,
                    checks_json: row.get(1)?,
                    reviews_json: row.get(2)?,
                    comments_json: row.get(3)?,
                })
            },
        )
        .expect("read snapshot")
}

#[derive(Debug, PartialEq, Eq)]
struct StoredSnapshot {
    files_json: String,
    checks_json: String,
    reviews_json: String,
    comments_json: String,
}

fn change_request(number: i64) -> RemoteChangeRequest {
    RemoteChangeRequest {
        external_id: format!("pr-{number}"),
        number,
        title: format!("Change {number}"),
        body: String::new(),
        state: "open".to_string(),
        url: format!("https://github.com/acme/redwhisk/pull/{number}"),
        author_login: Some("lin".to_string()),
        source_branch: "feat/window".to_string(),
        target_branch: "main".to_string(),
        updated_at: CLOCK_MS,
    }
}

fn row_numbers(response: &crate::types::change_request::ChangeRequestListResponse) -> Vec<i64> {
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
