use rusqlite::{params, Connection};

use crate::db::migrations::MigrationRunner;
use crate::features::issue::{FixedForge, RemoteChangeRequest};
use crate::types::errors::CommandErrorCode;

const CLOCK_MS: i64 = 1_794_063_600_000;

#[test]
fn closing_keyword_links_github_issue_and_plain_mention_does_not() {
    let connection = open_linked_project();
    let project_id = project_id(&connection);
    let github_issue = insert_issue(&connection, project_id, 128, "remote", "backlog");
    insert_external_ref(&connection, github_issue, project_id, "github", 128);
    sync_requests(
        &connection,
        project_id,
        vec![
            request(132, "Closes #128", "feat/remote-issue"),
            request(140, "please see #128", "feat/mention"),
        ],
    );

    let listed = super::list_project_change_requests(&connection, project_id, "open", "")
        .expect("list_project_change_requests");
    let row_132 = listed.rows.iter().find(|row| row.number == 132).unwrap();
    let row_140 = listed.rows.iter().find(|row| row.number == 140).unwrap();
    assert_eq!(row_132.linked_issues[0].label, "#128 · issue");
    assert_eq!(row_132.linked_issues[0].link_kind, "closing");
    assert!(row_140.linked_issues.is_empty());
    assert_eq!(issue_status(&connection, github_issue), "backlog");
}

#[test]
fn issue_branch_links_local_issue_and_plain_branch_does_not() {
    let connection = open_linked_project();
    let project_id = project_id(&connection);
    let local_issue = insert_issue(&connection, project_id, 12, "local", "backlog");
    sync_requests(
        &connection,
        project_id,
        vec![
            request(128, "", "issue-12-redwhisk"),
            request(141, "", "feat/issue"),
        ],
    );

    let listed = super::list_project_change_requests(&connection, project_id, "open", "")
        .expect("list_project_change_requests");
    let row_128 = listed.rows.iter().find(|row| row.number == 128).unwrap();
    let row_141 = listed.rows.iter().find(|row| row.number == 141).unwrap();
    assert_eq!(row_128.linked_issues[0].label, "#12 · issue");
    assert_eq!(row_128.linked_issues[0].link_kind, "branch");
    assert!(row_141.linked_issues.is_empty());
    assert_eq!(issue_status(&connection, local_issue), "backlog");
}

#[test]
fn manual_link_twice_keeps_one_manual_row() {
    let connection = open_linked_project();
    let project_id = project_id(&connection);
    let local_issue = insert_issue(&connection, project_id, 12, "local", "backlog");
    sync_requests(
        &connection,
        project_id,
        vec![request(132, "", "feat/manual")],
    );
    let change_request_id = listed_id(&connection, project_id, 132);
    super::link_change_request_issue(
        &connection,
        project_id,
        change_request_id,
        local_issue,
        CLOCK_MS,
    )
    .expect("link_change_request_issue");
    super::link_change_request_issue(
        &connection,
        project_id,
        change_request_id,
        local_issue,
        CLOCK_MS,
    )
    .expect("link_change_request_issue");

    let listed = super::list_project_change_requests(&connection, project_id, "open", "")
        .expect("list_project_change_requests");
    let row = listed.rows.iter().find(|row| row.number == 132).unwrap();
    assert_eq!(row.linked_issues.len(), 1);
    assert_eq!(row.linked_issues[0].label, "#12 · issue");
    assert_eq!(row.linked_issues[0].link_kind, "manual");
    assert_eq!(issue_status(&connection, local_issue), "backlog");
}

#[test]
fn one_pull_request_can_show_two_issues_and_one_issue_can_show_on_two() {
    let connection = open_linked_project();
    let project_id = project_id(&connection);
    let github_issue = insert_issue(&connection, project_id, 128, "remote", "backlog");
    insert_external_ref(&connection, github_issue, project_id, "github", 128);
    let local_issue = insert_issue(&connection, project_id, 12, "local", "backlog");
    sync_requests(
        &connection,
        project_id,
        vec![
            request(132, "Closes #128", "issue-12-redwhisk"),
            request(129, "", "issue-12-other"),
        ],
    );

    let listed = super::list_project_change_requests(&connection, project_id, "open", "")
        .expect("list_project_change_requests");
    let row_132 = listed.rows.iter().find(|row| row.number == 132).unwrap();
    let row_129 = listed.rows.iter().find(|row| row.number == 129).unwrap();
    assert_eq!(
        row_132
            .linked_issues
            .iter()
            .map(|link| link.label.as_str())
            .collect::<Vec<_>>(),
        vec!["#12 · issue", "#128 · issue"]
    );
    assert_eq!(row_129.linked_issues[0].label, "#12 · issue");
    assert_eq!(issue_status(&connection, local_issue), "backlog");
    assert_eq!(issue_status(&connection, github_issue), "backlog");
}

