use rusqlite::{params, Connection};

use crate::db::migrations::MigrationRunner;
use crate::features::issue::{
    FixedForge, ForgeIssueError, RemoteChangeRequest, RemoteChangeRequestDetails,
};
use crate::types::change_request::ChangeRequestReviewer;

const CLOCK_MS: i64 = 1_794_063_600_000;

#[test]
fn mark_ready_on_draft_returns_open_detail() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let opened = RemoteChangeRequestDetails {
        title: "Ready window".to_string(),
        state: "open".to_string(),
        url: "https://github.com/acme/redwhisk/pull/7".to_string(),
        source_branch: "feat/window".to_string(),
        target_branch: "main".to_string(),
        ..RemoteChangeRequestDetails::default()
    };
    let forge = FixedForge::new(Vec::new())
        .with_change_requests(vec![change_request(7, "draft")])
        .with_action_details(opened);
    super::sync_project_change_requests(&connection, project_id, &forge, CLOCK_MS)
        .expect("sync draft");

    let before =
        super::get_project_change_request(&connection, project_id, "github", 7, &forge, CLOCK_MS)
            .expect("draft detail");
    assert_eq!(before.state, "draft");

    let after =
        super::mark_change_request_ready(&connection, project_id, "github", 7, &forge, CLOCK_MS)
            .expect("marked ready");

    assert_eq!(forge.ready_calls(), vec![7]);
    assert_eq!(after.state, "open");
    assert_eq!(after.title, "Ready window");
    assert!(after.ready_supported);
}

#[test]
fn mark_ready_on_open_returns_not_draft_without_calling_host() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = FixedForge::new(Vec::new())
        .with_change_requests(vec![change_request(7, "open")])
        .with_action_details(opened_details());
    super::sync_project_change_requests(&connection, project_id, &forge, CLOCK_MS)
        .expect("sync open");

    let error =
        super::mark_change_request_ready(&connection, project_id, "github", 7, &forge, CLOCK_MS)
            .expect_err("mark_change_request_ready");

    assert_eq!(error.reason.as_deref(), Some("changeRequestNotDraft"));
    assert_eq!(forge.ready_calls(), Vec::<i64>::new());
    let detail =
        super::get_project_change_request(&connection, project_id, "github", 7, &forge, CLOCK_MS)
            .expect("detail stays open");
    assert_eq!(detail.state, "open");
}

#[test]
fn mark_ready_when_host_does_not_support_it_keeps_draft() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = FixedForge::new(Vec::new())
        .with_change_requests(vec![change_request(7, "draft")])
        .without_ready_support();
    super::sync_project_change_requests(&connection, project_id, &forge, CLOCK_MS)
        .expect("sync draft");

    let error =
        super::mark_change_request_ready(&connection, project_id, "github", 7, &forge, CLOCK_MS)
            .expect_err("mark_change_request_ready");

    assert_eq!(
        error.reason.as_deref(),
        Some("changeRequestReadyUnsupported")
    );
    assert_eq!(forge.ready_calls(), Vec::<i64>::new());
    assert_eq!(stored_state(&connection, project_id, &forge), "draft");
    assert!(!stored_detail(&connection, project_id, &forge).ready_supported);
}

#[test]
fn mark_ready_keeps_draft_for_each_host_failure() {
    for (error, reason) in [
        (ForgeIssueError::Unauthenticated, "credentialExpired"),
        (ForgeIssueError::Forbidden, "writeForbidden"),
        (ForgeIssueError::RateLimited, "rateLimited"),
        (ForgeIssueError::NotFound, "changeRequestNotFound"),
        (ForgeIssueError::CliMissing, "forgeCliMissing"),
        (ForgeIssueError::Offline, "forgeOffline"),
    ] {
        let connection = open_memory();
        let project_id = insert_remote_project(&connection);
        let forge = FixedForge::new(Vec::new())
            .with_change_requests(vec![change_request(7, "draft")])
            .with_action_error(error);
        super::sync_project_change_requests(&connection, project_id, &forge, CLOCK_MS)
            .expect("sync draft");

        let failure = super::mark_change_request_ready(
            &connection,
            project_id,
            "github",
            7,
            &forge,
            CLOCK_MS,
        )
        .expect_err("mark_change_request_ready");

        assert_eq!(failure.reason.as_deref(), Some(reason));
        assert_eq!(forge.ready_calls(), vec![7]);
        assert_eq!(stored_state(&connection, project_id, &forge), "draft");
    }
}

