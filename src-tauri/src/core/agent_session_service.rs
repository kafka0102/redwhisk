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

use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::codex_app_server::session::CodexMode;
use crate::agent::codex_app_server::{CodexSessionConfig, CodexSessionHandle};
use crate::agent::pty_session_manager::{
    read_terminal_snapshot, PtyExitStatus, PtySessionManager, PtySpawnRequest,
};
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::agent::session_registry::AgentSessionRegistry;
use crate::core::issue_service::IssueService;
use crate::db::agent_profile_repository::{AgentProfileRepository, AgentProfileRow};
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::event_repository::EventRepository;
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::git::operation_state::GitOperationState;
use crate::git::status::read_git_snapshot;
use crate::git::worktree::{
    cleanup_worktree, create_worktree_for_issue, list_local_branches, GitBranchInfo,
};
use crate::types::agent_profile::{AgentScope, AgentType};
use crate::types::agent_session::{
    AgentSessionAttention, AgentSessionListItem, AgentSessionListResponse, AgentSessionPromptKind,
    AgentSessionStatus, InjectAgentSessionPromptInput, InjectAgentSessionPromptResult,
    ProjectGitBranchListInput, ProjectGitBranchListResult, ReadAgentSessionTerminalResult,
    ReadAgentTimelineResult, ResizeAgentSessionTerminalInput, RestoreAgentSessionTerminalInput,
    RestoreAgentSessionTerminalResult, ResumeStructuredAgentSessionInput,
    ResumeStructuredAgentSessionResult, SetAgentSessionAttentionInput,
    SetAgentSessionAttentionResult, StartAgentSessionInput, StartAgentSessionResult,
    StartStandaloneAgentSessionInput, StartStandaloneAgentSessionResult,
    StartStructuredAgentSessionInput, StartStructuredAgentSessionResult, WorkspaceMode,
    WriteAgentSessionTerminalInput,
};
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{
    CompleteIssueCleanInput, CompleteIssueManualInput, IssueRecord, IssueStatus,
};
use crate::types::issue_action::IssueActionType;
use crate::types::project::{ProjectCompletionPolicy, ProjectSummary, ProjectWorktreeLocation};
use crate::types::session_event::SessionEventType;

const SESSION_LOG_DIR_NAME: &str = "session-logs";
const CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG: &str = "--dangerously-bypass-approvals-and-sandbox";
const CODEX_DEFAULT_MODE_ID: &str = "full-access";
const CLAUDE_PERMISSION_MODE_ARG: &str = "--permission-mode";
const CLAUDE_BYPASS_PERMISSIONS_MODE: &str = "bypassPermissions";
const STARTUP_CHECK_TOTAL_MS: u64 = 500;
const STARTUP_CHECK_INTERVAL_MS: u64 = 25;
const CODEX_SESSION_CAPTURE_TOTAL_MS: u64 = 5_000;
const CODEX_SESSION_CAPTURE_INTERVAL_MS: u64 = 250;
const ATTENTION_SNAPSHOT_MAX_BYTES: usize = 32_768;
const TIMELINE_LOG_SNAPSHOT_MAX_BYTES: usize = 262_144;
const LATEST_OUTPUT_MAX_CHARS: usize = 500;
const AGENT_SESSION_COMPLETED_LIST_LIMIT: usize = 50;

struct SessionLaunchContext {
    profile: AgentProfileRow,
    working_dir: String,
    log_path: String,
    command_snapshot: String,
    started_at: i64,
    workspace_mode: WorkspaceMode,
    target_branch: Option<String>,
    workspace_branch: Option<String>,
    workspace_path: Option<String>,
    completion_policy: Option<ProjectCompletionPolicy>,
    worktree_root_path: Option<String>,
    worktree_setup_command: Option<String>,
}

