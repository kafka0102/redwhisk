//! Remote Issue unavailable recovery.
//!
//! A 404/410/forbidden probe keeps the local Issue and marks the external
//! identity unavailable. Keep-local, unlink, and retry share one entry.

use rusqlite::{Connection, OptionalExtension};

use std::path::Path;

use tauri::State;

use crate::app_state::AppState;
use super::github_issue_mirror::{view_remote_issue, ForgeIssueError};
use crate::types::errors::CommandError;
use crate::types::errors::{CommandErrorCode, ErrorDetail};
use crate::types::issue_detail::{
    ApplyIssueRecoveryInput, GetIssueDetailInput, IssueDetailRecord, RecoveryAction,
    UnavailableBanner,
};

use super::archive::open_issue_database;
use super::detail_read::read_issue_detail;
use super::validation::{issue_database_error, issue_not_found};

/// What a per-issue remote probe observed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemoteProbeKind {
    NotFound,
    Gone,
    Forbidden,
    Available,
    Failed,
}

/// Detail recovery entry. The three user actions and a probe share it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum IssueRecoveryRequest {
    Probe(RemoteProbeKind),
    KeepLocal,
    Unlink,
    Retry(RemoteProbeKind),
}

pub(crate) fn apply_issue_recovery_request(
    connection: &Connection,
    project_id: i64,
    issue_id: i64,
    request: IssueRecoveryRequest,
) -> Result<(), CommandError> {
    match request {
        IssueRecoveryRequest::KeepLocal => keep_local(connection, project_id, issue_id),
        IssueRecoveryRequest::Unlink => unlink(connection, project_id, issue_id),
        IssueRecoveryRequest::Probe(RemoteProbeKind::Available)
        | IssueRecoveryRequest::Retry(RemoteProbeKind::Available) => {
            mark_sync_status(connection, project_id, issue_id, "synced")
        }
        IssueRecoveryRequest::Probe(_) | IssueRecoveryRequest::Retry(_) => {
            mark_sync_status(connection, project_id, issue_id, "unavailable")
        }
    }
}

