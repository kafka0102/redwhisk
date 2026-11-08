use rusqlite::{params, Connection, OptionalExtension};

use crate::types::errors::CommandError;
use crate::types::issue_detail::{
    GetIssueDetailInput, IssueDetailProjection, IssueDetailRecord, LinkedChangeRequestSummary,
};

use super::archive::open_issue_database;
use super::completion::writeback_store::detail_writeback;
use super::validation::{issue_database_error, issue_not_found};

pub(crate) fn read_issue_detail_in_data_dir(
    data_dir: impl AsRef<std::path::Path>,
    input: GetIssueDetailInput,
) -> Result<IssueDetailRecord, CommandError> {
    let database = open_issue_database(data_dir)?;
    super::unavailable_recovery::refresh_remote_availability(
        &database.connection,
        input.project_id,
        input.issue_id,
    )?;
    read_issue_detail(&database.connection, &input)
}

pub(crate) fn read_issue_detail(
    connection: &Connection,
    input: &GetIssueDetailInput,
) -> Result<IssueDetailRecord, CommandError> {
    let visible = connection
        .query_row(
            "SELECT id FROM issues WHERE id = ?1 AND project_id = ?2 AND del = 0",
            params![input.issue_id, input.project_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(issue_database_error)?;
    if visible.is_none() {
        return Err(issue_not_found(input.issue_id));
    }

    let projection = connection
        .query_row(
            "SELECT provider, repo, external_url, remote_state, remote_author_login,
                    remote_assignees_json, remote_labels_json
             FROM issue_external_refs
             WHERE issue_id = ?1 AND project_id = ?2",
            params![input.issue_id, input.project_id],
            |row| {
                Ok(IssueDetailProjection {
                    provider: row.get(0)?,
                    repo: row.get(1)?,
                    external_url: row.get(2)?,
                    remote_state: normalize_remote_state(&row.get::<_, String>(3)?),
                    author_login: row.get(4)?,
                    assignees: string_list(&row.get::<_, String>(5)?),
                    labels: string_list(&row.get::<_, String>(6)?),
                })
            },
        )
        .optional()
        .map_err(issue_database_error)?;

    let linked_change_requests =
        load_linked_change_requests(connection, input.project_id, input.issue_id)?;

    let (writeback_pending, writeback_error) = detail_writeback(connection, input.issue_id)?;
    let unavailable_banner =
        super::unavailable_recovery::unavailable_banner(connection, input.issue_id)?;
    let mut projection =
        if super::unavailable_recovery::hides_linked_projection(connection, input.issue_id)? {
            None
        } else {
            projection
        };
    if unavailable_banner.is_some() {
        if let Some(item) = projection.as_mut() {
            item.remote_state = "unavailable".to_string();
        }
    }

    Ok(IssueDetailRecord {
        projection,
        linked_change_requests,
        writeback_pending,
        writeback_error,
        unavailable_banner,
    })
}

fn normalize_remote_state(value: &str) -> String {
    match value {
        "open" | "closed" => value.to_string(),
        _ => "unavailable".to_string(),
    }
}

fn string_list(value: &str) -> Vec<String> {
    serde_json::from_str(value).unwrap_or_default()
}

fn load_linked_change_requests(
    connection: &Connection,
    project_id: i64,
    issue_id: i64,
) -> Result<Vec<LinkedChangeRequestSummary>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT cr.provider, cr.url, cr.number, cr.state, cr.checks_ok, cr.checks_failed,
                    cr.checks_pending, cr.title, cr.source_branch, cr.target_branch
             FROM change_request_issue_links AS links
             JOIN change_requests AS cr ON cr.id = links.change_request_id
             WHERE links.issue_id = ?1 AND cr.project_id = ?2
             ORDER BY links.created_at ASC, cr.id ASC",
        )
        .map_err(issue_database_error)?;
    let rows = statement
        .query_map(params![issue_id, project_id], |row| {
            Ok(LinkedChangeRequestSummary {
                provider: row.get(0)?,
                url: row.get(1)?,
                number: Some(row.get(2)?),
                state: row.get(3)?,
                checks_ok: row.get(4)?,
                checks_failed: row.get(5)?,
                checks_pending: row.get(6)?,
                title: row.get(7)?,
                source_branch: row.get(8)?,
                target_branch: row.get(9)?,
            })
        })
        .map_err(issue_database_error)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(issue_database_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::MigrationRunner;
    use crate::types::errors::CommandErrorCode;

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

    fn insert_project(connection: &Connection) -> i64 {
        connection
            .execute(
                "INSERT INTO projects (name, repo_path, created_at, last_opened_at)
                 VALUES ('App', '/tmp/app', 1, 1)",
                [],
            )
            .expect("project");
        connection.last_insert_rowid()
    }

    fn insert_issue(connection: &Connection, project_id: i64) -> i64 {
        connection
            .execute(
                "INSERT INTO issues (
                    project_id, number, title, description, status, source, created_at, updated_at,
                    status_changed_at, del
                 ) VALUES (?1, 12, 'flow', 'body', 'backlog', 'remote', 10, 20, 20, 0)",
                params![project_id],
            )
            .expect("issue");
        connection.last_insert_rowid()
    }

    fn insert_change_request(
        connection: &Connection,
        project_id: i64,
        number: i64,
        state: &str,
        checks: (i64, i64, i64),
    ) -> i64 {
        connection
            .execute(
                "INSERT INTO change_requests (
                    project_id, provider, host, repo, external_id, number, url, title,
                    state, author_login, source_branch, target_branch, review_decision,
                    requested_reviewers_json, checks_ok, checks_failed, checks_pending,
                    remote_updated_at, synced_at
                 ) VALUES (
                    ?1, 'github', 'github.com', 'acme/redwhisk', ?2, ?2,
                    'https://github.com/acme/redwhisk/pull/' || ?2, 'Change',
                    ?3, 'lin', 'feat/a', 'main', 'none', '[]', ?4, ?5, ?6, 40, 40
                 )",
                params![project_id, number, state, checks.0, checks.1, checks.2],
            )
            .expect("change request");
        connection.last_insert_rowid()
    }

    #[test]
    fn get_issue_detail_returns_projection_without_url_only_change_request() {
        let connection = open_memory();
        let project_id = insert_project(&connection);
        let issue_id = insert_issue(&connection, project_id);
        connection
            .execute(
                "INSERT INTO issue_external_refs (
                    issue_id, project_id, provider, host, repo, external_id, external_number,
                    external_url, remote_state, remote_author_login, remote_assignees_json,
                    remote_labels_json, remote_updated_at, synced_at, sync_status
                 ) VALUES (
                    ?1, ?2, 'github', 'github.com', 'acme/redwhisk', 'ISSUE_128', 128,
                    'https://github.com/acme/redwhisk/issues/128', 'open', 'lin',
                    '[\"yujianjia\"]', '[\"enhancement\",\"sync\"]', 10, 10, 'synced'
                 )",
                params![issue_id, project_id],
            )
            .expect("ref");
        connection
            .execute(
                "INSERT INTO issue_pull_requests (issue_id, url, created_at)
                 VALUES (?1, 'https://github.com/acme/redwhisk/pull/9', 30)",
                params![issue_id],
            )
            .expect("pull request");

        let detail = read_issue_detail(
            &connection,
            &GetIssueDetailInput {
                project_id,
                issue_id,
            },
        )
        .expect("get_issue_detail");
        let projection = detail.projection.expect("projection");
        assert_eq!(projection.provider, "github");
        assert_eq!(projection.repo, "acme/redwhisk");
        assert_eq!(
            projection.external_url,
            "https://github.com/acme/redwhisk/issues/128"
        );
        assert_eq!(projection.remote_state, "open");
        assert_eq!(projection.author_login.as_deref(), Some("lin"));
        assert_eq!(projection.assignees, vec!["yujianjia".to_string()]);
        assert_eq!(
            projection.labels,
            vec!["enhancement".to_string(), "sync".to_string()]
        );
        assert!(detail.linked_change_requests.is_empty());
    }

    #[test]
    fn get_issue_detail_returns_first_class_change_requests_in_link_created_order() {
        let connection = open_memory();
        let project_id = insert_project(&connection);
        let issue_id = insert_issue(&connection, project_id);
        let later = insert_change_request(&connection, project_id, 11, "merged", (4, 0, 0));
        let earlier = insert_change_request(&connection, project_id, 9, "open", (3, 1, 0));
        connection
            .execute(
                "INSERT INTO change_request_issue_links (
                    change_request_id, issue_id, link_kind, created_at
                 ) VALUES (?1, ?2, 'manual', 50), (?3, ?2, 'closing', 40)",
                params![later, issue_id, earlier],
            )
            .expect("links");

        let detail = read_issue_detail(
            &connection,
            &GetIssueDetailInput {
                project_id,
                issue_id,
            },
        )
        .expect("get_issue_detail");
        assert_eq!(detail.linked_change_requests.len(), 2);
        assert_eq!(detail.linked_change_requests[0].number, Some(9));
        assert_eq!(
            detail.linked_change_requests[0].state.as_deref(),
            Some("open")
        );
        assert_eq!(detail.linked_change_requests[0].checks_ok, Some(3));
        assert_eq!(detail.linked_change_requests[0].checks_failed, Some(1));
        assert_eq!(detail.linked_change_requests[0].checks_pending, Some(0));
        assert_eq!(detail.linked_change_requests[0].provider, "github");
        assert_eq!(detail.linked_change_requests[1].number, Some(11));
        assert_eq!(
            detail.linked_change_requests[1].state.as_deref(),
            Some("merged")
        );
    }

    #[test]
    fn missing_issue_fails_get_issue_detail() {
        let connection = open_memory();
        let project_id = insert_project(&connection);
        let error = read_issue_detail(
            &connection,
            &GetIssueDetailInput {
                project_id,
                issue_id: 404,
            },
        )
        .expect_err("get_issue_detail");
        assert_eq!(error.code, CommandErrorCode::IssueNotFound);
    }
}
