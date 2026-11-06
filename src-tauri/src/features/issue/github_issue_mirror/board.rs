use std::collections::HashMap;
use std::path::Path;

use rusqlite::Connection;
use serde::Serialize;

use crate::db::issue_external_ref_repository::IssueExternalRefRepository;
use crate::features::issue::archive::open_issue_database;
use crate::types::errors::CommandError;
use crate::types::issue::{IssueListResponse, IssueRecord, IssueStatus, IssueStatusTotals};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoardIssueView {
    pub id: i64,
    pub source: String,
    pub status: IssueStatus,
    pub external_number: Option<i64>,
    pub provider: Option<String>,
    pub remote_labels: Vec<String>,
    pub sync_status: Option<String>,
    pub remote_closed_while_running: bool,
    pub remote_reopened: bool,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueBoardRecord {
    #[serde(flatten)]
    pub issue: IssueRecord,
    pub source: String,
    pub provider: Option<String>,
    pub external_number: Option<i64>,
    pub remote_state: Option<String>,
    pub remote_labels: Vec<String>,
    pub sync_status: Option<String>,
    pub remote_closed_while_running: bool,
    pub remote_reopened: bool,
    pub pull_request_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueBoardListResponse {
    pub issues: Vec<IssueBoardRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_totals: Option<IssueStatusTotals>,
}

#[cfg(test)]
pub fn list_board_issues(
    connection: &Connection,
    project_id: i64,
) -> Result<Vec<BoardIssueView>, CommandError> {
    use crate::db::issue_repository::IssueRepository;
    use crate::db::project_repository::ProjectRepository;
    use crate::features::issue::service::IssueService;

    let response = IssueService::new(
        IssueRepository::new(connection),
        ProjectRepository::new(connection),
    )
    .list_issues(project_id)?;
    let projections = projection_map(connection, project_id)?;
    Ok(response
        .issues
        .into_iter()
        .map(|issue| view_from(&issue, projections.get(&issue.id)))
        .collect())
}

pub fn enrich_issue_list(
    data_dir: &Path,
    response: IssueListResponse,
) -> Result<IssueBoardListResponse, CommandError> {
    let project_id = response.issues.first().map(|issue| issue.project_id);
    let database = open_issue_database(data_dir)?;
    let projections = match project_id {
        Some(project_id) => projection_map(&database.connection, project_id)?,
        None => HashMap::new(),
    };
    let pull_request_urls = match project_id {
        Some(project_id) => latest_pull_request_urls(&database.connection, project_id)?,
        None => HashMap::new(),
    };
    let issues = response.issues.into_iter().map(|issue| {
        let projection = projections.get(&issue.id);
        let view = view_from(&issue, projection);
        let pull_request_url = pull_request_urls.get(&issue.id).cloned();
        board_record(issue, &view, projection, pull_request_url)
    });
    Ok(IssueBoardListResponse {
        issues: issues.collect(),
        status_totals: response.status_totals,
    })
}

#[cfg(test)]
pub fn list_board_with_source_filter(
    connection: &Connection,
    project_id: i64,
    source_filter: &str,
) -> Result<IssueBoardListResponse, CommandError> {
    list_board_page(
        connection,
        project_id,
        Some(source_filter),
        None,
        None,
        None,
        None,
    )
}

pub fn list_board_page(
    connection: &Connection,
    project_id: i64,
    source_filter: Option<&str>,
    status: Option<IssueStatus>,
    limit: Option<i64>,
    offset: Option<i64>,
    per_status_limit: Option<i64>,
) -> Result<IssueBoardListResponse, CommandError> {
    let filtered = filtered_board(connection, project_id, source_filter.unwrap_or(""))?;
    Ok(apply_board_page(
        filtered,
        status,
        limit,
        offset,
        per_status_limit,
    ))
}

pub fn load_issue_board(
    data_dir: &Path,
    project_id: i64,
    source_filter: Option<&str>,
    status: Option<IssueStatus>,
    limit: Option<i64>,
    offset: Option<i64>,
    per_status_limit: Option<i64>,
) -> Result<IssueBoardListResponse, CommandError> {
    let database = open_issue_database(data_dir)?;
    let mode = issue_source_mode(&database.connection, project_id)?;
    let filter = canonical_source_filter(source_filter.unwrap_or(""));
    if mode == "mixed" && filter != "all" {
        return list_board_page(
            &database.connection,
            project_id,
            Some(filter),
            status,
            limit,
            offset,
            per_status_limit,
        );
    }

    use crate::db::issue_repository::IssueRepository;
    use crate::db::project_repository::ProjectRepository;
    use crate::features::issue::service::IssueService;

    let response = {
        let service = IssueService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
        );
        if let Some(per_status_limit) = per_status_limit {
            service.list_issues_per_status(project_id, per_status_limit)?
        } else if status.is_some() || limit.is_some() || offset.is_some() {
            service.list_issues_page(project_id, status, limit, offset)?
        } else {
            service.list_issues(project_id)?
        }
    };
    drop(database);
    enrich_issue_list(data_dir, response)
}

fn filtered_board(
    connection: &Connection,
    project_id: i64,
    source_filter: &str,
) -> Result<IssueBoardListResponse, CommandError> {
    use crate::db::issue_repository::IssueRepository;
    use crate::db::project_repository::ProjectRepository;
    use crate::features::issue::service::IssueService;

    let response = IssueService::new(
        IssueRepository::new(connection),
        ProjectRepository::new(connection),
    )
    .list_issues(project_id)?;
    let projections = projection_map(connection, project_id)?;
    let pull_request_urls = latest_pull_request_urls(connection, project_id)?;
    let mode = issue_source_mode(connection, project_id)?;
    let filter = canonical_source_filter(source_filter);
    let mut totals = IssueStatusTotals::default();
    let mut issues = Vec::new();
    for issue in response.issues {
        let projection = projections.get(&issue.id);
        let view = view_from(&issue, projection);
        if !source_filter_keeps(&mode, filter, &view.source) {
            continue;
        }
        match issue.status {
            IssueStatus::Backlog => totals.backlog += 1,
            IssueStatus::Running => totals.running += 1,
            IssueStatus::Review => totals.review += 1,
            IssueStatus::Completed => totals.completed += 1,
        }
        let pull_request_url = pull_request_urls.get(&issue.id).cloned();
        issues.push(board_record(issue, &view, projection, pull_request_url));
    }
    Ok(IssueBoardListResponse {
        issues,
        status_totals: Some(totals),
    })
}

fn apply_board_page(
    response: IssueBoardListResponse,
    status: Option<IssueStatus>,
    limit: Option<i64>,
    offset: Option<i64>,
    per_status_limit: Option<i64>,
) -> IssueBoardListResponse {
    let IssueBoardListResponse {
        issues,
        status_totals,
    } = response;
    if let Some(per_status_limit) = per_status_limit {
        let cap = per_status_limit.max(0);
        let mut paged = Vec::new();
        for lane in [
            IssueStatus::Backlog,
            IssueStatus::Running,
            IssueStatus::Review,
            IssueStatus::Completed,
        ] {
            let mut taken = 0i64;
            for issue in issues.iter().filter(|issue| issue.issue.status == lane) {
                if taken >= cap {
                    break;
                }
                paged.push(issue.clone());
                taken += 1;
            }
        }
        return IssueBoardListResponse {
            issues: paged,
            status_totals,
        };
    }

    if status.is_some() || limit.is_some() || offset.is_some() {
        let offset = usize::try_from(offset.unwrap_or(0).max(0)).unwrap_or(usize::MAX);
        let filtered = issues
            .into_iter()
            .filter(|issue| status.is_none_or(|lane| issue.issue.status == lane))
            .skip(offset);
        let issues = if let Some(limit) = limit {
            filtered
                .take(usize::try_from(limit.max(0)).unwrap_or(usize::MAX))
                .collect()
        } else {
            filtered.collect()
        };
        return IssueBoardListResponse {
            issues,
            status_totals,
        };
    }

    IssueBoardListResponse {
        issues,
        status_totals,
    }
}

pub fn canonical_source_filter(source_filter: &str) -> &'static str {
    match source_filter.trim() {
        "local" => "local",
        "remote" => "remote",
        _ => "all",
    }
}

