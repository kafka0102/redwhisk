use rusqlite::{params, Connection};

use crate::features::issue::{ForgeIssueError, ForgeIssuePort};
use crate::types::change_request::{ChangeRequestDetail, ChangeRequestLinkedIssue};
use crate::types::errors::{CommandError, CommandErrorCode};

use super::detail_snapshot::{
    detail_from_fresh, detail_from_snapshot, has_snapshot, load_row, load_snapshot,
    unavailable_detail, write_fresh_snapshot,
};
use super::list::{ensure_project, query_failed};

pub(crate) fn get_project_change_request(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    number: i64,
    forge: &impl ForgeIssuePort,
    now_ms: i64,
) -> Result<ChangeRequestDetail, CommandError> {
    ensure_project(connection, project_id)?;
    let provider = normalize_provider(provider)?;
    if number < 1 {
        return Err(invalid_detail());
    }
    let row =
        load_row(connection, project_id, provider, number)?.ok_or_else(change_request_not_found)?;
    let snapshot = load_snapshot(connection, row.id)?;
    let linked_issues = load_linked_issues(connection, row.id)?;
    match forge.get_change_request_details(number) {
        Ok(details) => {
            write_fresh_snapshot(connection, row.id, &details, now_ms)?;
            let row = load_row(connection, project_id, provider, number)?
                .ok_or_else(change_request_not_found)?;
            Ok(detail_from_fresh(row, details, linked_issues))
        }
        Err(error) => {
            let detail_error = detail_error_code(error).to_string();
            if has_snapshot(&row, &snapshot) {
                Ok(detail_from_snapshot(
                    row,
                    snapshot,
                    linked_issues,
                    "cached",
                    Some(detail_error),
                ))
            } else {
                Ok(unavailable_detail(row, linked_issues, detail_error))
            }
        }
    }
}

fn load_linked_issues(
    connection: &Connection,
    change_request_id: i64,
) -> Result<Vec<ChangeRequestLinkedIssue>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT issues.id, issues.number, refs.provider, refs.external_number, links.link_kind
             FROM change_request_issue_links links
             JOIN issues ON issues.id = links.issue_id
             LEFT JOIN issue_external_refs refs ON refs.issue_id = issues.id
             WHERE links.change_request_id = ?1 AND issues.del = 0
             ORDER BY links.created_at ASC, issues.id ASC",
        )
        .map_err(query_failed)?;
    let rows = statement
        .query_map(params![change_request_id], |row| {
            let issue_id: i64 = row.get(0)?;
            let local_number: i64 = row.get(1)?;
            let provider: Option<String> = row.get(2)?;
            let external_number: Option<i64> = row.get(3)?;
            let link_kind: String = row.get(4)?;
            let label = match (provider.as_deref(), external_number) {
                (Some("github"), Some(number)) => format!("GH #{number}"),
                (Some("gitlab"), Some(number)) => format!("GL #{number}"),
                _ => format!("#{local_number}"),
            };
            Ok(ChangeRequestLinkedIssue {
                issue_id,
                label,
                link_kind,
            })
        })
        .map_err(query_failed)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(query_failed)
}

fn normalize_provider(provider: &str) -> Result<&str, CommandError> {
    match provider.trim() {
        "github" | "gitlab" => Ok(provider.trim()),
        _ => Err(invalid_detail()),
    }
}

fn invalid_detail() -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectValidationFailed,
        "Change request detail request is invalid.",
    )
    .with_reason("changeRequestDetailInvalid")
}

fn change_request_not_found() -> CommandError {
    CommandError::new(CommandErrorCode::IssueNotFound, "Change request not found.")
        .with_reason("changeRequestNotFound")
}

fn detail_error_code(error: ForgeIssueError) -> &'static str {
    match error {
        ForgeIssueError::Unauthenticated | ForgeIssueError::Forbidden => "credential_expired",
        ForgeIssueError::CliMissing => "cli_missing",
        ForgeIssueError::Offline => "offline",
        ForgeIssueError::RateLimited => "rate_limited",
        ForgeIssueError::CommandFailed
        | ForgeIssueError::Unparseable
        | ForgeIssueError::NotFound
        | ForgeIssueError::Gone => "cache_failed",
    }
}
