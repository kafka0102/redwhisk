use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use rusqlite::{params, Transaction};

use crate::agent::agent_event_broadcaster::{AgentEventBroadcaster, TURN_GRACE_MS};
use crate::local_data_path::user_home_from_data_dir;
use crate::agent::provider_factory::{
    AgentSessionProviderFactory, AgentSessionStartRequest, DefaultAgentSessionProviderFactory,
    ThreadIdBackfill,
};
use crate::agent::pty_session_manager::{
    read_terminal_snapshot, PtyCommandMode, PtyExitStatus, PtySessionManager, PtySpawnRequest,
};
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::agent::session_registry::AgentSessionRegistry;
use crate::features::issue::IssueService;
use crate::db::agent_profile_repository::{AgentProfileRepository, AgentProfileRow};
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::event_repository::EventRepository;
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::git::worktree::{
    cleanup_worktree, list_local_branches, restore_worktree_for_branch,
    GitBranchInfo,
};
use crate::types::agent_profile::{AgentScope, AgentType};
use crate::types::agent_session::{
    AgentSessionAttention, AgentSessionListItem, AgentSessionListResponse, AgentSessionPromptKind,
    AgentSessionStatus, InjectAgentSessionPromptInput, InjectAgentSessionPromptResult,
    ProjectGitBranchListInput, ProjectGitBranchListResult, ReadAgentTimelineResult,
    ResumeStructuredAgentSessionInput, ResumeStructuredAgentSessionResult,
    SetAgentSessionAttentionInput, SetAgentSessionAttentionResult, StartAgentSessionInput,
    StartAgentSessionResult, StartStructuredAgentSessionInput, StartStructuredAgentSessionResult,
    UpdateAgentSessionTitleInput, WorkspaceMode, WorktreeOwner,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{
    CompleteIssueCleanInput, CompleteIssueManualInput, DeleteIssueWorktreeInput,
    DeleteIssueWorktreeResult, GetIssueWorktreeStatusInput, IssueRecord, IssueStatus,
    IssueWorktreeStatusResult,
};
use crate::types::issue_action::{IssueActionActor, IssueActionType};
use crate::types::project::{ProjectSummary, ProjectWorktreeLocation};
use crate::types::session_event::SessionEventType;


use super::command_snapshot::{agent_command_with_default_args, build_structured_command_snapshot, ensure_codex_bypass_arg, read_codex_model_from_data_dir, read_codex_reasoning_effort_from_data_dir};
use super::launch::{persist_started_session_thread_id, start_provider_session};
use super::log_path::{build_issue_runtime_structured_log_path, build_pending_structured_log_path, build_standalone_runtime_structured_log_path, is_archived_issue_log_path, remove_session_log_file};
use super::timeline::{is_empty_standalone_thread_timeline_error, latest_effort_from_session_log, latest_output_from_session_log, read_timeline_from_session_log};
use super::validation::{validate_injected_prompt, validate_profile_not_deleted, validate_profile_scope, validate_prompt_snapshot, validate_session_title, validate_working_dir};
use super::worktree_setup::run_worktree_setup_command;

const STARTUP_CHECK_TOTAL_MS: u64 = 500;
const STARTUP_CHECK_INTERVAL_MS: u64 = 25;
const CODEX_SESSION_CAPTURE_TOTAL_MS: u64 = 5_000;
const CODEX_SESSION_CAPTURE_INTERVAL_MS: u64 = 250;
const ATTENTION_SNAPSHOT_MAX_BYTES: usize = 32_768;
const AGENT_SESSION_COMPLETED_LIST_LIMIT: usize = 50;

pub(super) struct SessionLaunchContext {
    pub(super) profile: AgentProfileRow,
    pub(super) working_dir: String,
    pub(super) log_path: String,
    pub(super) command_snapshot: String,
    pub(super) started_at: i64,
    pub(super) workspace_mode: WorkspaceMode,
    pub(super) target_branch: Option<String>,
    pub(super) workspace_branch: Option<String>,
    pub(super) workspace_path: Option<String>,
    pub(super) origin_branch: Option<String>,
    pub(super) worktree_owner: WorktreeOwner,
    pub(super) worktree_root_path: Option<String>,
    pub(super) worktree_setup_command: Option<String>,
}

pub struct AgentSessionRuntimeListResult {
    pub response: AgentSessionListResponse,
    pub pruned_runtime_session_ids: Vec<i64>,
}

pub struct AgentSessionService<'connection> {
    pub(super) issue_repository: IssueRepository<'connection>,
    pub(super) project_repository: ProjectRepository<'connection>,
    pub(super) agent_profile_repository: AgentProfileRepository<'connection>,
    pub(super) agent_session_repository: AgentSessionRepository<'connection>,
}

impl<'connection> AgentSessionService<'connection> {
    pub fn new(
        issue_repository: IssueRepository<'connection>,
        project_repository: ProjectRepository<'connection>,
        agent_profile_repository: AgentProfileRepository<'connection>,
        agent_session_repository: AgentSessionRepository<'connection>,
    ) -> Self {
        Self {
            issue_repository,
            project_repository,
            agent_profile_repository,
            agent_session_repository,
        }
    }

    pub fn start_agent_session(
        &self,
        data_dir: impl AsRef<Path>,
        input: StartAgentSessionInput,
    ) -> Result<StartAgentSessionResult, CommandError> {
        self.start_agent_session_internal(data_dir, input, None)
    }

    /// 标记当前 turn 来源为 `follow_up`（用户在 session 中追问）。在 send_message
    /// 前调用：写 source 同时清空 current_turn_id，待 TurnStarted 回流时由
    /// broadcaster 写入新 turn_id。completion turn 自动评论提取仅在 source 为
    /// completion 时触发，故 follow_up turn 不会发表评论。
    pub fn record_follow_up_turn_source(&self, session_id: i64) -> Result<(), CommandError> {
        self.agent_session_repository
            .update_current_turn_source(session_id, "follow_up")
            .map_err(agent_session_database_error)?;
        Ok(())
    }

    pub fn start_agent_session_with_pty(
        &self,
        data_dir: impl AsRef<Path>,
        input: StartAgentSessionInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<StartAgentSessionResult, CommandError> {
        self.start_agent_session_internal(data_dir, input, Some(pty_sessions))
    }

    pub fn start_agent_session_with_runtime(
        &self,
        data_dir: impl AsRef<Path>,
        input: StartAgentSessionInput,
        pty_sessions: &PtySessionManager,
        agent_registry: &AgentSessionRegistry,
        broadcaster: &AgentEventBroadcaster,
    ) -> Result<StartAgentSessionResult, CommandError> {
        let launch = self.prepare_issue_session_launch(data_dir.as_ref(), &input)?;
        // 当前 Codex / Claude 均走结构化路径；pty_sessions 保留给未来非结构化降级路径。
        let _ = pty_sessions;
        self.start_structured_issue_agent_session(
            data_dir.as_ref(),
            input,
            launch,
            agent_registry,
            broadcaster,
            &DefaultAgentSessionProviderFactory,
        )
    }

    /// 查询 Issue 最近一次 worktree 模式 session 的残留状态。
    ///
    /// 退回 Backlog 会软删旧 session 但不清理 worktree 目录与分支；再次运行前
    /// 前端据此判断是否需要弹出"删除同名 worktree"确认框。
    pub fn get_issue_worktree_status(
        &self,
        input: GetIssueWorktreeStatusInput,
    ) -> Result<IssueWorktreeStatusResult, CommandError> {
        self.project_by_id(input.project_id)?;

        let session = self
            .agent_session_repository
            .find_latest_worktree_session_by_issue_id(input.issue_id)
            .map_err(agent_session_database_error)?;

        let Some(session) = session else {
            return Ok(IssueWorktreeStatusResult {
                exists: false,
                can_delete: false,
                workspace_path: None,
                workspace_branch: None,
            });
        };

        let workspace_path = session.workspace_path.clone();
        let exists = workspace_path
            .as_deref()
            .is_some_and(|path| Path::new(path).exists());
        let can_delete = exists && session.worktree_owner == WorktreeOwner::Redwhisk;

        Ok(IssueWorktreeStatusResult {
            exists,
            can_delete,
            workspace_path: if exists { workspace_path } else { None },
            workspace_branch: if exists {
                session.workspace_branch.clone()
            } else {
                None
            },
        })
    }

    /// 删除 Issue 关联的 RedWhisk worktree（目录 + 工作分支 + prune）。
    ///
    /// 仅允许删除 `WorktreeOwner::Redwhisk` 管理的 worktree；外部 worktree 由
    /// 完成流程的二次确认处理，不在此处删除。
    pub fn delete_issue_worktree(
        &self,
        input: DeleteIssueWorktreeInput,
    ) -> Result<DeleteIssueWorktreeResult, CommandError> {
        let project = self.project_by_id(input.project_id)?;

        let session = self
            .agent_session_repository
            .find_latest_worktree_session_by_issue_id(input.issue_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::IssueValidationFailed,
                    "未找到关联的 worktree，无需删除。",
                ).with_reason("worktreeNotFound")
                .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            })?;