fn source_filter_keeps(mode: &str, filter: &str, source: &str) -> bool {
    mode != "mixed" || filter == "all" || source == filter
}

fn issue_source_mode(connection: &Connection, project_id: i64) -> Result<String, CommandError> {
    connection
        .query_row(
            "SELECT issue_source_mode FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .map_err(|error| {
            CommandError::new(
                crate::types::errors::CommandErrorCode::IssuePersistenceFailed,
                "Failed to read issue source mode.",
            )
            .with_reason("queryFailed")
            .with_detail(
                crate::types::errors::ErrorDetail::new("Cause")
                    .with_value("message", error.to_string()),
            )
        })
}

fn board_record(
    issue: IssueRecord,
    view: &BoardIssueView,
    projection: Option<&crate::db::issue_external_ref_repository::IssueMirrorProjection>,
    pull_request_url: Option<String>,
) -> IssueBoardRecord {
    IssueBoardRecord {
        source: view.source.clone(),
        provider: view.provider.clone(),
        external_number: view.external_number,
        remote_state: projection.and_then(|item| item.remote_state.clone()),
        remote_labels: view.remote_labels.clone(),
        sync_status: view.sync_status.clone(),
        remote_closed_while_running: view.remote_closed_while_running,
        remote_reopened: view.remote_reopened,
        pull_request_url,
        issue,
    }
}

