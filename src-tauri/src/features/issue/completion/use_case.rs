//! 完成流程用例深 module：begin / continue / detect_commit / project_result。
//!
//! 单一 world 装配、Begin 守卫、CommitCompletion 事务与 effect 解释的编排壳。
//! `IssueService` 仅保留 command 入口校验与 CRUD / timeline；本 module 是完成流程
//! 的可测 seam（ADR-0012 follow-up）。

use crate::agent::session_registry::AgentSessionRegistry;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::completion_attempt_repository::CompletionAttemptRepository;
use crate::db::issue_completion_flow_repository::IssueCompletionFlowRepository;
use crate::features::issue::completion::effect_interpreter::EffectContext;
use crate::features::issue::completion::flow::{
    completion_detection_repo_path, completion_state_from_record, derive_completion_event,
    gather_completion_world, is_session_closed_out, phase_to_completion_action,
    resolve_actual_execution_path, ActualExecutionPath, ActualPathSource,
};
use crate::features::issue::completion::formatting::completion_message;
use crate::features::issue::completion::git_reconcile::closed_session_completion_snapshot;
use crate::features::issue::completion::state_machine::{
    self, CompletionEvent, CompletionState, CompletionWorld, Transition,
};
use crate::features::issue::service::IssueService;
use crate::features::issue::time::current_epoch_millis_for_db;
use crate::features::issue::validation::{issue_database_error, issue_not_found};
use crate::git::operation_state::{
    format_git_operation_state, git_operation_blocking_message, GitOperationBlockContext,
    GitOperationState,
};
use crate::git::status::read_git_snapshot;
use crate::types::agent_session::{AgentSessionRecord, WorkspaceMode};
use crate::types::completion_attempt::{CompletionAttemptOption, CompletionAttemptResult};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{
    DetectAgentCommitCompletionInput, DetectAgentCommitCompletionOutcome,
    DetectAgentCommitCompletionResult, IssueRecord, IssueStatus,
};
use crate::types::issue_completion::{
    CompleteIssueFlowAction, CompleteIssueFlowInput, CompleteIssueFlowResult,
    IssueCompletionFlowRecord, IssueCompletionPhase,
};
use crate::types::project::ProjectSummary;

/// 完成流程用例：drive / detect / 结果投影的小 interface。
pub(crate) struct CompletionFlow<'service, 'connection> {
    pub(crate) service: &'service IssueService<'connection>,
}

impl<'service, 'connection> CompletionFlow<'service, 'connection> {
    pub(crate) fn new(service: &'service IssueService<'connection>) -> Self {
        Self { service }
    }