        if session.worktree_owner != WorktreeOwner::Redwhisk {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "当前 worktree 非 RedWhisk 管理，无法删除。",
            ).with_reason("worktreeNotManaged")
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id)));
        }

        let Some(workspace_path) = session.workspace_path.as_deref() else {
            return Err(CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "关联 worktree 缺少工作目录信息，无法删除。",
            ).with_reason("worktreeMissingWorkDir")
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id)));
        };

        if !Path::new(workspace_path).exists() {
            return Ok(DeleteIssueWorktreeResult {
                issue_id: input.issue_id,
                deleted: false,
                workspace_path: Some(workspace_path.to_string()),
            });
        }

        let workspace_branch = session.workspace_branch.as_deref().ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssueValidationFailed,
                "关联 worktree 缺少工作分支信息，无法删除。",
            ).with_reason("worktreeMissingBranch")
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
        })?;

        cleanup_worktree(&project.repo_path, workspace_path, workspace_branch).map_err(
            |error| {
                CommandError::new(
                    CommandErrorCode::AgentSessionStartFailed,
                    "删除 worktree 失败。",
                ).with_reason("worktreeDeleteFailed")
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            },
        )?;

        Ok(DeleteIssueWorktreeResult {
            issue_id: input.issue_id,
            deleted: true,
            workspace_path: Some(workspace_path.to_string()),
        })
    }

    pub fn get_issue_worktree_status_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: GetIssueWorktreeStatusInput,
    ) -> Result<IssueWorktreeStatusResult, CommandError> {
        let database = DatabaseConfig::new(&data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(agent_session_database_error)?;

        AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        )
        .get_issue_worktree_status(input)
    }

    pub fn delete_issue_worktree_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: DeleteIssueWorktreeInput,
    ) -> Result<DeleteIssueWorktreeResult, CommandError> {
        let database = DatabaseConfig::new(&data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(agent_session_database_error)?;

        AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        )
        .delete_issue_worktree(input)
    }

    fn start_agent_session_internal(
        &self,
        data_dir: impl AsRef<Path>,
        input: StartAgentSessionInput,
        pty_sessions: Option<&PtySessionManager>,
    ) -> Result<StartAgentSessionResult, CommandError> {
        let launch = self.prepare_issue_session_launch(data_dir.as_ref(), &input)?;
        self.start_agent_session_internal_with_launch(data_dir, input, launch, pty_sessions)
    }

    fn start_agent_session_internal_with_launch(
        &self,
        data_dir: impl AsRef<Path>,
        input: StartAgentSessionInput,
        launch: SessionLaunchContext,
        pty_sessions: Option<&PtySessionManager>,
    ) -> Result<StartAgentSessionResult, CommandError> {
        let prompt_snapshot = validate_prompt_snapshot(&input.prompt_snapshot)?;
        let issue = self
            .issue_repository
            .find_by_id(input.issue_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::IssueNotFound, "Issue 不存在。").with_reason("issueNotFound")
                    .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            })?;

        if issue.project_id != input.project_id {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Issue 不属于当前 Project。",
            ).with_reason("issueNotInProject")
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            .with_detail(ErrorDetail::new("Project").with_value("projectId", input.project_id)));
        }

        if let Some(existing_session) = self
            .agent_session_repository
            .find_by_issue_id(input.issue_id)
            .map_err(agent_session_database_error)?
        {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionAlreadyExists,
                "当前 Issue 已存在关联 Agent Session。",
            )
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            .with_detail(
                ErrorDetail::new("AgentSession")
                    .with_value("sessionId", existing_session.id)
                    .with_value(
                        "status",
                        format!("{:?}", existing_session.status).to_lowercase(),
                    ),
            ));
        }

        if issue.status != IssueStatus::Backlog {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "只有 backlog Issue 可以启动 Agent Session。",
            ).with_reason("onlyBacklogCanStart")
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("status", format!("{:?}", issue.status).to_lowercase()),
            ));
        }

        let command_accepts_prompt_argument =
            command_supports_prompt_argument(&launch.command_snapshot);
        let initial_prompt_argument =
            command_accepts_prompt_argument.then(|| prompt_snapshot.clone());

        let pending_pty = if let Some(pty_sessions) = pty_sessions {
            Some(
                pty_sessions
                    .spawn_pending(&PtySpawnRequest {
                        mode: PtyCommandMode::ExecReplace,
                        command: launch.command_snapshot.clone(),
                        working_dir: launch.working_dir.clone(),
                        log_path: launch.log_path.clone(),
                        initial_prompt: initial_prompt_argument.clone(),
                        rows: 32,
                        cols: 120,
                        startup_check_total_ms: STARTUP_CHECK_TOTAL_MS,
                        startup_check_interval_ms: STARTUP_CHECK_INTERVAL_MS,
                    })
                    .map_err(agent_session_start_error)?,
            )
        } else {
            None
        };
        let normalized_prompt = normalize_submitted_prompt(&prompt_snapshot);
        let mut child = if pending_pty.is_none() {
            let mut child = match spawn_agent_process(
                &launch.profile,
                &launch.working_dir,
                &launch.log_path,
                initial_prompt_argument.as_deref(),
            ) {
                Ok(child) => child,
                Err(error) => {
                    self.cleanup_owned_worktree(input.project_id, &launch);
                    return Err(error);
                }
            };
            if let Err(error) = ensure_process_started(&mut child, &launch.command_snapshot) {
                self.cleanup_owned_worktree(input.project_id, &launch);
                return Err(error);
            }
            Some(child)
        } else {
            None
        };
        let mut pending_pty = pending_pty;
        if !command_accepts_prompt_argument {
            if let Some(pending_pty) = pending_pty.as_mut() {
                pending_pty
                    .write_input(&normalized_prompt)
                    .map_err(agent_session_start_error)?;
            }
        }

        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(agent_session_database_error)?;

        let transaction_result: Result<StartAgentSessionResult, rusqlite::Error> = (|| {
            let session = AgentSessionRepository::insert_in_transaction(
                &transaction,
                input.project_id,
                issue.id,
                input.agent_profile_id,
                input.workflow_skill_name.as_deref(),
                &launch.working_dir,
                &launch.command_snapshot,
                &prompt_snapshot,
                &launch.workspace_mode,
                launch.target_branch.as_deref(),
                launch.workspace_branch.as_deref(),
                launch.workspace_path.as_deref(),
                launch.origin_branch.as_deref(),
                launch.worktree_owner,
                launch.worktree_root_path.as_deref(),
                launch.worktree_setup_command.as_deref(),
                &launch.log_path,
                launch.started_at,
            )?;

            let updated_issue = IssueRepository::update_status_in_transaction(
                &transaction,
                input.project_id,
                issue.id,
                IssueStatus::Running,
            )?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)?;

            let session_event_payload = json!({
                "sessionId": session.id,
                "issueId": issue.id,
                "agentProfileId": input.agent_profile_id,
                "status": "running",
                "logPath": launch.log_path,
            })
            .to_string();
            EventRepository::insert_session_event_in_transaction(
                &transaction,
                session.id,
                SessionEventType::SessionStarted,
                &session_event_payload,
                launch.started_at,
            )?;

            let issue_action_payload = json!({
                "sessionId": session.id,
                "fromStatus": "backlog",
                "toStatus": "running",
                "agentProfileId": input.agent_profile_id,
            })
            .to_string();
            EventRepository::insert_issue_action_in_transaction(
                &transaction,
                issue.id,
                IssueActionType::AgentSessionStarted,
                &issue_action_payload,
                updated_issue.updated_at,
                IssueActionActor::User { profile_id: 1 },
            )?;

            transaction.commit()?;

            Ok(StartAgentSessionResult {
                session_id: session.id,
                issue_id: issue.id,
            })
        })();

        match transaction_result {
            Ok(result) => {
                if should_attempt_codex_session_capture(&launch.command_snapshot) {
                    let data_dir = data_dir.as_ref().to_path_buf();
                    let working_dir = launch.working_dir.clone();
                    let session_id = result.session_id;
                    thread::spawn(move || {
                        refresh_codex_session_id_in_data_dir(
                            &data_dir,
                            session_id,
                            &working_dir,
                            launch.started_at,
                        );
                    });
                }

                if let Some(pty_sessions) = pty_sessions {
                    if let Some(pending_pty) = pending_pty {
                        let data_dir = data_dir.as_ref().to_path_buf();
                        let data_dir_for_exit = data_dir.clone();
                        if let Err(error) = pty_sessions.register_for_project(
                            input.project_id,
                            result.session_id,
                            pending_pty,
                            move |exit_status| {
                                let _ = AgentSessionService::record_session_termination_in_data_dir(
                                    &data_dir_for_exit,
                                    result.session_id,
                                    exit_status,
                                );
                            },
                        ) {
                            error.pending.terminate();
                            let _ = AgentSessionService::record_session_termination_in_data_dir(
                                &data_dir,
                                result.session_id,
                                PtyExitStatus { exit_code: None },
                            );
                        }
                    }
                } else if let Some(child) = child.take() {
                    let data_dir = data_dir.as_ref().to_path_buf();
                    let session_id = result.session_id;
                    thread::spawn(move || {
                        let mut child = child;
                        let exit_status = child
                            .wait()
                            .ok()
                            .map(|status| PtyExitStatus {
                                exit_code: status.code(),
                            })
                            .unwrap_or(PtyExitStatus { exit_code: None });
                        let _ = AgentSessionService::record_session_termination_in_data_dir(
                            &data_dir,
                            session_id,
                            exit_status,
                        );
                    });
                }
                Ok(result)
            }
            Err(error) => {
                if let Some(pending_pty) = pending_pty {
                    pending_pty.terminate();
                }
                if let Some(mut child) = child.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                Err(agent_session_transaction_error_for_issue(
                    self.issue_repository.connection(),
                    error,
                    input.issue_id,
                ))
            }
        }
    }

    fn start_structured_issue_agent_session(
        &self,
        data_dir: &Path,
        input: StartAgentSessionInput,
        launch: SessionLaunchContext,
        agent_registry: &AgentSessionRegistry,
        broadcaster: &AgentEventBroadcaster,
        factory: &dyn AgentSessionProviderFactory,
    ) -> Result<StartAgentSessionResult, CommandError> {
        let prompt_snapshot = validate_prompt_snapshot(&input.prompt_snapshot)?;
        let issue = self
            .issue_repository
            .find_by_id(input.issue_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::IssueNotFound, "Issue 不存在。").with_reason("issueNotFound")
                    .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            })?;

        if issue.project_id != input.project_id {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Issue 不属于当前 Project。",
            ).with_reason("issueNotInProject")
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            .with_detail(ErrorDetail::new("Project").with_value("projectId", input.project_id)));
        }

        if let Some(existing_session) = self
            .agent_session_repository
            .find_by_issue_id(input.issue_id)
            .map_err(agent_session_database_error)?
        {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionAlreadyExists,
                "当前 Issue 已存在关联 Agent Session。",
            )
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            .with_detail(
                ErrorDetail::new("AgentSession")
                    .with_value("sessionId", existing_session.id)
                    .with_value(
                        "status",
                        format!("{:?}", existing_session.status).to_lowercase(),
                    ),
            ));
        }

        if issue.status != IssueStatus::Backlog {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "只有 backlog Issue 可以启动 Agent Session。",
            ).with_reason("onlyBacklogCanStart")
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("status", format!("{:?}", issue.status).to_lowercase()),
            ));
        }

        let previous_archive_path =
            self.previous_issue_archive_log_path(data_dir, input.issue_id)?;
        let pending_log_path =
            build_pending_structured_log_path(data_dir, input.project_id, launch.started_at)?;
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(agent_session_database_error)?;

        let transaction_result: Result<StartAgentSessionResult, rusqlite::Error> = (|| {
            let session = AgentSessionRepository::insert_in_transaction(
                &transaction,
                input.project_id,
                issue.id,
                input.agent_profile_id,
                input.workflow_skill_name.as_deref(),
                &launch.working_dir,
                &launch.command_snapshot,
                &prompt_snapshot,
                &launch.workspace_mode,
                launch.target_branch.as_deref(),
                launch.workspace_branch.as_deref(),
                launch.workspace_path.as_deref(),
                launch.origin_branch.as_deref(),
                launch.worktree_owner,
                launch.worktree_root_path.as_deref(),
                launch.worktree_setup_command.as_deref(),
                &pending_log_path,
                launch.started_at,
            )?;
            let structured_log_path = build_issue_runtime_structured_log_path(
                data_dir,
                input.project_id,
                issue.number,
                session.number,
            )
            .map_err(command_error_to_sqlite)?;
            let session = AgentSessionRepository::update_log_path_in_transaction(
                &transaction,
                session.id,
                &structured_log_path,
            )?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)?;

            let updated_issue = IssueRepository::update_status_in_transaction(
                &transaction,
                input.project_id,
                issue.id,
                IssueStatus::Running,
            )?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)?;

            let session_event_payload = json!({
                "sessionId": session.id,
                "issueId": issue.id,
                "agentProfileId": input.agent_profile_id,
                "status": "running",
                "structuredStream": true,
                "logPath": session.log_path,
            })
            .to_string();
            EventRepository::insert_session_event_in_transaction(
                &transaction,
                session.id,
                SessionEventType::SessionStarted,
                &session_event_payload,
                launch.started_at,
            )?;

            let issue_action_payload = json!({
                "sessionId": session.id,
                "fromStatus": "backlog",
                "toStatus": "running",
                "agentProfileId": input.agent_profile_id,
            })
            .to_string();
            EventRepository::insert_issue_action_in_transaction(
                &transaction,
                issue.id,
                IssueActionType::AgentSessionStarted,
                &issue_action_payload,
                updated_issue.updated_at,
                IssueActionActor::User { profile_id: 1 },
            )?;

            transaction.commit()?;

            Ok(StartAgentSessionResult {
                session_id: session.id,
                issue_id: issue.id,
            })
        })();

        let result = transaction_result.map_err(|error| {
            agent_session_transaction_error_for_issue(
                self.issue_repository.connection(),
                error,
                input.issue_id,
            )
        })?;
        // DB 事务已 commit（session 为 running），但后续 handle 启动 + send_message
        // 仍耗时。在此窗口内并发的 reconcile（轮询 list_agent_sessions 触发）会
        // 把"running 但不在 registry"的 session 误判为重启遗留并标记 stopped。
        // mark_starting 让 contains 返回 true，reconcile 据此跳过；register 真实
        // handle 时自动清除该标记，失败路径需显式 unmark。
        self.finish_structured_issue_provider_start(
            factory,
            AgentSessionStartRequest {
                agent_type: launch.profile.agent_type.clone(),
                project_id: input.project_id,
                session_id: result.session_id,
                binary: launch.command_snapshot.clone(),
                cwd: launch.working_dir.clone(),
                mode_id: Some(launch.profile.mode.clone()),
                dangerous: launch.profile.dangerous,
                model: match launch.profile.agent_type {
                    AgentType::Codex => read_codex_model_from_data_dir(data_dir),
                    AgentType::Claude => None,
                },
                effort: match launch.profile.agent_type {
                    AgentType::Codex => read_codex_reasoning_effort_from_data_dir(data_dir),
                    AgentType::Claude => None,
                },
                resume_thread_id: None,
                broadcaster: broadcaster.clone(),
                config_home: user_home_from_data_dir(data_dir),
            },
            agent_registry,
            broadcaster,
            &prompt_snapshot,
            input.project_id,
            input.issue_id,
            result.session_id,
            &launch,
            previous_archive_path.as_deref(),
        )?;
        Ok(result)
    }

    pub fn list_agent_sessions(
        &self,
        project_id: i64,
    ) -> Result<AgentSessionListResponse, CommandError> {
        let project = self.project_by_id(project_id)?;
        let (can_complete_clean_for_project, can_complete_agent_commit_for_project) =
            project_completion_capabilities(&project.repo_path);

        self.agent_session_repository
            .prune_broken_structured_standalone_sessions(project_id, current_epoch_millis()?)
            .map_err(agent_session_database_error)?;

        self.agent_session_repository
            .prune_completed_over_limit(
                project_id,
                AGENT_SESSION_COMPLETED_LIST_LIMIT,
                current_epoch_millis()?,
            )
            .map_err(agent_session_database_error)?;

        let mut rows = self
            .agent_session_repository
            .list_by_project_id(project_id)
            .map_err(agent_session_database_error)?;

        for row in rows.iter_mut() {
            if row.status == crate::types::agent_session::AgentSessionStatus::Running {
                row.attention = self.reconcile_running_session_attention(row.session_id, None)?;
            }
        }

        rows.sort_by(|left, right| {
            right
                .list_inserted_at
                .cmp(&left.list_inserted_at)
                .then_with(|| right.session_id.cmp(&left.session_id))
        });

        let now = current_epoch_millis()?;

        let sessions = rows
            .into_iter()
            .map(|row| {
                let is_session_running =
                    row.status == crate::types::agent_session::AgentSessionStatus::Running;
                let latest_output = row
                    .latest_output
                    .or_else(|| latest_output_from_session_log(&row.log_path));
                let can_complete_clean = can_complete_clean_for_project
                    && is_session_running
                    && row.issue_status == Some(IssueStatus::Review);
                let can_complete_agent_commit = can_complete_agent_commit_for_project
                    && is_session_running
                    && row.issue_status == Some(IssueStatus::Review);

                AgentSessionListItem {
                    session_id: row.session_id,
                    number: row.number,
                    project_id: row.project_id,
                    issue_id: row.issue_id,
                    issue_number: row.issue_number,
                    issue_title: row.issue_title,
                    issue_status: row.issue_status,
                    agent_profile_id: row.agent_profile_id,
                    agent_profile_name: row.agent_profile_name,
                    can_complete_clean,
                    can_complete_agent_commit,
                    title: row.title,
                    agent_type: row.agent_type,
                    status: row.status,
                    attention: row.attention,
                    is_turn_running: is_session_running
                        && row.is_turn_running
                        && turn_still_running_by_grace(row.turn_ended_at, now),
                    workspace_mode: row.workspace_mode,
                    working_dir: row.working_dir,
                    workspace_path: row.workspace_path,
                    origin_branch: row.origin_branch,
                    workspace_branch: row.workspace_branch,
                    worktree_owner: row.worktree_owner,
                    log_path: row.log_path,
                    latest_output,
                    workflow_skill_name: row.workflow_skill_name,
                    last_active_at: row.last_active_at,
                    started_at: row.started_at,
                    closed_at: row.closed_at,
                    processing_ms: row.processing_ms,
                    last_output_at: row.last_output_at,
                }
            })
            .collect();

        Ok(AgentSessionListResponse { sessions })
    }

    pub fn runtime_session_ids_to_cleanup(
        &self,
        project_id: i64,
        registered_session_ids: &[i64],
    ) -> Result<Vec<i64>, CommandError> {
        self.ensure_project_exists(project_id)?;
        self.agent_session_repository
            .list_runtime_cleanup_candidates(project_id, registered_session_ids)
            .map_err(agent_session_database_error)
    }

    pub fn get_project_git_branches(
        &self,
        input: ProjectGitBranchListInput,
    ) -> Result<ProjectGitBranchListResult, CommandError> {
        let project = self.project_by_id(input.project_id)?;
        let branch_info =
            list_local_branches(&project.repo_path).map_err(agent_session_start_error)?;

        Ok(ProjectGitBranchListResult {
            current_branch: branch_info.current_branch,
            local_branches: branch_info.local_branches,
        })
    }

    pub fn reconcile_unrecoverable_running_sessions(
        &self,
        project_id: i64,
        pty_sessions: &PtySessionManager,
        agent_registry: &AgentSessionRegistry,
    ) -> Result<(), CommandError> {
        self.ensure_project_exists(project_id)?;

        let running_sessions = self
            .agent_session_repository
            .list_running_by_project_id(project_id)
            .map_err(agent_session_database_error)?;

        for session in running_sessions {
            if pty_sessions.contains(session.id) || agent_registry.contains(session.id) {
                continue;
            }

            self.mark_session_stopped_after_restart(&session)?;
        }

        Ok(())
    }

    fn ensure_project_exists(&self, project_id: i64) -> Result<(), CommandError> {
        self.project_by_id(project_id).map(|_| ())
    }

    pub(super) fn project_by_id(
        &self,
        project_id: i64,
    ) -> Result<crate::types::project::ProjectSummary, CommandError> {
        self.project_repository
            .find_by_id(project_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            })
    }

    pub fn set_session_attention(
        &self,
        input: SetAgentSessionAttentionInput,
    ) -> Result<SetAgentSessionAttentionResult, CommandError> {
        let session = self.find_project_session(input.project_id, input.session_id)?;
        if session.status != AgentSessionStatus::Running {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "只有运行中的 Agent Session 可以更新关注状态。",
            ).with_reason("mustBeRunningToUpdateFollow")
            .with_detail(
                ErrorDetail::new("AgentSession").with_value("sessionId", input.session_id),
            ));
        }

        if session.attention == input.attention {
            return Ok(SetAgentSessionAttentionResult {
                session_id: session.id,
                attention: session.attention,
            });
        }

        let updated_at = current_epoch_millis()?;
        let updated_session = self
            .agent_session_repository
            .update_attention(input.session_id, input.attention.clone(), updated_at)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentSessionPersistenceFailed,
                    "Agent Session 关注状态更新失败。",
                ).with_reason("followStatusUpdateFailed")
                .with_detail(
                    ErrorDetail::new("AgentSession").with_value("sessionId", input.session_id),
                )
            })?;

        let payload = json!({
            "sessionId": session.id,
            "issueId": session.issue_id,
            "attention": attention_literal(&input.attention),
            "trigger": "manual",
        })
        .to_string();
        let event_type = match input.attention {
            AgentSessionAttention::Requested => SessionEventType::SessionAttentionRequested,
            AgentSessionAttention::None => SessionEventType::SessionAttentionCleared,
        };

        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(agent_session_database_error)?;
        EventRepository::insert_session_event_in_transaction(
            &transaction,
            session.id,
            event_type,
            &payload,
            updated_at,
        )
        .map_err(agent_session_database_error)?;
        transaction.commit().map_err(agent_session_database_error)?;

        Ok(SetAgentSessionAttentionResult {
            session_id: updated_session.id,
            attention: updated_session.attention,
        })
    }

    pub fn inject_session_prompt(
        &self,
        input: InjectAgentSessionPromptInput,
        pty_sessions: &PtySessionManager,
        agent_registry: &AgentSessionRegistry,
    ) -> Result<InjectAgentSessionPromptResult, CommandError> {
        let prompt = validate_injected_prompt(&input.prompt)?;
        let session = self.find_project_session(input.project_id, input.session_id)?;
        let submitted_prompt = normalize_submitted_prompt(&prompt);

        // Structured session（codex/claude）只注册到 agent_registry，从不进入 pty_sessions；
        // PTY session 只在 pty_sessions。两条通道分别处理，都不可用时报告 NotRunning，
        // 让前端有机会触发 resume 后重试。
        if pty_sessions.contains(input.session_id) {
            pty_sessions
                .write_input(input.session_id, &submitted_prompt)
                .map_err(inactive_terminal_error)?;
        } else if let Some(handle) = agent_registry.get(session.id) {
            handle
                .send_message(prompt.clone(), Vec::new())
                .map_err(agent_session_error_to_command_error)?;
        } else {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionNotRunning,
                "当前 Session 未运行，请先恢复会话后再注入。",
            ).with_reason("notRunningForInject")
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id)));
        }
        self.clear_attention_after_successful_input(input.session_id)?;

        let codex_session_id = session.codex_session_id.clone();
        let recorded_at = current_epoch_millis()?;
        let payload = json!({
            "sessionId": session.id,
            "issueId": session.issue_id,
            "kind": prompt_kind_literal(&input.kind),
            "prompt": prompt,
            "submitted": true,
            "codexSessionId": codex_session_id,
        })
        .to_string();

        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(agent_session_database_error)?;
        EventRepository::insert_session_event_in_transaction(
            &transaction,
            session.id,
            SessionEventType::SessionPromptInjected,
            &payload,
            recorded_at,
        )
        .map_err(agent_session_database_error)?;
        transaction.commit().map_err(agent_session_database_error)?;

        Ok(InjectAgentSessionPromptResult {
            session_id: session.id,
            codex_session_id,
        })
    }

    fn reconcile_running_session_attention(
        &self,
        session_id: i64,
        snapshot_override: Option<&str>,
    ) -> Result<AgentSessionAttention, CommandError> {
        let session = self
            .agent_session_repository
            .find_by_id(session_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::IssueNotFound, "Agent Session 不存在。").with_reason("sessionNotFound")
                    .with_detail(
                        ErrorDetail::new("AgentSession").with_value("sessionId", session_id),
                    )
            })?;

        if session.status != AgentSessionStatus::Running {
            return Ok(session.attention);
        }

        if session.attention == AgentSessionAttention::Requested {
            return Ok(session.attention);
        }

        if !session_log_has_new_output(&session.log_path, session.last_active_at) {
            return Ok(session.attention);
        }

        let snapshot = match snapshot_override {
            Some(snapshot) => snapshot.to_string(),
            None => {
                read_terminal_snapshot(Path::new(&session.log_path), ATTENTION_SNAPSHOT_MAX_BYTES)
                    .map_err(agent_session_start_error)?
            }
        };

        if !snapshot_ends_with_codex_input_prompt(&snapshot) {
            return Ok(session.attention);
        }

        let updated_at = current_epoch_millis()?;
        let updated_session = self
            .agent_session_repository
            .update_attention(session_id, AgentSessionAttention::Requested, updated_at)
            .map_err(agent_session_database_error)?;

        Ok(updated_session
            .map(|record| record.attention)
            .unwrap_or(AgentSessionAttention::Requested))
    }

    fn clear_attention_after_successful_input(&self, session_id: i64) -> Result<(), CommandError> {
        let updated_at = current_epoch_millis()?;
        self.agent_session_repository
            .update_attention(session_id, AgentSessionAttention::None, updated_at)
            .map_err(agent_session_database_error)?;
        Ok(())
    }

    fn find_project_session(
        &self,
        project_id: i64,
        session_id: i64,
    ) -> Result<crate::types::agent_session::AgentSessionRecord, CommandError> {
        self.ensure_project_exists(project_id)?;
        let session = self
            .agent_session_repository
            .find_by_id(session_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::IssueNotFound, "Agent Session 不存在。").with_reason("sessionNotFound")
                    .with_detail(
                        ErrorDetail::new("AgentSession").with_value("sessionId", session_id),
                    )
            })?;

        if session.project_id != project_id {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Agent Session 不属于当前 Project。",
            ).with_reason("sessionNotInProject")
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id))
            .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id)));
        }

        Ok(session)
    }

    /// 结构化 Agent Session 命令的归属校验入口。
    ///
    /// 与私有 `find_project_session` 行为一致（确保 project 存在 + session
    /// 归属该 project），但公开给命令层调用，供 `send_agent_message` 等
    /// 结构化命令在操作句柄前校验 session 归属。
    pub fn find_project_session_record(
        &self,
        project_id: i64,
        session_id: i64,
    ) -> Result<crate::types::agent_session::AgentSessionRecord, CommandError> {
        self.find_project_session(project_id, session_id)
    }

    /// 查询指定 session 的 agent 类型（经 profile 表反查）。
    ///
    /// 供 `list_agent_models` / `set_agent_model` 命令按 agent 类型分发：
    /// Codex 走本地配置驱动的固定 GPT 列表，Claude 走 `~/.claude/settings.json`
    /// 解析。
    pub fn find_session_agent_type(
        &self,
        project_id: i64,
        session_id: i64,
    ) -> Result<AgentType, CommandError> {
        let session = self.find_project_session(project_id, session_id)?;
        let profile = self
            .agent_profile_repository
            .find_profile_by_id(session.agent_profile_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentSessionValidationFailed,
                    "Agent Session 关联的 Agent Profile 不存在。",
                ).with_reason("profileNotFound")
                .with_detail(
                    ErrorDetail::new("AgentProfile")
                        .with_value("profileId", session.agent_profile_id),
                )
            })?;
        Ok(profile.agent_type)
    }

    pub fn delete_standalone_session(
        &self,
        project_id: i64,
        session_id: i64,
    ) -> Result<crate::types::agent_session::DeleteAgentSessionResult, CommandError> {
        let session = self.find_project_session(project_id, session_id)?;
        if session.issue_id.is_some() {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "关联 Issue 的 Agent Session 不能从 Sessions 视图删除。",
            ).with_reason("linkedSessionCannotDelete")
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id)));
        }

        let deleted_at = current_epoch_millis()?;
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(agent_session_database_error)?;
        let deleted = AgentSessionRepository::soft_delete_in_transaction(
            &transaction,
            session_id,
            deleted_at,
        )
        .map_err(agent_session_database_error)?;
        if deleted {
            let payload = json!({
                "sessionId": session_id,
                "issueId": session.issue_id,
                "reason": "session_deleted",
            })
            .to_string();
            EventRepository::insert_session_event_in_transaction(
                &transaction,
                session_id,
                SessionEventType::SessionClosed,
                &payload,
                deleted_at,
            )
            .map_err(agent_session_database_error)?;
        }
        transaction.commit().map_err(agent_session_database_error)?;

        if !deleted {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 删除失败。",
            ).with_reason("deleteFailed")
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id)));
        }

        // 自定义 session 被删除后，同步删除磁盘上的 session log 文件。
        remove_session_log_file(Some(session.log_path.as_str()));

        Ok(crate::types::agent_session::DeleteAgentSessionResult { session_id })
    }

    pub fn update_standalone_session_title(
        &self,
        input: UpdateAgentSessionTitleInput,
    ) -> Result<crate::types::agent_session::UpdateAgentSessionTitleResult, CommandError> {
        let session = self.find_project_session(input.project_id, input.session_id)?;
        if session.issue_id.is_some() {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "关联 Issue 的 Agent Session 不能从 Sessions 视图修改标题。",
            ).with_reason("linkedSessionCannotRename")
            .with_detail(
                ErrorDetail::new("AgentSession").with_value("sessionId", input.session_id),
            ));
        }

        let title = validate_session_title(&input.title)?;
        let updated_at = current_epoch_millis()?;
        let updated = self
            .agent_session_repository
            .update_title(input.session_id, &title, updated_at)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentSessionPersistenceFailed,
                    "Agent Session 标题更新失败。",
                ).with_reason("titleUpdateFailed")
                .with_detail(
                    ErrorDetail::new("AgentSession").with_value("sessionId", input.session_id),
                )
            })?;

        Ok(crate::types::agent_session::UpdateAgentSessionTitleResult {
            session_id: updated.id,
            title: updated.title.unwrap_or(title),
        })
    }

    pub fn read_agent_timeline(
        &self,
        project_id: i64,
        session_id: i64,
        handle: Option<Arc<dyn AgentSessionHandle>>,
    ) -> Result<ReadAgentTimelineResult, CommandError> {
        let session = self.find_project_session(project_id, session_id)?;
        let history = read_timeline_from_session_log(&session)?;

        if !history.items.is_empty() || history.effort.is_some() {
            return Ok(ReadAgentTimelineResult {
                items: history.items,
                effort: history.effort,
            });
        }

        if let Some(handle) = handle {
            match handle.read_timeline() {
                Ok(items) => {
                    return Ok(ReadAgentTimelineResult {
                        items,
                        effort: latest_effort_from_session_log(&session),
                    });
                }
                Err(AgentSessionError::NotRunning(_)) => {}
                Err(AgentSessionError::Protocol(message))
                    if session.issue_id.is_none()
                        && is_empty_standalone_thread_timeline_error(&message) =>
                {
                    return Ok(ReadAgentTimelineResult {
                        items: Vec::new(),
                        effort: latest_effort_from_session_log(&session),
                    });
                }
                Err(error) => return Err(agent_session_error_to_command_error(error)),
            }
        }

        Ok(ReadAgentTimelineResult {
            items: history.items,
            effort: history.effort,
        })
    }
}

