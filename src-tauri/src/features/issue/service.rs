use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;

use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_registry::AgentSessionRegistry;
use crate::features::agent_session::{
    build_issue_session_archive, is_archived_issue_log_path, remove_session_log_file,
    IssueSessionArchive,
};
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::completion_attempt_repository::CompletionAttemptRepository;
use crate::db::event_repository::EventRepository;
use crate::db::issue_attachment_repository::IssueAttachmentRepository;
use crate::db::issue_comment_repository::IssueCommentRepository;
use crate::db::issue_repository::IssueRepository;
use crate::db::project_label_repository::ProjectLabelRepository;
use crate::db::project_repository::ProjectRepository;
use crate::git::operation_state::{format_git_operation_state, git_operation_blocking_message, GitOperationBlockContext, GitOperationState};
use crate::git::status::{read_git_snapshot, GitSnapshot};
use crate::logging::{info_kv, CommandResultExt};
use crate::types::agent_session::{
    AgentSessionRecord, AgentSessionStatus, WorktreeOwner,
    format_agent_session_status_for_summary, workspace_mode_to_str,
};
use crate::types::completion_attempt::CompletionAttemptOption;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{
    AdvanceIssueStatusInput, AgentCommitChangedFileSummary, AgentCommitCompletionPreview,
    CompleteIssueCleanInput, CompleteIssueManualInput, CreateIssueInput, DeleteIssueInput,
    DeleteIssueResult, DeleteIssueWorktreeCleanup, DetectAgentCommitCompletionInput, DetectAgentCommitCompletionResult,
    ExportIssueAttachmentInput, GetIssueSummaryInput, GetIssueTimelineInput,
    IssueAttachmentKind, IssueAttachmentPreview, IssueLabelRecord,
    IssueListResponse, IssueRecord, IssueStatus, IssueSummaryRecord,
    IssueTimelineActionType, IssueTimelineActor, IssueTimelineEntry, IssueTimelineResponse,
    MarkIssueReviewInput, PrepareAgentCommitCompletionInput, PreviewIssueAttachmentInput,
    SaveIssueAttachmentDraftInput, SaveIssueAttachmentDraftResult, SendAgentCommitPromptInput,
    SendAgentCommitPromptResult, UpdateIssueInput, issue_status_to_str,
};
use crate::types::issue_action::{IssueActionActor, IssueActionType};
use crate::types::issue_completion::{
    CompleteIssueFlowAction, CompleteIssueFlowInput, CompleteIssueFlowResult,
};
use crate::types::session_event::SessionEventType;

use super::archive::{
    cleanup_runtime_issue_log, infer_data_dir_from_connection, open_issue_database,
    rollback_issue_archive,
};
use super::attachment::{
    analyze_attachment, cleanup_created_files, delete_attachment_files,
    infer_display_name, issue_io_error,
    parse_attachment_ids, persist_new_attachments, read_previewable_text_file,
    rewrite_attachment_tokens, save_issue_attachment_draft_in_data_dir, ResolvedAttachmentSource,
};
use super::completion::flow::legacy_completion_flow_action_error;
use super::completion::formatting::build_agent_commit_completion_prompt;
use super::completion::summary::resolve_issue_summary_completion;
use super::time::current_epoch_millis;
use super::validation::{
    invalid_issue_label, is_issue_label_accessible, issue_database_error, issue_git_error,
    issue_not_found, serialize_label_ids, to_issue_label_record, validate_title,
};

pub struct IssueService<'connection> {
    pub(crate) issue_repository: IssueRepository<'connection>,
    issue_attachment_repository: IssueAttachmentRepository<'connection>,
    project_repository: ProjectRepository<'connection>,
    data_dir: PathBuf,
}

