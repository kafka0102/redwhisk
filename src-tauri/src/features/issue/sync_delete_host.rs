use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use super::github_issue_mirror::capture_forge_stdout;
use super::github_issue_mirror::ForgeIssueError;
use super::validation::{issue_database_error, issue_not_found};
use crate::types::errors::{CommandError, CommandErrorCode};

struct HostIdentity {
    source: String,
    provider: Option<String>,
    external_number: Option<i64>,
}

pub(crate) fn delete_host_issue(
    connection: &Connection,
    repo_path: &str,
    project_id: i64,
    issue_id: i64,
) -> Result<(), CommandError> {
    let identity = load_identity(connection, project_id, issue_id)?;
    let (program, number) = host_target(&identity)?;
    let args = delete_args(number);
    capture_forge_stdout(program, &args, Path::new(repo_path))
        .map(|_| ())
        .map_err(ForgeIssueError::sync_delete_host_failure)
}

fn load_identity(
    connection: &Connection,
    project_id: i64,
    issue_id: i64,
) -> Result<HostIdentity, CommandError> {
    connection
        .query_row(
            "SELECT issues.source, refs.provider, refs.external_number
             FROM issues
             LEFT JOIN issue_external_refs AS refs ON refs.issue_id = issues.id
             WHERE issues.id = ?1 AND issues.project_id = ?2 AND issues.del = 0",
            params![issue_id, project_id],
            |row| {
                Ok(HostIdentity {
                    source: row.get(0)?,
                    provider: row.get(1)?,
                    external_number: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(issue_database_error)?
        .ok_or_else(|| issue_not_found(issue_id))
}

fn host_target(identity: &HostIdentity) -> Result<(&'static str, i64), CommandError> {
    if identity.source != "remote" {
        return Err(not_remote());
    }
    let program = match identity.provider.as_deref() {
        Some("github") => "gh",
        Some("gitlab") => "glab",
        _ => return Err(identity_missing()),
    };
    let Some(number) = identity.external_number else {
        return Err(identity_missing());
    };
    Ok((program, number))
}

fn delete_args(number: i64) -> Vec<String> {
    vec![
        "issue".to_string(),
        "delete".to_string(),
        number.to_string(),
        "--yes".to_string(),
    ]
}

fn not_remote() -> CommandError {
    CommandError::new(
        CommandErrorCode::IssueValidationFailed,
        "Only a GitHub or GitLab remote issue can delete the host issue. The local copy was not deleted.",
    )
    .with_reason("syncDeleteHostNotRemote")
}

fn identity_missing() -> CommandError {
    CommandError::new(
        CommandErrorCode::IssueValidationFailed,
        "This remote issue has no host identity. The local copy was not deleted.",
    )
    .with_reason("syncDeleteHostIdentityMissing")
}

impl ForgeIssueError {
    pub(crate) fn sync_delete_host_failure(self) -> CommandError {
        let (reason, message) = match self {
            Self::NotFound => (
                "syncDeleteHostNotFound",
                "The host issue was not found. The local copy was not deleted.",
            ),
            Self::Gone => (
                "syncDeleteHostGone",
                "This host issue is gone. The local copy was not deleted.",
            ),
            Self::Unauthenticated => (
                "syncDeleteHostUnauthenticated",
                "Sign in to GitHub or GitLab before deleting the host issue. The local copy was not deleted.",
            ),
            Self::Forbidden => (
                "syncDeleteHostForbidden",
                "You do not have permission to delete this host issue. The local copy was not deleted.",
            ),
            Self::Offline => (
                "syncDeleteHostOffline",
                "The network is unavailable. Neither the host issue nor the local copy was deleted.",
            ),
            Self::CliMissing | Self::RateLimited | Self::CommandFailed | Self::Unparseable => (
                "syncDeleteHostUnavailable",
                "The host issue could not be deleted right now. The local copy was not deleted.",
            ),
        };
        CommandError::new(CommandErrorCode::ForgeUnavailable, message).with_reason(reason)
    }
}
