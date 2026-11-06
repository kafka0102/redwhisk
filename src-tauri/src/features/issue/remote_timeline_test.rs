use chrono::DateTime;
use rusqlite::{params, Connection};

use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::types::issue::{GetIssueTimelineInput, IssueTimelineActionType, IssueTimelineSource};
use crate::types::issue_action::IssueActionActor;

use super::super::service::IssueService;
use super::{upsert_remote_comments, upsert_remote_events, RemoteCommentWrite, RemoteEventWrite};

fn epoch_millis(iso: &str) -> i64 {
    DateTime::parse_from_rfc3339(iso)
        .unwrap_or_else(|_| panic!("parse timestamp {iso}"))
        .timestamp_millis()
}

fn prepare_issue(connection: &Connection) {
    MigrationRunner::default()
        .run(connection)
        .expect("run migrations");
    connection
        .execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'RedWhisk', '', 1, 1)",
            [],
        )
        .expect("insert project");
    connection
            .execute(
                "INSERT INTO issues (id, project_id, title, description, status, label_ids, created_at, updated_at, del)
                 VALUES (16, 1, 'Issue 16', 'body stays', 'backlog', '[]', 1, 1, 0)",
                [],
            )
            .expect("insert issue");
}

#[test]
fn local_action_sorts_before_later_remote_comment_and_remote_is_not_local_comment() {
    let connection = Connection::open_in_memory().expect("open database");
    prepare_issue(&connection);
    let local_at = epoch_millis("2026-11-05T09:00:00Z");
    let remote_at = epoch_millis("2026-11-05T12:00:00Z");
    connection
            .execute(
                "INSERT INTO issue_actions (issue_id, action_type, payload_json, created_at, actor_kind, actor_user_profile_id)
                 VALUES (16, 'issue_created', '{}', ?1, 'user', 1)",
                params![local_at],
            )
            .expect("insert local action");

    let service = IssueService::new(
        IssueRepository::new(&connection),
        ProjectRepository::new(&connection),
    );
    upsert_remote_comments(
        &service,
        16,
        &[RemoteCommentWrite {
            provider: "github".to_string(),
            remote_comment_id: "c-remote".to_string(),
            author_login: "maya".to_string(),
            body: "remote comment body".to_string(),
            remote_created_at: remote_at,
        }],
    )
    .expect("write remote comment");

    let response = service
        .get_issue_timeline(GetIssueTimelineInput {
            project_id: 1,
            issue_id: 16,
        })
        .expect("read timeline");

    assert_eq!(
        response.entries.len(),
        2,
        "local action and remote comment are both present"
    );
    assert_eq!(response.entries[0].created_at, local_at);
    assert_eq!(response.entries[1].created_at, remote_at);
    assert_eq!(response.entries[0].source, IssueTimelineSource::Local);
    assert_eq!(response.entries[1].source, IssueTimelineSource::Remote);
    assert_ne!(
        response.entries[1].action_type,
        IssueTimelineActionType::IssueCommentAdded,
        "remote comment source is not a local comment"
    );
}

#[test]
fn repeating_a_remote_comment_id_keeps_one_entry_and_the_first_created_at() {
    let connection = Connection::open_in_memory().expect("open database");
    prepare_issue(&connection);
    let first_at = epoch_millis("2026-11-05T12:00:00Z");
    let second_at = epoch_millis("2026-11-05T15:00:00Z");
    let service = IssueService::new(
        IssueRepository::new(&connection),
        ProjectRepository::new(&connection),
    );
    let first = RemoteCommentWrite {
        provider: "github".to_string(),
        remote_comment_id: "c1".to_string(),
        author_login: "maya".to_string(),
        body: "first body".to_string(),
        remote_created_at: first_at,
    };
    let mut repeat = first.clone();
    repeat.body = "second body".to_string();
    repeat.remote_created_at = second_at;
    upsert_remote_comments(&service, 16, &[first]).expect("write remote comment");
    upsert_remote_comments(&service, 16, &[repeat]).expect("repeat remote comment");

    let response = service
        .get_issue_timeline(GetIssueTimelineInput {
            project_id: 1,
            issue_id: 16,
        })
        .expect("read timeline");
    let remote_comments: Vec<_> = response
        .entries
        .iter()
        .filter(|entry| entry.source == IssueTimelineSource::Remote)
        .collect();
    assert_eq!(
        remote_comments.len(),
        1,
        "duplicate remote comment id collapses"
    );
    assert_eq!(remote_comments[0].created_at, first_at);
}

