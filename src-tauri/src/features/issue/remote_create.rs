use std::path::PathBuf;

use rusqlite::params;
use serde_json::json;

use crate::db::event_repository::EventRepository;
use crate::db::issue_external_ref_repository::normalize_forge_host;
use crate::db::issue_repository::IssueRepository;
use crate::db::project_issue_source_repository::ProjectIssueSourceRepository;
#[cfg(test)]
use crate::db::project_repository::ProjectRepository;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{CreateIssueInput, IssueRecord};
use crate::types::issue_action::{IssueActionActor, IssueActionType};
use crate::types::project_issue_source::{
    ForgeAuthStatus, ForgeProvider, IssueCreateSource, IssueSourceMode, ProjectIssueSourceSettings,
};

use super::attachment::{
    cleanup_created_files, persist_new_attachments, rewrite_attachment_tokens,
};
use super::github_issue_mirror::{
    ForgeIssueDraft, ForgeIssueError, ForgeIssuePort, ProjectIssueForge, RemoteIssue,
};
use super::service::IssueService;
use super::time::current_epoch_millis;
use super::validation::{
    issue_database_error, issue_not_found, serialize_label_ids, validate_title,
};

struct RemoteTarget {
    provider: ForgeProvider,
    host: String,
    repo: String,
}

struct MirrorFields {
    provider: String,
    host: String,
    repo: String,
    external_id: String,
    external_number: i64,
    external_url: String,
    remote_state: String,
    author_login: Option<String>,
    assignees_json: String,
    labels_json: String,
    remote_updated_at: i64,
    synced_at: i64,
}

enum Decision {
    Local,
    Remote(RemoteTarget),
}

pub(crate) fn create_issue(
    service: &IssueService<'_>,
    input: CreateIssueInput,
) -> Result<IssueRecord, CommandError> {
    dispatch(service, input, None, |_| Ok(()))
}

#[cfg(test)]
pub(crate) fn create_issue_with_forge(
    service: &IssueService<'_>,
    input: CreateIssueInput,
    forge: &dyn ForgeIssuePort,
    refresh: impl FnOnce(i64) -> Result<(), CommandError>,
) -> Result<IssueRecord, CommandError> {
    dispatch(service, input, Some(forge), refresh)
}

#[cfg(test)]
pub(crate) fn create_in_data_dir_with_forge(
    data_dir: impl AsRef<std::path::Path>,
    input: CreateIssueInput,
    forge: &dyn ForgeIssuePort,
) -> Result<IssueRecord, CommandError> {
    let database = super::archive::open_issue_database(data_dir)?;
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    create_issue_with_forge(&service, input, forge, |_| Ok(()))
}

fn dispatch(
    service: &IssueService<'_>,
    input: CreateIssueInput,
    forge: Option<&dyn ForgeIssuePort>,
    refresh: impl FnOnce(i64) -> Result<(), CommandError>,
) -> Result<IssueRecord, CommandError> {
    match decide(service, input.project_id)? {
        Decision::Local => insert_created_issue(service, &input, None),
        Decision::Remote(target) => create_remote(service, input, target, forge, refresh),
    }
}

fn create_remote(
    service: &IssueService<'_>,
    input: CreateIssueInput,
    target: RemoteTarget,
    forge: Option<&dyn ForgeIssuePort>,
    refresh: impl FnOnce(i64) -> Result<(), CommandError>,
) -> Result<IssueRecord, CommandError> {
    let title = validate_title(&input.title)?;
    service.validate_issue_label_ids(input.project_id, &input.label_ids)?;
    let draft = ForgeIssueDraft {
        title,
        body: input.description.trim().to_string(),
    };
    let created = match forge {
        Some(forge) => forge.create_issue(&draft).map_err(forge_create_error)?,
        None => {
            let project = service.require_project(input.project_id)?;
            let live =
                ProjectIssueForge::new(Some(target.provider), PathBuf::from(project.repo_path));
            live.create_issue(&draft).map_err(forge_create_error)?
        }
    };
    reject_unreadable(&created)?;
    let synced_at = match current_epoch_millis() {
        Ok(value) => value,
        Err(error) => return Err(attach_remote_url(error, &created.url)),
    };
    let mirror = mirror_fields(&created, &target, synced_at);
    let saved = insert_created_issue(service, &input, Some(&mirror))
        .map_err(|error| attach_remote_url(error, &created.url))?;
    let _ = refresh(saved.id);
    Ok(saved)
}

