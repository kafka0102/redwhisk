use crate::db::project_issue_source_repository::ProjectIssueSourceRepository;
use crate::types::errors::{CommandError, CommandErrorCode};
use crate::types::project_issue_source::IssueCreateSource;

use super::service::IssueService;
use super::validation::issue_database_error;

pub(crate) fn require_local_issue_create(
    service: &IssueService<'_>,
    project_id: i64,
) -> Result<(), CommandError> {
    service.require_project(project_id)?;
    let create_source = ProjectIssueSourceRepository::new(service.issue_repository.connection())
        .get(project_id)
        .map_err(issue_database_error)?
        .map(|settings| settings.issue_create_source)
        .unwrap_or(IssueCreateSource::Local);
    if create_source == IssueCreateSource::Remote {
        return Err(CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "Remote issue creation is unavailable.",
        )
        .with_reason("remoteCreateUnavailable"));
    }
    Ok(())
}