    pub(crate) fn drive(
        &self,
        input: CompleteIssueFlowInput,
        project: &ProjectSummary,
        issue: IssueRecord,
        session: AgentSessionRecord,
        forced_option: Option<CompletionAttemptOption>,
        agent_registry: &AgentSessionRegistry,
    ) -> Result<CompleteIssueFlowResult, CommandError> {
        let actual = resolve_actual_execution_path(&input, &session, agent_registry);
        let detection_repo_path = completion_detection_repo_path(&project.repo_path, &session);
        let mut state = self.load_completion_state(issue.id)?;
        if input.ignore_dirty == Some(true) {
            state.ignore_dirty = true;
        }
        // cleanup 决策可在 Begin 首次调用时就给出（external worktree 直接选「不清理」完成），
        // 折叠进 state 供 machine 的 reconcile 读取。
        if input.worktree_cleanup_decision.is_some() {
            state.worktree_cleanup_decision = input.worktree_cleanup_decision;
        }
        let event = derive_completion_event(&input, &state);
        // closed 快速完成路径仅对 Begin 生效；非 Begin（ContinueConfirmed / CleanupDecided 等）
        // 仍读真实快照，与既有 continue_after_commit 路径一致。
        let closed_fast_path = matches!(event, CompletionEvent::Begin)
            && is_session_closed_out(&session)
            && matches!(issue.status, IssueStatus::Review | IssueStatus::Running)
            && session.workspace_mode != WorkspaceMode::Worktree;
        let snapshot = if closed_fast_path {
            closed_session_completion_snapshot()
        } else {
            read_git_snapshot(&detection_repo_path)
                .unwrap_or_else(|_| closed_session_completion_snapshot())
        };

        // 前置守卫：Begin 检测时 Git operation 进行中 -> 记 blocked attempt，不持久化 flow。
        if matches!(event, CompletionEvent::Begin)
            && snapshot.operation_state != GitOperationState::None
        {
            let option = forced_option.unwrap_or(CompletionAttemptOption::CompleteManual);
            let transaction = self
                .service
                .issue_repository
                .connection()
                .unchecked_transaction()
                .map_err(issue_database_error)?;
            let operation_state_str = format_git_operation_state(snapshot.operation_state);
            let blocked_message = git_operation_blocking_message(
                snapshot.operation_state,
                GitOperationBlockContext::CompleteIssue,
                Some(detection_repo_path.as_str()),
            );
            CompletionAttemptRepository::record_blocked_in_transaction(
                &transaction,
                issue.id,
                session.id,
                option,
                &snapshot.head,
                operation_state_str,
                operation_state_str,
                &blocked_message,
                current_epoch_millis_for_db().map_err(issue_database_error)?,
            )
            .map_err(issue_database_error)?;
            transaction.commit().map_err(issue_database_error)?;
            // merge_block_reason=git_operation：前端据此展示详细 message，而非误走 worktree 冲突 handoff。
            return Ok(self.project_result(
                CompleteIssueFlowAction::Blocked,
                issue,
                None,
                blocked_message,
                Some("git_operation".to_string()),
                &actual,
                &session,
            ));
        }

        let world = gather_completion_world(
            &project.repo_path,
            &issue,
            &session,
            &actual,
            snapshot,
            forced_option,
        );
        let transition = state_machine::advance(&state, &world, event).map_err(|_| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "current completion state mismatch",
            )
            .with_reason("completionStateMismatch")
        })?;

        self.apply_transition(
            &project.repo_path,
            issue,
            session,
            &actual,
            &world,
            transition,
            agent_registry,
        )
    }

    pub(crate) fn apply_transition(
        &self,
        repo_path: &str,
        issue: IssueRecord,
        session: AgentSessionRecord,
        actual: &ActualExecutionPath,
        world: &CompletionWorld,
        transition: Transition,
        agent_registry: &AgentSessionRegistry,
    ) -> Result<CompleteIssueFlowResult, CommandError> {
        let ctx = EffectContext {
            repo_path,
            issue: &issue,
            session: &session,
            world,
            agent_registry,
        };
        let outcome = self.interpret_effects(&ctx, transition)?;

        let action = phase_to_completion_action(outcome.new_state.phase);
        let result_issue = outcome.completed_issue.unwrap_or_else(|| issue.clone());
        let message = completion_message(outcome.new_state.phase, outcome.merge_block.as_ref());
        let merge_block_reason = outcome
            .merge_block
            .as_ref()
            .map(|block| block.reason.clone());
        Ok(self.project_result(
            action,
            result_issue,
            outcome.flow_record,
            message,
            merge_block_reason,
            actual,
            &session,
        ))
    }
    pub(crate) fn load_completion_state(
        &self,
        issue_id: i64,
    ) -> Result<CompletionState, CommandError> {
        let flow = IssueCompletionFlowRepository::new(self.service.issue_repository.connection())
            .find_by_issue_id(issue_id)
            .map_err(issue_database_error)?;
        Ok(match flow {
            Some(record) => completion_state_from_record(&record),
            None => CompletionState::detecting(),
        })
    }

    pub(crate) fn project_result(
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
    pub(crate) fn detect_commit(
        &self,
        input: DetectAgentCommitCompletionInput,
    ) -> Result<DetectAgentCommitCompletionResult, CommandError> {
        let project = self.service.require_project(input.project_id)?;
        let issue = self
            .service
            .issue_repository
            .find_by_id(input.issue_id)
            .map_err(issue_database_error)?
            .filter(|issue| issue.project_id == input.project_id)
            .ok_or_else(|| issue_not_found(input.issue_id))?;
        let session = AgentSessionRepository::new(self.service.issue_repository.connection())
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
        let flow = IssueCompletionFlowRepository::new(self.service.issue_repository.connection())
            .find_by_issue_id(issue.id)
            .map_err(issue_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::IssueValidationFailed,
                    "当前 Issue 不在自动提交流程中。",
                )
                .with_reason("notInAutoCommitFlow")
                .with_detail(
                    ErrorDetail::new("IssueCompletionFlow").with_value("issueId", issue.id),
                )
            })?;
        // 仅在 AutoCommitting 阶段检测；其它阶段幂等返回未检测到（前端轮询容错）。
        if flow.phase != IssueCompletionPhase::AutoCommitting {
            return Ok(DetectAgentCommitCompletionResult {
                outcome: DetectAgentCommitCompletionOutcome::NoCommitDetected,
                issue: self.service.hydrate_issue(issue)?,
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
                    issue: self.service.hydrate_issue(issue)?,
                    message: "暂无法读取仓库状态，未检测到新 commit。".to_string(),
                });
            }
        };
        if snapshot.operation_state != GitOperationState::None {
            return Ok(DetectAgentCommitCompletionResult {
                outcome: DetectAgentCommitCompletionOutcome::GitOperationBlocked,
                issue: self.service.hydrate_issue(issue)?,
                message: git_operation_blocking_message(
                    snapshot.operation_state,
                    GitOperationBlockContext::DetectCommit,
                    Some(detection_path),
                ),
            });
        }
        // 最近一次 PromptSent attempt 记录了弹框前 head；当前 head 不同即新 commit。
        let pending = CompletionAttemptRepository::new(self.service.issue_repository.connection())
            .list_by_issue_id(issue.id)
            .map_err(issue_database_error)?
            .into_iter()
            .rev()
            .find(|attempt| attempt.result == CompletionAttemptResult::PromptSent);
        let Some(pending) = pending else {
            return Ok(DetectAgentCommitCompletionResult {
                outcome: DetectAgentCommitCompletionOutcome::NoCommitDetected,
                issue: self.service.hydrate_issue(issue)?,
                message: "未找到挂起的自动提交记录。".to_string(),
            });
        };
        if !snapshot.head.is_empty() && snapshot.head != pending.head_before {
            // 检测到新 commit：更新 attempt + phase → ConfirmingContinueAfterCommit。
            let state = completion_state_from_record(&flow);
            // 与 drive 共用 gather_completion_world，去掉 detect 手搓 dummy world 双源。
            let actual = ActualExecutionPath {
                path: detection_path.to_string(),
                source: ActualPathSource::StartupSnapshot,
                in_worktree: session.workspace_mode == WorkspaceMode::Worktree,
                worktree_branch: session.workspace_branch.clone(),
                drifted: false,
            };
            let world = gather_completion_world(
                &project.repo_path,
                &issue,
                &session,
                &actual,
                snapshot.clone(),
                None,
            );
            let transition = state_machine::advance(
                &state,
                &world,
                CompletionEvent::CommitDetected {
                    head: snapshot.head.clone(),
                    attempt_id: pending.id,
                },
            )
            .map_err(|_| {
                CommandError::new(
                    CommandErrorCode::IssueValidationFailed,
                    "current completion state mismatch",
                )
                .with_reason("completionStateMismatch")
            })?;
            // detect 路径的迁移（CommitDetected）只产 RecordCompletionAttempt{Completed}，
            // 不触及 InjectCommitPrompt / AttemptRebaseAndCleanup，故 registry / repo_path
            // 不会被读取；占位空 registry 与 detection_path 仅保持 EffectContext 形态一致。
            let detect_registry = AgentSessionRegistry::new();
            {
                let ctx = EffectContext {
                    repo_path: detection_path,
                    issue: &issue,
                    session: &session,
                    world: &world,
                    agent_registry: &detect_registry,
                };
                self.interpret_effects(&ctx, transition)?;
            }
            return Ok(DetectAgentCommitCompletionResult {
                outcome: DetectAgentCommitCompletionOutcome::CommitDetected,
                issue: self.service.hydrate_issue(issue)?,
                message: "代码已提交成功。确定继续标记完成吗？".to_string(),
            });
        }
        Ok(DetectAgentCommitCompletionResult {
            outcome: DetectAgentCommitCompletionOutcome::NoCommitDetected,
            issue: self.service.hydrate_issue(issue)?,
            message: "尚未检测到 Agent 提交的新 commit。".to_string(),
        })
    }
}
