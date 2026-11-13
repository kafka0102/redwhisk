use rusqlite::params;

use super::github_issue_mirror::{
    ready_github_project, seed_remote_issue, set_auth, set_mode, sync_project_issues, FixedForge,
    ForgeIssueError, RemoteIssue,
};
use super::remote_create::create_issue_with_forge;
use super::service::IssueService;
use crate::db::issue_repository::IssueRepository;
use crate::db::project_label_repository::ProjectLabelRepository;
use crate::db::project_repository::ProjectRepository;
use crate::types::errors::CommandErrorCode;
use crate::types::issue::{CreateIssueInput, IssueLabelRecord, UpdateIssueInput};
use crate::types::project_label::ProjectLabelScope;

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

fn project_label(connection: &rusqlite::Connection, project_id: i64, name: &str) -> i64 {
    ProjectLabelRepository::new(connection)
        .save_label(
            None,
            name,
            &ProjectLabelScope::Project,
            Some(project_id),
            "#2563EB",
            None,
        )
        .expect("project label")
        .id
}

fn label_names(labels: &[IssueLabelRecord]) -> Vec<&str> {
    labels.iter().map(|label| label.name.as_str()).collect()
}

fn created_draft(forge: &FixedForge) -> super::github_issue_mirror::ForgeIssueDraft {
    forge
        .create_calls
        .lock()
        .expect("calls")
        .last()
        .cloned()
        .expect("draft")
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
    let bug = project_label(&harness.connection, harness.project_id, "bug");
    let docs = project_label(&harness.connection, harness.project_id, "docs");
    let forge = FixedForge::new(vec![remote.clone()])
        .with_created(remote)
        .with_host_labels(["Bug"]);
    let mut create = input(harness.project_id, "original");
    create.label_ids = vec![bug];
    let created =
        create_issue_with_forge(&service(&harness.connection), create, &forge, |_| Ok(()))
            .expect("create");
    let edited = service(&harness.connection)
        .update_issue(UpdateIssueInput {
            project_id: harness.project_id,
            issue_id: created.id,
            title: "edited".to_string(),
            description: "edited body".to_string(),
            attachments: Vec::new(),
            label_ids: vec![docs],
        })
        .expect("edit");
    assert_eq!(label_names(&edited.labels), vec!["docs"]);
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
    assert_eq!(*forge.label_list_calls.lock().expect("label list"), 1);
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

#[test]
fn create_attaches_only_existing_host_labels() {
    let harness = ready_github_project("all_open", None);
    choose_remote(&harness.connection, harness.project_id);
    let bug = project_label(&harness.connection, harness.project_id, "bug");
    let absent = project_label(&harness.connection, harness.project_id, "absent");
    let docs = project_label(&harness.connection, harness.project_id, "docs");
    let remote = blank_remote(128, "https://github.com/acme/redwhisk/issues/128");
    let forge = FixedForge::new(Vec::new())
        .with_created(remote)
        .with_host_labels(["Bug", "docs"]);
    let mut create = input(harness.project_id, "labeled");
    create.label_ids = vec![bug, absent, docs];
    let created =
        create_issue_with_forge(&service(&harness.connection), create, &forge, |_| Ok(()))
            .expect("create remote issue");
    assert_eq!(
        created_draft(&forge).labels,
        vec!["Bug".to_string(), "docs".to_string()]
    );
    assert_eq!(label_names(&created.labels), vec!["bug", "absent", "docs"]);
    assert_eq!(
        forge.host_labels,
        vec!["Bug".to_string(), "docs".to_string()]
    );
}

#[test]
fn create_succeeds_without_labels_when_the_host_label_list_is_empty() {
    let harness = ready_github_project("all_open", None);
    choose_remote(&harness.connection, harness.project_id);
    let bug = project_label(&harness.connection, harness.project_id, "bug");
    let remote = blank_remote(128, "https://github.com/acme/redwhisk/issues/128");
    let forge = FixedForge::new(Vec::new()).with_created(remote);
    let mut create = input(harness.project_id, "empty host labels");
    create.label_ids = vec![bug];
    let created =
        create_issue_with_forge(&service(&harness.connection), create, &forge, |_| Ok(()))
            .expect("create");
    assert!(created_draft(&forge).labels.is_empty());
    assert_eq!(label_names(&created.labels), vec!["bug"]);
}

#[test]
fn create_without_project_labels_does_not_attach_existing_host_labels() {
    let harness = ready_github_project("all_open", None);
    choose_remote(&harness.connection, harness.project_id);
    let remote = blank_remote(128, "https://github.com/acme/redwhisk/issues/128");
    let forge = FixedForge::new(Vec::new())
        .with_created(remote)
        .with_host_labels(["bug"]);
    let created = create_issue_with_forge(
        &service(&harness.connection),
        input(harness.project_id, "no project labels"),
        &forge,
        |_| Ok(()),
    )
    .expect("create");
    assert!(created_draft(&forge).labels.is_empty());
    assert!(created.labels.is_empty());
}

#[test]
fn create_attaches_one_host_label_when_project_names_match_it_twice() {
    let harness = ready_github_project("all_open", None);
    choose_remote(&harness.connection, harness.project_id);
    let bug = project_label(&harness.connection, harness.project_id, "bug");
    let upper = project_label(&harness.connection, harness.project_id, "BUG");
    let remote = blank_remote(128, "https://github.com/acme/redwhisk/issues/128");
    let forge = FixedForge::new(Vec::new())
        .with_created(remote)
        .with_host_labels(["Bug"]);
    let mut create = input(harness.project_id, "duplicate match");
    create.label_ids = vec![bug, upper];
    create_issue_with_forge(&service(&harness.connection), create, &forge, |_| Ok(()))
        .expect("create");
    assert_eq!(created_draft(&forge).labels, vec!["Bug".to_string()]);
}

#[test]
fn host_label_list_auth_failures_do_not_create_a_local_issue() {
    let cases = [
        (
            ForgeIssueError::Unauthenticated,
            "remoteCreateUnauthenticated",
        ),
        (ForgeIssueError::Forbidden, "remoteCreateForbidden"),
        (ForgeIssueError::Offline, "remoteCreateOffline"),
    ];
    for (error, reason) in cases {
        let harness = ready_github_project("all_open", None);
        choose_remote(&harness.connection, harness.project_id);
        let bug = project_label(&harness.connection, harness.project_id, "bug");
        let remote = blank_remote(128, "https://github.com/acme/redwhisk/issues/128");
        let forge = FixedForge::new(Vec::new())
            .with_created(remote)
            .with_host_labels(["Bug"])
            .failing_labels(error);
        let mut create = input(harness.project_id, "blocked labels");
        create.label_ids = vec![bug];
        let failed =
            create_issue_with_forge(&service(&harness.connection), create, &forge, |_| Ok(()))
                .expect_err(reason);
        assert_eq!(failed.reason.as_deref(), Some(reason));
        assert_eq!(count(&harness.connection, "issues"), 0, "{reason}");
        assert!(forge.create_calls.lock().expect("calls").is_empty());
    }
}

#[test]
fn host_label_list_command_failures_are_remote_create_unavailable() {
    for error in [
        ForgeIssueError::CliMissing,
        ForgeIssueError::RateLimited,
        ForgeIssueError::CommandFailed,
    ] {
        let harness = ready_github_project("all_open", None);
        choose_remote(&harness.connection, harness.project_id);
        let bug = project_label(&harness.connection, harness.project_id, "bug");
        let remote = blank_remote(128, "https://github.com/acme/redwhisk/issues/128");
        let forge = FixedForge::new(Vec::new())
            .with_created(remote)
            .failing_labels(error);
        let mut create = input(harness.project_id, "unavailable labels");
        create.label_ids = vec![bug];
        let failed =
            create_issue_with_forge(&service(&harness.connection), create, &forge, |_| Ok(()))
                .expect_err("unavailable");
        assert_eq!(failed.reason.as_deref(), Some("remoteCreateUnavailable"));
        assert_eq!(count(&harness.connection, "issues"), 0);
        assert!(forge.create_calls.lock().expect("calls").is_empty());
    }
}

#[test]
fn local_create_with_a_project_label_does_not_call_the_forge() {
    let harness = ready_github_project("all_open", None);
    let bug = project_label(&harness.connection, harness.project_id, "bug");
    let forge = FixedForge::failing(ForgeIssueError::Offline).with_host_labels(["bug"]);
    let mut create = input(harness.project_id, "local bug");
    create.label_ids = vec![bug];
    let created =
        create_issue_with_forge(&service(&harness.connection), create, &forge, |_| Ok(()))
            .expect("local");
    assert_eq!(label_names(&created.labels), vec!["bug"]);
    assert!(forge.create_calls.lock().expect("calls").is_empty());
    assert_eq!(*forge.label_list_calls.lock().expect("label list"), 0);
}
