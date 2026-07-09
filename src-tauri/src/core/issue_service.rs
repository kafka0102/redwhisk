use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;

use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_registry::AgentSessionRegistry;
use crate::core::agent_session_service::{
    build_issue_session_archive, is_archived_issue_log_path, remove_session_log_file,
    IssueSessionArchive,
};
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::completion_attempt_repository::CompletionAttemptRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::event_repository::EventRepository;
use crate::db::issue_attachment_repository::IssueAttachmentRepository;
use crate::db::issue_completion_flow_repository::{
    IssueCompletionFlowRecordInput, IssueCompletionFlowRepository,
};
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_label_repository::{ProjectLabelRepository, ProjectLabelRow};
use crate::db::project_repository::ProjectRepository;
use crate::git::operation_state::GitOperationState;
use crate::git::status::{read_git_snapshot, GitSnapshot};
use crate::git::worktree::{
    cleanup_worktree, current_branch, is_additional_worktree, is_branch_merged,
    rebase_and_fast_forward, GitWorktreeDirtyRole, GitWorktreeError,
};
use crate::logging::{info_kv, CommandResultExt};
use crate::types::agent_session::{
    AgentSessionRecord, AgentSessionStatus, WorkspaceMode, WorktreeOwner,
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
    IssueLabelRecord, IssueListResponse, IssueRecord, IssueStatus, IssueSummaryCompletionInfo,
    IssueSummaryRecord, MarkIssueReviewInput, PrepareAgentCommitCompletionInput,
    PreviewIssueAttachmentInput, SaveIssueAttachmentDraftInput, SaveIssueAttachmentDraftResult,
    SendAgentCommitPromptInput, SendAgentCommitPromptResult, UpdateIssueInput,
};
use crate::types::issue_action::IssueActionType;
use crate::types::issue_completion::{
    CompleteIssueFlowAction, CompleteIssueFlowInput, CompleteIssueFlowResult, DirtyWorkspaceOption,
    IssueCompletionFlowRecord, IssueCompletionPhase,
};
use crate::types::session_event::SessionEventType;

pub struct IssueService<'connection> {
    issue_repository: IssueRepository<'connection>,
    issue_attachment_repository: IssueAttachmentRepository<'connection>,
    project_repository: ProjectRepository<'connection>,
    data_dir: PathBuf,
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

pub(crate) struct AttachmentAnalysis {
    pub(crate) kind: IssueAttachmentKind,
    pub(crate) is_previewable: bool,
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
        let data_dir = infer_data_dir_from_connection(issue_repository.connection());
        Self {
            issue_attachment_repository: IssueAttachmentRepository::new(
                issue_repository.connection(),
            ),
            issue_repository,
            project_repository,
            data_dir,
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

        Ok(IssueListResponse {
            issues,
            status_totals: None,
        })
    }