struct AgentCommitContext {
    issue: IssueRecord,
    linked_session_id: i64,
    snapshot: GitSnapshot,
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
            ).with_reason("mustBeCompletedToViewSummary")
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

    pub fn get_issue_timeline(
        &self,
        input: GetIssueTimelineInput,
    ) -> Result<IssueTimelineResponse, CommandError> {
        self.ensure_project_exists(input.project_id)?;
        let issue = self
            .issue_repository
            .find_by_id(input.issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == input.project_id)
            .ok_or_else(|| issue_not_found(input.issue_id))?;

        let rows = EventRepository::new(self.issue_repository.connection())
            .list_issue_timeline_rows(issue.id)
            .map_err(issue_database_error)?;

        let mut entries = Vec::new();
        for row in rows {
            let action_type = row.action_type;
            let actor_kind = row.actor_kind;
            let agent_name_snapshot = row.agent_name_snapshot;
            let agent_type = row.agent_type;
            let user_name = row.user_name;
            let user_avatar_path = row.user_avatar_path;
            let created_at = row.created_at;
            let comment_body = row.comment_body;
            let Some(action_type) = IssueTimelineActionType::from_action_str(&action_type) else {
                continue;
            };
            let (name, avatar_path, resolved_agent_type) = if actor_kind == "agent" {
                (
                    agent_name_snapshot.unwrap_or_default(),
                    None,
                    agent_type,
                )
            } else {
                (user_name.unwrap_or_default(), user_avatar_path, None)
            };
            // 评论正文仅在评论动作上内联，其余动作显式置空。
            let resolved_comment_body = if action_type == IssueTimelineActionType::IssueCommentAdded
            {
                comment_body
            } else {
                None
            };
            entries.push(IssueTimelineEntry {
                action_type,
                actor: IssueTimelineActor {
                    name,
                    avatar_path,
                    actor_kind,
                    agent_type: resolved_agent_type,
                },
                created_at,
                comment_body: resolved_comment_body,
            });
        }

        Ok(IssueTimelineResponse { entries })
    }

    /// 在单事务内写一条 Issue 评论与对应的 `IssueCommentAdded` 动作。
    ///
    /// 评论正文独立存入 `issue_comments`，动作负载只存评论引用（评论 id、关联会话、
    /// 关联 turn），正文不进事件负载。作者归属由 `actor` 表达：Agent 携带名称快照，
    /// 用户携带档案 id（为未来用户手动评论预留，本票仅覆盖 Agent 路径）。
    ///
    /// 幂等：`(linked_session_id, linked_turn_id)` 命中 `UNIQUE` 冲突时（Agent 评论
    /// 重复触发），忽略重复写入，不再插入动作，静默返回 `Ok(())`。用户评论两个关联
    /// 列均为 `NULL`，SQLite 中 NULL 不冲突，可多条。
    pub fn add_issue_comment(
        &self,
        issue_id: i64,
        body: &str,
        actor: IssueActionActor,
        linked_session_id: Option<i64>,
        linked_turn_id: Option<&str>,
    ) -> Result<(), CommandError> {
        let created_at = current_epoch_millis()?;
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(issue_database_error)?;

        let comment_id = IssueCommentRepository::insert_if_absent_in_transaction(
            &transaction,
            issue_id,
            body,
            linked_session_id,
            linked_turn_id,
            created_at,
        )
        .map_err(issue_database_error)?;

        // 仅在真正写入新评论时才追加动作；重复触发（UNIQUE 冲突）整体忽略。
        if let Some(comment_id) = comment_id {
            let payload_json = json!({
                "commentId": comment_id,
                "linkedSessionId": linked_session_id,
                "linkedTurnId": linked_turn_id,
            });
            EventRepository::insert_issue_action_in_transaction(
                &transaction,
                issue_id,
                IssueActionType::IssueCommentAdded,
                &payload_json.to_string(),
                created_at,
                actor,
            )
            .map_err(issue_database_error)?;
        }

        transaction.commit().map_err(issue_database_error)?;
        Ok(())
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
                    IssueRepository::update_title_and_description_in_transaction(
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
            IssueActionActor::User { profile_id: 1 },
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
        IssueRepository::update_title_and_description_in_transaction(
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
            ).with_reason("attachmentPreviewUnsupported"));
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
            ).with_reason("mustBeRunningToAccept")
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
            ).with_reason("mustHaveSessionToAccept")
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
            ).with_reason("mustBeRunningToAccept")
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
            IssueActionActor::User { profile_id: 1 },
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

        // 已完成 Issue 只允许回退到 backlog，禁止直接改到 running/review。
        if issue.status == IssueStatus::Completed
            && matches!(
                input.target_status,
                IssueStatus::Running | IssueStatus::Review
            )
        {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "已完成的 Issue 只能回退到待办，不能标记为进行中或待审核。",
            )
            .with_reason("completedCanOnlyReturnToBacklog")
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("issueId", input.issue_id)
                    .with_value("status", issue_status_to_str(&issue.status))
                    .with_value(
                        "targetStatus",
                        issue_status_to_str(&input.target_status),
                    ),
            ));
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
            Err(legacy_completion_flow_action_error(
                result.action,
                &result.message,
            ))
        }
    }

    pub fn delete_issue(&self, input: DeleteIssueInput) -> Result<DeleteIssueResult, CommandError> {
        let project = self.require_project(input.project_id)?;
        // 事务前读取 latest worktree session，避免在未提交事务上复用 connection。
        let latest_worktree_session = AgentSessionRepository::new(self.issue_repository.connection())
            .find_latest_worktree_session_by_issue_id(input.issue_id)
            .map_err(issue_database_error)?;

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

        // soft-delete 前收集清理上下文（session log / worktree），事务外 best-effort 执行。
        let mut linked_session_log_path = issue.linked_session_log_path.clone();
        let mut worktree_cleanup: Option<DeleteIssueWorktreeCleanup> = None;

        if let Some(session_id) = issue.linked_session_id {
            if let Ok(Some(session)) =
                AgentSessionRepository::find_by_id_in_transaction(&transaction, session_id)
            {
                if linked_session_log_path.is_none() && !session.log_path.is_empty() {
                    linked_session_log_path = Some(session.log_path.clone());
                }
                worktree_cleanup =
                    redwhisk_worktree_cleanup_from_session(&project.repo_path, &session);
            }

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
                    ).with_reason("deleteCloseSessionFailed")
                    .with_detail(
                        ErrorDetail::new("AgentSession").with_value("sessionId", session_id),
                    ));
                }

                let session_event_payload = json!({
                    "sessionId": session_id,
                    "issueId": issue.id,
                    "status": "closed",
                    "reason": "issue_deleted",
                    "logPath": linked_session_log_path,
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

        if worktree_cleanup.is_none() {
            if let Some(session) = latest_worktree_session.as_ref() {
                worktree_cleanup =
                    redwhisk_worktree_cleanup_from_session(&project.repo_path, session);
            }
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
            IssueActionActor::User { profile_id: 1 },
        )
        .map_err(issue_database_error)?;

        transaction.commit().map_err(issue_database_error)?;

        Ok(DeleteIssueResult {
            issue_id: issue.id,
            linked_session_id: issue.linked_session_id,
            linked_session_log_path,
            worktree_cleanup,
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
            Err(legacy_completion_flow_action_error(
                result.action,
                &result.message,
            ))
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
        ).with_reason("autoCommitDisabled")
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
            .with_reason("alreadyCompleted")
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
                .with_reason("sessionRequiredToComplete")
                .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue.id))
            })?;
        if session.project_id != input.project_id {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "关联 Agent Session 不属于当前 Project。",
            )
            .with_reason("sessionNotInProject")
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id)));
        }
        crate::features::issue::completion::use_case::CompletionFlow::new(self).drive(
            input,
            &project,
            issue,
            session,
            forced_option,
            agent_registry,
        )
    }

    pub fn detect_agent_commit_completion(
        &self,
        input: DetectAgentCommitCompletionInput,
    ) -> Result<DetectAgentCommitCompletionResult, CommandError> {
        crate::features::issue::completion::use_case::CompletionFlow::new(self)
            .detect_commit(input)
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

    pub fn get_issue_timeline_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: GetIssueTimelineInput,
    ) -> Result<IssueTimelineResponse, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).get_issue_timeline(input)
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

    pub(crate) fn require_project(
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

    pub(crate) fn hydrate_issue(&self, mut issue: IssueRecord) -> Result<IssueRecord, CommandError> {
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
                        CommandError::new(CommandErrorCode::IssueNotFound, "附件不存在。").with_reason("attachmentNotFound")
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
                    ).with_reason("draftAttachmentUnreadable"));
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
            ).with_reason("attachmentParamsInvalid")),
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
                ).with_reason("mustBeAcceptableWithSessionToCommit")
                .with_detail(ErrorDetail::new("AgentSession").with_value("issueId", issue_id))
            })?;
        let session = AgentSessionRepository::new(self.issue_repository.connection())
            .find_by_id(linked_session_id)
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::IssueValidationFailed,
                    "只有存在关联 Agent Session 的待验收 Issue 可以使用 Agent Commit。",
                ).with_reason("mustBeAcceptableWithSessionToCommit")
                .with_detail(
                    ErrorDetail::new("AgentSession").with_value("sessionId", linked_session_id),
                )
            })?;

        let snapshot = read_git_snapshot(&session.working_dir).map_err(issue_git_error)?;
        if snapshot.operation_state != GitOperationState::None {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                git_operation_blocking_message(
                    snapshot.operation_state,
                    GitOperationBlockContext::AgentCommit,
                    Some(session.working_dir.as_str()),
                ),
            ).with_reason("gitOperationBlockingCommit")
            .with_detail(ErrorDetail::new("GitOperation").with_value(
                "state",
                format_git_operation_state(snapshot.operation_state),
            )));
        }
        if snapshot.is_clean {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "当前仓库无未提交改动，请直接使用 Complete。",
            ).with_reason("noChangesUseComplete")
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
            ).with_reason("mustBeAcceptableToPrepareCommit")
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
                                ).with_reason("mustBeRunningToAccept")
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
                            IssueActionActor::User { profile_id: 1 },
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
                    ).with_reason("mustUseCompletionFlow")
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
                                ).with_reason("mustBeRunningToAccept")
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
                            IssueActionActor::User { profile_id: 1 },
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
            IssueActionActor::User { profile_id: 1 },
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
                    ).with_reason("backlogCloseSessionFailed")
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
                ).with_reason("backlogRemoveSessionFailed")
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
            IssueActionActor::User { profile_id: 1 },
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
            ).with_reason("mustBeAcceptableWithSessionToComplete")
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
            IssueActionActor::User { profile_id: 1 },
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
            IssueActionActor::User { profile_id: 1 },
        )
        .map_err(issue_database_error)?;

        Ok((completed_issue, issue_archive))
    }

    pub(crate) fn archive_issue_session_in_transaction(
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
            &session.display_mode,
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
            ).with_reason("archiveSessionNotFound")
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue.id))
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id))
        })?;

        Ok(Some(archive))
    }
}