#[test]
fn repeating_a_remote_event_id_keeps_one_sourced_entry_and_the_first_created_at() {
    let connection = Connection::open_in_memory().expect("open database");
    prepare_issue(&connection);
    let first_at = epoch_millis("2026-11-05T10:00:00Z");
    let second_at = epoch_millis("2026-11-05T16:00:00Z");
    let service = IssueService::new(
        IssueRepository::new(&connection),
        ProjectRepository::new(&connection),
    );
    let first = RemoteEventWrite {
        provider: "gitlab".to_string(),
        remote_event_id: "e1".to_string(),
        event_type: "closed".to_string(),
        actor_login: Some("lin".to_string()),
        remote_created_at: first_at,
    };
    let mut repeat = first.clone();
    repeat.remote_created_at = second_at;
    upsert_remote_events(&service, 16, &[first]).expect("write remote event");
    upsert_remote_events(&service, 16, &[repeat]).expect("repeat remote event");

    let response = service
        .get_issue_timeline(GetIssueTimelineInput {
            project_id: 1,
            issue_id: 16,
        })
        .expect("read timeline");
    assert_eq!(response.entries.len(), 1);
    assert_eq!(response.entries[0].created_at, first_at);
    assert_eq!(response.entries[0].source, IssueTimelineSource::Remote);
    assert_ne!(
        response.entries[0].action_type,
        IssueTimelineActionType::IssueCommentAdded,
        "remote system event is not a local comment"
    );
    assert_eq!(response.entries[0].actor.name, "lin");
}

#[test]
fn failed_remote_comment_write_keeps_existing_comment() {
    let connection = Connection::open_in_memory().expect("open database");
    prepare_issue(&connection);
    let first_at = epoch_millis("2026-11-05T12:00:00Z");
    let service = IssueService::new(
        IssueRepository::new(&connection),
        ProjectRepository::new(&connection),
    );
    upsert_remote_comments(
        &service,
        16,
        &[RemoteCommentWrite {
            provider: "github".to_string(),
            remote_comment_id: "c1".to_string(),
            author_login: "maya".to_string(),
            body: "keep me".to_string(),
            remote_created_at: first_at,
        }],
    )
    .expect("write c1");
    let failed = upsert_remote_comments(
        &service,
        16,
        &[RemoteCommentWrite {
            provider: "not-a-forge".to_string(),
            remote_comment_id: "c2".to_string(),
            author_login: "maya".to_string(),
            body: "should not land".to_string(),
            remote_created_at: epoch_millis("2026-11-05T13:00:00Z"),
        }],
    );
    assert!(failed.is_err(), "invalid remote comment write fails");

    let response = service
        .get_issue_timeline(GetIssueTimelineInput {
            project_id: 1,
            issue_id: 16,
        })
        .expect("read timeline");
    let remote_comments: Vec<_> = response
        .entries
        .iter()
        .filter(|entry| entry.source == IssueTimelineSource::Remote)
        .collect();
    assert_eq!(remote_comments.len(), 1, "failed write does not clear c1");
    assert_eq!(remote_comments[0].created_at, first_at);
    assert_eq!(remote_comments[0].comment_body.as_deref(), Some("keep me"));
}

#[test]
fn local_comment_keeps_its_row_when_remote_comment_reuses_the_same_id() {
    let connection = Connection::open_in_memory().expect("open database");
    prepare_issue(&connection);
    connection
            .execute(
                "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
                 VALUES (101, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1, '', '', 0)",
                [],
            )
            .expect("insert agent profile");
    let service = IssueService::new(
        IssueRepository::new(&connection),
        ProjectRepository::new(&connection),
    );
    service
        .add_issue_comment(
            16,
            "local delivery",
            IssueActionActor::Agent {
                profile_id: 101,
                name_snapshot: "Codex".to_string(),
            },
            Some(42),
            Some("c1"),
        )
        .expect("write local comment");
    let remote = RemoteCommentWrite {
        provider: "github".to_string(),
        remote_comment_id: "c1".to_string(),
        author_login: "maya".to_string(),
        body: "remote body".to_string(),
        remote_created_at: epoch_millis("2026-11-05T12:00:00Z"),
    };
    upsert_remote_comments(&service, 16, &[remote.clone()]).expect("write remote comment");
    upsert_remote_comments(&service, 16, &[remote]).expect("repeat remote comment");

    let response = service
        .get_issue_timeline(GetIssueTimelineInput {
            project_id: 1,
            issue_id: 16,
        })
        .expect("read timeline");
    let local_comments: Vec<_> = response
        .entries
        .iter()
        .filter(|entry| entry.action_type == IssueTimelineActionType::IssueCommentAdded)
        .collect();
    let remote_comments: Vec<_> = response
        .entries
        .iter()
        .filter(|entry| entry.action_type == IssueTimelineActionType::RemoteComment)
        .collect();
    assert_eq!(
        local_comments.len(),
        1,
        "remote idempotency does not swallow the local comment"
    );
    assert_eq!(local_comments[0].source, IssueTimelineSource::Local);
    assert_eq!(
        local_comments[0].comment_body.as_deref(),
        Some("local delivery")
    );
    assert_eq!(
        remote_comments.len(),
        1,
        "local comment does not take the remote comment id"
    );
    assert_eq!(remote_comments[0].source, IssueTimelineSource::Remote);
    assert_eq!(
        remote_comments[0].comment_body.as_deref(),
        Some("remote body")
    );
}
