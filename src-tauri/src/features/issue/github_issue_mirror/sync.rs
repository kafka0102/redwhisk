use rusqlite::{params, Connection, OptionalExtension};

use crate::db::issue_external_ref_repository::{
    normalize_forge_host, IssueExternalRefRepository, NewIssueExternalRef,
};
use crate::db::issue_repository::IssueRepository;
use crate::db::project_issue_source_repository::ProjectIssueSourceRepository;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{issue_status_to_str, IssueStatus};
use crate::types::issue_mirror::{IssueSyncOutcome, IssueSyncResult};
use crate::types::project_issue_source::{
    ForgeAuthStatus, ForgeProvider, IssueSourceMode, IssueSyncScope, ProjectIssueSourceSettings,
};

use super::port::{
    ForgeIssueError, ForgeIssueListQuery, ForgeIssuePort, RemoteIssue, RemoteIssueState,
};

pub(crate) fn sync_connected_issues(
    connection: &Connection,
    project_id: i64,
    repo_dir: std::path::PathBuf,
    now_ms: i64,
) -> Result<IssueSyncResult, CommandError> {
    let provider = ProjectIssueSourceRepository::new(connection)
        .get(project_id)
        .map_err(persistence)?
        .and_then(|settings| settings.connection.provider);
    let forge = super::cli::ProjectIssueForge::new(provider, repo_dir);
    sync_project_issues(connection, project_id, &forge, now_ms)
}

pub fn sync_project_issues(
    connection: &Connection,
    project_id: i64,
    forge: &impl ForgeIssuePort,
    now_ms: i64,
) -> Result<IssueSyncResult, CommandError> {
    let settings = ProjectIssueSourceRepository::new(connection)
        .get(project_id)
        .map_err(persistence)?
        .ok_or_else(|| project_not_found(project_id))?;
    if settings.issue_source_mode == IssueSourceMode::Local {
        return Ok(IssueSyncResult {
            outcome: IssueSyncOutcome::Skipped,
        });
    }
    let _guard = match crate::features::try_acquire_project_sync(connection, project_id) {
        Some(guard) => guard,
        None => {
            return Ok(IssueSyncResult {
                outcome: IssueSyncOutcome::Coalesced,
            });
        }
    };
    let label = label_filter(&settings)?;
    let refs = IssueExternalRefRepository::new(connection);
    match settings.connection.auth_status {
        // Cached auth and CLI observations are not a permanent verdict. A later
        // `glab auth login` or PATH fix is observed by the live list call.
        ForgeAuthStatus::Expired
        | ForgeAuthStatus::Unauthenticated
        | ForgeAuthStatus::CliMissing
        | ForgeAuthStatus::Ready => {}
        _ => {
            refs.mark_sync_error(project_id, "cache_failed")
                .map_err(persistence)?;
            return Ok(IssueSyncResult {
                outcome: IssueSyncOutcome::CacheFailed,
            });
        }
    }
    let provider = match settings.connection.provider {
        Some(ForgeProvider::Github) => "github",
        Some(ForgeProvider::Gitlab) => "gitlab",
        _ => {
            refs.mark_sync_error(project_id, "cache_failed")
                .map_err(persistence)?;
            return Ok(IssueSyncResult {
                outcome: IssueSyncOutcome::CacheFailed,
            });
        }
    };
    let Some(host) = settings
        .connection
        .host_url
        .as_deref()
        .map(normalize_forge_host)
        .filter(|host| !host.is_empty())
    else {
        refs.mark_sync_error(project_id, "cache_failed")
            .map_err(persistence)?;
        return Ok(IssueSyncResult {
            outcome: IssueSyncOutcome::CacheFailed,
        });
    };
    let Some(repo) = settings
        .connection
        .repo_path
        .as_deref()
        .map(str::trim)
        .filter(|repo| !repo.is_empty())
        .map(str::to_string)
    else {
        refs.mark_sync_error(project_id, "cache_failed")
            .map_err(persistence)?;
        return Ok(IssueSyncResult {
            outcome: IssueSyncOutcome::CacheFailed,
        });
    };

    let (last_synced_at, _) = refs.sync_clock(project_id).map_err(persistence)?;
    let query = ForgeIssueListQuery {
        assignee: if settings.issue_sync_scope == IssueSyncScope::AssignedToMe {
            Some("@me".to_string())
        } else {
            None
        },
        states: if settings.issue_sync_scope == IssueSyncScope::All {
            vec![RemoteIssueState::Open, RemoteIssueState::Closed]
        } else {
            vec![RemoteIssueState::Open]
        },
        label,
        limit: if last_synced_at.is_some() { 200 } else { 500 },
        updated_after: last_synced_at,
    };
    let listed = match forge.list_issues(&query) {
        Ok(issues) => issues,
        Err(error) => {
            let outcome = match &error {
                ForgeIssueError::Unauthenticated => IssueSyncOutcome::CredentialExpired,
                _ => IssueSyncOutcome::CacheFailed,
            };
            refs.mark_sync_error(project_id, list_sync_error(&error))
                .map_err(persistence)?;
            return Ok(IssueSyncResult { outcome });
        }
    };
    for remote in listed {
        if remote.is_pull_request {
            continue;
        }
        apply_remote(
            connection, project_id, provider, &host, &repo, &remote, now_ms,
        )?;
    }
    refs.mark_sync_success(project_id, now_ms)
        .map_err(persistence)?;
    Ok(IssueSyncResult {
        outcome: IssueSyncOutcome::Synced,
    })
}