fn project_completion_capabilities(_repo_path: &str) -> (bool, bool) {
    // TODO(Impl-D): 重写为统一检测+弹框流程；当前 completion_policy 已移除，
    // completion 流程行为待重写，暂时返回全部不可用。
    (false, false)
}

impl AgentSessionService<'_> {
    pub fn start_agent_session_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: StartAgentSessionInput,
    ) -> Result<StartAgentSessionResult, CommandError> {
        let database = DatabaseConfig::new(&data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(agent_session_database_error)?;

        AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        )
        .start_agent_session(data_dir, input)
    }

    /// 启动结构化 Agent Session（codex app-server JSON-RPC 路径）。
    ///
    /// 与 PTY 路径并存：不创建 PTY 子进程，而是 spawn `codex app-server`
    /// 并通过 `CodexSessionHandle` 走结构化事件流。session 行会落到
    /// `agent_sessions` 表，并记录 log 路径、command snapshot、绑定的
    /// agent profile 与 `codex_session_id`（codex threadId）。
    pub fn start_structured_agent_session_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: StartStructuredAgentSessionInput,
        agent_registry: &AgentSessionRegistry,
        broadcaster: &AgentEventBroadcaster,
    ) -> Result<StartStructuredAgentSessionResult, CommandError> {
        let database = DatabaseConfig::new(&data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(agent_session_database_error)?;

        let service = AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        );
        service.start_structured_agent_session(
            data_dir.as_ref(),
            input,
            agent_registry,
            broadcaster,
        )
    }

    fn start_structured_agent_session(
        &self,
        data_dir: &Path,
        input: StartStructuredAgentSessionInput,
        agent_registry: &AgentSessionRegistry,
        broadcaster: &AgentEventBroadcaster,
    ) -> Result<StartStructuredAgentSessionResult, CommandError> {
        let project = self.project_by_id(input.project_id)?;
        let cwd = validate_working_dir(&project.repo_path).map_err(|mut error| {
            error
                .details
                .get_or_insert_with(Vec::new)
                .push(ErrorDetail::new("Project").with_value("projectId", input.project_id));
            error
        })?;

        let requested_agent_type = input.agent_type.unwrap_or(AgentType::Codex);

        // 查找 agent profile：先看有没有指定 id，否则按 agent 类型找第一个可用的 profile。
        let (agent_profile_id, agent_type, command_snapshot) = if let Some(profile_id) =
            input.agent_profile_id
        {
            let profile = self
                .agent_profile_repository
                .find_profile_by_id(profile_id)
                .map_err(agent_session_database_error)?
                .ok_or_else(|| {
                    CommandError::new(
                        CommandErrorCode::AgentProfileValidationFailed,
                        "Agent Profile 不存在。",
                    ).with_reason("profileNotFound")
                    .with_detail(
                        ErrorDetail::new("AgentProfile").with_value("agentProfileId", profile_id),
                    )
                })?;
            validate_profile_not_deleted(&profile)?;
            validate_profile_scope(&profile, input.project_id)?;
            (
                profile.id,
                profile.agent_type.clone(),
                build_structured_command_snapshot(&profile),
            )
        } else {
            // 没有指定 profile id，找第一个可用的 profile（先 project scope，后 global scope）。
            let project_profiles = self
                .agent_profile_repository
                .list_profiles_by_scope(&AgentScope::Project, Some(input.project_id))
                .map_err(agent_session_database_error)?;
            let global_profiles = self
                .agent_profile_repository
                .list_profiles_by_scope(&AgentScope::Global, None)
                .map_err(agent_session_database_error)?;

            let all_profiles: Vec<_> = project_profiles
                .into_iter()
                .chain(global_profiles.into_iter())
                .collect();

            if let Some(profile) = all_profiles
                .into_iter()
                .find(|profile| profile.agent_type == requested_agent_type)
            {
                (
                    profile.id,
                    profile.agent_type.clone(),
                    build_structured_command_snapshot(&profile),
                )
            } else {
                let requested_agent_type_literal = match requested_agent_type {
                    AgentType::Codex => "codex",
                    AgentType::Claude => "claude",
                };
                return Err(CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "未找到可用于当前 Agent 类型的 Agent Profile。",
                ).with_reason("noProfileForAgentType")
                .with_detail(
                    ErrorDetail::new("AgentType")
                        .with_value("agentType", requested_agent_type_literal),
                )
                .with_detail(
                    ErrorDetail::new("Project").with_value("projectId", input.project_id),
                ));
            }
        };

        let title = input
            .title
            .as_deref()
            .map(validate_session_title)
            .transpose()?;
        let started_at = current_epoch_millis()?;
        let pending_log_path =
            build_pending_structured_log_path(data_dir, input.project_id, started_at)?;

        // 落 session 行。
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(agent_session_database_error)?;
        let session = (|| {
            let session = insert_structured_session_in_transaction(
                &transaction,
                input.project_id,
                agent_profile_id,
                title.as_deref(),
                &cwd,
                &command_snapshot,
                &pending_log_path,
                started_at,
            )?;
            let log_path = build_standalone_runtime_structured_log_path(
                data_dir,
                input.project_id,
                session.number,
            )
            .map_err(command_error_to_sqlite)?;
            let session = AgentSessionRepository::update_log_path_in_transaction(
                &transaction,
                session.id,
                &log_path,
            )?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            let event_payload = json!({
                "sessionId": session.id,
                "projectId": input.project_id,
                "issueId": Value::Null,
                "title": title,
                "status": "running",
                "structuredStream": true,
                "logPath": log_path,
            })
            .to_string();
            EventRepository::insert_session_event_in_transaction(
                &transaction,
                session.id,
                SessionEventType::SessionStarted,
                &event_payload,
                started_at,
            )?;
            transaction.commit()?;
            Ok::<_, rusqlite::Error>(session)
        })()
        .map_err(agent_session_database_error)?;

        let session_id = session.id;
        // DB 已 commit（running），后续 handle 启动期间需防并发 reconcile 误判。
        // mark_starting 让 contains 返回 true；register 真实 handle 时自动清除，
        // 各失败路径需显式 unmark。
        agent_registry.mark_starting(session_id);

        let thread_id = self.finish_structured_standalone_provider_start(
            &DefaultAgentSessionProviderFactory,
            AgentSessionStartRequest {
                agent_type: agent_type.clone(),
                project_id: input.project_id,
                session_id,
                binary: command_snapshot.clone(),
                cwd: cwd.clone(),
                mode_id: input.mode.clone(),
                dangerous: false,
                model: match agent_type {
                    AgentType::Codex => input
                        .model
                        .clone()
                        .or_else(|| read_codex_model_from_data_dir(data_dir)),
                    AgentType::Claude => input.model.clone(),
                },
                effort: match agent_type {
                    AgentType::Codex => input
                        .effort
                        .clone()
                        .or_else(|| read_codex_reasoning_effort_from_data_dir(data_dir)),
                    AgentType::Claude => None,
                },
                resume_thread_id: input.resume_from_codex_session_id.clone(),
                broadcaster: broadcaster.clone(),
                config_home: user_home_from_data_dir(data_dir),
            },
            agent_registry,
            broadcaster,
            session_id,
        )?;

        Ok(StartStructuredAgentSessionResult {
            session_id,
            thread_id,
        })
    }

    /// DB commit 之后的 standalone 启动后半段（无 initial prompt）。
    fn finish_structured_standalone_provider_start(
        &self,
        factory: &dyn AgentSessionProviderFactory,
        request: AgentSessionStartRequest,
        agent_registry: &AgentSessionRegistry,
        broadcaster: &AgentEventBroadcaster,
        session_id: i64,
    ) -> Result<String, CommandError> {
        // 调用方已 mark_starting；失败路径 unmark + soft-delete session。
        let started = match start_provider_session(factory, request) {
            Ok(started) => started,
            Err(error) => {
                agent_registry.unmark_starting(session_id);
                let _ = self.rollback_failed_structured_standalone_session(session_id);
                return Err(error);
            }
        };
        if let Err(error) =
            persist_started_session_thread_id(&self.agent_session_repository, session_id, &started)
        {
            agent_registry.unmark_starting(session_id);
            started.handle.shutdown();
            let _ = self.rollback_failed_structured_standalone_session(session_id);
            return Err(error);
        }
        let thread_id = started.thread_id.clone().unwrap_or_default();
        broadcaster.register_session(session_id);
        agent_registry.register(session_id, started.handle);
        Ok(thread_id)
    }

    fn rollback_failed_structured_standalone_session(
        &self,
        session_id: i64,
    ) -> Result<(), CommandError> {
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(agent_session_database_error)?;
        AgentSessionRepository::soft_delete_in_transaction(
            &transaction,
            session_id,
            current_epoch_millis()?,
        )
        .map_err(agent_session_database_error)?;
        transaction.commit().map_err(agent_session_database_error)?;
        Ok(())
    }

    fn previous_issue_archive_log_path(
        &self,
        data_dir: &Path,
        issue_id: i64,
    ) -> Result<Option<String>, CommandError> {
        let previous_session = self
            .agent_session_repository
            .find_latest_session_by_issue_id(issue_id)
            .map_err(agent_session_database_error)?;
        Ok(previous_session
            .filter(|session| is_archived_issue_log_path(data_dir, &session.log_path))
            .map(|session| session.log_path))
    }

    pub fn resume_structured_agent_session_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: ResumeStructuredAgentSessionInput,
        agent_registry: &AgentSessionRegistry,
        broadcaster: &AgentEventBroadcaster,
    ) -> Result<ResumeStructuredAgentSessionResult, CommandError> {
        let database = DatabaseConfig::new(&data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(agent_session_database_error)?;

        let service = AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        );
        service.resume_structured_agent_session(
            data_dir.as_ref(),
            input,
            agent_registry,
            broadcaster,
        )
    }

    pub fn resume_structured_agent_session(
        &self,
        _data_dir: &Path,
        input: ResumeStructuredAgentSessionInput,
        agent_registry: &AgentSessionRegistry,
        broadcaster: &AgentEventBroadcaster,
    ) -> Result<ResumeStructuredAgentSessionResult, CommandError> {
        let session = self.find_project_session(input.project_id, input.session_id)?;

        if let Some(issue_id) = session.issue_id {
            let issue = self
                .issue_repository
                .find_by_id(issue_id)
                .map_err(agent_session_database_error)?
                .ok_or_else(|| {
                    CommandError::new(CommandErrorCode::IssueNotFound, "Issue 不存在。").with_reason("issueNotFound")
                        .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue_id))
                })?;
            if issue.status == IssueStatus::Completed {
                return Err(CommandError::new(
                    CommandErrorCode::AgentSessionValidationFailed,
                    "已完成 Issue 的 Session 不能继续运行。",
                ).with_reason("completedIssueSessionCannotRun")
                .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue_id))
                .with_detail(
                    ErrorDetail::new("AgentSession").with_value("sessionId", session.id),
                ));
            }
        }

        let thread_id = session
            .codex_session_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentSessionValidationFailed,
                    "当前 Session 缺少可续接的会话标识。",
                ).with_reason("missingResumeSessionId")
                .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id))
            })?;

        if let Some(handle) = agent_registry.get(session.id) {
            let active_thread_id = handle.thread_id().unwrap_or_else(|| thread_id.clone());
            self.mark_structured_session_resumed(&session, &active_thread_id)?;
            return Ok(ResumeStructuredAgentSessionResult {
                session_id: session.id,
                thread_id: active_thread_id,
            });
        }

        let binary = if session.command_snapshot.trim().is_empty() {
            ensure_codex_bypass_arg("codex")
        } else {
            session.command_snapshot.clone()
        };
        let cwd = self.resolve_session_cwd_for_resume(&session)?;

        // 通过 profile 判定 agent 类型，构造走 provider factory。
        let profile = self
            .agent_profile_repository
            .find_profile_by_id(session.agent_profile_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "Agent Profile 不存在。",
                ).with_reason("profileNotFound")
                .with_detail(
                    ErrorDetail::new("AgentProfile")
                        .with_value("agentProfileId", session.agent_profile_id),
                )
            })?;
        agent_registry.mark_starting(session.id);
        let started = match start_provider_session(
            &DefaultAgentSessionProviderFactory,
            AgentSessionStartRequest {
                agent_type: profile.agent_type.clone(),
                project_id: input.project_id,
                session_id: session.id,
                binary,
                cwd,
                mode_id: None,
                dangerous: false,
                model: match profile.agent_type {
                    AgentType::Codex => read_codex_model_from_data_dir(_data_dir),
                    AgentType::Claude => None,
                },
                effort: match profile.agent_type {
                    AgentType::Codex => read_codex_reasoning_effort_from_data_dir(_data_dir),
                    AgentType::Claude => None,
                },
                resume_thread_id: Some(thread_id.clone()),
                broadcaster: broadcaster.clone(),
                config_home: user_home_from_data_dir(_data_dir),
            },
        ) {
            Ok(started) => started,
            Err(error) => {
                agent_registry.unmark_starting(session.id);
                return Err(error);
            }
        };
        let resumed_thread_id = started
            .thread_id
            .clone()
            .unwrap_or_else(|| thread_id.clone());
        if started.backfill == ThreadIdBackfill::Required && started.thread_id.is_none() {
            agent_registry.unmark_starting(session.id);
            started.handle.shutdown();
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionStreamFailed,
                "Agent 会话启动后未拿到 threadId。",
            )
            .with_detail(
                ErrorDetail::new("AgentSession").with_value("sessionId", session.id),
            ));
        }
        if let Err(error) = self.mark_structured_session_resumed(&session, &resumed_thread_id) {
            agent_registry.unmark_starting(session.id);
            started.handle.shutdown();
            return Err(error);
        }
        broadcaster.register_session(session.id);
        agent_registry.register(session.id, started.handle);

        Ok(ResumeStructuredAgentSessionResult {
            session_id: session.id,
            thread_id: resumed_thread_id,
        })
    }

    pub fn resolve_session_cwd_for_model_list(
        &self,
        session: &crate::types::agent_session::AgentSessionRecord,
    ) -> Result<String, CommandError> {
        let cwd = preferred_session_cwd(session);
        if Path::new(&cwd).is_dir() {
            return Ok(cwd);
        }

        let project = self.find_project_summary(session.project_id)?;
        if Path::new(&project.repo_path).is_dir() {
            return Ok(project.repo_path);
        }

        Err(missing_session_workspace_error(
            session,
            &cwd,
            "Agent Session 工作区不存在，模型列表不可用。",
        ).with_reason("workspaceMissingForModelList"))
    }

    fn resolve_session_cwd_for_resume(
        &self,
        session: &crate::types::agent_session::AgentSessionRecord,
    ) -> Result<String, CommandError> {
        let cwd = preferred_session_cwd(session);
        if Path::new(&cwd).is_dir() {
            return Ok(cwd);
        }

        let project = self.find_project_summary(session.project_id)?;
        if should_restore_redwhisk_worktree(session) {
            let workspace_path = session.workspace_path.as_deref().unwrap_or(&cwd);
            let workspace_branch = session.workspace_branch.as_deref().unwrap_or_default();
            restore_worktree_for_branch(&project.repo_path, workspace_path, workspace_branch)
                .map_err(agent_session_start_error)?;
            run_worktree_setup_command(workspace_path, session.worktree_setup_command.as_deref())?;
            if Path::new(workspace_path).is_dir() {
                return Ok(workspace_path.to_string());
            }
        }

        Err(missing_session_workspace_error(
            session,
            &cwd,
            "Agent Session 工作区不存在，无法恢复。",
        ).with_reason("workspaceMissingForResume"))
    }

    fn find_project_summary(
        &self,
        project_id: i64,
    ) -> Result<crate::types::project::ProjectSummary, CommandError> {
        self.project_repository
            .find_by_id(project_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            })
    }

    fn mark_structured_session_resumed(
        &self,
        session: &crate::types::agent_session::AgentSessionRecord,
        thread_id: &str,
    ) -> Result<(), CommandError> {
        let resumed_at = current_epoch_millis()?;
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(agent_session_database_error)?;
        let updated_session = AgentSessionRepository::mark_running_in_transaction(
            &transaction,
            session.id,
            resumed_at,
        )
        .map_err(agent_session_database_error)?;

        if updated_session.is_none() {
            transaction.commit().map_err(agent_session_database_error)?;
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 恢复失败。",
            ).with_reason("restoreFailed")
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id)));
        }

        let payload = json!({
            "sessionId": session.id,
            "issueId": session.issue_id,
            "status": "running",
            "resumed": true,
            "structuredStream": true,
            "codexSessionId": thread_id,
            "logPath": session.log_path,
        })
        .to_string();
        EventRepository::insert_session_event_in_transaction(
            &transaction,
            session.id,
            SessionEventType::SessionStarted,
            &payload,
            resumed_at,
        )
        .map_err(agent_session_database_error)?;
        transaction.commit().map_err(agent_session_database_error)?;
        Ok(())
    }

    pub fn list_agent_sessions_in_data_dir(
        data_dir: impl AsRef<Path>,
        project_id: i64,
        pty_sessions: &PtySessionManager,
        agent_registry: &AgentSessionRegistry,
    ) -> Result<AgentSessionRuntimeListResult, CommandError> {
        let database = DatabaseConfig::new(data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(agent_session_database_error)?;

        let service = AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        );
        service.reconcile_unrecoverable_running_sessions(
            project_id,
            pty_sessions,
            agent_registry,
        )?;

        let response = AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        )
        .list_agent_sessions(project_id)?;
        let pruned_runtime_session_ids = AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        )
        .runtime_session_ids_to_cleanup(project_id, &agent_registry.session_ids())?;

        Ok(AgentSessionRuntimeListResult {
            response,
            pruned_runtime_session_ids,
        })
    }

    pub fn list_monitored_agent_sessions_in_data_dir(
        data_dir: impl AsRef<Path>,
        pty_sessions: &PtySessionManager,
        agent_registry: &AgentSessionRegistry,
    ) -> Result<AgentSessionListResponse, CommandError> {
        let database = DatabaseConfig::new(data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(agent_session_database_error)?;

        let service = AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        );
        let projects = service
            .project_repository
            .list_recent()
            .map_err(agent_session_database_error)?;
        let mut sessions = Vec::new();

        for project in projects {
            service.reconcile_unrecoverable_running_sessions(
                project.id,
                pty_sessions,
                agent_registry,
            )?;
            sessions.extend(service.list_agent_sessions(project.id)?.sessions);
        }

        sessions.sort_by(|left, right| {
            right
                .last_active_at
                .cmp(&left.last_active_at)
                .then_with(|| right.session_id.cmp(&left.session_id))
        });

        Ok(AgentSessionListResponse { sessions })
    }

    pub fn get_project_git_branches_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: ProjectGitBranchListInput,
    ) -> Result<ProjectGitBranchListResult, CommandError> {
        let database = DatabaseConfig::new(data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(agent_session_database_error)?;

        AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        )
        .get_project_git_branches(input)
    }

    pub fn complete_issue_manual_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: CompleteIssueManualInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<IssueRecord, CommandError> {
        let completed_issue = IssueService::complete_issue_manual_in_data_dir(&data_dir, input)?;

        if let Some(session_id) = completed_issue.linked_session_id {
            if pty_sessions.contains(session_id) {
                if let Err(error) = pty_sessions.kill(session_id) {
                    if error != "session not found" {
                        return Err(CommandError::new(
                            CommandErrorCode::AgentSessionPersistenceFailed,
                            "Agent Session 关闭失败。",
                        ).with_reason("closeFailed")
                        .with_detail(
                            ErrorDetail::new("AgentSession").with_value("sessionId", session_id),
                        )
                        .with_detail(ErrorDetail::new("Cause").with_value("message", error)));
                    }
                }
            }
        }

        Ok(completed_issue)
    }

    pub fn complete_issue_clean_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: CompleteIssueCleanInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<IssueRecord, CommandError> {
        let completed_issue = IssueService::complete_issue_clean_in_data_dir(&data_dir, input)?;

        if let Some(session_id) = completed_issue.linked_session_id {
            if pty_sessions.contains(session_id) {
                if let Err(error) = pty_sessions.kill(session_id) {
                    if error != "session not found" {
                        return Err(CommandError::new(
                            CommandErrorCode::AgentSessionPersistenceFailed,
                            "Agent Session 关闭失败。",
                        ).with_reason("closeFailed")
                        .with_detail(
                            ErrorDetail::new("AgentSession").with_value("sessionId", session_id),
                        )
                        .with_detail(ErrorDetail::new("Cause").with_value("message", error)));
                    }
                }
            }
        }

        Ok(completed_issue)
    }

    pub fn set_session_attention_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: SetAgentSessionAttentionInput,
    ) -> Result<SetAgentSessionAttentionResult, CommandError> {
        let database = DatabaseConfig::new(data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(agent_session_database_error)?;

        AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        )
        .set_session_attention(input)
    }

    pub fn inject_session_prompt_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: InjectAgentSessionPromptInput,
        pty_sessions: &PtySessionManager,
        agent_registry: &AgentSessionRegistry,
    ) -> Result<InjectAgentSessionPromptResult, CommandError> {
        let database = DatabaseConfig::new(&data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(agent_session_database_error)?;

        let service = AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        );

        let verified_session = service.find_project_session(input.project_id, input.session_id)?;
        let refreshed_codex_session_id = if verified_session.codex_session_id.is_some() {
            verified_session.codex_session_id
        } else {
            refresh_codex_session_id_in_data_dir(
                data_dir.as_ref(),
                verified_session.id,
                &verified_session.working_dir,
                verified_session.started_at,
            )
        };

        let mut result = service.inject_session_prompt(input, pty_sessions, agent_registry)?;
        if refreshed_codex_session_id.is_some() {
            result.codex_session_id = refreshed_codex_session_id;
        }
        Ok(result)
    }

    pub fn record_session_termination_in_data_dir(
        data_dir: impl AsRef<Path>,
        session_id: i64,
        exit_status: PtyExitStatus,
    ) -> Result<(), CommandError> {
        let database = DatabaseConfig::new(data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(agent_session_database_error)?;

        let session_repository = AgentSessionRepository::new(&database.connection);
        let session = session_repository
            .find_by_id(session_id)
            .map_err(agent_session_database_error)?;
        let Some(session) = session else {
            return Ok(());
        };

        if session.closed_at.is_some() {
            return Ok(());
        }

        let terminated_at = current_epoch_millis()?;
        let termination_status = if exit_status.exit_code == Some(0) {
            AgentSessionStatus::Closed
        } else {
            AgentSessionStatus::Crashed
        };
        let reason = termination_reason(exit_status.exit_code);
        let status_literal = termination_status_literal(&termination_status);

        let transaction = database
            .connection
            .unchecked_transaction()
            .map_err(agent_session_database_error)?;

        let updated_session = AgentSessionRepository::mark_terminated_in_transaction(
            &transaction,
            session_id,
            termination_status.clone(),
            terminated_at,
        )
        .map_err(agent_session_database_error)?;

        if updated_session.is_none() {
            transaction.commit().map_err(agent_session_database_error)?;
            return Ok(());
        }

        let payload = json!({
            "sessionId": session.id,
            "issueId": session.issue_id,
            "status": status_literal,
            "exitCode": exit_status.exit_code,
            "reason": reason,
            "logPath": session.log_path,
        })
        .to_string();
        EventRepository::insert_session_event_in_transaction(
            &transaction,
            session.id,
            SessionEventType::SessionExited,
            &payload,
            terminated_at,
        )
        .map_err(agent_session_database_error)?;

        transaction.commit().map_err(agent_session_database_error)?;
        Ok(())
    }

    pub fn reconcile_unrecoverable_running_sessions_in_data_dir(
        data_dir: impl AsRef<Path>,
        project_id: i64,
        pty_sessions: &PtySessionManager,
        agent_registry: &AgentSessionRegistry,
    ) -> Result<(), CommandError> {
        let database = DatabaseConfig::new(data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(agent_session_database_error)?;

        AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        )
        .reconcile_unrecoverable_running_sessions(project_id, pty_sessions, agent_registry)
    }

    fn mark_session_stopped_after_restart(
        &self,
        session: &crate::types::agent_session::AgentSessionRecord,
    ) -> Result<(), CommandError> {
        let terminated_at = current_epoch_millis()?;
        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(agent_session_database_error)?;

        let updated_session = AgentSessionRepository::mark_terminated_in_transaction(
            &transaction,
            session.id,
            AgentSessionStatus::Stopped,
            terminated_at,
        )
        .map_err(agent_session_database_error)?;

        if updated_session.is_none() {
            transaction.commit().map_err(agent_session_database_error)?;
            return Ok(());
        }

        let payload = json!({
            "sessionId": session.id,
            "issueId": session.issue_id,
            "status": "stopped",
            "exitCode": Value::Null,
            "reason": "app_restarted_no_active_pty",
            "logPath": session.log_path,
        })
        .to_string();
        EventRepository::insert_session_event_in_transaction(
            &transaction,
            session.id,
            SessionEventType::SessionExited,
            &payload,
            terminated_at,
        )
        .map_err(agent_session_database_error)?;

        transaction.commit().map_err(agent_session_database_error)?;
        Ok(())
    }
}

