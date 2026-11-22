use rusqlite::{params, Connection, OptionalExtension};

use crate::db::issue_external_ref_repository::normalize_forge_host;
use crate::db::project_issue_source_repository::ProjectIssueSourceRepository;
use crate::features::issue::{ForgeIssueError, ForgeIssuePort, RemoteChangeRequest};
use crate::types::change_request::{ChangeRequestSyncOutcome, ChangeRequestSyncResult};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project_issue_source::{ForgeProvider, IssueSourceMode};

pub(crate) fn sync_project_change_requests(
    connection: &Connection,
    project_id: i64,
    forge: &impl ForgeIssuePort,
    now_ms: i64,
) -> Result<ChangeRequestSyncResult, CommandError> {
    let settings = ProjectIssueSourceRepository::new(connection)
        .get(project_id)
        .map_err(persistence)?
        .ok_or_else(|| project_not_found(project_id))?;
    if settings.issue_source_mode == IssueSourceMode::Local {
        return Ok(ChangeRequestSyncResult {
            outcome: ChangeRequestSyncOutcome::Skipped,
            error_code: None,
        });
    }
    let _guard = match crate::features::try_acquire_project_sync(connection, project_id) {
        Some(guard) => guard,
        None => {
            return Ok(ChangeRequestSyncResult {
                outcome: ChangeRequestSyncOutcome::Coalesced,
                error_code: None,
            });
        }
    };
    let provider = provider_name(settings.connection.provider)?;
    let host = settings
        .connection
        .host_url
        .as_deref()
        .map(normalize_forge_host)
        .filter(|host| !host.is_empty())
        .ok_or_else(missing_connection)?;
    let repo = settings
        .connection
        .repo_path
        .as_deref()
        .map(str::trim)
        .filter(|repo| !repo.is_empty())
        .map(str::to_string)
        .ok_or_else(missing_connection)?;
    let requests = match forge.list_change_requests() {
        Ok(requests) => requests,
        Err(error) => return fail_sync(connection, project_id, error),
    };
    for request in requests {
        if !is_supported_state(&request.state) {
            continue;
        }
        insert_change_request(
            connection, project_id, provider, &host, &repo, &request, now_ms,
        )?;
    }
    mark_synced(connection, project_id, now_ms)?;
    Ok(ChangeRequestSyncResult {
        outcome: ChangeRequestSyncOutcome::Synced,
        error_code: None,
    })
}

pub(crate) fn sync_connected_change_requests(
    connection: &Connection,
    project_id: i64,
    repo_dir: std::path::PathBuf,
    now_ms: i64,
) -> Result<ChangeRequestSyncResult, CommandError> {
    let provider = ProjectIssueSourceRepository::new(connection)
        .get(project_id)
        .map_err(persistence)?
        .and_then(|settings| settings.connection.provider);
    let forge = crate::features::issue::ProjectIssueForge::new(provider, repo_dir);
    sync_project_change_requests(connection, project_id, &forge, now_ms)
}

fn fail_sync(
    connection: &Connection,
    project_id: i64,
    error: ForgeIssueError,
) -> Result<ChangeRequestSyncResult, CommandError> {
    let (outcome, error_code) = match error {
        ForgeIssueError::Unauthenticated | ForgeIssueError::Forbidden => (
            ChangeRequestSyncOutcome::CredentialExpired,
            "credential_expired",
        ),
        ForgeIssueError::CliMissing => (ChangeRequestSyncOutcome::CacheFailed, "cli_missing"),
        ForgeIssueError::Offline => (ChangeRequestSyncOutcome::CacheFailed, "offline"),
        ForgeIssueError::RateLimited => (ChangeRequestSyncOutcome::CacheFailed, "rate_limited"),
        ForgeIssueError::CommandFailed
        | ForgeIssueError::Unparseable
        | ForgeIssueError::NotFound
        | ForgeIssueError::Gone => (ChangeRequestSyncOutcome::CacheFailed, "cache_failed"),
    };
    connection
        .execute(
            "UPDATE projects SET last_change_request_sync_error = ?1 WHERE id = ?2",
            params![error_code, project_id],
        )
        .map_err(persistence)?;
    Ok(ChangeRequestSyncResult {
        outcome,
        error_code: Some(error_code.to_string()),
    })
}

