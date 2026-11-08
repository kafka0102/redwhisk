use rusqlite::{params, Connection};

use crate::db::migrations::MigrationRunner;
use crate::features::issue::{FixedForge, RemoteChangeRequest, RemoteChangeRequestDetails};

const CLOCK_MS: i64 = 1_794_063_600_000;

#[test]
fn merge_rejects_null_mergeable_without_calling_host() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = FixedForge::new(Vec::new())
        .with_change_requests(vec![change_request(7, "open")])
        .with_details(open_details(None, Vec::new()));
    super::sync_project_change_requests(&connection, project_id, &forge, CLOCK_MS).expect("sync");

    let error = super::merge_change_request(
        &connection,
        project_id,
        "github",
        7,
        "squash",
        true,
        &forge,
        CLOCK_MS,
    )
    .expect_err("merge_change_request");

    assert_eq!(error.reason.as_deref(), Some("changeRequestNotMergeable"));
    assert_eq!(forge.merge_calls().len(), 0);
}

#[test]
fn merge_rejects_conflict_without_calling_host() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = synced_details(&connection, project_id, Some("CONFLICTING"), Vec::new());

    let error =
        merge(&connection, project_id, &forge, "squash", true).expect_err("merge_change_request");

    assert_eq!(error.reason.as_deref(), Some("changeRequestNotMergeable"));
    assert_eq!(forge.merge_calls().len(), 0);
    assert_eq!(stored_state(&connection, project_id, &forge), "open");
}

#[test]
fn merge_rejects_failed_check_without_calling_host() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = synced_details(
        &connection,
        project_id,
        Some("MERGEABLE"),
        vec!["test (ubuntu-latest) failed".to_string()],
    );

    let error =
        merge(&connection, project_id, &forge, "squash", true).expect_err("merge_change_request");

    assert_eq!(error.reason.as_deref(), Some("changeRequestNotMergeable"));
    assert_eq!(forge.merge_calls().len(), 0);
}

#[test]
fn merge_rejects_missing_approval_without_calling_host() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = synced_details(
        &connection,
        project_id,
        Some("MERGEABLE"),
        vec!["1 approval required".to_string()],
    );

    let error =
        merge(&connection, project_id, &forge, "squash", true).expect_err("merge_change_request");

    assert_eq!(error.reason.as_deref(), Some("changeRequestNotMergeable"));
    assert_eq!(forge.merge_calls().len(), 0);
}

#[test]
fn merge_rejects_unknown_and_blank_mergeable_without_calling_host() {
    for mergeable in ["", "UNKNOWN"] {
        let connection = open_memory();
        let project_id = insert_remote_project(&connection);
        let forge = synced_details(&connection, project_id, Some(mergeable), Vec::new());

        let error = merge(&connection, project_id, &forge, "squash", true)
            .expect_err("merge_change_request");

        assert_eq!(error.reason.as_deref(), Some("changeRequestNotMergeable"));
        assert_eq!(forge.merge_calls().len(), 0);
    }
}

#[test]
fn merge_squash_deleting_source_branch_returns_merged_detail() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = synced_details(&connection, project_id, Some("MERGEABLE"), Vec::new())
        .with_action_details(merged_details());

    let detail = merge(&connection, project_id, &forge, "squash", true).expect("merged");

    assert_eq!(forge.merge_calls(), vec![(7, "squash".to_string(), true)]);
    assert_eq!(detail.state, "merged");
    assert_eq!(detail.merge_method.as_deref(), Some("squash"));
    assert_eq!(detail.merge_commit_sha.as_deref(), Some("9f3c2a1"));
    assert_eq!(detail.source_branch_deleted, Some(true));
    let recorded = format!("{:?}", forge.merge_calls());
    assert!(!recorded.contains("admin"));
    assert!(!recorded.contains("auto"));
    assert!(!recorded.contains("force"));
}

#[test]
fn merge_squash_keeps_method_when_host_refresh_omits_it() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let mut refreshed = merged_details();
    refreshed.merge_method = None;
    let forge = synced_details(&connection, project_id, Some("MERGEABLE"), Vec::new())
        .with_action_details(refreshed);

    let detail = merge(&connection, project_id, &forge, "squash", true).expect("merged");

    assert_eq!(detail.state, "merged");
    assert_eq!(detail.merge_method.as_deref(), Some("squash"));
}

#[test]
fn merge_without_deleting_source_branch_omits_delete() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = synced_details(&connection, project_id, Some("MERGEABLE"), Vec::new())
        .with_action_details(merged_details());

    let detail = merge(&connection, project_id, &forge, "squash", false).expect("merged");

    assert_eq!(forge.merge_calls(), vec![(7, "squash".to_string(), false)]);
    assert_eq!(detail.state, "merged");
}