    /// 看板按状态分页加载：按 `status` 过滤并应用 `limit`/`offset`。
    pub fn list_issues_page(
        &self,
        project_id: i64,
        status: Option<IssueStatus>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<IssueListResponse, CommandError> {
        self.ensure_project_exists(project_id)?;
        let issues = self
            .issue_repository
            .list_by_project_id_paged(project_id, status, limit, offset)
            .map_err(issue_database_error)?
            .into_iter()
            .map(|issue| self.hydrate_issue(issue))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(IssueListResponse {
            issues,
            status_totals: None,
        })
    }

    /// 看板首屏：四个状态各自取前 `per_status_limit` 条，单次返回扁平列表。
    pub fn list_issues_per_status(
        &self,
        project_id: i64,
        per_status_limit: i64,
    ) -> Result<IssueListResponse, CommandError> {
        self.ensure_project_exists(project_id)?;
        let issues = self
            .issue_repository
            .list_by_project_id_per_status(project_id, per_status_limit)
            .map_err(issue_database_error)?
            .into_iter()
            .map(|issue| self.hydrate_issue(issue))
            .collect::<Result<Vec<_>, _>>()?;
        let status_totals = self
            .issue_repository
            .count_grouped_by_status(project_id)
            .map_err(issue_database_error)?;

        Ok(IssueListResponse {
            issues,
            status_totals: Some(status_totals),
        })
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
        self.require_project(input.project_id)?;
        let title = validate_title(&input.title)?;
        let description = input.description.trim().to_string();
        let label_ids = self.validate_issue_label_ids(input.project_id, &input.label_ids)?;
        let label_ids_json = serialize_label_ids(&label_ids)?;
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
            &label_ids_json,
        )
        .map_err(issue_database_error)?;
        let (created_files, saved_issue) = match persist_new_attachments(
            &transaction,
            &self.data_dir,
            issue.id,
            issue.number,
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
                        &label_ids_json,
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
            "labelIds": label_ids,
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
        self.require_project(input.project_id)?;
        let title = validate_title(&input.title)?;
        let description = input.description.trim().to_string();
        let label_ids = self.validate_issue_label_ids(input.project_id, &input.label_ids)?;
        let label_ids_json = serialize_label_ids(&label_ids)?;
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
            &self.data_dir,
            issue.id,
            issue.number,
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
            &label_ids_json,
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

    pub fn save_issue_attachment_draft(
        &self,
        input: SaveIssueAttachmentDraftInput,
    ) -> Result<SaveIssueAttachmentDraftResult, CommandError> {
        save_issue_attachment_draft_in_data_dir(&self.data_dir, input)
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

        let linked_session_id = IssueRepository::find_linked_session_id_in_transaction(
            &transaction,
            input.project_id,
            input.issue_id,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "只有存在关联 Agent Session 的 Issue 可以标记待验收。",
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
        info_kv(
            "advance_issue_status",
            "issue status change requested",
            &[
                ("projectId", &input.project_id.to_string()),
                ("issueId", &input.issue_id.to_string()),
                ("targetStatus", issue_status_to_str(&input.target_status)),
            ],
        );
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

        match input.target_status {
            IssueStatus::Backlog => self.rollback_issue_to_backlog_with_transaction(input, issue),
            IssueStatus::Running | IssueStatus::Review | IssueStatus::Completed => {
                self.advance_issue_status_with_transaction(input, issue)
            }
        }
    }

    pub fn complete_issue_manual(
        &self,
        input: CompleteIssueManualInput,
    ) -> Result<IssueRecord, CommandError> {
        let result = self.complete_issue_flow_with_option(
            CompleteIssueFlowInput {
                project_id: input.project_id,
                issue_id: input.issue_id,
                dirty_decision: None,
                ignore_dirty: Some(true),
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            self.data_dir.clone(),
            &PtySessionManager::new(),
            &AgentSessionRegistry::new(),
            Some(CompletionAttemptOption::CompleteManual),
        )?;
        if result.action == CompleteIssueFlowAction::Completed {
            Ok(result.issue)
        } else {
            Err(legacy_completion_flow_action_error(result.action))
        }
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
                    .with_detail(
                        ErrorDetail::new("AgentSession").with_value("sessionId", session_id),
                    ));
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

            AgentSessionRepository::soft_delete_in_transaction(
                &transaction,
                session_id,
                deleted_at,
            )
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
        let result = self.complete_issue_flow_with_option(
            CompleteIssueFlowInput {
                project_id: input.project_id,
                issue_id: input.issue_id,
                dirty_decision: None,
                ignore_dirty: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            self.data_dir.clone(),
            &PtySessionManager::new(),
            &AgentSessionRegistry::new(),
            Some(CompletionAttemptOption::CompleteClean),
        )?;
        if result.action == CompleteIssueFlowAction::Completed {
            Ok(result.issue)
        } else {
            Err(legacy_completion_flow_action_error(result.action))
        }
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

        info_kv(
            "prepare_agent_commit_completion",
            "agent commit completion prepared",
            &[
                ("projectId", &input.project_id.to_string()),
                ("issueId", &context.issue.id.to_string()),
                ("sessionId", &context.linked_session_id.to_string()),
                ("head", &context.snapshot.head),
                ("changedFilesCount", &changed_files.len().to_string()),
            ],
        );

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
        _input: SendAgentCommitPromptInput,
        _data_dir: impl AsRef<Path>,
        _pty_sessions: &PtySessionManager,
        _agent_registry: &AgentSessionRegistry,
    ) -> Result<SendAgentCommitPromptResult, CommandError> {
        // TODO(Impl-D): completion_policy / AgentAutoCommit 路径已移除，
        // 该命令的等价语义将在「统一检测 + 弹框确认」流程中重写。
        Err(CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "Agent 自动提交路径已停用，等待新流程重写。",
        )
        .with_detail(ErrorDetail::new("CompletionPolicy").with_value("reason", "deprecated")))
    }

    pub fn complete_issue_flow(
        &self,
        input: CompleteIssueFlowInput,
        data_dir: impl AsRef<Path>,
        pty_sessions: &PtySessionManager,
        agent_registry: &AgentSessionRegistry,
    ) -> Result<CompleteIssueFlowResult, CommandError> {
        self.complete_issue_flow_with_option(input, data_dir, pty_sessions, agent_registry, None)
    }

    fn complete_issue_flow_with_option(
        &self,
        input: CompleteIssueFlowInput,
        _data_dir: impl AsRef<Path>,
        _pty_sessions: &PtySessionManager,
        agent_registry: &AgentSessionRegistry,
        forced_option: Option<CompletionAttemptOption>,
    ) -> Result<CompleteIssueFlowResult, CommandError> {
        info_kv(
            "complete_issue_flow",
            "completion flow started",
            &[
                ("projectId", &input.project_id.to_string()),
                ("issueId", &input.issue_id.to_string()),
            ],
        );
        let project = self.require_project(input.project_id)?;
        let issue = self
            .issue_repository
            .find_by_id(input.issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == input.project_id)
            .ok_or_else(|| issue_not_found(input.issue_id))?;
        if issue.status == IssueStatus::Completed {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "已完成 Issue 不能重复完成。",
            )
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("issueId", issue.id)
                    .with_value("status", issue_status_to_str(&issue.status)),
            ));
        }

        let session = AgentSessionRepository::new(self.issue_repository.connection())
            .find_by_issue_id(issue.id)
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::IssueValidationFailed,
                    "Issue 完成必须存在关联 Agent Session。",
                )
                .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue.id))
            })?;
        if session.project_id != input.project_id {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "关联 Agent Session 不属于当前 Project。",
            )
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id)));
        }
        // completion_policy 已移除：完成时统一检测实际路径与未提交改动，
        // 由用户在弹框中选择「自动提交 / 不提交 / 取消」。
        let option = forced_option.unwrap_or(CompletionAttemptOption::CompleteManual);
        let dirty_already_skipped = input.ignore_dirty == Some(true)
            || input.dirty_decision == Some(DirtyWorkspaceOption::Skip);

        // 解析 session 实际执行路径（分层回退 + worktree 漂移判定）。
        // `actual` 贯穿 dirty 检测提示与 worktree 对账：漂移到的新 worktree 一律
        // 按 External 对待，删除前必须二次确认。
        let actual = resolve_actual_execution_path(&input, &session, agent_registry);

        // 5.4：自动提交后用户确认是否继续标记完成。
        // 仅当存在 ConfirmingContinueAfterCommit 阶段的 flow 且用户给出 continue_after_commit 时生效。
        if let Some(continue_after_commit) = input.continue_after_commit {
            let in_confirming =
                IssueCompletionFlowRepository::new(self.issue_repository.connection())
                    .find_by_issue_id(issue.id)
                    .map_err(issue_database_error)?
                    .is_some_and(|flow| {
                        flow.phase == IssueCompletionPhase::ConfirmingContinueAfterCommit
                    });
            if in_confirming {
                if continue_after_commit {
                    // 确认继续：读取提交后快照，进入 worktree 对账。
                    let detection_repo_path =
                        completion_detection_repo_path(&project.repo_path, &session);
                    let snapshot = read_git_snapshot(&detection_repo_path)
                        .unwrap_or_else(|_| closed_session_completion_snapshot());
                    return self.complete_clean_or_accepted_flow(
                        input,
                        issue,
                        session,
                        snapshot,
                        option,
                        None,
                        &actual,
                        agent_registry,
                    );
                }
                let flow = self.upsert_completion_flow(
                    issue.id,
                    Some(session.id),
                    IssueCompletionPhase::Cancelled,
                    dirty_already_skipped,
                    input.dirty_decision,
                    None,
                    &session,
                    Some(&actual.path),
                    Some("user_cancelled_after_commit"),
                )?;
                return Ok(self.flow_result(
                    CompleteIssueFlowAction::Cancelled,
                    issue,
                    Some(flow),
                    "完成已取消，Issue 保持待验收。".to_string(),
                    &actual,
                    &session,
                ));
            }
        }

        if (issue.status == IssueStatus::Review || issue.status == IssueStatus::Running)
            && is_session_closed_out(&session)
        {
            // 对于 worktree 模式，即使 session 已关闭，也需要走完整的完成流程来处理 worktree 合并和清理
            if session.workspace_mode == WorkspaceMode::Worktree {
                // 继续走下面的完整流程
            } else {
                // 非 worktree 模式可以走快速路径
                let snapshot = closed_session_completion_snapshot();
                let completed_issue = self.complete_issue_flow_transaction(
                    &issue, &session, &snapshot, option, None, None, false,
                )?;

                return Ok(self.flow_result(
                    CompleteIssueFlowAction::Completed,
                    completed_issue,
                    None,
                    "Issue 已完成。".to_string(),
                    &actual,
                    &session,
                ));
            }
        }

        let detection_repo_path = completion_detection_repo_path(&project.repo_path, &session);
        let snapshot = match read_git_snapshot(&detection_repo_path) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                // 对于 worktree 模式，即使 git snapshot 读取失败也要继续走完整流程来处理 worktree 合并
                if session.workspace_mode == WorkspaceMode::Worktree {
                    closed_session_completion_snapshot()
                } else {
                    // 非 worktree 模式可以直接完成
                    let snapshot = closed_session_completion_snapshot();
                    let completed_issue = self.complete_issue_flow_transaction(
                        &issue,
                        &session,
                        &snapshot,
                        option,
                        None,
                        None,
                        dirty_already_skipped,
                    )?;

                    return Ok(self.flow_result(
                        CompleteIssueFlowAction::Completed,
                        completed_issue,
                        None,
                        "Issue 已完成。".to_string(),
                        &actual,
                        &session,
                    ));
                }
            }
        };

        if snapshot.operation_state != GitOperationState::None {
            let transaction = self
                .issue_repository
                .connection()
                .unchecked_transaction()
                .map_err(issue_database_error)?;
            record_blocked_completion_attempt(
                &transaction,
                issue.id,
                session.id,
                option,
                &snapshot.head,
                format_git_operation_state(snapshot.operation_state),
                snapshot.operation_state,
                "当前 Git 正在进行中的操作阻止 Issue 完成。",
            )
            .map_err(issue_database_error)?;
            transaction.commit().map_err(issue_database_error)?;

            return Ok(self.flow_result(
                CompleteIssueFlowAction::Blocked,
                issue,
                None,
                "当前 Git 正在进行中的操作阻止 Issue 完成。".to_string(),
                &actual,
                &session,
            ));
        }

        if !snapshot.is_clean && !dirty_already_skipped {
            // 未提交改动且用户尚未选择「不提交」：按用户 dirty_decision 分流。
            match input.dirty_decision {
                Some(DirtyWorkspaceOption::Cancel) => {
                    let flow = self.upsert_completion_flow(
                        issue.id,
                        Some(session.id),
                        IssueCompletionPhase::Cancelled,
                        false,
                        input.dirty_decision,
                        None,
                        &session,
                        None,
                        Some("user_cancelled"),
                    )?;
                    return Ok(self.flow_result(
                        CompleteIssueFlowAction::Cancelled,
                        issue,
                        Some(flow),
                        "完成已取消，Issue 保持待验收。".to_string(),
                        &actual,
                        &session,
                    ));
                }
                Some(DirtyWorkspaceOption::AutoCommit) => {
                    // 向活跃 session 注入 commit 指令，并记录弹框前 git head（供
                    // detect_agent_commit_completion 比对识别新 commit）。
                    let completion_prompt =
                        build_agent_commit_completion_prompt(&issue.title, &snapshot.head);
                    if let Some(handle) = agent_registry.get(session.id) {
                        handle
                            .send_message(completion_prompt, Vec::new())
                            .map_err(
                                crate::core::agent_session_service::agent_session_error_to_command_error,
                            )?;
                    }
                    let changed_files_json = serde_json::to_string(&snapshot.changed_files)
                        .map_err(|error| {
                            CommandError::new(
                                CommandErrorCode::IssuePersistenceFailed,
                                "Agent Commit 审计保存失败。",
                            )
                            .with_detail(
                                ErrorDetail::new("Cause").with_value("message", error.to_string()),
                            )
                        })?;
                    let recorded_at = current_epoch_millis()?;
                    let transaction = self
                        .issue_repository
                        .connection()
                        .unchecked_transaction()
                        .map_err(issue_database_error)?;
                    CompletionAttemptRepository::insert_in_transaction(
                        &transaction,
                        issue.id,
                        session.id,
                        option,
                        &snapshot.head,
                        &snapshot.head,
                        None,
                        None,
                        &changed_files_json,
                        CompletionAttemptResult::PromptSent,
                        recorded_at,
                    )
                    .map_err(issue_database_error)?;
                    transaction.commit().map_err(issue_database_error)?;
                    info_kv(
                        "complete_issue_flow",
                        "agent auto-commit prompt sent",
                        &[
                            ("issueId", &issue.id.to_string()),
                            ("sessionId", &session.id.to_string()),
                            ("headBefore", &snapshot.head),
                        ],
                    );
                    let flow = self.upsert_completion_flow(
                        issue.id,
                        Some(session.id),
                        IssueCompletionPhase::AutoCommitting,
                        false,
                        input.dirty_decision,
                        None,
                        &session,
                        Some(detection_repo_path.as_str()),
                        None,
                    )?;
                    return Ok(self.flow_result(
                        CompleteIssueFlowAction::WaitingAutoCommit,
                        issue,
                        Some(flow),
                        "已请求 Agent 自动提交，请在 session 中完成提交后再次确认。".to_string(),
                        &actual,
                        &session,
                    ));
                }
                // None 或 Some(Skip) 走到默认 dirty 提示
                _ => {}
            }
            let flow = self.upsert_completion_flow(
                issue.id,
                Some(session.id),
                IssueCompletionPhase::PromptingDirtyDecision,
                false,
                input.dirty_decision,
                None,
                &session,
                None,
                None,
            )?;
            return Ok(self.flow_result(
                CompleteIssueFlowAction::PromptDirtyDecision,
                issue,
                Some(flow),
                "当前工作区存在未提交改动，请选择自动提交 / 不提交 / 取消。".to_string(),
                &actual,
                &session,
            ));
        }

        self.complete_clean_or_accepted_flow(
            input,
            issue,
            session,
            snapshot,
            option,
            None,
            &actual,
            agent_registry,
        )
    }

    fn complete_clean_or_accepted_flow(
        &self,
        input: CompleteIssueFlowInput,
        issue: IssueRecord,
        session: AgentSessionRecord,
        snapshot: GitSnapshot,
        option: CompletionAttemptOption,
        pending_commit: Option<(i64, String)>,
        actual: &ActualExecutionPath,
        _agent_registry: &AgentSessionRegistry,
    ) -> Result<CompleteIssueFlowResult, CommandError> {
        let project = self.require_project(input.project_id)?;
        let dirty_already_skipped = input.ignore_dirty == Some(true)
            || input.dirty_decision == Some(DirtyWorkspaceOption::Skip);
        // 运行中漂移到的新 worktree 一律按 External 对待（删除前必须二次确认）。
        let effective_owner = if actual.drifted {
            WorktreeOwner::External
        } else {
            session.worktree_owner
        };
        let target_branch = session
            .origin_branch
            .clone()
            .or_else(|| session.target_branch.clone());
        let workspace_missing = session.workspace_mode == WorkspaceMode::Worktree
            && session
                .workspace_path
                .as_deref()
                .is_some_and(|workspace_path| !Path::new(workspace_path).exists());
        if workspace_missing && session.worktree_owner == WorktreeOwner::Redwhisk {
            if let Err(error) =
                redwhisk_missing_worktree_is_closed_out(&project.repo_path, &session)
            {
                let flow = self.upsert_completion_flow(
                    issue.id,
                    Some(session.id),
                    IssueCompletionPhase::Blocked,
                    dirty_already_skipped,
                    input.dirty_decision,
                    None,
                    &session,
                    None,
                    Some(&error),
                )?;
                return Ok(self.flow_result(
                    CompleteIssueFlowAction::Blocked,
                    issue,
                    Some(flow),
                    "Agent worktree 缺失且无法确认分支已合入，请手动处理。".to_string(),
                    &actual,
                    &session,
                ));
            }
        }
        let current_branch = if workspace_missing {
            target_branch.clone().unwrap_or_default()
        } else {
            read_current_branch(&session.working_dir)?
        };

        if session.workspace_mode == WorkspaceMode::Worktree
            && !workspace_missing
            && target_branch.as_deref() != Some(current_branch.as_str())
        {
            match effective_owner {
                WorktreeOwner::Redwhisk => {
                    if let Err(error) =
                        rebase_fast_forward_and_cleanup(&project.repo_path, &session)
                    {
                        // 合并冲突 prompt 的注入交给前端用户在「自动合并」弹窗确认后触发，
                        // 后端只记录 Blocked 状态，避免用户选「取消」时 prompt 已被发送。
                        let merge_block = describe_worktree_merge_block(&error);
                        let flow = self.upsert_completion_flow(
                            issue.id,
                            Some(session.id),
                            IssueCompletionPhase::Blocked,
                            dirty_already_skipped,
                            input.dirty_decision,
                            None,
                            &session,
                            None,
                            Some(&error.to_string()),
                        )?;
                        return Ok(self.flow_result_with_merge_block(
                            CompleteIssueFlowAction::Blocked,
                            issue,
                            Some(flow),
                            merge_block.message,
                            Some(merge_block.reason),
                            &actual,
                            &session,
                        ));
                    }
                }
                WorktreeOwner::External => {
                    // External worktree（含运行中漂移 worktree）：按用户删除确认分流。
                    let cleanup_decision = input.worktree_cleanup_decision;
                    let wants_merge_and_cleanup = cleanup_decision == Some(true);
                    let cancelled = input.dirty_decision == Some(DirtyWorkspaceOption::Cancel);
                    if cancelled {
                        let flow = self.upsert_completion_flow(
                            issue.id,
                            Some(session.id),
                            IssueCompletionPhase::Cancelled,
                            dirty_already_skipped,
                            input.dirty_decision,
                            cleanup_decision,
                            &session,
                            None,
                            Some("completion_paused"),
                        )?;
                        return Ok(self.flow_result(
                            CompleteIssueFlowAction::Cancelled,
                            issue,
                            Some(flow),
                            "完成已取消，Issue 保持待验收。".to_string(),
                            &actual,
                            &session,
                        ));
                    } else if cleanup_decision.is_none() {
                        let flow = self.upsert_completion_flow(
                            issue.id,
                            Some(session.id),
                            IssueCompletionPhase::ConfirmingWorktreeCleanup,
                            dirty_already_skipped,
                            input.dirty_decision,
                            None,
                            &session,
                            None,
                            None,
                        )?;
                        return Ok(self.flow_result(
                            CompleteIssueFlowAction::ConfirmWorktreeCleanup,
                            issue,
                            Some(flow),
                            "当前使用外部 worktree，请确认是否合并并删除该 worktree。".to_string(),
                            &actual,
                            &session,
                        ));
                    } else if wants_merge_and_cleanup {
                        if let Err(error) =
                            rebase_fast_forward_and_cleanup(&project.repo_path, &session)
                        {
                            let merge_block = describe_worktree_merge_block(&error);
                            let flow = self.upsert_completion_flow(
                                issue.id,
                                Some(session.id),
                                IssueCompletionPhase::Blocked,
                                dirty_already_skipped,
                                input.dirty_decision,
                                cleanup_decision,
                                &session,
                                None,
                                Some(&error.to_string()),
                            )?;
                            return Ok(self.flow_result_with_merge_block(
                                CompleteIssueFlowAction::Blocked,
                                issue,
                                Some(flow),
                                merge_block.message,
                                Some(merge_block.reason),
                                &actual,
                                &session,
                            ));
                        }
                    }
                    // cleanup_decision == Some(false): 跳过合并与清理，继续完成。
                }
            }
        }

        let commit_hash = pending_commit.as_ref().map(|(_, hash)| hash.clone());
        let attempt_id = pending_commit.map(|(attempt_id, _)| attempt_id);
        let issue = self.complete_issue_flow_transaction(
            &issue,
            &session,
            &snapshot,
            option,
            attempt_id,
            commit_hash.as_deref(),
            dirty_already_skipped,
        )?;

        Ok(self.flow_result(
            CompleteIssueFlowAction::Completed,
            issue,
            None,
            "Issue 已完成。".to_string(),
            &actual,
            &session,
        ))
    }

    fn complete_issue_flow_transaction(
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
                let issue_archive = self.archive_issue_session_in_transaction(
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
                self.archive_issue_session_in_transaction(&transaction, &completed_issue, session)?
            }
        } else {
            self.archive_issue_session_in_transaction(&transaction, &completed_issue, session)?
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
        )
        .map_err(issue_database_error)?;

        let changed_files_json =
            serde_json::to_string(&snapshot.changed_files).map_err(|error| {
                CommandError::new(
                    CommandErrorCode::IssuePersistenceFailed,
                    "CompletionAttempt 保存失败。",
                )
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
            .issue_repository
            .find_by_id(completed_issue.id)
            .map_err(issue_database_error)?
            .ok_or_else(|| issue_not_found(completed_issue.id))?;
        self.hydrate_issue(completed_issue)
    }

    fn upsert_completion_flow(
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

    fn flow_result(
        &self,
        action: CompleteIssueFlowAction,
        issue: IssueRecord,
        flow: Option<IssueCompletionFlowRecord>,
        message: String,
        actual: &ActualExecutionPath,
        session: &AgentSessionRecord,
    ) -> CompleteIssueFlowResult {
        self.flow_result_with_merge_block(action, issue, flow, message, None, actual, session)
    }

    fn flow_result_with_merge_block(
        &self,
        action: CompleteIssueFlowAction,
        issue: IssueRecord,
        flow: Option<IssueCompletionFlowRecord>,
        message: String,
        merge_block_reason: Option<String>,
        actual: &ActualExecutionPath,
        session: &AgentSessionRecord,
    ) -> CompleteIssueFlowResult {
        CompleteIssueFlowResult {
            action,
            issue,
            flow,
            message,
            merge_block_reason,
            target_branch: session
                .origin_branch
                .clone()
                .or_else(|| session.target_branch.clone()),
            workspace_branch: session.workspace_branch.clone(),
            workspace_path: session.workspace_path.clone(),
            actual_path: Some(actual.path.clone()),
            drifted: actual.drifted,
            session_id: Some(session.id),
        }
    }

    pub fn detect_agent_commit_completion(
        &self,
        input: DetectAgentCommitCompletionInput,
    ) -> Result<DetectAgentCommitCompletionResult, CommandError> {
        let issue = self
            .issue_repository
            .find_by_id(input.issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == input.project_id)
            .ok_or_else(|| issue_not_found(input.issue_id))?;
        let session = AgentSessionRepository::new(self.issue_repository.connection())
            .find_by_issue_id(issue.id)
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::IssueValidationFailed,
                    "Issue 完成必须存在关联 Agent Session。",
                )
                .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue.id))
            })?;
        let flow = IssueCompletionFlowRepository::new(self.issue_repository.connection())
            .find_by_issue_id(issue.id)
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::IssueValidationFailed,
                    "当前 Issue 不在自动提交流程中。",
                )
                .with_detail(
                    ErrorDetail::new("IssueCompletionFlow").with_value("issueId", issue.id),
                )
            })?;
        // 仅在 AutoCommitting 阶段检测；其它阶段幂等返回未检测到（前端轮询容错）。
        if flow.phase != IssueCompletionPhase::AutoCommitting {
            return Ok(DetectAgentCommitCompletionResult {
                outcome: DetectAgentCommitCompletionOutcome::NoCommitDetected,
                issue: self.hydrate_issue(issue)?,
                message: "当前不在等待 Agent 提交，无需检测。".to_string(),
            });
        }
        let detection_path = flow
            .actual_path
            .as_deref()
            .filter(|path| !path.is_empty())
            .unwrap_or(&session.working_dir);
        let snapshot = match read_git_snapshot(detection_path) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                return Ok(DetectAgentCommitCompletionResult {
                    outcome: DetectAgentCommitCompletionOutcome::NoCommitDetected,
                    issue: self.hydrate_issue(issue)?,
                    message: "暂无法读取仓库状态，未检测到新 commit。".to_string(),
                });
            }
        };
        if snapshot.operation_state != GitOperationState::None {
            return Ok(DetectAgentCommitCompletionResult {
                outcome: DetectAgentCommitCompletionOutcome::GitOperationBlocked,
                issue: self.hydrate_issue(issue)?,
                message: "当前 Git 正在进行中的操作阻止检测提交。".to_string(),
            });
        }
        // 最近一次 PromptSent attempt 记录了弹框前 head；当前 head 不同即新 commit。
        let pending = CompletionAttemptRepository::new(self.issue_repository.connection())
            .list_by_issue_id(issue.id)
            .map_err(issue_database_error)?
            .into_iter()
            .rev()
            .find(|attempt| attempt.result == CompletionAttemptResult::PromptSent);
        let Some(pending) = pending else {
            return Ok(DetectAgentCommitCompletionResult {
                outcome: DetectAgentCommitCompletionOutcome::NoCommitDetected,
                issue: self.hydrate_issue(issue)?,
                message: "未找到挂起的自动提交记录。".to_string(),
            });
        };
        if !snapshot.head.is_empty() && snapshot.head != pending.head_before {
            // 检测到新 commit：更新 attempt + phase → ConfirmingContinueAfterCommit。
            let transaction = self
                .issue_repository
                .connection()
                .unchecked_transaction()
                .map_err(issue_database_error)?;
            CompletionAttemptRepository::update_result_in_transaction(
                &transaction,
                pending.id,
                &snapshot.head,
                Some(&snapshot.head),
                None,
                CompletionAttemptResult::Completed,
            )
            .map_err(issue_database_error)?;
            transaction.commit().map_err(issue_database_error)?;
            info_kv(
                "detect_agent_commit_completion",
                "agent commit detected",
                &[
                    ("issueId", &issue.id.to_string()),
                    ("sessionId", &session.id.to_string()),
                    ("headBefore", &pending.head_before),
                    ("headAfter", &snapshot.head),
                ],
            );
            self.upsert_completion_flow(
                issue.id,
                Some(session.id),
                IssueCompletionPhase::ConfirmingContinueAfterCommit,
                false,
                None,
                None,
                &session,
                Some(detection_path),
                None,
            )?;
            return Ok(DetectAgentCommitCompletionResult {
                outcome: DetectAgentCommitCompletionOutcome::CommitDetected,
                issue: self.hydrate_issue(issue)?,
                message: "代码已提交成功。确定继续标记完成吗？".to_string(),
            });
        }
        Ok(DetectAgentCommitCompletionResult {
            outcome: DetectAgentCommitCompletionOutcome::NoCommitDetected,
            issue: self.hydrate_issue(issue)?,
            message: "尚未检测到 Agent 提交的新 commit。".to_string(),
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

    pub fn list_issues_page_in_data_dir(
        data_dir: impl AsRef<Path>,
        project_id: i64,
        status: Option<IssueStatus>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<IssueListResponse, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository)
            .list_issues_page(project_id, status, limit, offset)
    }

    pub fn list_issues_per_status_in_data_dir(
        data_dir: impl AsRef<Path>,
        project_id: i64,
        per_status_limit: i64,
    ) -> Result<IssueListResponse, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository)
            .list_issues_per_status(project_id, per_status_limit)
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

    pub fn save_issue_attachment_draft_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: SaveIssueAttachmentDraftInput,
    ) -> Result<SaveIssueAttachmentDraftResult, CommandError> {
        save_issue_attachment_draft_in_data_dir(data_dir.as_ref(), input)
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
        IssueService::new(issue_repository, project_repository)
            .advance_issue_status(input)
            .log_if_error("advance_issue_status")
    }

    pub fn complete_issue_manual_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: CompleteIssueManualInput,
    ) -> Result<IssueRecord, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository)
            .complete_issue_manual(input)
            .log_if_error("complete_issue_manual")
    }

    pub fn complete_issue_clean_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: CompleteIssueCleanInput,
    ) -> Result<IssueRecord, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository)
            .complete_issue_clean(input)
            .log_if_error("complete_issue_clean")
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
            .log_if_error("prepare_agent_commit_completion")
    }

    pub fn send_agent_commit_prompt_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: SendAgentCommitPromptInput,
        pty_sessions: &PtySessionManager,
        agent_registry: &AgentSessionRegistry,
    ) -> Result<SendAgentCommitPromptResult, CommandError> {
        let database = open_issue_database(&data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository)
            .send_agent_commit_prompt(input, data_dir, pty_sessions, agent_registry)
            .log_if_error("send_agent_commit_prompt")
    }

    pub fn complete_issue_flow_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: CompleteIssueFlowInput,
        pty_sessions: &PtySessionManager,
        agent_registry: &AgentSessionRegistry,
    ) -> Result<CompleteIssueFlowResult, CommandError> {
        let database = open_issue_database(&data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository)
            .complete_issue_flow(input, data_dir, pty_sessions, agent_registry)
            .log_if_error("complete_issue_flow")
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
            .log_if_error("detect_agent_commit_completion")
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
        issue.labels = self.resolve_issue_labels(issue.project_id, &issue.label_ids)?;
        Ok(issue)
    }

    fn resolve_issue_labels(
        &self,
        project_id: i64,
        label_ids: &[i64],
    ) -> Result<Vec<IssueLabelRecord>, CommandError> {
        let repository = ProjectLabelRepository::new(self.issue_repository.connection());
        let mut labels = Vec::with_capacity(label_ids.len());

        for label_id in label_ids {
            let Some(label) = repository
                .find_label_by_id(*label_id)
                .map_err(issue_database_error)?
            else {
                continue;
            };

            if label.del != 0 || !is_issue_label_accessible(project_id, &label) {
                continue;
            }

            labels.push(to_issue_label_record(label));
        }

        Ok(labels)
    }

    fn validate_issue_label_ids(
        &self,
        project_id: i64,
        label_ids: &[i64],
    ) -> Result<Vec<i64>, CommandError> {
        let repository = ProjectLabelRepository::new(self.issue_repository.connection());
        let mut normalized = Vec::with_capacity(label_ids.len());
        let mut seen = HashSet::new();

        for label_id in label_ids {
            if !seen.insert(*label_id) {
                continue;
            }

            let label = repository
                .find_label_by_id(*label_id)
                .map_err(issue_database_error)?
                .ok_or_else(|| invalid_issue_label(*label_id, project_id))?;

            if label.del != 0 || !is_issue_label_accessible(project_id, &label) {
                return Err(invalid_issue_label(*label_id, project_id));
            }

            normalized.push(*label_id);
        }

        Ok(normalized)
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
        let _project = self
            .project_repository
            .find_by_id(project_id)
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            })?;

        let issue = self
            .issue_repository
            .find_by_id(issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == project_id)
            .ok_or_else(|| issue_not_found(issue_id))?;
        let linked_session_id = self
            .issue_repository
            .find_linked_session_id(project_id, issue_id)
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::IssueValidationFailed,
                    "只有存在关联 Agent Session 的待验收 Issue 可以使用 Agent Commit。",
                )
                .with_detail(ErrorDetail::new("AgentSession").with_value("issueId", issue_id))
            })?;
        let session = AgentSessionRepository::new(self.issue_repository.connection())
            .find_by_id(linked_session_id)
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::IssueValidationFailed,
                    "只有存在关联 Agent Session 的待验收 Issue 可以使用 Agent Commit。",
                )
                .with_detail(
                    ErrorDetail::new("AgentSession").with_value("sessionId", linked_session_id),
                )
            })?;

        let snapshot = read_git_snapshot(&session.working_dir).map_err(issue_git_error)?;
        if snapshot.operation_state != GitOperationState::None {
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
                    .with_value("isClean", true)
                    .with_value(
                        "workspaceMode",
                        workspace_mode_to_str(&session.workspace_mode),
                    )
                    .with_value(
                        "targetBranch",
                        session.target_branch.as_deref().unwrap_or(""),
                    ),
            ));
        }

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
        let mut issue_archive = None;

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
                let linked_session_id = IssueRepository::find_linked_session_id_in_transaction(
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
                if issue.linked_session_id.is_some() {
                    return Err(CommandError::new(
                        CommandErrorCode::IssueValidationFailed,
                        "Issue 完成必须通过 complete_issue_flow 执行。",
                    )
                    .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id)));
                }
                let linked_session_id = IssueRepository::find_linked_session_id_in_transaction(
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

                        let (completed_issue, archive) = self
                            .complete_issue_from_review_in_transaction(
                                &transaction,
                                input.project_id,
                                input.issue_id,
                                linked_session_id,
                            )?;
                        issue_archive = archive;
                        completed_issue
                    }
                    (IssueStatus::Review, Some(linked_session_id)) => {
                        let (completed_issue, archive) = self
                            .complete_issue_from_review_in_transaction(
                                &transaction,
                                input.project_id,
                                input.issue_id,
                                linked_session_id,
                            )?;
                        issue_archive = archive;
                        completed_issue
                    }
                    (_, Some(linked_session_id)) => {
                        let (completed_issue, archive) = self
                            .complete_issue_without_review_in_transaction(
                                &transaction,
                                input.project_id,
                                input.issue_id,
                                issue.status.clone(),
                                Some(linked_session_id),
                            )?;
                        issue_archive = archive;
                        completed_issue
                    }
                    (_, None) => {
                        let (completed_issue, archive) = self
                            .complete_issue_without_review_in_transaction(
                                &transaction,
                                input.project_id,
                                input.issue_id,
                                issue.status.clone(),
                                None,
                            )?;
                        issue_archive = archive;
                        completed_issue
                    }
                }
            }
            IssueStatus::Backlog => issue,
        };

        if let Err(error) = transaction.commit() {
            rollback_issue_archive(issue_archive.as_ref());
            return Err(issue_database_error(error));
        }
        cleanup_runtime_issue_log(issue_archive.as_ref());
        let updated_issue = self
            .issue_repository
            .find_by_id(updated_issue.id)
            .map_err(issue_database_error)?
            .ok_or_else(|| issue_not_found(updated_issue.id))?;
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

    fn rollback_issue_to_backlog_with_transaction(
        &self,
        input: AdvanceIssueStatusInput,
        issue: IssueRecord,
    ) -> Result<IssueRecord, CommandError> {
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(issue_database_error)?;

        let updated_issue = IssueRepository::update_status_in_transaction(
            &transaction,
            input.project_id,
            input.issue_id,
            IssueStatus::Backlog,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| issue_not_found(input.issue_id))?;

        if let Some(linked_session_id) = issue.linked_session_id {
            if issue.linked_session_status == Some(AgentSessionStatus::Running) {
                let closed_session = AgentSessionRepository::mark_terminated_in_transaction(
                    &transaction,
                    linked_session_id,
                    AgentSessionStatus::Closed,
                    updated_issue.updated_at,
                )
                .map_err(issue_database_error)?
                .ok_or_else(|| {
                    CommandError::new(
                        CommandErrorCode::IssueValidationFailed,
                        "退回 Backlog 时关闭关联 Agent Session 失败。",
                    )
                    .with_detail(
                        ErrorDetail::new("AgentSession").with_value("sessionId", linked_session_id),
                    )
                })?;

                let session_event_payload = json!({
                    "sessionId": closed_session.id,
                    "issueId": closed_session.issue_id,
                    "status": "closed",
                    "reason": "status_menu_backlog_return",
                    "logPath": closed_session.log_path,
                })
                .to_string();
                EventRepository::insert_session_event_in_transaction(
                    &transaction,
                    closed_session.id,
                    SessionEventType::SessionClosed,
                    &session_event_payload,
                    updated_issue.updated_at,
                )
                .map_err(issue_database_error)?;
            }

            let deleted = AgentSessionRepository::soft_delete_in_transaction(
                &transaction,
                linked_session_id,
                updated_issue.updated_at,
            )
            .map_err(issue_database_error)?;
            if !deleted {
                return Err(CommandError::new(
                    CommandErrorCode::IssueValidationFailed,
                    "退回 Backlog 时移除关联 Agent Session 失败。",
                )
                .with_detail(
                    ErrorDetail::new("AgentSession").with_value("sessionId", linked_session_id),
                ));
            }
        }

        let payload_json = json!({
            "fromStatus": issue_status_to_str(&issue.status),
            "toStatus": "backlog",
            "linkedSessionId": issue.linked_session_id,
        })
        .to_string();
        EventRepository::insert_issue_action_in_transaction(
            &transaction,
            updated_issue.id,
            IssueActionType::IssueStatusChanged,
            &payload_json,
            updated_issue.updated_at,
        )
        .map_err(issue_database_error)?;

        let backlog_issue =
            IssueRepository::find_by_id_in_transaction(&transaction, input.issue_id)
                .map_err(issue_database_error)?
                .ok_or_else(|| issue_not_found(input.issue_id))?;

        transaction.commit().map_err(issue_database_error)?;

        // 关联 Agent Session 被软删后，同步删除磁盘上的 session log 文件。
        if issue.linked_session_id.is_some() {
            remove_session_log_file(issue.linked_session_log_path.as_deref());
        }

        self.hydrate_issue(backlog_issue)
    }

    fn complete_issue_from_review_in_transaction(
        &self,
        transaction: &rusqlite::Transaction<'_>,
        project_id: i64,
        issue_id: i64,
        linked_session_id: i64,
    ) -> Result<(IssueRecord, Option<IssueSessionArchive>), CommandError> {
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
                "只有存在关联 Agent Session 的待验收 Issue 可以手动完成。",
            )
            .with_detail(
                ErrorDetail::new("AgentSession").with_value("sessionId", linked_session_id),
            )
        })?;
        let issue_archive = self.archive_issue_session_in_transaction(
            transaction,
            &completed_issue,
            &closed_session,
        )?;

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
            "logPath": issue_archive
                .as_ref()
                .map(|archive| archive.archive_path.as_str())
                .unwrap_or(closed_session.log_path.as_str()),
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

        Ok((completed_issue, issue_archive))
    }

    fn complete_issue_without_review_in_transaction(
        &self,
        transaction: &rusqlite::Transaction<'_>,
        project_id: i64,
        issue_id: i64,
        from_status: IssueStatus,
        linked_session_id: Option<i64>,
    ) -> Result<(IssueRecord, Option<IssueSessionArchive>), CommandError> {
        let completed_issue = IssueRepository::update_status_in_transaction(
            transaction,
            project_id,
            issue_id,
            IssueStatus::Completed,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| issue_not_found(issue_id))?;
        let mut issue_archive = None;

        if let Some(linked_session_id) = linked_session_id {
            let session_before_close =
                AgentSessionRepository::find_by_id_in_transaction(transaction, linked_session_id)
                    .map_err(issue_database_error)?;
            if let Some(closed_session) = AgentSessionRepository::mark_terminated_in_transaction(
                transaction,
                linked_session_id,
                AgentSessionStatus::Closed,
                completed_issue.updated_at,
            )
            .map_err(issue_database_error)?
            {
                issue_archive = self.archive_issue_session_in_transaction(
                    transaction,
                    &completed_issue,
                    &closed_session,
                )?;
                let session_event_payload = json!({
                    "sessionId": closed_session.id,
                    "issueId": closed_session.issue_id,
                    "status": "closed",
                    "reason": "status_menu_completion",
                    "logPath": issue_archive
                        .as_ref()
                        .map(|archive| archive.archive_path.as_str())
                        .unwrap_or(closed_session.log_path.as_str()),
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
            } else if let Some(session_before_close) = session_before_close.as_ref() {
                issue_archive = self.archive_issue_session_in_transaction(
                    transaction,
                    &completed_issue,
                    session_before_close,
                )?;
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

        Ok((completed_issue, issue_archive))
    }

    fn archive_issue_session_in_transaction(
        &self,
        transaction: &rusqlite::Transaction<'_>,
        issue: &IssueRecord,
        session: &AgentSessionRecord,
    ) -> Result<Option<IssueSessionArchive>, CommandError> {
        if session.issue_id != Some(issue.id)
            || session.log_path.trim().is_empty()
            || is_archived_issue_log_path(&self.data_dir, &session.log_path)
        {
            return Ok(None);
        }

        let archive = build_issue_session_archive(
            &self.data_dir,
            issue.project_id,
            issue.number,
            session.number,
            session.id,
            &session.log_path,
        )?;
        AgentSessionRepository::update_log_path_and_latest_output_in_transaction(
            transaction,
            session.id,
            &archive.archive_path,
            archive.latest_output.as_deref(),
            issue.updated_at,
        )
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssuePersistenceFailed,
                "Issue 归档失败，关联会话不存在。",
            )
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue.id))
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id))
        })?;

        Ok(Some(archive))
    }
}