fn mark_synced(connection: &Connection, project_id: i64, now_ms: i64) -> Result<(), CommandError> {
    connection
        .execute(
            "UPDATE projects
             SET last_change_request_synced_at = ?1, last_change_request_sync_error = NULL
             WHERE id = ?2",
            params![now_ms, project_id],
        )
        .map_err(persistence)?;
    Ok(())
}

fn is_supported_state(state: &str) -> bool {
    matches!(state, "open" | "draft" | "merged" | "closed")
}

fn insert_change_request(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    host: &str,
    repo: &str,
    request: &RemoteChangeRequest,
    now_ms: i64,
) -> Result<(), CommandError> {
    let existing_id: Option<i64> = connection
        .query_row(
            "SELECT id FROM change_requests
             WHERE project_id = ?1 AND provider = ?2 AND host = ?3 AND repo = ?4 AND number = ?5",
            params![project_id, provider, host, repo, request.number],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(persistence)?;
    if let Some(change_request_id) = existing_id {
        connection
            .execute(
                "UPDATE change_requests
                 SET external_id = ?1, url = ?2, title = ?3, body = ?4, state = ?5,
                     author_login = ?6, source_branch = ?7, target_branch = ?8,
                     remote_updated_at = ?9, synced_at = ?10
                 WHERE id = ?11",
                params![
                    request.external_id,
                    request.url,
                    request.title,
                    request.body,
                    request.state,
                    request.author_login,
                    request.source_branch,
                    request.target_branch,
                    request.updated_at,
                    now_ms,
                    change_request_id,
                ],
            )
            .map_err(persistence)?;
        connection
            .execute(
                "UPDATE change_request_details SET fetched_at = ?1 WHERE change_request_id = ?2",
                params![now_ms, change_request_id],
            )
            .map_err(persistence)?;
        super::links::link_detected_issues(
            connection,
            project_id,
            provider,
            change_request_id,
            request,
            now_ms,
        )?;
        write_back_if_merged(connection, change_request_id, &request.state);
        return Ok(());
    }
    connection
        .execute(
            "INSERT INTO change_requests (
                project_id, provider, host, repo, external_id, number, url, title, body,
                state, author_login, source_branch, target_branch, remote_updated_at, synced_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
             )",
            params![
                project_id,
                provider,
                host,
                repo,
                request.external_id,
                request.number,
                request.url,
                request.title,
                request.body,
                request.state,
                request.author_login,
                request.source_branch,
                request.target_branch,
                request.updated_at,
                now_ms,
            ],
        )
        .map_err(persistence)?;
    let change_request_id = connection.last_insert_rowid();
    connection
        .execute(
            "INSERT INTO change_request_details (change_request_id, fetched_at) VALUES (?1, ?2)",
            params![change_request_id, now_ms],
        )
        .map_err(persistence)?;
    super::links::link_detected_issues(
        connection,
        project_id,
        provider,
        change_request_id,
        request,
        now_ms,
    )?;
    write_back_if_merged(connection, change_request_id, &request.state);
    Ok(())
}

// 详情刷新会先把 state 写成 merged。不能改成只在「非 merged → merged」时写回，
// 否则详情先落库后，列表同步看不到边沿。失败后再次进入由写回账本挡住，不再打宿主。
fn write_back_if_merged(connection: &Connection, change_request_id: i64, state: &str) {
    if state == "merged" {
        let _ = crate::features::issue::completion::merge_writeback::write_back_merged_change_request_from_repo(
            connection,
            change_request_id,
        );
    }
}

fn provider_name(provider: Option<ForgeProvider>) -> Result<&'static str, CommandError> {
    match provider {
        Some(ForgeProvider::Github) => Ok("github"),
        Some(ForgeProvider::Gitlab) => Ok("gitlab"),
        None => Err(missing_connection()),
    }
}

fn project_not_found(project_id: i64) -> CommandError {
    CommandError::new(CommandErrorCode::ProjectNotFound, "Project not found.")
        .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
}

fn missing_connection() -> CommandError {
    CommandError::new(
        CommandErrorCode::IssuePersistenceFailed,
        "Failed to sync change requests.",
    )
}

fn persistence(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::IssuePersistenceFailed,
        "Failed to sync change requests.",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
