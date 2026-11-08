use rusqlite::{params, Connection};

use crate::features::issue::{ChangeRequestWriteError, ForgeIssueError, ForgeIssuePort};
use crate::types::change_request::{ChangeRequestDetail, ChangeRequestLinkedIssue};
use crate::types::errors::{CommandError, CommandErrorCode};

use super::detail_snapshot::{
    detail_from_fresh, detail_from_snapshot, has_snapshot, load_row, load_snapshot,
    unavailable_detail, write_fresh_snapshot,
};
use super::list::{ensure_project, query_failed};

pub(crate) fn get_project_change_request(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    number: i64,
    forge: &impl ForgeIssuePort,
    now_ms: i64,
) -> Result<ChangeRequestDetail, CommandError> {
    ensure_project(connection, project_id)?;
    let provider = normalize_provider(provider)?;
    if number < 1 {
        return Err(invalid_detail());
    }
    let row =
        load_row(connection, project_id, provider, number)?.ok_or_else(change_request_not_found)?;
    let snapshot = load_snapshot(connection, row.id)?;
    let linked_issues = load_linked_issues(connection, row.id)?;
    match forge.get_change_request_details(number) {
        Ok(details) => {
            write_fresh_snapshot(connection, row.id, &details, now_ms)?;
            if details.state == "merged" {
                let _ = crate::features::issue::completion::merge_writeback::write_back_merged_change_request_from_repo(
                    connection,
                    row.id,
                );
            }
            let row = load_row(connection, project_id, provider, number)?
                .ok_or_else(change_request_not_found)?;
            Ok(with_action_support(
                detail_from_fresh(row, details, linked_issues),
                forge,
            ))
        }
        Err(error) => {
            let detail_error = detail_error_code(error).to_string();
            if has_snapshot(&row, &snapshot) {
                Ok(with_action_support(
                    detail_from_snapshot(
                        row,
                        snapshot,
                        linked_issues,
                        "cached",
                        Some(detail_error),
                    ),
                    forge,
                ))
            } else {
                Ok(with_action_support(
                    unavailable_detail(row, linked_issues, detail_error),
                    forge,
                ))
            }
        }
    }
}

pub(crate) fn mark_change_request_ready(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    number: i64,
    forge: &impl ForgeIssuePort,
    now_ms: i64,
) -> Result<ChangeRequestDetail, CommandError> {
    ensure_project(connection, project_id)?;
    let provider = normalize_provider(provider)?;
    if number < 1 {
        return Err(invalid_detail());
    }
    let row =
        load_row(connection, project_id, provider, number)?.ok_or_else(change_request_not_found)?;
    if row.state != "draft" {
        return Err(CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "Only a draft change request can be marked ready.",
        )
        .with_reason("changeRequestNotDraft"));
    }
    if !forge.supports_change_request_ready() {
        return Err(CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "This host cannot mark a change request ready.",
        )
        .with_reason("changeRequestReadyUnsupported"));
    }
    let linked_issues = load_linked_issues(connection, row.id)?;
    let details = forge
        .mark_change_request_ready(number)
        .map_err(|error| map_write_error(error, "changeRequestReadyUnsupported"))?;
    write_fresh_snapshot(connection, row.id, &details, now_ms)?;
    let row =
        load_row(connection, project_id, provider, number)?.ok_or_else(change_request_not_found)?;
    Ok(with_action_support(
        detail_from_fresh(row, details, linked_issues),
        forge,
    ))
}

pub(crate) fn request_change_request_review(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    number: i64,
    reviewer: &str,
    forge: &impl ForgeIssuePort,
    now_ms: i64,
) -> Result<ChangeRequestDetail, CommandError> {
    let reviewer = reviewer.trim();
    if reviewer.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "A reviewer is required.",
        )
        .with_reason("changeRequestReviewerMissing"));
    }
    ensure_project(connection, project_id)?;
    let provider = normalize_provider(provider)?;
    if number < 1 {
        return Err(invalid_detail());
    }
    let row =
        load_row(connection, project_id, provider, number)?.ok_or_else(change_request_not_found)?;
    if !forge.supports_change_request_review() {
        return Err(CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "This host cannot request a change request review.",
        )
        .with_reason("changeRequestReviewUnsupported"));
    }
    let linked_issues = load_linked_issues(connection, row.id)?;
    let details = forge
        .request_change_request_review(number, reviewer)
        .map_err(|error| map_write_error(error, "changeRequestReviewUnsupported"))?;
    write_fresh_snapshot(connection, row.id, &details, now_ms)?;
    let row =
        load_row(connection, project_id, provider, number)?.ok_or_else(change_request_not_found)?;
    Ok(with_action_support(
        detail_from_fresh(row, details, linked_issues),
        forge,
    ))
}