fn rollback_issue_archive(archive: Option<&IssueSessionArchive>) {
    let Some(archive) = archive else {
        return;
    };
    remove_issue_log_file(&archive.archive_path);
}

fn cleanup_runtime_issue_log(archive: Option<&IssueSessionArchive>) {
    let Some(archive) = archive else {
        return;
    };
    if archive.runtime_path != archive.archive_path {
        remove_issue_log_file(&archive.runtime_path);
    }
}

fn remove_issue_log_file(path: &str) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => {}
    }
}

fn infer_data_dir_from_connection(connection: &rusqlite::Connection) -> PathBuf {
    connection
        .path()
        .filter(|path| !path.is_empty())
        .and_then(|path| Path::new(path).parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from(".redwhisk"))
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

fn rebase_fast_forward_and_cleanup(
    repo_path: &str,
    session: &AgentSessionRecord,
) -> Result<(), crate::git::worktree::GitWorktreeError> {
    let Some(target_branch) = session
        .origin_branch
        .as_deref()
        .or(session.target_branch.as_deref())
    else {
        return Ok(());
    };
    let Some(workspace_branch) = session.workspace_branch.as_deref() else {
        return Ok(());
    };
    let Some(workspace_path) = session.workspace_path.as_deref() else {
        return Ok(());
    };
    if !Path::new(workspace_path).exists() {
        return Ok(());
    }

    rebase_and_fast_forward(repo_path, workspace_path, target_branch, workspace_branch)?;
    cleanup_worktree(repo_path, workspace_path, workspace_branch)?;
    Ok(())
}

struct WorktreeMergeBlockDescription {
    reason: String,
    message: String,
}

fn describe_worktree_merge_block(error: &GitWorktreeError) -> WorktreeMergeBlockDescription {
    match error {
        GitWorktreeError::DirtyWorktree { role, path, files } => match role {
            GitWorktreeDirtyRole::Target => WorktreeMergeBlockDescription {
                reason: "target_worktree_dirty".to_string(),
                message: format!(
                    "目标分支工作区存在未提交改动，无法合入 Agent worktree。请先在目标分支工作区提交、暂存或丢弃这些改动：{files}。工作区：{path}"
                ),
            },
            GitWorktreeDirtyRole::Workspace => WorktreeMergeBlockDescription {
                reason: "workspace_worktree_dirty".to_string(),
                message: format!(
                    "Agent worktree 存在未提交改动，无法自动合入目标分支。请先提交或处理这些改动：{files}。工作区：{path}"
                ),
            },
        },
        GitWorktreeError::GitCommandFailed { command, message }
            if is_likely_merge_conflict(command, message) =>
        {
            WorktreeMergeBlockDescription {
                reason: "merge_conflict".to_string(),
                message: "Agent worktree 合并发生冲突，请手动处理冲突。".to_string(),
            }
        }
        _ => WorktreeMergeBlockDescription {
            reason: "git_command_failed".to_string(),
            message: format!("Agent worktree 合入失败：{error}"),
        },
    }
}

fn is_likely_merge_conflict(command: &str, message: &str) -> bool {
    (command.contains(" rebase ") || command.contains(" merge "))
        && (message.contains("CONFLICT")
            || message.contains("could not apply")
            || message.contains("Automatic merge failed")
            || message.contains("fix conflicts"))
}

fn redwhisk_missing_worktree_is_closed_out(
    repo_path: &str,
    session: &AgentSessionRecord,
) -> Result<(), String> {
    let target_branch = session
        .origin_branch
        .as_deref()
        .or(session.target_branch.as_deref())
        .ok_or_else(|| "缺失 RedWhisk worktree 的目标分支元数据。".to_string())?;
    let workspace_branch = session
        .workspace_branch
        .as_deref()
        .ok_or_else(|| "缺失 RedWhisk worktree 的工作分支元数据。".to_string())?;
    if !branch_exists(repo_path, workspace_branch)? {
        return Ok(());
    }
    match is_branch_merged(repo_path, target_branch, workspace_branch) {
        Ok(true) => Ok(()),
        Ok(false) => Err(format!(
            "RedWhisk worktree 路径缺失，但工作分支 {workspace_branch} 尚未合入 {target_branch}。"
        )),
        Err(error) => Err(error.to_string()),
    }
}

fn branch_exists(repo_path: &str, branch: &str) -> Result<bool, String> {
    let branch_ref = format!("refs/heads/{branch}");
    let output = Command::new("git")
        .args(["show-ref", "--verify", "--quiet", branch_ref.as_str()])
        .current_dir(repo_path)
        .output()
        .map_err(|error| error.to_string())?;

    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
    }
}

