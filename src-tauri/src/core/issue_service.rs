use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;

use crate::agent::pty_session_manager::PtySessionManager;
use crate::core::agent_session_service::AgentSessionService;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::completion_attempt_repository::CompletionAttemptRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::event_repository::EventRepository;
use crate::db::issue_attachment_repository::IssueAttachmentRepository;
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::git::operation_state::GitOperationState;
use crate::git::status::{
    detect_commit_result, read_git_snapshot, GitCommitDetectionResult, GitSnapshot,
};
use crate::types::agent_session::{
    AgentSessionPromptKind, AgentSessionStatus, InjectAgentSessionPromptInput,
};
use crate::types::completion_attempt::{
    CompletionAttemptOption, CompletionAttemptRecord, CompletionAttemptResult,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{
    AdvanceIssueStatusInput, AgentCommitChangedFileSummary, AgentCommitCompletionPreview,
    CompleteIssueCleanInput, CompleteIssueManualInput, CreateIssueInput, DeleteIssueInput,
    DeleteIssueResult, DetectAgentCommitCompletionInput, DetectAgentCommitCompletionOutcome,
    DetectAgentCommitCompletionResult, ExportIssueAttachmentInput, GetIssueSummaryInput,
    IssueAttachmentInput, IssueAttachmentKind, IssueAttachmentPreview, IssueAttachmentRecord,
    IssueListResponse, IssueRecord, IssueStatus, IssueSummaryCompletionInfo, IssueSummaryRecord,
    MarkIssueReviewInput, PrepareAgentCommitCompletionInput, PreviewIssueAttachmentInput,
    SendAgentCommitPromptInput, SendAgentCommitPromptResult, UpdateIssueInput,
};
use crate::types::issue_action::IssueActionType;
use crate::types::project::ProjectCompletionPolicy;
use crate::types::session_event::SessionEventType;

pub struct IssueService<'connection> {
    issue_repository: IssueRepository<'connection>,
    issue_attachment_repository: IssueAttachmentRepository<'connection>,
    project_repository: ProjectRepository<'connection>,
}

struct ReviewCompletionContext {
    issue: IssueRecord,
    linked_session_id: i64,
}

struct AgentCommitContext {
    issue: IssueRecord,
    linked_session_id: i64,
    snapshot: GitSnapshot,
}

struct NewAttachmentPersistence {
    temp_token: String,
    attachment_id: i64,
}

struct AttachmentAnalysis {
    kind: IssueAttachmentKind,
    is_previewable: bool,
}

struct ResolvedAttachmentSource {
    attachment_id: Option<i64>,
    display_name: String,
    absolute_path: String,
    kind: IssueAttachmentKind,
    is_previewable: bool,
}

impl<'connection> IssueService<'connection> {
    pub fn new(
        issue_repository: IssueRepository<'connection>,
        project_repository: ProjectRepository<'connection>,
    ) -> Self {
        Self {
            issue_attachment_repository: IssueAttachmentRepository::new(
                issue_repository.connection(),
            ),
            issue_repository,
            project_repository,
        }
    }

    pub fn list_issues(&self, project_id: i64) -> Result<IssueListResponse, CommandError> {
        self.ensure_project_exists(project_id)?;
        let issues = self
            .issue_repository
            .list_by_project_id(project_id)
            .map_err(issue_database_error)?
            .into_iter()
            .map(|issue| self.hydrate_issue(issue))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(IssueListResponse { issues })
    }

