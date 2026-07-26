//! Issue 完成流程的 Effect 解释执行（ADR-0012）。
//!
//! 纯状态机 [`completion_state_machine::advance`] 产出 `Transition { new_state, effects }`；
//! 本 module 把 `Effect` 解释为副作用（DB / git / agent），是完成流程的「深 module」：
//!
//! - 两个完成流程入口（`complete_issue_flow` / `detect_agent_commit_completion`）在
//!   `advance()` 之后都调用 [`CompletionFlow::interpret_effects`]，取代各自内嵌的
//!   `match` 循环。`Effect` 在一处穷尽 match，arm 分歧不再可能。
//! - 边界只取 effect 解释：循环 + `FailurePolicy::Block` 相位改写 + flow upsert
//!   （含「Completed 跳过 upsert」迁移不变式）。纯 `advance()` 与调用方的结果投影不变。
//! - 可测依赖按 local-substitutable：内存 SQLite + temp git + fake `AgentSessionHandle`。

use crate::agent::session_registry::AgentSessionRegistry;
use crate::features::agent_session::agent_session_error_to_command_error;
use crate::features::issue::completion::state_machine::{
    CompletionAttemptResultForEffect, CompletionState, CompletionWorld, Effect, FailurePolicy,
    Transition,
};
use crate::features::issue::completion::formatting::build_agent_commit_completion_prompt;
use crate::features::issue::completion::git_reconcile::{
    discard_session_workspace_changes, merge_block_from_worktree_error,
    reconcile_session_worktree, WorktreeMergeBlockDescription,
};
use crate::features::issue::time::current_epoch_millis;
use super::use_case::CompletionFlow;
use crate::features::issue::validation::issue_database_error;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::completion_attempt_repository::CompletionAttemptRepository;
use crate::logging::info_kv;
use crate::types::agent_session::AgentSessionRecord;
use crate::types::completion_attempt::CompletionAttemptResult;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::IssueRecord;
use crate::types::issue_completion::{IssueCompletionFlowRecord, IssueCompletionPhase};

/// effect 解释执行的入参打包（两个完成流程入口各自组装）。
pub(crate) struct EffectContext<'a> {
    pub(crate) repo_path: &'a str,
    pub(crate) issue: &'a IssueRecord,
    pub(crate) session: &'a AgentSessionRecord,
    pub(crate) world: &'a CompletionWorld,
    pub(crate) agent_registry: &'a AgentSessionRegistry,
}

/// 一次迁移的执行结果。
///
/// 结果类型塑形（`CompleteIssueFlowResult` / `DetectAgentCommitCompletionResult`）与文案
/// 是视图投影，由调用方各自完成，不进本 module。
pub(crate) struct InterpretationOutcome {
    /// effect 全部成功后的终态；rebase 失败按 `FailurePolicy::Block` 改写为 `Blocked`。
    pub(crate) new_state: CompletionState,
    /// `CommitCompletion` 执行后置位；未触及完成事务时为 `None`。
    pub(crate) completed_issue: Option<IssueRecord>,
    /// rebase 失败分类；仅 `FailurePolicy::Block` 失败时填充。
    pub(crate) merge_block: Option<WorktreeMergeBlockDescription>,
    /// 非 `Completed` 终态 upsert 后的 flow 记录；`Completed` 时为 `None`
    /// （由 `CommitCompletion` 事务内清 flow）。
    pub(crate) flow_record: Option<IssueCompletionFlowRecord>,
}

