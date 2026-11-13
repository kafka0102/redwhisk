use crate::db::project_label_repository::ProjectLabelRepository;
use crate::types::errors::CommandError;

use super::service::IssueService;
use super::validation::issue_database_error;

pub(super) fn project_label_names(
    service: &IssueService<'_>,
    project_id: i64,
    label_ids: &[i64],
) -> Result<Vec<String>, CommandError> {
    let ids = service.validate_issue_label_ids(project_id, label_ids)?;
    let repository = ProjectLabelRepository::new(service.issue_repository.connection());
    let mut names = Vec::with_capacity(ids.len());
    for id in ids {
        let Some(label) = repository
            .find_label_by_id(id)
            .map_err(issue_database_error)?
        else {
            continue;
        };
        names.push(label.name);
    }
    Ok(names)
}

pub(super) fn attach_existing_host_labels(
    project_names: &[String],
    host_labels: &[String],
) -> Vec<String> {
    let mut attached = Vec::new();
    for name in project_names {
        let Some(host) = host_labels
            .iter()
            .find(|host| host.eq_ignore_ascii_case(name))
        else {
            continue;
        };
        if attached
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(host))
        {
            continue;
        }
        attached.push(host.clone());
    }
    attached
}