fn read_current_branch(repo_path: &str) -> Result<String, CommandError> {
    let output = Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(repo_path)
        .output()
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "当前 Project 的 Git 状态不可用。",
            )
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
    if !output.status.success() {
        return Err(CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "当前 Project 的 Git 状态不可用。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value(
            "message",
            String::from_utf8_lossy(&output.stderr).to_string(),
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn completion_session_close_reason(option: CompletionAttemptOption) -> &'static str {
    match option {
        CompletionAttemptOption::CompleteManual => "manual_completion",
        CompletionAttemptOption::CompleteClean => "clean_completion",
    }
}

fn legacy_completion_flow_action_error(action: CompleteIssueFlowAction) -> CommandError {
    let message = match action {
        CompleteIssueFlowAction::PromptDirtyDecision => "当前仓库存在未提交改动，不能直接完成。",
        CompleteIssueFlowAction::Blocked => "当前 Git 正在进行中的操作阻止直接完成。",
        _ => "Issue 完成必须通过 complete_issue_flow 继续处理。",
    };
    CommandError::new(CommandErrorCode::IssueValidationFailed, message)
        .with_detail(ErrorDetail::new("CompletionFlow").with_value("action", format!("{action:?}")))
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

fn serialize_label_ids(label_ids: &[i64]) -> Result<String, CommandError> {
    serde_json::to_string(label_ids).map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })
}