    pub fn get_issue_summary(
        &self,
        input: GetIssueSummaryInput,
    ) -> Result<IssueSummaryRecord, CommandError> {
        self.ensure_project_exists(input.project_id)?;

        let issue = self
            .issue_repository
            .find_by_id(input.issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == input.project_id)
            .ok_or_else(|| issue_not_found(input.issue_id))?;

        if issue.status != IssueStatus::Completed {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有已完成 Issue 可以查看 Summary。",
            )
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("issueId", input.issue_id)
                    .with_value("status", issue_status_to_str(&issue.status)),
            ));
        }

        let mut diagnostics = Vec::new();
        let session = match issue.linked_session_id {
            Some(session_id) => AgentSessionRepository::new(self.issue_repository.connection())
                .find_by_id(session_id)
                .map_err(issue_database_error)?,
            None => None,
        };

        if issue.linked_session_id.is_none() {
            diagnostics.push("缺少关联 Agent Session。".to_string());
        }

        if issue.linked_session_log_path.is_none() {
            diagnostics.push("缺少日志路径。".to_string());
        }

        if let Some(session) = session.as_ref() {
            if session.status != AgentSessionStatus::Closed {
                diagnostics.push(format!(
                    "已完成 Issue 关联的 Session 状态异常：{}。",
                    format_agent_session_status_for_summary(&session.status)
                ));
            }

            if session.closed_at.is_none() {
                diagnostics.push("已完成 Issue 关联的 Session 缺少 closed_at。".to_string());
            }
        }

        let attempts = CompletionAttemptRepository::new(self.issue_repository.connection())
            .list_by_issue_id(issue.id)
            .map_err(issue_database_error)?;

        let completion = resolve_issue_summary_completion(
            self.issue_repository.connection(),
            issue.id,
            &attempts,
            &mut diagnostics,
        )?;

        if completion.is_none() {
            diagnostics.push("缺少可用于复盘的完成记录。".to_string());
        }

        Ok(IssueSummaryRecord {
            issue: self.hydrate_issue(issue)?,
            session_started_at: session.as_ref().map(|session| session.started_at),
            session_closed_at: session.as_ref().and_then(|session| session.closed_at),
            completion,
            diagnostics,
        })
    }

    pub fn create_issue(&self, input: CreateIssueInput) -> Result<IssueRecord, CommandError> {
        let project = self.require_project(input.project_id)?;
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
        let (created_files, saved_issue) = match persist_new_attachments(
            &transaction,
            &project.repo_path,
            issue.id,
            &input.attachments,
        ) {
            Ok((attachments, files)) => {
                let saved_issue = if attachments.is_empty() {
                    issue
                } else {
                    let rewritten_description =
                        rewrite_attachment_tokens(&description, &attachments)?;
                    update_issue_title_and_description_in_transaction(
                        &transaction,
                        input.project_id,
                        issue.id,
                        &title,
                        &rewritten_description,
                    )
                    .map_err(issue_database_error)?
                    .ok_or_else(|| issue_not_found(issue.id))?
                };
                (files, saved_issue)
            }
            Err(error) => {
                cleanup_created_files(&[] as &[PathBuf]);
                return Err(error);
            }
        };
        let payload_json = json!({
            "title": saved_issue.title,
            "description": saved_issue.description,
            "status": "backlog",
        })
        .to_string();

        EventRepository::insert_issue_action_in_transaction(
            &transaction,
            saved_issue.id,
            IssueActionType::IssueCreated,
            &payload_json,
            saved_issue.created_at,
        )
        .map_err(issue_database_error)?;

        if let Err(error) = transaction.commit() {
            cleanup_created_files(&created_files);
            return Err(issue_database_error(error));
        }

        self.issue_repository
            .find_by_id(saved_issue.id)
            .map_err(issue_database_error)?
            .ok_or_else(|| issue_not_found(saved_issue.id))
            .and_then(|issue| self.hydrate_issue(issue))
    }

    pub fn update_issue(&self, input: UpdateIssueInput) -> Result<IssueRecord, CommandError> {
        let project = self.require_project(input.project_id)?;
        let title = validate_title(&input.title)?;
        let description = input.description.trim().to_string();
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(issue_database_error)?;
        let issue = IssueRepository::find_by_id_in_transaction(&transaction, input.issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == input.project_id)
            .ok_or_else(|| issue_not_found(input.issue_id))?;
        let existing_attachments =
            IssueAttachmentRepository::new(self.issue_repository.connection())
                .list_by_issue_id(issue.id)
                .map_err(issue_database_error)?;
        let (new_attachments, created_files) = persist_new_attachments(
            &transaction,
            &project.repo_path,
            issue.id,
            &input.attachments,
        )?;
        let rewritten_description = rewrite_attachment_tokens(&description, &new_attachments)?;
        let referenced_attachment_ids = parse_attachment_ids(&rewritten_description);
        let removed_attachments = existing_attachments
            .iter()
            .filter(|attachment| !referenced_attachment_ids.contains(&attachment.id))
            .cloned()
            .collect::<Vec<_>>();
        update_issue_title_and_description_in_transaction(
            &transaction,
            input.project_id,
            input.issue_id,
            &title,
            &rewritten_description,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| issue_not_found(input.issue_id))?;
        delete_attachment_files(&removed_attachments)?;
        let removed_ids = removed_attachments
            .iter()
            .map(|attachment| attachment.id)
            .collect::<Vec<_>>();
        IssueAttachmentRepository::delete_by_ids_in_transaction(&transaction, &removed_ids)
            .map_err(issue_database_error)?;

        if let Err(error) = transaction.commit() {
            cleanup_created_files(&created_files);
            return Err(issue_database_error(error));
        }

        self.issue_repository
            .find_by_id(input.issue_id)
            .map_err(issue_database_error)?
            .ok_or_else(|| issue_not_found(input.issue_id))
            .and_then(|saved_issue| self.hydrate_issue(saved_issue))
    }

    pub fn preview_issue_attachment(
        &self,
        input: PreviewIssueAttachmentInput,
    ) -> Result<IssueAttachmentPreview, CommandError> {
        let source = self.resolve_attachment_source(
            input.project_id,
            input.attachment_id,
            input.source_path,
            input.display_name,
        )?;

        if !source.is_previewable {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "当前附件不支持预览。",
            ));
        }

        let text_content = if source.kind == IssueAttachmentKind::Text {
            Some(read_previewable_text_file(&source.absolute_path)?)
        } else {
            None
        };
        let absolute_path = if source.kind == IssueAttachmentKind::Image {
            Some(source.absolute_path)
        } else {
            None
        };

        Ok(IssueAttachmentPreview {
            attachment_id: source.attachment_id,
            display_name: source.display_name,
            kind: source.kind,
            is_previewable: true,
            text_content,
            absolute_path,
        })
    }

    pub fn export_issue_attachment(
        &self,
        input: ExportIssueAttachmentInput,
    ) -> Result<(), CommandError> {
        let source = self.resolve_attachment_source(
            input.project_id,
            input.attachment_id,
            input.source_path,
            input.display_name,
        )?;
        let target_path = PathBuf::from(input.target_path);

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(issue_io_error)?;
        }
        fs::copy(&source.absolute_path, &target_path).map_err(issue_io_error)?;
        Ok(())
    }

    pub fn mark_issue_review(
        &self,
        input: MarkIssueReviewInput,
    ) -> Result<IssueRecord, CommandError> {
        self.ensure_project_exists(input.project_id)?;
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(issue_database_error)?;
        let issue = IssueRepository::find_by_id_in_transaction(&transaction, input.issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == input.project_id)
            .ok_or_else(|| issue_not_found(input.issue_id))?;

        if issue.status != IssueStatus::Running {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有运行中的 Issue 可以标记待验收。",
            )
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("issueId", input.issue_id)
                    .with_value("status", issue_status_to_str(&issue.status)),
            ));
        }

        let linked_session_id = IssueRepository::find_running_linked_session_id_in_transaction(
            &transaction,
            input.project_id,
            input.issue_id,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有存在运行中关联 Agent Session 的 Issue 可以标记待验收。",
            )
            .with_detail(ErrorDetail::new("AgentSession").with_value("issueId", input.issue_id))
        })?;

        let reviewed_issue = IssueRepository::mark_running_issue_review_in_transaction(
            &transaction,
            input.project_id,
            input.issue_id,
            linked_session_id,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有运行中的 Issue 可以标记待验收。",
            )
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("issueId", input.issue_id)
                    .with_value("status", issue_status_to_str(&issue.status)),
            )
        })?;

        let payload_json = json!({
            "fromStatus": "running",
            "toStatus": "review",
            "linkedSessionId": linked_session_id,
        })
        .to_string();
        EventRepository::insert_issue_action_in_transaction(
            &transaction,
            reviewed_issue.id,
            IssueActionType::IssueReviewMarked,
            &payload_json,
            reviewed_issue.updated_at,
        )
        .map_err(issue_database_error)?;

        transaction.commit().map_err(issue_database_error)?;

        Ok(reviewed_issue)
    }

    pub fn advance_issue_status(
        &self,
        input: AdvanceIssueStatusInput,
    ) -> Result<IssueRecord, CommandError> {
        self.ensure_project_exists(input.project_id)?;
        let issue = self
            .issue_repository
            .find_by_id(input.issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == input.project_id)
            .ok_or_else(|| issue_not_found(input.issue_id))?;

        if issue.status == input.target_status {
            return self.hydrate_issue(issue);
        }

        if issue_status_rank(&input.target_status) < issue_status_rank(&issue.status) {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "Issue 状态只能向前推进，不能回退。",
            )
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("issueId", input.issue_id)
                    .with_value("status", issue_status_to_str(&issue.status))
                    .with_value("targetStatus", issue_status_to_str(&input.target_status)),
            ));
        }

        match input.target_status {
            IssueStatus::Backlog => self.hydrate_issue(issue),
            IssueStatus::Running | IssueStatus::Review | IssueStatus::Completed => {
                self.advance_issue_status_with_transaction(input, issue)
            }
        }
    }

    pub fn complete_issue_manual(
        &self,
        input: CompleteIssueManualInput,
    ) -> Result<IssueRecord, CommandError> {
        self.ensure_project_exists(input.project_id)?;
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(issue_database_error)?;
        let issue = IssueRepository::find_by_id_in_transaction(&transaction, input.issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == input.project_id)
            .ok_or_else(|| issue_not_found(input.issue_id))?;

        if issue.status != IssueStatus::Review {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有待验收 Issue 可以手动完成。",
            )
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("issueId", input.issue_id)
                    .with_value("status", issue_status_to_str(&issue.status)),
            ));
        }

        let linked_session_id = IssueRepository::find_running_linked_session_id_in_transaction(
            &transaction,
            input.project_id,
            input.issue_id,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有存在运行中关联 Agent Session 的待验收 Issue 可以手动完成。",
            )
            .with_detail(ErrorDetail::new("AgentSession").with_value("issueId", input.issue_id))
        })?;

        let completed_issue = IssueRepository::complete_review_issue_manually_in_transaction(
            &transaction,
            input.project_id,
            input.issue_id,
            linked_session_id,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有待验收 Issue 可以手动完成。",
            )
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("issueId", input.issue_id)
                    .with_value("status", issue_status_to_str(&issue.status)),
            )
        })?;

        let closed_session = AgentSessionRepository::mark_terminated_in_transaction(
            &transaction,
            linked_session_id,
            AgentSessionStatus::Closed,
            completed_issue.updated_at,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有存在运行中关联 Agent Session 的待验收 Issue 可以手动完成。",
            )
            .with_detail(
                ErrorDetail::new("AgentSession").with_value("sessionId", linked_session_id),
            )
        })?;

        let issue_action_payload = json!({
            "fromStatus": "review",
            "toStatus": "completed",
            "linkedSessionId": linked_session_id,
            "option": "complete_manual",
        })
        .to_string();
        EventRepository::insert_issue_action_in_transaction(
            &transaction,
            completed_issue.id,
            IssueActionType::IssueCompleted,
            &issue_action_payload,
            completed_issue.updated_at,
        )
        .map_err(issue_database_error)?;

        let session_event_payload = json!({
            "sessionId": closed_session.id,
            "issueId": closed_session.issue_id,
            "status": "closed",
            "reason": "manual_completion",
            "logPath": closed_session.log_path,
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

        transaction.commit().map_err(issue_database_error)?;

        Ok(completed_issue)
    }

    pub fn delete_issue(&self, input: DeleteIssueInput) -> Result<DeleteIssueResult, CommandError> {
        self.ensure_project_exists(input.project_id)?;
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(issue_database_error)?;
        let issue = IssueRepository::find_by_id_in_transaction(&transaction, input.issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == input.project_id)
            .ok_or_else(|| issue_not_found(input.issue_id))?;
        let deleted_at = current_epoch_millis()?;

        if let Some(session_id) = issue.linked_session_id {
            if issue.linked_session_status == Some(AgentSessionStatus::Running) {
                let closed = AgentSessionRepository::mark_terminated_without_fetch_in_transaction(
                    &transaction,
                    session_id,
                    AgentSessionStatus::Closed,
                    deleted_at,
                )
                .map_err(issue_database_error)?;
                if !closed {
                    return Err(CommandError::new(
                        CommandErrorCode::IssueValidationFailed,
                        "删除 Issue 时关闭关联 Session 失败。",
                    )
                    .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id)));
                }

                let session_event_payload = json!({
                    "sessionId": session_id,
                    "issueId": issue.id,
                    "status": "closed",
                    "reason": "issue_deleted",
                    "logPath": issue.linked_session_log_path,
                })
                .to_string();
                EventRepository::insert_session_event_in_transaction(
                    &transaction,
                    session_id,
                    SessionEventType::SessionClosed,
                    &session_event_payload,
                    deleted_at,
                )
                .map_err(issue_database_error)?;
            }

            AgentSessionRepository::soft_delete_in_transaction(&transaction, session_id, deleted_at)
                .map_err(issue_database_error)?;
        }

        let deleted = IssueRepository::soft_delete_in_transaction(
            &transaction,
            input.project_id,
            input.issue_id,
            deleted_at,
        )
        .map_err(issue_database_error)?;
        if !deleted {
            return Err(issue_not_found(input.issue_id));
        }

        let payload_json = json!({
            "issueId": issue.id,
            "status": issue_status_to_str(&issue.status),
            "linkedSessionId": issue.linked_session_id,
        })
        .to_string();
        EventRepository::insert_issue_action_in_transaction(
            &transaction,
            issue.id,
            IssueActionType::IssueDeleted,
            &payload_json,
            deleted_at,
        )
        .map_err(issue_database_error)?;

        transaction.commit().map_err(issue_database_error)?;

        Ok(DeleteIssueResult {
            issue_id: issue.id,
            linked_session_id: issue.linked_session_id,
        })
    }

    pub fn complete_issue_clean(
        &self,
        input: CompleteIssueCleanInput,
    ) -> Result<IssueRecord, CommandError> {
        let project = self
            .project_repository
            .find_by_id(input.project_id)
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(
                        ErrorDetail::new("Project").with_value("projectId", input.project_id),
                    )
            })?;

        if project.completion_policy != ProjectCompletionPolicy::AgentAutoCommit {
            let completion_policy = match project.completion_policy {
                ProjectCompletionPolicy::Manual => "manual",
                ProjectCompletionPolicy::AgentAutoCommit => "agent_auto_commit",
            };
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "当前 Project 未启用 agent_auto_commit 完成策略。",
            )
            .with_detail(
                ErrorDetail::new("CompletionPolicy")
                    .with_value("projectId", input.project_id)
                    .with_value("completionPolicy", completion_policy),
            ));
        }

        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(issue_database_error)?;
        let context = self.load_review_completion_context_in_transaction(
            &transaction,
            input.project_id,
            input.issue_id,
        )?;
        let snapshot = read_git_snapshot(&project.repo_path).map_err(issue_git_error)?;
        if snapshot.operation_state != GitOperationState::None {
            record_blocked_completion_attempt(
                &transaction,
                context.issue.id,
                context.linked_session_id,
                CompletionAttemptOption::CompleteClean,
                &snapshot.head,
                format_git_operation_state(snapshot.operation_state),
                snapshot.operation_state,
                "当前 Git 正在进行中的操作阻止直接完成。",
            )
            .map_err(issue_database_error)?;
            transaction.commit().map_err(issue_database_error)?;

            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "当前 Git 正在进行中的操作阻止直接完成。",
            )
            .with_detail(ErrorDetail::new("GitOperation").with_value(
                "state",
                format_git_operation_state(snapshot.operation_state),
            )));
        }
        if !snapshot.is_clean {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "当前仓库存在未提交改动，不能直接完成。",
            )
            .with_detail(
                ErrorDetail::new("GitStatus")
                    .with_value("head", snapshot.head.clone())
                    .with_value("isClean", false),
            ));
        }

        let completed_issue = IssueRepository::complete_review_issue_cleanly_in_transaction(
            &transaction,
            input.project_id,
            input.issue_id,
            context.linked_session_id,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有待验收 Issue 可以直接完成。",
            )
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("issueId", input.issue_id)
                    .with_value("status", issue_status_to_str(&context.issue.status)),
            )
        })?;

        let closed_session = AgentSessionRepository::mark_terminated_in_transaction(
            &transaction,
            context.linked_session_id,
            AgentSessionStatus::Closed,
            completed_issue.updated_at,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有存在运行中关联 Agent Session 的待验收 Issue 可以直接完成。",
            )
            .with_detail(
                ErrorDetail::new("AgentSession").with_value("sessionId", context.linked_session_id),
            )
        })?;

        let issue_action_payload = json!({
            "fromStatus": "review",
            "toStatus": "completed",
            "linkedSessionId": context.linked_session_id,
            "option": "complete_clean",
        })
        .to_string();
        EventRepository::insert_issue_action_in_transaction(
            &transaction,
            completed_issue.id,
            IssueActionType::IssueCompleted,
            &issue_action_payload,
            completed_issue.updated_at,
        )
        .map_err(issue_database_error)?;

        let session_event_payload = json!({
            "sessionId": closed_session.id,
            "issueId": closed_session.issue_id,
            "status": "closed",
            "reason": "clean_completion",
            "logPath": closed_session.log_path,
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

        CompletionAttemptRepository::insert_in_transaction(
            &transaction,
            completed_issue.id,
            closed_session.id,
            CompletionAttemptOption::CompleteClean,
            &snapshot.head,
            &snapshot.head,
            None,
            None,
            "[]",
            CompletionAttemptResult::Completed,
            completed_issue.updated_at,
        )
        .map_err(issue_database_error)?;

        transaction.commit().map_err(issue_database_error)?;

        Ok(completed_issue)
    }

    pub fn prepare_agent_commit_completion(
        &self,
        input: PrepareAgentCommitCompletionInput,
    ) -> Result<AgentCommitCompletionPreview, CommandError> {
        let context = self.validate_agent_commit_context(input.project_id, input.issue_id)?;
        let completion_prompt =
            build_agent_commit_completion_prompt(&context.issue.title, &context.snapshot.head);
        let changed_files = context
            .snapshot
            .changed_files
            .iter()
            .map(|file| AgentCommitChangedFileSummary {
                status: file.status.clone(),
                path: file.path.clone(),
                old_path: file.old_path.clone(),
            })
            .collect::<Vec<_>>();

        Ok(AgentCommitCompletionPreview {
            issue_id: context.issue.id,
            session_id: context.linked_session_id,
            option: "complete_agent_commit".to_string(),
            head: context.snapshot.head,
            changed_files_count: changed_files.len(),
            changed_files,
            completion_prompt,
        })
    }

    pub fn send_agent_commit_prompt(
        &self,
        input: SendAgentCommitPromptInput,
        data_dir: impl AsRef<Path>,
        pty_sessions: &PtySessionManager,
    ) -> Result<SendAgentCommitPromptResult, CommandError> {
        let context = self.validate_agent_commit_context(input.project_id, input.issue_id)?;
        let completion_prompt =
            build_agent_commit_completion_prompt(&context.issue.title, &context.snapshot.head);
        let changed_files_json =
            serde_json::to_string(&context.snapshot.changed_files).map_err(|error| {
                CommandError::new(
                    CommandErrorCode::IssuePersistenceFailed,
                    "Agent Commit 审计保存失败。",
                )
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            })?;

        let inject_result = AgentSessionService::inject_session_prompt_in_data_dir(
            data_dir.as_ref(),
            InjectAgentSessionPromptInput {
                project_id: input.project_id,
                session_id: context.linked_session_id,
                prompt: completion_prompt,
                kind: AgentSessionPromptKind::Completion,
            },
            pty_sessions,
        )?;

        let recorded_at = current_epoch_millis()?;
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(issue_database_error)?;
        CompletionAttemptRepository::insert_in_transaction(
            &transaction,
            context.issue.id,
            context.linked_session_id,
            CompletionAttemptOption::AgentAutoCommit,
            &context.snapshot.head,
            &context.snapshot.head,
            None,
            None,
            &changed_files_json,
            CompletionAttemptResult::PromptSent,
            recorded_at,
        )
        .map_err(issue_database_error)?;
        transaction.commit().map_err(issue_database_error)?;

        Ok(SendAgentCommitPromptResult {
            issue_id: context.issue.id,
            session_id: context.linked_session_id,
            codex_session_id: inject_result.codex_session_id,
        })
    }

    pub fn detect_agent_commit_completion(
        &self,
        input: DetectAgentCommitCompletionInput,
    ) -> Result<DetectAgentCommitCompletionResult, CommandError> {
        let project = self
            .project_repository
            .find_by_id(input.project_id)
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(
                        ErrorDetail::new("Project").with_value("projectId", input.project_id),
                    )
            })?;

        if project.completion_policy != ProjectCompletionPolicy::AgentAutoCommit {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "当前 Project 未启用 agent_auto_commit 完成策略。",
            ));
        }

        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(issue_database_error)?;
        let issue = IssueRepository::find_by_id_in_transaction(&transaction, input.issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == input.project_id)
            .ok_or_else(|| issue_not_found(input.issue_id))?;

        if issue.status != IssueStatus::Review {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有待验收 Issue 可以检测 Agent Commit 完成结果。",
            )
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("issueId", input.issue_id)
                    .with_value("status", issue_status_to_str(&issue.status)),
            ));
        }

        let linked_session_id = IssueRepository::find_running_linked_session_id_in_transaction(
            &transaction,
            input.project_id,
            input.issue_id,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有存在运行中关联 Agent Session 的待验收 Issue 可以检测 Agent Commit 完成结果。",
            )
            .with_detail(ErrorDetail::new("AgentSession").with_value("issueId", input.issue_id))
        })?;

        let attempt =
            CompletionAttemptRepository::find_latest_pending_agent_commit_attempt_in_transaction(
                &transaction,
                issue.id,
                linked_session_id,
            )
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::IssueValidationFailed,
                    "当前 Issue 没有可检测的 Agent Commit 尝试。",
                )
                .with_detail(ErrorDetail::new("CompletionAttempt").with_value("issueId", issue.id))
            })?;

        let before_snapshot = GitSnapshot {
            head: attempt.head_before.clone(),
            status_porcelain: String::new(),
            changed_files: Vec::new(),
            operation_state: GitOperationState::None,
            is_clean: false,
        };
        let after_snapshot = read_git_snapshot(&project.repo_path).map_err(issue_git_error)?;
        let detection = detect_commit_result(&project.repo_path, &before_snapshot, &after_snapshot)
            .map_err(issue_git_error)?;

        let commit_hash = match detection {
            GitCommitDetectionResult::NewCommit { commit_hash } => commit_hash,
            GitCommitDetectionResult::NoCommitDetected => {
                CompletionAttemptRepository::update_result_in_transaction(
                    &transaction,
                    attempt.id,
                    &after_snapshot.head,
                    None,
                    None,
                    CompletionAttemptResult::NoCommitDetected,
                )
                .map_err(issue_database_error)?
                .ok_or_else(|| {
                    CommandError::new(
                        CommandErrorCode::IssuePersistenceFailed,
                        "CompletionAttempt 更新失败。",
                    )
                    .with_detail(
                        ErrorDetail::new("CompletionAttempt").with_value("attemptId", attempt.id),
                    )
                })?;

                let current_issue =
                    IssueRepository::find_by_id_in_transaction(&transaction, issue.id)
                        .map_err(issue_database_error)?
                        .ok_or_else(|| issue_not_found(issue.id))?;
                transaction.commit().map_err(issue_database_error)?;

                return Ok(DetectAgentCommitCompletionResult {
                    outcome: DetectAgentCommitCompletionOutcome::NoCommitDetected,
                    issue: current_issue,
                    message: "尚未检测到新的 commit，Issue 保持待验收。".to_string(),
                });
            }
            GitCommitDetectionResult::HeadMovedWithoutNewCommit { head } => {
                return Err(CommandError::new(
                    CommandErrorCode::IssueValidationFailed,
                    "检测到 HEAD 变化，但不是新的前进式 commit。",
                )
                .with_detail(ErrorDetail::new("GitStatus").with_value("head", head)));
            }
            GitCommitDetectionResult::OperationInProgress { operation_state } => {
                CompletionAttemptRepository::update_result_in_transaction(
                    &transaction,
                    attempt.id,
                    &after_snapshot.head,
                    None,
                    Some(format_git_operation_state(operation_state)),
                    CompletionAttemptResult::GitOperationBlocked,
                )
                .map_err(issue_database_error)?
                .ok_or_else(|| {
                    CommandError::new(
                        CommandErrorCode::IssuePersistenceFailed,
                        "CompletionAttempt 更新失败。",
                    )
                    .with_detail(
                        ErrorDetail::new("CompletionAttempt").with_value("attemptId", attempt.id),
                    )
                })?;

                let current_issue =
                    IssueRepository::find_by_id_in_transaction(&transaction, issue.id)
                        .map_err(issue_database_error)?
                        .ok_or_else(|| issue_not_found(issue.id))?;
                transaction.commit().map_err(issue_database_error)?;

                return Ok(DetectAgentCommitCompletionResult {
                    outcome: DetectAgentCommitCompletionOutcome::GitOperationBlocked,
                    issue: current_issue,
                    message:
                        "当前 Git 正在进行中的操作阻止 Agent Commit 完成，请先手动处理 Git 状态。"
                            .to_string(),
                });
            }
        };

        let completed_issue = IssueRepository::complete_review_issue_cleanly_in_transaction(
            &transaction,
            input.project_id,
            input.issue_id,
            linked_session_id,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有待验收 Issue 可以完成。",
            )
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("issueId", input.issue_id)
                    .with_value("status", issue_status_to_str(&issue.status)),
            )
        })?;

        let closed_session = AgentSessionRepository::mark_terminated_in_transaction(
            &transaction,
            linked_session_id,
            AgentSessionStatus::Closed,
            completed_issue.updated_at,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有存在运行中关联 Agent Session 的待验收 Issue 可以完成。",
            )
            .with_detail(
                ErrorDetail::new("AgentSession").with_value("sessionId", linked_session_id),
            )
        })?;

        let issue_action_payload = json!({
            "fromStatus": "review",
            "toStatus": "completed",
            "linkedSessionId": linked_session_id,
            "option": "agent_auto_commit",
            "commitHash": commit_hash,
        })
        .to_string();
        EventRepository::insert_issue_action_in_transaction(
            &transaction,
            completed_issue.id,
            IssueActionType::IssueCompleted,
            &issue_action_payload,
            completed_issue.updated_at,
        )
        .map_err(issue_database_error)?;

        let session_event_payload = json!({
            "sessionId": closed_session.id,
            "issueId": closed_session.issue_id,
            "status": "closed",
            "reason": "agent_commit_completion",
            "commitHash": commit_hash,
            "logPath": closed_session.log_path,
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

        CompletionAttemptRepository::update_result_in_transaction(
            &transaction,
            attempt.id,
            &after_snapshot.head,
            Some(&commit_hash),
            None,
            CompletionAttemptResult::Completed,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssuePersistenceFailed,
                "CompletionAttempt 更新失败。",
            )
            .with_detail(ErrorDetail::new("CompletionAttempt").with_value("attemptId", attempt.id))
        })?;

        transaction.commit().map_err(issue_database_error)?;

        Ok(DetectAgentCommitCompletionResult {
            outcome: DetectAgentCommitCompletionOutcome::Completed,
            issue: completed_issue,
            message: "已检测到新的 commit，Issue 已完成。".to_string(),
        })
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

    pub fn preview_issue_attachment_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: PreviewIssueAttachmentInput,
    ) -> Result<IssueAttachmentPreview, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).preview_issue_attachment(input)
    }

    pub fn export_issue_attachment_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: ExportIssueAttachmentInput,
    ) -> Result<(), CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).export_issue_attachment(input)
    }

    pub fn mark_issue_review_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: MarkIssueReviewInput,
    ) -> Result<IssueRecord, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).mark_issue_review(input)
    }

    pub fn advance_issue_status_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: AdvanceIssueStatusInput,
    ) -> Result<IssueRecord, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).advance_issue_status(input)
    }

    pub fn complete_issue_manual_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: CompleteIssueManualInput,
    ) -> Result<IssueRecord, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).complete_issue_manual(input)
    }

    pub fn complete_issue_clean_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: CompleteIssueCleanInput,
    ) -> Result<IssueRecord, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).complete_issue_clean(input)
    }

    pub fn prepare_agent_commit_completion_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: PrepareAgentCommitCompletionInput,
    ) -> Result<AgentCommitCompletionPreview, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository)
            .prepare_agent_commit_completion(input)
    }

    pub fn send_agent_commit_prompt_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: SendAgentCommitPromptInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<SendAgentCommitPromptResult, CommandError> {
        let database = open_issue_database(&data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).send_agent_commit_prompt(
            input,
            data_dir,
            pty_sessions,
        )
    }

    pub fn detect_agent_commit_completion_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: DetectAgentCommitCompletionInput,
    ) -> Result<DetectAgentCommitCompletionResult, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository)
            .detect_agent_commit_completion(input)
    }

    pub fn get_issue_summary_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: GetIssueSummaryInput,
    ) -> Result<IssueSummaryRecord, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).get_issue_summary(input)
    }

    pub fn delete_issue_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: DeleteIssueInput,
    ) -> Result<DeleteIssueResult, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).delete_issue(input)
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

    fn require_project(
        &self,
        project_id: i64,
    ) -> Result<crate::types::project::ProjectSummary, CommandError> {
        self.project_repository
            .find_by_id(project_id)
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            })
    }

    fn hydrate_issue(&self, mut issue: IssueRecord) -> Result<IssueRecord, CommandError> {
        issue.attachments = self
            .issue_attachment_repository
            .list_by_issue_id(issue.id)
            .map_err(issue_database_error)?;
        Ok(issue)
    }

    fn resolve_attachment_source(
        &self,
        project_id: i64,
        attachment_id: Option<i64>,
        source_path: Option<String>,
        display_name: Option<String>,
    ) -> Result<ResolvedAttachmentSource, CommandError> {
        match (attachment_id, source_path) {
            (Some(attachment_id), None) => {
                let attachment = self
                    .issue_attachment_repository
                    .find_by_id(attachment_id)
                    .map_err(issue_database_error)?
                    .ok_or_else(|| {
                        CommandError::new(CommandErrorCode::IssueNotFound, "附件不存在。")
                            .with_detail(
                                ErrorDetail::new("IssueAttachment")
                                    .with_value("attachmentId", attachment_id),
                            )
                    })?;
                let issue = self
                    .issue_repository
                    .find_by_id(attachment.issue_id)
                    .map_err(issue_database_error)?
                    .filter(|issue| issue.project_id == project_id)
                    .ok_or_else(|| issue_not_found(attachment.issue_id))?;
                let _ = issue;

                Ok(ResolvedAttachmentSource {
                    attachment_id: Some(attachment.id),
                    display_name: attachment.display_name,
                    absolute_path: attachment.absolute_path,
                    kind: attachment.kind,
                    is_previewable: attachment.is_previewable,
                })
            }
            (None, Some(source_path)) => {
                self.ensure_project_exists(project_id)?;
                let path = PathBuf::from(&source_path);
                let file_name = display_name
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| infer_display_name(&path));
                let metadata = fs::metadata(&path).map_err(issue_io_error)?;
                if !metadata.is_file() {
                    return Err(CommandError::new(
                        CommandErrorCode::IssueValidationFailed,
                        "Draft 附件路径不可读取。",
                    ));
                }
                let analysis = analyze_attachment(&file_name, None);
                Ok(ResolvedAttachmentSource {
                    attachment_id: None,
                    display_name: file_name,
                    absolute_path: path.to_string_lossy().to_string(),
                    kind: analysis.kind,
                    is_previewable: analysis.is_previewable,
                })
            }
            _ => Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "附件预览或导出参数无效。",
            )),
        }
    }

    fn validate_agent_commit_context(
        &self,
        project_id: i64,
        issue_id: i64,
    ) -> Result<AgentCommitContext, CommandError> {
        let project = self
            .project_repository
            .find_by_id(project_id)
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            })?;

        if project.completion_policy != ProjectCompletionPolicy::AgentAutoCommit {
            let completion_policy = match project.completion_policy {
                ProjectCompletionPolicy::Manual => "manual",
                ProjectCompletionPolicy::AgentAutoCommit => "agent_auto_commit",
            };
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "当前 Project 未启用 agent_auto_commit 完成策略。",
            )
            .with_detail(
                ErrorDetail::new("CompletionPolicy")
                    .with_value("projectId", project_id)
                    .with_value("completionPolicy", completion_policy),
            ));
        }

        let snapshot = read_git_snapshot(&project.repo_path).map_err(issue_git_error)?;
        if snapshot.operation_state != GitOperationState::None {
            let issue = self
                .issue_repository
                .find_by_id(issue_id)
                .map_err(issue_database_error)?
                .filter(|issue| issue.project_id == project_id)
                .ok_or_else(|| issue_not_found(issue_id))?;

            if issue.status == IssueStatus::Review {
                let linked_session_id = self
                    .issue_repository
                    .find_running_linked_session_id(project_id, issue_id)
                    .map_err(issue_database_error)?
                    .ok_or_else(|| {
                        CommandError::new(
                            CommandErrorCode::IssueValidationFailed,
                            "只有存在运行中关联 Agent Session 的待验收 Issue 可以使用 Agent Commit。",
                        )
                        .with_detail(
                            ErrorDetail::new("AgentSession").with_value("issueId", issue_id),
                        )
                    })?;
                let transaction = self
                    .issue_repository
                    .connection()
                    .unchecked_transaction()
                    .map_err(issue_database_error)?;
                record_blocked_completion_attempt(
                    &transaction,
                    issue.id,
                    linked_session_id,
                    CompletionAttemptOption::AgentAutoCommit,
                    &snapshot.head,
                    format_git_operation_state(snapshot.operation_state),
                    snapshot.operation_state,
                    "当前 Git 正在进行中的操作阻止 Agent Commit，请先手动处理 Git 状态。",
                )
                .map_err(issue_database_error)?;
                transaction.commit().map_err(issue_database_error)?;
            }

            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "当前 Git 正在进行中的操作阻止 Agent Commit，请先手动处理 Git 状态。",
            )
            .with_detail(ErrorDetail::new("GitOperation").with_value(
                "state",
                format_git_operation_state(snapshot.operation_state),
            )));
        }
        if snapshot.is_clean {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "当前仓库无未提交改动，请直接使用 Complete。",
            )
            .with_detail(
                ErrorDetail::new("GitStatus")
                    .with_value("head", snapshot.head.clone())
                    .with_value("isClean", true),
            ));
        }

        let issue = self
            .issue_repository
            .find_by_id(issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == project_id)
            .ok_or_else(|| issue_not_found(issue_id))?;

        if issue.status != IssueStatus::Review {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有待验收 Issue 可以准备 Agent Commit。",
            )
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("issueId", issue_id)
                    .with_value("status", issue_status_to_str(&issue.status)),
            ));
        }

        let linked_session_id = self
            .issue_repository
            .find_running_linked_session_id(project_id, issue_id)
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::IssueValidationFailed,
                    "只有存在运行中关联 Agent Session 的待验收 Issue 可以使用 Agent Commit。",
                )
                .with_detail(ErrorDetail::new("AgentSession").with_value("issueId", issue_id))
            })?;

        Ok(AgentCommitContext {
            issue,
            linked_session_id,
            snapshot,
        })
    }
}

