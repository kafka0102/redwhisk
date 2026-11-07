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

    let linked_change_request = connection
        .query_row(
            "SELECT url FROM issue_pull_requests WHERE issue_id = ?1",
            params![input.issue_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(issue_database_error)?
        .map(linked_change_request_from_url);

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
        linked_change_request,
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

fn linked_change_request_from_url(url: String) -> LinkedChangeRequestSummary {
    let number = url
        .split(['?', '#'])
        .next()
        .and_then(|path| path.rsplit('/').next())
        .and_then(|segment| segment.parse::<i64>().ok());
    LinkedChangeRequestSummary {
        url,
        number,
        state: None,
        checks_label: None,
        title: None,
        source_branch: None,
        target_branch: None,
    }
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

    #[test]
    fn get_issue_detail_returns_projection_and_url_without_pr_state() {
        let connection = open_memory();
        let project_id = insert_project(&connection);
        connection
            .execute(
                "INSERT INTO issues (
                    project_id, number, title, description, status, source, created_at, updated_at,
                    status_changed_at, del
                 ) VALUES (?1, 12, 'flow', 'body', 'backlog', 'remote', 10, 20, 20, 0)",
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
        let linked = detail.linked_change_request.expect("linked");
        assert_eq!(linked.url, "https://github.com/acme/redwhisk/pull/9");
        assert_eq!(linked.number, Some(9));
        assert_eq!(linked.state, None);
        assert_eq!(linked.checks_label, None);
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