pub struct AgentSessionService<'connection> {
    issue_repository: IssueRepository<'connection>,
    project_repository: ProjectRepository<'connection>,
    agent_profile_repository: AgentProfileRepository<'connection>,
    agent_session_repository: AgentSessionRepository<'connection>,
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
        if launch.profile.agent_type == AgentType::Codex {
            return self.start_structured_issue_agent_session(
                data_dir.as_ref(),
                input,
                launch,
                agent_registry,
                broadcaster,
            );
        }

        self.start_agent_session_internal_with_launch(data_dir, input, launch, Some(pty_sessions))
    }

    pub fn start_standalone_agent_session(
        &self,
        data_dir: impl AsRef<Path>,
        input: StartStandaloneAgentSessionInput,
    ) -> Result<StartStandaloneAgentSessionResult, CommandError> {
        self.start_standalone_agent_session_internal(data_dir, input, None)
    }

    pub fn start_standalone_agent_session_with_pty(
        &self,
        data_dir: impl AsRef<Path>,
        input: StartStandaloneAgentSessionInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<StartStandaloneAgentSessionResult, CommandError> {
        self.start_standalone_agent_session_internal(data_dir, input, Some(pty_sessions))
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
                CommandError::new(CommandErrorCode::IssueNotFound, "Issue 不存在。")
                    .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            })?;

        if issue.project_id != input.project_id {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Issue 不属于当前 Project。",
            )
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
            )
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
            let mut child = spawn_agent_process(
                &launch.profile,
                &launch.working_dir,
                &launch.log_path,
                initial_prompt_argument.as_deref(),
            )?;
            ensure_process_started(&mut child, &launch.command_snapshot)?;
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
                &launch.working_dir,
                &launch.command_snapshot,
                &prompt_snapshot,
                &launch.workspace_mode,
                launch.target_branch.as_deref(),
                launch.workspace_branch.as_deref(),
                launch.workspace_path.as_deref(),
                launch.completion_policy,
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
    ) -> Result<StartAgentSessionResult, CommandError> {
        let prompt_snapshot = validate_prompt_snapshot(&input.prompt_snapshot)?;
        let issue = self
            .issue_repository
            .find_by_id(input.issue_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::IssueNotFound, "Issue 不存在。")
                    .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            })?;

        if issue.project_id != input.project_id {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Issue 不属于当前 Project。",
            )
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
            )
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", input.issue_id))
            .with_detail(
                ErrorDetail::new("IssueStatus")
                    .with_value("status", format!("{:?}", issue.status).to_lowercase()),
            ));
        }

        let structured_log_path =
            build_structured_log_path(data_dir, input.project_id, launch.started_at)?;
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
                &launch.working_dir,
                &launch.command_snapshot,
                &prompt_snapshot,
                &launch.workspace_mode,
                launch.target_branch.as_deref(),
                launch.workspace_branch.as_deref(),
                launch.workspace_path.as_deref(),
                launch.completion_policy,
                launch.worktree_root_path.as_deref(),
                launch.worktree_setup_command.as_deref(),
                &structured_log_path,
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
                "structuredStream": true,
                "logPath": structured_log_path,
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
        let mode = codex_mode_from_profile(&launch.profile)?;
        let config = CodexSessionConfig {
            project_id: input.project_id,
            session_id: result.session_id,
            binary: launch.command_snapshot.clone(),
            cwd: launch.working_dir.clone(),
            mode,
            broadcaster: broadcaster.clone(),
            resume_thread_id: None,
            model: None,
            effort: None,
        };
        let codex_handle = match CodexSessionHandle::start(config) {
            Ok(handle) => handle,
            Err(error) => {
                let _ = self.rollback_failed_structured_issue_session(
                    input.project_id,
                    input.issue_id,
                    result.session_id,
                );
                return Err(agent_session_error_to_command_error(error.into()));
            }
        };
        let thread_id = codex_handle.thread_id().ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::AgentSessionStreamFailed,
                "Agent 会话启动后未拿到 threadId。",
            )
            .with_detail(
                ErrorDetail::new("AgentSession").with_value("sessionId", result.session_id),
            )
        })?;
        self.agent_session_repository
            .update_codex_session_id(result.session_id, &thread_id)
            .map_err(agent_session_database_error)?;

        broadcaster.register_session(result.session_id);
        let handle: Arc<dyn AgentSessionHandle> = Arc::new(codex_handle);
        if let Err(error) = handle.send_message(prompt_snapshot, Vec::new()) {
            handle.shutdown();
            let _ = self.rollback_failed_structured_issue_session(
                input.project_id,
                input.issue_id,
                result.session_id,
            );
            return Err(agent_session_error_to_command_error(error));
        }
        agent_registry.register(result.session_id, handle);

        Ok(result)
    }

    fn rollback_failed_structured_issue_session(
        &self,
        project_id: i64,
        issue_id: i64,
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
        IssueRepository::update_status_in_transaction(
            &transaction,
            project_id,
            issue_id,
            IssueStatus::Backlog,
        )
        .map_err(agent_session_database_error)?;
        transaction.commit().map_err(agent_session_database_error)?;
        Ok(())
    }

    fn start_standalone_agent_session_internal(
        &self,
        data_dir: impl AsRef<Path>,
        input: StartStandaloneAgentSessionInput,
        pty_sessions: Option<&PtySessionManager>,
    ) -> Result<StartStandaloneAgentSessionResult, CommandError> {
        let prompt_snapshot = validate_prompt_snapshot(&input.prompt_snapshot)?;
        let title = validate_session_title(&input.title)?;
        let (profile, working_dir, log_path, command_snapshot, started_at) = self
            .prepare_session_launch(
                data_dir.as_ref(),
                input.project_id,
                input.agent_profile_id,
                &format!("project-{}-standalone", input.project_id),
            )?;

        let command_accepts_prompt_argument = command_supports_prompt_argument(&command_snapshot);
        let initial_prompt_argument =
            command_accepts_prompt_argument.then(|| prompt_snapshot.clone());

        let pending_pty = if let Some(pty_sessions) = pty_sessions {
            Some(
                pty_sessions
                    .spawn_pending(&PtySpawnRequest {
                        command: command_snapshot.clone(),
                        working_dir: working_dir.clone(),
                        log_path: log_path.clone(),
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
            let mut child = spawn_agent_process(
                &profile,
                &working_dir,
                &log_path,
                initial_prompt_argument.as_deref(),
            )?;
            ensure_process_started(&mut child, &command_snapshot)?;
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

        let transaction_result: Result<StartStandaloneAgentSessionResult, rusqlite::Error> =
            (|| {
                let session = AgentSessionRepository::insert_standalone_in_transaction(
                    &transaction,
                    input.project_id,
                    &title,
                    input.agent_profile_id,
                    &working_dir,
                    &command_snapshot,
                    &prompt_snapshot,
                    &WorkspaceMode::CurrentBranch,
                    None,
                    None,
                    Some(working_dir.as_str()),
                    None,
                    None,
                    None,
                    &log_path,
                    started_at,
                )?;

                let session_event_payload = json!({
                    "sessionId": session.id,
                    "projectId": input.project_id,
                    "issueId": Value::Null,
                    "agentProfileId": input.agent_profile_id,
                    "title": title,
                    "status": "running",
                    "logPath": log_path,
                })
                .to_string();
                EventRepository::insert_session_event_in_transaction(
                    &transaction,
                    session.id,
                    SessionEventType::SessionStarted,
                    &session_event_payload,
                    started_at,
                )?;

                transaction.commit()?;

                Ok(StartStandaloneAgentSessionResult {
                    session_id: session.id,
                })
            })();

        match transaction_result {
            Ok(result) => {
                if should_attempt_codex_session_capture(&command_snapshot) {
                    let data_dir = data_dir.as_ref().to_path_buf();
                    let working_dir = working_dir.clone();
                    let session_id = result.session_id;
                    thread::spawn(move || {
                        refresh_codex_session_id_in_data_dir(
                            &data_dir,
                            session_id,
                            &working_dir,
                            started_at,
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
                Err(agent_session_database_error(error))
            }
        }
    }

    fn prepare_session_launch(
        &self,
        data_dir: &Path,
        project_id: i64,
        agent_profile_id: i64,
        log_name: &str,
    ) -> Result<(AgentProfileRow, String, String, String, i64), CommandError> {
        let project = self
            .project_repository
            .find_by_id(project_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            })?;

        let profile = self
            .agent_profile_repository
            .find_profile_by_id(agent_profile_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "Agent Profile 不存在。",
                )
                .with_detail(
                    ErrorDetail::new("AgentProfile").with_value("agentProfileId", agent_profile_id),
                )
            })?;

        validate_profile_not_deleted(&profile)?;
        validate_profile_scope(&profile, project_id)?;

        let started_at = current_epoch_millis()?;
        let working_dir = validate_working_dir(&project.repo_path)?;
        let log_path = build_log_path(data_dir, log_name, agent_profile_id, started_at)?;
        let command_snapshot = build_command_snapshot(&profile);

        Ok((profile, working_dir, log_path, command_snapshot, started_at))
    }

    fn prepare_issue_session_launch(
        &self,
        data_dir: &Path,
        input: &StartAgentSessionInput,
    ) -> Result<SessionLaunchContext, CommandError> {
        let project = self.project_by_id(input.project_id)?;
        let profile = self
            .agent_profile_repository
            .find_profile_by_id(input.agent_profile_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "Agent Profile 不存在。",
                )
                .with_detail(
                    ErrorDetail::new("AgentProfile")
                        .with_value("agentProfileId", input.agent_profile_id),
                )
            })?;

        validate_profile_not_deleted(&profile)?;
        validate_profile_scope(&profile, input.project_id)?;

        let started_at = current_epoch_millis()?;
        let log_path = build_log_path(
            data_dir,
            &format!("issue-{}", input.issue_id),
            input.agent_profile_id,
            started_at,
        )?;
        let command_snapshot = if profile.agent_type == AgentType::Codex {
            build_structured_command_snapshot(&profile)
        } else {
            build_command_snapshot(&profile)
        };
        let branch_info =
            list_local_branches(&project.repo_path).map_err(agent_session_start_error)?;
        let workspace_mode = input
            .workspace_mode
            .clone()
            .unwrap_or(WorkspaceMode::CurrentBranch);
        let completion_policy = Some(
            input
                .completion_policy_override
                .unwrap_or(project.completion_policy),
        );
        let worktree_setup_command = Some(
            input
                .worktree_setup_command
                .as_deref()
                .unwrap_or(&project.worktree_setup_command)
                .trim()
                .to_string(),
        );

        match workspace_mode {
            WorkspaceMode::CurrentBranch => Ok(SessionLaunchContext {
                profile,
                working_dir: validate_working_dir(&project.repo_path)?,
                log_path,
                command_snapshot,
                started_at,
                workspace_mode: WorkspaceMode::CurrentBranch,
                target_branch: Some(branch_info.current_branch.clone()),
                workspace_branch: Some(branch_info.current_branch),
                workspace_path: Some(project.repo_path.clone()),
                completion_policy,
                worktree_root_path: None,
                worktree_setup_command: worktree_setup_command.clone(),
            }),
            WorkspaceMode::Worktree => {
                let target_branch =
                    resolve_target_branch(&branch_info, input.target_branch.as_deref())?;
                let worktree_root_path = resolve_worktree_root_path(&project)?;
                let created = create_worktree_for_issue(
                    &project.repo_path,
                    &worktree_root_path,
                    input.issue_id,
                    &target_branch,
                )
                .map_err(agent_session_start_error)?;
                if let Err(error) = run_worktree_setup_command(
                    &created.workspace_path,
                    worktree_setup_command.as_deref(),
                ) {
                    let _ = cleanup_worktree(
                        &project.repo_path,
                        &created.workspace_path,
                        &created.workspace_branch,
                    );
                    return Err(error);
                }

                Ok(SessionLaunchContext {
                    profile,
                    working_dir: created.workspace_path.clone(),
                    log_path,
                    command_snapshot,
                    started_at,
                    workspace_mode: WorkspaceMode::Worktree,
                    target_branch: Some(created.target_branch),
                    workspace_branch: Some(created.workspace_branch),
                    workspace_path: Some(created.workspace_path),
                    completion_policy,
                    worktree_root_path: Some(created.worktree_root_path),
                    worktree_setup_command,
                })
            }
        }
    }

    pub fn list_agent_sessions(
        &self,
        project_id: i64,
    ) -> Result<AgentSessionListResponse, CommandError> {
        let project = self.project_by_id(project_id)?;
        let (can_complete_clean_for_project, can_complete_agent_commit_for_project) =
            project_completion_capabilities(&project.repo_path, project.completion_policy);

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
                    issue_id: row.issue_id,
                    issue_title: row.issue_title,
                    issue_status: row.issue_status,
                    agent_profile_id: row.agent_profile_id,
                    can_complete_clean,
                    can_complete_agent_commit,
                    title: row.title,
                    agent_type: row.agent_type,
                    status: row.status,
                    attention: row.attention,
                    is_turn_running: is_session_running
                        && is_structured_turn_running(&row.log_path)
                            .unwrap_or(None)
                            .unwrap_or(true),
                    workspace_mode: row.workspace_mode,
                    working_dir: row.working_dir,
                    workspace_path: row.workspace_path,
                    log_path: row.log_path,
                    latest_output,
                    last_active_at: row.last_active_at,
                    started_at: row.started_at,
                    closed_at: row.closed_at,
                }
            })
            .collect();

        Ok(AgentSessionListResponse { sessions })
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

    fn project_by_id(
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

    pub fn read_terminal_snapshot(
        &self,
        project_id: i64,
        session_id: i64,
        max_bytes: usize,
        pty_sessions: &PtySessionManager,
    ) -> Result<ReadAgentSessionTerminalResult, CommandError> {
        let session = self.find_project_session(project_id, session_id)?;
        let snapshot = read_terminal_snapshot(Path::new(&session.log_path), max_bytes)
            .map_err(agent_session_start_error)?;
        self.reconcile_running_session_attention(session_id, Some(snapshot.as_str()))?;

        Ok(ReadAgentSessionTerminalResult {
            session_id,
            snapshot,
            // attention is persisted above; the terminal bridge only needs liveness here.
            is_active: pty_sessions.contains(session_id),
        })
    }

    pub fn write_terminal_input(
        &self,
        input: WriteAgentSessionTerminalInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        self.find_project_session(input.project_id, input.session_id)?;
        if input.data.is_empty() {
            return Ok(());
        }

        pty_sessions
            .write_input(input.session_id, &input.data)
            .map_err(inactive_terminal_error)?;

        self.clear_attention_after_successful_input(input.session_id)?;
        Ok(())
    }

    pub fn restore_terminal(
        &self,
        input: RestoreAgentSessionTerminalInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<RestoreAgentSessionTerminalResult, CommandError> {
        self.find_project_session(input.project_id, input.session_id)?;
        let snapshot = match pty_sessions.restore_snapshot(input.session_id) {
            Ok(snapshot) => snapshot,
            Err(error) if error == "session not found" => {
                return Ok(RestoreAgentSessionTerminalResult {
                    session_id: input.session_id,
                    sequence: 0,
                    chunks: Vec::new(),
                    is_complete: false,
                    is_active: false,
                });
            }
            Err(error) => return Err(inactive_terminal_error(error)),
        };

        Ok(RestoreAgentSessionTerminalResult {
            session_id: snapshot.session_id,
            sequence: snapshot.sequence,
            chunks: snapshot.chunks,
            is_complete: snapshot.is_complete,
            is_active: true,
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
            )
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
                )
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
    ) -> Result<InjectAgentSessionPromptResult, CommandError> {
        let prompt = validate_injected_prompt(&input.prompt)?;
        let session = self.find_project_session(input.project_id, input.session_id)?;
        let submitted_prompt = normalize_submitted_prompt(&prompt);

        pty_sessions
            .write_input(input.session_id, &submitted_prompt)
            .map_err(inactive_terminal_error)?;
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

    pub fn resize_terminal(
        &self,
        input: ResizeAgentSessionTerminalInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        self.find_project_session(input.project_id, input.session_id)?;
        pty_sessions
            .resize(input.session_id, input.rows, input.cols)
            .map_err(inactive_terminal_error)
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
                CommandError::new(CommandErrorCode::IssueNotFound, "Agent Session 不存在。")
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
                CommandError::new(CommandErrorCode::IssueNotFound, "Agent Session 不存在。")
                    .with_detail(
                        ErrorDetail::new("AgentSession").with_value("sessionId", session_id),
                    )
            })?;

        if session.project_id != project_id {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Agent Session 不属于当前 Project。",
            )
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

    pub fn read_agent_timeline(
        &self,
        project_id: i64,
        session_id: i64,
        handle: Option<Arc<dyn AgentSessionHandle>>,
    ) -> Result<ReadAgentTimelineResult, CommandError> {
        let session = self.find_project_session(project_id, session_id)?;

        if let Some(handle) = handle {
            match handle.read_timeline() {
                Ok(items) => return Ok(ReadAgentTimelineResult { items }),
                Err(AgentSessionError::NotRunning(_)) => {}
                Err(error) => return Err(agent_session_error_to_command_error(error)),
            }
        }

        let items = read_timeline_from_session_log(&session)?;
        Ok(ReadAgentTimelineResult { items })
    }
}

fn project_completion_capabilities(
    repo_path: &str,
    completion_policy: crate::types::project::ProjectCompletionPolicy,
) -> (bool, bool) {
    if completion_policy != crate::types::project::ProjectCompletionPolicy::AgentAutoCommit {
        return (false, false);
    }

    match read_git_snapshot(repo_path) {
        Ok(snapshot) if snapshot.operation_state == GitOperationState::None => {
            (snapshot.is_clean, !snapshot.is_clean)
        }
        _ => (false, false),
    }
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

    pub fn start_standalone_agent_session_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: StartStandaloneAgentSessionInput,
    ) -> Result<StartStandaloneAgentSessionResult, CommandError> {
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
        .start_standalone_agent_session(data_dir, input)
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
                    )
                    .with_detail(
                        ErrorDetail::new("AgentProfile").with_value("agentProfileId", profile_id),
                    )
                })?;
            validate_profile_not_deleted(&profile)?;
            validate_profile_scope(&profile, input.project_id)?;
            (
                profile.id,
                profile.agent_type.clone(),
                ensure_codex_bypass_arg(&profile.command),
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
                    profile.agent_type,
                    ensure_codex_bypass_arg(&profile.command),
                )
            } else {
                let requested_agent_type_literal = match requested_agent_type {
                    AgentType::Codex => "codex",
                    AgentType::Claude => "claude",
                };
                return Err(CommandError::new(
                    CommandErrorCode::AgentProfileValidationFailed,
                    "未找到可用于当前 Agent 类型的 Agent Profile。",
                )
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
        let log_path = build_structured_log_path(data_dir, input.project_id, started_at)?;

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
                &log_path,
                started_at,
            )?;
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

        // 按 agent_type 分支构造具体 provider 句柄。当前仅 Codex 有实现；
        // 其他类型返回「暂不支持」。新增 Claude 等时在此扩展分支。
        let handle: Arc<dyn AgentSessionHandle> = match agent_type {
            AgentType::Codex => {
                let mode =
                    codex_mode_from_structured_input(input.mode.as_deref()).ok_or_else(|| {
                        CommandError::new(
                            CommandErrorCode::AgentSessionValidationFailed,
                            "不支持的协作模式。",
                        )
                        .with_detail(ErrorDetail::new("Field").with_value("name", "mode"))
                        .with_detail(
                            ErrorDetail::new("Value").with_value("mode", input.mode.clone()),
                        )
                    })?;
                let config = CodexSessionConfig {
                    project_id: input.project_id,
                    session_id,
                    binary: command_snapshot,
                    cwd: cwd.clone(),
                    mode,
                    broadcaster: broadcaster.clone(),
                    resume_thread_id: input.resume_from_codex_session_id.clone(),
                    model: input.model.clone(),
                    effort: input.effort.clone(),
                };
                let codex_handle = CodexSessionHandle::start(config)
                    .map_err(|e| agent_session_error_to_command_error(e.into()))?;
                Arc::new(codex_handle)
            }
            AgentType::Claude => {
                return Err(CommandError::new(
                    CommandErrorCode::AgentSessionValidationFailed,
                    "暂不支持的 agent 类型。",
                )
                .with_detail(ErrorDetail::new("Field").with_value("name", "agentType"))
                .with_detail(ErrorDetail::new("Value").with_value("agentType", "claude")));
            }
        };
        let thread_id = handle.thread_id().ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::AgentSessionStreamFailed,
                "Agent 会话启动后未拿到 threadId。",
            )
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id))
        })?;

        // 回填 codex_session_id（agent threadId）。
        self.agent_session_repository
            .update_codex_session_id(session_id, &thread_id)
            .map_err(agent_session_database_error)?;

        // 注册到 broadcaster / registry，供前端订阅与后续命令取用。
        broadcaster.register_session(session_id);
        agent_registry.register(session_id, handle);

        Ok(StartStructuredAgentSessionResult {
            session_id,
            thread_id,
        })
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
                    CommandError::new(CommandErrorCode::IssueNotFound, "Issue 不存在。")
                        .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue_id))
                })?;
            if issue.status == IssueStatus::Completed {
                return Err(CommandError::new(
                    CommandErrorCode::AgentSessionValidationFailed,
                    "已完成 Issue 的 Session 不能继续运行。",
                )
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
                    "当前 Session 缺少可续接的 Codex threadId。",
                )
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
        let cwd = session
            .workspace_path
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| session.working_dir.clone());
        let mode = codex_mode_from_structured_input(None).ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "不支持的协作模式。",
            )
            .with_detail(ErrorDetail::new("Field").with_value("name", "mode"))
        })?;
        let config = CodexSessionConfig {
            project_id: input.project_id,
            session_id: session.id,
            binary,
            cwd,
            mode,
            broadcaster: broadcaster.clone(),
            resume_thread_id: Some(thread_id),
            model: None,
            effort: None,
        };
        let codex_handle = CodexSessionHandle::start(config)
            .map_err(|error| agent_session_error_to_command_error(error.into()))?;
        let resumed_thread_id = codex_handle.thread_id().ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::AgentSessionStreamFailed,
                "Agent 会话启动后未拿到 threadId。",
            )
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session.id))
        })?;

        if let Err(error) = self.mark_structured_session_resumed(&session, &resumed_thread_id) {
            codex_handle.shutdown();
            return Err(error);
        }

        broadcaster.register_session(session.id);
        agent_registry.register(session.id, Arc::new(codex_handle));

        Ok(ResumeStructuredAgentSessionResult {
            session_id: session.id,
            thread_id: resumed_thread_id,
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
            )
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
    ) -> Result<AgentSessionListResponse, CommandError> {
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
        .reconcile_unrecoverable_running_sessions(
            project_id,
            pty_sessions,
            agent_registry,
        )?;

        AgentSessionService::new(
            IssueRepository::new(&database.connection),
            ProjectRepository::new(&database.connection),
            AgentProfileRepository::new(&database.connection),
            AgentSessionRepository::new(&database.connection),
        )
        .list_agent_sessions(project_id)
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
                        )
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
                        )
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

    pub fn read_terminal_snapshot_in_data_dir(
        data_dir: impl AsRef<Path>,
        project_id: i64,
        session_id: i64,
        max_bytes: usize,
        pty_sessions: &PtySessionManager,
    ) -> Result<ReadAgentSessionTerminalResult, CommandError> {
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
        .read_terminal_snapshot(project_id, session_id, max_bytes, pty_sessions)
    }

    pub fn write_terminal_input_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: WriteAgentSessionTerminalInput,
        pty_sessions: &PtySessionManager,
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
        .write_terminal_input(input, pty_sessions)
    }

    pub fn restore_terminal_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: RestoreAgentSessionTerminalInput,
        pty_sessions: &PtySessionManager,
    ) -> Result<RestoreAgentSessionTerminalResult, CommandError> {
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
        .restore_terminal(input, pty_sessions)
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

        let mut result = service.inject_session_prompt(input, pty_sessions)?;
        if refreshed_codex_session_id.is_some() {
            result.codex_session_id = refreshed_codex_session_id;
        }
        Ok(result)
    }

    pub fn resize_terminal_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: ResizeAgentSessionTerminalInput,
        pty_sessions: &PtySessionManager,
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
        .resize_terminal(input, pty_sessions)
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