pub(crate) fn refresh_remote_availability(
    connection: &Connection,
    project_id: i64,
    issue_id: i64,
) -> Result<(), CommandError> {
    let linked = connection
        .query_row(
            "SELECT provider, external_number, sync_status
             FROM issue_external_refs
             WHERE issue_id = ?1 AND project_id = ?2",
            rusqlite::params![issue_id, project_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(issue_database_error)?;
    let Some((provider, number, status)) = linked else {
        return Ok(());
    };
    if status == "kept_local" || status == "unlinked" {
        return Ok(());
    }
    let repo_path: Option<String> = connection
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(issue_database_error)?;
    let Some(repo_path) = repo_path.filter(|path| !path.trim().is_empty()) else {
        return Ok(());
    };
    let request = match view_remote_issue(&provider, Path::new(&repo_path), number) {
        Ok(()) => IssueRecoveryRequest::Probe(RemoteProbeKind::Available),
        Err(ForgeIssueError::NotFound) => IssueRecoveryRequest::Probe(RemoteProbeKind::NotFound),
        Err(ForgeIssueError::Gone) => IssueRecoveryRequest::Probe(RemoteProbeKind::Gone),
        Err(ForgeIssueError::Forbidden) => IssueRecoveryRequest::Probe(RemoteProbeKind::Forbidden),
        Err(_) => return Ok(()),
    };
    apply_issue_recovery_request(connection, project_id, issue_id, request)
}

pub(crate) fn apply_issue_recovery_in_data_dir(
    data_dir: &Path,
    input: ApplyIssueRecoveryInput,
) -> Result<IssueDetailRecord, CommandError> {
    let database = open_issue_database(data_dir)?;
    let request = match input.action {
        RecoveryAction::KeepLocal => IssueRecoveryRequest::KeepLocal,
        RecoveryAction::Unlink => IssueRecoveryRequest::Unlink,
        RecoveryAction::Retry => IssueRecoveryRequest::Retry(probe_for_retry(
            &database.connection,
            input.project_id,
            input.issue_id,
        )?),
    };
    apply_issue_recovery_request(
        &database.connection,
        input.project_id,
        input.issue_id,
        request,
    )?;
    read_issue_detail(
        &database.connection,
        &GetIssueDetailInput {
            project_id: input.project_id,
            issue_id: input.issue_id,
        },
    )
}

fn probe_for_retry(
    connection: &Connection,
    project_id: i64,
    issue_id: i64,
) -> Result<RemoteProbeKind, CommandError> {
    let linked = connection
        .query_row(
            "SELECT provider, external_number
             FROM issue_external_refs
             WHERE issue_id = ?1 AND project_id = ?2",
            rusqlite::params![issue_id, project_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(issue_database_error)?
        .ok_or_else(|| issue_not_found(issue_id))?;
    let repo_path: String = connection
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(issue_database_error)?
        .filter(|path: &String| !path.trim().is_empty())
        .ok_or_else(|| issue_not_found(issue_id))?;
    Ok(
        match view_remote_issue(&linked.0, Path::new(&repo_path), linked.1) {
            Ok(()) => RemoteProbeKind::Available,
            Err(ForgeIssueError::NotFound) => RemoteProbeKind::NotFound,
            Err(ForgeIssueError::Gone) => RemoteProbeKind::Gone,
            Err(ForgeIssueError::Forbidden) => RemoteProbeKind::Forbidden,
            Err(_) => RemoteProbeKind::Failed,
        },
    )
}

#[tauri::command]
pub async fn apply_issue_recovery(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ApplyIssueRecoveryInput,
) -> Result<IssueDetailRecord, CommandError> {
    let data_dir = super::commands::prepare_issue_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || apply_issue_recovery_in_data_dir(&data_dir, input))
        .await
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::IssuePersistenceFailed,
                "Failed to recover the unavailable issue.",
            )
            .with_reason("recoveryFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?
}

pub(crate) fn unavailable_banner(
    connection: &Connection,
    issue_id: i64,
) -> Result<Option<UnavailableBanner>, CommandError> {
    let status = sync_status(connection, issue_id)?;
    Ok(match status.as_deref() {
        Some("unavailable") => Some(UnavailableBanner {
            actions: vec![
                RecoveryAction::KeepLocal,
                RecoveryAction::Unlink,
                RecoveryAction::Retry,
            ],
            shows_delete_confirmation: false,
        }),
        _ => None,
    })
}

pub(crate) fn hides_linked_projection(
    connection: &Connection,
    issue_id: i64,
) -> Result<bool, CommandError> {
    Ok(matches!(
        sync_status(connection, issue_id)?.as_deref(),
        Some("kept_local" | "unlinked")
    ))
}

pub(crate) fn sync_skips_issue(connection: &Connection, issue_id: i64) -> rusqlite::Result<bool> {
    let status: Option<String> = connection
        .query_row(
            "SELECT sync_status FROM issue_external_refs WHERE issue_id = ?1",
            rusqlite::params![issue_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(matches!(status.as_deref(), Some("kept_local" | "unlinked")))
}

fn keep_local(connection: &Connection, project_id: i64, issue_id: i64) -> Result<(), CommandError> {
    mark_sync_status(connection, project_id, issue_id, "kept_local")?;
    let updated = connection
        .execute(
            "UPDATE issues SET source = 'local' WHERE id = ?1 AND project_id = ?2 AND del = 0",
            rusqlite::params![issue_id, project_id],
        )
        .map_err(issue_database_error)?;
    if updated == 0 {
        return Err(issue_not_found(issue_id));
    }
    Ok(())
}

fn unlink(connection: &Connection, project_id: i64, issue_id: i64) -> Result<(), CommandError> {
    let identity = connection
        .query_row(
            "SELECT provider, external_url
             FROM issue_external_refs
             WHERE issue_id = ?1 AND project_id = ?2",
            rusqlite::params![issue_id, project_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(issue_database_error)?
        .ok_or_else(|| issue_not_found(issue_id))?;
    mark_sync_status(connection, project_id, issue_id, "unlinked")?;
    let payload = serde_json::json!({ "externalUrl": identity.1 }).to_string();
    connection
        .execute(
            "INSERT INTO issue_remote_events (
                issue_id, provider, remote_event_id, event_type, payload_json, remote_created_at
             ) VALUES (?1, ?2, 'remote-origin', 'remote_origin', ?3, 1)",
            rusqlite::params![issue_id, identity.0, payload],
        )
        .map_err(issue_database_error)?;
    Ok(())
}

fn mark_sync_status(
    connection: &Connection,
    project_id: i64,
    issue_id: i64,
    sync_status: &str,
) -> Result<(), CommandError> {
    let updated = connection
        .execute(
            "UPDATE issue_external_refs
             SET sync_status = ?1
             WHERE issue_id = ?2 AND project_id = ?3",
            rusqlite::params![sync_status, issue_id, project_id],
        )
        .map_err(issue_database_error)?;
    if updated == 0 {
        return Err(issue_not_found(issue_id));
    }
    Ok(())
}

fn sync_status(connection: &Connection, issue_id: i64) -> Result<Option<String>, CommandError> {
    connection
        .query_row(
            "SELECT sync_status FROM issue_external_refs WHERE issue_id = ?1",
            rusqlite::params![issue_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(issue_database_error)
}

#[cfg(test)]
#[path = "unavailable_recovery_test.rs"]
mod tests;

#[cfg(test)]
#[path = "unavailable_recovery_actions_test.rs"]
mod action_tests;