#[test]
fn request_review_rejects_blank_reviewer_without_calling_host() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = synced_with_maya(&connection, project_id);

    let error = super::request_change_request_review(
        &connection,
        project_id,
        "github",
        7,
        "  ",
        &forge,
        CLOCK_MS,
    )
    .expect_err("request_change_request_review");

    assert_eq!(
        error.reason.as_deref(),
        Some("changeRequestReviewerMissing")
    );
    assert_eq!(forge.review_calls(), Vec::<(i64, String)>::new());
    assert_eq!(
        reviewer_logins(&connection, project_id, &forge),
        vec!["maya"]
    );
}

#[test]
fn request_review_for_lin_returns_lin_in_the_reviewer_list() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = synced_with_maya(&connection, project_id).with_action_details(reviewed_details());

    let detail = super::request_change_request_review(
        &connection,
        project_id,
        "github",
        7,
        "lin",
        &forge,
        CLOCK_MS,
    )
    .expect("review requested");

    assert_eq!(forge.review_calls(), vec![(7, "lin".to_string())]);
    assert!(detail
        .reviewers
        .iter()
        .any(|reviewer| reviewer.login == "lin"));
}

#[test]
fn request_review_when_unsupported_does_not_invent_a_reviewer() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = synced_with_maya(&connection, project_id).without_review_support();

    let error = super::request_change_request_review(
        &connection,
        project_id,
        "github",
        7,
        "lin",
        &forge,
        CLOCK_MS,
    )
    .expect_err("request_change_request_review");

    assert_eq!(
        error.reason.as_deref(),
        Some("changeRequestReviewUnsupported")
    );
    assert_eq!(forge.review_calls(), Vec::<(i64, String)>::new());
    assert_eq!(
        reviewer_logins(&connection, project_id, &forge),
        vec!["maya"]
    );
    assert!(!stored_detail(&connection, project_id, &forge).review_supported);
}

#[test]
fn request_review_keeps_reviewers_for_each_host_failure() {
    for (error, reason) in host_failures() {
        let connection = open_memory();
        let project_id = insert_remote_project(&connection);
        let forge = synced_with_maya(&connection, project_id).with_action_error(error);

        let failure = super::request_change_request_review(
            &connection,
            project_id,
            "github",
            7,
            "lin",
            &forge,
            CLOCK_MS,
        )
        .expect_err("request_change_request_review");

        assert_eq!(failure.reason.as_deref(), Some(reason));
        assert_eq!(forge.review_calls(), vec![(7, "lin".to_string())]);
        assert_eq!(
            reviewer_logins(&connection, project_id, &forge),
            vec!["maya"]
        );
    }
}

#[test]
fn close_open_request_returns_closed_not_merged() {
    let connection = open_memory();
    let project_id = insert_remote_project(&connection);
    let forge = synced_open(&connection, project_id).with_action_details(closed_details());

    let detail =
        super::close_change_request(&connection, project_id, "github", 7, &forge, CLOCK_MS)
            .expect("closed");

    assert_eq!(forge.close_calls(), vec![7]);
    assert_eq!(detail.state, "closed");
    assert_ne!(detail.state, "merged");
}

#[test]
fn close_when_not_open_does_not_call_host() {
    for state in ["merged", "draft", "closed"] {
        let connection = open_memory();
        let project_id = insert_remote_project(&connection);
        let forge = synced_state(&connection, project_id, state);

        let error =
            super::close_change_request(&connection, project_id, "github", 7, &forge, CLOCK_MS)
                .expect_err("close_change_request");

        assert_eq!(error.reason.as_deref(), Some("changeRequestNotOpen"));
        assert_eq!(forge.close_calls(), Vec::<i64>::new());
        assert_eq!(stored_state(&connection, project_id, &forge), state);
    }
}