impl<'connection> CompletionFlow<'_, 'connection> {
    /// 解释执行一次迁移的全部 `Effect`（按序），并 upsert 终态 flow。
    pub(crate) fn interpret_effects(
        &self,
        ctx: &EffectContext<'_>,
        transition: Transition,
    ) -> Result<InterpretationOutcome, CommandError> {
        let mut new_state = transition.new_state;
        let mut completed_issue: Option<IssueRecord> = None;
        let mut merge_block: Option<WorktreeMergeBlockDescription> = None;

        for effect in &transition.effects {
            match effect {
                Effect::InjectCommitPrompt => {
                    let completion_prompt = build_agent_commit_completion_prompt(
                        &ctx.issue.title,
                        &ctx.world.snapshot.head,
                    );
                    let _ = AgentSessionRepository::new(self.service.issue_repository.connection())
                        .update_current_turn_source(ctx.session.id, "completion");
                    if let Some(handle) = ctx.agent_registry.get(ctx.session.id) {
                        handle
                            .send_message(completion_prompt, Vec::new())
                            .map_err(agent_session_error_to_command_error)?;
                    }
                }
                Effect::RecordCompletionAttempt {
                    result,
                    head,
                    changed_files,
                    attempt_id,
                } => {
                    let attempt_result = match result {
                        CompletionAttemptResultForEffect::PromptSent => {
                            CompletionAttemptResult::PromptSent
                        }
                        CompletionAttemptResultForEffect::Completed => {
                            CompletionAttemptResult::Completed
                        }
                    };
                    let transaction = self
                        .service
                        .issue_repository
                        .connection()
                        .unchecked_transaction()
                        .map_err(issue_database_error)?;
                    match attempt_id {
                        None => {
                            let changed_files_json =
                                serde_json::to_string(changed_files).map_err(|error| {
                                    CommandError::new(
                                        CommandErrorCode::IssuePersistenceFailed,
                                        "Agent Commit 审计保存失败。",
                                    )
                                    .with_reason("auditSaveFailed")
                                    .with_detail(
                                        ErrorDetail::new("Cause")
                                            .with_value("message", error.to_string()),
                                    )
                                })?;
                            let recorded_at = current_epoch_millis()?;
                            CompletionAttemptRepository::insert_in_transaction(
                                &transaction,
                                ctx.issue.id,
                                ctx.session.id,
                                ctx.world.attempt_option,
                                head,
                                head,
                                None,
                                None,
                                &changed_files_json,
                                attempt_result,
                                recorded_at,
                            )
                            .map_err(issue_database_error)?;
                            info_kv(
                                "complete_issue_flow",
                                "agent auto-commit prompt sent",
                                &[
                                    ("issueId", &ctx.issue.id.to_string()),
                                    ("sessionId", &ctx.session.id.to_string()),
                                    ("headBefore", head),
                                ],
                            );
                        }
                        Some(id) => {
                            CompletionAttemptRepository::update_result_in_transaction(
                                &transaction,
                                *id,
                                head,
                                Some(head.as_str()),
                                None,
                                attempt_result,
                            )
                            .map_err(issue_database_error)?;
                            info_kv(
                                "detect_agent_commit_completion",
                                "agent commit detected",
                                &[
                                    ("issueId", &ctx.issue.id.to_string()),
                                    ("sessionId", &ctx.session.id.to_string()),
                                    ("headAfter", head),
                                ],
                            );
                        }
                    }
                    transaction.commit().map_err(issue_database_error)?;
                }
                Effect::AttemptRebaseAndCleanup { on_failure } => {
                    // Skip / ignore_dirty：对账前先丢弃 Agent worktree 未提交改动（ADR-0026）。
                    let reconcile_result = if new_state.dirty_already_skipped() {
                        discard_session_workspace_changes(ctx.session)
                            .and_then(|_| reconcile_session_worktree(ctx.repo_path, ctx.session))
                    } else {
                        reconcile_session_worktree(ctx.repo_path, ctx.session)
                    };
                    if let Err(error) = reconcile_result {
                        match on_failure {
                            FailurePolicy::Block => {
                                merge_block = Some(merge_block_from_worktree_error(&error));
                                new_state.phase = IssueCompletionPhase::Blocked;
                                new_state.failure_reason = Some(error.to_string());
                                break;
                            }
                            // 状态机当前只为该 effect 产 Block；HardError 保留为硬错误。
                            FailurePolicy::HardError => {
                                return Err(CommandError::new(
                                    CommandErrorCode::IssueValidationFailed,
                                    "Agent worktree 合入失败。",
                                )
                                .with_reason("worktreeReconcileFailed")
                                .with_detail(
                                    ErrorDetail::new("Cause")
                                        .with_value("message", error.to_string()),
                                ));
                            }
                        }
                    }
                }
                Effect::CommitCompletion { snapshot, option } => {
                    let completed = self.complete_issue_flow_transaction(
                        ctx.issue,
                        ctx.session,
                        snapshot,
                        *option,
                        None,
                        None,
                        new_state.dirty_already_skipped(),
                    )?;
                    completed_issue = Some(completed);
                }
            }
        }

        // Completed 由 CommitCompletion 事务内清 flow；其余终态 upsert 持久化。
        let flow_record = if new_state.phase == IssueCompletionPhase::Completed {
            None
        } else {
            Some(self.upsert_completion_flow(
                ctx.issue.id,
                Some(ctx.session.id),
                new_state.phase,
                new_state.ignore_dirty,
                new_state.dirty_decision,
                new_state.worktree_cleanup_decision,
                ctx.session,
                new_state.actual_path.as_deref(),
                new_state.failure_reason.as_deref(),
            )?)
        };

        Ok(InterpretationOutcome {
            new_state,
            completed_issue,
            merge_block,
            flow_record,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use std::sync::{Arc, Mutex};

    use rusqlite::{params, Connection};
    use tempfile::TempDir;

    use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
    use crate::agent::session_registry::AgentSessionRegistry;
    use crate::features::issue::completion::effect_interpreter::EffectContext;
    use crate::features::issue::completion::state_machine::{
        CompletionAttemptResultForEffect, CompletionState, CompletionWorld, Effect, FailurePolicy,
        Transition,
    };
    use crate::features::issue::completion::use_case::CompletionFlow;
    use crate::features::issue::service::IssueService;
    use crate::db::agent_session_repository::AgentSessionRepository;
    use crate::db::completion_attempt_repository::CompletionAttemptRepository;
    use crate::db::issue_completion_flow_repository::IssueCompletionFlowRepository;
    use crate::db::issue_repository::IssueRepository;
    use crate::db::migrations::MigrationRunner;
    use crate::db::project_repository::ProjectRepository;
    use crate::git::operation_state::GitOperationState;
    use crate::git::status::GitSnapshot;
    use crate::types::agent_session::{
        AgentMessageAttachment, AgentPermissionDecision, AgentSessionRecord, WorkspaceMode,
        WorktreeOwner,
    };
    use crate::types::agent_session_stream::{AgentMode, AgentModel, AgentTimelineItem};
    use crate::types::completion_attempt::CompletionAttemptOption;
    use crate::types::issue::{IssueRecord, IssueStatus};
    use crate::types::issue_completion::IssueCompletionPhase;

    /// 记录 `send_message` 调用的假句柄。
    struct RecordingHandle {
        sent: Mutex<Vec<String>>,
    }

    impl RecordingHandle {
        fn new() -> Self {
            Self {
                sent: Mutex::new(Vec::new()),
            }
        }
    }

    impl AgentSessionHandle for RecordingHandle {
        fn send_message(
            &self,
            text: String,
            _attachments: Vec<AgentMessageAttachment>,
        ) -> Result<(), AgentSessionError> {
            self.sent.lock().unwrap().push(text);
            Ok(())
        }
        fn cancel_turn(&self) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn respond_permission(
            &self,
            _request_id: &str,
            _decision: AgentPermissionDecision,
        ) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn set_model(&self, _model_id: String) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn set_effort(&self, _effort: Option<String>) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn set_mode(&self, _mode_id: &str) -> Result<(), AgentSessionError> {
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
    }

    /// 内存 DB：project 1 + profile 101 + issue 16 + session 30（log_path 为空跳过归档 fs）。
    fn setup_database() -> Connection {
        let connection = Connection::open_in_memory().expect("open database");
        MigrationRunner::default()
            .run(&connection)
            .expect("run migrations");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'RedWhisk', '/tmp/repo', 1, 1)",
                [],
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
                   'stopped', 'none', '/tmp/repo', 'codex', '',
                   'current_branch', NULL, NULL, NULL,
                   NULL, 'external', '',
                   1, 2, 1, 2, 0
                 )",
                [],
            )
            .expect("insert session");
        connection
    }

    fn fetch_issue(conn: &Connection) -> IssueRecord {
        IssueRepository::new(conn)
            .find_by_id(16)
            .expect("find issue")
            .expect("issue exists")
    }

    fn fetch_session(conn: &Connection) -> AgentSessionRecord {
        AgentSessionRepository::new(conn)
            .find_by_issue_id(16)
            .expect("find session")
            .expect("session exists")
    }

    fn snapshot(head: &str) -> GitSnapshot {
        GitSnapshot {
            head: head.to_string(),
            status_porcelain: String::new(),
            changed_files: vec![],
            operation_state: GitOperationState::None,
            is_clean: true,
        }
    }

    fn world(head: &str) -> CompletionWorld {
        CompletionWorld {
            issue_status: IssueStatus::Review,
            workspace_mode: WorkspaceMode::CurrentBranch,
            workspace_missing: false,
            owner: WorktreeOwner::External,
            target_branch: None,
            current_branch: None,
            branch_mismatch: false,
            actual_path: "/tmp/repo".to_string(),
            drifted: false,
            session_closed_out: false,
            missing_worktree_error: None,
            snapshot: snapshot(head),
            attempt_option: CompletionAttemptOption::CompleteManual,
        }
    }

    fn state(phase: IssueCompletionPhase) -> CompletionState {
        CompletionState {
            phase,
            ..CompletionState::detecting()
        }
    }

    #[test]
    fn inject_commit_prompt_sends_to_registered_handle_and_marks_turn_source() {
        let connection = setup_database();
        // turn-source UPDATE 仅对 running session 生效（生产中 InjectCommitPrompt 在 session 运行时触发）。
        connection
            .execute("UPDATE agent_sessions SET status = 'running' WHERE id = 30", [])
            .expect("set running");
        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let issue = fetch_issue(&connection);
        let session = fetch_session(&connection);

        let handle = Arc::new(RecordingHandle::new());
        let registry = AgentSessionRegistry::new();
        registry.register(session.id, handle.clone() as Arc<dyn AgentSessionHandle>);
        let world = world("abc123");
        let ctx = EffectContext {
            repo_path: "/tmp/repo",
            issue: &issue,
            session: &session,
            world: &world,
            agent_registry: &registry,
        };

        let outcome = CompletionFlow::new(&service)
            .interpret_effects(
                &ctx,
                Transition {
                    new_state: state(IssueCompletionPhase::AutoCommitting),
                    effects: vec![Effect::InjectCommitPrompt],
                },
            )
            .expect("interpret_effects");

        // prompt 已发送，且包含 issue 标题与 head。
        let sent = handle.sent.lock().unwrap().clone();
        assert_eq!(sent.len(), 1);
        assert!(sent[0].contains("Issue 16"));
        assert!(sent[0].contains("abc123"));
        // current_turn_source 置为 completion。
        let source: String = connection
            .query_row(
                "SELECT current_turn_source FROM agent_sessions WHERE id = 30",
                [],
                |row| row.get(0),
            )
            .expect("query turn source");
        assert_eq!(source, "completion");
        // 无完成事务、未到 Completed → flow upsert。
        assert!(outcome.completed_issue.is_none());
        assert!(outcome.flow_record.is_some());
        assert_eq!(outcome.new_state.phase, IssueCompletionPhase::AutoCommitting);
    }

    #[test]
    fn inject_commit_prompt_skips_send_when_no_handle() {
        let connection = setup_database();
        connection
            .execute("UPDATE agent_sessions SET status = 'running' WHERE id = 30", [])
            .expect("set running");
        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let issue = fetch_issue(&connection);
        let session = fetch_session(&connection);
        let registry = AgentSessionRegistry::new();
        let world = world("abc123");
        let ctx = EffectContext {
            repo_path: "/tmp/repo",
            issue: &issue,
            session: &session,
            world: &world,
            agent_registry: &registry,
        };

        CompletionFlow::new(&service)
            .interpret_effects(
                &ctx,
                Transition {
                    new_state: state(IssueCompletionPhase::AutoCommitting),
                    effects: vec![Effect::InjectCommitPrompt],
                },
            )
            .expect("interpret_effects");

        // 无 handle 不应报错；turn source 仍写入。
        let source: String = connection
            .query_row(
                "SELECT current_turn_source FROM agent_sessions WHERE id = 30",
                [],
                |row| row.get(0),
            )
            .expect("query turn source");
        assert_eq!(source, "completion");
    }

    #[test]
    fn record_completion_attempt_prompt_sent_inserts_row() {
        let connection = setup_database();
        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let issue = fetch_issue(&connection);
        let session = fetch_session(&connection);
        let registry = AgentSessionRegistry::new();
        let world = world("abc123");
        let ctx = EffectContext {
            repo_path: "/tmp/repo",
            issue: &issue,
            session: &session,
            world: &world,
            agent_registry: &registry,
        };

        CompletionFlow::new(&service)
            .interpret_effects(
                &ctx,
                Transition {
                    new_state: state(IssueCompletionPhase::AutoCommitting),
                    effects: vec![Effect::RecordCompletionAttempt {
                        result: CompletionAttemptResultForEffect::PromptSent,
                        head: "deadbeef".to_string(),
                        changed_files: vec![],
                        attempt_id: None,
                    }],
                },
            )
            .expect("interpret_effects");

        let attempts = CompletionAttemptRepository::new(&connection)
            .list_by_issue_id(16)
            .expect("list attempts");
        assert_eq!(attempts.len(), 1);
        assert_eq!(
            attempts[0].result,
            crate::types::completion_attempt::CompletionAttemptResult::PromptSent
        );
        assert_eq!(attempts[0].head_before, "deadbeef");
        assert_eq!(attempts[0].head_after, "deadbeef");
    }

    #[test]
    fn record_completion_attempt_completed_updates_existing_row() {
        let connection = setup_database();
        // 预置一条 PromptSent attempt，模拟自动提交流程的挂起记录。
        let pending = {
            let tx = connection.unchecked_transaction().expect("tx");
            let inserted = CompletionAttemptRepository::insert_in_transaction(
                &tx,
                16,
                30,
                CompletionAttemptOption::CompleteManual,
                "old",
                "old",
                None,
                None,
                "[]",
                crate::types::completion_attempt::CompletionAttemptResult::PromptSent,
                100,
            )
            .expect("insert pending");
            tx.commit().expect("commit");
            inserted
        };

        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let issue = fetch_issue(&connection);
        let session = fetch_session(&connection);
        let registry = AgentSessionRegistry::new();
        let world = world("abc123");
        let ctx = EffectContext {
            repo_path: "/tmp/repo",
            issue: &issue,
            session: &session,
            world: &world,
            agent_registry: &registry,
        };

        CompletionFlow::new(&service)
            .interpret_effects(
                &ctx,
                Transition {
                    new_state: state(IssueCompletionPhase::ConfirmingContinueAfterCommit),
                    effects: vec![Effect::RecordCompletionAttempt {
                        result: CompletionAttemptResultForEffect::Completed,
                        head: "newhead".to_string(),
                        changed_files: vec![],
                        attempt_id: Some(pending.id),
                    }],
                },
            )
            .expect("interpret_effects");

        let attempts = CompletionAttemptRepository::new(&connection)
            .list_by_issue_id(16)
            .expect("list attempts");
        assert_eq!(attempts.len(), 1);
        assert_eq!(
            attempts[0].result,
            crate::types::completion_attempt::CompletionAttemptResult::Completed
        );
        assert_eq!(attempts[0].head_after, "newhead");
        assert_eq!(attempts[0].commit_hash.as_deref(), Some("newhead"));
    }

    #[test]
    fn commit_completion_completes_issue_and_skips_flow_upsert() {
        let connection = setup_database();
        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let issue = fetch_issue(&connection);
        let session = fetch_session(&connection);
        let registry = AgentSessionRegistry::new();
        let world = world("abc123");
        let ctx = EffectContext {
            repo_path: "/tmp/repo",
            issue: &issue,
            session: &session,
            world: &world,
            agent_registry: &registry,
        };

        let outcome = CompletionFlow::new(&service)
            .interpret_effects(
                &ctx,
                Transition {
                    new_state: state(IssueCompletionPhase::Completed),
                    effects: vec![Effect::CommitCompletion {
                        snapshot: snapshot("final"),
                        option: CompletionAttemptOption::CompleteManual,
                    }],
                },
            )
            .expect("interpret_effects");

        // issue 标记完成。
        let status: String = connection
            .query_row(
                "SELECT status FROM issues WHERE id = 16",
                [],
                |row| row.get(0),
            )
            .expect("query status");
        assert_eq!(status, "completed");
        // Completed → flow_record 为 None（CommitCompletion 事务内已清 flow）。
        assert!(outcome.completed_issue.is_some());
        assert!(outcome.flow_record.is_none());
        let flow = IssueCompletionFlowRepository::new(&connection)
            .find_by_issue_id(16)
            .expect("find flow");
        assert!(flow.is_none(), "flow row should be cleared on completion");
    }

    #[test]
    fn non_completed_transition_upserts_flow_record() {
        let connection = setup_database();
        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let issue = fetch_issue(&connection);
        let session = fetch_session(&connection);
        let registry = AgentSessionRegistry::new();
        let world = world("abc123");
        let ctx = EffectContext {
            repo_path: "/tmp/repo",
            issue: &issue,
            session: &session,
            world: &world,
            agent_registry: &registry,
        };

        // 无 effect、终态非 Completed（如 prompt_dirty）→ 仅 upsert flow。
        let outcome = CompletionFlow::new(&service)
            .interpret_effects(
                &ctx,
                Transition {
                    new_state: state(IssueCompletionPhase::PromptingDirtyDecision),
                    effects: vec![],
                },
            )
            .expect("interpret_effects");

        assert!(outcome.flow_record.is_some());
        let flow = IssueCompletionFlowRepository::new(&connection)
            .find_by_issue_id(16)
            .expect("find flow")
            .expect("flow persisted");
        assert_eq!(flow.phase, IssueCompletionPhase::PromptingDirtyDecision);
    }

    #[test]
    fn multi_effect_runs_in_order() {
        // auto_committing 产出 [InjectCommitPrompt, RecordCompletionAttempt{PromptSent}]：
        // 两个 effect 都应执行（handle 收到 prompt 且 attempt 行写入）。
        let connection = setup_database();
        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let issue = fetch_issue(&connection);
        let session = fetch_session(&connection);

        let handle = Arc::new(RecordingHandle::new());
        let registry = AgentSessionRegistry::new();
        registry.register(session.id, handle.clone() as Arc<dyn AgentSessionHandle>);
        let world = world("abc123");
        let ctx = EffectContext {
            repo_path: "/tmp/repo",
            issue: &issue,
            session: &session,
            world: &world,
            agent_registry: &registry,
        };

        CompletionFlow::new(&service)
            .interpret_effects(
                &ctx,
                Transition {
                    new_state: state(IssueCompletionPhase::AutoCommitting),
                    effects: vec![
                        Effect::InjectCommitPrompt,
                        Effect::RecordCompletionAttempt {
                            result: CompletionAttemptResultForEffect::PromptSent,
                            head: "abc123".to_string(),
                            changed_files: vec![],
                            attempt_id: None,
                        },
                    ],
                },
            )
            .expect("interpret_effects");

        assert_eq!(handle.sent.lock().unwrap().len(), 1);
        let attempts = CompletionAttemptRepository::new(&connection)
            .list_by_issue_id(16)
            .expect("list attempts");
        assert_eq!(attempts.len(), 1);
        assert_eq!(
            attempts[0].result,
            crate::types::completion_attempt::CompletionAttemptResult::PromptSent
        );
    }

    /// 临时 git repo（reconcile 的 repo_path 基准）。
    fn create_git_repo(repo_dir: &Path) {
        fs::create_dir_all(repo_dir).expect("create repo dir");
        let run = |args: &[&str]| {
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
        };
        run(&["init"]);
        run(&["config", "user.email", "redwhisk@example.test"]);
        run(&["config", "user.name", "RedWhisk Test"]);
        fs::write(repo_dir.join("base.txt"), "base\n").expect("write base");
        run(&["add", "base.txt"]);
        run(&["commit", "-m", "initial"]);
    }

    #[test]
    fn attempt_rebase_failure_blocks_and_skips_remaining_effects() {
        // worktree 指向一个非 worktree 的空目录 → reconcile 失败 →
        // new_state.phase=Blocked、merge_block 填充、剩余 CommitCompletion 不执行。
        let repo_tmp = TempDir::new().expect("repo tmp");
        let repo_dir = repo_tmp.path();
        create_git_repo(repo_dir);

        let connection = setup_database();
        // session 改为带 worktree 元数据，且 workspace_path 指向一个存在但非 worktree 的目录。
        let bogus_workspace = repo_dir.join("not-a-worktree");
        fs::create_dir_all(&bogus_workspace).expect("create bogus workspace");
        let workspace_path = bogus_workspace.to_string_lossy().to_string();
        connection
            .execute(
                "UPDATE agent_sessions SET workspace_mode='worktree',
                    workspace_path=?1, workspace_branch='feature', origin_branch='main'
                 WHERE id=30",
                params![workspace_path],
            )
            .expect("update session");

        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );
        let issue = fetch_issue(&connection);
        let session = fetch_session(&connection);
        let registry = AgentSessionRegistry::new();

        let repo_path = repo_dir.to_string_lossy().to_string();
        let world = CompletionWorld {
            issue_status: IssueStatus::Review,
            workspace_mode: WorkspaceMode::Worktree,
            workspace_missing: false,
            owner: WorktreeOwner::Redwhisk,
            target_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            branch_mismatch: true,
            actual_path: repo_path.clone(),
            drifted: false,
            session_closed_out: false,
            missing_worktree_error: None,
            snapshot: snapshot("abc123"),
            attempt_option: CompletionAttemptOption::CompleteManual,
        };
        let ctx = EffectContext {
            repo_path: repo_path.as_str(),
            issue: &issue,
            session: &session,
            world: &world,
            agent_registry: &registry,
        };

        let outcome = CompletionFlow::new(&service)
            .interpret_effects(
                &ctx,
                Transition {
                    new_state: state(IssueCompletionPhase::Completed),
                    effects: vec![
                        Effect::AttemptRebaseAndCleanup {
                            on_failure: FailurePolicy::Block,
                        },
                        Effect::CommitCompletion {
                            snapshot: snapshot("final"),
                            option: CompletionAttemptOption::CompleteManual,
                        },
                    ],
                },
            )
            .expect("interpret_effects");

        // rebase 失败 → Blocked、merge_block 填充、CommitCompletion 跳过。
        assert_eq!(outcome.new_state.phase, IssueCompletionPhase::Blocked);
        assert!(outcome.merge_block.is_some());
        assert!(
            outcome.completed_issue.is_none(),
            "trailing CommitCompletion must be skipped"
        );
        // Blocked → flow upsert（非 Completed）。
        assert!(outcome.flow_record.is_some());
    }
}
