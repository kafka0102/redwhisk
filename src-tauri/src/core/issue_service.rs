use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;

use crate::agent::pty_session_manager::PtySessionManager;
use crate::core::agent_session_service::AgentSessionService;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::completion_attempt_repository::CompletionAttemptRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::event_repository::EventRepository;
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
    AgentCommitChangedFileSummary, AgentCommitCompletionPreview, CompleteIssueCleanInput,
    CompleteIssueManualInput, CreateIssueInput, DetectAgentCommitCompletionInput,
    DetectAgentCommitCompletionOutcome, DetectAgentCommitCompletionResult, IssueListResponse,
    IssueRecord, IssueStatus, MarkIssueReviewInput, PrepareAgentCommitCompletionInput,
    SendAgentCommitPromptInput, SendAgentCommitPromptResult, UpdateIssueInput,
};
use crate::types::issue_action::IssueActionType;
use crate::types::project::ProjectCompletionPolicy;
use crate::types::session_event::SessionEventType;

pub struct IssueService<'connection> {
    issue_repository: IssueRepository<'connection>,
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

    pub fn mark_issue_review_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: MarkIssueReviewInput,
    ) -> Result<IssueRecord, CommandError> {
        let database = open_issue_database(data_dir)?;
        let issue_repository = IssueRepository::new(&database.connection);
        let project_repository = ProjectRepository::new(&database.connection);
        IssueService::new(issue_repository, project_repository).mark_issue_review(input)
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
