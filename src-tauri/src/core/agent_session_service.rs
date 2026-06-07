use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::agent::pty_session_manager::{
    read_terminal_snapshot, PtyExitStatus, PtySessionManager, PtySpawnRequest,
};
use crate::db::agent_profile_repository::{AgentProfileRepository, AgentProfileRow};
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::event_repository::EventRepository;
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::types::agent_profile::AgentScope;
use crate::types::agent_session::{
    AgentSessionListItem, AgentSessionListResponse, AgentSessionPromptKind, AgentSessionStatus,
    InjectAgentSessionPromptInput, InjectAgentSessionPromptResult, ReadAgentSessionTerminalResult,
    ResizeAgentSessionTerminalInput, StartAgentSessionInput, StartAgentSessionResult,
    WriteAgentSessionTerminalInput,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::IssueStatus;
use crate::types::issue_action::IssueActionType;
use crate::types::session_event::SessionEventType;

const SESSION_LOG_DIR_NAME: &str = "session-logs";
const STARTUP_CHECK_TOTAL_MS: u64 = 500;
const STARTUP_CHECK_INTERVAL_MS: u64 = 25;
const CODEX_SESSION_CAPTURE_TOTAL_MS: u64 = 5_000;
const CODEX_SESSION_CAPTURE_INTERVAL_MS: u64 = 250;

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

    fn start_agent_session_internal(
        &self,
        data_dir: impl AsRef<Path>,
        input: StartAgentSessionInput,
        pty_sessions: Option<&PtySessionManager>,
    ) -> Result<StartAgentSessionResult, CommandError> {
        let prompt_snapshot = validate_prompt_snapshot(&input.prompt_snapshot)?;

        let project = self
            .project_repository
            .find_by_id(input.project_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(
                        ErrorDetail::new("Project").with_value("projectId", input.project_id),
                    )
            })?;

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

        validate_profile_scope(&profile, input.project_id)?;

        let started_at = current_epoch_millis()?;
        let working_dir = validate_working_dir(&project.repo_path)?;
        let log_path = build_log_path(
            data_dir.as_ref(),
            issue.id,
            input.agent_profile_id,
            started_at,
        )?;
        let command_snapshot = build_command_snapshot(&profile);

        let pending_pty = if let Some(pty_sessions) = pty_sessions {
            Some(
                pty_sessions
                    .spawn_pending(&PtySpawnRequest {
                        command: profile.command.clone(),
                        working_dir: working_dir.clone(),
                        log_path: log_path.clone(),
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
        let mut child = if pending_pty.is_none() {
            let mut child = spawn_agent_process(&profile, &working_dir, &log_path)?;
            ensure_process_started(&mut child, &profile.command)?;
            Some(child)
        } else {
            None
        };

        let transaction = self
            .issue_repository
            .connection()
            .unchecked_transaction()
            .map_err(agent_session_database_error)?;

        let transaction_result: Result<StartAgentSessionResult, rusqlite::Error> = (|| {
            let session = AgentSessionRepository::insert_in_transaction(
                &transaction,
                issue.id,
                input.agent_profile_id,
                &working_dir,
                &command_snapshot,
                &prompt_snapshot,
                &log_path,
                started_at,
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
                if should_attempt_codex_session_capture(&profile.command) {
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
                        pty_sessions.register(result.session_id, pending_pty, move |exit_status| {
                            let _ = AgentSessionService::record_session_termination_in_data_dir(
                                &data_dir,
                                result.session_id,
                                exit_status,
                            );
                        });
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
                Err(agent_session_transaction_error(error, input.issue_id))
            }
        }
    }

    pub fn list_agent_sessions(
        &self,
        project_id: i64,
    ) -> Result<AgentSessionListResponse, CommandError> {
        self.ensure_project_exists(project_id)?;

        let rows = self
            .agent_session_repository
            .list_by_project_id(project_id)
            .map_err(agent_session_database_error)?;

        let mut running_sessions = Vec::new();
        let mut completed_sessions = Vec::new();

        for row in rows {
            match row.status {
                crate::types::agent_session::AgentSessionStatus::Running => {
                    running_sessions.push(row);
                }
                crate::types::agent_session::AgentSessionStatus::Closed
                | crate::types::agent_session::AgentSessionStatus::Crashed
                | crate::types::agent_session::AgentSessionStatus::Stopped => {
                    completed_sessions.push(row);
                }
            }
        }

        running_sessions.sort_by(|left, right| {
            right
                .last_active_at
                .cmp(&left.last_active_at)
                .then_with(|| right.session_id.cmp(&left.session_id))
        });
        completed_sessions.sort_by(|left, right| {
            right
                .closed_at
                .unwrap_or(right.last_active_at)
                .cmp(&left.closed_at.unwrap_or(left.last_active_at))
                .then_with(|| right.session_id.cmp(&left.session_id))
        });
        completed_sessions.truncate(20);

        let sessions = running_sessions
            .into_iter()
            .chain(completed_sessions)
            .map(|row| AgentSessionListItem {
                session_id: row.session_id,
                issue_id: row.issue_id,
                issue_title: row.issue_title,
                title: row.title,
                agent_type: row.agent_type,
                status: row.status,
                attention: row.attention,
                last_active_at: row.last_active_at,
                started_at: row.started_at,
                closed_at: row.closed_at,
            })
            .collect();

        Ok(AgentSessionListResponse { sessions })
    }

    fn ensure_project_exists(&self, project_id: i64) -> Result<(), CommandError> {
        self.project_repository
            .find_by_id(project_id)
            .map_err(agent_session_database_error)?
            .map(|_| ())
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

        Ok(ReadAgentSessionTerminalResult {
            session_id,
            snapshot,
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
            .map_err(inactive_terminal_error)
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

        let issue_id = session.issue_id.ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "当前 Session 尚未关联到可交互 Issue。",
            )
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id))
        })?;
        let issue = self
            .issue_repository
            .find_by_id(issue_id)
            .map_err(agent_session_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::IssueNotFound, "Issue 不存在。")
                    .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue_id))
            })?;

        if issue.project_id != project_id {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Agent Session 不属于当前 Project。",
            )
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id))
            .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id)));
        }

        Ok(session)
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

    pub fn list_agent_sessions_in_data_dir(
        data_dir: impl AsRef<Path>,
        project_id: i64,
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
        .list_agent_sessions(project_id)
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

fn build_command_snapshot(profile: &AgentProfileRow) -> String {
    profile.command.clone()
}

fn build_log_path(
    data_dir: &Path,
    issue_id: i64,
    agent_profile_id: i64,
    started_at: i64,
) -> Result<String, CommandError> {
    let logs_dir = data_dir.join(SESSION_LOG_DIR_NAME);
    fs::create_dir_all(&logs_dir).map_err(agent_session_start_error)?;

    let path = logs_dir.join(format!(
        "issue-{issue_id}-profile-{agent_profile_id}-{started_at}.log"
    ));
    Ok(path.to_string_lossy().to_string())
}

fn spawn_agent_process(
    profile: &AgentProfileRow,
    working_dir: &str,
    log_path: &str,
) -> Result<Child, CommandError> {
    let log_file = File::create(log_path).map_err(agent_session_start_error)?;
    let stderr_file = log_file.try_clone().map_err(agent_session_start_error)?;

    Command::new(&profile.command)
        .current_dir(working_dir)
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()
        .map_err(agent_session_start_error)
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

fn agent_session_transaction_error(error: rusqlite::Error, issue_id: i64) -> CommandError {
    if let rusqlite::Error::SqliteFailure(_, Some(message)) = &error {
        if message.contains("UNIQUE constraint failed: agent_sessions.issue_id") {
            return CommandError::new(
                CommandErrorCode::AgentSessionAlreadyExists,
                "当前 Issue 已存在关联 Agent Session。",
            )
            .with_detail(ErrorDetail::new("Issue").with_value("issueId", issue_id))
            .with_detail(ErrorDetail::new("Cause").with_value("message", message.clone()));
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

fn normalize_submitted_prompt(prompt: &str) -> String {
    if prompt.ends_with('\n') || prompt.ends_with('\r') {
        return prompt.to_string();
    }

    format!("{prompt}\r")
}

fn should_attempt_codex_session_capture(command: &str) -> bool {
    Path::new(command)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("codex"))
        .unwrap_or(false)
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
    use super::{detect_codex_session_id_from_home, normalize_submitted_prompt};
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

    fn current_millis() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("unix time")
            .as_millis() as i64
    }
}