fn session_log_has_new_output(log_path: &str, last_active_at: i64) -> bool {
    let Ok(metadata) = fs::metadata(log_path) else {
        return false;
    };
    let Ok(modified_at) = metadata.modified() else {
        return false;
    };
    let Ok(duration) = modified_at.duration_since(UNIX_EPOCH) else {
        return false;
    };

    let modified_ms = i64::try_from(duration.as_millis()).unwrap_or(i64::MAX);
    modified_ms > last_active_at
}

fn snapshot_ends_with_codex_input_prompt(snapshot: &str) -> bool {
    last_non_empty_terminal_line(snapshot)
        .map(|line| {
            let trimmed = line.trim_start();
            trimmed == "›" || trimmed.starts_with("› ")
        })
        .unwrap_or(false)
}

fn last_non_empty_terminal_line(snapshot: &str) -> Option<String> {
    let normalized = strip_terminal_control_sequences(snapshot);
    normalized
        .replace('\r', "\n")
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn strip_terminal_control_sequences(snapshot: &str) -> String {
    let mut cleaned = String::with_capacity(snapshot.len());
    let mut chars = snapshot.chars().peekable();

    while let Some(character) = chars.next() {
        if character == '\u{1b}' {
            if matches!(chars.peek(), Some('[')) {
                let _ = chars.next();
                for next in chars.by_ref() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
            }
            continue;
        }

        if character.is_control() && !matches!(character, '\n' | '\r' | '\t') {
            continue;
        }

        cleaned.push(character);
    }

    cleaned
}

/// 把 `AgentSessionError` 转成 `CommandError`。
///
/// agent 进程未运行 → `AgentSessionNotRunning`；协议层错误 / 不支持的
/// 模式 / 其他 → `AgentSessionStreamFailed`。各 provider 的内部错误
/// 经 `From` 归一化到 `AgentSessionError` 后统一走本函数。
pub(crate) fn agent_session_error_to_command_error(error: AgentSessionError) -> CommandError {
    let message = error.to_string();
    let code = match &error {
        AgentSessionError::NotRunning(_) => CommandErrorCode::AgentSessionNotRunning,
        AgentSessionError::Protocol(_)
        | AgentSessionError::UnsupportedMode(_)
        | AgentSessionError::Other(_) => CommandErrorCode::AgentSessionStreamFailed,
    };
    let mut command_error = CommandError::new(code, "Agent 会话调用失败。")
        .with_detail(ErrorDetail::new("Cause").with_value("message", message));
    if matches!(error, AgentSessionError::NotRunning(_)) {
        command_error = command_error.with_reason("sessionNotRunning");
    }
    command_error
}

/// 在事务中插入一条结构化 session 行。
///
/// 与 `insert_standalone_in_transaction` 不同：PTY 专用字段填占位空串以满足 NOT NULL
/// 约束，`codex_session_id` 留空待 handle.start 后回填。
fn insert_structured_session_in_transaction(
    transaction: &Transaction<'_>,
    project_id: i64,
    agent_profile_id: i64,
    title: Option<&str>,
    working_dir: &str,
    command_snapshot: &str,
    log_path: &str,
    started_at: i64,
) -> rusqlite::Result<crate::types::agent_session::AgentSessionRecord> {
    let number: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(number), 0) + 1 FROM agent_sessions WHERE project_id = ?1",
        params![project_id],
        |row| row.get(0),
    )?;
    transaction.execute(
        "INSERT INTO agent_sessions (
           project_id,
           number,
           issue_id,
           title,
           agent_profile_id,
           status,
           attention,
           working_dir,
           command_snapshot,
           prompt_snapshot,
           workspace_mode,
           target_branch,
           workspace_branch,
           workspace_path,
           worktree_root_path,
           log_path,
           list_inserted_at,
           last_active_at,
           started_at
         ) VALUES (?1, ?2, NULL, ?3, ?4, 'running', 'none', ?5, ?6, '', 'current_branch', NULL, NULL, ?5, NULL, ?7, ?8, ?8, ?8)",
        params![
            project_id,
            number,
            title,
            agent_profile_id,
            working_dir,
            command_snapshot,
            log_path,
            started_at
        ],
    )?;

    let id = transaction.last_insert_rowid();
    AgentSessionRepository::find_by_id_in_transaction(transaction, id)?
        .ok_or(rusqlite::Error::QueryReturnedNoRows)
}

pub(super) fn resolve_target_branch(
    branch_info: &GitBranchInfo,
    target_branch: Option<&str>,
) -> Result<String, CommandError> {
    let target_branch = target_branch
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(branch_info.current_branch.as_str());

    if branch_info
        .local_branches
        .iter()
        .any(|branch| branch == target_branch)
    {
        return Ok(target_branch.to_string());
    }

    Err(CommandError::new(
        CommandErrorCode::AgentSessionValidationFailed,
        "目标分支不存在。",
    ).with_reason("targetBranchNotFound")
    .with_detail(ErrorDetail::new("GitBranch").with_value("targetBranch", target_branch)))
}

pub(super) fn resolve_worktree_root_path(project: &ProjectSummary) -> Result<String, CommandError> {
    let repo_path = Path::new(&project.repo_path);
    let repo_name = repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Project 路径无效。",
            ).with_reason("projectPathInvalid")
        })?;

    let path = match project.worktree_location {
        ProjectWorktreeLocation::RepoSibling => repo_path
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(format!("{repo_name}.worktrees")),
        ProjectWorktreeLocation::RepoInternal => repo_path.join(".worktrees"),
        ProjectWorktreeLocation::UserHome => {
            let home_dir = std::env::var("HOME").map_err(|_| {
                CommandError::new(
                    CommandErrorCode::AgentSessionValidationFailed,
                    "无法解析用户 Home 目录。",
                ).with_reason("homeDirUnresolved")
            })?;
            Path::new(&home_dir)
                .join(".redwhisk")
                .join("worktrees")
                .join(repo_name)
        }
    };

    Ok(path.to_string_lossy().to_string())
}

fn command_error_to_sqlite(error: CommandError) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(error.message)))
}

fn spawn_agent_process(
    profile: &AgentProfileRow,
    working_dir: &str,
    log_path: &str,
    initial_prompt: Option<&str>,
) -> Result<Child, CommandError> {
    let log_file = File::create(log_path).map_err(agent_session_start_error)?;
    let stderr_file = log_file.try_clone().map_err(agent_session_start_error)?;
    let command_line = agent_command_with_default_args(profile);
    let (program, args) = split_agent_command_line(&command_line)?;

    let mut command = Command::new(program);
    command.args(args);
    command.current_dir(working_dir);
    command.stdout(Stdio::from(log_file));
    command.stderr(Stdio::from(stderr_file));
    if let Some(prompt) = initial_prompt {
        command.arg(prompt);
    }
    command.spawn().map_err(agent_session_start_error)
}

fn split_agent_command_line(command: &str) -> Result<(&str, Vec<&str>), CommandError> {
    let mut parts = command.split_whitespace();
    let program = parts.next().ok_or_else(|| {
        CommandError::new(
            CommandErrorCode::AgentSessionStartFailed,
            "Agent command 不能为空。",
        ).with_reason("commandRequired")
        .with_detail(ErrorDetail::new("Command").with_value("command", command))
    })?;
    Ok((program, parts.collect()))
}

fn ensure_process_started(child: &mut Child, command: &str) -> Result<(), CommandError> {
    let iterations = STARTUP_CHECK_TOTAL_MS / STARTUP_CHECK_INTERVAL_MS;

    for _ in 0..iterations {
        if let Some(status) = child.try_wait().map_err(agent_session_start_error)? {
            let mut error = CommandError::new(
                CommandErrorCode::AgentSessionStartFailed,
                "Agent 进程启动失败。",
            ).with_reason("processStartFailed")
            .with_detail(ErrorDetail::new("Command").with_value("command", command));

            if let Some(code) = status.code() {
                error = error.with_detail(ErrorDetail::new("ExitStatus").with_value("code", code));
            }

            return Err(error);
        }

        thread::sleep(Duration::from_millis(STARTUP_CHECK_INTERVAL_MS));
    }

    Ok(())
}

pub(super) fn current_epoch_millis() -> Result<i64, CommandError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(agent_session_start_error)?;
    Ok(duration.as_millis() as i64)
}

fn turn_still_running_by_grace(turn_ended_at: Option<i64>, now: i64) -> bool {
    match turn_ended_at {
        None => true,
        Some(ended) => now - ended < TURN_GRACE_MS,
    }
}

pub(super) fn agent_session_database_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionPersistenceFailed,
        "Agent Session 启动失败。",
    ).with_reason("startFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn agent_session_transaction_error_for_issue(
    connection: &rusqlite::Connection,
    error: rusqlite::Error,
    issue_id: i64,
) -> CommandError {
    if let rusqlite::Error::SqliteFailure(_, Some(message)) = &error {
        if message.contains("UNIQUE constraint failed: agent_sessions.issue_id") {
            let mut command_error = CommandError::new(
                CommandErrorCode::AgentSessionAlreadyExists,
                "当前 Issue 已存在关联 Agent Session。",
            )
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue_id))
            .with_detail(ErrorDetail::new("Cause").with_value("message", message.clone()));

            if let Ok(Some(existing_session)) =
                AgentSessionRepository::new(connection).find_by_issue_id(issue_id)
            {
                command_error = command_error.with_detail(
                    ErrorDetail::new("AgentSession")
                        .with_value("sessionId", existing_session.id)
                        .with_value(
                            "status",
                            format!("{:?}", existing_session.status).to_lowercase(),
                        ),
                );
            }

            return command_error;
        }
    }

    agent_session_database_error(error)
}

pub(super) fn agent_session_start_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionStartFailed,
        "Agent 进程启动失败。",
    ).with_reason("processStartFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

/// worktree 创建失败（如分支已检出、路径冲突等 git 错误）的专属错误。
/// 与进程启动失败区分，避免把 git 错误误标成「Agent 进程启动失败。」。
pub(super) fn worktree_create_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionStartFailed,
        "Agent Session 工作区创建失败。",
    ).with_reason("worktreeCreateFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn inactive_terminal_error(error: String) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionValidationFailed,
        "当前 Session 没有活跃终端。",
    ).with_reason("noActiveTerminal")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error))
}

fn termination_reason(exit_code: Option<i32>) -> &'static str {
    match exit_code {
        Some(0) => "process_exited",
        Some(_) => "non_zero_exit_code",
        None => "missing_exit_code",
    }
}

fn termination_status_literal(status: &AgentSessionStatus) -> &'static str {
    match status {
        AgentSessionStatus::Running => "running",
        AgentSessionStatus::Closed => "closed",
        AgentSessionStatus::Crashed => "crashed",
        AgentSessionStatus::Stopped => "stopped",
    }
}

fn prompt_kind_literal(kind: &AgentSessionPromptKind) -> &'static str {
    match kind {
        AgentSessionPromptKind::FollowUp => "follow_up",
        AgentSessionPromptKind::Completion => "completion",
    }
}

fn attention_literal(attention: &AgentSessionAttention) -> &'static str {
    match attention {
        AgentSessionAttention::None => "none",
        AgentSessionAttention::Requested => "requested",
    }
}

fn normalize_submitted_prompt(prompt: &str) -> String {
    if prompt.ends_with('\n') || prompt.ends_with('\r') {
        return prompt.to_string();
    }

    format!("{prompt}\r")
}

fn should_attempt_codex_session_capture(command: &str) -> bool {
    let Some(program) = command.split_whitespace().next() else {
        return false;
    };

    Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("codex"))
        .unwrap_or(false)
}

fn command_supports_prompt_argument(command: &str) -> bool {
    should_attempt_codex_session_capture(command)
}

fn refresh_codex_session_id_in_data_dir(
    data_dir: &Path,
    session_id: i64,
    working_dir: &str,
    started_at: i64,
) -> Option<String> {
    let codex_home = resolve_codex_home()?;
    let detected = detect_codex_session_id_from_home(
        &codex_home,
        working_dir,
        started_at,
        CODEX_SESSION_CAPTURE_TOTAL_MS,
        CODEX_SESSION_CAPTURE_INTERVAL_MS,
    )?;

    let database = DatabaseConfig::new(data_dir).open().ok()?;
    MigrationRunner::default().run(&database.connection).ok()?;
    let repository = AgentSessionRepository::new(&database.connection);
    let session = repository
        .update_codex_session_id(session_id, &detected)
        .ok()??;
    session.codex_session_id
}

fn resolve_codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))
}

fn detect_codex_session_id_from_home(
    codex_home: &Path,
    working_dir: &str,
    started_at: i64,
    total_ms: u64,
    interval_ms: u64,
) -> Option<String> {
    let attempts = std::cmp::max(1, total_ms / interval_ms);

    for attempt in 0..attempts {
        if let Some(session_id) = detect_codex_session_id_once(codex_home, working_dir, started_at)
        {
            return Some(session_id);
        }

        if attempt + 1 < attempts {
            thread::sleep(Duration::from_millis(interval_ms));
        }
    }

    None
}

fn detect_codex_session_id_once(
    codex_home: &Path,
    working_dir: &str,
    started_at: i64,
) -> Option<String> {
    let session_index = codex_home.join("session_index.jsonl");
    let lines = fs::read_to_string(session_index).ok()?;
    let session_roots = collect_session_roots(codex_home);

    for line in lines.lines().rev().take(20) {
        let Some(session_id) = serde_json::from_str::<Value>(line).ok().and_then(|value| {
            value
                .get("id")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        }) else {
            continue;
        };

        let Some(session_file) = find_session_file_by_id(&session_roots, &session_id) else {
            continue;
        };
        if !is_recent_enough(&session_file, started_at) {
            continue;
        }

        if session_file_matches_working_dir(&session_file, &session_id, working_dir) {
            return Some(session_id);
        }
    }

    None
}