fn invalid_issue_label(label_id: i64, project_id: i64) -> CommandError {
    CommandError::new(
        CommandErrorCode::IssueValidationFailed,
        "Issue labels 配置无效。",
    )
    .with_detail(ErrorDetail::new("IssueLabel").with_value("labelId", label_id))
    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
}

fn is_issue_label_accessible(project_id: i64, label: &ProjectLabelRow) -> bool {
    match label.scope {
        crate::types::project_label::ProjectLabelScope::Global => true,
        crate::types::project_label::ProjectLabelScope::Project => {
            label.project_id == Some(project_id)
        }
    }
}

fn to_issue_label_record(label: ProjectLabelRow) -> IssueLabelRecord {
    IssueLabelRecord {
        id: label.id,
        name: label.name,
        scope: label.scope,
        project_id: label.project_id,
        color: label.color,
        workflow_skill: label.workflow_skill,
    }
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

fn completion_detection_repo_path(project_repo_path: &str, session: &AgentSessionRecord) -> String {
    if session.workspace_mode == WorkspaceMode::Worktree
        && session
            .workspace_path
            .as_deref()
            .is_some_and(|workspace_path| !Path::new(workspace_path).exists())
    {
        return project_repo_path.to_string();
    }

    session.working_dir.clone()
}

/// 完成时解析出的实际执行路径来源。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActualPathSource {
    /// 结构化 codex session 最近一条 shell 命令的 cwd（best-effort）。
    CodexCwd,
    /// session 启动记录的 `workspace_path`/`working_dir` 快照（PTY 或 cwd 不可得时）。
    StartupSnapshot,
    /// 用户在弹框中手填覆盖。
    UserProvided,
}