fn validate_profile_scope(profile: &AgentProfileRow, project_id: i64) -> Result<(), CommandError> {
    match profile.scope {
        AgentScope::Global => Ok(()),
        AgentScope::Project => {
            if profile.project_id == Some(project_id) {
                Ok(())
            } else {
                Err(CommandError::new(
                    CommandErrorCode::AgentSessionValidationFailed,
                    "项目级 Agent Profile 不属于当前 Project。",
                )
                .with_detail(
                    ErrorDetail::new("AgentProfile").with_value("agentProfileId", profile.id),
                )
                .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id)))
            }
        }
    }
}

fn validate_profile_not_deleted(profile: &AgentProfileRow) -> Result<(), CommandError> {
    if profile.del == 0 {
        return Ok(());
    }

    Err(CommandError::new(
        CommandErrorCode::AgentProfileValidationFailed,
        "Agent Profile 已删除。",
    )
    .with_detail(ErrorDetail::new("AgentProfile").with_value("agentProfileId", profile.id)))
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

fn strip_terminal_control_sequences(snapshot: &str) -> String {
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

fn validate_prompt_snapshot(prompt_snapshot: &str) -> Result<String, CommandError> {
    let trimmed = prompt_snapshot.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "最终 prompt 不能为空。",
        )
        .with_detail(ErrorDetail::new("Field").with_value("name", "promptSnapshot")));
    }

    Ok(trimmed.to_string())
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
    CommandError::new(code, "Agent 会话调用失败。")
        .with_detail(ErrorDetail::new("Cause").with_value("message", message))
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
    transaction.execute(
        "INSERT INTO agent_sessions (
           project_id,
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
           completion_policy,
           worktree_root_path,
           log_path,
           list_inserted_at,
           last_active_at,
           started_at
         ) VALUES (?1, NULL, ?2, ?3, 'running', 'none', ?4, ?5, '', 'current_branch', NULL, NULL, ?4, NULL, NULL, ?6, ?7, ?7, ?7)",
        params![
            project_id,
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

fn validate_session_title(title: &str) -> Result<String, CommandError> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "Session title 不能为空。",
        )
        .with_detail(ErrorDetail::new("Field").with_value("name", "title")));
    }

    Ok(trimmed.to_string())
}
fn validate_injected_prompt(prompt: &str) -> Result<String, CommandError> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "注入的 prompt 不能为空。",
        )
        .with_detail(ErrorDetail::new("Field").with_value("name", "prompt")));
    }

    Ok(trimmed.to_string())
}

