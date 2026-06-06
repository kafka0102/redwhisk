use std::path::Path;

use serde_json::json;

use crate::db::connection::DatabaseConfig;
use crate::db::event_repository::EventRepository;
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{CreateIssueInput, IssueListResponse, IssueRecord, UpdateIssueInput};
use crate::types::issue_action::IssueActionType;

pub struct IssueService<'connection> {
    issue_repository: IssueRepository<'connection>,
    project_repository: ProjectRepository<'connection>,
}

impl<'connection> IssueService<'connection> {
    pub fn new(
        issue_repository: IssueRepository<'connection>,
        project_repository: ProjectRepository<'connection>,
    ) -> Self {
        Self {
            issue_repository,
            project_repository,
        }
    }

    pub fn list_issues(&self, project_id: i64) -> Result<IssueListResponse, CommandError> {
        self.ensure_project_exists(project_id)?;
        let issues = self
            .issue_repository
            .list_by_project_id(project_id)
            .map_err(issue_database_error)?;

        Ok(IssueListResponse { issues })
    }

    pub fn create_issue(&self, input: CreateIssueInput) -> Result<IssueRecord, CommandError> {
        self.ensure_project_exists(input.project_id)?;
        let title = validate_title(&input.title)?;
        let description = input.description.trim().to_string();
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(issue_database_error)?;
        let issue = IssueRepository::insert_in_transaction(
            &transaction,
            input.project_id,
            &title,
            &description,
        )
        .map_err(issue_database_error)?;
        let payload_json = json!({
            "title": issue.title,
            "description": issue.description,
            "status": "backlog",
        })
        .to_string();

        EventRepository::insert_issue_action_in_transaction(
            &transaction,
            issue.id,
            IssueActionType::IssueCreated,
            &payload_json,
            issue.created_at,
        )
        .map_err(issue_database_error)?;

        transaction.commit().map_err(issue_database_error)?;

        Ok(issue)
    }

    pub fn update_issue(&self, input: UpdateIssueInput) -> Result<IssueRecord, CommandError> {
        self.ensure_project_exists(input.project_id)?;
        let title = validate_title(&input.title)?;
        let description = input.description.trim().to_string();

        self.issue_repository
            .update_title_and_description(input.project_id, input.issue_id, &title, &description)
            .map_err(issue_database_error)?
            .ok_or_else(|| issue_not_found(input.issue_id))
    }

    pub fn list_issues_in_data_dir(
        data_dir: impl AsRef<Path>,
        project_id: i64,
    ) -> Result<IssueListResponse, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).list_issues(project_id)
    }

    pub fn create_issue_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: CreateIssueInput,
    ) -> Result<IssueRecord, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).create_issue(input)
    }

    pub fn update_issue_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: UpdateIssueInput,
    ) -> Result<IssueRecord, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).update_issue(input)
    }

    fn ensure_project_exists(&self, project_id: i64) -> Result<(), CommandError> {
        self.project_repository
            .find_by_id(project_id)
            .map_err(issue_database_error)?
            .map(|_| ())
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            })
    }
}

fn open_issue_database(
    data_dir: impl AsRef<Path>,
) -> Result<crate::db::connection::Database, CommandError> {
    let database = DatabaseConfig::new(data_dir)
        .open()
        .map_err(CommandError::from)?;
    MigrationRunner::default()
        .run(&database.connection)
        .map_err(|error| {
            CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

    Ok(database)
}

fn validate_title(title: &str) -> Result<String, CommandError> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "Issue title 不能为空。",
        )
        .with_detail(ErrorDetail::new("Field").with_value("name", "title")));
    }

    Ok(trimmed.to_string())
}

fn issue_not_found(issue_id: i64) -> CommandError {
    CommandError::new(CommandErrorCode::IssueNotFound, "Issue 不存在。")
        .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue_id))
}

fn issue_database_error(error: rusqlite::Error) -> CommandError {
    CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