/// 完成时解析出的 session 实际执行路径。
///
/// 用于：①未提交改动检测与漂移判定的路径基准；②前端弹框预填分支名；
/// ③识别「current branch 启动但运行中漂移到新 worktree」的第三种情况。
///
/// `source`/`in_worktree`/`worktree_branch` 当前由单测与 Impl-D（合并基准）/前端
/// （弹框预填）消费，非 test 构建仅写不读，故允许 dead_code。
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) struct ActualExecutionPath {
    /// 解析出的实际路径（已去空白）。
    pub path: String,
    pub source: ActualPathSource,
    /// 该路径是否位于附加 worktree（`--git-dir` 与 `--git-common-dir` 不同）。
    pub in_worktree: bool,
    /// 该 worktree 的 checkout 分支（非 worktree 时为 `None`）。
    pub worktree_branch: Option<String>,
    /// 实际路径与启动快照不同且位于 worktree → 运行中漂移到新 worktree。
    pub drifted: bool,
}

/// 解析 session 完成时的实际执行路径（分层回退）。
///
/// 优先级：用户弹框手填 `input.actual_path` > 活跃结构化 session 的 `last_known_cwd`
/// > 启动记录 `workspace_path`/`working_dir`。PTY session 与关闭的 session 取不到
/// live cwd，回退启动快照。拿到路径后再判断是否在 worktree、是否相对启动路径漂移。
fn resolve_actual_execution_path(
    input: &CompleteIssueFlowInput,
    session: &AgentSessionRecord,
    agent_registry: &AgentSessionRegistry,
) -> ActualExecutionPath {
    let startup_path = session
        .workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .or_else(|| {
            let working_dir = session.working_dir.trim();
            (!working_dir.is_empty()).then_some(working_dir)
        })
        .unwrap_or_default()
        .to_string();

    let (path, source) = if let Some(user_path) = input
        .actual_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        (user_path.to_string(), ActualPathSource::UserProvided)
    } else if let Some(cwd) = agent_registry
        .get(session.id)
        .and_then(|handle| handle.last_known_cwd())
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        (cwd.to_string(), ActualPathSource::CodexCwd)
    } else {
        (startup_path.clone(), ActualPathSource::StartupSnapshot)
    };

    if path.is_empty() {
        return ActualExecutionPath {
            path,
            source,
            in_worktree: false,
            worktree_branch: None,
            drifted: false,
        };
    }

    let in_worktree = is_additional_worktree(&path).unwrap_or(false);
    let worktree_branch = if in_worktree {
        current_branch(&path).ok()
    } else {
        None
    };
    // 漂移：实际路径与启动快照不同，且实际路径位于某 worktree。
    let drifted = in_worktree && path != startup_path;

    ActualExecutionPath {
        path,
        source,
        in_worktree,
        worktree_branch,
        drifted,
    }
}

fn is_session_closed_out(session: &AgentSessionRecord) -> bool {
    session.status != AgentSessionStatus::Running || session.closed_at.is_some()
}

fn closed_session_completion_snapshot() -> GitSnapshot {
    GitSnapshot {
        head: String::new(),
        status_porcelain: String::new(),
        changed_files: Vec::new(),
        operation_state: GitOperationState::None,
        is_clean: true,
    }
}

fn issue_status_to_str(status: &IssueStatus) -> &'static str {
    match status {
        IssueStatus::Backlog => "backlog",
        IssueStatus::Running => "running",
        IssueStatus::Review => "review",
        IssueStatus::Completed => "completed",
    }
}

fn workspace_mode_to_str(mode: &WorkspaceMode) -> &'static str {
    match mode {
        WorkspaceMode::CurrentBranch => "current_branch",
        WorkspaceMode::Worktree => "worktree",
    }
}

fn build_agent_commit_completion_prompt(issue_title: &str, head: &str) -> String {
    format!(
        "请获取本次修改相关的代码，检查当前 Issue 涉及的文件变更；只暂存并提交与本次 Issue 直接相关的文件，不要提交无关改动。\n\
Issue: {issue_title}\n\
当前 HEAD: {head}\n\
要求：\n\
- 只包含当前 Issue 直接相关文件\n\
- 不要提交无关改动\n\
- 先自检再提交\n\
- 使用中文 Conventional Commit\n\
- 完成后请回复 commit hash、提交结果与验证命令\n"
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
    data_dir: &Path,
    issue_id: i64,
    issue_number: i64,
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
        let relative_path =
            format!(".redwhisk/issues/{issue_number}/attachments/{placeholder_name}");
        let absolute_path = data_dir
            .join("issues")
            .join(issue_number.to_string())
            .join("attachments")
            .join(&placeholder_name);
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

fn save_issue_attachment_draft_in_data_dir(
    data_dir: &Path,
    input: SaveIssueAttachmentDraftInput,
) -> Result<SaveIssueAttachmentDraftResult, CommandError> {
    let source = PathBuf::from(&input.source_path);
    let metadata = fs::metadata(&source).map_err(issue_io_error)?;
    if !metadata.is_file() {
        return Err(CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "附件源文件不存在。",
        ));
    }

    let display_name = input.display_name.trim();
    let display_name = if display_name.is_empty() {
        infer_display_name(&source)
    } else {
        display_name.to_string()
    };
    let stored_name = format!(
        "{}-{}",
        current_epoch_millis()?,
        sanitize_attachment_file_name(&display_name)
    );
    let draft_dir = data_dir.join("issue-attachment-drafts");
    fs::create_dir_all(&draft_dir).map_err(issue_io_error)?;
    let destination = draft_dir.join(stored_name);
    fs::copy(&source, &destination).map_err(issue_io_error)?;

    let analysis = analyze_attachment(&display_name, None);
    Ok(SaveIssueAttachmentDraftResult {
        path: destination.to_string_lossy().to_string(),
        display_name,
        kind: analysis.kind,
        is_previewable: analysis.is_previewable,
    })
}

// 将 description 中的临时附件标记 `{{issue-attachment-temp:token}}` 重写为持久化
// 标记 `{{issue-attachment:id}}`。
//
// 该替换对两种形态都生效，因为 `contains`/`replace` 都按子串匹配：
// 1. 裸标记行：单独成行的 `{{issue-attachment-temp:token}}`；
// 2. 图片占位符：Markdown 图片语法 `![alt]({{issue-attachment-temp:token}})`，
//    其 URL 部分即该 token 子串，替换后得到 `![alt]({{issue-attachment:id}})`。
// 每个临时 token 都必须在 description 中出现（无论哪种形态），否则视为缺失附件标记。
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
    label_ids_json: &str,
) -> rusqlite::Result<Option<IssueRecord>> {
    let changed = transaction.execute(
        "UPDATE issues
         SET title = ?1,
             description = ?2,
             label_ids = ?3,
             updated_at = MAX(
               updated_at + 1,
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
             )
         WHERE id = ?4 AND project_id = ?5",
        rusqlite::params![title, description, label_ids_json, issue_id, project_id],
    )?;

    if changed == 0 {
        return Ok(None);
    }

    IssueRepository::find_by_id_in_transaction(transaction, issue_id)
}