impl<'connection> IssueService<'connection> {
    fn advance_issue_status_with_transaction(
        &self,
        input: AdvanceIssueStatusInput,
        issue: IssueRecord,
    ) -> Result<IssueRecord, CommandError> {
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(issue_database_error)?;

        let updated_issue = match input.target_status {
            IssueStatus::Running => self.update_issue_status_with_audit_in_transaction(
                &transaction,
                input.project_id,
                input.issue_id,
                issue.status.clone(),
                IssueStatus::Running,
                IssueActionType::IssueStatusChanged,
                None,
            )?,
            IssueStatus::Review => {
                let linked_session_id = IssueRepository::find_running_linked_session_id_in_transaction(
                    &transaction,
                    input.project_id,
                    input.issue_id,
                )
                .map_err(issue_database_error)?;

                if issue.status == IssueStatus::Running {
                    if let Some(linked_session_id) = linked_session_id {
                        let reviewed_issue =
                            IssueRepository::mark_running_issue_review_in_transaction(
                                &transaction,
                                input.project_id,
                                input.issue_id,
                                linked_session_id,
                            )
                            .map_err(issue_database_error)?
                            .ok_or_else(|| {
                                CommandError::new(
                                    CommandErrorCode::IssueValidationFailed,
                                    "只有运行中的 Issue 可以标记待验收。",
                                )
                                .with_detail(
                                    ErrorDetail::new("IssueStatus")
                                        .with_value("issueId", input.issue_id)
                                        .with_value("status", issue_status_to_str(&issue.status)),
                                )
                            })?;

                        let payload_json = json!({
                            "fromStatus": "running",
                            "toStatus": "review",
                            "linkedSessionId": linked_session_id,
                        })
                        .to_string();
                        EventRepository::insert_issue_action_in_transaction(
                            &transaction,
                            reviewed_issue.id,
                            IssueActionType::IssueReviewMarked,
                            &payload_json,
                            reviewed_issue.updated_at,
                        )
                        .map_err(issue_database_error)?;

                        reviewed_issue
                    } else {
                        self.update_issue_status_with_audit_in_transaction(
                            &transaction,
                            input.project_id,
                            input.issue_id,
                            issue.status.clone(),
                            IssueStatus::Review,
                            IssueActionType::IssueStatusChanged,
                            None,
                        )?
                    }
                } else {
                    self.update_issue_status_with_audit_in_transaction(
                        &transaction,
                        input.project_id,
                        input.issue_id,
                        issue.status.clone(),
                        IssueStatus::Review,
                        IssueActionType::IssueStatusChanged,
                        None,
                    )?
                }
            }
            IssueStatus::Completed => {
                let linked_session_id = IssueRepository::find_running_linked_session_id_in_transaction(
                    &transaction,
                    input.project_id,
                    input.issue_id,
                )
                .map_err(issue_database_error)?;

                match (issue.status.clone(), linked_session_id) {
                    (IssueStatus::Running, Some(linked_session_id)) => {
                        let reviewed_issue =
                            IssueRepository::mark_running_issue_review_in_transaction(
                                &transaction,
                                input.project_id,
                                input.issue_id,
                                linked_session_id,
                            )
                            .map_err(issue_database_error)?
                            .ok_or_else(|| {
                                CommandError::new(
                                    CommandErrorCode::IssueValidationFailed,
                                    "只有运行中的 Issue 可以标记待验收。",
                                )
                                .with_detail(
                                    ErrorDetail::new("IssueStatus")
                                        .with_value("issueId", input.issue_id)
                                        .with_value("status", issue_status_to_str(&issue.status)),
                                )
                            })?;
                        let review_payload = json!({
                            "fromStatus": "running",
                            "toStatus": "review",
                            "linkedSessionId": linked_session_id,
                        })
                        .to_string();
                        EventRepository::insert_issue_action_in_transaction(
                            &transaction,
                            reviewed_issue.id,
                            IssueActionType::IssueReviewMarked,
                            &review_payload,
                            reviewed_issue.updated_at,
                        )
                        .map_err(issue_database_error)?;

                        self.complete_issue_from_review_in_transaction(
                            &transaction,
                            input.project_id,
                            input.issue_id,
                            linked_session_id,
                        )?
                    }
                    (IssueStatus::Review, Some(linked_session_id)) => {
                        self.complete_issue_from_review_in_transaction(
                            &transaction,
                            input.project_id,
                            input.issue_id,
                            linked_session_id,
                        )?
                    }
                    (_, Some(linked_session_id)) => self.complete_issue_without_review_in_transaction(
                        &transaction,
                        input.project_id,
                        input.issue_id,
                        issue.status.clone(),
                        Some(linked_session_id),
                    )?,
                    (_, None) => self.complete_issue_without_review_in_transaction(
                        &transaction,
                        input.project_id,
                        input.issue_id,
                        issue.status.clone(),
                        None,
                    )?,
                }
            }
            IssueStatus::Backlog => issue,
        };

        transaction.commit().map_err(issue_database_error)?;
        self.hydrate_issue(updated_issue)
    }