fn list_sync_error(error: &ForgeIssueError) -> &'static str {
    match error {
        ForgeIssueError::CliMissing => "cli_missing",
        ForgeIssueError::Offline => "offline",
        ForgeIssueError::RateLimited => "rate_limited",
        ForgeIssueError::Unauthenticated => "credential_expired",
        ForgeIssueError::CommandFailed
        | ForgeIssueError::Unparseable
        | ForgeIssueError::Forbidden
        | ForgeIssueError::NotFound
        | ForgeIssueError::Gone => "cache_failed",
    }
}

fn label_filter(settings: &ProjectIssueSourceSettings) -> Result<Option<String>, CommandError> {
    if settings.issue_sync_scope != IssueSyncScope::Label {
        return Ok(None);
    }
    let label = settings
        .issue_sync_label
        .as_deref()
        .map(str::trim)
        .unwrap_or("");
    if label.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::ProjectValidationFailed,
            "Issue sync label is required.",
        )
        .with_reason("issueSyncLabelRequired"));
    }
    Ok(Some(label.to_string()))
}

fn apply_remote(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    host: &str,
    repo: &str,
    remote: &RemoteIssue,
    now_ms: i64,
) -> Result<(), CommandError> {
    let refs = IssueExternalRefRepository::new(connection);
    let existing = refs
        .find_by_external_id(provider, host, &remote.external_id)
        .map_err(persistence)?
        .or(refs
            .find_by_external_number(project_id, provider, host, repo, remote.number)
            .map_err(persistence)?);
    if let Some(issue_id) = existing {
        if super::super::unavailable_recovery::sync_skips_issue(connection, issue_id)
            .map_err(persistence)?
        {
            return Ok(());
        }
    }
    if remote.title.trim().is_empty() {
        if let Some(issue_id) = existing {
            refs.mark_ref_error(issue_id).map_err(persistence)?;
        }
        return Ok(());
    }
    if let Some(issue_id) = existing {
        update_existing(
            connection, project_id, provider, host, repo, issue_id, remote, now_ms,
        )
    } else {
        insert_new(connection, project_id, provider, host, repo, remote, now_ms)
    }
}

fn insert_new(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    host: &str,
    repo: &str,
    remote: &RemoteIssue,
    now_ms: i64,
) -> Result<(), CommandError> {
    let tx = connection.unchecked_transaction().map_err(persistence)?;
    let created = IssueRepository::insert_in_transaction(
        &tx,
        project_id,
        remote.title.trim(),
        &remote.body,
        "[]",
    )
    .map_err(persistence)?;
    let refs = IssueExternalRefRepository::new(connection);
    refs.set_source_remote(created.id).map_err(persistence)?;
    let decision = decide(
        IssueStatus::Backlog,
        remote.state == RemoteIssueState::Open,
        false,
        false,
    );
    if decision.next != IssueStatus::Backlog {
        IssueRepository::update_status_in_transaction(&tx, project_id, created.id, decision.next)
            .map_err(persistence)?;
    }
    let labels_json = json_list(&remote.labels);
    let assignees_json = super::assignee::assignees_json(remote);
    refs.insert_ref(&ref_row(
        created.id,
        project_id,
        provider,
        host,
        repo,
        remote,
        now_ms,
        "synced",
        &decision,
        &assignees_json,
        &labels_json,
    ))
    .map_err(persistence)?;
    tx.commit().map_err(persistence)?;
    Ok(())
}