pub(crate) fn analyze_attachment(
    display_name: &str,
    mime_type: Option<&str>,
) -> AttachmentAnalysis {
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

pub(crate) fn sanitize_attachment_file_name(value: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::IssueService;
    use crate::agent::pty_session_manager::PtySessionManager;
    use crate::agent::session_registry::AgentSessionRegistry;
    use crate::core::agent_session_service::build_issue_archive_log_path;
    use crate::db::issue_repository::IssueRepository;
    use crate::db::migrations::MigrationRunner;
    use crate::db::project_repository::ProjectRepository;
    use crate::types::agent_session_stream::{
        AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem, ToolCallDetail,
        ToolCallStatus,
    };
    use crate::types::issue::{AdvanceIssueStatusInput, IssueStatus};
    use crate::types::issue_completion::{CompleteIssueFlowAction, CompleteIssueFlowInput};
    use rusqlite::{params, Connection};
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use tempfile::tempdir;

    #[test]
    fn rollback_running_issue_to_backlog_removes_linked_session_log_file() {
        let temp_dir = tempdir().expect("create temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_git_repo(&repo_dir);

        let connection = Connection::open_in_memory().expect("open database");
        MigrationRunner::default()
            .run(&connection)
            .expect("run migrations");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'RedWhisk', ?1, 1, 1)",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("insert project");
        connection
            .execute(
                "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
                 VALUES (101, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1, '', '', 0)",
                [],
            )
            .expect("insert profile");
        connection
            .execute(
                "INSERT INTO issues (id, project_id, title, description, status, label_ids, created_at, updated_at, del)
                 VALUES (16, 1, 'Issue 16', '', 'running', '[]', 1, 1, 0)",
                [],
            )
            .expect("insert running issue");

        let log_file = temp_dir.path().join("linked-session.log");
        fs::write(&log_file, b"{}").expect("write linked session log file");
        assert!(log_file.exists());

        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, issue_id, title, agent_profile_id, codex_session_id,
                   status, attention, working_dir, command_snapshot, prompt_snapshot,
                   workspace_mode, target_branch, workspace_branch, workspace_path,
                   origin_branch, worktree_owner, log_path,
                   list_inserted_at, last_active_at, started_at, closed_at, del
                 ) VALUES (
                   30, 1, 16, NULL, 101, 'thread-16',
                   'running', 'none', ?1, 'codex', '',
                   'current_branch', NULL, NULL, NULL,
                   NULL, 'external', ?2,
                   1, 2, 1, NULL, 0
                 )",
                params![
                    repo_dir.to_string_lossy().to_string(),
                    log_file.to_string_lossy().to_string(),
                ],
            )
            .expect("insert linked running session");

        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let result = service
            .advance_issue_status(AdvanceIssueStatusInput {
                project_id: 1,
                issue_id: 16,
                target_status: IssueStatus::Backlog,
            })
            .expect("rollback issue to backlog");

        assert_eq!(result.status, IssueStatus::Backlog);
        assert!(
            !log_file.exists(),
            "关联 Session 软删后应同步删除磁盘上的 session log 文件"
        );
    }

    #[test]
    fn complete_issue_flow_completes_review_issue_with_closed_session_without_agent_commit_check() {
        let temp_dir = tempdir().expect("create temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_git_repo(&repo_dir);
        fs::write(repo_dir.join("dirty.txt"), "dirty\n").expect("write dirty file");

        let connection = setup_issue_completion_database(&repo_dir);
        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );

        let result = service
            .complete_issue_flow(
                CompleteIssueFlowInput {
                    project_id: 1,
                    issue_id: 16,
                    ignore_dirty: None,
                    dirty_decision: None,
                    branch_name: None,
                    actual_path: None,
                    continue_after_commit: None,
                    worktree_cleanup_decision: None,
                },
                temp_dir.path().join("data"),
                &PtySessionManager::new(),
                &AgentSessionRegistry::new(),
            )
            .expect("complete issue");

        assert_eq!(result.action, CompleteIssueFlowAction::Completed);
        assert_eq!(result.issue.status, IssueStatus::Completed);

        // 关闭的 session（非 worktree）走快速完成路径，不经过 agent 自动提交检测；
        // 记录 complete_manual 完成审计。
        let (option, completion_result): (String, String) = connection
            .query_row(
                "SELECT option, result FROM completion_attempts WHERE issue_id = 16",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("completion attempt");
        assert_eq!(option, "complete_manual");
        assert_eq!(completion_result, "completed");
    }

    #[test]
    fn complete_issue_flow_archives_session_log_and_deletes_runtime_file() {
        let temp_dir = tempdir().expect("create temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let data_dir = temp_dir.path().join("data");
        create_git_repo(&repo_dir);
        fs::create_dir_all(&data_dir).expect("create data dir");

        let connection = setup_issue_completion_database_on_disk(&data_dir, &repo_dir);
        let runtime_log_path = data_dir
            .join("session-logs")
            .join("runtime")
            .join("project-1")
            .join("project-1-issue-16-session-30.jsonl");
        fs::create_dir_all(
            runtime_log_path
                .parent()
                .expect("runtime log should have parent"),
        )
        .expect("create runtime log dir");
        let runtime_events = [
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 30,
                seq: 1,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::UserMessage {
                        text: "请整理结果".to_string(),
                        message_id: Some("u1".to_string()),
                    },
                    turn_id: None,
                    seq: 1,
                    timestamp: 1,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 30,
                seq: 2,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::ToolCall {
                        call_id: "call-1".to_string(),
                        name: "shell".to_string(),
                        detail: ToolCallDetail::Unknown {
                            raw_input: Some("git status".to_string()),
                            raw_output: Some("clean".to_string()),
                        },
                        status: ToolCallStatus::Completed,
                        error: None,
                    },
                    turn_id: None,
                    seq: 2,
                    timestamp: 2,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 30,
                seq: 3,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::AssistantMessage {
                        text: "归档后的回答".to_string(),
                        message_id: Some("a1".to_string()),
                    },
                    turn_id: None,
                    seq: 3,
                    timestamp: 3,
                },
            },
        ];
        let lines = runtime_events
            .iter()
            .map(|event| serde_json::to_string(event).expect("serialize event"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&runtime_log_path, format!("{lines}\n")).expect("write runtime log");
        connection
            .execute(
                "UPDATE agent_sessions SET log_path = ?1 WHERE id = 30",
                params![runtime_log_path.to_string_lossy().to_string()],
            )
            .expect("update runtime log path");

        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let result = service
            .complete_issue_flow(
                CompleteIssueFlowInput {
                    project_id: 1,
                    issue_id: 16,
                    ignore_dirty: None,
                    dirty_decision: None,
                    branch_name: None,
                    actual_path: None,
                    continue_after_commit: None,
                    worktree_cleanup_decision: None,
                },
                &data_dir,
                &PtySessionManager::new(),
                &AgentSessionRegistry::new(),
            )
            .expect("complete issue");

        assert_eq!(result.action, CompleteIssueFlowAction::Completed);
        assert_eq!(result.issue.status, IssueStatus::Completed);
        assert!(!runtime_log_path.exists());

        let archived_log_path: String = connection
            .query_row(
                "SELECT log_path FROM agent_sessions WHERE id = 30",
                [],
                |row| row.get(0),
            )
            .expect("query archived log path");
        let latest_output: Option<String> = connection
            .query_row(
                "SELECT latest_output FROM agent_sessions WHERE id = 30",
                [],
                |row| row.get(0),
            )
            .expect("query latest output");
        let expected_archive_path =
            build_issue_archive_log_path(&data_dir, 1, 4, 7).expect("archive path");

        assert_eq!(
            fs::canonicalize(&archived_log_path).expect("canonical archived log path"),
            fs::canonicalize(&expected_archive_path).expect("canonical expected archive path")
        );
        assert_eq!(
            result.issue.linked_session_log_path.as_deref(),
            Some(archived_log_path.as_str())
        );
        assert_eq!(latest_output.as_deref(), Some("归档后的回答"));
        assert!(Path::new(&archived_log_path).exists());

        let archived_content =
            fs::read_to_string(&archived_log_path).expect("read archived session log");
        assert!(!archived_content.contains("tool_call"));
        assert!(archived_content.contains("user_message"));
        assert!(archived_content.contains("assistant_message"));
    }

    #[test]
    fn complete_issue_flow_reports_dirty_target_worktree_when_worktree_merge_is_blocked() {
        let temp_dir = tempdir().expect("create temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-16");
        create_git_repo(&repo_dir);
        let target_branch = git_output(&repo_dir, &["branch", "--show-current"]);

        git(
            &repo_dir,
            &[
                "worktree",
                "add",
                "-b",
                "issue-16",
                worktree_path.to_string_lossy().as_ref(),
                &target_branch,
            ],
        );
        fs::write(worktree_path.join("base.txt"), "issue change\n").expect("write worktree change");
        git(&worktree_path, &["add", "base.txt"]);
        git(&worktree_path, &["commit", "-m", "issue change"]);
        fs::write(repo_dir.join("base.txt"), "local base change\n")
            .expect("write dirty target change");

        let connection = setup_issue_completion_database(&repo_dir);
        connection
            .execute(
                "UPDATE agent_sessions
                 SET working_dir = ?1,
                     status = 'running',
                     workspace_mode = 'worktree',
                     target_branch = ?2,
                     workspace_branch = 'issue-16',
                     workspace_path = ?1,
                     origin_branch = ?2,
                     worktree_owner = 'redwhisk',
                     closed_at = NULL
                 WHERE id = 30",
                params![worktree_path.to_string_lossy().to_string(), target_branch,],
            )
            .expect("update session worktree metadata");
        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );

        let result = service
            .complete_issue_flow(
                CompleteIssueFlowInput {
                    project_id: 1,
                    issue_id: 16,
                    ignore_dirty: None,
                    dirty_decision: None,
                    branch_name: None,
                    actual_path: None,
                    continue_after_commit: None,
                    worktree_cleanup_decision: None,
                },
                temp_dir.path().join("data"),
                &PtySessionManager::new(),
                &AgentSessionRegistry::new(),
            )
            .expect("complete issue flow");

        assert_eq!(result.action, CompleteIssueFlowAction::Blocked);
        assert_eq!(
            result.merge_block_reason.as_deref(),
            Some("target_worktree_dirty")
        );
        assert!(result.message.contains("目标分支工作区存在未提交改动"));
        assert!(result.message.contains("工作区："));
    }

    fn setup_issue_completion_database(repo_dir: &Path) -> Connection {
        let connection = Connection::open_in_memory().expect("open database");
        MigrationRunner::default()
            .run(&connection)
            .expect("run migrations");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'RedWhisk', ?1, 1, 1)",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("insert project");
        connection
            .execute(
                "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
                 VALUES (101, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1, '', '', 0)",
                [],
            )
            .expect("insert profile");
        connection
            .execute(
                "INSERT INTO issues (id, project_id, number, title, description, status, label_ids, created_at, updated_at, del)
                 VALUES (16, 1, 4, 'Issue 16', '', 'review', '[]', 1, 1, 0)",
                [],
            )
            .expect("insert issue");
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, number, issue_id, title, agent_profile_id, codex_session_id,
                   status, attention, working_dir, command_snapshot, prompt_snapshot,
                   workspace_mode, target_branch, workspace_branch, workspace_path,
                   origin_branch, worktree_owner, log_path,
                   list_inserted_at, last_active_at, started_at, closed_at, del
                 ) VALUES (
                   30, 1, 7, 16, NULL, 101, 'thread-16',
                   'stopped', 'none', ?1, 'codex', '',
                   'current_branch', NULL, NULL, NULL,
                   NULL, 'external', ?2,
                   1, 2, 1, 2, 0
                 )",
                params![
                    repo_dir.to_string_lossy().to_string(),
                    repo_dir.join("session.log").to_string_lossy().to_string(),
                ],
            )
            .expect("insert session");

        connection
    }

    fn setup_issue_completion_database_on_disk(data_dir: &Path, repo_dir: &Path) -> Connection {
        let db_path = data_dir.join("redwhisk.db");
        let connection = Connection::open(db_path).expect("open on-disk database");
        MigrationRunner::default()
            .run(&connection)
            .expect("run migrations");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'RedWhisk', ?1, 1, 1)",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("insert project");
        connection
            .execute(
                "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
                 VALUES (101, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1, '', '', 0)",
                [],
            )
            .expect("insert profile");
        connection
            .execute(
                "INSERT INTO issues (id, project_id, number, title, description, status, label_ids, created_at, updated_at, del)
                 VALUES (16, 1, 4, 'Issue 16', '', 'review', '[]', 1, 1, 0)",
                [],
            )
            .expect("insert issue");
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, number, issue_id, title, agent_profile_id, codex_session_id,
                   status, attention, working_dir, command_snapshot, prompt_snapshot,
                   workspace_mode, target_branch, workspace_branch, workspace_path,
                   origin_branch, worktree_owner, log_path,
                   list_inserted_at, last_active_at, started_at, closed_at, del
                 ) VALUES (
                   30, 1, 7, 16, NULL, 101, 'thread-16',
                   'stopped', 'none', ?1, 'codex', '',
                   'current_branch', NULL, NULL, NULL,
                   NULL, 'external', ?2,
                   1, 2, 1, 2, 0
                 )",
                params![
                    repo_dir.to_string_lossy().to_string(),
                    repo_dir.join("session.log").to_string_lossy().to_string(),
                ],
            )
            .expect("insert session");

        connection
    }

    fn create_git_repo(repo_dir: &Path) {
        fs::create_dir_all(repo_dir).expect("create repo dir");
        git(repo_dir, &["init"]);
        git(repo_dir, &["config", "user.email", "redwhisk@example.test"]);
        git(repo_dir, &["config", "user.name", "RedWhisk Test"]);
        fs::write(repo_dir.join("base.txt"), "base\n").expect("write base file");
        git(repo_dir, &["add", "base.txt"]);
        git(repo_dir, &["commit", "-m", "initial"]);
    }

    fn git(repo_dir: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_dir)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_output(repo_dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_dir)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout)
            .expect("git stdout utf8")
            .trim()
            .to_string()
    }

    #[test]
    fn rewrite_attachment_tokens_handles_bare_and_image_placeholder_tokens() {
        use super::{rewrite_attachment_tokens, NewAttachmentPersistence};

        let attachments = vec![
            NewAttachmentPersistence {
                temp_token: "draft-img-1".to_string(),
                attachment_id: 101,
            },
            NewAttachmentPersistence {
                temp_token: "draft-file-1".to_string(),
                attachment_id: 102,
            },
        ];

        // 描述同时包含图片占位符（Markdown 图片语法中以 token 作 URL）与裸 token 行。
        let description = "See screenshot.\n\n![pic.png]({{issue-attachment-temp:draft-img-1}})\n\n{{issue-attachment-temp:draft-file-1}}";

        let rewritten =
            rewrite_attachment_tokens(description, &attachments).expect("rewrite tokens");

        // 图片占位符内的 token 被替换为持久化标记，仍是合法 Markdown 图片语法。
        assert!(rewritten.contains("![pic.png]({{issue-attachment:101}})"));
        // 裸 token 行被替换为持久化标记。
        assert!(rewritten.contains("{{issue-attachment:102}}"));
        // 临时标记不应残留。
        assert!(!rewritten.contains("issue-attachment-temp"));
    }

    #[test]
    fn rewrite_attachment_tokens_errors_when_image_token_missing() {
        use super::{rewrite_attachment_tokens, NewAttachmentPersistence};

        let attachments = vec![NewAttachmentPersistence {
            temp_token: "draft-img-1".to_string(),
            attachment_id: 101,
        }];

        // 描述中缺失该 token（无论哪种形态）应报错，满足 Rust 硬约束。
        let result = rewrite_attachment_tokens("No token here.", &attachments);
        assert!(result.is_err());
    }

    // ---- resolve_actual_execution_path 单测（Impl-C：路径解析与漂移捕获）----

    use super::{resolve_actual_execution_path, ActualPathSource};
    use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
    use crate::types::agent_session::{
        AgentMessageAttachment, AgentPermissionDecision, AgentSessionAttention, AgentSessionRecord,
        AgentSessionStatus, WorkspaceMode, WorktreeOwner,
    };
    use crate::types::agent_session_stream::{AgentMode, AgentModel};
    use std::sync::Arc;

    /// 测试用结构化 session 句柄：仅 `last_known_cwd` 可配置，其余方法空实现。
    struct CwdHandle(Option<String>);

    impl AgentSessionHandle for CwdHandle {
        fn send_message(
            &self,
            _: String,
            _: Vec<AgentMessageAttachment>,
        ) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn cancel_turn(&self) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn respond_permission(
            &self,
            _: &str,
            _: AgentPermissionDecision,
        ) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn set_model(&self, _: String) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn set_effort(&self, _: Option<String>) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn set_mode(&self, _: &str) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn list_models(&self) -> Result<Vec<AgentModel>, AgentSessionError> {
            Ok(Vec::new())
        }
        fn list_modes(&self) -> Vec<AgentMode> {
            Vec::new()
        }
        fn read_timeline(&self) -> Result<Vec<AgentTimelineItem>, AgentSessionError> {
            Ok(Vec::new())
        }
        fn shutdown(&self) {}
        fn thread_id(&self) -> Option<String> {
            None
        }
        fn last_known_cwd(&self) -> Option<String> {
            self.0.clone()
        }
    }

    fn resolver_session(working_dir: String, workspace_path: Option<String>) -> AgentSessionRecord {
        AgentSessionRecord {
            id: 1,
            number: 0,
            project_id: 1,
            issue_id: None,
            title: None,
            agent_profile_id: 1,
            workflow_skill_name: None,
            codex_session_id: None,
            status: AgentSessionStatus::Running,
            attention: AgentSessionAttention::None,
            working_dir,
            command_snapshot: String::new(),
            prompt_snapshot: String::new(),
            workspace_mode: WorkspaceMode::CurrentBranch,
            target_branch: None,
            workspace_branch: None,
            workspace_path,
            origin_branch: None,
            worktree_owner: WorktreeOwner::Redwhisk,
            worktree_root_path: None,
            worktree_setup_command: None,
            log_path: String::new(),
            latest_output: None,
            last_active_at: 0,
            started_at: 0,
            closed_at: None,
        }
    }

    fn empty_input() -> CompleteIssueFlowInput {
        CompleteIssueFlowInput {
            project_id: 1,
            issue_id: 1,
            dirty_decision: None,
            ignore_dirty: None,
            branch_name: None,
            actual_path: None,
            continue_after_commit: None,
            worktree_cleanup_decision: None,
        }
    }

    #[test]
    fn resolve_actual_execution_path_prefers_user_provided_override() {
        let session = resolver_session("/repo".to_string(), Some("/repo".to_string()));
        let registry = AgentSessionRegistry::new();
        registry.register(1, Arc::new(CwdHandle(Some("/from-codex".to_string()))));
        let input = CompleteIssueFlowInput {
            actual_path: Some("/user-override".to_string()),
            ..empty_input()
        };
        let actual = resolve_actual_execution_path(&input, &session, &registry);
        assert_eq!(actual.path, "/user-override");
        assert_eq!(actual.source, ActualPathSource::UserProvided);
    }

    #[test]
    fn resolve_actual_execution_path_uses_codex_cwd_when_no_override() {
        // 非 worktree 路径：codex cwd 命中但不构成漂移。
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_git_repo(&repo_dir);
        let cwd = repo_dir.to_string_lossy().to_string();
        let session = resolver_session(cwd.clone(), Some(cwd.clone()));
        let registry = AgentSessionRegistry::new();
        registry.register(1, Arc::new(CwdHandle(Some(cwd.clone()))));
        let actual = resolve_actual_execution_path(&empty_input(), &session, &registry);
        assert_eq!(actual.path, cwd);
        assert_eq!(actual.source, ActualPathSource::CodexCwd);
        assert!(!actual.drifted);
    }

    #[test]
    fn resolve_actual_execution_path_falls_back_to_startup_snapshot() {
        // 无 live handle（PTY / session 关闭）且无用户覆盖 → 启动快照。
        let session = resolver_session("/repo".to_string(), Some("/repo".to_string()));
        let registry = AgentSessionRegistry::new();
        let actual = resolve_actual_execution_path(&empty_input(), &session, &registry);
        assert_eq!(actual.path, "/repo");
        assert_eq!(actual.source, ActualPathSource::StartupSnapshot);
        assert!(!actual.drifted);
    }

    #[test]
    fn resolve_actual_execution_path_detects_drift_into_worktree() {
        // 启动在主仓库，运行中漂移到 skill 自建的 worktree → drifted=true。
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_git_repo(&repo_dir);
        let worktree_path = temp_dir.path().join("drifted-worktree");
        git(
            &repo_dir,
            &[
                "worktree",
                "add",
                "-b",
                "drifted-branch",
                worktree_path.to_string_lossy().as_ref(),
            ],
        );
        let startup = repo_dir.to_string_lossy().to_string();
        let cwd = worktree_path.to_string_lossy().to_string();
        let session = resolver_session(startup.clone(), Some(startup.clone()));
        let registry = AgentSessionRegistry::new();
        registry.register(1, Arc::new(CwdHandle(Some(cwd.clone()))));
        let actual = resolve_actual_execution_path(&empty_input(), &session, &registry);
        assert_eq!(actual.path, cwd);
        assert_eq!(actual.source, ActualPathSource::CodexCwd);
        assert!(actual.in_worktree);
        assert_eq!(actual.worktree_branch.as_deref(), Some("drifted-branch"));
        assert!(actual.drifted);
    }
}