#[test]
fn merge_rejects_unsupported_method_without_calling_host() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = synced_details(&connection, project_id, Some("MERGEABLE"), Vec::new())
        .without_merge_method("rebase");

    let error =
        merge(&connection, project_id, &forge, "rebase", true).expect_err("merge_change_request");

    assert_eq!(
        error.reason.as_deref(),
        Some("changeRequestMergeMethodUnsupported")
    );
    assert_eq!(forge.merge_calls().len(), 0);
    assert_eq!(persisted_state(&connection), "open");
}

#[test]
fn merge_host_failure_keeps_local_state_open() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = synced_details(&connection, project_id, Some("MERGEABLE"), Vec::new())
        .with_action_error(crate::features::issue::ForgeIssueError::CommandFailed);

    let error =
        merge(&connection, project_id, &forge, "squash", true).expect_err("merge_change_request");

    assert_eq!(error.reason.as_deref(), Some("changeRequestActionFailed"));
    assert_eq!(forge.merge_calls().len(), 1);
    assert_eq!(persisted_state(&connection), "open");
}

#[test]
fn merge_gitlab_mergeable_calls_host_once() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = synced_details(&connection, project_id, Some("mergeable"), Vec::new())
        .with_action_details(merged_details());
    connection
        .execute(
            "UPDATE change_requests SET provider = 'gitlab' WHERE number = 7",
            [],
        )
        .expect("retag");

    let detail = super::merge_change_request(
        &connection,
        project_id,
        "gitlab",
        7,
        "squash",
        true,
        &forge,
        CLOCK_MS,
    )
    .expect("merged");

    assert_eq!(forge.merge_calls(), vec![(7, "squash".to_string(), true)]);
    assert_eq!(detail.state, "merged");
}

#[test]
fn gitlab_detailed_merge_status_mergeable_enables_merge() {
    let details = super::parse_gitlab_change_request_details(
        r#"{
            "title": "Window",
            "description": "",
            "state": "opened",
            "web_url": "https://gitlab.com/acme/redwhisk/-/merge_requests/7",
            "source_branch": "feat/window",
            "target_branch": "main",
            "detailed_merge_status": "mergeable",
            "merge_status": "cannot_be_merged"
        }"#,
    )
    .expect("gitlab detail");

    assert_eq!(details.mergeable.as_deref(), Some("mergeable"));
    assert_ne!(details.mergeable.as_deref(), Some("can_be_merged"));
    assert_ne!(details.mergeable.as_deref(), Some("cannot_be_merged"));
}

fn change_request(number: i64, state: &str) -> RemoteChangeRequest {
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
        updated_at: CLOCK_MS,
    }
}

fn synced_details(
    connection: &Connection,
    project_id: i64,
    mergeable: Option<&str>,
    blocking_reasons: Vec<String>,
) -> FixedForge {
    let forge = FixedForge::new(Vec::new())
        .with_change_requests(vec![change_request(7, "open")])
        .with_details(open_details(mergeable, blocking_reasons));
    super::sync_project_change_requests(connection, project_id, &forge, CLOCK_MS).expect("sync");
    forge
}

fn merge(
    connection: &Connection,
    project_id: i64,
    forge: &FixedForge,
    method: &str,
    delete_source_branch: bool,
) -> Result<crate::types::change_request::ChangeRequestDetail, crate::types::errors::CommandError> {
    super::merge_change_request(
        connection,
        project_id,
        "github",
        7,
        method,
        delete_source_branch,
        forge,
        CLOCK_MS,
    )
}

fn stored_state(connection: &Connection, project_id: i64, forge: &FixedForge) -> String {
    super::get_project_change_request(connection, project_id, "github", 7, forge, CLOCK_MS)
        .expect("detail")
        .state
}

fn merged_details() -> RemoteChangeRequestDetails {
    RemoteChangeRequestDetails {
        title: "Window".to_string(),
        state: "merged".to_string(),
        url: "https://github.com/acme/redwhisk/pull/7".to_string(),
        source_branch: "feat/window".to_string(),
        target_branch: "main".to_string(),
        merge_method: Some("squash".to_string()),
        merge_commit_sha: Some("9f3c2a1".to_string()),
        source_branch_deleted: Some(true),
        ..RemoteChangeRequestDetails::default()
    }
}

fn persisted_state(connection: &Connection) -> String {
    connection
        .query_row(
            "SELECT state FROM change_requests WHERE number = 7",
            [],
            |row| row.get(0),
        )
        .expect("state")
}

fn open_details(
    mergeable: Option<&str>,
    blocking_reasons: Vec<String>,
) -> RemoteChangeRequestDetails {
    RemoteChangeRequestDetails {
        title: "Window".to_string(),
        state: "open".to_string(),
        url: "https://github.com/acme/redwhisk/pull/7".to_string(),
        source_branch: "feat/window".to_string(),
        target_branch: "main".to_string(),
        mergeable: mergeable.map(str::to_string),
        blocking_reasons,
        ..RemoteChangeRequestDetails::default()
    }
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