fn collect_session_roots(codex_home: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let top_level_sessions = codex_home.join("sessions");
    if top_level_sessions.is_dir() {
        roots.push(top_level_sessions);
    }

    let profiles_dir = codex_home.join("profiles");
    if let Ok(entries) = fs::read_dir(profiles_dir) {
        for entry in entries.flatten() {
            let sessions_dir = entry.path().join("sessions");
            if sessions_dir.is_dir() {
                roots.push(sessions_dir);
            }
        }
    }

    roots
}

fn find_session_file_by_id(roots: &[PathBuf], session_id: &str) -> Option<PathBuf> {
    for root in roots {
        if let Some(path) = find_session_file_in_dir(root, session_id) {
            return Some(path);
        }
    }

    None
}

fn find_session_file_in_dir(root: &Path, session_id: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_session_file_in_dir(&path, session_id) {
                return Some(found);
            }
            continue;
        }

        let file_name = path.file_name()?.to_str()?;
        if file_name.contains(session_id) {
            return Some(path);
        }
    }

    None
}

fn is_recent_enough(path: &Path, started_at: i64) -> bool {
    let modified_at = fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64);

    modified_at
        .map(|modified_at| modified_at >= started_at.saturating_sub(60_000))
        .unwrap_or(false)
}

fn session_file_matches_working_dir(path: &Path, session_id: &str, working_dir: &str) -> bool {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut reader = BufReader::new(file);
    let mut first_line = String::new();
    if reader.read_line(&mut first_line).is_err() {
        return false;
    }

    let payload = match serde_json::from_str::<Value>(&first_line) {
        Ok(payload) => payload,
        Err(_) => return false,
    };

    payload
        .get("payload")
        .and_then(|payload| payload.as_object())
        .map(|payload| {
            payload.get("id").and_then(|value| value.as_str()) == Some(session_id)
                && payload.get("cwd").and_then(|value| value.as_str()) == Some(working_dir)
        })
        .unwrap_or(false)
}

fn preferred_session_cwd(session: &crate::types::agent_session::AgentSessionRecord) -> String {
    session
        .workspace_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(session.working_dir.as_str())
        .to_string()
}

fn should_restore_redwhisk_worktree(
    session: &crate::types::agent_session::AgentSessionRecord,
) -> bool {
    session.workspace_mode == WorkspaceMode::Worktree
        && session.worktree_owner == WorktreeOwner::Redwhisk
        && session
            .workspace_path
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && session
            .workspace_branch
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
}

fn missing_session_workspace_error(
    session: &crate::types::agent_session::AgentSessionRecord,
    cwd: &str,
    message: &'static str,
) -> CommandError {
    let mut error = CommandError::new(CommandErrorCode::AgentSessionValidationFailed, message)
        .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id))
        .with_detail(ErrorDetail::new("WorkingDir").with_value("path", cwd.to_string()));
    if let Some(workspace_branch) = session.workspace_branch.as_deref() {
        error = error.with_detail(
            ErrorDetail::new("GitBranch").with_value("branch", workspace_branch.to_string()),
        );
    }
    error
}

#[cfg(test)]
mod tests {
    use super::{
        command_supports_prompt_argument, detect_codex_session_id_from_home,
        normalize_submitted_prompt, preferred_session_cwd, should_restore_redwhisk_worktree,
        AgentSessionService,
    };
    use crate::features::agent_session::command_snapshot::{
        agent_command_with_default_args, build_structured_command_snapshot,
    };
    use crate::features::agent_session::log_path::{
        build_issue_archive_log_path, build_issue_runtime_structured_log_path,
        build_issue_session_archive,
    };
    use crate::features::agent_session::timeline::{
        latest_output_from_session_log, read_timeline_from_session_log,
    };
    use crate::agent::provider_factory::{resolve_codex_mode, PlannedCodexMode};
    use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
    use crate::db::agent_profile_repository::AgentProfileRepository;
    use crate::db::agent_session_repository::AgentSessionRepository;
    use crate::db::event_repository::EventRepository;
    use crate::db::issue_repository::IssueRepository;
    use crate::db::migrations::MigrationRunner;
    use crate::db::project_repository::ProjectRepository;
    use crate::types::agent_profile::{AgentScope, AgentType};
    use crate::types::agent_session::{
        AgentMessageAttachment, AgentPermissionDecision, AgentSessionAttention, AgentSessionRecord,
        AgentSessionStatus, StartAgentSessionInput, UpdateAgentSessionTitleInput, WorkspaceMode,
        WorktreeOwner,
    };
    use crate::types::agent_session_stream::{
        AgentMode, AgentModel, AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem,
        ToolCallDetail, ToolCallStatus,
    };
    use crate::types::errors::CommandErrorCode;
    use crate::types::issue::{DeleteIssueWorktreeInput, GetIssueWorktreeStatusInput};
    use crate::types::session_event::SessionEventType;
    use rusqlite::{params, Connection};
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tempfile::tempdir;

    struct TimelineProtocolErrorHandle {
        message: String,
    }

    impl AgentSessionHandle for TimelineProtocolErrorHandle {
        fn send_message(
            &self,
            _text: String,
            _attachments: Vec<AgentMessageAttachment>,
        ) -> Result<(), AgentSessionError> {
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
            Err(AgentSessionError::Protocol(self.message.clone()))
        }

        fn shutdown(&self) {}

        fn thread_id(&self) -> Option<String> {
            Some("thread-test".to_string())
        }
    }

    #[test]
    fn normalize_submitted_prompt_appends_carriage_return_only_when_missing() {
        assert_eq!(normalize_submitted_prompt("hello"), "hello\r");
        assert_eq!(normalize_submitted_prompt("hello\n"), "hello\n");
        assert_eq!(normalize_submitted_prompt("hello\r"), "hello\r");
    }

    #[test]
    fn command_supports_prompt_argument_only_for_codex_binary() {
        assert!(command_supports_prompt_argument("/usr/local/bin/codex"));
        assert!(command_supports_prompt_argument("codex"));
        assert!(command_supports_prompt_argument(
            "codex --dangerously-bypass-approvals-and-sandbox"
        ));
        assert!(!command_supports_prompt_argument("/tmp/echo-stdin.sh"));
    }

    #[test]
    fn agent_command_with_default_args_adds_codex_bypass_flag() {
        let profile = test_agent_profile(AgentType::Codex, "codex");

        assert_eq!(
            agent_command_with_default_args(&profile),
            "codex --dangerously-bypass-approvals-and-sandbox"
        );
    }

    #[test]
    fn agent_command_with_default_args_keeps_existing_codex_bypass_flag() {
        let profile = test_agent_profile(
            AgentType::Codex,
            "codex --dangerously-bypass-approvals-and-sandbox",
        );

        assert_eq!(
            agent_command_with_default_args(&profile),
            "codex --dangerously-bypass-approvals-and-sandbox"
        );
    }

    #[test]
    fn structured_command_snapshot_keeps_codex_profile_command_unchanged() {
        let profile = test_agent_profile(AgentType::Codex, " codex-asxs ");

        assert_eq!(build_structured_command_snapshot(&profile), "codex-asxs");
    }

    #[test]
    fn agent_command_with_default_args_adds_claude_permission_mode() {
        let profile = test_agent_profile(AgentType::Claude, "claude");

        assert_eq!(
            agent_command_with_default_args(&profile),
            "claude --permission-mode bypassPermissions"
        );
    }

    #[test]
    fn codex_profile_default_mode_uses_full_access() {
        assert_eq!(
            resolve_codex_mode(Some("default"), false).expect("mode"),
            PlannedCodexMode::FullAccess
        );
    }

    #[test]
    fn codex_profile_empty_mode_uses_full_access() {
        assert_eq!(
            resolve_codex_mode(Some(""), false).expect("mode"),
            PlannedCodexMode::FullAccess
        );
    }

    #[test]
    fn structured_codex_session_defaults_to_full_access() {
        assert_eq!(
            resolve_codex_mode(None, false).expect("mode"),
            PlannedCodexMode::FullAccess
        );
    }

    #[test]
    fn agent_command_with_default_args_keeps_existing_claude_permission_mode() {
        let profile = test_agent_profile(AgentType::Claude, "claude --permission-mode auto");

        assert_eq!(
            agent_command_with_default_args(&profile),
            "claude --permission-mode auto"
        );
    }

