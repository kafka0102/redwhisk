use rusqlite::{params, Connection};

use super::super::detail_read::read_issue_detail;
use super::{apply_issue_recovery_request, IssueRecoveryRequest, RemoteProbeKind};
use crate::db::migrations::MigrationRunner;
use crate::types::errors::CommandErrorCode;
use crate::types::issue_detail::GetIssueDetailInput;
use crate::types::issue_detail::RecoveryAction;

pub(super) struct Fixture {
    pub(super) connection: Connection,
    pub(super) project_id: i64,
    pub(super) issue_id: i64,
}

pub(super) fn seed_linked_remote_issue() -> Fixture {
    let connection = Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("foreign keys");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrate");
    connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at)
             VALUES ('App', '/tmp/app', 1, 1)",
            [],
        )
        .expect("project");
    let project_id = connection.last_insert_rowid();
    connection
        .execute(
            "INSERT INTO issues (
                project_id, number, title, description, status, source, created_at, updated_at,
                status_changed_at, del
             ) VALUES (?1, 128, 'flow', 'body', 'backlog', 'remote', 10, 20, 20, 0)",
            params![project_id],
        )
        .expect("issue");
    let issue_id = connection.last_insert_rowid();
    connection
        .execute(
            "INSERT INTO issue_external_refs (
                issue_id, project_id, provider, host, repo, external_id, external_number,
                external_url, remote_state, remote_author_login, remote_assignees_json,
                remote_labels_json, remote_updated_at, synced_at, sync_status
             ) VALUES (
                ?1, ?2, 'github', 'github.com', 'acme/redwhisk', 'ISSUE_128', 128,
                'https://github.com/acme/redwhisk/issues/128', 'open', 'lin',
                '[]', '[]', 10, 10, 'synced'
             )",
            params![issue_id, project_id],
        )
        .expect("external identity");
    connection
        .execute(
            "INSERT INTO issue_comments (issue_id, body, created_at) VALUES (?1, 'note', 11)",
            params![issue_id],
        )
        .expect("comment");
    connection
        .execute(
            "INSERT INTO issue_attachments (
                issue_id, display_name, stored_name, relative_path, absolute_path,
                mime_type, file_size, kind, is_previewable, created_at
             ) VALUES (?1, 'a.txt', 'a.txt', 'a.txt', '/tmp/a.txt', 'text/plain', 3, 'file', 1, 12)",
            params![issue_id],
        )
        .expect("attachment");
    connection
        .execute(
            "INSERT INTO agent_profiles (
                id, name, agent_type, command, scope, project_id, mode, dangerous,
                default_skill, prompt_template, del
             ) VALUES (100, 'Codex', 'codex', 'codex', 'project', ?1, 'full-auto', 1, '', '', 0)",
            params![project_id],
        )
        .expect("profile");
    connection
        .execute(
            "INSERT INTO agent_sessions (
                id, project_id, issue_id, agent_profile_id, status, attention,
                working_dir, command_snapshot, prompt_snapshot, log_path,
                last_active_at, started_at, del
             ) VALUES (
                50, ?1, ?2, 100, 'closed', 'none',
                '/tmp/repo', 'codex', '', '/tmp/s.log',
                13, 13, 0
             )",
            params![project_id, issue_id],
        )
        .expect("session");
    connection
        .execute(
            "INSERT INTO issue_completion_flows (
                issue_id, session_id, phase, updated_at
             ) VALUES (?1, 50, 'completed', 14)",
            params![issue_id],
        )
        .expect("completion flow");
    connection
        .execute(
            "INSERT INTO completion_attempts (
                issue_id, session_id, option, head_before, head_after, result, created_at
             ) VALUES (?1, 50, 'complete_manual', 'aaa', 'bbb', 'completed', 15)",
            params![issue_id],
        )
        .expect("completion attempt");
    connection
        .execute(
            "INSERT INTO issue_completion_writebacks (
                issue_id, completion_method, close_done, comment_done, updated_at
             ) VALUES (?1, 'merge_to_base', 1, 1, 16)",
            params![issue_id],
        )
        .expect("completion writeback");
    Fixture {
        connection,
        project_id,
        issue_id,
    }
}

pub(super) fn count_for_issue(connection: &Connection, table: &str, issue_id: i64) -> i64 {
    connection
        .query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE issue_id = ?1"),
            params![issue_id],
            |row| row.get(0),
        )
        .expect("count")
}

pub(super) fn sync_status(connection: &Connection, issue_id: i64) -> String {
    connection
        .query_row(
            "SELECT sync_status FROM issue_external_refs WHERE issue_id = ?1",
            params![issue_id],
            |row| row.get(0),
        )
        .expect("sync status")
}

