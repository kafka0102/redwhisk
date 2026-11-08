//! Close and comment linked remote issues after a change request merges.
//! Reuses the completion write-back ledger. One failure does not undo another.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

#[cfg(test)]
use super::writeback::CompletionForge;
#[cfg(test)]
use super::writeback_store::apply_change_request_merge_writeback;
use super::writeback_store::apply_change_request_merge_writeback_with_cli;
#[cfg(test)]
use crate::features::issue::github_issue_mirror::ForgeIssueError;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

#[cfg(test)]
struct BorrowedForge<'a>(&'a dyn CompletionForge);

#[cfg(test)]
impl CompletionForge for BorrowedForge<'_> {
    fn close_issue(&self) -> Result<(), ForgeIssueError> {
        self.0.close_issue()
    }

    fn comment_issue(&self, body: &str) -> Result<(), ForgeIssueError> {
        self.0.comment_issue(body)
    }
}

#[cfg(test)]
pub(crate) fn write_back_merged_change_request<'a, F>(
    connection: &Connection,
    change_request_id: i64,
    forge_for: F,
) -> Result<(), CommandError>
where
    F: Fn(i64) -> Option<&'a dyn CompletionForge>,
{
    write_back_each(connection, change_request_id, |connection, issue_id| {
        let Some(forge) = forge_for(issue_id) else {
            return Ok(());
        };
        apply_change_request_merge_writeback(connection, issue_id, &BorrowedForge(forge))
    })
}

pub(crate) fn write_back_merged_change_request_from_repo(
    connection: &Connection,
    change_request_id: i64,
) -> Result<(), CommandError> {
    let repo_path = repo_path(connection, change_request_id)?;
    write_back_each(connection, change_request_id, |connection, issue_id| {
        apply_change_request_merge_writeback_with_cli(connection, issue_id, Path::new(&repo_path))
    })
}

fn write_back_each(
    connection: &Connection,
    change_request_id: i64,
    mut apply_issue: impl FnMut(&Connection, i64) -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    if !change_request_is_merged(connection, change_request_id)? {
        return Ok(());
    }
    let mut first_error = None;
    for issue_id in linked_issue_ids(connection, change_request_id)? {
        if let Err(error) = apply_issue(connection, issue_id) {
            if first_error.is_none() {
                first_error = Some(error);
            }
        }
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

fn change_request_is_merged(
    connection: &Connection,
    change_request_id: i64,
) -> Result<bool, CommandError> {
    let state = connection
        .query_row(
            "SELECT state FROM change_requests WHERE id = ?1",
            params![change_request_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(persistence)?;
    Ok(state.as_deref() == Some("merged"))
}

fn linked_issue_ids(
    connection: &Connection,
    change_request_id: i64,
) -> Result<Vec<i64>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT issues.id
             FROM change_request_issue_links AS links
             JOIN issues ON issues.id = links.issue_id
             WHERE links.change_request_id = ?1 AND issues.del = 0
             ORDER BY links.created_at ASC, issues.id ASC",
        )
        .map_err(persistence)?;
    let ids = statement
        .query_map(params![change_request_id], |row| row.get(0))
        .map_err(persistence)?
        .collect::<Result<Vec<i64>, _>>()
        .map_err(persistence)?;
    Ok(ids)
}

fn repo_path(connection: &Connection, change_request_id: i64) -> Result<String, CommandError> {
    connection
        .query_row(
            "SELECT projects.repo_path
             FROM change_requests
             JOIN projects ON projects.id = change_requests.project_id
             WHERE change_requests.id = ?1",
            params![change_request_id],
            |row| row.get(0),
        )
        .map_err(persistence)
}

fn persistence(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::IssuePersistenceFailed,
        "Failed to save completion write-back.",
    )
    .with_reason("writebackSaveFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