#[test]
fn close_keeps_open_for_each_host_failure() {
    for (error, reason) in host_failures() {
        let connection = open_memory();
        let project_id = insert_remote_project(&connection);
        let forge = synced_open(&connection, project_id).with_action_error(error);

        let failure =
            super::close_change_request(&connection, project_id, "github", 7, &forge, CLOCK_MS)
                .expect_err("close_change_request");

        assert_eq!(failure.reason.as_deref(), Some(reason));
        assert_eq!(forge.close_calls(), vec![7]);
        assert_eq!(stored_state(&connection, project_id, &forge), "open");
    }
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

fn synced_open(connection: &Connection, project_id: i64) -> FixedForge {
    synced_state(connection, project_id, "open")
}

fn synced_state(connection: &Connection, project_id: i64, state: &str) -> FixedForge {
    let forge = FixedForge::new(Vec::new()).with_change_requests(vec![change_request(7, state)]);
    super::sync_project_change_requests(connection, project_id, &forge, CLOCK_MS).expect("sync");
    forge
}

fn closed_details() -> RemoteChangeRequestDetails {
    RemoteChangeRequestDetails {
        title: "Window".to_string(),
        state: "closed".to_string(),
        url: "https://github.com/acme/redwhisk/pull/7".to_string(),
        source_branch: "feat/window".to_string(),
        target_branch: "main".to_string(),
        ..RemoteChangeRequestDetails::default()
    }
}

fn synced_with_maya(connection: &Connection, project_id: i64) -> FixedForge {
    let forge = FixedForge::new(Vec::new())
        .with_change_requests(vec![change_request(7, "open")])
        .with_details(maya_details());
    super::sync_project_change_requests(connection, project_id, &forge, CLOCK_MS)
        .expect("sync open");
    forge
}

fn reviewer_logins(connection: &Connection, project_id: i64, forge: &FixedForge) -> Vec<String> {
    super::get_project_change_request(connection, project_id, "github", 7, forge, CLOCK_MS)
        .expect("detail")
        .reviewers
        .into_iter()
        .map(|reviewer| reviewer.login)
        .collect()
}

fn maya_details() -> RemoteChangeRequestDetails {
    RemoteChangeRequestDetails {
        title: "Window".to_string(),
        state: "open".to_string(),
        url: "https://github.com/acme/redwhisk/pull/7".to_string(),
        source_branch: "feat/window".to_string(),
        target_branch: "main".to_string(),
        reviewers: vec![reviewer("maya")],
        ..RemoteChangeRequestDetails::default()
    }
}

fn reviewed_details() -> RemoteChangeRequestDetails {
    let mut details = maya_details();
    details.reviewers.push(reviewer("lin"));
    details
}

fn reviewer(login: &str) -> ChangeRequestReviewer {
    ChangeRequestReviewer {
        login: login.to_string(),
        state: Some("requested".to_string()),
    }
}

fn host_failures() -> [(ForgeIssueError, &'static str); 6] {
    [
        (ForgeIssueError::Unauthenticated, "credentialExpired"),
        (ForgeIssueError::Forbidden, "writeForbidden"),
        (ForgeIssueError::RateLimited, "rateLimited"),
        (ForgeIssueError::NotFound, "changeRequestNotFound"),
        (ForgeIssueError::CliMissing, "forgeCliMissing"),
        (ForgeIssueError::Offline, "forgeOffline"),
    ]
}

fn stored_state(connection: &Connection, project_id: i64, forge: &FixedForge) -> String {
    stored_detail(connection, project_id, forge).state
}

fn stored_detail(
    connection: &Connection,
    project_id: i64,
    forge: &FixedForge,
) -> crate::types::change_request::ChangeRequestDetail {
    super::get_project_change_request(connection, project_id, "github", 7, forge, CLOCK_MS)
        .expect("detail")
}

fn opened_details() -> RemoteChangeRequestDetails {
    RemoteChangeRequestDetails {
        title: "Ready window".to_string(),
        state: "open".to_string(),
        url: "https://github.com/acme/redwhisk/pull/7".to_string(),
        source_branch: "feat/window".to_string(),
        target_branch: "main".to_string(),
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