/// 仅当 session 为 RedWhisk 管理且具备完整 worktree 路径/分支信息时返回清理上下文。
fn redwhisk_worktree_cleanup_from_session(
    repo_path: &str,
    session: &AgentSessionRecord,
) -> Option<DeleteIssueWorktreeCleanup> {
    if session.worktree_owner != WorktreeOwner::Redwhisk {
        return None;
    }
    let workspace_path = session.workspace_path.as_deref()?.trim();
    let workspace_branch = session.workspace_branch.as_deref()?.trim();
    if workspace_path.is_empty() || workspace_branch.is_empty() {
        return None;
    }
    Some(DeleteIssueWorktreeCleanup {
        repo_path: repo_path.to_string(),
        workspace_path: workspace_path.to_string(),
        workspace_branch: workspace_branch.to_string(),
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

#[cfg(test)]
mod tests {
    use super::IssueService;
    use crate::agent::pty_session_manager::PtySessionManager;
    use crate::agent::session_registry::AgentSessionRegistry;
    use crate::features::agent_session::build_issue_archive_log_path;
    use crate::db::issue_repository::IssueRepository;
    use crate::db::migrations::MigrationRunner;
    use crate::db::project_repository::ProjectRepository;
    use crate::types::agent_session_stream::{
        AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem, ToolCallDetail,
        ToolCallStatus,
    };
    use crate::types::issue::{
        AdvanceIssueStatusInput, DetectAgentCommitCompletionInput,
        DetectAgentCommitCompletionOutcome, GetIssueTimelineInput, IssueTimelineActionType,
        IssueStatus,
    };
    use crate::types::issue_action::IssueActionActor;
    use crate::types::issue_completion::{
        CompleteIssueFlowAction, CompleteIssueFlowInput, DirtyWorkspaceOption,
    };
    use rusqlite::{params, Connection};
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use tempfile::tempdir;

    #[test]
    fn get_issue_timeline_resolves_agent_and_user_actors() {
        let connection = Connection::open_in_memory().expect("open database");
        MigrationRunner::default()
            .run(&connection)
            .expect("run migrations");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'RedWhisk', '', 1, 1)",
                [],
            )
            .expect("insert project");
        connection
            .execute(
                "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
                 VALUES (101, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1, '', '', 0)",
                [],
            )
            .expect("insert agent profile");
        connection
            .execute(
                "INSERT INTO issues (id, project_id, title, description, status, label_ids, created_at, updated_at, del)
                 VALUES (16, 1, 'Issue 16', '', 'backlog', '[]', 1, 1, 0)",
                [],
            )
            .expect("insert issue");
        connection
            .execute(
                "INSERT INTO issue_actions (issue_id, action_type, payload_json, created_at, actor_kind, actor_user_profile_id)
                 VALUES (16, 'issue_created', '{}', 10, 'user', 1)",
                [],
            )
            .expect("insert user actor action");
        connection
            .execute(
                "INSERT INTO issue_actions (issue_id, action_type, payload_json, created_at, actor_kind, actor_agent_profile_id, actor_agent_name_snapshot)
                 VALUES (16, 'agent_session_started', '{}', 20, 'agent', 101, 'Codex')",
                [],
            )
            .expect("insert agent actor action");

        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let response = service
            .get_issue_timeline(GetIssueTimelineInput {
                project_id: 1,
                issue_id: 16,
            })
            .expect("read timeline");

        let entries = response.entries;
        assert_eq!(entries.len(), 2);

        let user_entry = &entries[0];
        assert_eq!(
            user_entry.action_type,
            IssueTimelineActionType::IssueCreated
        );
        assert_eq!(user_entry.actor.actor_kind, "user");
        assert!(user_entry.actor.agent_type.is_none());

        let agent_entry = &entries[1];
        assert_eq!(
            agent_entry.action_type,
            IssueTimelineActionType::AgentSessionStarted
        );
        assert_eq!(agent_entry.actor.actor_kind, "agent");
        assert_eq!(agent_entry.actor.name, "Codex");
        assert_eq!(agent_entry.actor.agent_type.as_deref(), Some("codex"));
    }

    #[test]
    fn read_last_assistant_text_for_turn_returns_last_match() {
        use crate::features::agent_session::read_last_assistant_text_for_turn;
        let temp = tempdir().expect("temp dir");
        let log = temp.path().join("session.log");
        let line = |turn_id: &str, text: &str| -> String {
            format!(
                "{{\"projectId\":1,\"sessionId\":30,\"seq\":1,\"epoch\":\"e\",\"event\":{{\"type\":\"timeline\",\"item\":{{\"type\":\"assistant_message\",\"text\":\"{text}\"}},\"turnId\":\"{turn_id}\",\"seq\":1,\"timestamp\":1}}}}"
            )
        };
        fs::write(
            &log,
            format!(
                "{}\n{}\n{}\n",
                line("t1", "first in t1"),
                line("t2", "other turn"),
                line("t1", "last in t1 <issue-comment>x</issue-comment>"),
            ),
        )
        .expect("write log");
        assert_eq!(
            read_last_assistant_text_for_turn(log.to_string_lossy().as_ref(), "t1"),
            Some("last in t1 <issue-comment>x</issue-comment>".to_string())
        );
        assert_eq!(
            read_last_assistant_text_for_turn(log.to_string_lossy().as_ref(), "missing"),
            None
        );
    }

    #[test]
    fn add_issue_comment_publishes_agent_comment_visible_in_timeline() {
        let connection = Connection::open_in_memory().expect("open database");
        MigrationRunner::default()
            .run(&connection)
            .expect("run migrations");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'RedWhisk', '', 1, 1)",
                [],
            )
            .expect("insert project");
        connection
            .execute(
                "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
                 VALUES (101, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1, '', '', 0)",
                [],
            )
            .expect("insert agent profile");
        connection
            .execute(
                "INSERT INTO issues (id, project_id, title, description, status, label_ids, created_at, updated_at, del)
                 VALUES (16, 1, 'Issue 16', '', 'backlog', '[]', 1, 1, 0)",
                [],
            )
            .expect("insert issue");
        connection
            .execute(
                "INSERT INTO issue_actions (issue_id, action_type, payload_json, created_at, actor_kind, actor_user_profile_id)
                 VALUES (16, 'issue_created', '{}', 10, 'user', 1)",
                [],
            )
            .expect("insert user actor action");

        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        service
            .add_issue_comment(
                16,
                "已实现评论存储，验证命令：cargo test",
                IssueActionActor::Agent {
                    profile_id: 101,
                    name_snapshot: "Codex 快照".to_string(),
                },
                Some(42),
                Some("turn-1"),
            )
            .expect("publish agent comment");

        let response = service
            .get_issue_timeline(GetIssueTimelineInput {
                project_id: 1,
                issue_id: 16,
            })
            .expect("read timeline");
        let entries = response.entries;
        assert_eq!(entries.len(), 2);

        // 非 comment 动作 comment_body 必须为 None。
        let created_entry = &entries[0];
        assert_eq!(
            created_entry.action_type,
            IssueTimelineActionType::IssueCreated
        );
        assert!(created_entry.comment_body.is_none());

        let comment_entry = &entries[1];
        assert_eq!(
            comment_entry.action_type,
            IssueTimelineActionType::IssueCommentAdded
        );
        assert_eq!(comment_entry.actor.actor_kind, "agent");
        assert_eq!(comment_entry.actor.name, "Codex 快照");
        assert_eq!(comment_entry.actor.agent_type.as_deref(), Some("codex"));
        assert_eq!(
            comment_entry.comment_body.as_deref(),
            Some("已实现评论存储，验证命令：cargo test")
        );
    }

    #[test]
    fn add_issue_comment_is_idempotent_for_same_session_and_turn() {
        let connection = Connection::open_in_memory().expect("open database");
        MigrationRunner::default()
            .run(&connection)
            .expect("run migrations");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'RedWhisk', '', 1, 1)",
                [],
            )
            .expect("insert project");
        connection
            .execute(
                "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
                 VALUES (101, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1, '', '', 0)",
                [],
            )
            .expect("insert agent profile");
        connection
            .execute(
                "INSERT INTO issues (id, project_id, title, description, status, label_ids, created_at, updated_at, del)
                 VALUES (16, 1, 'Issue 16', '', 'backlog', '[]', 1, 1, 0)",
                [],
            )
            .expect("insert issue");

        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let actor = IssueActionActor::Agent {
            profile_id: 101,
            name_snapshot: "Codex".to_string(),
        };
        service
            .add_issue_comment(16, "首次交付摘要", actor.clone(), Some(42), Some("turn-1"))
            .expect("publish first comment");
        // 同一 (session, turn) 重复触发：静默忽略，不新增动作。
        service
            .add_issue_comment(16, "重复触发的摘要", actor, Some(42), Some("turn-1"))
            .expect("duplicate trigger is ignored");

        let comment_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM issue_comments WHERE issue_id = 16",
                [],
                |row| row.get(0),
            )
            .expect("count comments");
        assert_eq!(comment_count, 1, "重复触发只产生一条评论");

        let response = service
            .get_issue_timeline(GetIssueTimelineInput {
                project_id: 1,
                issue_id: 16,
            })
            .expect("read timeline");
        let comment_entries: Vec<_> = response
            .entries
            .iter()
            .filter(|entry| entry.action_type == IssueTimelineActionType::IssueCommentAdded)
            .collect();
        assert_eq!(comment_entries.len(), 1, "时间轴只出现一条评论动作");
        assert_eq!(
            comment_entries[0].comment_body.as_deref(),
            Some("首次交付摘要"),
            "重复触发不覆盖已有评论正文"
        );
    }

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
    fn delete_issue_returns_session_log_and_worktree_cleanup_context() {
        let temp_dir = tempdir().expect("create temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_git_repo(&repo_dir);
        let worktree_path = temp_dir.path().join("issue-99-worktree");
        fs::create_dir_all(&worktree_path).expect("create worktree dir");
        git(
            &repo_dir,
            &[
                "worktree",
                "add",
                "-b",
                "issue-99-branch",
                worktree_path.to_string_lossy().as_ref(),
            ],
        );

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
                 VALUES (99, 1, 'Issue 99', '', 'running', '[]', 1, 1, 0)",
                [],
            )
            .expect("insert running issue");

        let log_file = temp_dir.path().join("issue-99-session.log");
        fs::write(&log_file, b"{}").expect("write session log");

        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, issue_id, title, agent_profile_id, codex_session_id,
                   status, attention, working_dir, command_snapshot, prompt_snapshot,
                   workspace_mode, target_branch, workspace_branch, workspace_path,
                   origin_branch, worktree_owner, log_path,
                   list_inserted_at, last_active_at, started_at, closed_at, del
                 ) VALUES (
                   990, 1, 99, NULL, 101, 'thread-99',
                   'running', 'none', ?1, 'codex', '',
                   'worktree', 'main', 'issue-99-branch', ?1,
                   'main', 'redwhisk', ?2,
                   1, 2, 1, NULL, 0
                 )",
                params![
                    worktree_path.to_string_lossy().to_string(),
                    log_file.to_string_lossy().to_string(),
                ],
            )
            .expect("insert linked worktree session");

        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let result = service
            .delete_issue(crate::types::issue::DeleteIssueInput {
                project_id: 1,
                issue_id: 99,
            })
            .expect("delete issue");

        assert_eq!(result.issue_id, 99);
        assert_eq!(result.linked_session_id, Some(990));
        assert_eq!(
            result.linked_session_log_path.as_deref(),
            Some(log_file.to_string_lossy().as_ref())
        );
        let cleanup = result
            .worktree_cleanup
            .expect("should return redwhisk worktree cleanup");
        assert_eq!(cleanup.repo_path, repo_dir.to_string_lossy());
        assert_eq!(cleanup.workspace_path, worktree_path.to_string_lossy());
        assert_eq!(cleanup.workspace_branch, "issue-99-branch");

        // service 层不删磁盘副作用；command 层负责。
        assert!(log_file.exists());
        assert!(worktree_path.exists());

        // soft-delete 后 issue / session 不可见
        let remaining = connection
            .query_row(
                "SELECT COUNT(*) FROM issues WHERE id = 99 AND del = 0",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("count issues");
        assert_eq!(remaining, 0);
        let remaining_sessions = connection
            .query_row(
                "SELECT COUNT(*) FROM agent_sessions WHERE id = 990 AND del = 0",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("count sessions");
        assert_eq!(remaining_sessions, 0);
    }

    #[test]
    fn delete_issue_skips_external_worktree_cleanup_context() {
        let temp_dir = tempdir().expect("create temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_git_repo(&repo_dir);
        let worktree_path = temp_dir.path().join("external-worktree");
        fs::create_dir_all(&worktree_path).expect("create external worktree dir");

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
                 VALUES (100, 1, 'Issue 100', '', 'review', '[]', 1, 1, 0)",
                [],
            )
            .expect("insert issue");
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, issue_id, title, agent_profile_id, codex_session_id,
                   status, attention, working_dir, command_snapshot, prompt_snapshot,
                   workspace_mode, target_branch, workspace_branch, workspace_path,
                   origin_branch, worktree_owner, log_path,
                   list_inserted_at, last_active_at, started_at, closed_at, del
                 ) VALUES (
                   1000, 1, 100, NULL, 101, 'thread-100',
                   'closed', 'none', ?1, 'codex', '',
                   'worktree', 'main', 'external-branch', ?1,
                   'main', 'external', '',
                   1, 2, 1, 3, 0
                 )",
                params![worktree_path.to_string_lossy().to_string()],
            )
            .expect("insert external worktree session");

        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let result = service
            .delete_issue(crate::types::issue::DeleteIssueInput {
                project_id: 1,
                issue_id: 100,
            })
            .expect("delete issue");

        assert_eq!(result.linked_session_id, Some(1000));
        assert!(result.worktree_cleanup.is_none());
        assert!(worktree_path.exists());
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

    #[test]
    fn complete_issue_flow_prompts_dirty_decision_for_dirty_running_session() {
        let temp_dir = tempdir().expect("create temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_git_repo(&repo_dir);
        fs::write(repo_dir.join("dirty.txt"), "dirty\n").expect("write dirty file");

        let connection = setup_issue_completion_database(&repo_dir);
        connection
            .execute(
                "UPDATE agent_sessions
                 SET status = 'running', closed_at = NULL, workspace_mode = 'current_branch',
                     working_dir = ?1, worktree_owner = 'external'
                 WHERE id = 30",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("update session to running current-branch");
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

        assert_eq!(result.action, CompleteIssueFlowAction::PromptDirtyDecision);
        let phase: String = connection
            .query_row(
                "SELECT phase FROM issue_completion_flows WHERE issue_id = 16",
                [],
                |row| row.get(0),
            )
            .expect("flow phase");
        assert_eq!(phase, "prompting_dirty_decision");
    }

    #[test]
    fn complete_issue_flow_auto_commit_records_prompt_sent_when_handle_absent() {
        let temp_dir = tempdir().expect("create temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_git_repo(&repo_dir);
        fs::write(repo_dir.join("dirty.txt"), "dirty\n").expect("write dirty file");

        let connection = setup_issue_completion_database(&repo_dir);
        connection
            .execute(
                "UPDATE agent_sessions
                 SET status = 'running', closed_at = NULL, workspace_mode = 'current_branch',
                     working_dir = ?1, worktree_owner = 'external'
                 WHERE id = 30",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("update session to running current-branch");
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
                    dirty_decision: Some(DirtyWorkspaceOption::AutoCommit),
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

        // 无 live handle（空 registry）时跳过 send_message，仍记 PromptSent 审计 + 挂起 flow。
        assert_eq!(result.action, CompleteIssueFlowAction::WaitingAutoCommit);
        let (phase, attempt_result): (String, String) = connection
            .query_row(
                "SELECT f.phase, a.result
                 FROM issue_completion_flows f
                 LEFT JOIN completion_attempts a ON a.issue_id = f.issue_id
                 WHERE f.issue_id = 16
                 ORDER BY a.id DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("flow + attempt");
        assert_eq!(phase, "auto_committing");
        assert_eq!(attempt_result, "prompt_sent");
    }

    #[test]
    fn complete_issue_flow_prompts_worktree_cleanup_for_external_mismatched_worktree() {
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

        let connection = setup_issue_completion_database(&repo_dir);
        connection
            .execute(
                "UPDATE agent_sessions
                 SET status = 'running', closed_at = NULL, workspace_mode = 'worktree',
                     working_dir = ?1, workspace_path = ?1, workspace_branch = 'issue-16',
                     target_branch = ?2, origin_branch = ?2, worktree_owner = 'external'
                 WHERE id = 30",
                params![worktree_path.to_string_lossy().to_string(), target_branch],
            )
            .expect("update session to external worktree");
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

        assert_eq!(result.action, CompleteIssueFlowAction::ConfirmWorktreeCleanup);
        let phase: String = connection
            .query_row(
                "SELECT phase FROM issue_completion_flows WHERE issue_id = 16",
                [],
                |row| row.get(0),
            )
            .expect("flow phase");
        assert_eq!(phase, "confirming_worktree_cleanup");
    }

    #[test]
    fn complete_issue_flow_cancels_when_continue_after_commit_declined() {
        let temp_dir = tempdir().expect("create temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_git_repo(&repo_dir);

        let connection = setup_issue_completion_database(&repo_dir);
        connection
            .execute(
                "INSERT INTO issue_completion_flows
                   (issue_id, session_id, phase, ignore_dirty, dirty_decision,
                    continue_after_commit, worktree_cleanup_decision, base_branch,
                    workspace_branch, workspace_path, actual_path, failure_reason, updated_at)
                 VALUES (16, 30, 'confirming_continue_after_commit', 0, NULL, NULL, NULL,
                         NULL, NULL, NULL, NULL, NULL, 1)",
                [],
            )
            .expect("seed confirming_continue_after_commit flow");
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
                    continue_after_commit: Some(false),
                    worktree_cleanup_decision: None,
                },
                temp_dir.path().join("data"),
                &PtySessionManager::new(),
                &AgentSessionRegistry::new(),
            )
            .expect("complete issue");

        assert_eq!(result.action, CompleteIssueFlowAction::Cancelled);
        let phase: String = connection
            .query_row(
                "SELECT phase FROM issue_completion_flows WHERE issue_id = 16",
                [],
                |row| row.get(0),
            )
            .expect("flow phase");
        assert_eq!(phase, "cancelled");
    }

    #[test]
    fn complete_issue_flow_completes_when_external_worktree_cleanup_declined() {
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

        let connection = setup_issue_completion_database(&repo_dir);
        connection
            .execute(
                "UPDATE agent_sessions
                 SET status = 'running', closed_at = NULL, workspace_mode = 'worktree',
                     working_dir = ?1, workspace_path = ?1, workspace_branch = 'issue-16',
                     target_branch = ?2, origin_branch = ?2, worktree_owner = 'external'
                 WHERE id = 30",
                params![worktree_path.to_string_lossy().to_string(), target_branch],
            )
            .expect("update session to external worktree");
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
                    worktree_cleanup_decision: Some(false),
                },
                temp_dir.path().join("data"),
                &PtySessionManager::new(),
                &AgentSessionRegistry::new(),
            )
            .expect("complete issue");

        assert_eq!(result.action, CompleteIssueFlowAction::Completed);
        assert_eq!(result.issue.status, IssueStatus::Completed);
    }

    #[test]
    fn complete_issue_flow_completes_redwhisk_worktree_after_clean_rebase() {
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

        let connection = setup_issue_completion_database(&repo_dir);
        connection
            .execute(
                "UPDATE agent_sessions
                 SET status = 'running', closed_at = NULL, workspace_mode = 'worktree',
                     working_dir = ?1, workspace_path = ?1, workspace_branch = 'issue-16',
                     target_branch = ?2, origin_branch = ?2, worktree_owner = 'redwhisk'
                 WHERE id = 30",
                params![worktree_path.to_string_lossy().to_string(), target_branch],
            )
            .expect("update session to redwhisk worktree");
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
    }

    #[test]
    fn complete_issue_flow_blocks_when_git_operation_in_progress() {
        let temp_dir = tempdir().expect("create temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_git_repo(&repo_dir);
        // 制造 merge 进行中状态。
        fs::write(repo_dir.join(".git").join("MERGE_HEAD"), "dummy\n")
            .expect("write MERGE_HEAD");

        let connection = setup_issue_completion_database(&repo_dir);
        connection
            .execute(
                "UPDATE agent_sessions
                 SET status = 'running', closed_at = NULL, workspace_mode = 'current_branch',
                     working_dir = ?1, worktree_owner = 'external'
                 WHERE id = 30",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("update session to running");
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

        // git operation 进行中 -> 阻断，不持久化 flow，记 git_operation_blocked 审计。
        assert_eq!(result.action, CompleteIssueFlowAction::Blocked);
        assert!(result.flow.is_none());
        assert_eq!(result.merge_block_reason.as_deref(), Some("git_operation"));
        assert!(
            result.message.contains("合并 merge"),
            "message: {}",
            result.message
        );
        assert!(
            result.message.contains("git status"),
            "message: {}",
            result.message
        );
        assert!(
            result.message.contains(&repo_dir.to_string_lossy().to_string()),
            "message should include working dir: {}",
            result.message
        );
        let attempt_result: String = connection
            .query_row(
                "SELECT result FROM completion_attempts WHERE issue_id = 16 ORDER BY id DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .expect("blocked attempt");
        assert_eq!(attempt_result, "git_operation_blocked");
    }

    #[test]
    fn complete_issue_flow_completes_when_continue_after_commit_confirmed() {
        let temp_dir = tempdir().expect("create temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_git_repo(&repo_dir);
        // 模拟 agent 已提交一个新 commit。
        fs::write(repo_dir.join("committed.txt"), "done\n").expect("write committed file");
        git(&repo_dir, &["add", "committed.txt"]);
        git(&repo_dir, &["commit", "-m", "agent commit"]);

        let connection = setup_issue_completion_database(&repo_dir);
        connection
            .execute(
                "UPDATE agent_sessions
                 SET status = 'running', closed_at = NULL, workspace_mode = 'current_branch',
                     working_dir = ?1, worktree_owner = 'external'
                 WHERE id = 30",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("update session to running");
        connection
            .execute(
                "INSERT INTO issue_completion_flows
                   (issue_id, session_id, phase, ignore_dirty, dirty_decision,
                    continue_after_commit, worktree_cleanup_decision, base_branch,
                    workspace_branch, workspace_path, actual_path, failure_reason, updated_at)
                 VALUES (16, 30, 'confirming_continue_after_commit', 0, NULL, NULL, NULL,
                         NULL, NULL, NULL, NULL, NULL, 1)",
                [],
            )
            .expect("seed confirming_continue_after_commit flow");
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
                    continue_after_commit: Some(true),
                    worktree_cleanup_decision: None,
                },
                temp_dir.path().join("data"),
                &PtySessionManager::new(),
                &AgentSessionRegistry::new(),
            )
            .expect("complete issue");

        assert_eq!(result.action, CompleteIssueFlowAction::Completed);
        assert_eq!(result.issue.status, IssueStatus::Completed);
    }

    #[test]
    fn complete_issue_flow_blocks_when_redwhisk_worktree_missing_and_not_merged() {
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
        // 删除 worktree 目录 -> workspace_missing，但 issue-16 分支未合入 target。
        fs::remove_dir_all(&worktree_path).expect("remove worktree dir");

        let connection = setup_issue_completion_database(&repo_dir);
        connection
            .execute(
                "UPDATE agent_sessions
                 SET status = 'running', closed_at = NULL, workspace_mode = 'worktree',
                     working_dir = ?1, workspace_path = ?1, workspace_branch = 'issue-16',
                     target_branch = ?2, origin_branch = ?2, worktree_owner = 'redwhisk'
                 WHERE id = 30",
                params![worktree_path.to_string_lossy().to_string(), target_branch],
            )
            .expect("update session to redwhisk worktree");
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

        assert_eq!(result.action, CompleteIssueFlowAction::Blocked);
        let failure_reason: String = connection
            .query_row(
                "SELECT failure_reason FROM issue_completion_flows WHERE issue_id = 16",
                [],
                |row| row.get(0),
            )
            .expect("flow failure_reason");
        assert!(
            failure_reason.contains("尚未合入"),
            "failure_reason was: {failure_reason}"
        );
    }

    #[test]
    fn detect_agent_commit_completion_detects_new_commit_and_advances_to_confirm() {
        let temp_dir = tempdir().expect("create temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_git_repo(&repo_dir);
        let head_before = git_output(&repo_dir, &["rev-parse", "HEAD"]);
        // agent 提交一个新 commit。
        fs::write(repo_dir.join("agent.txt"), "agent\n").expect("write agent file");
        git(&repo_dir, &["add", "agent.txt"]);
        git(&repo_dir, &["commit", "-m", "agent commit"]);
        let head_after = git_output(&repo_dir, &["rev-parse", "HEAD"]);

        let connection = setup_issue_completion_database(&repo_dir);
        connection
            .execute(
                "UPDATE agent_sessions
                 SET status = 'running', closed_at = NULL, workspace_mode = 'current_branch',
                     working_dir = ?1, worktree_owner = 'external'
                 WHERE id = 30",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("update session to running");
        connection
            .execute(
                "INSERT INTO issue_completion_flows
                   (issue_id, session_id, phase, ignore_dirty, dirty_decision,
                    continue_after_commit, worktree_cleanup_decision, base_branch,
                    workspace_branch, workspace_path, actual_path, failure_reason, updated_at)
                 VALUES (16, 30, 'auto_committing', 0, 'auto_commit', NULL, NULL,
                         NULL, NULL, NULL, ?1, NULL, 1)",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("seed auto_committing flow");
        connection
            .execute(
                "INSERT INTO completion_attempts
                   (issue_id, session_id, option, head_before, head_after, commit_hash,
                    failure_reason, changed_files_json, result, created_at)
                 VALUES (16, 30, 'complete_manual', ?1, ?1, NULL, NULL, '[]', 'prompt_sent', 1)",
                params![head_before],
            )
            .expect("seed prompt_sent attempt");
        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );

        let result = service
            .detect_agent_commit_completion(DetectAgentCommitCompletionInput {
                project_id: 1,
                issue_id: 16,
            })
            .expect("detect");

        assert_eq!(result.outcome, DetectAgentCommitCompletionOutcome::CommitDetected);
        let (phase, attempt_result, head_after_stored): (String, String, String) = connection
            .query_row(
                "SELECT f.phase, a.result, a.head_after
                 FROM issue_completion_flows f
                 LEFT JOIN completion_attempts a ON a.issue_id = f.issue_id
                 WHERE f.issue_id = 16
                 ORDER BY a.id DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("flow + attempt");
        assert_eq!(phase, "confirming_continue_after_commit");
        assert_eq!(attempt_result, "completed");
        assert_eq!(head_after_stored, head_after);
    }

    #[test]
    fn complete_issue_flow_rebases_external_worktree_when_cleanup_confirmed_on_first_call() {
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

        let connection = setup_issue_completion_database(&repo_dir);
        connection
            .execute(
                "UPDATE agent_sessions
                 SET status = 'running', closed_at = NULL, workspace_mode = 'worktree',
                     working_dir = ?1, workspace_path = ?1, workspace_branch = 'issue-16',
                     target_branch = ?2, origin_branch = ?2, worktree_owner = 'external'
                 WHERE id = 30",
                params![worktree_path.to_string_lossy().to_string(), target_branch],
            )
            .expect("update session to external worktree");
        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );

        // 首调即给 cleanup=true（未先经 ConfirmingWorktreeCleanup 提示）。
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
                    worktree_cleanup_decision: Some(true),
                },
                temp_dir.path().join("data"),
                &PtySessionManager::new(),
                &AgentSessionRegistry::new(),
            )
            .expect("complete issue");

        assert_eq!(result.action, CompleteIssueFlowAction::Completed);
        // cleanup=true -> rebase + 清理 worktree（不应跳过 rebase 直接完成）。
        assert!(
            !worktree_path.exists(),
            "external worktree should be cleaned up after rebase"
        );
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
        use crate::features::issue::attachment::{rewrite_attachment_tokens, NewAttachmentPersistence};

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
        use crate::features::issue::attachment::{rewrite_attachment_tokens, NewAttachmentPersistence};

        let attachments = vec![NewAttachmentPersistence {
            temp_token: "draft-img-1".to_string(),
            attachment_id: 101,
        }];

        // 描述中缺失该 token（无论哪种形态）应报错，满足 Rust 硬约束。
        let result = rewrite_attachment_tokens("No token here.", &attachments);
        assert!(result.is_err());
    }

    // ---- resolve_actual_execution_path 单测（Impl-C：路径解析与漂移捕获）----

    use crate::features::issue::completion::flow::{resolve_actual_execution_path, ActualPathSource};
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
            display_mode: "json".to_string(),
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