pub(crate) fn close_change_request(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    number: i64,
    forge: &impl ForgeIssuePort,
    now_ms: i64,
) -> Result<ChangeRequestDetail, CommandError> {
    ensure_project(connection, project_id)?;
    let provider = normalize_provider(provider)?;
    if number < 1 {
        return Err(invalid_detail());
    }
    let row =
        load_row(connection, project_id, provider, number)?.ok_or_else(change_request_not_found)?;
    if row.state != "open" {
        return Err(CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "Only an open change request can be closed.",
        )
        .with_reason("changeRequestNotOpen"));
    }
    let linked_issues = load_linked_issues(connection, row.id)?;
    let details = forge
        .close_change_request(number)
        .map_err(|error| map_write_error(error, "changeRequestActionFailed"))?;
    write_fresh_snapshot(connection, row.id, &details, now_ms)?;
    let row =
        load_row(connection, project_id, provider, number)?.ok_or_else(change_request_not_found)?;
    Ok(with_action_support(
        detail_from_fresh(row, details, linked_issues),
        forge,
    ))
}

pub(crate) fn merge_change_request(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    number: i64,
    method: &str,
    delete_source_branch: bool,
    forge: &impl ForgeIssuePort,
    now_ms: i64,
) -> Result<ChangeRequestDetail, CommandError> {
    ensure_project(connection, project_id)?;
    let provider = normalize_provider(provider)?;
    if number < 1 {
        return Err(invalid_detail());
    }
    let row =
        load_row(connection, project_id, provider, number)?.ok_or_else(change_request_not_found)?;
    let details = forge.get_change_request_details(number).map_err(|error| {
        map_write_error(
            ChangeRequestWriteError::Failed(error),
            "changeRequestActionFailed",
        )
    })?;
    if !host_allows_merge(
        provider,
        details.mergeable.as_deref(),
        &details.blocking_reasons,
    ) {
        return Err(not_mergeable());
    }
    if !known_merge_method(method) || !forge.supports_change_request_merge_method(method) {
        return Err(merge_method_unsupported());
    }
    let linked_issues = load_linked_issues(connection, row.id)?;
    let mut merged = forge
        .merge_change_request(number, method, delete_source_branch)
        .map_err(|error| map_write_error(error, "changeRequestMergeMethodUnsupported"))?;
    if merged.state == "merged" && merged.merge_method.is_none() {
        merged.merge_method = Some(method.to_string());
    }
    write_fresh_snapshot(connection, row.id, &merged, now_ms)?;
    let row =
        load_row(connection, project_id, provider, number)?.ok_or_else(change_request_not_found)?;
    if row.state == "merged" {
        let _ = crate::features::issue::completion::merge_writeback::write_back_merged_change_request_from_repo(
            connection,
            row.id,
        );
    }
    Ok(with_action_support(
        detail_from_fresh(row, merged, linked_issues),
        forge,
    ))
}

fn not_mergeable() -> CommandError {
    CommandError::new(
        CommandErrorCode::IssueValidationFailed,
        "The change request is not mergeable.",
    )
    .with_reason("changeRequestNotMergeable")
}

fn explicitly_mergeable(provider: &str, mergeable: Option<&str>) -> bool {
    match (provider, mergeable) {
        ("github", Some("MERGEABLE")) | ("gitlab", Some("mergeable")) => true,
        _ => false,
    }
}

fn host_allows_merge(provider: &str, mergeable: Option<&str>, blocking_reasons: &[String]) -> bool {
    blocking_reasons.is_empty() && explicitly_mergeable(provider, mergeable)
}

fn known_merge_method(method: &str) -> bool {
    matches!(method, "squash" | "merge" | "rebase")
}

fn merge_method_unsupported() -> CommandError {
    CommandError::new(
        CommandErrorCode::ForgeUnavailable,
        "This host cannot merge with that method.",
    )
    .with_reason("changeRequestMergeMethodUnsupported")
}