#[test]
fn link_change_request_issue_rejects_missing_project() {
    let connection = open_linked_project();
    let error = super::link_change_request_issue(&connection, 404, 1, 1, CLOCK_MS)
        .expect_err("link_change_request_issue");
    assert_eq!(error.code, CommandErrorCode::ProjectNotFound);
    assert_eq!(error.message, "Project not found.");
}

#[test]
fn syncing_closed_unmerged_request_keeps_completed_issue_and_open_remote() {
    let connection = open_linked_project();
    let project_id = project_id(&connection);
    let issue_id = insert_issue(&connection, project_id, 128, "remote", "completed");
    insert_external_ref(&connection, issue_id, project_id, "github", 128);
    let mut closed = request(12, "Closes #128", "feat/closed-unmerged");
    closed.state = "closed".to_string();

    sync_requests(&connection, project_id, vec![closed]);

    assert_eq!(issue_status(&connection, issue_id), "completed");
    assert_eq!(remote_state(&connection, issue_id), "open");
}

fn open_linked_project() -> Connection {
    let connection = Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("foreign keys");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrate");
    connection
        .execute(
            "INSERT INTO projects (
                name, repo_path, created_at, last_opened_at, issue_source_mode, issue_sync_scope
             ) VALUES ('App', '/tmp/links', 1, 1, 'remote', 'all')",
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
    connection
}

fn project_id(connection: &Connection) -> i64 {
    connection
        .query_row("SELECT id FROM projects", [], |row| row.get(0))
        .expect("project")
}

fn sync_requests(connection: &Connection, project_id: i64, requests: Vec<RemoteChangeRequest>) {
    let forge = FixedForge::new(Vec::new()).with_change_requests(requests);
    super::sync_project_change_requests(connection, project_id, &forge, CLOCK_MS)
        .expect("sync_project_change_requests");
}

fn request(number: i64, body: &str, branch: &str) -> RemoteChangeRequest {
    RemoteChangeRequest {
        external_id: format!("pr-{number}"),
        number,
        title: format!("Change {number}"),
        body: body.to_string(),
        state: "open".to_string(),
        url: format!("https://github.com/acme/redwhisk/pull/{number}"),
        author_login: Some("lin".to_string()),
        source_branch: branch.to_string(),
        target_branch: "main".to_string(),
        updated_at: CLOCK_MS,
    }
}

fn listed_id(connection: &Connection, project_id: i64, number: i64) -> i64 {
    super::list_project_change_requests(connection, project_id, "open", "")
        .expect("list")
        .rows
        .into_iter()
        .find(|row| row.number == number)
        .expect("row")
        .id
}

fn issue_status(connection: &Connection, issue_id: i64) -> String {
    connection
        .query_row(
            "SELECT status FROM issues WHERE id = ?1",
            params![issue_id],
            |row| row.get(0),
        )
        .expect("status")
}

fn remote_state(connection: &Connection, issue_id: i64) -> String {
    connection
        .query_row(
            "SELECT remote_state FROM issue_external_refs WHERE issue_id = ?1",
            params![issue_id],
            |row| row.get(0),
        )
        .expect("remote state")
}

fn insert_issue(
    connection: &Connection,
    project_id: i64,
    number: i64,
    source: &str,
    status: &str,
) -> i64 {
    connection
        .execute(
            "INSERT INTO issues (
                project_id, number, title, description, status, source, created_at, updated_at,
                status_changed_at, del
             ) VALUES (?1, ?2, 'issue', '', ?3, ?4, 10, 20, 20, 0)",
            params![project_id, number, status, source],
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
    connection
        .execute(
            "INSERT INTO issue_external_refs (
                issue_id, project_id, provider, host, repo, external_id, external_number,
                external_url, remote_state, remote_updated_at, synced_at, sync_status
             ) VALUES (
                ?1, ?2, ?3, 'github.com', 'acme/redwhisk', ?4, ?4,
                'https://github.com/acme/redwhisk/issues/' || ?4, 'open', 10, 10, 'synced'
             )",
            params![issue_id, project_id, provider, external_number],
        )
        .expect("external ref");
}