    fn update_issue_status_with_audit_in_transaction(
        &self,
        transaction: &rusqlite::Transaction<'_>,
        project_id: i64,
        issue_id: i64,
        from_status: IssueStatus,
        to_status: IssueStatus,
        action_type: IssueActionType,
        linked_session_id: Option<i64>,
    ) -> Result<IssueRecord, CommandError> {
        let updated_issue = IssueRepository::update_status_in_transaction(
            transaction,
            project_id,
            issue_id,
            to_status.clone(),
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| issue_not_found(issue_id))?;

        let payload_json = json!({
            "fromStatus": issue_status_to_str(&from_status),
            "toStatus": issue_status_to_str(&to_status),
            "linkedSessionId": linked_session_id,
        })
        .to_string();
        EventRepository::insert_issue_action_in_transaction(
            transaction,
            updated_issue.id,
            action_type,
            &payload_json,
            updated_issue.updated_at,
        )
        .map_err(issue_database_error)?;

        Ok(updated_issue)
    }

    fn complete_issue_from_review_in_transaction(
        &self,
        transaction: &rusqlite::Transaction<'_>,
        project_id: i64,
        issue_id: i64,
        linked_session_id: i64,
    ) -> Result<IssueRecord, CommandError> {
        let completed_issue = IssueRepository::complete_review_issue_manually_in_transaction(
            transaction,
            project_id,
            issue_id,
            linked_session_id,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| issue_not_found(issue_id))?;

        let closed_session = AgentSessionRepository::mark_terminated_in_transaction(
            transaction,
            linked_session_id,
            AgentSessionStatus::Closed,
            completed_issue.updated_at,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有存在运行中关联 Agent Session 的待验收 Issue 可以手动完成。",
            )
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", linked_session_id))
        })?;

        let issue_action_payload = json!({
            "fromStatus": "review",
            "toStatus": "completed",
            "linkedSessionId": linked_session_id,
            "option": "status_menu",
        })
        .to_string();
        EventRepository::insert_issue_action_in_transaction(
            transaction,
            completed_issue.id,
            IssueActionType::IssueCompleted,
            &issue_action_payload,
            completed_issue.updated_at,
        )
        .map_err(issue_database_error)?;

        let session_event_payload = json!({
            "sessionId": closed_session.id,
            "issueId": closed_session.issue_id,
            "status": "closed",
            "reason": "status_menu_completion",
            "logPath": closed_session.log_path,
        })
        .to_string();
        EventRepository::insert_session_event_in_transaction(
            transaction,
            closed_session.id,
            SessionEventType::SessionClosed,
            &session_event_payload,
            completed_issue.updated_at,
        )
        .map_err(issue_database_error)?;

        Ok(completed_issue)
    }

    fn complete_issue_without_review_in_transaction(
        &self,
        transaction: &rusqlite::Transaction<'_>,
        project_id: i64,
        issue_id: i64,
        from_status: IssueStatus,
        linked_session_id: Option<i64>,
    ) -> Result<IssueRecord, CommandError> {
        let completed_issue = IssueRepository::update_status_in_transaction(
            transaction,
            project_id,
            issue_id,
            IssueStatus::Completed,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| issue_not_found(issue_id))?;

        if let Some(linked_session_id) = linked_session_id {
            if let Some(closed_session) = AgentSessionRepository::mark_terminated_in_transaction(
                transaction,
                linked_session_id,
                AgentSessionStatus::Closed,
                completed_issue.updated_at,
            )
            .map_err(issue_database_error)?
            {
                let session_event_payload = json!({
                    "sessionId": closed_session.id,
                    "issueId": closed_session.issue_id,
                    "status": "closed",
                    "reason": "status_menu_completion",
                    "logPath": closed_session.log_path,
                })
                .to_string();
                EventRepository::insert_session_event_in_transaction(
                    transaction,
                    closed_session.id,
                    SessionEventType::SessionClosed,
                    &session_event_payload,
                    completed_issue.updated_at,
                )
                .map_err(issue_database_error)?;
            }
        }

        let issue_action_payload = json!({
            "fromStatus": issue_status_to_str(&from_status),
            "toStatus": "completed",
            "linkedSessionId": linked_session_id,
            "option": "status_menu",
        })
        .to_string();
        EventRepository::insert_issue_action_in_transaction(
            transaction,
            completed_issue.id,
            IssueActionType::IssueCompleted,
            &issue_action_payload,
            completed_issue.updated_at,
        )
        .map_err(issue_database_error)?;

        Ok(completed_issue)
    }

    fn load_review_completion_context_in_transaction(
        &self,
        transaction: &rusqlite::Transaction<'_>,
        project_id: i64,
        issue_id: i64,
    ) -> Result<ReviewCompletionContext, CommandError> {
        let issue = IssueRepository::find_by_id_in_transaction(transaction, issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == project_id)
            .ok_or_else(|| issue_not_found(issue_id))?;

        if issue.status != IssueStatus::Review {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有待验收 Issue 可以直接完成。",
            )
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("issueId", issue_id)
                    .with_value("status", issue_status_to_str(&issue.status)),
            ));
        }

        let linked_session_id = IssueRepository::find_running_linked_session_id_in_transaction(
            transaction,
            project_id,
            issue_id,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有存在运行中关联 Agent Session 的待验收 Issue 可以直接完成。",
            )
            .with_detail(ErrorDetail::new("AgentSession").with_value("issueId", issue_id))
        })?;

        Ok(ReviewCompletionContext {
            issue,
            linked_session_id,
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

fn issue_git_error(error: crate::git::status::GitStatusError) -> CommandError {
    CommandError::new(
        CommandErrorCode::IssueValidationFailed,
        "当前 Project 的 Git 状态不可用。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn issue_status_to_str(status: &IssueStatus) -> &'static str {
    match status {
        IssueStatus::Backlog => "backlog",
        IssueStatus::Running => "running",
        IssueStatus::Review => "review",
        IssueStatus::Completed => "completed",
    }
}

fn issue_status_rank(status: &IssueStatus) -> u8 {
    match status {
        IssueStatus::Backlog => 0,
        IssueStatus::Running => 1,
        IssueStatus::Review => 2,
        IssueStatus::Completed => 3,
    }
}

fn build_agent_commit_completion_prompt(issue_title: &str, head: &str) -> String {
    format!(
        "请仅处理当前 Issue 相关改动，并在确认无误后提交。\n\
Issue: {issue_title}\n\
当前 HEAD: {head}\n\
要求：\n\
- 只包含当前 Issue 直接相关文件\n\
- 先自检再提交\n\
- 使用中文 Conventional Commit\n\
- 完成后汇报提交结果与验证命令\n"
    )
}

fn record_blocked_completion_attempt(
    transaction: &rusqlite::Transaction<'_>,
    issue_id: i64,
    session_id: i64,
    option: CompletionAttemptOption,
    head: &str,
    failure_reason: &str,
    operation_state: GitOperationState,
    message: &str,
) -> rusqlite::Result<CompletionAttemptRecord> {
    let changed_files_json = json!({
        "blockedBy": "git_operation",
        "state": format_git_operation_state(operation_state),
        "message": message,
    })
    .to_string();

    CompletionAttemptRepository::insert_in_transaction(
        transaction,
        issue_id,
        session_id,
        option,
        head,
        head,
        None,
        Some(failure_reason),
        &changed_files_json,
        CompletionAttemptResult::GitOperationBlocked,
        current_epoch_millis_for_db()?,
    )
}

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
    connection: &rusqlite::Connection,
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

fn resolve_issue_summary_completion(
    connection: &rusqlite::Connection,
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

fn format_agent_session_status_for_summary(status: &AgentSessionStatus) -> &'static str {
    match status {
        AgentSessionStatus::Running => "running",
        AgentSessionStatus::Closed => "closed",
        AgentSessionStatus::Crashed => "crashed",
        AgentSessionStatus::Stopped => "stopped",
    }
}

fn current_epoch_millis_for_db() -> rusqlite::Result<i64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| rusqlite::Error::InvalidQuery)?;

    i64::try_from(duration.as_millis()).map_err(|_| rusqlite::Error::InvalidQuery)
}

fn format_git_operation_state(state: GitOperationState) -> &'static str {
    match state {
        GitOperationState::None => "none",
        GitOperationState::MergeInProgress => "merge_in_progress",
        GitOperationState::RebaseInProgress => "rebase_in_progress",
        GitOperationState::CherryPickInProgress => "cherry_pick_in_progress",
        GitOperationState::RevertInProgress => "revert_in_progress",
        GitOperationState::SequencerInProgress => "sequencer_in_progress",
        GitOperationState::Unmerged => "unmerged",
    }
}

