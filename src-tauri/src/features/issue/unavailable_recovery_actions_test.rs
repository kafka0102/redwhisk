use rusqlite::params;

use super::super::detail_read::read_issue_detail;
use super::super::github_issue_mirror::{open_issue, sync_project_issues, FixedForge};
use super::super::remote_timeline::load_issue_timeline;
use super::tests::{count_for_issue, seed_linked_remote_issue};
use super::{apply_issue_recovery_request, IssueRecoveryRequest, RemoteProbeKind};
use crate::types::issue::IssueTimelineActionType;
use crate::types::issue_detail::GetIssueDetailInput;

#[test]
fn keep_local_stops_sync_and_keeps_history() {
    let fixture = seed_linked_remote_issue();
    apply_issue_recovery_request(
        &fixture.connection,
        fixture.project_id,
        fixture.issue_id,
        IssueRecoveryRequest::Probe(RemoteProbeKind::NotFound),
    )
    .expect("404 probe");
    apply_issue_recovery_request(
        &fixture.connection,
        fixture.project_id,
        fixture.issue_id,
        IssueRecoveryRequest::KeepLocal,
    )
    .expect("keep local");

    let source: String = fixture
        .connection
        .query_row(
            "SELECT source FROM issues WHERE id = ?1",
            params![fixture.issue_id],
            |row| row.get(0),
        )
        .expect("source");
    assert_eq!(source, "local");
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
        count_for_issue(
            &fixture.connection,
            "issue_completion_writebacks",
            fixture.issue_id
        ),
        1
    );
    let detail = read_issue_detail(
        &fixture.connection,
        &GetIssueDetailInput {
            project_id: fixture.project_id,
            issue_id: fixture.issue_id,
        },
    )
    .expect("detail");
    assert!(detail.unavailable_banner.is_none());
    assert!(detail.projection.is_none());

    fixture
        .connection
        .execute(
            "UPDATE projects
             SET issue_source_mode = 'mixed', issue_sync_scope = 'all_open'
             WHERE id = ?1",
            params![fixture.project_id],
        )
        .expect("mode");
    fixture
        .connection
        .execute(
            "INSERT INTO project_forge_connections (
                project_id, provider, host_url, repo_path, login, auth_status,
                cli_installed, cli_authenticated, checked_at
             ) VALUES (?1, 'github', 'https://github.com/', 'acme/redwhisk', 'octocat', 'ready', 1, 1, 1)",
            params![fixture.project_id],
        )
        .expect("forge");
    let forge = FixedForge::new(vec![open_issue(128, "changed-title")]);
    sync_project_issues(&fixture.connection, fixture.project_id, &forge, 50).expect("sync");
    let title: String = fixture
        .connection
        .query_row(
            "SELECT title FROM issues WHERE id = ?1",
            params![fixture.issue_id],
            |row| row.get(0),
        )
        .expect("title");
    assert_eq!(title, "flow");
    let issues: i64 = fixture
        .connection
        .query_row(
            "SELECT COUNT(*) FROM issues WHERE project_id = ?1 AND del = 0",
            params![fixture.project_id],
            |row| row.get(0),
        )
        .expect("issue count");
    assert_eq!(issues, 1);
}

#[test]
fn retry_success_clears_banner_and_resumes_sync() {
    let fixture = seed_linked_remote_issue();
    apply_issue_recovery_request(
        &fixture.connection,
        fixture.project_id,
        fixture.issue_id,
        IssueRecoveryRequest::Probe(RemoteProbeKind::NotFound),
    )
    .expect("404 probe");
    apply_issue_recovery_request(
        &fixture.connection,
        fixture.project_id,
        fixture.issue_id,
        IssueRecoveryRequest::Retry(RemoteProbeKind::Available),
    )
    .expect("retry");
    let detail = read_issue_detail(
        &fixture.connection,
        &GetIssueDetailInput {
            project_id: fixture.project_id,
            issue_id: fixture.issue_id,
        },
    )
    .expect("detail");
    assert!(detail.unavailable_banner.is_none());

    fixture
        .connection
        .execute(
            "UPDATE projects
             SET issue_source_mode = 'mixed', issue_sync_scope = 'all_open'
             WHERE id = ?1",
            params![fixture.project_id],
        )
        .expect("mode");
    fixture
        .connection
        .execute(
            "INSERT INTO project_forge_connections (
                project_id, provider, host_url, repo_path, login, auth_status,
                cli_installed, cli_authenticated, checked_at
             ) VALUES (?1, 'github', 'https://github.com/', 'acme/redwhisk', 'octocat', 'ready', 1, 1, 1)",
            params![fixture.project_id],
        )
        .expect("forge");
    let forge = FixedForge::new(vec![open_issue(128, "changed-title")]);
    sync_project_issues(&fixture.connection, fixture.project_id, &forge, 50).expect("sync");
    let title: String = fixture
        .connection
        .query_row(
            "SELECT title FROM issues WHERE id = ?1",
            params![fixture.issue_id],
            |row| row.get(0),
        )
        .expect("title");
    assert_eq!(title, "changed-title");
}

