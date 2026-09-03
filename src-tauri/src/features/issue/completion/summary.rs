use rusqlite::Connection;

use crate::db::event_repository::EventRepository;
use crate::features::issue::validation::issue_database_error;
use crate::types::completion_attempt::{CompletionAttemptRecord, CompletionAttemptResult};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::IssueSummaryCompletionInfo;
use crate::types::issue_action::IssueActionType;

fn summary_completion_from_attempt(attempt: CompletionAttemptRecord) -> IssueSummaryCompletionInfo {
    IssueSummaryCompletionInfo {
        option: attempt.option.as_str().to_string(),
        result: attempt.result.as_str().to_string(),
        commit_hash: attempt.commit_hash,
        failure_reason: attempt.failure_reason,
        head_before: Some(attempt.head_before),
        head_after: Some(attempt.head_after),
        changed_files_json: Some(attempt.changed_files_json),
        created_at: attempt.created_at,
        source: "completion_attempt".to_string(),
    }
}

fn latest_completion_from_issue_action(
    connection: &Connection,
    issue_id: i64,
) -> Result<Option<IssueSummaryCompletionInfo>, CommandError> {
    let issue_completed_action = EventRepository::new(connection)
        .list_issue_actions(issue_id)
        .map_err(issue_database_error)?
        .into_iter()
        .find(|action| action.action_type == IssueActionType::IssueCompleted);

    let Some(action) = issue_completed_action else {
        return Ok(None);
    };

    let payload =
        serde_json::from_str::<serde_json::Value>(&action.payload_json).map_err(|error| {
            CommandError::new(
                CommandErrorCode::IssuePersistenceFailed,
                "Issue Summary 解析失败。",
            )
            .with_reason("summaryParseFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            .with_detail(ErrorDetail::new("IssueAction").with_value("issueId", issue_id))
        })?;

    let option = payload
        .get("option")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown")
        .to_string();

    Ok(Some(IssueSummaryCompletionInfo {
        option,
        result: "completed".to_string(),
        commit_hash: None,
        failure_reason: None,
        head_before: None,
        head_after: None,
        changed_files_json: None,
        created_at: action.created_at,
        source: "issue_action_fallback".to_string(),
    }))
}

pub(crate) fn resolve_issue_summary_completion(
    connection: &Connection,
    issue_id: i64,
    attempts: &[CompletionAttemptRecord],
    diagnostics: &mut Vec<String>,
) -> Result<Option<IssueSummaryCompletionInfo>, CommandError> {
    let completed_attempt = attempts
        .iter()
        .find(|attempt| attempt.result == CompletionAttemptResult::Completed)
        .cloned();

    if let Some(attempt) = completed_attempt {
        return Ok(Some(summary_completion_from_attempt(attempt)));
    }

    if attempts.is_empty() {
        diagnostics.push("缺少 CompletionAttempt 记录，已回退到 Issue 完成事件推断。".to_string());
    } else {
        diagnostics.push(
            "未找到可代表最终 completed 的 CompletionAttempt，已回退到 Issue 完成事件推断。"
                .to_string(),
        );
    }

    latest_completion_from_issue_action(connection, issue_id)
}
