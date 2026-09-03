//! CommitCompletion 事务与 flow 持久化：完成用例 module 的写入 seam。

use serde_json::json;

use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::completion_attempt_repository::CompletionAttemptRepository;
use crate::db::event_repository::EventRepository;
use crate::db::issue_completion_flow_repository::{
    IssueCompletionFlowRecordInput, IssueCompletionFlowRepository,
};
use crate::db::issue_repository::IssueRepository;
use crate::features::issue::archive::{cleanup_runtime_issue_log, rollback_issue_archive};
use crate::features::issue::time::current_epoch_millis_for_db;
use crate::features::issue::validation::{issue_database_error, issue_not_found};
use crate::git::status::GitSnapshot;
use crate::logging::info_kv;
use crate::types::agent_session::{AgentSessionRecord, AgentSessionStatus};
use crate::types::completion_attempt::{CompletionAttemptOption, CompletionAttemptResult};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{issue_status_to_str, IssueRecord, IssueStatus};
use crate::types::issue_action::{IssueActionActor, IssueActionType};
use crate::types::issue_completion::{
    DirtyWorkspaceOption, IssueCompletionFlowRecord, IssueCompletionPhase,
};
use crate::types::session_event::SessionEventType;

use super::formatting::completion_session_close_reason;
use super::use_case::CompletionFlow;

