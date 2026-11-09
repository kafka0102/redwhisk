use rusqlite::Connection;

use crate::db::project_issue_source_repository::{
    resolve_settings, ProjectIssueSourceError, ProjectIssueSourceRepository,
};
use crate::types::errors::CommandError;
use crate::types::project::ProjectSummary;
use crate::types::project::{CreateProjectIssueSourceInput, ValidatedExistingProject};
use crate::types::project_issue_source::{
    IssueCreateSource, IssueSourceMode, IssueSyncScope, ProjectIssueConnection,
    ProjectIssueSourceSettings, UpdateProjectIssueSourceSettings,
};

use super::issue_source::{database_error, project_not_found, validation_error};

pub(crate) fn ensure_issue_source_accepted(
    connection: &Connection,
    project_id: Option<i64>,
    input: &CreateProjectIssueSourceInput,
) -> Result<(), CommandError> {
    let current = match project_id {
        Some(project_id) => ProjectIssueSourceRepository::new(connection)
            .get(project_id)
            .map_err(database_error)?
            .ok_or_else(|| project_not_found(project_id))?,
        None => column_defaults(),
    };
    resolve_settings(&current, &patch(current.project_id, input)).map_err(map_issue_error)?;
    Ok(())
}

pub(crate) fn write_issue_source(
    connection: &Connection,
    project_id: i64,
    input: &CreateProjectIssueSourceInput,
) -> Result<(), CommandError> {
    ProjectIssueSourceRepository::new(connection)
        .update(patch(project_id, input))
        .map_err(map_issue_error)?;
    Ok(())
}

pub(crate) fn matched_project(
    connection: &Connection,
    project: &ProjectSummary,
) -> Result<ValidatedExistingProject, CommandError> {
    let settings = ProjectIssueSourceRepository::new(connection)
        .get(project.id)
        .map_err(database_error)?
        .ok_or_else(|| project_not_found(project.id))?;
    Ok(ValidatedExistingProject {
        id: project.id,
        removed: project.removed_at.is_some(),
        name: project.name.clone(),
        worktree_location: project.worktree_location,
        worktree_setup_command: project.worktree_setup_command.clone(),
        issue_source_mode: settings.issue_source_mode,
        issue_sync_scope: settings.issue_sync_scope,
        issue_sync_label: settings.issue_sync_label,
        issue_sync_enabled: settings.issue_sync_enabled,
        issue_sync_interval_seconds: settings.issue_sync_interval_seconds,
        issue_writeback_close_on_complete: settings.issue_writeback_close_on_complete,
        issue_writeback_close_on_pr_merge: settings.issue_writeback_close_on_pr_merge,
        issue_writeback_comment: settings.issue_writeback_comment,
        completion_action: project.completion_action,
        pr_target: project.pr_target,
        pr_draft: project.pr_draft,
        confirm_completion_action: project.confirm_completion_action,
    })
}

fn patch(
    project_id: i64,
    input: &CreateProjectIssueSourceInput,
) -> UpdateProjectIssueSourceSettings {
    UpdateProjectIssueSourceSettings {
        project_id,
        issue_source_mode: input.issue_source_mode,
        issue_sync_scope: input.issue_sync_scope,
        issue_sync_label: input.issue_sync_label.clone(),
        issue_sync_enabled: input.issue_sync_enabled,
        issue_sync_interval_seconds: input.issue_sync_interval_seconds,
        issue_writeback_close_on_complete: input.issue_writeback_close_on_complete,
        issue_writeback_close_on_pr_merge: input.issue_writeback_close_on_pr_merge,
        issue_writeback_comment: input.issue_writeback_comment,
        issue_create_source: None,
    }
}

fn column_defaults() -> ProjectIssueSourceSettings {
    ProjectIssueSourceSettings {
        project_id: 0,
        issue_source_mode: IssueSourceMode::Local,
        issue_sync_scope: IssueSyncScope::AssignedToMe,
        issue_sync_label: None,
        issue_sync_enabled: true,
        issue_sync_interval_seconds: 90,
        issue_writeback_close_on_complete: true,
        issue_writeback_close_on_pr_merge: true,
        issue_writeback_comment: true,
        issue_create_source: IssueCreateSource::Local,
        local_issue_count: 0,
        remote_issue_count: 0,
        connection: ProjectIssueConnection::unknown(),
    }
}

fn map_issue_error(error: ProjectIssueSourceError) -> CommandError {
    match error {
        ProjectIssueSourceError::NotFound => project_not_found(0),
        ProjectIssueSourceError::Validation(reason) => validation_error(reason),
        ProjectIssueSourceError::Database(error) => database_error(error),
    }
}
