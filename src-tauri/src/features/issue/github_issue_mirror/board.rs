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
    let issues = response
        .issues
        .into_iter()
        .map(|issue| {
            let projection = projections.get(&issue.id);
            let view = view_from(&issue, projection);
            IssueBoardRecord {
                source: view.source,
                provider: view.provider,
                external_number: view.external_number,
                remote_state: projection.and_then(|item| item.remote_state.clone()),
                remote_labels: view.remote_labels,
                sync_status: view.sync_status,
                remote_closed_while_running: view.remote_closed_while_running,
                remote_reopened: view.remote_reopened,
                issue,
            }
        })
        .collect();
    Ok(IssueBoardListResponse {
        issues,
        status_totals: response.status_totals,
    })
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