fn current_epoch_millis() -> Result<i64, CommandError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

    i64::try_from(duration.as_millis()).map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })
}

fn persist_new_attachments(
    transaction: &rusqlite::Transaction<'_>,
    repo_path: &str,
    issue_id: i64,
    attachments: &[IssueAttachmentInput],
) -> Result<(Vec<NewAttachmentPersistence>, Vec<PathBuf>), CommandError> {
    let mut persisted = Vec::new();
    let mut created_files = Vec::new();

    for attachment in attachments {
        let Some(source_path) = attachment.source_path.as_ref() else {
            continue;
        };
        let Some(temp_token) = attachment.temp_token.as_ref() else {
            continue;
        };

        let source = PathBuf::from(source_path);
        let metadata = fs::metadata(&source).map_err(|error| {
            cleanup_created_files(&created_files);
            issue_io_error(error)
        })?;
        if !metadata.is_file() {
            cleanup_created_files(&created_files);
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "附件源文件不存在。",
            ));
        }

        let display_name = attachment.display_name.trim();
        let display_name = if display_name.is_empty() {
            infer_display_name(&source)
        } else {
            display_name.to_string()
        };
        let created_at = current_epoch_millis()?;
        let placeholder_name = format!(
            "pending-{}-{}",
            created_at,
            sanitize_attachment_file_name(&display_name)
        );
        let relative_path = format!(".redwhisk/issues/{issue_id}/attachments/{placeholder_name}");
        let absolute_path = Path::new(repo_path).join(&relative_path);
        if let Some(parent) = absolute_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                cleanup_created_files(&created_files);
                issue_io_error(error)
            })?;
        }
        fs::copy(&source, &absolute_path).map_err(|error| {
            cleanup_created_files(&created_files);
            issue_io_error(error)
        })?;
        created_files.push(absolute_path.clone());

        let analysis = analyze_attachment(&display_name, attachment.mime_type.as_deref());
        let inserted = IssueAttachmentRepository::insert_in_transaction(
            transaction,
            issue_id,
            &display_name,
            &placeholder_name,
            &relative_path,
            &absolute_path.to_string_lossy(),
            attachment.mime_type.as_deref(),
            i64::try_from(metadata.len()).map_err(|_| {
                cleanup_created_files(&created_files);
                CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
            })?,
            analysis.kind,
            analysis.is_previewable,
            created_at,
        )
        .map_err(|error| {
            cleanup_created_files(&created_files);
            issue_database_error(error)
        })?;

        persisted.push(NewAttachmentPersistence {
            temp_token: temp_token.clone(),
            attachment_id: inserted.id,
        });
    }

    Ok((persisted, created_files))
}