fn decide(service: &IssueService<'_>, project_id: i64) -> Result<Decision, CommandError> {
    service.require_project(project_id)?;
    let settings = ProjectIssueSourceRepository::new(service.issue_repository.connection())
        .get(project_id)
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(CommandErrorCode::ProjectNotFound, "Project not found.")
                .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
        })?;
    if !wants_remote(&settings) {
        return Ok(Decision::Local);
    }
    ready_target(&settings)
        .map(Decision::Remote)
        .ok_or_else(remote_unavailable)
}

fn wants_remote(settings: &ProjectIssueSourceSettings) -> bool {
    match settings.issue_source_mode {
        IssueSourceMode::Local => false,
        IssueSourceMode::Remote => true,
        IssueSourceMode::Mixed => settings.issue_create_source == IssueCreateSource::Remote,
    }
}

fn ready_target(settings: &ProjectIssueSourceSettings) -> Option<RemoteTarget> {
    if settings.connection.auth_status != ForgeAuthStatus::Ready {
        return None;
    }
    let provider = settings.connection.provider?;
    let host_url = settings.connection.host_url.as_deref()?.trim();
    let repo = settings.connection.repo_path.as_deref()?.trim();
    if host_url.is_empty() || repo.is_empty() {
        return None;
    }
    let host = normalize_forge_host(host_url);
    if host.is_empty() {
        return None;
    }
    Some(RemoteTarget {
        provider,
        host,
        repo: repo.to_string(),
    })
}

fn reject_unreadable(remote: &RemoteIssue) -> Result<(), CommandError> {
    if remote.url.trim().is_empty() || remote.number <= 0 || remote.external_id.trim().is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "Remote issue creation returned an unreadable issue.",
        )
        .with_reason("remoteCreateInvalid"));
    }
    Ok(())
}

fn mirror_fields(remote: &RemoteIssue, target: &RemoteTarget, synced_at: i64) -> MirrorFields {
    MirrorFields {
        provider: target.provider.as_str().to_string(),
        host: target.host.clone(),
        repo: target.repo.clone(),
        external_id: remote.external_id.clone(),
        external_number: remote.number,
        external_url: remote.url.clone(),
        remote_state: remote.state.as_str().to_string(),
        author_login: remote.author_login.clone(),
        assignees_json: serde_json::to_string(&remote.assignees)
            .unwrap_or_else(|_| "[]".to_string()),
        labels_json: serde_json::to_string(&remote.labels).unwrap_or_else(|_| "[]".to_string()),
        remote_updated_at: remote.updated_at,
        synced_at,
    }
}

