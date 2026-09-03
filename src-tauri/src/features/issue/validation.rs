use crate::db::project_label_repository::ProjectLabelRow;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::IssueLabelRecord;

pub(super) fn validate_title(title: &str) -> Result<String, CommandError> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "Issue title 不能为空。",
        )
        .with_reason("titleRequired")
        .with_detail(ErrorDetail::new("Field").with_value("name", "title")));
    }

    Ok(trimmed.to_string())
}

pub(super) fn serialize_label_ids(label_ids: &[i64]) -> Result<String, CommandError> {
    serde_json::to_string(label_ids).map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
            .with_reason("saveFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })
}

pub(super) fn invalid_issue_label(label_id: i64, project_id: i64) -> CommandError {
    CommandError::new(
        CommandErrorCode::IssueValidationFailed,
        "Issue labels 配置无效。",
    )
    .with_reason("labelsInvalid")
    .with_detail(ErrorDetail::new("IssueLabel").with_value("labelId", label_id))
    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
}

pub(super) fn is_issue_label_accessible(project_id: i64, label: &ProjectLabelRow) -> bool {
    match label.scope {
        crate::types::project_label::ProjectLabelScope::Global => true,
        crate::types::project_label::ProjectLabelScope::Project => {
            label.project_id == Some(project_id)
        }
    }
}

pub(super) fn to_issue_label_record(label: ProjectLabelRow) -> IssueLabelRecord {
    IssueLabelRecord {
        id: label.id,
        name: label.name,
        scope: label.scope,
        project_id: label.project_id,
        color: label.color,
        workflow_skill: label.workflow_skill,
    }
}

pub(super) fn issue_not_found(issue_id: i64) -> CommandError {
    CommandError::new(CommandErrorCode::IssueNotFound, "Issue 不存在。")
        .with_reason("issueNotFound")
        .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue_id))
}

pub(crate) fn issue_database_error(error: rusqlite::Error) -> CommandError {
    CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
        .with_reason("saveFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

pub(super) fn issue_git_error(error: crate::git::status::GitStatusError) -> CommandError {
    CommandError::new(
        CommandErrorCode::IssueValidationFailed,
        "当前 Project 的 Git 状态不可用。",
    )
    .with_reason("gitStatusUnavailable")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