fn rewrite_attachment_tokens(
    description: &str,
    attachments: &[NewAttachmentPersistence],
) -> Result<String, CommandError> {
    let mut rewritten = description.to_string();
    for attachment in attachments {
        let from = format!("{{{{issue-attachment-temp:{}}}}}", attachment.temp_token);
        let to = format!("{{{{issue-attachment:{}}}}}", attachment.attachment_id);
        if !rewritten.contains(&from) {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "Issue description 缺少附件标记。",
            ));
        }
        rewritten = rewritten.replace(&from, &to);
    }
    Ok(rewritten)
}

fn parse_attachment_ids(description: &str) -> HashSet<i64> {
    let mut result = HashSet::new();
    let needle = "{{issue-attachment:";
    let mut remaining = description;

    while let Some(start) = remaining.find(needle) {
        let token = &remaining[start + needle.len()..];
        let Some(end) = token.find("}}") else {
            break;
        };
        if let Ok(id) = token[..end].parse::<i64>() {
            result.insert(id);
        }
        remaining = &token[end + 2..];
    }

    result
}

fn update_issue_title_and_description_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    project_id: i64,
    issue_id: i64,
    title: &str,
    description: &str,
) -> rusqlite::Result<Option<IssueRecord>> {
    let changed = transaction.execute(
        "UPDATE issues
         SET title = ?1,
             description = ?2,
             updated_at = MAX(
               updated_at + 1,
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
             )
         WHERE id = ?3 AND project_id = ?4",
        rusqlite::params![title, description, issue_id, project_id],
    )?;

    if changed == 0 {
        return Ok(None);
    }

    IssueRepository::find_by_id_in_transaction(transaction, issue_id)
}