    #[test]
    fn read_timeline_from_structured_log_replays_timeline_items() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let log_path = temp_dir.path().join("structured.jsonl");
        let assistant_event = AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 7,
            seq: 1,
            epoch: "epoch-test".to_string(),
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::AssistantMessage {
                    text: "历史回答".to_string(),
                    message_id: Some("msg-1".to_string()),
                },
                turn_id: None,
                seq: 0,
                timestamp: 1_700_000_000_000,
            },
        };
        let usage_event = AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 7,
            seq: 2,
            epoch: "epoch-test".to_string(),
            event: AgentStreamEvent::ThreadStarted {
                thread_id: "thread-1".to_string(),
            },
        };
        fs::write(
            &log_path,
            format!(
                "{}\n{}\n",
                serde_json::to_string(&assistant_event).expect("serialize assistant"),
                serde_json::to_string(&usage_event).expect("serialize thread")
            ),
        )
        .expect("write structured log");

        let session = test_session_record(log_path.to_string_lossy().as_ref());
        let history = read_timeline_from_session_log(&session).expect("read timeline");

        assert_eq!(
            history.items,
            vec![AgentTimelineItem::AssistantMessage {
                text: "历史回答".to_string(),
                message_id: Some("msg-1".to_string()),
            }]
        );
        assert_eq!(history.effort, None);
        assert_eq!(
            latest_output_from_session_log(log_path.to_string_lossy().as_ref()).as_deref(),
            Some("历史回答")
        );
    }

    #[test]
    fn structured_issue_log_paths_use_project_issue_session_segments() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let runtime_path = build_issue_runtime_structured_log_path(temp_dir.path(), 3, 16, 48)
            .expect("runtime path");
        let archive_path =
            build_issue_archive_log_path(temp_dir.path(), 3, 16, 48).expect("archive path");

        assert!(runtime_path
            .ends_with("session-logs/runtime/project-3/project-3-issue-16-session-48.jsonl"));
        assert!(archive_path
            .ends_with("session-logs/archive/project-3/archive-project-3-issue-16-session-48.log"));
    }

    #[test]
    fn build_issue_session_archive_filters_out_tool_calls_and_reasoning() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let runtime_log_path = temp_dir.path().join("runtime.jsonl");
        let events = [
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 30,
                seq: 1,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::UserMessage {
                        text: "请总结".to_string(),
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
                    item: AgentTimelineItem::Reasoning {
                        text: "分析中".to_string(),
                        duration_ms: Some(10),
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
                    item: AgentTimelineItem::ToolCall {
                        call_id: "call-1".to_string(),
                        name: "shell".to_string(),
                        detail: ToolCallDetail::Unknown {
                            raw_input: Some("ls".to_string()),
                            raw_output: Some("file.txt".to_string()),
                        },
                        status: ToolCallStatus::Completed,
                        error: None,
                    },
                    turn_id: None,
                    seq: 3,
                    timestamp: 3,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 30,
                seq: 4,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::AssistantMessage {
                        text: "已完成归纳".to_string(),
                        message_id: Some("a1".to_string()),
                    },
                    turn_id: None,
                    seq: 4,
                    timestamp: 4,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 30,
                seq: 5,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::Error {
                        message: "收尾失败".to_string(),
                    },
                    turn_id: None,
                    seq: 5,
                    timestamp: 5,
                },
            },
        ];
        let lines = events
            .iter()
            .map(|event| serde_json::to_string(event).expect("serialize event"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&runtime_log_path, format!("{lines}\n")).expect("write runtime log");

        let archive = build_issue_session_archive(
            temp_dir.path(),
            1,
            16,
            7,
            30,
            runtime_log_path.to_string_lossy().as_ref(),
        )
        .expect("build archive");

        assert_eq!(
            archive.runtime_path,
            runtime_log_path.to_string_lossy().to_string()
        );
        assert_eq!(archive.latest_output.as_deref(), Some("收尾失败"));

        let archived_lines = fs::read_to_string(&archive.archive_path).expect("read archive log");
        assert!(!archived_lines.contains("tool_call"));
        assert!(!archived_lines.contains("reasoning"));
        assert!(archived_lines.contains("user_message"));
        assert!(archived_lines.contains("assistant_message"));
        assert!(archived_lines.contains("error"));
    }

    #[test]
    fn read_timeline_from_structured_log_compacts_incremental_items() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let log_path = temp_dir.path().join("structured.jsonl");
        let events = [
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 1,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::AssistantMessage {
                        text: "你".to_string(),
                        message_id: Some("msg-1".to_string()),
                    },
                    turn_id: None,
                    seq: 0,
                    timestamp: 1,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 2,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::AssistantMessage {
                        text: "你好".to_string(),
                        message_id: Some("msg-1".to_string()),
                    },
                    turn_id: None,
                    seq: 0,
                    timestamp: 2,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 3,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::Reasoning {
                        text: "分析一步".to_string(),
                        duration_ms: None,
                    },
                    turn_id: None,
                    seq: 0,
                    timestamp: 3,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 4,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::Reasoning {
                        text: "分析完成".to_string(),
                        duration_ms: Some(4200),
                    },
                    turn_id: None,
                    seq: 0,
                    timestamp: 4,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 5,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::Reasoning {
                        text: "分析完成".to_string(),
                        duration_ms: None,
                    },
                    turn_id: None,
                    seq: 0,
                    timestamp: 5,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 6,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::ToolCall {
                        call_id: "call-1".to_string(),
                        name: "TodoWrite".to_string(),
                        detail: ToolCallDetail::Unknown {
                            raw_input: Some("{\"task\":\"优化浏览器 tab\"}".to_string()),
                            raw_output: None,
                        },
                        status: ToolCallStatus::Running,
                        error: None,
                    },
                    turn_id: None,
                    seq: 0,
                    timestamp: 6,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 7,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::ToolCall {
                        call_id: "call-1".to_string(),
                        name: "tool".to_string(),
                        detail: ToolCallDetail::Unknown {
                            raw_input: None,
                            raw_output: Some("Updated task #2 status".to_string()),
                        },
                        status: ToolCallStatus::Completed,
                        error: None,
                    },
                    turn_id: None,
                    seq: 0,
                    timestamp: 7,
                },
            },
        ];
        let lines = events
            .iter()
            .map(|event| serde_json::to_string(event).expect("serialize event"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&log_path, format!("{lines}\n")).expect("write structured log");

        let session = test_session_record(log_path.to_string_lossy().as_ref());
        let history = read_timeline_from_session_log(&session).expect("read timeline");

        assert_eq!(
            history.items,
            vec![
                AgentTimelineItem::AssistantMessage {
                    text: "你好".to_string(),
                    message_id: Some("msg-1".to_string()),
                },
                AgentTimelineItem::Reasoning {
                    text: "分析完成".to_string(),
                    duration_ms: Some(4200),
                },
                AgentTimelineItem::ToolCall {
                    call_id: "call-1".to_string(),
                    name: "TodoWrite".to_string(),
                    detail: ToolCallDetail::Unknown {
                        raw_input: Some("{\"task\":\"优化浏览器 tab\"}".to_string()),
                        raw_output: Some("Updated task #2 status".to_string()),
                    },
                    status: ToolCallStatus::Completed,
                    error: None,
                },
            ]
        );
    }

    #[test]
    fn read_timeline_from_structured_log_backfills_reasoning_duration_from_timestamps() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let log_path = temp_dir.path().join("structured-reasoning-duration.jsonl");
        let events = [
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 1,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::Reasoning {
                        text: "分析中".to_string(),
                        duration_ms: None,
                    },
                    turn_id: None,
                    seq: 0,
                    timestamp: 1_000,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 2,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::Reasoning {
                        text: "分析完成".to_string(),
                        duration_ms: None,
                    },
                    turn_id: None,
                    seq: 0,
                    timestamp: 2_500,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 3,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::AssistantMessage {
                        text: "结论".to_string(),
                        message_id: Some("msg-1".to_string()),
                    },
                    turn_id: None,
                    seq: 0,
                    timestamp: 5_000,
                },
            },
        ];
        let lines = events
            .iter()
            .map(|event| serde_json::to_string(event).expect("serialize event"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&log_path, format!("{lines}\n")).expect("write structured log");

        let session = test_session_record(log_path.to_string_lossy().as_ref());
        let history = read_timeline_from_session_log(&session).expect("read timeline");

        assert_eq!(
            history.items,
            vec![
                AgentTimelineItem::Reasoning {
                    text: "分析完成".to_string(),
                    duration_ms: Some(4_000),
                },
                AgentTimelineItem::AssistantMessage {
                    text: "结论".to_string(),
                    message_id: Some("msg-1".to_string()),
                },
            ]
        );
    }

    #[test]
    fn read_timeline_from_legacy_structured_log_does_not_render_json() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let log_path = temp_dir.path().join("legacy-structured.jsonl");
        fs::write(
            &log_path,
            concat!(
                "{\"projectId\":1,\"sessionId\":26,\"seq\":1,\"epoch\":\"epoch-unknown\",\"event\":{\"type\":\"thread_started\",\"threadId\":\"019ee3cc\"}}\n",
                "{\"projectId\":1,\"sessionId\":26,\"seq\":2,\"epoch\":\"epoch-unknown\",\"event\":{\"type\":\"timeline\",\"item\":{\"type\":\"user_message\",\"text\":\"北京今天天气如何？\",\"messageId\":\"u1\"},\"turnId\":\"t1\"}}\n",
                "{\"projectId\":1,\"sessionId\":26,\"seq\":3,\"epoch\":\"epoch-unknown\",\"event\":{\"type\":\"timeline\",\"item\":{\"type\":\"assistant_message\",\"text\":\"我会查询北京天气。\",\"messageId\":\"a1\"},\"turnId\":\"t1\"}}\n"
            ),
        )
        .expect("write legacy structured log");

        let session = test_session_record(log_path.to_string_lossy().as_ref());
        let history = read_timeline_from_session_log(&session).expect("read timeline");

        assert_eq!(
            history.items,
            vec![
                AgentTimelineItem::UserMessage {
                    text: "北京今天天气如何？".to_string(),
                    message_id: Some("u1".to_string()),
                },
                AgentTimelineItem::AssistantMessage {
                    text: "我会查询北京天气。".to_string(),
                    message_id: Some("a1".to_string()),
                },
            ]
        );
        assert_eq!(history.effort, None);
        assert_eq!(
            latest_output_from_session_log(log_path.to_string_lossy().as_ref()).as_deref(),
            Some("我会查询北京天气。")
        );
    }

    #[test]
    fn read_timeline_from_concatenated_structured_log_keeps_empty_messages_empty() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let log_path = temp_dir.path().join("concatenated-structured.jsonl");
        fs::write(
            &log_path,
            concat!(
                "{\"projectId\":2,\"sessionId\":26,\"seq\":1,\"epoch\":\"epoch-unknown\",\"event\":{\"type\":\"thread_started\",\"threadId\":\"019f042d\"}}",
                "{\"projectId\":2,\"sessionId\":26,\"seq\":2,\"epoch\":\"epoch-unknown\",\"event\":{\"type\":\"thread_started\",\"threadId\":\"019f042d\"}}\n",
                "\n",
                "{\"projectId\":2,\"sessionId\":26,\"seq\":3,\"epoch\":\"epoch-unknown\",\"event\":{\"type\":\"effort_changed\",\"effort\":\"high\"}}\n"
            ),
        )
        .expect("write concatenated structured log");

        let session = test_session_record(log_path.to_string_lossy().as_ref());
        let history = read_timeline_from_session_log(&session).expect("read timeline");

        assert!(history.items.is_empty());
        assert_eq!(history.effort.as_deref(), Some("high"));
        assert_eq!(
            latest_output_from_session_log(log_path.to_string_lossy().as_ref()).as_deref(),
            None
        );
    }

    #[test]
    fn read_timeline_from_pty_log_returns_clean_assistant_message() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let log_path = temp_dir.path().join("pty.log");
        fs::write(
            &log_path,
            "\u{1b}[2K\rThinking...\n\u{1b}[32m最终输出\u{1b}[0m\n",
        )
        .expect("write pty log");

        let session = test_session_record(log_path.to_string_lossy().as_ref());
        let history = read_timeline_from_session_log(&session).expect("read timeline");

        assert_eq!(history.items.len(), 1);
        assert_eq!(history.effort, None);
        match &history.items[0] {
            AgentTimelineItem::AssistantMessage { text, message_id } => {
                assert_eq!(message_id.as_deref(), Some("session-log"));
                assert!(text.contains("Thinking..."));
                assert!(text.contains("最终输出"));
                assert!(!text.contains('\u{1b}'));
            }
            other => panic!("expected assistant message, got {other:?}"),
        }
        assert_eq!(
            latest_output_from_session_log(log_path.to_string_lossy().as_ref()).as_deref(),
            Some("最终输出")
        );
    }

    #[test]
    fn read_agent_timeline_prefers_persisted_log_over_running_handle() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let log_path = temp_dir.path().join("structured.jsonl");
        let event = AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 401,
            seq: 1,
            epoch: "epoch-test".to_string(),
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::AssistantMessage {
                    text: "本地历史".to_string(),
                    message_id: Some("msg-local".to_string()),
                },
                turn_id: None,
                seq: 0,
                timestamp: 1,
            },
        };
        fs::write(
            &log_path,
            format!(
                "{}\n",
                serde_json::to_string(&event).expect("serialize event")
            ),
        )
        .expect("write structured log");

        let database = setup_session_list_database();
        let started_at = current_millis();
        insert_session_list_row(
            &database,
            401,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            started_at,
            None,
        );
        database
            .execute(
                "UPDATE agent_sessions SET log_path = ?1 WHERE id = 401",
                params![log_path.to_string_lossy().to_string()],
            )
            .expect("update log path");

        let service = test_agent_session_service(&database);
        let handle: Arc<dyn AgentSessionHandle> = Arc::new(TimelineProtocolErrorHandle {
            message: "handle should not be read".to_string(),
        });
        let result = service
            .read_agent_timeline(1, 401, Some(handle))
            .expect("read persisted timeline");

        assert_eq!(
            result.items,
            vec![AgentTimelineItem::AssistantMessage {
                text: "本地历史".to_string(),
                message_id: Some("msg-local".to_string()),
            }]
        );
    }

    #[test]
    fn read_agent_timeline_treats_unmaterialized_standalone_thread_as_empty() {
        let database = setup_session_list_database();
        let started_at = current_millis();
        insert_session_list_row(
            &database,
            401,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            started_at,
            None,
        );

        let service = test_agent_session_service(&database);
        let handle: Arc<dyn AgentSessionHandle> = Arc::new(TimelineProtocolErrorHandle {
            message:
                "codex app-server 返回错误：thread test-thread is not materialized yet; includeTurns is unavailable before first user message".to_string(),
        });

        let result = service
            .read_agent_timeline(1, 401, Some(handle))
            .expect("read empty standalone timeline");

        assert!(result.items.is_empty());
        assert_eq!(result.effort, None);
    }

    #[test]
    fn detect_codex_session_id_from_home_matches_recent_session_file_by_working_dir() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_home = temp_dir.path();
        let session_id = "019d8b4d-2998-7913-889d-fb3c32971610";
        let working_dir = "/tmp/redwhisk";
        let started_at = current_millis();

        fs::write(
            codex_home.join("session_index.jsonl"),
            format!(
                "{{\"id\":\"{session_id}\",\"thread_name\":\"test\",\"updated_at\":\"2026-06-07T00:00:00Z\"}}\n"
            ),
        )
        .expect("write session index");

        let session_file = codex_home
            .join("profiles")
            .join("test")
            .join("sessions")
            .join("2026")
            .join("06")
            .join("07")
            .join(format!("rollout-2026-06-07T00-00-00-{session_id}.jsonl"));
        create_session_file(&session_file, session_id, working_dir);

        let detected = detect_codex_session_id_from_home(codex_home, working_dir, started_at, 1, 1);

        assert_eq!(detected.as_deref(), Some(session_id));
    }

    #[test]
    fn detect_codex_session_id_from_home_ignores_session_for_other_working_dir() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_home = temp_dir.path();
        let session_id = "019d8b4d-2998-7913-889d-fb3c32971610";
        let started_at = current_millis();

        fs::write(
            codex_home.join("session_index.jsonl"),
            format!(
                "{{\"id\":\"{session_id}\",\"thread_name\":\"test\",\"updated_at\":\"2026-06-07T00:00:00Z\"}}\n"
            ),
        )
        .expect("write session index");

        let session_file = codex_home
            .join("profiles")
            .join("test")
            .join("sessions")
            .join("2026")
            .join("06")
            .join("07")
            .join(format!("rollout-2026-06-07T00-00-00-{session_id}.jsonl"));
        create_session_file(&session_file, session_id, "/tmp/other-project");

        let detected =
            detect_codex_session_id_from_home(codex_home, "/tmp/redwhisk", started_at, 1, 1);

        assert_eq!(detected, None);
    }

    #[test]
    fn list_agent_sessions_keeps_pinned_order_when_activity_changes() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            301,
            Some(20),
            Some("First visible session"),
            Some("running"),
            AgentSessionStatus::Running,
            1_000,
            None,
        );
        insert_session_list_row(
            &database,
            302,
            Some(21),
            Some("Second visible session"),
            Some("running"),
            AgentSessionStatus::Running,
            2_000,
            None,
        );

        let service = test_agent_session_service(&database);
        let first_list = service.list_agent_sessions(1).expect("list sessions");
        assert_eq!(
            session_ids(&first_list.sessions),
            vec![302, 301],
            "newer inserted session should appear first"
        );

        database
            .execute(
                "UPDATE agent_sessions SET last_active_at = ?1 WHERE id = ?2",
                params![9_000_i64, 301_i64],
            )
            .expect("update activity");

        let second_list = service.list_agent_sessions(1).expect("list sessions");
        assert_eq!(session_ids(&second_list.sessions), vec![302, 301]);
    }

    #[test]
    fn list_agent_sessions_keeps_non_completed_sessions_when_completed_history_exceeds_limit() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            301,
            Some(20),
            Some("Running issue"),
            Some("running"),
            AgentSessionStatus::Running,
            10,
            None,
        );
        insert_session_list_row(
            &database,
            302,
            Some(21),
            Some("Review issue"),
            Some("review"),
            AgentSessionStatus::Running,
            11,
            None,
        );

        for index in 0..55 {
            insert_session_list_row(
                &database,
                400 + index,
                None,
                None,
                None,
                AgentSessionStatus::Closed,
                100 + index,
                Some(200 + index),
            );
        }

        let service = test_agent_session_service(&database);
        let response = service.list_agent_sessions(1).expect("list sessions");
        let ids = session_ids(&response.sessions);

        assert!(ids.contains(&301));
        assert!(ids.contains(&302));
        assert_eq!(response.sessions.len(), 52);
        assert!(!ids.contains(&400));
        assert!(ids.contains(&454));
    }

    #[test]
    fn list_agent_sessions_reads_persisted_turn_running_state() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            301,
            Some(20),
            Some("Completed turn issue"),
            Some("running"),
            AgentSessionStatus::Running,
            10,
            None,
        );
        insert_session_list_row(
            &database,
            302,
            Some(21),
            Some("Active turn issue"),
            Some("running"),
            AgentSessionStatus::Running,
            11,
            None,
        );
        database
            .execute(
                "UPDATE agent_sessions SET is_turn_running = 1 WHERE id = 302",
                [],
            )
            .expect("set active turn state");

        let service = test_agent_session_service(&database);
        let response = service.list_agent_sessions(1).expect("list sessions");
        let completed_turn_session = response
            .sessions
            .iter()
            .find(|session| session.session_id == 301)
            .expect("completed turn session");
        let active_turn_session = response
            .sessions
            .iter()
            .find(|session| session.session_id == 302)
            .expect("active turn session");

        assert!(!completed_turn_session.is_turn_running);
        assert!(active_turn_session.is_turn_running);
    }

    #[test]
    fn update_turn_ended_at_writes_timestamp_for_running_session() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            401,
            Some(30),
            Some("Grace issue"),
            Some("running"),
            AgentSessionStatus::Running,
            20,
            None,
        );
        let repository = AgentSessionRepository::new(&database);

        repository
            .update_turn_ended_at(401, 1_000)
            .expect("update turn_ended_at");

        let ended_at: Option<i64> = database
            .query_row(
                "SELECT turn_ended_at FROM agent_sessions WHERE id = 401",
                [],
                |row| row.get(0),
            )
            .expect("read turn_ended_at");
        assert_eq!(ended_at, Some(1_000));
    }

    #[test]
    fn clear_turn_ended_at_nulls_timestamp() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            402,
            Some(31),
            Some("Clear issue"),
            Some("running"),
            AgentSessionStatus::Running,
            21,
            None,
        );
        let repository = AgentSessionRepository::new(&database);
        repository.update_turn_ended_at(402, 1_000).expect("set");

        repository.clear_turn_ended_at(402).expect("clear");

        let ended_at: Option<i64> = database
            .query_row(
                "SELECT turn_ended_at FROM agent_sessions WHERE id = 402",
                [],
                |row| row.get(0),
            )
            .expect("read turn_ended_at");
        assert_eq!(ended_at, None);
    }

    #[test]
    fn mark_terminated_clears_turn_ended_at() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            403,
            Some(32),
            Some("Terminate issue"),
            Some("running"),
            AgentSessionStatus::Running,
            22,
            None,
        );
        let repository = AgentSessionRepository::new(&database);
        repository.update_turn_ended_at(403, 1_000).expect("set");

        database
            .execute(
                "UPDATE agent_sessions SET status = 'stopped', is_turn_running = 0, turn_ended_at = NULL, closed_at = 50 WHERE id = 403 AND closed_at IS NULL AND del = 0",
                [],
            )
            .expect("terminate");

        let ended_at: Option<i64> = database
            .query_row(
                "SELECT turn_ended_at FROM agent_sessions WHERE id = 403",
                [],
                |row| row.get(0),
            )
            .expect("read turn_ended_at");
        assert_eq!(ended_at, None);
    }

    #[test]
    fn record_turn_completed_accumulates_processing_ms_and_writes_last_output_at() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            410,
            Some(40),
            Some("Processing issue"),
            Some("running"),
            AgentSessionStatus::Running,
            30,
            None,
        );
        let repository = AgentSessionRepository::new(&database);
        repository
            .update_turn_started_at(410, 1_000)
            .expect("set turn_started_at");
        repository
            .record_turn_completed(410, 4_200)
            .expect("complete turn");

        let (processing_ms, last_output_at, turn_ended_at): (i64, Option<i64>, Option<i64>) =
            database
                .query_row(
                    "SELECT processing_ms, last_output_at, turn_ended_at FROM agent_sessions WHERE id = 410",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .expect("read duration columns");
        assert_eq!(processing_ms, 3_200);
        assert_eq!(last_output_at, Some(4_200));
        assert_eq!(turn_ended_at, Some(4_200));

        let service = test_agent_session_service(&database);
        let response = service.list_agent_sessions(1).expect("list sessions");
        let session = response
            .sessions
            .iter()
            .find(|session| session.session_id == 410)
            .expect("find session");
        assert_eq!(session.processing_ms, 3_200);
        assert_eq!(session.last_output_at, Some(4_200));
    }

    #[test]
    fn record_turn_completed_accumulates_across_multiple_turns() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            411,
            Some(41),
            Some("Multi turn issue"),
            Some("running"),
            AgentSessionStatus::Running,
            30,
            None,
        );
        let repository = AgentSessionRepository::new(&database);
        repository
            .update_turn_started_at(411, 1_000)
            .expect("turn1 start");
        repository
            .record_turn_completed(411, 4_200)
            .expect("turn1 end");
        repository
            .update_turn_started_at(411, 10_000)
            .expect("turn2 start");
        repository
            .record_turn_completed(411, 12_000)
            .expect("turn2 end");

        let processing_ms: i64 = database
            .query_row(
                "SELECT processing_ms FROM agent_sessions WHERE id = 411",
                [],
                |row| row.get(0),
            )
            .expect("read processing_ms");
        assert_eq!(processing_ms, 5_200);
    }

    #[test]
    fn record_turn_completed_skips_accumulation_when_started_at_missing() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            412,
            Some(42),
            Some("Missing start issue"),
            Some("running"),
            AgentSessionStatus::Running,
            30,
            None,
        );
        let repository = AgentSessionRepository::new(&database);
        // 漏记 turn_started_at 直接完成：COALESCE 兜底，本次不计入，避免负值。
        repository
            .record_turn_completed(412, 4_200)
            .expect("complete turn");

        let (processing_ms, last_output_at): (i64, Option<i64>) = database
            .query_row(
                "SELECT processing_ms, last_output_at FROM agent_sessions WHERE id = 412",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read columns");
        assert_eq!(processing_ms, 0);
        assert_eq!(last_output_at, Some(4_200));
    }

    #[test]
    fn mark_terminated_clears_turn_started_at_but_keeps_processing_ms() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            413,
            Some(43),
            Some("Crash issue"),
            Some("running"),
            AgentSessionStatus::Running,
            30,
            None,
        );
        let repository = AgentSessionRepository::new(&database);
        repository
            .update_turn_started_at(413, 1_000)
            .expect("set started");
        repository
            .record_turn_completed(413, 4_200)
            .expect("complete turn");

        // 模拟 crashed 收尾（mark_terminated SQL）：清 turn_started_at，processing_ms 保留。
        database
            .execute(
                "UPDATE agent_sessions SET status = 'crashed', is_turn_running = 0, turn_ended_at = NULL, turn_started_at = NULL, last_active_at = MAX(last_active_at + 1, 5000), closed_at = COALESCE(closed_at, 5000) WHERE id = 413 AND closed_at IS NULL AND del = 0",
                [],
            )
            .expect("terminate");

        let (turn_started_at, processing_ms): (Option<i64>, i64) = database
            .query_row(
                "SELECT turn_started_at, processing_ms FROM agent_sessions WHERE id = 413",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read columns");
        assert_eq!(turn_started_at, None);
        assert_eq!(processing_ms, 3_200);
    }

    #[test]
    fn list_agent_sessions_does_not_report_stopped_session_turn_as_running() {
        let database = setup_session_list_database();
        let log_path =
            std::env::temp_dir().join(format!("redwhisk-stopped-turn-{}.jsonl", current_millis()));
        fs::write(
            &log_path,
            "{\"projectId\":1,\"sessionId\":303,\"seq\":1,\"epoch\":\"test\",\"event\":{\"type\":\"turn_started\",\"turnId\":\"t3\"}}\n",
        )
        .expect("write stopped turn log");
        insert_session_list_row(
            &database,
            303,
            Some(22),
            Some("Stopped turn issue"),
            Some("running"),
            AgentSessionStatus::Stopped,
            12,
            Some(13),
        );
        database
            .execute(
                "UPDATE agent_sessions SET log_path = ?1 WHERE id = 303",
                params![log_path.to_string_lossy().to_string()],
            )
            .expect("set stopped log path");

        let service = test_agent_session_service(&database);
        let response = service.list_agent_sessions(1).expect("list sessions");
        let stopped_turn_session = response
            .sessions
            .iter()
            .find(|session| session.session_id == 303)
            .expect("stopped turn session");

        assert!(!stopped_turn_session.is_turn_running);

        fs::remove_file(log_path).ok();
    }

    #[test]
    fn list_agent_sessions_does_not_report_empty_standalone_session_turn_as_running() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            304,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            current_millis(),
            None,
        );

        let service = test_agent_session_service(&database);
        let response = service.list_agent_sessions(1).expect("list sessions");
        let standalone_session = response
            .sessions
            .iter()
            .find(|session| session.session_id == 304)
            .expect("standalone session");

        assert!(!standalone_session.is_turn_running);
    }

    #[test]
    fn list_reports_turn_running_within_grace_after_turn_ended() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            501,
            Some(40),
            Some("Grace within issue"),
            Some("running"),
            AgentSessionStatus::Running,
            30,
            None,
        );
        database
            .execute(
                "UPDATE agent_sessions SET is_turn_running = 1, turn_ended_at = ?1 WHERE id = 501",
                params![current_millis() - 1_000],
            )
            .expect("set grace within");

        let service = test_agent_session_service(&database);
        let response = service.list_agent_sessions(1).expect("list");
        let session = response
            .sessions
            .iter()
            .find(|s| s.session_id == 501)
            .expect("session");
        assert!(session.is_turn_running);
    }

    #[test]
    fn list_reports_turn_idle_after_grace_expires() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            502,
            Some(41),
            Some("Grace expired issue"),
            Some("running"),
            AgentSessionStatus::Running,
            31,
            None,
        );
        database
            .execute(
                "UPDATE agent_sessions SET is_turn_running = 1, turn_ended_at = ?1 WHERE id = 502",
                params![current_millis() - 4_000],
            )
            .expect("set grace expired");

        let service = test_agent_session_service(&database);
        let response = service.list_agent_sessions(1).expect("list");
        let session = response
            .sessions
            .iter()
            .find(|s| s.session_id == 502)
            .expect("session");
        assert!(!session.is_turn_running);
    }

    #[test]
    fn finalize_turn_after_grace_clears_flag_when_unpreempted() {
        let connection = setup_session_list_database();
        insert_session_list_row(
            &connection,
            604,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            current_millis(),
            None,
        );
        let ended_at = current_millis();
        connection
            .execute(
                "UPDATE agent_sessions SET is_turn_running = 1, turn_ended_at = ?1 WHERE id = 604",
                params![ended_at],
            )
            .expect("set grace ended");

        let repository = AgentSessionRepository::new(&connection);
        let finalized = repository
            .finalize_turn_after_grace(604, ended_at)
            .expect("finalize");
        assert!(finalized);

        let (is_turn_running, turn_ended_at): (i64, Option<i64>) = connection
            .query_row(
                "SELECT is_turn_running, turn_ended_at FROM agent_sessions WHERE id = 604",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read row");
        assert_eq!(is_turn_running, 0);
        assert!(turn_ended_at.is_none());
    }

    #[test]
    fn finalize_turn_after_grace_noop_when_turn_ended_at_refreshed() {
        let connection = setup_session_list_database();
        insert_session_list_row(
            &connection,
            605,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            current_millis(),
            None,
        );
        let first_ended_at = current_millis();
        connection
            .execute(
                "UPDATE agent_sessions SET is_turn_running = 1, turn_ended_at = ?1 WHERE id = 605",
                params![first_ended_at],
            )
            .expect("set first ended");
        // 并发 sub-turn 刷新 turn_ended_at 为更新的值（自身延迟任务接管收尾）。
        let refreshed_ended_at = first_ended_at + 1_000;
        connection
            .execute(
                "UPDATE agent_sessions SET turn_ended_at = ?1 WHERE id = 605",
                params![refreshed_ended_at],
            )
            .expect("refresh ended");

        let finalized = AgentSessionRepository::new(&connection)
            .finalize_turn_after_grace(605, first_ended_at)
            .expect("finalize");
        assert!(!finalized, "turn_ended_at 已被刷新，旧值的收尾应为 no-op");

        let turn_ended_at: Option<i64> = connection
            .query_row(
                "SELECT turn_ended_at FROM agent_sessions WHERE id = 605",
                [],
                |row| row.get(0),
            )
            .expect("read row");
        assert_eq!(turn_ended_at, Some(refreshed_ended_at));
    }

    #[test]
    fn finalize_turn_after_grace_noop_after_turn_started() {
        let connection = setup_session_list_database();
        insert_session_list_row(
            &connection,
            606,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            current_millis(),
            None,
        );
        let ended_at = current_millis();
        connection
            .execute(
                "UPDATE agent_sessions SET is_turn_running = 1, turn_ended_at = ?1 WHERE id = 606",
                params![ended_at],
            )
            .expect("set ended");
        // 新 turn 开始：clear turn_ended_at（CAS 守卫不再命中旧值）。
        AgentSessionRepository::new(&connection)
            .clear_turn_ended_at(606)
            .expect("clear");

        let finalized = AgentSessionRepository::new(&connection)
            .finalize_turn_after_grace(606, ended_at)
            .expect("finalize");
        assert!(!finalized, "新 turn 已抢占，收尾应为 no-op");
    }

    #[test]
    fn finalize_turn_after_grace_noop_when_deleted_or_stopped() {
        let connection = setup_session_list_database();
        let ended_at = current_millis();

        insert_session_list_row(
            &connection,
            607,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            current_millis(),
            None,
        );
        connection
            .execute(
                "UPDATE agent_sessions SET is_turn_running = 1, turn_ended_at = ?1, del = 1 WHERE id = 607",
                params![ended_at],
            )
            .expect("set deleted");
        let finalized_deleted = AgentSessionRepository::new(&connection)
            .finalize_turn_after_grace(607, ended_at)
            .expect("finalize deleted");
        assert!(!finalized_deleted, "已删除 session 不应被收尾");

        insert_session_list_row(
            &connection,
            608,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            current_millis(),
            None,
        );
        connection
            .execute(
                "UPDATE agent_sessions SET is_turn_running = 1, turn_ended_at = ?1, status = 'stopped' WHERE id = 608",
                params![ended_at],
            )
            .expect("set stopped");
        let finalized_stopped = AgentSessionRepository::new(&connection)
            .finalize_turn_after_grace(608, ended_at)
            .expect("finalize stopped");
        assert!(!finalized_stopped, "已停止 session 不应被收尾");
    }

    #[test]
    fn list_reports_turn_running_when_turn_ended_at_null_and_running() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            503,
            Some(42),
            Some("Null ended issue"),
            Some("running"),
            AgentSessionStatus::Running,
            32,
            None,
        );
        database
            .execute(
                "UPDATE agent_sessions SET is_turn_running = 1 WHERE id = 503",
                [],
            )
            .expect("set running");

        let service = test_agent_session_service(&database);
        let response = service.list_agent_sessions(1).expect("list");
        let session = response
            .sessions
            .iter()
            .find(|s| s.session_id == 503)
            .expect("session");
        assert!(session.is_turn_running);
    }

    #[test]
    fn empty_error_turn_failed_keeps_running_within_grace() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            601,
            Some(50),
            Some("Empty error issue"),
            Some("running"),
            AgentSessionStatus::Running,
            40,
            None,
        );
        // 模拟 broadcaster 对空 error turn_failed 的处理：写 turn_ended_at，不置 0。
        let repository = AgentSessionRepository::new(&database);
        repository
            .update_turn_running(601, true, 40)
            .expect("start");
        repository
            .update_turn_ended_at(601, current_millis() - 1_000)
            .expect("empty fail");

        let service = test_agent_session_service(&database);
        let response = service.list_agent_sessions(1).expect("list");
        let session = response
            .sessions
            .iter()
            .find(|s| s.session_id == 601)
            .expect("session");
        assert!(
            session.is_turn_running,
            "空 error turn_failed 在 grace 内应仍运行"
        );
    }

    #[test]
    fn concurrent_turn_completions_refresh_grace_window() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            602,
            Some(51),
            Some("Concurrent turns issue"),
            Some("running"),
            AgentSessionStatus::Running,
            41,
            None,
        );
        let repository = AgentSessionRepository::new(&database);
        repository
            .update_turn_running(602, true, 41)
            .expect("start");
        // 多个并发 sub turn 陆续 completed：每次刷新 turn_ended_at。
        repository
            .update_turn_ended_at(602, current_millis() - 2_500)
            .expect("sub turn 1");
        repository
            .update_turn_ended_at(602, current_millis() - 1_000)
            .expect("sub turn 2");

        let service = test_agent_session_service(&database);
        let response = service.list_agent_sessions(1).expect("list");
        let session = response
            .sessions
            .iter()
            .find(|s| s.session_id == 602)
            .expect("session");
        assert!(
            session.is_turn_running,
            "最近一次 completed 在 grace 内应仍运行"
        );
    }

    #[test]
    fn turn_canceled_and_error_turn_failed_terminate_immediately() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            603,
            Some(52),
            Some("Cancel issue"),
            Some("running"),
            AgentSessionStatus::Running,
            42,
            None,
        );
        let repository = AgentSessionRepository::new(&database);
        repository
            .update_turn_running(603, true, 42)
            .expect("start");
        // 模拟 EndedImmediately：置 is_turn_running=0 + 清 turn_ended_at。
        repository
            .update_turn_running(603, false, 42)
            .expect("cancel");
        repository.clear_turn_ended_at(603).expect("clear");

        let service = test_agent_session_service(&database);
        let response = service.list_agent_sessions(1).expect("list");
        let session = response
            .sessions
            .iter()
            .find(|s| s.session_id == 603)
            .expect("session");
        assert!(!session.is_turn_running, "turn_canceled 应立即非运行");
    }

    #[test]
    fn delete_standalone_session_soft_deletes_session() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            305,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            current_millis(),
            None,
        );

        let service = test_agent_session_service(&database);
        let result = service
            .delete_standalone_session(1, 305)
            .expect("delete standalone session");

        assert_eq!(result.session_id, 305);
        let response = service.list_agent_sessions(1).expect("list sessions");
        assert!(!session_ids(&response.sessions).contains(&305));

        let events = EventRepository::new(&database)
            .list_session_events(305)
            .expect("list session events");
        assert!(events.iter().any(|event| {
            event.event_type == SessionEventType::SessionClosed
                && event
                    .payload_json
                    .contains("\"reason\":\"session_deleted\"")
        }));
    }

    #[test]
    fn delete_standalone_session_rejects_linked_issue_session() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            306,
            Some(26),
            Some("Linked issue"),
            Some("running"),
            AgentSessionStatus::Running,
            current_millis(),
            None,
        );

        let service = test_agent_session_service(&database);
        let result = service.delete_standalone_session(1, 306);

        assert!(result.is_err());
        let response = service.list_agent_sessions(1).expect("list sessions");
        assert!(session_ids(&response.sessions).contains(&306));
    }

    #[test]
    fn delete_standalone_session_removes_session_log_file() {
        let database = setup_session_list_database();
        let temp_dir = tempdir().expect("temp dir");
        let log_file = temp_dir.path().join("standalone-308.jsonl");
        fs::write(&log_file, b"{}").expect("write session log file");
        assert!(log_file.exists());

        insert_session_list_row(
            &database,
            308,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            current_millis(),
            None,
        );
        database
            .execute(
                "UPDATE agent_sessions SET log_path = ?1 WHERE id = ?2",
                params![log_file.to_string_lossy().to_string(), 308],
            )
            .expect("point session log_path at temp file");

        let service = test_agent_session_service(&database);
        service
            .delete_standalone_session(1, 308)
            .expect("delete standalone session");

        assert!(
            !log_file.exists(),
            "自定义 session 删除后应同步删除磁盘上的 session log 文件"
        );
    }

    #[test]
    fn update_standalone_session_title_persists_title() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            307,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            current_millis(),
            None,
        );

        let service = test_agent_session_service(&database);
        let result = service
            .update_standalone_session_title(UpdateAgentSessionTitleInput {
                project_id: 1,
                session_id: 307,
                title: " Renamed Session ".to_string(),
            })
            .expect("update standalone session title");

        assert_eq!(result.session_id, 307);
        assert_eq!(result.title, "Renamed Session");
        let response = service.list_agent_sessions(1).expect("list sessions");
        let session = response
            .sessions
            .iter()
            .find(|session| session.session_id == 307)
            .expect("renamed session");
        assert_eq!(session.title.as_deref(), Some("Renamed Session"));
    }

    #[test]
    fn update_standalone_session_title_rejects_linked_issue_session() {
        let database = setup_session_list_database();
        insert_session_list_row(
            &database,
            308,
            Some(28),
            Some("Linked issue"),
            Some("running"),
            AgentSessionStatus::Running,
            current_millis(),
            None,
        );

        let service = test_agent_session_service(&database);
        let result = service.update_standalone_session_title(UpdateAgentSessionTitleInput {
            project_id: 1,
            session_id: 308,
            title: "Renamed Session".to_string(),
        });

        assert!(result.is_err());
        let response = service.list_agent_sessions(1).expect("list sessions");
        let session = response
            .sessions
            .iter()
            .find(|session| session.session_id == 308)
            .expect("linked session");
        assert_eq!(session.title, None);
    }

    #[test]
    fn list_agent_sessions_uses_persisted_turn_running_state() {
        let database = setup_session_list_database();
        let started_at = current_millis();
        insert_session_list_row(
            &database,
            309,
            Some(29),
            Some("Running issue"),
            Some("running"),
            AgentSessionStatus::Running,
            started_at,
            None,
        );
        let log_path = "/tmp/redwhisk-session-309.jsonl";
        fs::write(log_path, "{\"event\":{\"type\":\"turn_started\"}}\n")
            .expect("write session log");

        let service = test_agent_session_service(&database);
        let response = service.list_agent_sessions(1).expect("list sessions");
        let session = response
            .sessions
            .iter()
            .find(|session| session.session_id == 309)
            .expect("listed session");

        assert!(!session.is_turn_running);
    }

    #[test]
    fn resolve_session_cwd_for_resume_restores_missing_redwhisk_worktree() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-16");
        create_git_repo(&repo_dir);
        git(&repo_dir, &["branch", "issue-16"]);

        let database = setup_session_list_database();
        database
            .execute(
                "UPDATE projects SET repo_path = ?1 WHERE id = 1",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("update project repo");
        let service = test_agent_session_service(&database);
        let session = test_worktree_session(worktree_path.to_string_lossy().as_ref());

        let cwd = service
            .resolve_session_cwd_for_resume(&session)
            .expect("resolve cwd");

        assert_eq!(cwd, worktree_path.to_string_lossy());
        assert!(worktree_path.is_dir());
        assert_eq!(
            git_output(&worktree_path, &["branch", "--show-current"]),
            "issue-16"
        );
        assert!(should_restore_redwhisk_worktree(&session));
        assert_eq!(
            preferred_session_cwd(&session),
            worktree_path.to_string_lossy()
        );
    }

    #[test]
    fn resolve_session_cwd_for_model_list_falls_back_to_project_repo_when_worktree_is_missing() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-16");
        create_git_repo(&repo_dir);

        let database = setup_session_list_database();
        database
            .execute(
                "UPDATE projects SET repo_path = ?1 WHERE id = 1",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("update project repo");
        let service = test_agent_session_service(&database);
        let session = test_worktree_session(worktree_path.to_string_lossy().as_ref());

        let cwd = service
            .resolve_session_cwd_for_model_list(&session)
            .expect("resolve model cwd");

        assert_eq!(cwd, repo_dir.to_string_lossy());
        assert!(!worktree_path.exists());
    }

    fn create_session_file(path: &Path, session_id: &str, working_dir: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create session dir");
        }

        fs::write(
            path,
            format!(
                "{{\"timestamp\":\"2026-06-07T00:00:00.000Z\",\"type\":\"session_meta\",\"payload\":{{\"id\":\"{session_id}\",\"cwd\":\"{working_dir}\"}}}}\n"
            ),
        )
        .expect("write session file");
    }

    fn test_session_record(log_path: &str) -> AgentSessionRecord {
        AgentSessionRecord {
            id: 7,
            number: 0,
            project_id: 1,
            issue_id: None,
            title: Some("test".to_string()),
            agent_profile_id: 0,
            workflow_skill_name: None,
            codex_session_id: None,
            status: AgentSessionStatus::Stopped,
            attention: AgentSessionAttention::None,
            working_dir: "/tmp/redwhisk".to_string(),
            command_snapshot: String::new(),
            prompt_snapshot: String::new(),
            workspace_mode: WorkspaceMode::CurrentBranch,
            target_branch: None,
            workspace_branch: None,
            workspace_path: None,
            origin_branch: None,
            worktree_owner: WorktreeOwner::External,
            worktree_root_path: None,
            worktree_setup_command: None,
            log_path: log_path.to_string(),
            latest_output: None,
            last_active_at: 1,
            started_at: 1,
            closed_at: Some(2),
        }
    }

    fn test_worktree_session(worktree_path: &str) -> AgentSessionRecord {
        AgentSessionRecord {
            id: 30,
            number: 0,
            project_id: 1,
            issue_id: Some(16),
            title: None,
            agent_profile_id: 101,
            workflow_skill_name: None,
            codex_session_id: Some("thread-16".to_string()),
            status: AgentSessionStatus::Stopped,
            attention: AgentSessionAttention::None,
            working_dir: worktree_path.to_string(),
            command_snapshot: "codex".to_string(),
            prompt_snapshot: String::new(),
            workspace_mode: WorkspaceMode::Worktree,
            target_branch: Some("devlop".to_string()),
            workspace_branch: Some("issue-16".to_string()),
            workspace_path: Some(worktree_path.to_string()),
            origin_branch: Some("devlop".to_string()),
            worktree_owner: WorktreeOwner::Redwhisk,
            worktree_root_path: None,
            worktree_setup_command: Some(String::new()),
            log_path: "/tmp/redwhisk-session-30.jsonl".to_string(),
            latest_output: None,
            last_active_at: 1,
            started_at: 1,
            closed_at: Some(2),
        }
    }

    fn test_agent_profile(
        agent_type: AgentType,
        command: &str,
    ) -> crate::db::agent_profile_repository::AgentProfileRow {
        crate::db::agent_profile_repository::AgentProfileRow {
            id: 101,
            name: "Test Agent".to_string(),
            agent_type,
            command: command.to_string(),
            scope: AgentScope::Project,
            project_id: Some(1),
            mode: "auto".to_string(),
            dangerous: false,
            default_skill: String::new(),
            prompt_template: String::new(),
            del: 0,
        }
    }

    fn current_millis() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("unix time")
            .as_millis() as i64
    }

    fn setup_session_list_database() -> Connection {
        let connection = Connection::open_in_memory().expect("open database");
        MigrationRunner::default()
            .run(&connection)
            .expect("run migrations");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'RedWhisk', ?1, 1, 1)",
                params![std::env::temp_dir().to_string_lossy().to_string()],
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
    }

    fn test_agent_session_service(connection: &Connection) -> AgentSessionService<'_> {
        AgentSessionService::new(
            IssueRepository::new(connection),
            ProjectRepository::new(connection),
            AgentProfileRepository::new(connection),
            AgentSessionRepository::new(connection),
        )
    }

    fn insert_session_list_row(
        connection: &Connection,
        session_id: i64,
        issue_id: Option<i64>,
        issue_title: Option<&str>,
        issue_status: Option<&str>,
        session_status: AgentSessionStatus,
        started_at: i64,
        closed_at: Option<i64>,
    ) {
        if let (Some(issue_id), Some(issue_title), Some(issue_status)) =
            (issue_id, issue_title, issue_status)
        {
            connection
                .execute(
                    "INSERT INTO issues (id, project_id, number, title, description, status, created_at, updated_at, del)
                     VALUES (
                       ?1, 1,
                       (SELECT COALESCE(MAX(number), 0) + 1 FROM issues WHERE project_id = 1),
                       ?2, '', ?3, ?4, ?4, 0
                     )",
                    params![issue_id, issue_title, issue_status, started_at],
                )
                .expect("insert issue");
        }

        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, number, issue_id, title, agent_profile_id, status, attention,
                   working_dir, command_snapshot, prompt_snapshot, workspace_mode,
                   target_branch, workspace_branch, workspace_path,
                   worktree_root_path, log_path, list_inserted_at, last_active_at, started_at,
                   closed_at, del
                 ) VALUES (
                   ?1, 1,
                   (SELECT COALESCE(MAX(number), 0) + 1 FROM agent_sessions WHERE project_id = 1),
                   ?2, NULL, 101, ?3, 'none',
                   ?4, '', '', 'current_branch',
                   NULL, NULL, ?4,
                   NULL, ?5, ?6, ?6, ?7, ?8, 0
                 )",
                params![
                    session_id,
                    issue_id,
                    session_status_literal(&session_status),
                    std::env::temp_dir().to_string_lossy().to_string(),
                    format!("/tmp/redwhisk-session-{session_id}.jsonl"),
                    started_at,
                    started_at,
                    closed_at,
                ],
            )
            .expect("insert session");
    }

    fn session_status_literal(status: &AgentSessionStatus) -> &'static str {
        match status {
            AgentSessionStatus::Running => "running",
            AgentSessionStatus::Closed => "closed",
            AgentSessionStatus::Crashed => "crashed",
            AgentSessionStatus::Stopped => "stopped",
        }
    }

    fn session_ids(sessions: &[crate::types::agent_session::AgentSessionListItem]) -> Vec<i64> {
        sessions.iter().map(|session| session.session_id).collect()
    }

    fn create_git_repo(repo_dir: &Path) {
        fs::create_dir_all(repo_dir).expect("create repo dir");
        git(repo_dir, &["init"]);
        git(repo_dir, &["config", "user.email", "redwhisk@example.test"]);
        git(repo_dir, &["config", "user.name", "RedWhisk Test"]);
        git(repo_dir, &["checkout", "-b", "devlop"]);
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
            .expect("git output utf8")
            .trim()
            .to_string()
    }

    fn insert_issue_row(connection: &Connection, issue_id: i64, status: &str) {
        connection
            .execute(
                "INSERT INTO issues (id, project_id, title, description, status, created_at, updated_at, del)
                 VALUES (1, ?1, ?2, '', ?3, 1, 1, 0)",
                params![issue_id, format!("issue-{issue_id}"), status],
            )
            .expect("insert issue");
    }

    fn insert_worktree_session_row(
        connection: &Connection,
        session_id: i64,
        issue_id: i64,
        workspace_path: &str,
        workspace_branch: &str,
        owner: WorktreeOwner,
        del: bool,
    ) {
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, number, issue_id, title, agent_profile_id, status, attention,
                   working_dir, command_snapshot, prompt_snapshot, workspace_mode,
                   target_branch, workspace_branch, workspace_path,
                   origin_branch, worktree_owner, worktree_root_path, worktree_setup_command,
                   log_path, list_inserted_at, last_active_at, started_at, closed_at, del
                 ) VALUES (
                   ?1, 1,
                   (SELECT COALESCE(MAX(number), 0) + 1 FROM agent_sessions WHERE project_id = 1),
                   ?2, NULL, 101, 'closed', 'none',
                   ?3, '', '', 'worktree',
                   'devlop', ?4, ?3,
                   'devlop', ?5, NULL, NULL,
                   ?6, 1, 1, 1, 1, ?7
                 )",
                params![
                    session_id,
                    issue_id,
                    workspace_path,
                    workspace_branch,
                    owner.as_str(),
                    format!("/tmp/redwhisk-session-{session_id}.jsonl"),
                    if del { 1 } else { 0 },
                ],
            )
            .expect("insert worktree session");
    }

    #[test]
    fn get_issue_worktree_status_reports_not_exists_when_no_worktree_session() {
        let database = setup_session_list_database();
        insert_issue_row(&database, 16, "backlog");
        let service = test_agent_session_service(&database);

        let status = service
            .get_issue_worktree_status(GetIssueWorktreeStatusInput {
                project_id: 1,
                issue_id: 16,
            })
            .expect("status");

        assert!(!status.exists);
        assert!(!status.can_delete);
        assert!(status.workspace_path.is_none());
        assert!(status.workspace_branch.is_none());
    }

    #[test]
    fn get_issue_worktree_status_detects_existing_redwhisk_worktree() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-16");
        create_git_repo(&repo_dir);
        git(
            &repo_dir,
            &[
                "worktree",
                "add",
                "-b",
                "issue-16",
                worktree_path.to_string_lossy().as_ref(),
                "devlop",
            ],
        );

        let database = setup_session_list_database();
        database
            .execute(
                "UPDATE projects SET repo_path = ?1 WHERE id = 1",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("update project repo");
        insert_issue_row(&database, 16, "backlog");
        insert_worktree_session_row(
            &database,
            30,
            16,
            worktree_path.to_string_lossy().as_ref(),
            "issue-16",
            WorktreeOwner::Redwhisk,
            true,
        );

        let service = test_agent_session_service(&database);
        let status = service
            .get_issue_worktree_status(GetIssueWorktreeStatusInput {
                project_id: 1,
                issue_id: 16,
            })
            .expect("status");

        assert!(status.exists);
        assert!(status.can_delete);
        assert_eq!(
            status.workspace_path,
            Some(worktree_path.to_string_lossy().to_string())
        );
        assert_eq!(status.workspace_branch.as_deref(), Some("issue-16"));
    }

    #[test]
    fn get_issue_worktree_status_reports_not_deletable_for_external_owner() {
        let temp_dir = tempdir().expect("temp dir");
        let external_path = temp_dir.path().join("external-worktree");
        fs::create_dir_all(&external_path).expect("create external dir");

        let database = setup_session_list_database();
        insert_issue_row(&database, 16, "backlog");
        insert_worktree_session_row(
            &database,
            30,
            16,
            external_path.to_string_lossy().as_ref(),
            "issue-16",
            WorktreeOwner::External,
            true,
        );

        let service = test_agent_session_service(&database);
        let status = service
            .get_issue_worktree_status(GetIssueWorktreeStatusInput {
                project_id: 1,
                issue_id: 16,
            })
            .expect("status");

        assert!(status.exists);
        assert!(!status.can_delete);
    }

    #[test]
    fn delete_issue_worktree_removes_directory_and_branch() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-16");
        create_git_repo(&repo_dir);
        git(
            &repo_dir,
            &[
                "worktree",
                "add",
                "-b",
                "issue-16",
                worktree_path.to_string_lossy().as_ref(),
                "devlop",
            ],
        );

        let database = setup_session_list_database();
        database
            .execute(
                "UPDATE projects SET repo_path = ?1 WHERE id = 1",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("update project repo");
        insert_issue_row(&database, 16, "backlog");
        insert_worktree_session_row(
            &database,
            30,
            16,
            worktree_path.to_string_lossy().as_ref(),
            "issue-16",
            WorktreeOwner::Redwhisk,
            true,
        );

        let service = test_agent_session_service(&database);
        let result = service
            .delete_issue_worktree(DeleteIssueWorktreeInput {
                project_id: 1,
                issue_id: 16,
            })
            .expect("delete");

        assert!(result.deleted);
        assert!(!worktree_path.exists());
        assert!(!branch_exists(&repo_dir, "issue-16"));
    }

    #[test]
    fn delete_issue_worktree_rejects_external_owner() {
        let temp_dir = tempdir().expect("temp dir");
        let external_path = temp_dir.path().join("external-worktree");
        fs::create_dir_all(&external_path).expect("create external dir");

        let database = setup_session_list_database();
        insert_issue_row(&database, 16, "backlog");
        insert_worktree_session_row(
            &database,
            30,
            16,
            external_path.to_string_lossy().as_ref(),
            "issue-16",
            WorktreeOwner::External,
            true,
        );

        let service = test_agent_session_service(&database);
        let error = service
            .delete_issue_worktree(DeleteIssueWorktreeInput {
                project_id: 1,
                issue_id: 16,
            })
            .expect_err("should reject external");

        assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
    }

    #[test]
    fn delete_issue_worktree_errors_when_no_worktree_session() {
        let database = setup_session_list_database();
        insert_issue_row(&database, 16, "backlog");

        let service = test_agent_session_service(&database);
        let error = service
            .delete_issue_worktree(DeleteIssueWorktreeInput {
                project_id: 1,
                issue_id: 16,
            })
            .expect_err("should error without session");

        assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
    }

    #[test]
    fn prepare_issue_session_launch_blocks_when_worktree_already_occupied() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-16");
        create_git_repo(&repo_dir);
        git(
            &repo_dir,
            &[
                "worktree",
                "add",
                "-b",
                "issue-16",
                worktree_path.to_string_lossy().as_ref(),
                "devlop",
            ],
        );

        let database = setup_session_list_database();
        database
            .execute(
                "UPDATE projects SET repo_path = ?1 WHERE id = 1",
                params![repo_dir.to_string_lossy().to_string()],
            )
            .expect("update project repo");
        insert_issue_row(&database, 16, "backlog");
        // 退回 Backlog 后旧 session 被软删，但 worktree 目录与分支仍残留。
        insert_worktree_session_row(
            &database,
            30,
            16,
            worktree_path.to_string_lossy().as_ref(),
            "issue-16",
            WorktreeOwner::Redwhisk,
            true,
        );

        let service = test_agent_session_service(&database);
        let result = service.prepare_issue_session_launch(
            temp_dir.path(),
            &StartAgentSessionInput {
                project_id: 1,
                issue_id: 16,
                agent_profile_id: 101,
                prompt_snapshot: "do something".to_string(),
                workflow_skill_name: None,
                workspace_mode: Some(WorkspaceMode::Worktree),
                target_branch: Some("devlop".to_string()),
                worktree_setup_command: None,
            },
        );
        let error = match result {
            Err(error) => error,
            Ok(_) => panic!("expected occupied worktree error"),
        };

        assert_eq!(error.code, CommandErrorCode::IssueWorktreeOccupied);
    }

    #[test]
    fn reconcile_marks_unrecoverable_running_session_stopped() {
        // 回归基线：DB 中存在 running session，既不在 pty 也不在 agent_registry，
        // reconcile 应将其标记为 stopped（模拟 app 重启后的遗留 session 清理）。
        let connection = setup_session_list_database();
        insert_session_list_row(
            &connection,
            40,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            100,
            None,
        );
        let service = test_agent_session_service(&connection);
        let pty_sessions = crate::agent::pty_session_manager::PtySessionManager::new();
        let registry = crate::agent::session_registry::AgentSessionRegistry::new();

        service
            .reconcile_unrecoverable_running_sessions(1, &pty_sessions, &registry)
            .expect("reconcile");

        let session = AgentSessionRepository::new(&connection)
            .find_by_id(40)
            .expect("query")
            .expect("session exists");
        assert_eq!(session.status, AgentSessionStatus::Stopped);
    }

    #[test]
    fn reconcile_skips_session_marked_starting() {
        // 核心回归：start/resume 路径在 DB 写入 running 之后、register 真实 handle 之前
        // 调用 mark_starting。并发触发的 reconcile 此时 contains 返回 true，应跳过，
        // 不把刚创建的session 误判为"重启遗留"而标记 stopped。
        let connection = setup_session_list_database();
        insert_session_list_row(
            &connection,
            41,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            100,
            None,
        );
        let service = test_agent_session_service(&connection);
        let pty_sessions = crate::agent::pty_session_manager::PtySessionManager::new();
        let registry = crate::agent::session_registry::AgentSessionRegistry::new();
        // 模拟 start 闭包内 DB commit 之后、handle 启动之前的窗口。
        registry.mark_starting(41);
        assert!(registry.contains(41));
        assert!(registry.get(41).is_none()); // 尚无真实 handle

        service
            .reconcile_unrecoverable_running_sessions(1, &pty_sessions, &registry)
            .expect("reconcile");

        let session = AgentSessionRepository::new(&connection)
            .find_by_id(41)
            .expect("query")
            .expect("session exists");
        assert_eq!(
            session.status,
            AgentSessionStatus::Running,
            "starting 标记的 session 不应被 reconcile 误杀"
        );
    }


    struct ControllableHandle {
        thread_id: Option<String>,
        send_error: Option<String>,
        shutdown_count: Arc<std::sync::Mutex<u32>>,
    }

    impl AgentSessionHandle for ControllableHandle {
        fn send_message(
            &self,
            _text: String,
            _attachments: Vec<AgentMessageAttachment>,
        ) -> Result<(), AgentSessionError> {
            if let Some(message) = &self.send_error {
                return Err(AgentSessionError::Protocol(message.clone()));
            }
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

        fn shutdown(&self) {
            *self.shutdown_count.lock().expect("lock") += 1;
        }

        fn thread_id(&self) -> Option<String> {
            self.thread_id.clone()
        }
    }

    struct ScriptedProviderFactory {
        result: std::sync::Mutex<Option<Result<crate::agent::provider_factory::StartedSession, AgentSessionError>>>,
    }

    impl crate::agent::provider_factory::AgentSessionProviderFactory for ScriptedProviderFactory {
        fn start(
            &self,
            _request: crate::agent::provider_factory::AgentSessionStartRequest,
        ) -> Result<crate::agent::provider_factory::StartedSession, AgentSessionError> {
            self.result
                .lock()
                .expect("lock")
                .take()
                .expect("factory result already consumed")
        }
    }

    fn issue_launch_context() -> super::SessionLaunchContext {
        super::SessionLaunchContext {
            profile: test_agent_profile(AgentType::Codex, "codex"),
            working_dir: std::env::temp_dir().to_string_lossy().to_string(),
            log_path: "/tmp/redwhisk-test.log".to_string(),
            command_snapshot: "codex".to_string(),
            started_at: current_millis(),
            workspace_mode: WorkspaceMode::CurrentBranch,
            target_branch: None,
            workspace_branch: None,
            workspace_path: None,
            origin_branch: None,
            worktree_owner: WorktreeOwner::External,
            worktree_root_path: None,
            worktree_setup_command: None,
        }
    }

    fn seed_running_issue_session(connection: &Connection, issue_id: i64, session_id: i64) {
        insert_session_list_row(
            connection,
            session_id,
            Some(issue_id),
            Some("running issue"),
            Some("running"),
            AgentSessionStatus::Running,
            100,
            None,
        );
    }

    fn base_start_request(
        broadcaster: &crate::agent::agent_event_broadcaster::AgentEventBroadcaster,
        session_id: i64,
    ) -> crate::agent::provider_factory::AgentSessionStartRequest {
        crate::agent::provider_factory::AgentSessionStartRequest {
            agent_type: AgentType::Codex,
            project_id: 1,
            session_id,
            binary: "codex".to_string(),
            cwd: std::env::temp_dir().to_string_lossy().to_string(),
            mode_id: Some("full-access".to_string()),
            dangerous: false,
            model: None,
            effort: None,
            resume_thread_id: None,
            broadcaster: broadcaster.clone(),
            config_home: None,
        }
    }

    #[test]
    fn finish_issue_provider_start_rolls_back_when_factory_fails() {
        let connection = setup_session_list_database();
        seed_running_issue_session(&connection, 50, 500);
        let service = test_agent_session_service(&connection);
        let registry = crate::agent::session_registry::AgentSessionRegistry::new();
        let broadcaster = crate::agent::agent_event_broadcaster::AgentEventBroadcaster::new();
        let factory = ScriptedProviderFactory {
            result: std::sync::Mutex::new(Some(Err(AgentSessionError::NotRunning(
                "spawn failed".into(),
            )))),
        };
        let launch = issue_launch_context();
        let error = service
            .finish_structured_issue_provider_start(
                &factory,
                base_start_request(&broadcaster, 500),
                &registry,
                &broadcaster,
                "do work",
                1,
                50,
                500,
                &launch,
                None,
            )
            .expect_err("factory failure should surface");
        assert_eq!(error.code, CommandErrorCode::AgentSessionNotRunning);
        assert!(!registry.contains(500));
        // soft delete 后 find_by_id 过滤 del；以 issue 回到 backlog 为准。
        assert!(
            AgentSessionRepository::new(&connection)
                .find_by_id(500)
                .expect("query")
                .is_none()
        );
        let issue = IssueRepository::new(&connection)
            .find_by_id(50)
            .expect("issue query")
            .expect("issue");
        assert_eq!(format!("{:?}", issue.status).to_lowercase(), "backlog");
    }

    #[test]
    fn finish_issue_provider_start_rolls_back_when_required_thread_id_missing() {
        let connection = setup_session_list_database();
        seed_running_issue_session(&connection, 51, 501);
        let service = test_agent_session_service(&connection);
        let registry = crate::agent::session_registry::AgentSessionRegistry::new();
        let broadcaster = crate::agent::agent_event_broadcaster::AgentEventBroadcaster::new();
        let shutdown_count = Arc::new(std::sync::Mutex::new(0));
        let factory = ScriptedProviderFactory {
            result: std::sync::Mutex::new(Some(Ok(crate::agent::provider_factory::StartedSession {
                handle: Arc::new(ControllableHandle {
                    thread_id: None,
                    send_error: None,
                    shutdown_count: Arc::clone(&shutdown_count),
                }),
                thread_id: None,
                backfill: crate::agent::provider_factory::ThreadIdBackfill::Required,
            }))),
        };
        let launch = issue_launch_context();
        let error = service
            .finish_structured_issue_provider_start(
                &factory,
                base_start_request(&broadcaster, 501),
                &registry,
                &broadcaster,
                "do work",
                1,
                51,
                501,
                &launch,
                None,
            )
            .expect_err("missing thread id should fail");
        assert_eq!(error.code, CommandErrorCode::AgentSessionStreamFailed);
        assert!(!registry.contains(501));
        assert_eq!(*shutdown_count.lock().expect("lock"), 1);
        let issue = IssueRepository::new(&connection)
            .find_by_id(51)
            .expect("issue query")
            .expect("issue");
        assert_eq!(format!("{:?}", issue.status).to_lowercase(), "backlog");
    }

    #[test]
    fn finish_issue_provider_start_rolls_back_when_initial_send_fails() {
        let connection = setup_session_list_database();
        seed_running_issue_session(&connection, 52, 502);
        let service = test_agent_session_service(&connection);
        let registry = crate::agent::session_registry::AgentSessionRegistry::new();
        let broadcaster = crate::agent::agent_event_broadcaster::AgentEventBroadcaster::new();
        let shutdown_count = Arc::new(std::sync::Mutex::new(0));
        let factory = ScriptedProviderFactory {
            result: std::sync::Mutex::new(Some(Ok(crate::agent::provider_factory::StartedSession {
                handle: Arc::new(ControllableHandle {
                    thread_id: Some("thread-1".into()),
                    send_error: Some("send failed".into()),
                    shutdown_count: Arc::clone(&shutdown_count),
                }),
                thread_id: Some("thread-1".into()),
                backfill: crate::agent::provider_factory::ThreadIdBackfill::Required,
            }))),
        };
        let launch = issue_launch_context();
        let error = service
            .finish_structured_issue_provider_start(
                &factory,
                base_start_request(&broadcaster, 502),
                &registry,
                &broadcaster,
                "do work",
                1,
                52,
                502,
                &launch,
                None,
            )
            .expect_err("send failure should fail");
        assert_eq!(error.code, CommandErrorCode::AgentSessionStreamFailed);
        assert!(!registry.contains(502));
        assert_eq!(*shutdown_count.lock().expect("lock"), 1);
        let issue = IssueRepository::new(&connection)
            .find_by_id(52)
            .expect("issue query")
            .expect("issue");
        assert_eq!(format!("{:?}", issue.status).to_lowercase(), "backlog");
    }

    #[test]
    fn finish_issue_provider_start_registers_handle_on_success() {
        let connection = setup_session_list_database();
        seed_running_issue_session(&connection, 53, 503);
        let service = test_agent_session_service(&connection);
        let registry = crate::agent::session_registry::AgentSessionRegistry::new();
        let broadcaster = crate::agent::agent_event_broadcaster::AgentEventBroadcaster::new();
        let factory = ScriptedProviderFactory {
            result: std::sync::Mutex::new(Some(Ok(crate::agent::provider_factory::StartedSession {
                handle: Arc::new(ControllableHandle {
                    thread_id: Some("thread-ok".into()),
                    send_error: None,
                    shutdown_count: Arc::new(std::sync::Mutex::new(0)),
                }),
                thread_id: Some("thread-ok".into()),
                backfill: crate::agent::provider_factory::ThreadIdBackfill::Required,
            }))),
        };
        let launch = issue_launch_context();
        service
            .finish_structured_issue_provider_start(
                &factory,
                base_start_request(&broadcaster, 503),
                &registry,
                &broadcaster,
                "do work",
                1,
                53,
                503,
                &launch,
                None,
            )
            .expect("success");
        assert!(registry.get(503).is_some());
        let session = AgentSessionRepository::new(&connection)
            .find_by_id(503)
            .expect("query")
            .expect("session");
        assert_eq!(session.codex_session_id.as_deref(), Some("thread-ok"));
        assert_eq!(session.status, AgentSessionStatus::Running);
        let issue = IssueRepository::new(&connection)
            .find_by_id(53)
            .expect("issue query")
            .expect("issue");
        assert_eq!(format!("{:?}", issue.status).to_lowercase(), "running");
    }


    #[test]
    fn finish_standalone_provider_start_rolls_back_when_factory_fails() {
        let connection = setup_session_list_database();
        insert_session_list_row(
            &connection,
            600,
            None,
            None,
            None,
            AgentSessionStatus::Running,
            100,
            None,
        );
        let service = test_agent_session_service(&connection);
        let registry = crate::agent::session_registry::AgentSessionRegistry::new();
        let broadcaster = crate::agent::agent_event_broadcaster::AgentEventBroadcaster::new();
        registry.mark_starting(600);
        let factory = ScriptedProviderFactory {
            result: std::sync::Mutex::new(Some(Err(AgentSessionError::NotRunning(
                "spawn failed".into(),
            )))),
        };
        let error = service
            .finish_structured_standalone_provider_start(
                &factory,
                base_start_request(&broadcaster, 600),
                &registry,
                &broadcaster,
                600,
            )
            .expect_err("should fail");
        assert_eq!(error.code, CommandErrorCode::AgentSessionNotRunning);
        assert!(!registry.contains(600));
        assert!(
            AgentSessionRepository::new(&connection)
                .find_by_id(600)
                .expect("query")
                .is_none()
        );
    }

    #[test]
    fn resume_structured_session_short_circuits_when_already_registered() {
        let connection = setup_session_list_database();
        insert_session_list_row(
            &connection,
            601,
            None,
            None,
            None,
            AgentSessionStatus::Stopped,
            100,
            Some(200),
        );
        // 写入可续接 thread id
        connection
            .execute(
                "UPDATE agent_sessions SET codex_session_id = 'thread-resume', status = 'stopped' WHERE id = 601",
                [],
            )
            .expect("set thread id");
        let service = test_agent_session_service(&connection);
        let registry = crate::agent::session_registry::AgentSessionRegistry::new();
        let broadcaster = crate::agent::agent_event_broadcaster::AgentEventBroadcaster::new();
        registry.register(
            601,
            Arc::new(ControllableHandle {
                thread_id: Some("thread-active".into()),
                send_error: None,
                shutdown_count: Arc::new(std::sync::Mutex::new(0)),
            }),
        );
        let result = service
            .resume_structured_agent_session(
                std::env::temp_dir().as_path(),
                crate::types::agent_session::ResumeStructuredAgentSessionInput {
                    project_id: 1,
                    session_id: 601,
                },
                &registry,
                &broadcaster,
            )
            .expect("resume short circuit");
        assert_eq!(result.session_id, 601);
        assert_eq!(result.thread_id, "thread-active");
    }


    fn branch_exists(repo_dir: &Path, branch: &str) -> bool {
        let output = Command::new("git")
            .args([
                "show-ref",
                "--verify",
                "--quiet",
                &format!("refs/heads/{branch}"),
            ])
            .current_dir(repo_dir)
            .output()
            .expect("verify branch");
        output.status.success()
    }
}