impl<'connection> CompletionFlow<'_, 'connection> {
    pub(crate) fn complete_issue_flow_transaction(
        &self,
        issue: &IssueRecord,
        session: &AgentSessionRecord,
        snapshot: &GitSnapshot,
        option: CompletionAttemptOption,
        attempt_id: Option<i64>,
        commit_hash: Option<&str>,
        ignore_dirty: bool,
    ) -> Result<IssueRecord, CommandError> {
        let transaction = self
            .service
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(issue_database_error)?;

        let completed_issue = if issue.status == IssueStatus::Review
            && session.status == AgentSessionStatus::Running
            && session.closed_at.is_none()
        {
            IssueRepository::complete_review_issue_manually_in_transaction(
                &transaction,
                issue.project_id,
                issue.id,
                session.id,
            )
            .map_err(issue_database_error)?
            .ok_or_else(|| issue_not_found(issue.id))?
        } else {
            IssueRepository::update_status_in_transaction(
                &transaction,
                issue.project_id,
                issue.id,
                IssueStatus::Completed,
            )
            .map_err(issue_database_error)?
            .ok_or_else(|| issue_not_found(issue.id))?
        };

        let issue_archive = if session.status != AgentSessionStatus::Closed {
            if let Some(closed_session) = AgentSessionRepository::mark_terminated_in_transaction(
                &transaction,
                session.id,
                AgentSessionStatus::Closed,
                completed_issue.updated_at,
            )
            .map_err(issue_database_error)?
            {
                let issue_archive = self.service.archive_issue_session_in_transaction(
                    &transaction,
                    &completed_issue,
                    &closed_session,
                )?;
                let session_event_payload = json!({
                    "sessionId": closed_session.id,
                    "issueId": closed_session.issue_id,
                    "status": "closed",
                    "reason": completion_session_close_reason(option),
                    "commitHash": commit_hash,
                    "logPath": issue_archive
                        .as_ref()
                        .map(|archive| archive.archive_path.as_str())
                        .unwrap_or(closed_session.log_path.as_str()),
                })
                .to_string();
                EventRepository::insert_session_event_in_transaction(
                    &transaction,
                    closed_session.id,
                    SessionEventType::SessionClosed,
                    &session_event_payload,
                    completed_issue.updated_at,
                )
                .map_err(issue_database_error)?;
                issue_archive
            } else {
                self.service.archive_issue_session_in_transaction(
                    &transaction,
                    &completed_issue,
                    session,
                )?
            }
        } else {
            self.service.archive_issue_session_in_transaction(
                &transaction,
                &completed_issue,
                session,
            )?
        };

        let issue_action_payload = json!({
            "fromStatus": issue_status_to_str(&issue.status),
            "toStatus": "completed",
            "linkedSessionId": session.id,
            "option": option.as_str(),
            "commitHash": commit_hash,
            "ignoreDirty": ignore_dirty,
        })
        .to_string();
        EventRepository::insert_issue_action_in_transaction(
            &transaction,
            completed_issue.id,
            IssueActionType::IssueCompleted,
            &issue_action_payload,
            completed_issue.updated_at,
            IssueActionActor::User { profile_id: 1 },
        )
        .map_err(issue_database_error)?;

        let changed_files_json =
            serde_json::to_string(&snapshot.changed_files).map_err(|error| {
                CommandError::new(
                    CommandErrorCode::IssuePersistenceFailed,
                    "CompletionAttempt 保存失败。",
                )
                .with_reason("completionAttemptSaveFailed")
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            })?;
        if let Some(attempt_id) = attempt_id {
            CompletionAttemptRepository::update_result_in_transaction(
                &transaction,
                attempt_id,
                &snapshot.head,
                commit_hash,
                None,
                CompletionAttemptResult::Completed,
            )
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::IssuePersistenceFailed,
                    "CompletionAttempt 更新失败。",
                )
                .with_reason("completionAttemptUpdateFailed")
                .with_detail(
                    ErrorDetail::new("CompletionAttempt").with_value("attemptId", attempt_id),
                )
            })?;
        } else {
            CompletionAttemptRepository::insert_in_transaction(
                &transaction,
                completed_issue.id,
                session.id,
                option,
                &snapshot.head,
                &snapshot.head,
                commit_hash,
                None,
                &changed_files_json,
                CompletionAttemptResult::Completed,
                completed_issue.updated_at,
            )
            .map_err(issue_database_error)?;
        }

        IssueCompletionFlowRepository::clear_in_transaction(&transaction, issue.id)
            .map_err(issue_database_error)?;
        if let Err(error) = transaction.commit() {
            rollback_issue_archive(issue_archive.as_ref());
            return Err(issue_database_error(error));
        }

        info_kv(
            "complete_issue_flow",
            "issue completed",
            &[
                ("issueId", &completed_issue.id.to_string()),
                ("sessionId", &session.id.to_string()),
                ("option", option.as_str()),
                ("commitHash", commit_hash.unwrap_or("")),
            ],
        );

        cleanup_runtime_issue_log(issue_archive.as_ref());
        let completed_issue = self
            .service
            .issue_repository
            .find_by_id(completed_issue.id)
            .map_err(issue_database_error)?
            .ok_or_else(|| issue_not_found(completed_issue.id))?;
        self.service.hydrate_issue(completed_issue)
    }

    pub(crate) fn upsert_completion_flow(
        &self,
        issue_id: i64,
        session_id: Option<i64>,
        phase: IssueCompletionPhase,
        ignore_dirty: bool,
        dirty_decision: Option<DirtyWorkspaceOption>,
        worktree_cleanup_decision: Option<bool>,
        session: &AgentSessionRecord,
        actual_path: Option<&str>,
        failure_reason: Option<&str>,
    ) -> Result<IssueCompletionFlowRecord, CommandError> {
        let transaction = self
            .service
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(issue_database_error)?;
        let flow = IssueCompletionFlowRepository::upsert_in_transaction(
            &transaction,
            IssueCompletionFlowRecordInput {
                issue_id,
                session_id,
                phase,
                ignore_dirty,
                dirty_decision,
                continue_after_commit: None,
                worktree_cleanup_decision,
                base_branch: session.origin_branch.as_deref(),
                workspace_branch: session.workspace_branch.as_deref(),
                workspace_path: session.workspace_path.as_deref(),
                actual_path,
                failure_reason,
                updated_at: current_epoch_millis_for_db().map_err(issue_database_error)?,
            },
        )
        .map_err(issue_database_error)?;
        transaction.commit().map_err(issue_database_error)?;
        Ok(flow)
    }
}