fn validate_working_dir(repo_path: &str) -> Result<String, CommandError> {
    let path = Path::new(repo_path);
    if !path.is_dir() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionStartFailed,
            "Project 工作目录不可访问。",
        )
        .with_detail(ErrorDetail::new("WorkingDir").with_value("path", repo_path)));
    }

    Ok(path.to_string_lossy().to_string())
}

fn resolve_target_branch(
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
    )
    .with_detail(ErrorDetail::new("GitBranch").with_value("targetBranch", target_branch)))
}

fn resolve_worktree_root_path(project: &ProjectSummary) -> Result<String, CommandError> {
    let repo_path = Path::new(&project.repo_path);
    let repo_name = repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Project 路径无效。",
            )
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
                )
            })?;
            Path::new(&home_dir)
                .join(".redwhisk")
                .join("worktrees")
                .join(repo_name)
        }
    };

    Ok(path.to_string_lossy().to_string())
}

fn run_worktree_setup_command(
    workspace_path: &str,
    setup_command: Option<&str>,
) -> Result<(), CommandError> {
    let setup_command = setup_command
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(setup_command) = setup_command else {
        return Ok(());
    };

    let workspace = Path::new(workspace_path);
    if !workspace.is_dir() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionStartFailed,
            "Worktree 初始化目录不可访问。",
        )
        .with_detail(ErrorDetail::new("WorkingDir").with_value("path", workspace_path)));
    }

    let mut command = shell_command(setup_command);
    let output = command
        .current_dir(workspace)
        .output()
        .map_err(agent_session_start_error)?;

    if output.status.success() {
        return Ok(());
    }

    Err(CommandError::new(
        CommandErrorCode::AgentSessionStartFailed,
        "Worktree 初始化命令执行失败。",
    )
    .with_detail(ErrorDetail::new("WorkingDir").with_value("path", workspace_path))
    .with_detail(ErrorDetail::new("Command").with_value("command", setup_command))
    .with_detail(
        ErrorDetail::new("ExitStatus")
            .with_value("code", output.status.code().map_or(-1, i32::from)),
    )
    .with_detail(ErrorDetail::new("Output").with_value(
        "stderr",
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    )))
}

