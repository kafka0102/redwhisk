use rusqlite::params;

use super::github_issue_mirror::{
    ready_github_project, seed_remote_issue, set_auth, set_mode, sync_project_issues, FixedForge,
    ForgeIssueError, RemoteIssue,
};
use super::remote_create::create_issue_with_forge;
use super::service::IssueService;
use crate::db::issue_repository::IssueRepository;
use crate::db::project_repository::ProjectRepository;
use crate::types::errors::CommandErrorCode;
use crate::types::issue::{CreateIssueInput, UpdateIssueInput};

fn service(connection: &rusqlite::Connection) -> IssueService<'_> {
    IssueService::new(
        IssueRepository::new(connection),
        ProjectRepository::new(connection),
    )
}

fn choose_remote(connection: &rusqlite::Connection, project_id: i64) {
    connection
        .execute(
            "UPDATE projects SET issue_create_source = 'remote' WHERE id = ?1",
            params![project_id],
        )
        .expect("remote choice");
}

fn input(project_id: i64, title: &str) -> CreateIssueInput {
    CreateIssueInput {
        project_id,
        title: title.to_string(),
        description: "body".to_string(),
        attachments: Vec::new(),
        label_ids: Vec::new(),
    }
}

fn count(connection: &rusqlite::Connection, table: &str) -> i64 {
    connection
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .expect(table)
}

fn blank_remote(number: i64, url: &str) -> RemoteIssue {
    let mut issue = super::github_issue_mirror::open_issue(number, "Remote");
    issue.url = url.to_string();
    issue.external_id = format!("issue-{number}");
    issue
}

#[test]
fn remote_create_failures_leave_no_local_issue() {
    let cases = [
        (
            ForgeIssueError::Unauthenticated,
            "remoteCreateUnauthenticated",
        ),
        (ForgeIssueError::Forbidden, "remoteCreateForbidden"),
        (ForgeIssueError::Offline, "remoteCreateOffline"),
        (ForgeIssueError::Unparseable, "remoteCreateInvalid"),
    ];
    for (error, reason) in cases {
        let harness = ready_github_project("all_open", None);
        choose_remote(&harness.connection, harness.project_id);
        let forge = FixedForge::failing(error);
        let failed = create_issue_with_forge(
            &service(&harness.connection),
            input(harness.project_id, "nope"),
            &forge,
            |_| Ok(()),
        )
        .expect_err(reason);
        assert_eq!(failed.reason.as_deref(), Some(reason));
        assert_eq!(count(&harness.connection, "issues"), 0, "{reason}");
        assert_eq!(forge.create_calls.lock().expect("calls").len(), 1);
    }
}

#[test]
fn remote_create_rejects_empty_url_and_number_without_a_local_row() {
    let harness = ready_github_project("all_open", None);
    choose_remote(&harness.connection, harness.project_id);
    for issue in [
        blank_remote(128, ""),
        blank_remote(0, "https://github.com/acme/redwhisk/issues/128"),
    ] {
        let forge = FixedForge::new(Vec::new()).with_created(issue);
        let failed = create_issue_with_forge(
            &service(&harness.connection),
            input(harness.project_id, "bad"),
            &forge,
            |_| Ok(()),
        )
        .expect_err("invalid");
        assert_eq!(failed.reason.as_deref(), Some("remoteCreateInvalid"));
    }
    assert_eq!(count(&harness.connection, "issues"), 0);
}

#[test]
fn remote_create_stays_unavailable_until_the_connection_is_ready() {
    let harness = ready_github_project("all_open", None);
    choose_remote(&harness.connection, harness.project_id);
    set_auth(
        &harness.connection,
        harness.project_id,
        "github",
        "unauthenticated",
    );
    let forge = FixedForge::new(Vec::new()).with_created(blank_remote(
        128,
        "https://github.com/acme/redwhisk/issues/128",
    ));
    let failed = create_issue_with_forge(
        &service(&harness.connection),
        input(harness.project_id, "blocked"),
        &forge,
        |_| Ok(()),
    )
    .expect_err("not ready");
    assert_eq!(failed.code, CommandErrorCode::ForgeUnavailable);
    assert_eq!(failed.reason.as_deref(), Some("remoteCreateUnavailable"));
    assert_eq!(count(&harness.connection, "issues"), 0);
    assert!(forge.create_calls.lock().expect("calls").is_empty());
}

#[test]
fn local_create_does_not_call_the_forge() {
    let harness = ready_github_project("all_open", None);
    let forge = FixedForge::failing(ForgeIssueError::Offline);
    let created = create_issue_with_forge(
        &service(&harness.connection),
        input(harness.project_id, "local draft"),
        &forge,
        |_| Ok(()),
    )
    .expect("local");
    let source: String = harness
        .connection
        .query_row(
            "SELECT source FROM issues WHERE id = ?1",
            params![created.id],
            |row| row.get(0),
        )
        .expect("source");
    assert_eq!(source, "local");
    assert_eq!(count(&harness.connection, "issues"), 1);
    assert_eq!(count(&harness.connection, "issue_external_refs"), 0);
    assert!(forge.create_calls.lock().expect("calls").is_empty());
}