fn insert_created_issue(
    service: &IssueService<'_>,
    input: &CreateIssueInput,
    mirror: Option<&MirrorFields>,
) -> Result<IssueRecord, CommandError> {
    let title = validate_title(&input.title)?;
    let description = input.description.trim().to_string();
    let label_ids = service.validate_issue_label_ids(input.project_id, &input.label_ids)?;
    let label_ids_json = serialize_label_ids(&label_ids)?;
    let transaction = service
        .issue_repository
        .connection()
        .unchecked_transaction()
        .map_err(issue_database_error)?;
    let issue = IssueRepository::insert_in_transaction(
        &transaction,
        input.project_id,
        &title,
        &description,
        &label_ids_json,
    )
    .map_err(issue_database_error)?;
    let (created_files, saved_issue) = match persist_new_attachments(
        &transaction,
        service.data_dir(),
        issue.id,
        issue.number,
        &input.attachments,
    ) {
        Ok((attachments, files)) => {
            let saved_issue = if attachments.is_empty() {
                issue
            } else {
                let rewritten = rewrite_attachment_tokens(&description, &attachments)?;
                IssueRepository::update_title_and_description_in_transaction(
                    &transaction,
                    input.project_id,
                    issue.id,
                    &title,
                    &rewritten,
                    &label_ids_json,
                )
                .map_err(issue_database_error)?
                .ok_or_else(|| issue_not_found(issue.id))?
            };
            (files, saved_issue)
        }
        Err(error) => {
            cleanup_created_files(&[]);
            return Err(error);
        }
    };
    if let Some(mirror) = mirror {
        if let Err(error) = write_mirror(&transaction, saved_issue.id, input.project_id, mirror) {
            cleanup_created_files(&created_files);
            return Err(error);
        }
    }
    let payload_json = json!({
        "title": saved_issue.title,
        "description": saved_issue.description,
        "labelIds": label_ids,
        "status": "backlog",
    })
    .to_string();
    EventRepository::insert_issue_action_in_transaction(
        &transaction,
        saved_issue.id,
        IssueActionType::IssueCreated,
        &payload_json,
        saved_issue.created_at,
        IssueActionActor::User { profile_id: 1 },
    )
    .map_err(issue_database_error)?;
    if let Err(error) = transaction.commit() {
        cleanup_created_files(&created_files);
        return Err(issue_database_error(error));
    }
    service
        .issue_repository
        .find_by_id(saved_issue.id)
        .map_err(issue_database_error)?
        .ok_or_else(|| issue_not_found(saved_issue.id))
        .and_then(|issue| service.hydrate_issue(issue))
}

fn write_mirror(
    transaction: &rusqlite::Transaction<'_>,
    issue_id: i64,
    project_id: i64,
    mirror: &MirrorFields,
) -> Result<(), CommandError> {
    transaction
        .execute(
            "UPDATE issues SET source = 'remote' WHERE id = ?1",
            params![issue_id],
        )
        .map_err(issue_database_error)?;
    transaction
        .execute(
            "INSERT INTO issue_external_refs (
                issue_id, project_id, provider, host, repo, external_id, external_number,
                external_url, remote_state, remote_author_login, remote_assignees_json,
                remote_labels_json, remote_updated_at, synced_at, sync_status,
                remote_closed_while_running, remote_reopened
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'synced', 0, 0
             )",
            params![
                issue_id,
                project_id,
                mirror.provider,
                mirror.host,
                mirror.repo,
                mirror.external_id,
                mirror.external_number,
                mirror.external_url,
                mirror.remote_state,
                mirror.author_login,
                mirror.assignees_json,
                mirror.labels_json,
                mirror.remote_updated_at,
                mirror.synced_at,
            ],
        )
        .map_err(issue_database_error)?;
    Ok(())
}

fn forge_create_error(error: ForgeIssueError) -> CommandError {
    let (reason, message) = match error {
        ForgeIssueError::Unauthenticated => (
            "remoteCreateUnauthenticated",
            "Remote issue creation failed authentication.",
        ),
        ForgeIssueError::Forbidden => {
            ("remoteCreateForbidden", "Remote issue creation was denied.")
        }
        ForgeIssueError::Offline => (
            "remoteCreateOffline",
            "Remote issue creation failed because the network is unavailable.",
        ),
        ForgeIssueError::Unparseable => (
            "remoteCreateInvalid",
            "Remote issue creation returned an unreadable issue.",
        ),
        ForgeIssueError::CliMissing
        | ForgeIssueError::RateLimited
        | ForgeIssueError::CommandFailed
        | ForgeIssueError::NotFound
        | ForgeIssueError::Gone => (
            "remoteCreateUnavailable",
            "Remote issue creation is unavailable.",
        ),
    };
    CommandError::new(CommandErrorCode::ForgeUnavailable, message).with_reason(reason)
}