#[cfg(windows)]
fn shell_command(command: &str) -> Command {
    let mut shell = Command::new("cmd");
    shell.args(["/C", command]);
    shell
}

#[cfg(not(windows))]
fn shell_command(command: &str) -> Command {
    let mut shell = Command::new("sh");
    shell.args(["-lc", command]);
    shell
}

fn build_command_snapshot(profile: &AgentProfileRow) -> String {
    agent_command_with_default_args(profile)
}

fn build_structured_command_snapshot(profile: &AgentProfileRow) -> String {
    profile.command.trim().to_string()
}

fn agent_command_with_default_args(profile: &AgentProfileRow) -> String {
    match profile.agent_type {
        AgentType::Codex => ensure_codex_bypass_arg(&profile.command),
        AgentType::Claude => ensure_claude_bypass_permission_args(&profile.command),
    }
}

fn ensure_codex_bypass_arg(command: &str) -> String {
    append_missing_args(command, &[CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG])
}

fn ensure_claude_bypass_permission_args(command: &str) -> String {
    if command_has_arg(command, CLAUDE_PERMISSION_MODE_ARG) {
        command.trim().to_string()
    } else {
        append_missing_args(
            command,
            &[CLAUDE_PERMISSION_MODE_ARG, CLAUDE_BYPASS_PERMISSIONS_MODE],
        )
    }
}

