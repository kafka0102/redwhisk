use std::collections::HashMap;

use rusqlite::{params, Connection};

use super::pull_request_url::upgrade_pull_request_urls;
use crate::types::change_request::{
    ChangeRequestFilterCounts, ChangeRequestLinkedIssue, ChangeRequestListResponse,
    ChangeRequestListRow,
};
use crate::types::errors::{CommandError, CommandErrorCode};

struct StoredChangeRequest {
    id: i64,
    provider: String,
    number: i64,
    title: String,
    url: String,
    state: String,
    author_login: Option<String>,
    source_branch: String,
    target_branch: String,
    review_decision: Option<String>,
    checks_ok: Option<i64>,
    checks_failed: Option<i64>,
    checks_pending: Option<i64>,
    remote_updated_at: i64,
}

pub(crate) fn list_project_change_requests(
    connection: &Connection,
    project_id: i64,
    filter: &str,
    _viewer_login: &str,
) -> Result<ChangeRequestListResponse, CommandError> {
    ensure_project(connection, project_id)?;
    let selected = normalize_filter(filter)?;
    let pull_request_refs = upgrade_pull_request_urls(connection, project_id)?;
    let stored = load_change_requests(connection, project_id)?;
    let links = load_links(connection, project_id)?;
    let counts = ChangeRequestFilterCounts {
        open: stored.iter().filter(|row| is_open_like(&row.state)).count() as i64,
        closed: stored
            .iter()
            .filter(|row| is_closed_like(&row.state))
            .count() as i64,
    };
    let rows = stored
        .iter()
        .filter(|row| matches_filter(row, selected))
        .map(|row| to_row(row, links.get(&row.id).cloned().unwrap_or_default()))
        .collect();
    Ok(ChangeRequestListResponse {
        rows,
        tab_count: stored.len() as i64,
        counts,
        pull_request_refs,
    })
}

fn to_row(
    row: &StoredChangeRequest,
    linked_issues: Vec<ChangeRequestLinkedIssue>,
) -> ChangeRequestListRow {
    ChangeRequestListRow {
        id: row.id,
        provider: row.provider.clone(),
        number: row.number,
        title: row.title.clone(),
        url: row.url.clone(),
        state: row.state.clone(),
        author_login: row.author_login.clone(),
        source_branch: row.source_branch.clone(),
        target_branch: row.target_branch.clone(),
        review_decision: row.review_decision.clone(),
        checks_ok: row.checks_ok,
        checks_failed: row.checks_failed,
        checks_pending: row.checks_pending,
        remote_updated_at: row.remote_updated_at,
        linked_issues,
    }
}

pub(super) fn ensure_project(connection: &Connection, project_id: i64) -> Result<(), CommandError> {
    let found: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(query_failed)?;
    if found == 0 {
        return Err(CommandError::new(
            CommandErrorCode::ProjectNotFound,
            "Project not found.",
        ));
    }
    Ok(())
}

fn normalize_filter(filter: &str) -> Result<&str, CommandError> {
    match filter {
        "" | "open" => Ok("open"),
        "closed" => Ok("closed"),
        _ => Err(CommandError::new(
            CommandErrorCode::ProjectValidationFailed,
            "Change request filter is invalid.",
        )
        .with_reason("changeRequestFilterInvalid")),
    }
}

fn load_change_requests(
    connection: &Connection,
    project_id: i64,
) -> Result<Vec<StoredChangeRequest>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT id, provider, number, title, url, state, author_login, source_branch, target_branch,
                    review_decision, checks_ok, checks_failed, checks_pending, remote_updated_at
             FROM change_requests
             WHERE project_id = ?1
             ORDER BY remote_updated_at DESC, number DESC",
        )
        .map_err(query_failed)?;
    let rows = statement
        .query_map(params![project_id], |row| {
            Ok(StoredChangeRequest {
                id: row.get(0)?,
                provider: row.get(1)?,
                number: row.get(2)?,
                title: row.get(3)?,
                url: row.get(4)?,
                state: row.get(5)?,
                author_login: row.get(6)?,
                source_branch: row.get(7)?,
                target_branch: row.get(8)?,
                review_decision: row.get(9)?,
                checks_ok: row.get(10)?,
                checks_failed: row.get(11)?,
                checks_pending: row.get(12)?,
                remote_updated_at: row.get(13)?,
            })
        })
        .map_err(query_failed)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(query_failed)
}

fn load_links(
    connection: &Connection,
    project_id: i64,
) -> Result<HashMap<i64, Vec<ChangeRequestLinkedIssue>>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT links.change_request_id, issues.id, issues.number, refs.provider,
                    refs.external_number, links.link_kind
             FROM change_request_issue_links AS links
             JOIN issues ON issues.id = links.issue_id
             LEFT JOIN issue_external_refs AS refs ON refs.issue_id = issues.id
             WHERE issues.project_id = ?1 AND issues.del = 0
             ORDER BY issues.number ASC",
        )
        .map_err(query_failed)?;
    let rows = statement
        .query_map(params![project_id], |row| {
            let change_request_id: i64 = row.get(0)?;
            let issue_id: i64 = row.get(1)?;
            let local_number: i64 = row.get(2)?;
            let provider: Option<String> = row.get(3)?;
            let external_number: Option<i64> = row.get(4)?;
            let link_kind: String = row.get(5)?;
            Ok((
                change_request_id,
                ChangeRequestLinkedIssue {
                    issue_id,
                    label: link_label(local_number, provider.as_deref(), external_number),
                    link_kind,
                },
            ))
        })
        .map_err(query_failed)?;
    let mut links: HashMap<i64, Vec<ChangeRequestLinkedIssue>> = HashMap::new();
    for row in rows {
        let (change_request_id, link) = row.map_err(query_failed)?;
        links.entry(change_request_id).or_default().push(link);
    }
    Ok(links)
}

fn link_label(local_number: i64, provider: Option<&str>, external_number: Option<i64>) -> String {
    match (provider, external_number) {
        (Some("github"), Some(number)) => format!("GH #{number}"),
        (Some("gitlab"), Some(number)) => format!("GL #{number}"),
        _ => format!("#{local_number}"),
    }
}

fn matches_filter(row: &StoredChangeRequest, filter: &str) -> bool {
    match filter {
        "open" => is_open_like(&row.state),
        "closed" => is_closed_like(&row.state),
        _ => false,
    }
}

fn is_open_like(state: &str) -> bool {
    state == "open" || state == "draft"
}

fn is_closed_like(state: &str) -> bool {
    state == "merged" || state == "closed"
}

pub(super) fn query_failed(error: rusqlite::Error) -> CommandError {
    let _ = error;
    CommandError::new(
        CommandErrorCode::IssuePersistenceFailed,
        "Change request query failed.",
    )
}