fn load_linked_issues(
    connection: &Connection,
    change_request_id: i64,
) -> Result<Vec<ChangeRequestLinkedIssue>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT issues.id, issues.number, refs.provider, refs.external_number, links.link_kind
             FROM change_request_issue_links links
             JOIN issues ON issues.id = links.issue_id
             LEFT JOIN issue_external_refs refs ON refs.issue_id = issues.id
             WHERE links.change_request_id = ?1 AND issues.del = 0
             ORDER BY links.created_at ASC, issues.id ASC",
        )
        .map_err(query_failed)?;
    let rows = statement
        .query_map(params![change_request_id], |row| {
            let issue_id: i64 = row.get(0)?;
            let local_number: i64 = row.get(1)?;
            let provider: Option<String> = row.get(2)?;
            let external_number: Option<i64> = row.get(3)?;
            let link_kind: String = row.get(4)?;
            let label = match (provider.as_deref(), external_number) {
                (Some("github"), Some(number)) => format!("GH #{number}"),
                (Some("gitlab"), Some(number)) => format!("GL #{number}"),
                _ => format!("#{local_number}"),
            };
            Ok(ChangeRequestLinkedIssue {
                issue_id,
                label,
                link_kind,
            })
        })
        .map_err(query_failed)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(query_failed)
}

fn normalize_provider(provider: &str) -> Result<&str, CommandError> {
    match provider.trim() {
        "github" | "gitlab" => Ok(provider.trim()),
        _ => Err(invalid_detail()),
    }
}

fn with_action_support(
    mut detail: ChangeRequestDetail,
    forge: &impl ForgeIssuePort,
) -> ChangeRequestDetail {
    detail.ready_supported = forge.supports_change_request_ready();
    detail.review_supported = forge.supports_change_request_review();
    detail.supported_merge_methods = supported_merge_methods(forge);
    detail
}

fn supported_merge_methods(forge: &impl ForgeIssuePort) -> Vec<String> {
    ["squash", "merge", "rebase"]
        .into_iter()
        .filter(|method| forge.supports_change_request_merge_method(method))
        .map(str::to_string)
        .collect()
}

fn invalid_detail() -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectValidationFailed,
        "Change request detail request is invalid.",
    )
    .with_reason("changeRequestDetailInvalid")
}

fn change_request_not_found() -> CommandError {
    CommandError::new(CommandErrorCode::IssueNotFound, "Change request not found.")
        .with_reason("changeRequestNotFound")
}

fn detail_error_code(error: ForgeIssueError) -> &'static str {
    match error {
        ForgeIssueError::Unauthenticated | ForgeIssueError::Forbidden => "credential_expired",
        ForgeIssueError::CliMissing => "cli_missing",
        ForgeIssueError::Offline => "offline",
        ForgeIssueError::RateLimited => "rate_limited",
        ForgeIssueError::CommandFailed
        | ForgeIssueError::Unparseable
        | ForgeIssueError::NotFound
        | ForgeIssueError::Gone => "cache_failed",
    }
}

fn map_write_error(error: ChangeRequestWriteError, unsupported_reason: &str) -> CommandError {
    match error {
        ChangeRequestWriteError::Unsupported => CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "This host does not support the change request action.",
        )
        .with_reason(unsupported_reason),
        ChangeRequestWriteError::Failed(ForgeIssueError::Unauthenticated) => {
            CommandError::new(CommandErrorCode::ForgeUnavailable, "Credentials expired.")
                .with_reason("credentialExpired")
        }
        ChangeRequestWriteError::Failed(ForgeIssueError::Forbidden) => CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "Write permission is required.",
        )
        .with_reason("writeForbidden"),
        ChangeRequestWriteError::Failed(ForgeIssueError::RateLimited) => CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "The host rate limit was reached.",
        )
        .with_reason("rateLimited"),
        ChangeRequestWriteError::Failed(ForgeIssueError::NotFound | ForgeIssueError::Gone) => {
            change_request_not_found()
        }
        ChangeRequestWriteError::Failed(ForgeIssueError::CliMissing) => CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "The forge CLI is missing.",
        )
        .with_reason("forgeCliMissing"),
        ChangeRequestWriteError::Failed(ForgeIssueError::Offline) => {
            CommandError::new(CommandErrorCode::ForgeUnavailable, "The forge is offline.")
                .with_reason("forgeOffline")
        }
        ChangeRequestWriteError::Failed(
            ForgeIssueError::CommandFailed | ForgeIssueError::Unparseable,
        ) => CommandError::new(
            CommandErrorCode::ForgeUnavailable,
            "The change request action failed.",
        )
        .with_reason("changeRequestActionFailed"),
    }
}