#[test]
fn mirror_failure_keeps_the_remote_url_and_sync_imports_once() {
    let harness = ready_github_project("all_open", None);
    choose_remote(&harness.connection, harness.project_id);
    let existing = seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "backlog",
        "issue-128",
        128,
        "open",
        false,
    );
    let remote = blank_remote(128, "https://github.com/acme/redwhisk/issues/128");
    let forge = FixedForge::new(vec![remote.clone()]).with_created(remote);
    let failed = create_issue_with_forge(
        &service(&harness.connection),
        input(harness.project_id, "again"),
        &forge,
        |_| Ok(()),
    )
    .expect_err("local transaction");
    assert_eq!(failed.reason.as_deref(), Some("remoteCreateMirrorFailed"));
    assert!(failed
        .message
        .contains("https://github.com/acme/redwhisk/issues/128"));
    assert_eq!(count(&harness.connection, "issues"), 1);
    sync_project_issues(&harness.connection, harness.project_id, &forge, 5_000).expect("sync");
    assert_eq!(count(&harness.connection, "issues"), 1);
    assert_eq!(count(&harness.connection, "issue_external_refs"), 1);
    assert_eq!(forge.create_calls.lock().expect("calls").len(), 1);
    let title: String = harness
        .connection
        .query_row(
            "SELECT title FROM issues WHERE id = ?1",
            params![existing],
            |row| row.get(0),
        )
        .expect("title");
    assert_eq!(title, "Remote");
}

#[test]
fn refresh_failure_still_keeps_the_created_mirror() {
    let harness = ready_github_project("all_open", None);
    choose_remote(&harness.connection, harness.project_id);
    let remote = blank_remote(128, "https://github.com/acme/redwhisk/issues/128");
    let forge = FixedForge::new(vec![remote.clone()]).with_created(remote);
    let created = create_issue_with_forge(
        &service(&harness.connection),
        input(harness.project_id, "kept"),
        &forge,
        |_| {
            Err(crate::types::errors::CommandError::new(
                CommandErrorCode::IssuePersistenceFailed,
                "Refresh failed.",
            ))
        },
    )
    .expect("success despite refresh");
    assert_eq!(count(&harness.connection, "issues"), 1);
    assert_eq!(forge.create_calls.lock().expect("calls").len(), 1);
    let retried = sync_project_issues(&harness.connection, harness.project_id, &forge, 6_000);
    assert!(retried.is_ok());
    assert_eq!(count(&harness.connection, "issues"), 1);
    let only_id: i64 = harness
        .connection
        .query_row("SELECT id FROM issues", [], |row| row.get(0))
        .expect("id");
    assert_eq!(created.id, only_id);
}

#[test]
fn later_edits_do_not_write_back_to_the_forge() {
    let harness = ready_github_project("all_open", None);
    choose_remote(&harness.connection, harness.project_id);
    let mut remote = blank_remote(128, "https://github.com/acme/redwhisk/issues/128");
    remote.author_login = Some("lin".to_string());
    remote.labels = vec!["sync".to_string()];
    remote.assignees = vec!["yujianjia".to_string()];
    let forge = FixedForge::new(vec![remote.clone()]).with_created(remote);
    let created = create_issue_with_forge(
        &service(&harness.connection),
        input(harness.project_id, "original"),
        &forge,
        |_| Ok(()),
    )
    .expect("create");
    service(&harness.connection)
        .update_issue(UpdateIssueInput {
            project_id: harness.project_id,
            issue_id: created.id,
            title: "edited".to_string(),
            description: "edited body".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
        })
        .expect("edit");
    let (title, labels, assignees, author): (String, String, String, String) = harness
        .connection
        .query_row(
            "SELECT issues.title, refs.remote_labels_json, refs.remote_assignees_json, refs.remote_author_login
             FROM issues JOIN issue_external_refs AS refs ON refs.issue_id = issues.id",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("row");
    assert_eq!(title, "edited");
    assert_eq!(labels, "[\"sync\"]");
    assert_eq!(assignees, "[\"yujianjia\"]");
    assert_eq!(author, "lin");
    assert_eq!(forge.create_calls.lock().expect("calls").len(), 1);
}

#[test]
fn remote_mode_uses_the_current_forge_without_a_source_card_choice() {
    let harness = ready_github_project("all_open", None);
    set_mode(&harness.connection, harness.project_id, "remote");
    let remote = blank_remote(128, "https://github.com/acme/redwhisk/issues/128");
    let forge = FixedForge::new(vec![remote.clone()]).with_created(remote);
    create_issue_with_forge(
        &service(&harness.connection),
        input(harness.project_id, "fixed remote"),
        &forge,
        |_| Ok(()),
    )
    .expect("remote mode");
    assert_eq!(count(&harness.connection, "issues"), 1);
    assert_eq!(count(&harness.connection, "issue_external_refs"), 1);
}