#[test]
fn retry_failure_keeps_banner_and_issue() {
    let fixture = seed_linked_remote_issue();
    apply_issue_recovery_request(
        &fixture.connection,
        fixture.project_id,
        fixture.issue_id,
        IssueRecoveryRequest::Probe(RemoteProbeKind::NotFound),
    )
    .expect("404 probe");
    apply_issue_recovery_request(
        &fixture.connection,
        fixture.project_id,
        fixture.issue_id,
        IssueRecoveryRequest::Retry(RemoteProbeKind::NotFound),
    )
    .expect("failed retry");
    let issue_rows: i64 = fixture
        .connection
        .query_row(
            "SELECT COUNT(*) FROM issues WHERE id = ?1 AND del = 0",
            params![fixture.issue_id],
            |row| row.get(0),
        )
        .expect("issue count");
    assert_eq!(issue_rows, 1);
    let detail = read_issue_detail(
        &fixture.connection,
        &GetIssueDetailInput {
            project_id: fixture.project_id,
            issue_id: fixture.issue_id,
        },
    )
    .expect("detail");
    let banner = detail.unavailable_banner.expect("banner remains");
    assert!(!banner.shows_delete_confirmation);
}

#[test]
fn unlink_skips_future_sync_and_keeps_remote_origin() {
    let fixture = seed_linked_remote_issue();
    apply_issue_recovery_request(
        &fixture.connection,
        fixture.project_id,
        fixture.issue_id,
        IssueRecoveryRequest::Probe(RemoteProbeKind::NotFound),
    )
    .expect("404 probe");
    apply_issue_recovery_request(
        &fixture.connection,
        fixture.project_id,
        fixture.issue_id,
        IssueRecoveryRequest::Unlink,
    )
    .expect("unlink");

    let issue_rows: i64 = fixture
        .connection
        .query_row(
            "SELECT COUNT(*) FROM issues WHERE id = ?1 AND del = 0",
            params![fixture.issue_id],
            |row| row.get(0),
        )
        .expect("issue count");
    assert_eq!(issue_rows, 1);
    let detail = read_issue_detail(
        &fixture.connection,
        &GetIssueDetailInput {
            project_id: fixture.project_id,
            issue_id: fixture.issue_id,
        },
    )
    .expect("detail");
    assert!(detail.unavailable_banner.is_none());
    let timeline = load_issue_timeline(&fixture.connection, fixture.issue_id).expect("timeline");
    assert!(
        timeline.entries.iter().any(|entry| {
            entry.action_type == IssueTimelineActionType::RemoteOrigin
                && entry.comment_body.as_deref()
                    == Some("https://github.com/acme/redwhisk/issues/128")
        }),
        "timeline must keep the remote origin"
    );

    fixture
        .connection
        .execute(
            "UPDATE projects
             SET issue_source_mode = 'mixed', issue_sync_scope = 'all_open'
             WHERE id = ?1",
            params![fixture.project_id],
        )
        .expect("mode");
    fixture
        .connection
        .execute(
            "INSERT INTO project_forge_connections (
                project_id, provider, host_url, repo_path, login, auth_status,
                cli_installed, cli_authenticated, checked_at
             ) VALUES (?1, 'github', 'https://github.com/', 'acme/redwhisk', 'octocat', 'ready', 1, 1, 1)",
            params![fixture.project_id],
        )
        .expect("forge");
    let forge = FixedForge::new(vec![open_issue(128, "changed-title")]);
    sync_project_issues(&fixture.connection, fixture.project_id, &forge, 50).expect("sync");
    let title: String = fixture
        .connection
        .query_row(
            "SELECT title FROM issues WHERE id = ?1",
            params![fixture.issue_id],
            |row| row.get(0),
        )
        .expect("title");
    assert_eq!(title, "flow");
    let issues: i64 = fixture
        .connection
        .query_row(
            "SELECT COUNT(*) FROM issues WHERE project_id = ?1 AND del = 0",
            params![fixture.project_id],
            |row| row.get(0),
        )
        .expect("issues");
    assert_eq!(issues, 1);
}