fn remote_unavailable() -> CommandError {
    CommandError::new(
        CommandErrorCode::ForgeUnavailable,
        "Remote issue creation is unavailable.",
    )
    .with_reason("remoteCreateUnavailable")
}

fn attach_remote_url(error: CommandError, url: &str) -> CommandError {
    CommandError::new(
        CommandErrorCode::IssuePersistenceFailed,
        format!("Remote issue was created but the local mirror was not saved: {url}"),
    )
    .with_reason("remoteCreateMirrorFailed")
    .with_detail(ErrorDetail::new("RemoteIssue").with_value("url", url.to_string()))
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.message))
}

#[cfg(test)]
mod tests {
    use rusqlite::params;

    use super::super::github_issue_mirror::board::list_board_issues;
    use super::super::github_issue_mirror::{
        ready_github_project, FixedForge, RemoteIssue, RemoteIssueState,
    };
    use super::super::service::IssueService;
    use super::create_issue_with_forge;
    use crate::db::issue_repository::IssueRepository;
    use crate::db::project_repository::ProjectRepository;
    use crate::types::issue::CreateIssueInput;

    fn mirror_issue() -> RemoteIssue {
        RemoteIssue {
            external_id: "issue-128".to_string(),
            number: 128,
            title: "Mirror the remote issue".to_string(),
            body: "Created on the forge, stored once locally.".to_string(),
            state: RemoteIssueState::Open,
            is_pull_request: false,
            url: "https://github.com/acme/redwhisk/issues/128".to_string(),
            author_login: Some("lin".to_string()),
            assignees: vec!["yujianjia".to_string()],
            labels: vec!["sync".to_string()],
            updated_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn remote_create_persists_one_mirror() {
        let harness = ready_github_project("all_open", None);
        harness
            .connection
            .execute(
                "UPDATE projects SET issue_create_source = 'remote' WHERE id = ?1",
                params![harness.project_id],
            )
            .expect("choose remote");
        let service = IssueService::new(
            IssueRepository::new(&harness.connection),
            ProjectRepository::new(&harness.connection),
        );
        let forge = FixedForge::new(vec![mirror_issue()]).with_created(mirror_issue());
        let created = create_issue_with_forge(
            &service,
            CreateIssueInput {
                project_id: harness.project_id,
                title: "Mirror the remote issue".to_string(),
                description: "Created on the forge, stored once locally.".to_string(),
                attachments: Vec::new(),
                label_ids: Vec::new(),
            },
            &forge,
            |_| Ok(()),
        )
        .expect("remote create should succeed");

        let issues: i64 = harness
            .connection
            .query_row("SELECT COUNT(*) FROM issues", [], |row| row.get(0))
            .expect("issues");
        let refs: i64 = harness
            .connection
            .query_row("SELECT COUNT(*) FROM issue_external_refs", [], |row| {
                row.get(0)
            })
            .expect("refs");
        assert_eq!(issues, 1);
        assert_eq!(refs, 1);
        let row: (String, String, String, String, i64, String) = harness
            .connection
            .query_row(
                "SELECT remote_author_login, remote_labels_json, remote_assignees_json,
                        remote_state, external_number, external_url
                 FROM issue_external_refs",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .expect("external ref");
        assert_eq!(row.4, 128);
        assert_eq!(row.5, "https://github.com/acme/redwhisk/issues/128");
        assert_eq!(row.0, "lin");
        assert_eq!(row.1, "[\"sync\"]");
        assert_eq!(row.2, "[\"yujianjia\"]");
        assert_eq!(row.3, "open");
        let listed = list_board_issues(&harness.connection, harness.project_id).expect("board");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].external_number, Some(128));
    }
}
