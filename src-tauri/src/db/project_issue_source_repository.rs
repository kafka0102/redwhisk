use rusqlite::{params, OptionalExtension};

use crate::types::project_issue_source::{
    ForgeAuthStatus, ForgeProvider, IssueCreateSource, IssueSourceMode, IssueSyncScope,
    ProjectIssueConnection, ProjectIssueSourceSettings, UpdateProjectIssueSourceSettings,
};

#[derive(Debug)]
pub enum ProjectIssueSourceError {
    NotFound,
    Validation(&'static str),
    Database(rusqlite::Error),
}

impl std::fmt::Display for ProjectIssueSourceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("project not found"),
            Self::Validation(reason) => formatter.write_str(reason),
            Self::Database(error) => write!(formatter, "{error}"),
        }
    }
}

impl From<rusqlite::Error> for ProjectIssueSourceError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}

pub struct ProjectIssueSourceRepository<'connection> {
    connection: &'connection rusqlite::Connection,
}

impl<'connection> ProjectIssueSourceRepository<'connection> {
    pub fn new(connection: &'connection rusqlite::Connection) -> Self {
        Self { connection }
    }

    pub fn get(&self, project_id: i64) -> rusqlite::Result<Option<ProjectIssueSourceSettings>> {
        let Some(settings) = self
            .connection
            .query_row(
                "SELECT issue_source_mode, issue_sync_scope, issue_sync_label, issue_sync_enabled,
                    issue_sync_interval_seconds, issue_writeback_close_on_complete,
                    issue_writeback_close_on_pr_merge, issue_writeback_comment, issue_create_source
             FROM projects WHERE id = ?1",
                params![project_id],
                |row| {
                    Ok(ProjectIssueSourceSettings {
                        project_id,
                        issue_source_mode: IssueSourceMode::parse(&row.get::<_, String>(0)?)
                            .ok_or(rusqlite::Error::InvalidQuery)?,
                        issue_sync_scope: IssueSyncScope::parse(&row.get::<_, String>(1)?)
                            .ok_or(rusqlite::Error::InvalidQuery)?,
                        issue_sync_label: row.get(2)?,
                        issue_sync_enabled: row.get::<_, i64>(3)? != 0,
                        issue_sync_interval_seconds: row.get(4)?,
                        issue_writeback_close_on_complete: row.get::<_, i64>(5)? != 0,
                        issue_writeback_close_on_pr_merge: row.get::<_, i64>(6)? != 0,
                        issue_writeback_comment: row.get::<_, i64>(7)? != 0,
                        issue_create_source: IssueCreateSource::parse(&row.get::<_, String>(8)?)
                            .ok_or(rusqlite::Error::InvalidQuery)?,
                        connection: ProjectIssueConnection::unknown(),
                    })
                },
            )
            .optional()?
        else {
            return Ok(None);
        };

        let connection = self.read_connection(project_id)?;
        Ok(Some(ProjectIssueSourceSettings {
            connection,
            ..settings
        }))
    }

    pub fn update(
        &self,
        input: UpdateProjectIssueSourceSettings,
    ) -> Result<ProjectIssueSourceSettings, ProjectIssueSourceError> {
        let current = self
            .get(input.project_id)?
            .ok_or(ProjectIssueSourceError::NotFound)?;
        let next = resolve_settings(&current, &input)?;
        let updated = self.connection.execute(
            "UPDATE projects
             SET issue_source_mode = ?2,
                 issue_sync_scope = ?3,
                 issue_sync_label = ?4,
                 issue_sync_enabled = ?5,
                 issue_sync_interval_seconds = ?6,
                 issue_writeback_close_on_complete = ?7,
                 issue_writeback_close_on_pr_merge = ?8,
                 issue_writeback_comment = ?9,
                 issue_create_source = ?10
             WHERE id = ?1",
            params![
                next.project_id,
                next.issue_source_mode.as_str(),
                next.issue_sync_scope.as_str(),
                next.issue_sync_label,
                bool_to_int(next.issue_sync_enabled),
                next.issue_sync_interval_seconds,
                bool_to_int(next.issue_writeback_close_on_complete),
                bool_to_int(next.issue_writeback_close_on_pr_merge),
                bool_to_int(next.issue_writeback_comment),
                next.issue_create_source.as_str(),
            ],
        )?;
        if updated == 0 {
            return Err(ProjectIssueSourceError::NotFound);
        }
        self.get(input.project_id)?
            .ok_or(ProjectIssueSourceError::NotFound)
    }