fn view_from(
    issue: &IssueRecord,
    projection: Option<&crate::db::issue_external_ref_repository::IssueMirrorProjection>,
) -> BoardIssueView {
    let Some(projection) = projection else {
        return BoardIssueView {
            id: issue.id,
            source: "local".to_string(),
            status: issue.status,
            external_number: None,
            provider: None,
            remote_labels: Vec::new(),
            sync_status: None,
            remote_closed_while_running: false,
            remote_reopened: false,
            title: issue.title.clone(),
        };
    };
    BoardIssueView {
        id: issue.id,
        source: projection.source.clone(),
        status: issue.status,
        external_number: projection.external_number,
        provider: projection.provider.clone(),
        remote_labels: projection
            .remote_labels_json
            .as_deref()
            .and_then(|json| serde_json::from_str(json).ok())
            .unwrap_or_default(),
        sync_status: projection.sync_status.clone(),
        remote_closed_while_running: projection.remote_closed_while_running,
        remote_reopened: projection.remote_reopened,
        title: issue.title.clone(),
    }
}

fn projection_map(
    connection: &Connection,
    project_id: i64,
) -> Result<
    HashMap<i64, crate::db::issue_external_ref_repository::IssueMirrorProjection>,
    CommandError,
> {
    let rows = IssueExternalRefRepository::new(connection)
        .projections_for_project(project_id)
        .map_err(|error| {
            crate::types::errors::CommandError::new(
                crate::types::errors::CommandErrorCode::IssuePersistenceFailed,
                "Failed to list GitHub issues.",
            )
            .with_reason("queryFailed")
            .with_detail(
                crate::types::errors::ErrorDetail::new("Cause")
                    .with_value("message", error.to_string()),
            )
        })?;
    Ok(rows.into_iter().collect())
}

fn latest_pull_request_urls(
    connection: &Connection,
    project_id: i64,
) -> Result<HashMap<i64, String>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT pull_requests.issue_id, pull_requests.url
             FROM issue_pull_requests AS pull_requests
             INNER JOIN issues ON issues.id = pull_requests.issue_id
             WHERE issues.project_id = ?1
             ORDER BY pull_requests.created_at DESC",
        )
        .map_err(pull_request_query_error)?;
    let rows = statement
        .query_map(rusqlite::params![project_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(pull_request_query_error)?;
    let mut urls = HashMap::new();
    for row in rows {
        let (issue_id, url) = row.map_err(pull_request_query_error)?;
        urls.entry(issue_id).or_insert(url);
    }
    Ok(urls)
}

fn pull_request_query_error(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        crate::types::errors::CommandErrorCode::IssuePersistenceFailed,
        "Failed to read issue pull requests.",
    )
    .with_reason("queryFailed")
    .with_detail(
        crate::types::errors::ErrorDetail::new("Cause").with_value("message", error.to_string()),
    )
}
