use rusqlite::{params, Connection};

use super::service::IssueService;
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::types::issue::{AdvanceIssueStatusInput, IssueStatus};

#[test]
fn reopening_completed_issue_returns_to_backlog_without_session_or_closing_remote() {
    let connection = Connection::open_in_memory().expect("open database");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrate");
    connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at)
             VALUES ('App', '/tmp/reopen', 1, 1)",
            [],
        )
        .expect("project");
    let project_id = connection.last_insert_rowid();
    connection
        .execute(
            "INSERT INTO issues (
                project_id, number, title, description, status, source, created_at, updated_at,
                status_changed_at, del
             ) VALUES (?1, 128, 'flow', '', 'completed', 'remote', 10, 20, 20, 0)",
            params![project_id],
        )
        .expect("issue");
    let issue_id = connection.last_insert_rowid();
    connection
        .execute(
            "INSERT INTO issue_external_refs (
                issue_id, project_id, provider, host, repo, external_id, external_number,
                external_url, remote_state, remote_updated_at, synced_at, sync_status
             ) VALUES (
                ?1, ?2, 'github', 'github.com', 'acme/redwhisk', 'ISSUE_128', 128,
                'https://github.com/acme/redwhisk/issues/128', 'open', 10, 10, 'synced'
             )",
            params![issue_id, project_id],
        )
        .expect("external ref");

    let service = IssueService::new(
        IssueRepository::new(&connection),
        ProjectRepository::new(&connection),
    );
    let reopened = service
        .advance_issue_status(AdvanceIssueStatusInput {
            project_id,
            issue_id,
            target_status: IssueStatus::Backlog,
        })
        .expect("reopen to backlog");

    assert_eq!(reopened.status, IssueStatus::Backlog);
    assert_ne!(reopened.status, IssueStatus::Running);
    assert_eq!(reopened.linked_session_id, None);
    assert_eq!(session_count(&connection), 0);
    assert_eq!(remote_state(&connection, issue_id), "open");
}

fn session_count(connection: &Connection) -> i64 {
    connection
        .query_row("SELECT COUNT(*) FROM agent_sessions", [], |row| row.get(0))
        .expect("sessions")
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