    fn read_connection(&self, project_id: i64) -> rusqlite::Result<ProjectIssueConnection> {
        let row = self
            .connection
            .query_row(
                "SELECT provider, host_url, repo_path, login, cli_installed, cli_authenticated,
                        auth_status, checked_at
                 FROM project_forge_connections
                 WHERE project_id = ?1",
                params![project_id],
                |row| {
                    let provider = match row.get::<_, Option<String>>(0)? {
                        Some(value) => Some(
                            ForgeProvider::parse(&value).ok_or(rusqlite::Error::InvalidQuery)?,
                        ),
                        None => None,
                    };
                    let auth_status = ForgeAuthStatus::parse(&row.get::<_, String>(6)?)
                        .ok_or(rusqlite::Error::InvalidQuery)?;
                    Ok(ProjectIssueConnection {
                        provider,
                        host_url: row.get(1)?,
                        repo_path: row.get(2)?,
                        login: row.get(3)?,
                        cli_installed: row.get::<_, i64>(4)? != 0,
                        cli_authenticated: row.get::<_, i64>(5)? != 0,
                        auth_status,
                        checked_at: row.get(7)?,
                    })
                },
            )
            .optional()?;
        Ok(row.unwrap_or_else(ProjectIssueConnection::unknown))
    }
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn resolve_settings(
    current: &ProjectIssueSourceSettings,
    input: &UpdateProjectIssueSourceSettings,
) -> Result<ProjectIssueSourceSettings, ProjectIssueSourceError> {
    let mut next = current.clone();
    if let Some(mode) = input.issue_source_mode {
        next.issue_source_mode = mode;
        match mode {
            IssueSourceMode::Local => next.issue_create_source = IssueCreateSource::Local,
            IssueSourceMode::Remote => next.issue_create_source = IssueCreateSource::Remote,
            IssueSourceMode::Mixed => {
                if let Some(create_source) = input.issue_create_source {
                    next.issue_create_source = create_source;
                }
            }
        }
    } else if next.issue_source_mode == IssueSourceMode::Mixed {
        if let Some(create_source) = input.issue_create_source {
            next.issue_create_source = create_source;
        }
    }

    if let Some(scope) = input.issue_sync_scope {
        next.issue_sync_scope = scope;
    }
    if next.issue_sync_scope == IssueSyncScope::Label {
        if let Some(label) = &input.issue_sync_label {
            let trimmed = label.trim();
            if trimmed.is_empty() {
                return Err(ProjectIssueSourceError::Validation(
                    "issueSyncLabelRequired",
                ));
            }
            next.issue_sync_label = Some(trimmed.to_string());
        } else if next
            .issue_sync_label
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        {
            return Err(ProjectIssueSourceError::Validation(
                "issueSyncLabelRequired",
            ));
        }
    } else {
        next.issue_sync_label = None;
    }

    if let Some(enabled) = input.issue_sync_enabled {
        next.issue_sync_enabled = enabled;
    }
    if let Some(interval) = input.issue_sync_interval_seconds {
        if interval < 60 {
            return Err(ProjectIssueSourceError::Validation(
                "issueSyncIntervalInvalid",
            ));
        }
        next.issue_sync_interval_seconds = interval;
    }
    if let Some(enabled) = input.issue_writeback_close_on_complete {
        next.issue_writeback_close_on_complete = enabled;
    }
    if let Some(enabled) = input.issue_writeback_close_on_pr_merge {
        next.issue_writeback_close_on_pr_merge = enabled;
    }
    if let Some(enabled) = input.issue_writeback_comment {
        next.issue_writeback_comment = enabled;
    }
    Ok(next)
}

#[cfg(test)]
#[path = "project_issue_source_repository_tests.rs"]
mod tests;