fn analyze_attachment(display_name: &str, mime_type: Option<&str>) -> AttachmentAnalysis {
    let extension = Path::new(display_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mime_type = mime_type.unwrap_or_default().to_ascii_lowercase();

    if matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
    ) || mime_type.starts_with("image/")
    {
        return AttachmentAnalysis {
            kind: IssueAttachmentKind::Image,
            is_previewable: true,
        };
    }

    if extension == "pdf" || mime_type == "application/pdf" {
        return AttachmentAnalysis {
            kind: IssueAttachmentKind::Pdf,
            is_previewable: false,
        };
    }

    if matches!(extension.as_str(), "doc" | "docx") {
        return AttachmentAnalysis {
            kind: IssueAttachmentKind::Word,
            is_previewable: false,
        };
    }

    if matches!(
        extension.as_str(),
        "txt"
            | "md"
            | "markdown"
            | "json"
            | "yaml"
            | "yml"
            | "toml"
            | "rs"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "css"
            | "html"
            | "xml"
            | "sh"
            | "sql"
    ) || mime_type.starts_with("text/")
        || mime_type.contains("json")
        || mime_type.contains("xml")
    {
        return AttachmentAnalysis {
            kind: IssueAttachmentKind::Text,
            is_previewable: true,
        };
    }

    AttachmentAnalysis {
        kind: IssueAttachmentKind::Generic,
        is_previewable: false,
    }
}

fn infer_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment")
        .to_string()
}

fn sanitize_attachment_file_name(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || matches!(char, '.' | '-' | '_') {
                char
            } else {
                '-'
            }
        })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        "attachment".to_string()
    } else {
        trimmed.to_string()
    }
}

fn cleanup_created_files(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

fn delete_attachment_files(attachments: &[IssueAttachmentRecord]) -> Result<(), CommandError> {
    for attachment in attachments {
        let path = Path::new(&attachment.absolute_path);
        if path.exists() {
            fs::remove_file(path).map_err(issue_io_error)?;
        }
    }
    Ok(())
}

fn read_previewable_text_file(path: &str) -> Result<String, CommandError> {
    const MAX_PREVIEW_BYTES: u64 = 256 * 1024;
    let metadata = fs::metadata(path).map_err(issue_io_error)?;
    if metadata.len() > MAX_PREVIEW_BYTES {
        return Err(CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "附件过大，暂不支持预览。",
        ));
    }

    fs::read_to_string(path).map_err(issue_io_error)
}

fn issue_io_error(error: std::io::Error) -> CommandError {
    CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