fn append_missing_args(command: &str, args: &[&str]) -> String {
    let trimmed = command.trim();
    let mut command_line = trimmed.to_string();

    for arg in args {
        if command_has_arg(trimmed, arg) {
            continue;
        }

        if !command_line.is_empty() {
            command_line.push(' ');
        }
        command_line.push_str(arg);
    }

    command_line
}

fn command_has_arg(command: &str, arg: &str) -> bool {
    command.split_whitespace().any(|part| part == arg)
}

fn codex_mode_from_profile(profile: &AgentProfileRow) -> Result<CodexMode, CommandError> {
    let normalized = profile.mode.trim();
    if let Some(mode) = CodexMode::from_id(normalized) {
        return Ok(mode);
    }

    match normalized {
        "" | "default" => Ok(CodexMode::FullAccess),
        "auto" => Ok(CodexMode::Auto),
        "full-auto" | "danger-full-access" | "dangerous" => Ok(CodexMode::FullAccess),
        "read_only" => Ok(CodexMode::ReadOnly),
        _ if profile.dangerous => Ok(CodexMode::FullAccess),
        _ => Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "不支持的 Codex 协作模式。",
        )
        .with_detail(ErrorDetail::new("Field").with_value("name", "mode"))
        .with_detail(ErrorDetail::new("Value").with_value("mode", profile.mode.clone()))),
    }
}

fn codex_mode_from_structured_input(mode: Option<&str>) -> Option<CodexMode> {
    CodexMode::from_id(mode.unwrap_or(CODEX_DEFAULT_MODE_ID))
}

fn build_log_path(
    data_dir: &Path,
    session_name: &str,
    agent_profile_id: i64,
    started_at: i64,
) -> Result<String, CommandError> {
    let logs_dir = data_dir.join(SESSION_LOG_DIR_NAME);
    fs::create_dir_all(&logs_dir).map_err(agent_session_start_error)?;

    let path = logs_dir.join(format!(
        "{session_name}-profile-{agent_profile_id}-{started_at}.log"
    ));
    Ok(path.to_string_lossy().to_string())
}

