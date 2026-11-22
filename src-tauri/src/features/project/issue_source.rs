use std::path::Path;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::agent::command_lookup_process::{output_with_timeout, LookupProcessError};
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::project_issue_source_repository::{
    ProjectIssueSourceError, ProjectIssueSourceRepository,
};
use crate::db::project_repository::ProjectRepository;
use crate::git::command::apply_interactive_path;
use crate::git::forge::{cli_is_installed, inspect_forge_remote, ForgeHost};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project_issue_source::{
    ForgeAuthStatus, ForgeProvider, IssueCreateSource, IssueDisplayMode, IssueSourceMode,
    IssueSyncScope, ProjectIssueConnection, ProjectIssueSourceSettings,
    UpdateProjectIssueSourceSettings, UpdateProjectIssueSourceSettingsInput,
};

const CLI_AUTH_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CliAuthSample {
    pub installed: bool,
    pub outcome: CliAuthOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CliAuthOutcome {
    Finished { success: bool, output: String },
    TimedOut,
    FailedToStart,
}

pub(crate) fn get_project_issue_source_settings_in_data_dir(
    data_dir: impl AsRef<Path>,
    project_id: i64,
) -> Result<ProjectIssueSourceSettings, CommandError> {
    let database = open_database(data_dir)?;
    ProjectIssueSourceRepository::new(&database.connection)
        .get(project_id)
        .map_err(database_error)?
        .ok_or_else(|| project_not_found(project_id))
}

pub(crate) fn update_project_issue_source_settings_in_data_dir(
    data_dir: impl AsRef<Path>,
    input: UpdateProjectIssueSourceSettingsInput,
) -> Result<ProjectIssueSourceSettings, CommandError> {
    let database = open_database(data_dir)?;
    let patch = parse_update(&input)?;
    ProjectIssueSourceRepository::new(&database.connection)
        .update(patch)
        .map_err(|error| match error {
            ProjectIssueSourceError::NotFound => project_not_found(input.project_id),
            ProjectIssueSourceError::Validation(reason) => validation_error(reason),
            ProjectIssueSourceError::Database(error) => database_error(error),
        })
}

pub(crate) fn inspect_project_issue_connection_in_data_dir(
    data_dir: impl AsRef<Path>,
    project_id: i64,
) -> Result<ProjectIssueSourceSettings, CommandError> {
    inspect_connection(data_dir, project_id, None)
}

#[cfg(test)]
pub(crate) fn inspect_project_issue_connection_with_sample(
    data_dir: impl AsRef<Path>,
    project_id: i64,
    sample: CliAuthSample,
) -> Result<ProjectIssueSourceSettings, CommandError> {
    inspect_connection(data_dir, project_id, Some(sample))
}

fn inspect_connection(
    data_dir: impl AsRef<Path>,
    project_id: i64,
    sample: Option<CliAuthSample>,
) -> Result<ProjectIssueSourceSettings, CommandError> {
    let database = open_database(data_dir)?;
    let project = ProjectRepository::new(&database.connection)
        .find_by_id(project_id)
        .map_err(database_error)?
        .ok_or_else(|| project_not_found(project_id))?;
    let connection = inspect_repo_connection(Path::new(&project.repo_path), sample);
    save_connection(&database.connection, project_id, &connection)?;
    ProjectIssueSourceRepository::new(&database.connection)
        .get(project_id)
        .map_err(database_error)?
        .ok_or_else(|| project_not_found(project_id))
}

/// 只根据仓库路径探测连接，不读也不写 `project_forge_connections`。
pub(crate) fn inspect_repo_connection(
    repo_path: &Path,
    sample: Option<CliAuthSample>,
) -> ProjectIssueConnection {
    let remote = inspect_forge_remote(repo_path);
    let identity = match remote.host {
        ForgeHost::Github | ForgeHost::Gitlab => remote
            .remote_label
            .as_deref()
            .and_then(|label| forge_identity(remote.host, label)),
        ForgeHost::None => None,
    };
    match identity {
        None => ProjectIssueConnection {
            provider: None,
            host_url: None,
            repo_path: None,
            login: None,
            cli_installed: false,
            cli_authenticated: false,
            auth_status: ForgeAuthStatus::NotForge,
            checked_at: now_millis(),
        },
        Some((provider, host_url, repo_path)) => classify_connection(
            provider,
            host_url,
            repo_path,
            sample.unwrap_or_else(|| probe_cli(provider)),
        ),
    }
}

fn forge_identity(host: ForgeHost, label: &str) -> Option<(ForgeProvider, String, String)> {
    let provider = match host {
        ForgeHost::Github => ForgeProvider::Github,
        ForgeHost::Gitlab => ForgeProvider::Gitlab,
        ForgeHost::None => return None,
    };
    let (host_name, repo_path) = label.split_once('/')?;
    if host_name.is_empty() || repo_path.is_empty() {
        return None;
    }
    Some((
        provider,
        format!("https://{host_name}"),
        repo_path.to_string(),
    ))
}

fn classify_connection(
    provider: ForgeProvider,
    host_url: String,
    repo_path: String,
    sample: CliAuthSample,
) -> ProjectIssueConnection {
    if !sample.installed {
        return ProjectIssueConnection {
            provider: Some(provider),
            host_url: Some(host_url),
            repo_path: Some(repo_path),
            login: None,
            cli_installed: false,
            cli_authenticated: false,
            auth_status: ForgeAuthStatus::CliMissing,
            checked_at: now_millis(),
        };
    }
    let checked_at = now_millis();
    let (auth_status, login, cli_authenticated) = match sample.outcome {
        CliAuthOutcome::TimedOut | CliAuthOutcome::FailedToStart => {
            (ForgeAuthStatus::Unknown, None, false)
        }
        CliAuthOutcome::Finished { success, output } => {
            if output.to_ascii_lowercase().contains("expired") {
                (ForgeAuthStatus::Expired, None, false)
            } else if !success {
                (ForgeAuthStatus::Unauthenticated, None, false)
            } else {
                (ForgeAuthStatus::Ready, parse_cli_login(&output), true)
            }
        }
    };
    ProjectIssueConnection {
        provider: Some(provider),
        host_url: Some(host_url),
        repo_path: Some(repo_path),
        login,
        cli_installed: true,
        cli_authenticated,
        auth_status,
        checked_at,
    }
}

pub(crate) fn parse_cli_login(output: &str) -> Option<String> {
    for line in output.lines() {
        if line.to_ascii_lowercase().contains("token") {
            continue;
        }
        if let Some(login) = login_after(line, " account ") {
            return Some(login);
        }
        if let Some(login) = login_after(line, " as ") {
            return Some(login);
        }
    }
    None
}

fn login_after(line: &str, marker: &str) -> Option<String> {
    let (_, rest) = line.split_once(marker)?;
    let login = rest.split_whitespace().next()?.trim();
    if login.is_empty() {
        None
    } else {
        Some(login.to_string())
    }
}

fn probe_cli(provider: ForgeProvider) -> CliAuthSample {
    let cli = match provider {
        ForgeProvider::Github => "gh",
        ForgeProvider::Gitlab => "glab",
    };
    if !cli_is_installed(cli) {
        return CliAuthSample {
            installed: false,
            outcome: CliAuthOutcome::FailedToStart,
        };
    }
    let mut command = Command::new(cli);
    command.args(["auth", "status"]);
    apply_interactive_path(&mut command);
    match output_with_timeout(command, CLI_AUTH_TIMEOUT) {
        Ok(output) => {
            let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
            text.push_str(&String::from_utf8_lossy(&output.stderr));
            CliAuthSample {
                installed: true,
                outcome: CliAuthOutcome::Finished {
                    success: output.status.success(),
                    output: text,
                },
            }
        }
        Err(LookupProcessError::Timeout) => CliAuthSample {
            installed: true,
            outcome: CliAuthOutcome::TimedOut,
        },
        Err(_) => CliAuthSample {
            installed: true,
            outcome: CliAuthOutcome::FailedToStart,
        },
    }
}

fn save_connection(
    connection: &rusqlite::Connection,
    project_id: i64,
    snapshot: &ProjectIssueConnection,
) -> Result<(), CommandError> {
    connection
        .execute(
            "INSERT INTO project_forge_connections (
                project_id, provider, host_url, repo_path, login, auth_kind, auth_status,
                scopes_json, cli_installed, cli_authenticated, checked_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'cli', ?6, '[]', ?7, ?8, ?9)
             ON CONFLICT(project_id) DO UPDATE SET
                provider = excluded.provider,
                host_url = excluded.host_url,
                repo_path = excluded.repo_path,
                login = excluded.login,
                auth_kind = excluded.auth_kind,
                auth_status = excluded.auth_status,
                scopes_json = excluded.scopes_json,
                cli_installed = excluded.cli_installed,
                cli_authenticated = excluded.cli_authenticated,
                checked_at = excluded.checked_at",
            rusqlite::params![
                project_id,
                snapshot.provider.map(|provider| provider.as_str()),
                snapshot.host_url,
                snapshot.repo_path,
                snapshot.login,
                snapshot.auth_status.as_str(),
                bool_to_int(snapshot.cli_installed),
                bool_to_int(snapshot.cli_authenticated),
                snapshot.checked_at,
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn parse_update(
    input: &UpdateProjectIssueSourceSettingsInput,
) -> Result<UpdateProjectIssueSourceSettings, CommandError> {
    Ok(UpdateProjectIssueSourceSettings {
        project_id: input.project_id,
        issue_source_mode: optional_mode(input.issue_source_mode.as_ref())?,
        issue_display_mode: optional_display_mode(input.issue_display_mode.as_ref())?,
        issue_sync_scope: optional_scope(input.issue_sync_scope.as_ref())?,
        issue_sync_label: optional_text(input.issue_sync_label.as_ref())?,
        issue_sync_enabled: optional_bool(input.issue_sync_enabled.as_ref())?,
        issue_sync_interval_seconds: optional_interval(input.issue_sync_interval_seconds.as_ref())?,
        issue_writeback_close_on_complete: optional_bool(
            input.issue_writeback_close_on_complete.as_ref(),
        )?,
        issue_writeback_close_on_pr_merge: optional_bool(
            input.issue_writeback_close_on_pr_merge.as_ref(),
        )?,
        issue_writeback_comment: optional_bool(input.issue_writeback_comment.as_ref())?,
        issue_create_source: optional_create_source(input.issue_create_source.as_ref())?,
    })
}

fn optional_display_mode(
    value: Option<&Option<Value>>,
) -> Result<Option<IssueDisplayMode>, CommandError> {
    match value {
        None => Ok(None),
        Some(Some(Value::String(text))) => IssueDisplayMode::parse(text)
            .map(Some)
            .ok_or_else(|| validation_error("issueDisplayModeInvalid")),
        Some(_) => Err(validation_error("issueDisplayModeInvalid")),
    }
}

fn optional_mode(value: Option<&Value>) -> Result<Option<IssueSourceMode>, CommandError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => IssueSourceMode::parse(text)
            .map(Some)
            .ok_or_else(|| validation_error("issueSourceModeInvalid")),
        Some(_) => Err(validation_error("issueSourceModeInvalid")),
    }
}

fn optional_scope(value: Option<&Value>) -> Result<Option<IssueSyncScope>, CommandError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => IssueSyncScope::parse(text)
            .map(Some)
            .ok_or_else(|| validation_error("issueSyncScopeInvalid")),
        Some(_) => Err(validation_error("issueSyncScopeInvalid")),
    }
}