fn update_existing(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    host: &str,
    repo: &str,
    issue_id: i64,
    remote: &RemoteIssue,
    now_ms: i64,
) -> Result<(), CommandError> {
    let refs = IssueExternalRefRepository::new(connection);
    let Some(identity) = refs.issue_identity(issue_id).map_err(persistence)? else {
        return Ok(());
    };
    if identity.deleted {
        return Ok(());
    }
    let local = parse_status(&identity.status);
    let has_session = refs
        .linked_session_count(project_id, issue_id)
        .map_err(persistence)?
        > 0;
    let previously_closed = previously_remote_closed(connection, issue_id)?;
    let decision = decide(
        local,
        remote.state == RemoteIssueState::Open,
        has_session,
        previously_closed,
    );
    let tx = connection.unchecked_transaction().map_err(persistence)?;
    refs.update_visible_text(issue_id, remote.title.trim(), &remote.body)
        .map_err(persistence)?;
    if decision.next != local {
        IssueRepository::update_status_in_transaction(&tx, project_id, issue_id, decision.next)
            .map_err(persistence)?;
    }
    if decision.write_action {
        refs.insert_remote_status_action(
            issue_id,
            issue_status_to_str(&local),
            issue_status_to_str(&decision.next),
            now_ms,
        )
        .map_err(persistence)?;
    }
    let labels_json = json_list(&remote.labels);
    let assignees_json = super::assignee::assignees_json(remote);
    refs.update_ref(&ref_row(
        issue_id,
        project_id,
        provider,
        host,
        repo,
        remote,
        now_ms,
        "synced",
        &decision,
        &assignees_json,
        &labels_json,
    ))
    .map_err(persistence)?;
    tx.commit().map_err(persistence)?;
    Ok(())
}

struct StatusDecision {
    next: IssueStatus,
    write_action: bool,
    remote_closed_while_running: bool,
    remote_reopened: bool,
}

fn previously_remote_closed(connection: &Connection, issue_id: i64) -> Result<bool, CommandError> {
    let state = connection
        .query_row(
            "SELECT remote_state FROM issue_external_refs WHERE issue_id = ?1",
            params![issue_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(persistence)?;
    Ok(state.as_deref() == Some("closed"))
}

fn decide(
    local: IssueStatus,
    remote_open: bool,
    has_session: bool,
    previously_closed: bool,
) -> StatusDecision {
    if remote_open {
        if local == IssueStatus::Completed && !has_session && previously_closed {
            return StatusDecision {
                next: IssueStatus::Backlog,
                write_action: true,
                remote_closed_while_running: false,
                remote_reopened: false,
            };
        }
        if local == IssueStatus::Completed && has_session {
            return StatusDecision {
                next: IssueStatus::Completed,
                write_action: false,
                remote_closed_while_running: false,
                remote_reopened: true,
            };
        }
        return StatusDecision {
            next: local,
            write_action: false,
            remote_closed_while_running: false,
            remote_reopened: false,
        };
    }
    match local {
        IssueStatus::Backlog | IssueStatus::Review => StatusDecision {
            next: IssueStatus::Completed,
            write_action: true,
            remote_closed_while_running: false,
            remote_reopened: false,
        },
        IssueStatus::Running => StatusDecision {
            next: IssueStatus::Running,
            write_action: false,
            remote_closed_while_running: true,
            remote_reopened: false,
        },
        IssueStatus::Completed => StatusDecision {
            next: IssueStatus::Completed,
            write_action: false,
            remote_closed_while_running: false,
            remote_reopened: false,
        },
    }
}

fn ref_row<'value>(
    issue_id: i64,
    project_id: i64,
    provider: &'value str,
    host: &'value str,
    repo: &'value str,
    remote: &'value RemoteIssue,
    now_ms: i64,
    sync_status: &'value str,
    decision: &StatusDecision,
    assignees_json: &'value str,
    labels_json: &'value str,
) -> NewIssueExternalRef<'value> {
    NewIssueExternalRef {
        issue_id,
        project_id,
        provider,
        host,
        repo,
        external_id: &remote.external_id,
        external_number: remote.number,
        external_url: &remote.url,
        remote_state: remote.state.as_str(),
        author_login: remote.author_login.as_deref(),
        assignees_json,
        labels_json,
        remote_updated_at: remote.updated_at,
        synced_at: now_ms,
        sync_status,
        remote_closed_while_running: decision.remote_closed_while_running,
        remote_reopened: decision.remote_reopened,
    }
}

fn json_list(values: &[String]) -> String {
    serde_json::to_string(values).unwrap_or_else(|_| "[]".to_string())
}

fn parse_status(value: &str) -> IssueStatus {
    match value {
        "running" => IssueStatus::Running,
        "review" => IssueStatus::Review,
        "completed" => IssueStatus::Completed,
        _ => IssueStatus::Backlog,
    }
}

fn project_not_found(project_id: i64) -> CommandError {
    CommandError::new(CommandErrorCode::ProjectNotFound, "Project not found.")
        .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
}

fn persistence(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::IssuePersistenceFailed,
        "Failed to sync GitHub issues.",
    )
    .with_reason("syncFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