fn build_structured_log_path(
    data_dir: &Path,
    project_id: i64,
    started_at: i64,
) -> Result<String, CommandError> {
    let logs_dir = data_dir.join(SESSION_LOG_DIR_NAME);
    fs::create_dir_all(&logs_dir).map_err(agent_session_start_error)?;

    let path = logs_dir.join(format!(
        "structured-project-{project_id}-pid-{}-{started_at}.jsonl",
        std::process::id()
    ));
    Ok(path.to_string_lossy().to_string())
}

fn read_timeline_from_session_log(
    session: &crate::types::agent_session::AgentSessionRecord,
) -> Result<Vec<AgentTimelineItem>, CommandError> {
    if session.log_path.trim().is_empty() {
        return Ok(Vec::new());
    }

    let path = Path::new(&session.log_path);
    if let Some(items) = read_structured_timeline_log(path)? {
        return Ok(items);
    }

    read_terminal_timeline_log(path)
}

fn read_structured_timeline_log(
    path: &Path,
) -> Result<Option<Vec<AgentTimelineItem>>, CommandError> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Some(Vec::new())),
        Err(error) => return Err(agent_session_start_error(error)),
    };
    let reader = BufReader::new(file);
    let mut saw_structured_line = false;
    let mut items = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(agent_session_start_error)?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            if saw_structured_line {
                continue;
            }
            return Ok(None);
        };
        let Some(item) = timeline_item_from_log_value(value) else {
            if saw_structured_line {
                continue;
            }
            return Ok(None);
        };
        saw_structured_line = true;
        if let Some(item) = item {
            items.push(item);
        }
    }

    if saw_structured_line {
        Ok(Some(items))
    } else {
        Ok(None)
    }
}

fn timeline_item_from_log_value(value: Value) -> Option<Option<AgentTimelineItem>> {
    if let Ok(envelope) = serde_json::from_value::<AgentStreamEventEnvelope>(value.clone()) {
        return Some(match envelope.event {
            AgentStreamEvent::Timeline { item, .. } => Some(item),
            _ => None,
        });
    }

    let event = value.get("event")?;
    let event_type = event.get("type").and_then(Value::as_str)?;
    if event_type != "timeline" {
        return Some(None);
    }
    let item_value = event.get("item")?.clone();
    serde_json::from_value::<AgentTimelineItem>(item_value)
        .ok()
        .map(Some)
}

fn is_structured_turn_running(path: &str) -> Result<Option<bool>, CommandError> {
    if path.trim().is_empty() {
        return Ok(None);
    }

    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(agent_session_start_error(error)),
    };
    let reader = BufReader::new(file);
    let mut saw_turn_event = false;
    let mut is_turn_running = false;

    for line in reader.lines() {
        let line = line.map_err(agent_session_start_error)?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        let Some(event_type) = structured_log_event_type(&value) else {
            continue;
        };

        match event_type {
            "turn_started" => {
                saw_turn_event = true;
                is_turn_running = true;
            }
            "turn_completed" | "turn_failed" | "turn_canceled" => {
                saw_turn_event = true;
                is_turn_running = false;
            }
            _ => {}
        }
    }

    Ok(saw_turn_event.then_some(is_turn_running))
}

fn structured_log_event_type(value: &Value) -> Option<&str> {
    value
        .get("event")
        .and_then(|event| event.get("type"))
        .and_then(Value::as_str)
}

fn read_terminal_timeline_log(path: &Path) -> Result<Vec<AgentTimelineItem>, CommandError> {
    let snapshot = match read_terminal_snapshot(path, TIMELINE_LOG_SNAPSHOT_MAX_BYTES) {
        Ok(snapshot) => snapshot,
        Err(error) if error.contains("No such file") || error.contains("not found") => {
            return Ok(Vec::new());
        }
        Err(error) => return Err(agent_session_start_error(error)),
    };
    let text = strip_terminal_control_sequences(&snapshot)
        .replace('\r', "\n")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    if text.is_empty() {
        return Ok(Vec::new());
    }

    Ok(vec![AgentTimelineItem::AssistantMessage {
        text,
        message_id: Some("session-log".to_string()),
    }])
}

fn latest_output_from_session_log(log_path: &str) -> Option<String> {
    if log_path.trim().is_empty() {
        return None;
    }

    let path = Path::new(log_path);
    if let Ok(Some(items)) = read_structured_timeline_log(path) {
        for item in items.iter().rev() {
            if let Some(output) = latest_output_from_timeline_item(item) {
                return Some(output);
            }
        }
        return None;
    }

    let snapshot = read_terminal_snapshot(path, TIMELINE_LOG_SNAPSHOT_MAX_BYTES).ok()?;
    latest_output_from_text(&strip_terminal_control_sequences(&snapshot).replace('\r', "\n"))
}

fn latest_output_from_timeline_item(item: &AgentTimelineItem) -> Option<String> {
    use crate::types::agent_session_stream::ToolCallDetail;

    let text = match item {
        AgentTimelineItem::AssistantMessage { text, .. }
        | AgentTimelineItem::UserMessage { text, .. }
        | AgentTimelineItem::Reasoning { text } => text.as_str(),
        AgentTimelineItem::ToolCall { name, detail, .. } => match detail {
            ToolCallDetail::Shell { command, .. } => command.as_str(),
            ToolCallDetail::Read { path, .. }
            | ToolCallDetail::Edit { path, .. }
            | ToolCallDetail::Write { path, .. } => path.as_str(),
            ToolCallDetail::Search { query, .. } => query.as_str(),
            ToolCallDetail::Plan { text } => text.as_str(),
            ToolCallDetail::SubAgent { .. } | ToolCallDetail::Unknown { .. } => name.as_str(),
        },
        AgentTimelineItem::Todo { .. } => "Plan updated",
        AgentTimelineItem::Error { message } => message.as_str(),
        AgentTimelineItem::Compaction { .. } => "Context compacted",
    };

    latest_output_from_text(text)
}