fn optional_create_source(
    value: Option<&Value>,
) -> Result<Option<IssueCreateSource>, CommandError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => IssueCreateSource::parse(text)
            .map(Some)
            .ok_or_else(|| validation_error("issueSourceSettingsInvalid")),
        Some(_) => Err(validation_error("issueSourceSettingsInvalid")),
    }
}

fn optional_text(value: Option<&Value>) -> Result<Option<String>, CommandError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err(validation_error("issueSourceSettingsInvalid")),
    }
}

fn optional_bool(value: Option<&Value>) -> Result<Option<bool>, CommandError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(flag)) => Ok(Some(*flag)),
        Some(_) => Err(validation_error("issueSourceSettingsInvalid")),
    }
}

fn optional_interval(value: Option<&Value>) -> Result<Option<i64>, CommandError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => {
            let interval = number
                .as_i64()
                .ok_or_else(|| validation_error("issueSyncIntervalInvalid"))?;
            if interval < 60 {
                return Err(validation_error("issueSyncIntervalInvalid"));
            }
            Ok(Some(interval))
        }
        Some(_) => Err(validation_error("issueSyncIntervalInvalid")),
    }
}

fn open_database(
    data_dir: impl AsRef<Path>,
) -> Result<crate::db::connection::Database, CommandError> {
    let database = DatabaseConfig::new(data_dir)
        .open()
        .map_err(CommandError::from)?;
    MigrationRunner::default()
        .run(&database.connection)
        .map_err(database_error)?;
    Ok(database)
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

pub(crate) fn project_not_found(project_id: i64) -> CommandError {
    CommandError::new(CommandErrorCode::ProjectNotFound, "Project not found.")
        .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
}

pub(crate) fn validation_error(reason: &'static str) -> CommandError {
    let message = match reason {
        "issueDisplayModeInvalid" => "Issue display mode must be either board or list.",
        "issueSourceModeInvalid" => "Issue source mode is invalid.",
        "issueSyncScopeInvalid" => "Issue sync scope is invalid.",
        "issueSyncIntervalInvalid" => {
            "Issue sync interval must be an integer of at least 60 seconds."
        }
        "issueSyncLabelRequired" => "Issue sync label is required.",
        _ => "Issue source settings are invalid.",
    };
    CommandError::new(CommandErrorCode::ProjectValidationFailed, message).with_reason(reason)
}

pub(crate) fn database_error(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectPersistenceFailed,
        "Failed to save issue source settings.",
    )
    .with_reason("saveFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