#[test]
fn not_found_marks_unavailable_without_deleting() {
    let fixture = seed_linked_remote_issue();
    apply_issue_recovery_request(
        &fixture.connection,
        fixture.project_id,
        fixture.issue_id,
        IssueRecoveryRequest::Probe(RemoteProbeKind::NotFound),
    )
    .expect("404 probe");

    let issue_rows: i64 = fixture
        .connection
        .query_row(
            "SELECT COUNT(*) FROM issues WHERE id = ?1 AND del = 0",
            params![fixture.issue_id],
            |row| row.get(0),
        )
        .expect("issue count");
    assert_eq!(issue_rows, 1, "issue row must survive a 404 probe");
    assert_eq!(
        count_for_issue(&fixture.connection, "issue_comments", fixture.issue_id),
        1
    );
    assert_eq!(
        count_for_issue(&fixture.connection, "issue_attachments", fixture.issue_id),
        1
    );
    assert_eq!(
        count_for_issue(&fixture.connection, "agent_sessions", fixture.issue_id),
        1
    );
    assert_eq!(
        count_for_issue(
            &fixture.connection,
            "issue_completion_flows",
            fixture.issue_id
        ),
        1
    );
    assert_eq!(
        count_for_issue(&fixture.connection, "completion_attempts", fixture.issue_id),
        1
    );
    assert_eq!(
        count_for_issue(
            &fixture.connection,
            "issue_completion_writebacks",
            fixture.issue_id
        ),
        1
    );
    assert_eq!(
        sync_status(&fixture.connection, fixture.issue_id),
        "unavailable"
    );
    let detail = read_issue_detail(
        &fixture.connection,
        &GetIssueDetailInput {
            project_id: fixture.project_id,
            issue_id: fixture.issue_id,
        },
    )
    .expect("detail");
    let banner = detail
        .unavailable_banner
        .expect("404 must surface the unavailable banner");
    assert!(!banner.shows_delete_confirmation);
}

#[test]
fn gone_marks_unavailable_without_deleting() {
    let fixture = seed_linked_remote_issue();
    apply_issue_recovery_request(
        &fixture.connection,
        fixture.project_id,
        fixture.issue_id,
        IssueRecoveryRequest::Probe(RemoteProbeKind::Gone),
    )
    .expect("410 probe");

    let issue_rows: i64 = fixture
        .connection
        .query_row(
            "SELECT COUNT(*) FROM issues WHERE id = ?1 AND del = 0",
            params![fixture.issue_id],
            |row| row.get(0),
        )
        .expect("issue count");
    assert_eq!(issue_rows, 1);
    assert_eq!(
        count_for_issue(&fixture.connection, "issue_comments", fixture.issue_id),
        1
    );
    assert_eq!(
        sync_status(&fixture.connection, fixture.issue_id),
        "unavailable"
    );
    let detail = read_issue_detail(
        &fixture.connection,
        &GetIssueDetailInput {
            project_id: fixture.project_id,
            issue_id: fixture.issue_id,
        },
    )
    .expect("detail");
    assert!(detail.unavailable_banner.is_some());
}

#[test]
fn forbidden_uses_the_same_banner_as_not_found_without_delete_confirmation() {
    let missing = seed_linked_remote_issue();
    let forbidden = seed_linked_remote_issue();
    apply_issue_recovery_request(
        &missing.connection,
        missing.project_id,
        missing.issue_id,
        IssueRecoveryRequest::Probe(RemoteProbeKind::NotFound),
    )
    .expect("404 probe");
    apply_issue_recovery_request(
        &forbidden.connection,
        forbidden.project_id,
        forbidden.issue_id,
        IssueRecoveryRequest::Probe(RemoteProbeKind::Forbidden),
    )
    .expect("forbidden probe");

    let missing_banner = read_issue_detail(
        &missing.connection,
        &GetIssueDetailInput {
            project_id: missing.project_id,
            issue_id: missing.issue_id,
        },
    )
    .expect("404 detail")
    .unavailable_banner
    .expect("404 banner");
    let forbidden_banner = read_issue_detail(
        &forbidden.connection,
        &GetIssueDetailInput {
            project_id: forbidden.project_id,
            issue_id: forbidden.issue_id,
        },
    )
    .expect("forbidden detail")
    .unavailable_banner
    .expect("forbidden banner");
    assert_eq!(forbidden_banner, missing_banner);
    assert!(!forbidden_banner.shows_delete_confirmation);
    assert_eq!(
        forbidden_banner.actions,
        vec![
            RecoveryAction::KeepLocal,
            RecoveryAction::Unlink,
            RecoveryAction::Retry,
        ]
    );
}

#[test]
fn missing_issue_fails_apply_issue_recovery() {
    let fixture = seed_linked_remote_issue();
    let error = apply_issue_recovery_request(
        &fixture.connection,
        fixture.project_id,
        404,
        IssueRecoveryRequest::KeepLocal,
    )
    .expect_err("apply_issue_recovery");
    assert_eq!(error.code, CommandErrorCode::IssueNotFound);
}