fn latest_output_from_text(text: &str) -> Option<String> {
    let latest_line = text
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    Some(latest_line.chars().take(LATEST_OUTPUT_MAX_CHARS).collect())
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
        )
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
            )
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

fn current_epoch_millis() -> Result<i64, CommandError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(agent_session_start_error)?;
    Ok(duration.as_millis() as i64)
}

fn agent_session_database_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionPersistenceFailed,
        "Agent Session 启动失败。",
    )
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

fn agent_session_start_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionStartFailed,
        "Agent 进程启动失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn inactive_terminal_error(error: String) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionValidationFailed,
        "当前 Session 没有活跃终端。",
    )
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

#[cfg(test)]
mod tests {
    use super::{
        agent_command_with_default_args, build_structured_command_snapshot,
        codex_mode_from_profile, codex_mode_from_structured_input,
        command_supports_prompt_argument, detect_codex_session_id_from_home,
        latest_output_from_session_log, normalize_submitted_prompt, read_timeline_from_session_log,
        AgentSessionService, CodexMode,
    };
    use crate::db::agent_profile_repository::AgentProfileRepository;
    use crate::db::agent_session_repository::AgentSessionRepository;
    use crate::db::issue_repository::IssueRepository;
    use crate::db::migrations::MigrationRunner;
    use crate::db::project_repository::ProjectRepository;
    use crate::types::agent_profile::{AgentScope, AgentType};
    use crate::types::agent_session::{
        AgentSessionAttention, AgentSessionRecord, AgentSessionStatus, WorkspaceMode,
    };
    use crate::types::agent_session_stream::{
        AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem,
    };
    use crate::types::project::ProjectCompletionPolicy;
    use rusqlite::{params, Connection};
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

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
        let mut profile = test_agent_profile(AgentType::Codex, "codex");
        profile.mode = "default".to_string();

        assert_eq!(
            codex_mode_from_profile(&profile).expect("mode"),
            CodexMode::FullAccess
        );
    }

    #[test]
    fn codex_profile_empty_mode_uses_full_access() {
        let mut profile = test_agent_profile(AgentType::Codex, "codex");
        profile.mode = String::new();

        assert_eq!(
            codex_mode_from_profile(&profile).expect("mode"),
            CodexMode::FullAccess
        );
    }

    #[test]
    fn structured_codex_session_defaults_to_full_access() {
        assert_eq!(
            codex_mode_from_structured_input(None),
            Some(CodexMode::FullAccess)
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
        let items = read_timeline_from_session_log(&session).expect("read timeline");

        assert_eq!(
            items,
            vec![AgentTimelineItem::AssistantMessage {
                text: "历史回答".to_string(),
                message_id: Some("msg-1".to_string()),
            }]
        );
        assert_eq!(
            latest_output_from_session_log(log_path.to_string_lossy().as_ref()).as_deref(),
            Some("历史回答")
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
        let items = read_timeline_from_session_log(&session).expect("read timeline");

        assert_eq!(
            items,
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
        assert_eq!(
            latest_output_from_session_log(log_path.to_string_lossy().as_ref()).as_deref(),
            Some("我会查询北京天气。")
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
        let items = read_timeline_from_session_log(&session).expect("read timeline");

        assert_eq!(items.len(), 1);
        match &items[0] {
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
    fn list_agent_sessions_reads_turn_running_state_from_structured_log() {
        let database = setup_session_list_database();
        let completed_log_path = std::env::temp_dir().join(format!(
            "redwhisk-completed-turn-{}.jsonl",
            current_millis()
        ));
        fs::write(
            &completed_log_path,
            concat!(
                "{\"projectId\":1,\"sessionId\":301,\"seq\":1,\"epoch\":\"test\",\"event\":{\"type\":\"turn_started\",\"turnId\":\"t1\"}}\n",
                "{\"projectId\":1,\"sessionId\":301,\"seq\":2,\"epoch\":\"test\",\"event\":{\"type\":\"turn_completed\",\"turnId\":\"t1\",\"usage\":null}}\n"
            ),
        )
        .expect("write completed turn log");
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
        database
            .execute(
                "UPDATE agent_sessions SET log_path = ?1 WHERE id = 301",
                params![completed_log_path.to_string_lossy().to_string()],
            )
            .expect("set completed log path");

        let active_log_path =
            std::env::temp_dir().join(format!("redwhisk-active-turn-{}.jsonl", current_millis()));
        fs::write(
            &active_log_path,
            "{\"projectId\":1,\"sessionId\":302,\"seq\":1,\"epoch\":\"test\",\"event\":{\"type\":\"turn_started\",\"turnId\":\"t2\"}}\n",
        )
        .expect("write active turn log");
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
                "UPDATE agent_sessions SET log_path = ?1 WHERE id = 302",
                params![active_log_path.to_string_lossy().to_string()],
            )
            .expect("set active log path");

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

        fs::remove_file(completed_log_path).ok();
        fs::remove_file(active_log_path).ok();
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
            project_id: 1,
            issue_id: None,
            title: Some("test".to_string()),
            agent_profile_id: 0,
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
            completion_policy: Some(ProjectCompletionPolicy::Manual),
            worktree_root_path: None,
            worktree_setup_command: None,
            log_path: log_path.to_string(),
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
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at, completion_policy)
                 VALUES (1, 'RedWhisk', ?1, 1, 1, 'manual')",
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
                    "INSERT INTO issues (id, project_id, title, description, status, created_at, updated_at, del)
                     VALUES (?1, 1, ?2, '', ?3, ?4, ?4, 0)",
                    params![issue_id, issue_title, issue_status, started_at],
                )
                .expect("insert issue");
        }

        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, issue_id, title, agent_profile_id, status, attention,
                   working_dir, command_snapshot, prompt_snapshot, workspace_mode,
                   target_branch, workspace_branch, workspace_path, completion_policy,
                   worktree_root_path, log_path, list_inserted_at, last_active_at, started_at,
                   closed_at, del
                 ) VALUES (
                   ?1, 1, ?2, NULL, 101, ?3, 'none',
                   ?4, '', '', 'current_branch',
                   NULL, NULL, ?4, 'manual',
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
}
