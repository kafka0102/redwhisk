use std::path::Path;
#[cfg(test)]
use std::sync::{Arc, Mutex};

use crate::agent::pty_session_manager::{
    read_terminal_snapshot, PendingPtySession, PtyCommandMode, PtyRegisterError, PtySessionManager,
    PtySpawnRequest,
};
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::db::project_terminal_shortcut_command_repository::ProjectTerminalShortcutCommandRepository;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project::ProjectSummary;
use crate::types::project_terminal::{
    CloseProjectTerminalInput, CreateProjectTerminalInput, CreateProjectTerminalResult,
    CreateTemporaryProjectTerminalInput, CreateTemporaryProjectTerminalResult,
    DeleteProjectTerminalConfigInput, DeleteProjectTerminalConfigResult,
    EnsureProjectTerminalFailure, EnsureProjectTerminalsInput, EnsureProjectTerminalsResult,
    ListProjectTerminalsInput, ListProjectTerminalsResult, ReadProjectTerminalInput,
    ReadProjectTerminalResult, ResizeProjectTerminalInput, RestoreProjectTerminalInput,
    RestoreProjectTerminalResult, SubscribeProjectTerminalOutputInput,
    UpdateProjectTerminalConfigInput, UpdateProjectTerminalConfigResult, WriteProjectTerminalInput,
};
use crate::types::project_terminal_config::ProjectTerminalConfig;
use crate::types::project_terminal_shortcut_command::{
    DeleteProjectTerminalShortcutCommandInput, ListProjectTerminalShortcutCommandsInput,
    ListProjectTerminalShortcutCommandsResult, ProjectTerminalShortcutCommandRecord,
    ReadProjectTerminalCwdInput, ReadProjectTerminalCwdResult,
    SaveProjectTerminalShortcutCommandInput,
};

use super::log::{remove_terminal_log_file, terminal_log_path};
use super::registry::{
    final_path_segment, preferred_project_terminal_session, project_terminal_summary,
    ProjectTerminalRegistry, ProjectTerminalSession,
};
use super::shell_kind::is_shell_like_launch_command;
use super::shortcut::{shortcut_command_record_from_row, validate_shortcut_command};

const PROJECT_TERMINAL_NAME_PREFIX: &str = "terminal-";

fn parse_project_terminal_number(name: &str) -> Option<u64> {
    let suffix = name.strip_prefix(PROJECT_TERMINAL_NAME_PREFIX)?;
    if suffix.is_empty() || !suffix.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    if suffix.len() > 1 && suffix.starts_with('0') {
        return None;
    }
    let number = suffix.parse::<u64>().ok()?;
    (number > 0).then_some(number)
}

fn next_project_terminal_name(existing_names: impl IntoIterator<Item = impl AsRef<str>>) -> String {
    let mut max_number = 0_u64;
    for name in existing_names {
        if let Some(number) = parse_project_terminal_number(name.as_ref()) {
            max_number = max_number.max(number);
        }
    }
    format!("{PROJECT_TERMINAL_NAME_PREFIX}{}", max_number + 1)
}

const TEMPORARY_PROJECT_TERMINAL_CONFIG_ID: i64 = -1;
const STARTUP_CHECK_TOTAL_MS: u64 = 500;
const STARTUP_CHECK_INTERVAL_MS: u64 = 25;
const PROJECT_TERMINAL_SHORTCUT_COMMAND_MAX_COUNT: i64 = 30;

pub struct ProjectTerminalService<'connection> {
    project_repository: ProjectRepository<'connection>,
}

impl<'connection> ProjectTerminalService<'connection> {
    pub fn new(project_repository: ProjectRepository<'connection>) -> Self {
        Self { project_repository }
    }

    pub fn create_terminal(
        &self,
        data_dir: impl AsRef<Path>,
        input: CreateProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<CreateProjectTerminalResult, CommandError> {
        let project = self.project_by_id(input.project_id)?;
        registry.with_project_lock(project.id, || {
            let session_id = registry.allocate_session_id();
            let log_path = terminal_log_path(data_dir.as_ref(), project.id, session_id)?;
            let shell_command = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
            let existing_names = self
                .project_repository
                .list_project_terminal_configs(project.id)
                .map_err(project_terminal_database_error)?
                .into_iter()
                .map(|config| config.name);
            let terminal_name = next_project_terminal_name(existing_names);
            let config = self
                .project_repository
                .insert_project_terminal_config(
                    project.id,
                    &terminal_name,
                    &project.repo_path,
                    &shell_command,
                )
                .map_err(project_terminal_database_error)?;

            run_create_after_config_insert_hook(project.id, config.id);
            registry.with_config_lock(project.id, config.id, || {
                let pending = match pty_sessions.spawn_pending(&PtySpawnRequest {
                    mode: PtyCommandMode::InteractiveRun,
                    command: config.launch_command.clone(),
                    working_dir: config.working_dir.clone(),
                    log_path: log_path.to_string_lossy().to_string(),
                    initial_prompt: None,
                    rows: 32,
                    cols: 120,
                    startup_check_total_ms: STARTUP_CHECK_TOTAL_MS,
                    startup_check_interval_ms: STARTUP_CHECK_INTERVAL_MS,
                }) {
                    Ok(pending) => pending,
                    Err(error) => {
                        self.cleanup_failed_terminal_create(project.id, config.id, None)?;
                        return Err(project_terminal_start_error(error));
                    }
                };

                if let Err(error) = registry.insert(
                    session_id,
                    ProjectTerminalSession {
                        project_id: project.id,
                        config_id: config.id,
                        name: terminal_name.clone(),
                        log_path: log_path.to_string_lossy().to_string(),
                        is_active: true,
                    },
                ) {
                    self.cleanup_failed_terminal_create(project.id, config.id, Some(pending))?;
                    return Err(error);
                }

                let registry_on_exit = registry.clone();
                if let Err(PtyRegisterError { message, pending }) = pty_sessions
                    .register_for_project(project.id, session_id, pending, move |_| {
                        registry_on_exit.mark_inactive(session_id);
                    })
                {
                    let _ = registry.remove(project.id, session_id);
                    self.cleanup_failed_terminal_create(project.id, config.id, Some(pending))?;
                    return Err(project_terminal_start_error(message));
                }

                Ok(CreateProjectTerminalResult {
                    config_id: config.id,
                    session_id,
                    name: config.name.clone(),
                    working_dir: config.working_dir.clone(),
                    launch_command: config.launch_command.clone(),
                })
            })
        })
    }

    pub fn list_project_terminals(
        &self,
        input: ListProjectTerminalsInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<ListProjectTerminalsResult, CommandError> {
        self.project_by_id(input.project_id)?;
        let configs = self
            .project_repository
            .list_project_terminal_configs(input.project_id)
            .map_err(project_terminal_database_error)?;
        let mut terminals = Vec::with_capacity(configs.len());

        for config in configs {
            let session = preferred_project_terminal_session(
                registry.sessions_by_config_id(input.project_id, config.id)?,
                pty_sessions,
            );
            terminals.push(project_terminal_summary(config, session, pty_sessions));
        }

        Ok(ListProjectTerminalsResult { terminals })
    }

    pub fn create_temporary_terminal_for_agent_session(
        &self,
        data_dir: impl AsRef<Path>,
        input: CreateTemporaryProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<CreateTemporaryProjectTerminalResult, CommandError> {
        let project = self.project_by_id(input.project_id)?;
        let agent_session_repository =
            AgentSessionRepository::new(self.project_repository.connection());
        let agent_session = agent_session_repository
            .find_by_id(input.agent_session_id)
            .map_err(project_terminal_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::ProjectTerminalValidationFailed,
                    "Agent Session 不存在。",
                )
                .with_reason("sessionNotFound")
                .with_detail(ErrorDetail::new("Project").with_value("projectId", input.project_id))
                .with_detail(
                    ErrorDetail::new("AgentSession")
                        .with_value("sessionId", input.agent_session_id),
                )
            })?;

        if agent_session.project_id != project.id {
            return Err(CommandError::new(
                CommandErrorCode::ProjectTerminalValidationFailed,
                "Agent Session 不属于当前 Project。",
            )
            .with_reason("sessionNotInProject")
            .with_detail(ErrorDetail::new("Project").with_value("projectId", input.project_id))
            .with_detail(
                ErrorDetail::new("AgentSession").with_value("sessionId", input.agent_session_id),
            ));
        }

        let session_id = registry.allocate_session_id();
        let log_path = terminal_log_path(data_dir.as_ref(), project.id, session_id)?;
        let shell_command = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let terminal_name = final_path_segment(&agent_session.working_dir);

        let pending = pty_sessions
            .spawn_pending(&PtySpawnRequest {
                mode: PtyCommandMode::InteractiveRun,
                command: shell_command.clone(),
                working_dir: agent_session.working_dir.clone(),
                log_path: log_path.to_string_lossy().to_string(),
                initial_prompt: None,
                rows: 32,
                cols: 120,
                startup_check_total_ms: STARTUP_CHECK_TOTAL_MS,
                startup_check_interval_ms: STARTUP_CHECK_INTERVAL_MS,
            })
            .map_err(project_terminal_start_error)?;

        if let Err(error) = registry.insert(
            session_id,
            ProjectTerminalSession {
                project_id: project.id,
                config_id: TEMPORARY_PROJECT_TERMINAL_CONFIG_ID,
                name: terminal_name.clone(),
                log_path: log_path.to_string_lossy().to_string(),
                is_active: true,
            },
        ) {
            pending.terminate();
            return Err(error);
        }

        let registry_on_exit = registry.clone();
        if let Err(PtyRegisterError { message, pending }) =
            pty_sessions.register_for_project(project.id, session_id, pending, move |_| {
                registry_on_exit.mark_inactive(session_id);
            })
        {
            let _ = registry.remove(project.id, session_id);
            pending.terminate();
            return Err(project_terminal_start_error(message));
        }

        Ok(CreateTemporaryProjectTerminalResult {
            session_id,
            name: terminal_name,
            working_dir: agent_session.working_dir,
            launch_command: shell_command,
        })
    }

    pub fn update_project_terminal_config(
        &self,
        input: UpdateProjectTerminalConfigInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<UpdateProjectTerminalConfigResult, CommandError> {
        self.project_by_id(input.project_id)?;
        let config = self
            .project_repository
            .update_project_terminal_config(
                input.project_id,
                input.config_id,
                &input.name,
                &input.working_dir,
                &input.launch_command,
            )
            .map_err(project_terminal_database_error)?;
        registry.rename_session(input.project_id, config.id, &config.name)?;
        let session = preferred_project_terminal_session(
            registry.sessions_by_config_id(input.project_id, config.id)?,
            pty_sessions,
        );

        Ok(UpdateProjectTerminalConfigResult {
            terminal: project_terminal_summary(config, session, pty_sessions),
        })
    }

    pub fn delete_project_terminal_config(
        &self,
        input: DeleteProjectTerminalConfigInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<DeleteProjectTerminalConfigResult, CommandError> {
        self.project_by_id(input.project_id)?;
        registry.with_config_lock(input.project_id, input.config_id, || {
            let sessions = registry.sessions_by_config_id(input.project_id, input.config_id)?;
            let session_id = preferred_project_terminal_session(sessions.clone(), pty_sessions)
                .map(|(session_id, _)| session_id)
                .or_else(|| sessions.first().map(|(session_id, _)| *session_id));

            for (active_session_id, _) in sessions.iter().filter(|(session_id, session)| {
                session.is_active && pty_sessions.contains(*session_id)
            }) {
                pty_sessions
                    .kill(*active_session_id)
                    .map_err(project_terminal_delete_error)?;
            }

            self.project_repository
                .delete_project_terminal_config(input.project_id, input.config_id)
                .map_err(project_terminal_database_error)?;
            let removed =
                registry.remove_sessions_by_config_id(input.project_id, input.config_id)?;
            for (_, session) in removed {
                remove_terminal_log_file(&session.log_path);
            }

            Ok(DeleteProjectTerminalConfigResult {
                config_id: input.config_id,
                session_id,
            })
        })
    }

    /// 打开项目后的批量恢复：与 ensure 共用启动逻辑；失败由 ensure 出口对调用方暴露。
    pub fn restore_project_terminals(
        &self,
        data_dir: impl AsRef<Path>,
        project_id: i64,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        self.ensure_project_terminals(
            data_dir,
            EnsureProjectTerminalsInput { project_id },
            registry,
            pty_sessions,
        )
        .map(|_| ())
    }

    /// 确保项目终端尽量运行，并返回最新 list 与 Shell 类启动失败。
    /// 命令型失败不进入 shell_failures；已有 active PTY 则幂等跳过。
    pub fn ensure_project_terminals(
        &self,
        data_dir: impl AsRef<Path>,
        input: EnsureProjectTerminalsInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<EnsureProjectTerminalsResult, CommandError> {
        self.project_by_id(input.project_id)?;
        let configs = registry.with_project_lock(input.project_id, || {
            self.project_repository
                .list_project_terminal_configs(input.project_id)
                .map_err(project_terminal_database_error)
        })?;

        let mut shell_failures = Vec::new();

        for config in configs {
            run_restore_before_start_lock_hook(input.project_id, config.id);
            let start_result = registry.with_config_lock(input.project_id, config.id, || {
                let Some(current_config) =
                    self.project_terminal_config_by_id(input.project_id, config.id)?
                else {
                    return Ok(());
                };

                let sessions =
                    registry.sessions_by_config_id(input.project_id, current_config.id)?;
                if let Some((session_id, session)) =
                    preferred_project_terminal_session(sessions.clone(), pty_sessions)
                {
                    if session.is_active && pty_sessions.contains(session_id) {
                        return Ok(());
                    }
                }

                let _ = registry.remove_sessions_by_config_id(input.project_id, current_config.id);
                run_restore_before_spawn_hook(input.project_id, current_config.id);
                self.start_terminal_for_config(
                    data_dir.as_ref(),
                    &current_config,
                    registry,
                    pty_sessions,
                )
                .map(|_| ())
            });

            if let Err(error) = start_result {
                if is_shell_like_launch_command(&config.launch_command) {
                    shell_failures.push(EnsureProjectTerminalFailure {
                        config_id: config.id,
                        name: config.name.clone(),
                        message: error.message,
                        reason: error.reason,
                    });
                }
            }
        }

        let listed = self.list_project_terminals(
            ListProjectTerminalsInput {
                project_id: input.project_id,
            },
            registry,
            pty_sessions,
        )?;

        Ok(EnsureProjectTerminalsResult {
            terminals: listed.terminals,
            shell_failures,
        })
    }

    /// 热路径：读 log / 状态轮询只依赖 registry，不打开 SQLite。
    pub fn read_terminal_snapshot(
        input: ReadProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<ReadProjectTerminalResult, CommandError> {
        let session = registry.find(input.project_id, input.session_id)?;
        let is_active = session.is_active && pty_sessions.contains(input.session_id);
        if is_active {
            // catch-up / 状态轮询前刷 log，避免 BufWriter 未落盘导致尾部缺失。
            let _ = pty_sessions.flush_log(input.session_id);
        }
        let snapshot = read_terminal_snapshot(
            Path::new(&session.log_path),
            input.max_bytes.unwrap_or(32_768),
        )
        .map_err(project_terminal_start_error)?;

        Ok(ReadProjectTerminalResult {
            session_id: input.session_id,
            snapshot,
            is_active,
        })
    }

    /// 热路径：cwd 轮询仅依赖 registry + PTY，不打开 SQLite。
    pub fn read_terminal_cwd(
        input: ReadProjectTerminalCwdInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<ReadProjectTerminalCwdResult, CommandError> {
        let session = registry.find(input.project_id, input.session_id)?;
        if !session.is_active || !pty_sessions.contains(input.session_id) {
            return Ok(ReadProjectTerminalCwdResult {
                session_id: input.session_id,
                cwd: None,
            });
        }

        let cwd = pty_sessions
            .current_cwd(input.session_id)
            .map_err(project_terminal_inactive_error)?;
        Ok(ReadProjectTerminalCwdResult {
            session_id: input.session_id,
            cwd,
        })
    }

    /// 热路径：仅走内存 registry + PTY，禁止打开 SQLite。
    /// 每个按键都会调用，DB 校验会把输入延迟拉到不可用。
    pub fn write_terminal_input(
        input: WriteProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        let session = registry.find(input.project_id, input.session_id)?;
        if input.data.is_empty() {
            return Ok(());
        }
        if !session.is_active {
            return Err(project_terminal_inactive_error("Project Terminal 已停止。"));
        }

        pty_sessions
            .write_input(input.session_id, &input.data)
            .map_err(project_terminal_inactive_error)
    }

    /// 热路径：restore 只读内存 ring buffer，不打开 SQLite。
    pub fn restore_terminal(
        input: RestoreProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<RestoreProjectTerminalResult, CommandError> {
        let session = registry.find(input.project_id, input.session_id)?;

        if !session.is_active || !pty_sessions.contains(input.session_id) {
            return Ok(RestoreProjectTerminalResult {
                session_id: input.session_id,
                sequence: 0,
                chunks: Vec::new(),
                is_complete: false,
                is_active: false,
            });
        }

        let snapshot = match pty_sessions.restore_snapshot(input.session_id) {
            Ok(snapshot) => snapshot,
            Err(error) if error == "session not found" => {
                return Ok(RestoreProjectTerminalResult {
                    session_id: input.session_id,
                    sequence: 0,
                    chunks: Vec::new(),
                    is_complete: false,
                    is_active: false,
                });
            }
            Err(error) => return Err(project_terminal_inactive_error(error)),
        };

        Ok(RestoreProjectTerminalResult {
            session_id: snapshot.session_id,
            sequence: snapshot.sequence,
            // 前端 catch-up 走磁盘 log，不消费 chunks；避免 Vec<u8> 以 JSON number[][]
            // 做超大 IPC。sequence / is_complete / is_active 仍用于对齐与状态。
            chunks: Vec::new(),
            is_complete: snapshot.is_complete,
            is_active: true,
        })
    }

    /// 热路径：仅内存，不打开 SQLite。
    pub fn subscribe_terminal_output(
        input: SubscribeProjectTerminalOutputInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        let session = registry.find(input.project_id, input.session_id)?;
        if !session.is_active || !pty_sessions.contains(input.session_id) {
            return Ok(());
        }
        pty_sessions.add_output_subscriber(input.session_id);
        Ok(())
    }

    /// 热路径：仅内存，不打开 SQLite。
    pub fn unsubscribe_terminal_output(
        input: SubscribeProjectTerminalOutputInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        let _ = registry.find(input.project_id, input.session_id)?;
        pty_sessions.remove_output_subscriber(input.session_id);
        Ok(())
    }

    /// 热路径：仅内存，不打开 SQLite（FitAddon 会频繁触发）。
    pub fn resize_terminal(
        input: ResizeProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        let session = registry.find(input.project_id, input.session_id)?;
        if !session.is_active {
            return Err(project_terminal_inactive_error("Project Terminal 已停止。"));
        }

        pty_sessions
            .resize(input.session_id, input.rows, input.cols)
            .map_err(project_terminal_inactive_error)
    }

    pub fn close_terminal(
        &self,
        input: CloseProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        self.project_by_id(input.project_id)?;
        let session = registry.remove(input.project_id, input.session_id)?;

        if session.is_active {
            let _ = pty_sessions.kill(input.session_id);
        }

        remove_terminal_log_file(&session.log_path);

        Ok(())
    }

    pub fn create_terminal_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: CreateProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<CreateProjectTerminalResult, CommandError> {
        let database = open_project_database(data_dir.as_ref())?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).create_terminal(
            data_dir,
            input,
            registry,
            pty_sessions,
        )
    }

    pub fn create_temporary_terminal_for_agent_session_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: CreateTemporaryProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<CreateTemporaryProjectTerminalResult, CommandError> {
        let database = open_project_database(data_dir.as_ref())?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).create_temporary_terminal_for_agent_session(
            data_dir,
            input,
            registry,
            pty_sessions,
        )
    }

    pub fn read_terminal_snapshot_in_data_dir(
        _data_dir: impl AsRef<Path>,
        input: ReadProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<ReadProjectTerminalResult, CommandError> {
        Self::read_terminal_snapshot(input, registry, pty_sessions)
    }

    pub fn read_terminal_cwd_in_data_dir(
        _data_dir: impl AsRef<Path>,
        input: ReadProjectTerminalCwdInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<ReadProjectTerminalCwdResult, CommandError> {
        Self::read_terminal_cwd(input, registry, pty_sessions)
    }

    pub fn write_terminal_input_in_data_dir(
        _data_dir: impl AsRef<Path>,
        input: WriteProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        Self::write_terminal_input(input, registry, pty_sessions)
    }

    pub fn restore_terminal_in_data_dir(
        _data_dir: impl AsRef<Path>,
        input: RestoreProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<RestoreProjectTerminalResult, CommandError> {
        Self::restore_terminal(input, registry, pty_sessions)
    }

    pub fn subscribe_terminal_output_in_data_dir(
        _data_dir: impl AsRef<Path>,
        input: SubscribeProjectTerminalOutputInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        Self::subscribe_terminal_output(input, registry, pty_sessions)
    }

    pub fn unsubscribe_terminal_output_in_data_dir(
        _data_dir: impl AsRef<Path>,
        input: SubscribeProjectTerminalOutputInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        Self::unsubscribe_terminal_output(input, registry, pty_sessions)
    }

    pub fn resize_terminal_in_data_dir(
        _data_dir: impl AsRef<Path>,
        input: ResizeProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        Self::resize_terminal(input, registry, pty_sessions)
    }

    pub fn close_terminal_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: CloseProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).close_terminal(input, registry, pty_sessions)
    }

    pub fn list_project_terminals_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: ListProjectTerminalsInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<ListProjectTerminalsResult, CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).list_project_terminals(
            input,
            registry,
            pty_sessions,
        )
    }

    pub fn update_project_terminal_config_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: UpdateProjectTerminalConfigInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<UpdateProjectTerminalConfigResult, CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).update_project_terminal_config(
            input,
            registry,
            pty_sessions,
        )
    }

    pub fn delete_project_terminal_config_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: DeleteProjectTerminalConfigInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<DeleteProjectTerminalConfigResult, CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).delete_project_terminal_config(
            input,
            registry,
            pty_sessions,
        )
    }

    pub fn restore_project_terminals_in_data_dir(
        data_dir: impl AsRef<Path>,
        project_id: i64,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        let database = open_project_database(data_dir.as_ref())?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).restore_project_terminals(
            data_dir,
            project_id,
            registry,
            pty_sessions,
        )
    }

    pub fn ensure_project_terminals_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: EnsureProjectTerminalsInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<EnsureProjectTerminalsResult, CommandError> {
        let database = open_project_database(data_dir.as_ref())?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).ensure_project_terminals(
            data_dir,
            input,
            registry,
            pty_sessions,
        )
    }

    pub fn list_shortcut_commands(
        &self,
        input: ListProjectTerminalShortcutCommandsInput,
    ) -> Result<ListProjectTerminalShortcutCommandsResult, CommandError> {
        self.project_by_id(input.project_id)?;
        let repository =
            ProjectTerminalShortcutCommandRepository::new(self.project_repository.connection());
        let commands = repository
            .list_commands(input.project_id)
            .map_err(project_terminal_database_error)?
            .into_iter()
            .map(shortcut_command_record_from_row)
            .collect();

        Ok(ListProjectTerminalShortcutCommandsResult { commands })
    }

    pub fn save_shortcut_command(
        &self,
        input: SaveProjectTerminalShortcutCommandInput,
    ) -> Result<ProjectTerminalShortcutCommandRecord, CommandError> {
        self.project_by_id(input.project_id)?;
        let command = validate_shortcut_command(&input.command)?;
        let repository =
            ProjectTerminalShortcutCommandRepository::new(self.project_repository.connection());

        match input.id {
            Some(id) => {
                let existing = repository
                    .find_command_by_id(id)
                    .map_err(project_terminal_database_error)?
                    .ok_or_else(|| {
                        CommandError::new(
                            CommandErrorCode::ProjectTerminalValidationFailed,
                            "常用命令不存在。",
                        )
                        .with_reason("shortcutNotFound")
                        .with_detail(
                            ErrorDetail::new("ProjectTerminalShortcutCommand").with_value("id", id),
                        )
                    })?;
                if existing.project_id != input.project_id {
                    return Err(CommandError::new(
                        CommandErrorCode::ProjectTerminalValidationFailed,
                        "常用命令不属于当前项目。",
                    )
                    .with_reason("shortcutNotInProject")
                    .with_detail(
                        ErrorDetail::new("ProjectTerminalShortcutCommand")
                            .with_value("id", id)
                            .with_value("projectId", input.project_id),
                    ));
                }

                let row = repository
                    .update_command(id, &command, input.sort_order)
                    .map_err(project_terminal_database_error)?;
                Ok(shortcut_command_record_from_row(row))
            }
            None => {
                let count = repository
                    .count_commands(input.project_id)
                    .map_err(project_terminal_database_error)?;
                if count >= PROJECT_TERMINAL_SHORTCUT_COMMAND_MAX_COUNT {
                    return Err(CommandError::new(
                        CommandErrorCode::ProjectTerminalValidationFailed,
                        format!(
                            "常用命令最多 {} 条。",
                            PROJECT_TERMINAL_SHORTCUT_COMMAND_MAX_COUNT
                        ),
                    )
                    .with_reason("shortcutLimitExceeded")
                    .with_detail(
                        ErrorDetail::new("ProjectTerminalShortcutCommand")
                            .with_value("projectId", input.project_id)
                            .with_value("limit", PROJECT_TERMINAL_SHORTCUT_COMMAND_MAX_COUNT),
                    ));
                }

                let row = repository
                    .insert_command(input.project_id, &command, input.sort_order)
                    .map_err(project_terminal_database_error)?;
                Ok(shortcut_command_record_from_row(row))
            }
        }
    }

    pub fn delete_shortcut_command(
        &self,
        input: DeleteProjectTerminalShortcutCommandInput,
    ) -> Result<(), CommandError> {
        let repository =
            ProjectTerminalShortcutCommandRepository::new(self.project_repository.connection());
        let existing = repository
            .find_command_by_id(input.id)
            .map_err(project_terminal_database_error)?
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::ProjectTerminalValidationFailed,
                    "常用命令不存在或已删除。",
                )
                .with_reason("shortcutNotFoundOrDeleted")
                .with_detail(
                    ErrorDetail::new("ProjectTerminalShortcutCommand").with_value("id", input.id),
                )
            })?;

        // 命令归属 project 在 command adapter 层无法直接校验（无 project_id 入参），
        // 这里通过 find_command_by_id 拿到 project_id 后再校验项目存在，保证不泄露其他项目数据。
        self.project_by_id(existing.project_id)?;
        let deleted = repository
            .delete_command(input.id)
            .map_err(project_terminal_database_error)?;
        if !deleted {
            return Err(CommandError::new(
                CommandErrorCode::ProjectTerminalValidationFailed,
                "常用命令不存在或已删除。",
            )
            .with_reason("shortcutNotFoundOrDeleted")
            .with_detail(
                ErrorDetail::new("ProjectTerminalShortcutCommand").with_value("id", input.id),
            ));
        }
        Ok(())
    }

    pub fn list_shortcut_commands_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: ListProjectTerminalShortcutCommandsInput,
    ) -> Result<ListProjectTerminalShortcutCommandsResult, CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).list_shortcut_commands(input)
    }

    pub fn save_shortcut_command_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: SaveProjectTerminalShortcutCommandInput,
    ) -> Result<ProjectTerminalShortcutCommandRecord, CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).save_shortcut_command(input)
    }

    pub fn delete_shortcut_command_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: DeleteProjectTerminalShortcutCommandInput,
    ) -> Result<(), CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).delete_shortcut_command(input)
    }

    fn project_by_id(&self, project_id: i64) -> Result<ProjectSummary, CommandError> {
        self.project_repository
            .find_by_id(project_id)
            .map_err(project_terminal_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            })
    }

    fn cleanup_failed_terminal_create(
        &self,
        project_id: i64,
        config_id: i64,
        pending: Option<PendingPtySession>,
    ) -> Result<(), CommandError> {
        if let Some(pending) = pending {
            pending.terminate();
        }

        self.project_repository
            .delete_project_terminal_config(project_id, config_id)
            .map_err(project_terminal_database_error)
    }

    fn project_terminal_config_by_id(
        &self,
        project_id: i64,
        config_id: i64,
    ) -> Result<Option<ProjectTerminalConfig>, CommandError> {
        let configs = self
            .project_repository
            .list_project_terminal_configs(project_id)
            .map_err(project_terminal_database_error)?;
        Ok(configs.into_iter().find(|config| config.id == config_id))
    }

    fn start_terminal_for_config(
        &self,
        data_dir: &Path,
        config: &ProjectTerminalConfig,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<i64, CommandError> {
        let session_id = registry.allocate_session_id();
        let log_path = terminal_log_path(data_dir, config.project_id, session_id)?;
        let command = if config.launch_command.trim().is_empty() {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
        } else {
            config.launch_command.clone()
        };

        let pending = pty_sessions
            .spawn_pending(&PtySpawnRequest {
                mode: PtyCommandMode::InteractiveRun,
                command,
                working_dir: config.working_dir.clone(),
                log_path: log_path.to_string_lossy().to_string(),
                initial_prompt: None,
                rows: 32,
                cols: 120,
                startup_check_total_ms: STARTUP_CHECK_TOTAL_MS,
                startup_check_interval_ms: STARTUP_CHECK_INTERVAL_MS,
            })
            .map_err(project_terminal_start_error)?;

        if let Err(error) = registry.insert(
            session_id,
            ProjectTerminalSession {
                project_id: config.project_id,
                config_id: config.id,
                name: config.name.clone(),
                log_path: log_path.to_string_lossy().to_string(),
                is_active: true,
            },
        ) {
            pending.terminate();
            return Err(error);
        }

        let registry_on_exit = registry.clone();
        if let Err(PtyRegisterError { message, pending }) =
            pty_sessions.register_for_project(config.project_id, session_id, pending, move |_| {
                registry_on_exit.mark_inactive(session_id);
            })
        {
            let _ = registry.remove(config.project_id, session_id);
            pending.terminate();
            return Err(project_terminal_start_error(message));
        }

        Ok(session_id)
    }
}

fn open_project_database(
    data_dir: impl AsRef<Path>,
) -> Result<crate::db::connection::Database, CommandError> {
    let database = DatabaseConfig::new(data_dir)
        .open()
        .map_err(CommandError::from)?;
    MigrationRunner::default()
        .run(&database.connection)
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::ProjectTerminalPersistenceFailed,
                "Project Terminal 保存失败。",
            )
            .with_reason("saveFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

    Ok(database)
}

fn project_terminal_database_error(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectTerminalPersistenceFailed,
        "Project Terminal 保存失败。",
    )
    .with_reason("saveFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn project_terminal_start_error(error: impl Into<String>) -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectTerminalStartFailed,
        "Project Terminal 启动失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.into()))
}

fn project_terminal_inactive_error(error: impl Into<String>) -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectTerminalValidationFailed,
        "Project Terminal 不可用。",
    )
    .with_reason("terminalUnavailable")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.into()))
}

fn project_terminal_delete_error(error: impl Into<String>) -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectTerminalPersistenceFailed,
        "Project Terminal 删除失败。",
    )
    .with_reason("deleteFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.into()))
}

pub(super) fn project_terminal_persistence_error(message: &str) -> CommandError {
    CommandError::new(CommandErrorCode::ProjectTerminalPersistenceFailed, message)
}

#[cfg(test)]
#[derive(Default)]
struct RestoreTestHooks {
    create_after_config_insert: Option<Arc<dyn Fn(i64, i64) + Send + Sync>>,
    before_start_lock: Option<Arc<dyn Fn(i64, i64) + Send + Sync>>,
    before_spawn: Option<Arc<dyn Fn(i64, i64) + Send + Sync>>,
}

#[cfg(test)]
mod project_terminal_name_tests {
    use super::{next_project_terminal_name, parse_project_terminal_number};

    #[test]
    fn parse_accepts_positive_terminal_numbers() {
        assert_eq!(parse_project_terminal_number("terminal-1"), Some(1));
        assert_eq!(parse_project_terminal_number("terminal-12"), Some(12));
        assert_eq!(parse_project_terminal_number("terminal-0"), None);
        assert_eq!(parse_project_terminal_number("terminal-01"), None);
        assert_eq!(parse_project_terminal_number("terminal-"), None);
        assert_eq!(parse_project_terminal_number("Terminal-1"), None);
        assert_eq!(parse_project_terminal_number("API"), None);
        assert_eq!(parse_project_terminal_number("New Terminal"), None);
    }

    #[test]
    fn next_name_starts_from_one_and_uses_max_plus_one() {
        assert_eq!(
            next_project_terminal_name(std::iter::empty::<&str>()),
            "terminal-1"
        );
        assert_eq!(
            next_project_terminal_name(["terminal-1", "terminal-2"]),
            "terminal-3"
        );
        assert_eq!(
            next_project_terminal_name(["terminal-1", "terminal-3"]),
            "terminal-4"
        );
        assert_eq!(next_project_terminal_name(["API", "Worker"]), "terminal-1");
        assert_eq!(
            next_project_terminal_name(["API", "terminal-2"]),
            "terminal-3"
        );
        assert_eq!(
            next_project_terminal_name(["terminal-1", "terminal-2"]),
            "terminal-3"
        );
    }

    #[test]
    fn next_name_reuses_deleted_max_number() {
        // terminal-1, terminal-2, terminal-3 删除 terminal-3 后，现有最大为 2，下一个复用 3。
        assert_eq!(
            next_project_terminal_name(["terminal-1", "terminal-2"]),
            "terminal-3"
        );
    }
}

#[cfg(test)]
fn restore_test_hooks() -> &'static Mutex<RestoreTestHooks> {
    static HOOKS: std::sync::OnceLock<Mutex<RestoreTestHooks>> = std::sync::OnceLock::new();
    HOOKS.get_or_init(|| Mutex::new(RestoreTestHooks::default()))
}

#[cfg(test)]
fn run_create_after_config_insert_hook(project_id: i64, config_id: i64) {
    let hook = restore_test_hooks()
        .lock()
        .ok()
        .and_then(|hooks| hooks.create_after_config_insert.clone());
    if let Some(hook) = hook {
        hook(project_id, config_id);
    }
}

#[cfg(not(test))]
fn run_create_after_config_insert_hook(_project_id: i64, _config_id: i64) {}

#[cfg(test)]
fn run_restore_before_start_lock_hook(project_id: i64, config_id: i64) {
    let hook = restore_test_hooks()
        .lock()
        .ok()
        .and_then(|hooks| hooks.before_start_lock.clone());
    if let Some(hook) = hook {
        hook(project_id, config_id);
    }
}

#[cfg(not(test))]
fn run_restore_before_start_lock_hook(_project_id: i64, _config_id: i64) {}

#[cfg(test)]
fn run_restore_before_spawn_hook(project_id: i64, config_id: i64) {
    let hook = restore_test_hooks()
        .lock()
        .ok()
        .and_then(|hooks| hooks.before_spawn.clone());
    if let Some(hook) = hook {
        hook(project_id, config_id);
    }
}

#[cfg(not(test))]
fn run_restore_before_spawn_hook(_project_id: i64, _config_id: i64) {}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

    use crate::agent::pty_session_manager::PtySessionManager;
    use crate::db::agent_session_repository::AgentSessionRepository;
    use crate::db::connection::DatabaseConfig;
    use crate::db::project_repository::ProjectRepository;
    use crate::features::project::ProjectService;
    use crate::types::agent_session::WorkspaceMode;
    use crate::types::project::{CreateProjectInput, ProjectWorktreeLocation};
    use crate::types::project_terminal::{
        CloseProjectTerminalInput, CreateProjectTerminalInput, CreateTemporaryProjectTerminalInput,
        DeleteProjectTerminalConfigInput, EnsureProjectTerminalsInput, ListProjectTerminalsInput,
        ReadProjectTerminalInput, ResizeProjectTerminalInput, RestoreProjectTerminalInput,
        UpdateProjectTerminalConfigInput, WriteProjectTerminalInput,
    };

    use super::{restore_test_hooks, ProjectTerminalService};
    use crate::features::project_terminal::log::PROJECT_TERMINAL_LOG_DIR_NAME;
    use crate::features::project_terminal::{purge_terminal_log_dir, ProjectTerminalRegistry};

    fn terminal_test_env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn lock_terminal_test_env() -> MutexGuard<'static, ()> {
        match terminal_test_env_lock().lock() {
            Ok(guard) => guard,
            Err(error) => error.into_inner(),
        }
    }

    struct RestoreHooksGuard;

    impl RestoreHooksGuard {
        fn install(
            create_after_config_insert: Option<Arc<dyn Fn(i64, i64) + Send + Sync>>,
            before_start_lock: Option<Arc<dyn Fn(i64, i64) + Send + Sync>>,
            before_spawn: Option<Arc<dyn Fn(i64, i64) + Send + Sync>>,
        ) -> Self {
            let mut hooks = restore_test_hooks().lock().expect("restore hooks");
            hooks.create_after_config_insert = create_after_config_insert;
            hooks.before_start_lock = before_start_lock;
            hooks.before_spawn = before_spawn;
            Self
        }
    }

    impl Drop for RestoreHooksGuard {
        fn drop(&mut self) {
            if let Ok(mut hooks) = restore_test_hooks().lock() {
                hooks.create_after_config_insert = None;
                hooks.before_start_lock = None;
                hooks.before_spawn = None;
            }
        }
    }

    struct ShellEnvGuard {
        original_shell: Option<std::ffi::OsString>,
    }

    impl ShellEnvGuard {
        fn set_invalid_shell() -> Self {
            let original_shell = std::env::var_os("SHELL");
            std::env::set_var("SHELL", "/path/that/does/not/exist/redwhisk-shell");
            Self { original_shell }
        }
    }

    impl Drop for ShellEnvGuard {
        fn drop(&mut self) {
            match self.original_shell.take() {
                Some(value) => std::env::set_var("SHELL", value),
                None => std::env::remove_var("SHELL"),
            }
        }
    }

    #[test]
    fn project_terminal_create_write_restore_and_close() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: ".".to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        );
        assert!(project.is_err());

        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let created = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("create terminal");

        assert!(created.session_id < 0);
        assert!(created.config_id > 0);
        assert_eq!(created.name, "terminal-1");
        assert_eq!(created.working_dir, current_repo.to_string_lossy());
        assert!(!created.launch_command.is_empty());

        ProjectTerminalService::write_terminal_input(
            WriteProjectTerminalInput {
                project_id: project.id,
                session_id: created.session_id,
                data: "echo project-terminal-test\r".to_string(),
            },
            &registry,
            &manager,
        )
        .expect("write terminal input");

        let mut saw_output = false;
        for _ in 0..40 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let snapshot = ProjectTerminalService::read_terminal_snapshot(
                ReadProjectTerminalInput {
                    project_id: project.id,
                    session_id: created.session_id,
                    max_bytes: Some(8_192),
                },
                &registry,
                &manager,
            )
            .expect("read snapshot");
            if snapshot.snapshot.contains("project-terminal-test") {
                saw_output = true;
                break;
            }
        }

        assert!(saw_output, "expected shell output to include echoed input");

        let restored = ProjectTerminalService::restore_terminal(
            RestoreProjectTerminalInput {
                project_id: project.id,
                session_id: created.session_id,
            },
            &registry,
            &manager,
        )
        .expect("restore terminal");
        assert!(restored.is_active);

        ProjectTerminalService::resize_terminal(
            ResizeProjectTerminalInput {
                project_id: project.id,
                session_id: created.session_id,
                rows: 40,
                cols: 120,
            },
            &registry,
            &manager,
        )
        .expect("resize terminal");

        service
            .close_terminal(
                CloseProjectTerminalInput {
                    project_id: project.id,
                    session_id: created.session_id,
                },
                &registry,
                &manager,
            )
            .expect("close terminal");
    }

    #[test]
    fn temporary_project_terminal_uses_agent_session_working_dir_without_persisting_config() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("redwhisk");
        let worktree_dir = temp_dir.path().join("redwhisk.worktrees/issue-20-redwhisk");
        std::fs::create_dir_all(repo_dir.join(".git")).expect("repo git dir");
        std::fs::create_dir_all(&worktree_dir).expect("worktree dir");
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: repo_dir.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        database
            .connection
            .execute(
                "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
                 VALUES (101, 'Codex', 'codex', 'codex', 'project', ?1, 'full-auto', 1, '', '', 0)",
                rusqlite::params![project.id],
            )
            .expect("insert profile");
        let transaction = database
            .connection
            .unchecked_transaction()
            .expect("transaction");
        let agent_session = AgentSessionRepository::insert_standalone_in_transaction(
            &transaction,
            project.id,
            "Issue 20",
            101,
            &worktree_dir.to_string_lossy(),
            "codex",
            "",
            &WorkspaceMode::Worktree,
            Some("develop"),
            Some("issue-20-redwhisk"),
            Some(&worktree_dir.to_string_lossy()),
            Some(&temp_dir.path().join("redwhisk.worktrees").to_string_lossy()),
            None,
            &temp_dir.path().join("agent-session.log").to_string_lossy(),
            "json",
            1,
        )
        .expect("insert agent session");
        transaction.commit().expect("commit agent session");

        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();
        let created = service
            .create_temporary_terminal_for_agent_session(
                temp_dir.path(),
                CreateTemporaryProjectTerminalInput {
                    project_id: project.id,
                    agent_session_id: agent_session.id,
                },
                &registry,
                &manager,
            )
            .expect("create temporary terminal");

        assert!(created.session_id < 0);
        assert_eq!(created.name, "issue-20-redwhisk");
        assert_eq!(created.working_dir, worktree_dir.to_string_lossy());
        assert!(!created.launch_command.is_empty());

        let configs = ProjectRepository::new(&database.connection)
            .list_project_terminal_configs(project.id)
            .expect("list terminal configs");
        assert!(configs.is_empty());

        service
            .close_terminal(
                CloseProjectTerminalInput {
                    project_id: project.id,
                    session_id: created.session_id,
                },
                &registry,
                &manager,
            )
            .expect("close temporary terminal");
    }

    #[test]
    fn close_terminal_removes_session_log_file() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("log-repo");
        std::fs::create_dir_all(repo_dir.join(".git")).expect("git dir");
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "log-repo".to_string(),
                repo_path: repo_dir.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let created = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("create terminal");

        let log_path = temp_dir.path().join("project-terminal-logs").join(format!(
            "project-{}-terminal-{}.log",
            project.id,
            created.session_id.abs()
        ));
        assert!(
            log_path.exists(),
            "创建终端后应生成日志文件: {}",
            log_path.display()
        );

        service
            .close_terminal(
                CloseProjectTerminalInput {
                    project_id: project.id,
                    session_id: created.session_id,
                },
                &registry,
                &manager,
            )
            .expect("close terminal");

        assert!(
            !log_path.exists(),
            "关闭终端后应删除日志文件: {}",
            log_path.display()
        );
    }

    #[test]
    fn purge_terminal_log_dir_removes_all_log_files() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let log_dir = temp_dir.path().join(PROJECT_TERMINAL_LOG_DIR_NAME);
        std::fs::create_dir_all(&log_dir).expect("create log dir");
        std::fs::write(log_dir.join("project-1-terminal-1.log"), "old output 1")
            .expect("write log 1");
        std::fs::write(log_dir.join("project-2-terminal-1.log"), "old output 2")
            .expect("write log 2");

        purge_terminal_log_dir(temp_dir.path());

        let remaining: Vec<_> = std::fs::read_dir(&log_dir)
            .expect("read log dir")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .collect();
        assert!(
            remaining.is_empty(),
            "启动清理后终端日志目录应为空，剩余: {remaining:?}"
        );
    }

    #[test]
    fn purge_terminal_log_dir_skips_missing_directory_without_panicking() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        purge_terminal_log_dir(temp_dir.path());
        assert!(!temp_dir.path().join(PROJECT_TERMINAL_LOG_DIR_NAME).exists());
    }

    #[test]
    fn project_terminal_create_rolls_back_config_when_pty_start_fails() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("transient-repo");
        std::fs::create_dir_all(repo_dir.join(".git")).expect("git dir");
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "transient-repo".to_string(),
                repo_path: repo_dir.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let _shell_guard = ShellEnvGuard::set_invalid_shell();

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let error = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect_err("starting terminal with missing repo should fail");

        assert_eq!(
            error.code,
            crate::types::errors::CommandErrorCode::ProjectTerminalStartFailed
        );
        let configs = ProjectRepository::new(&database.connection)
            .list_project_terminal_configs(project.id)
            .expect("list terminal configs after failed create");
        assert!(configs.is_empty());
    }

    #[test]
    fn project_terminal_create_rolls_back_config_when_registry_insert_fails() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let poisoned_sessions = registry.sessions.clone();
        let _ = std::thread::spawn(move || {
            let _guard = poisoned_sessions.lock().expect("poison registry lock");
            panic!("poison registry");
        })
        .join();
        let manager = PtySessionManager::new();

        let error = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect_err("registry insert failure should fail create");

        assert_eq!(
            error.code,
            crate::types::errors::CommandErrorCode::ProjectTerminalPersistenceFailed
        );
        let configs = ProjectRepository::new(&database.connection)
            .list_project_terminal_configs(project.id)
            .expect("list terminal configs after registry insert failure");
        assert!(configs.is_empty());
        assert!(!manager.contains(-1));
    }

    #[test]
    fn project_terminal_create_rolls_back_config_when_pty_session_register_fails() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();
        manager.poison_sessions_for_test();

        let error = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect_err("PTY session register failure should fail create");

        assert_eq!(
            error.code,
            crate::types::errors::CommandErrorCode::ProjectTerminalStartFailed
        );
        let configs = ProjectRepository::new(&database.connection)
            .list_project_terminal_configs(project.id)
            .expect("list terminal configs after PTY session register failure");
        assert!(configs.is_empty());
        assert!(!manager.contains(-1));
    }

    #[test]
    fn project_terminal_close_rejects_cross_project_session_without_removing_owner_session() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let other_repo = temp_dir.path().join("other-repo");
        std::fs::create_dir_all(other_repo.join(".git")).expect("other git dir");

        let owner_project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "owner".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create owner project");
        let other_project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "other".to_string(),
                repo_path: other_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create other project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let created = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: owner_project.id,
                },
                &registry,
                &manager,
            )
            .expect("create terminal");

        let error = service
            .close_terminal(
                CloseProjectTerminalInput {
                    project_id: other_project.id,
                    session_id: created.session_id,
                },
                &registry,
                &manager,
            )
            .expect_err("cross-project close should fail");

        assert_eq!(
            error.code,
            crate::types::errors::CommandErrorCode::ProjectTerminalValidationFailed
        );

        let snapshot = ProjectTerminalService::read_terminal_snapshot(
            ReadProjectTerminalInput {
                project_id: owner_project.id,
                session_id: created.session_id,
                max_bytes: Some(1024),
            },
            &registry,
            &manager,
        )
        .expect("owner project should still read session");
        assert_eq!(snapshot.session_id, created.session_id);

        service
            .close_terminal(
                CloseProjectTerminalInput {
                    project_id: owner_project.id,
                    session_id: created.session_id,
                },
                &registry,
                &manager,
            )
            .expect("owner project should still close session");
    }

    #[test]
    fn project_terminal_service_lists_updates_and_deletes_configs_with_project_ownership() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let other_repo = temp_dir.path().join("other-repo");
        std::fs::create_dir_all(other_repo.join(".git")).expect("other git dir");

        let owner_project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "owner".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create owner project");
        let other_project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "other".to_string(),
                repo_path: other_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create other project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let created = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: owner_project.id,
                },
                &registry,
                &manager,
            )
            .expect("create terminal");

        let listed = service
            .list_project_terminals(
                ListProjectTerminalsInput {
                    project_id: owner_project.id,
                },
                &registry,
                &manager,
            )
            .expect("list terminals");
        assert_eq!(listed.terminals.len(), 1);
        assert_eq!(listed.terminals[0].config_id, created.config_id);
        assert_eq!(listed.terminals[0].session_id, created.session_id);

        let updated = service
            .update_project_terminal_config(
                UpdateProjectTerminalConfigInput {
                    project_id: owner_project.id,
                    config_id: created.config_id,
                    name: "API".to_string(),
                    working_dir: current_repo.join("src").to_string_lossy().to_string(),
                    launch_command: "pnpm dev".to_string(),
                },
                &registry,
                &manager,
            )
            .expect("update terminal");
        assert_eq!(updated.terminal.config_id, created.config_id);
        assert_eq!(updated.terminal.session_id, created.session_id);
        assert_eq!(updated.terminal.name, "API");
        assert_eq!(updated.terminal.launch_command, "pnpm dev");

        let cross_project_update = service.update_project_terminal_config(
            UpdateProjectTerminalConfigInput {
                project_id: other_project.id,
                config_id: created.config_id,
                name: "Worker".to_string(),
                working_dir: other_repo.to_string_lossy().to_string(),
                launch_command: "pnpm worker".to_string(),
            },
            &registry,
            &manager,
        );
        assert!(cross_project_update.is_err());

        let deleted = service
            .delete_project_terminal_config(
                DeleteProjectTerminalConfigInput {
                    project_id: owner_project.id,
                    config_id: created.config_id,
                },
                &registry,
                &manager,
            )
            .expect("delete terminal config");
        assert_eq!(deleted.config_id, created.config_id);
        assert_eq!(deleted.session_id, Some(created.session_id));
        let mut removed_from_manager = false;
        for _ in 0..20 {
            if !manager.contains(created.session_id) {
                removed_from_manager = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        assert!(
            removed_from_manager,
            "expected PTY session to exit after delete"
        );

        let listed_after_delete = service
            .list_project_terminals(
                ListProjectTerminalsInput {
                    project_id: owner_project.id,
                },
                &registry,
                &manager,
            )
            .expect("list terminals after delete");
        assert!(listed_after_delete.terminals.is_empty());

        let cross_project_delete = service.delete_project_terminal_config(
            DeleteProjectTerminalConfigInput {
                project_id: other_project.id,
                config_id: created.config_id,
            },
            &registry,
            &manager,
        );
        assert!(cross_project_delete.is_err());
    }

    #[test]
    fn project_terminal_restore_replaces_stale_session_for_same_config() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let created = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("create terminal");

        manager
            .kill(created.session_id)
            .expect("kill initial PTY session");
        for _ in 0..20 {
            if !manager.contains(created.session_id) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }

        service
            .restore_project_terminals(temp_dir.path(), project.id, &registry, &manager)
            .expect("restore project terminals");

        let matching_sessions = registry
            .sessions
            .lock()
            .expect("registry sessions")
            .values()
            .filter(|session| {
                session.project_id == project.id && session.config_id == created.config_id
            })
            .count();
        assert_eq!(matching_sessions, 1);

        let listed = service
            .list_project_terminals(
                ListProjectTerminalsInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("list restored terminals");
        assert_eq!(listed.terminals.len(), 1);
        assert_ne!(listed.terminals[0].session_id, 0);
        assert_ne!(listed.terminals[0].session_id, created.session_id);
    }

    #[test]
    fn project_terminal_restore_deduplicates_concurrent_start_for_same_config() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let created = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("create terminal");

        manager
            .kill(created.session_id)
            .expect("kill initial PTY session");
        for _ in 0..20 {
            if !manager.contains(created.session_id) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }

        let registry = Arc::new(registry);
        let manager = Arc::new(manager);
        let entered = Arc::new(AtomicUsize::new(0));
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Arc::new(Mutex::new(release_rx));
        let _hooks = RestoreHooksGuard::install(
            None,
            None,
            Some({
                let entered = Arc::clone(&entered);
                let release_rx = Arc::clone(&release_rx);
                Arc::new(move |project_id, config_id| {
                    if project_id != project.id || config_id != created.config_id {
                        return;
                    }
                    entered.fetch_add(1, Ordering::SeqCst);
                    release_rx
                        .lock()
                        .expect("release rx")
                        .recv()
                        .expect("release restore start");
                })
            }),
        );

        let mut handles = Vec::new();
        for _ in 0..2 {
            let registry = Arc::clone(&registry);
            let manager = Arc::clone(&manager);
            let data_dir = temp_dir.path().to_path_buf();
            handles.push(std::thread::spawn(move || {
                ProjectTerminalService::restore_project_terminals_in_data_dir(
                    data_dir, project.id, &registry, &manager,
                )
            }));
        }

        for _ in 0..40 {
            if entered.load(Ordering::SeqCst) >= 1 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        let entered_count = entered.load(Ordering::SeqCst);

        release_tx.send(()).expect("release first");
        if entered_count > 1 {
            release_tx.send(()).expect("release second");
        }

        for handle in handles {
            handle
                .join()
                .expect("join restore thread")
                .expect("restore should succeed");
        }

        assert_eq!(entered_count, 1);

        let sessions = registry
            .sessions
            .lock()
            .expect("registry sessions")
            .values()
            .filter(|session| {
                session.project_id == project.id && session.config_id == created.config_id
            })
            .count();
        assert_eq!(sessions, 1);
    }

    #[test]
    fn project_terminal_delete_prevents_restore_from_restarting_deleted_config() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let created = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("create terminal");

        manager
            .kill(created.session_id)
            .expect("kill initial PTY session");
        for _ in 0..20 {
            if !manager.contains(created.session_id) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }

        let registry = Arc::new(registry);
        let manager = Arc::new(manager);
        let (paused_tx, paused_rx) = mpsc::channel::<()>();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Arc::new(Mutex::new(release_rx));
        let _hooks = RestoreHooksGuard::install(
            None,
            Some({
                Arc::new(move |project_id, config_id| {
                    if project_id != project.id || config_id != created.config_id {
                        return;
                    }
                    paused_tx.send(()).expect("signal paused restore");
                    release_rx
                        .lock()
                        .expect("release rx")
                        .recv()
                        .expect("release restore");
                })
            }),
            None,
        );

        let registry_for_thread = Arc::clone(&registry);
        let manager_for_thread = Arc::clone(&manager);
        let data_dir = temp_dir.path().to_path_buf();
        let restore_handle = std::thread::spawn(move || {
            ProjectTerminalService::restore_project_terminals_in_data_dir(
                data_dir,
                project.id,
                &registry_for_thread,
                &manager_for_thread,
            )
        });

        paused_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("wait restore pause");

        let deleted = service
            .delete_project_terminal_config(
                DeleteProjectTerminalConfigInput {
                    project_id: project.id,
                    config_id: created.config_id,
                },
                &registry,
                &manager,
            )
            .expect("delete config while restore paused");
        assert_eq!(deleted.config_id, created.config_id);

        release_tx.send(()).expect("release restore");
        restore_handle
            .join()
            .expect("join restore thread")
            .expect("restore should succeed");

        let listed = service
            .list_project_terminals(
                ListProjectTerminalsInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("list terminals after delete");
        assert!(listed.terminals.is_empty());

        let matching_sessions = registry
            .sessions
            .lock()
            .expect("registry sessions")
            .values()
            .filter(|session| {
                session.project_id == project.id && session.config_id == created.config_id
            })
            .count();
        assert_eq!(matching_sessions, 0);
    }

    #[test]
    fn project_terminal_restore_waits_for_create_to_finish_for_new_config() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let registry = Arc::new(ProjectTerminalRegistry::new());
        let manager = Arc::new(PtySessionManager::new());
        let (paused_tx, paused_rx) = mpsc::channel::<()>();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Arc::new(Mutex::new(release_rx));
        let _hooks = RestoreHooksGuard::install(
            Some({
                Arc::new(move |project_id, _config_id| {
                    if project_id != project.id {
                        return;
                    }
                    paused_tx.send(()).expect("signal create pause");
                    release_rx
                        .lock()
                        .expect("release rx")
                        .recv()
                        .expect("release create");
                })
            }),
            None,
            None,
        );

        let registry_for_create = Arc::clone(&registry);
        let manager_for_create = Arc::clone(&manager);
        let data_dir_for_create = temp_dir.path().to_path_buf();
        let create_handle = std::thread::spawn(move || {
            ProjectTerminalService::create_terminal_in_data_dir(
                data_dir_for_create,
                CreateProjectTerminalInput {
                    project_id: project.id,
                },
                &registry_for_create,
                &manager_for_create,
            )
        });

        paused_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("wait create pause");

        let registry_for_restore = Arc::clone(&registry);
        let manager_for_restore = Arc::clone(&manager);
        let data_dir_for_restore = temp_dir.path().to_path_buf();
        let restore_handle = std::thread::spawn(move || {
            ProjectTerminalService::restore_project_terminals_in_data_dir(
                data_dir_for_restore,
                project.id,
                &registry_for_restore,
                &manager_for_restore,
            )
        });

        std::thread::sleep(std::time::Duration::from_millis(150));
        assert!(
            !restore_handle.is_finished(),
            "restore should wait until create releases the project lock"
        );

        release_tx.send(()).expect("release create");
        let created = create_handle
            .join()
            .expect("join create thread")
            .expect("create terminal");
        restore_handle
            .join()
            .expect("join restore thread")
            .expect("restore should succeed");

        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let listed = service
            .list_project_terminals(
                ListProjectTerminalsInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("list terminals");
        assert_eq!(listed.terminals.len(), 1);
        assert_eq!(listed.terminals[0].config_id, created.config_id);
        assert_eq!(listed.terminals[0].session_id, created.session_id);

        let matching_sessions = registry
            .sessions
            .lock()
            .expect("registry sessions")
            .values()
            .filter(|session| {
                session.project_id == project.id && session.config_id == created.config_id
            })
            .count();
        assert_eq!(matching_sessions, 1);
    }

    #[test]
    fn project_terminal_delete_keeps_config_when_kill_fails() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let created = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("create terminal");
        manager.fail_kill_for_session_for_test(created.session_id);

        let error = service
            .delete_project_terminal_config(
                DeleteProjectTerminalConfigInput {
                    project_id: project.id,
                    config_id: created.config_id,
                },
                &registry,
                &manager,
            )
            .expect_err("delete should fail when kill fails");

        assert_eq!(
            error.code,
            crate::types::errors::CommandErrorCode::ProjectTerminalPersistenceFailed
        );

        let listed = service
            .list_project_terminals(
                ListProjectTerminalsInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("list terminals after failed delete");
        assert_eq!(listed.terminals.len(), 1);
        assert_eq!(listed.terminals[0].config_id, created.config_id);
        assert_eq!(listed.terminals[0].session_id, created.session_id);
        assert!(manager.contains(created.session_id));
    }

    #[test]
    fn project_terminal_survives_abnormal_exit_of_foreground_command() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let created = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("create terminal");

        // 等待交互式 shell 就绪（exec $SHELL 完成初始化）。
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let probe = ProjectTerminalService::read_terminal_snapshot(
                ReadProjectTerminalInput {
                    project_id: project.id,
                    session_id: created.session_id,
                    max_bytes: Some(256),
                },
                &registry,
                &manager,
            )
            .expect("probe snapshot");
            if probe.is_active && !probe.snapshot.is_empty() {
                break;
            }
        }
        // 额外等待 shell 读取启动配置完成，避免命令被吞。
        std::thread::sleep(std::time::Duration::from_millis(500));

        // 在交互式 shell 里运行一个会异常退出的前台命令（模拟 grok 这类 TUI 崩溃），
        // 紧跟存活探针：子进程崩溃后 shell 应继续回显 SURVIVED-<code>。
        ProjectTerminalService::write_terminal_input(
            WriteProjectTerminalInput {
                project_id: project.id,
                session_id: created.session_id,
                data: "sh -c 'kill -SEGV $$'; echo SURVIVED-$?\r".to_string(),
            },
            &registry,
            &manager,
        )
        .expect("write input");

        // 轮询等待 shell 恢复并回显探针。
        let mut echoed = false;
        for _ in 0..60 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let snapshot = ProjectTerminalService::read_terminal_snapshot(
                ReadProjectTerminalInput {
                    project_id: project.id,
                    session_id: created.session_id,
                    max_bytes: Some(8_192),
                },
                &registry,
                &manager,
            )
            .expect("read snapshot");
            if snapshot.snapshot.contains("SURVIVED-") {
                echoed = true;
                break;
            }
            if !snapshot.is_active {
                break;
            }
        }

        let snapshot = ProjectTerminalService::read_terminal_snapshot(
            ReadProjectTerminalInput {
                project_id: project.id,
                session_id: created.session_id,
                max_bytes: Some(8_192),
            },
            &registry,
            &manager,
        )
        .expect("final snapshot");

        assert!(
            snapshot.is_active,
            "交互式 shell 必须在前台命令异常退出后存活；snapshot 尾部:\n{}",
            snapshot.snapshot
        );
        assert!(
            echoed,
            "shell 应在子进程崩溃后继续回显探针；snapshot 尾部:\n{}",
            snapshot.snapshot
        );

        service
            .close_terminal(
                CloseProjectTerminalInput {
                    project_id: project.id,
                    session_id: created.session_id,
                },
                &registry,
                &manager,
            )
            .expect("close terminal");
    }

    #[test]
    fn project_terminal_keeps_shell_after_launch_command_exits() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        // 启动命令设为会自行退出且写入 marker 文件的命令（模拟 grok 被 ctrl+c 后退出）。
        // 走 InteractiveRun 包装：`$SHELL -lc '<cmd>; exec $SHELL -li'`，命令退出后保留 shell。
        let marker = temp_dir.path().join("launch_ran");
        let launch_command = format!("sh -c 'echo ran > {}'", marker.display());
        let config = service
            .project_repository
            .insert_project_terminal_config(
                project.id,
                "auto-exit",
                &project.repo_path,
                &launch_command,
            )
            .expect("insert terminal config");

        let session_id = service
            .start_terminal_for_config(temp_dir.path(), &config, &registry, &manager)
            .expect("start terminal for config");

        // 轮询 marker 文件，确定性验证启动命令已执行（不依赖 snapshot 时序与窗口）。
        let mut launched = false;
        for _ in 0..80 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            if marker.exists() {
                launched = true;
                break;
            }
        }
        // 等待 exec 后的交互式 login shell 完成 .zshrc 初始化，避免探针被启动过程吞掉。
        std::thread::sleep(std::time::Duration::from_millis(1500));

        // 启动命令已退出，注入存活探针：shell 应继续回显 SURVIVED-<code>。
        ProjectTerminalService::write_terminal_input(
            WriteProjectTerminalInput {
                project_id: project.id,
                session_id,
                data: "echo SURVIVED-$?\r".to_string(),
            },
            &registry,
            &manager,
        )
        .expect("write probe");

        let mut echoed = false;
        for _ in 0..120 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let snapshot = ProjectTerminalService::read_terminal_snapshot(
                ReadProjectTerminalInput {
                    project_id: project.id,
                    session_id,
                    max_bytes: Some(8_192),
                },
                &registry,
                &manager,
            )
            .expect("read snapshot");
            if snapshot.snapshot.contains("SURVIVED-") {
                echoed = true;
                break;
            }
            if !snapshot.is_active {
                break;
            }
        }

        let snapshot = ProjectTerminalService::read_terminal_snapshot(
            ReadProjectTerminalInput {
                project_id: project.id,
                session_id,
                max_bytes: Some(8_192),
            },
            &registry,
            &manager,
        )
        .expect("final snapshot");

        assert!(
            launched,
            "启动命令应被执行；snapshot 尾部:\n{}",
            snapshot.snapshot
        );
        assert!(
            snapshot.is_active,
            "启动命令退出后 session 必须保持 active；snapshot 尾部:\n{}",
            snapshot.snapshot
        );
        assert!(
            echoed,
            "启动命令退出后 shell 应继续回显探针；snapshot 尾部:\n{}",
            snapshot.snapshot
        );

        service
            .close_terminal(
                CloseProjectTerminalInput {
                    project_id: project.id,
                    session_id,
                },
                &registry,
                &manager,
            )
            .expect("close terminal");
    }

    #[test]
    fn project_terminal_keeps_shell_after_launch_command_interrupted_by_ctrl_c() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        // 启动命令为一个长时间运行的前台进程（模拟 `pnpm dev`），Ctrl+C 应只中断它，
        // 不能连带杀死 `-lc` 包装 shell；中断后包装 shell 应继续 `exec $SHELL -li`
        // 落到交互式 login shell 并保持 session active。
        let config = service
            .project_repository
            .insert_project_terminal_config(
                project.id,
                "long-running",
                &project.repo_path,
                "sleep 30",
            )
            .expect("insert terminal config");

        let session_id = service
            .start_terminal_for_config(temp_dir.path(), &config, &registry, &manager)
            .expect("start terminal for config");

        // 等待 `-lc` 包装 shell 启动并进入 sleep 前台。
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let probe = ProjectTerminalService::read_terminal_snapshot(
                ReadProjectTerminalInput {
                    project_id: project.id,
                    session_id,
                    max_bytes: Some(256),
                },
                &registry,
                &manager,
            )
            .expect("probe snapshot");
            if probe.is_active {
                break;
            }
        }
        // 额外等待确保 sleep 已在前台运行。
        std::thread::sleep(std::time::Duration::from_millis(300));

        // 发送 Ctrl+C（SIGINT）。
        ProjectTerminalService::write_terminal_input(
            WriteProjectTerminalInput {
                project_id: project.id,
                session_id,
                data: "\x03".to_string(),
            },
            &registry,
            &manager,
        )
        .expect("write ctrl-c");

        // 等待 exec 后的交互式 login shell 完成 .zshrc 初始化，避免探针被启动过程吞掉。
        std::thread::sleep(std::time::Duration::from_millis(1500));

        // 注入存活探针：交互式 shell 应回显 SURVIVED-<code>。
        ProjectTerminalService::write_terminal_input(
            WriteProjectTerminalInput {
                project_id: project.id,
                session_id,
                data: "echo SURVIVED-$?\r".to_string(),
            },
            &registry,
            &manager,
        )
        .expect("write probe");

        let mut echoed = false;
        for _ in 0..120 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let snapshot = ProjectTerminalService::read_terminal_snapshot(
                ReadProjectTerminalInput {
                    project_id: project.id,
                    session_id,
                    max_bytes: Some(8_192),
                },
                &registry,
                &manager,
            )
            .expect("read snapshot");
            if snapshot.snapshot.contains("SURVIVED-") {
                echoed = true;
                break;
            }
            if !snapshot.is_active {
                break;
            }
        }

        let snapshot = ProjectTerminalService::read_terminal_snapshot(
            ReadProjectTerminalInput {
                project_id: project.id,
                session_id,
                max_bytes: Some(8_192),
            },
            &registry,
            &manager,
        )
        .expect("final snapshot");

        assert!(
            snapshot.is_active,
            "Ctrl+C 中断启动命令后 session 必须保持 active；snapshot 尾部:\n{}",
            snapshot.snapshot
        );
        assert!(
            echoed,
            "Ctrl+C 后 shell 应继续回显探针；snapshot 尾部:\n{}",
            snapshot.snapshot
        );

        service
            .close_terminal(
                CloseProjectTerminalInput {
                    project_id: project.id,
                    session_id,
                },
                &registry,
                &manager,
            )
            .expect("close terminal");
    }

    #[test]
    fn save_shortcut_command_allows_limit_and_rejects_beyond() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("shortcut-limit-repo");
        std::fs::create_dir_all(repo_dir.join(".git")).expect("git dir");
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "shortcut-limit".to_string(),
                repo_path: repo_dir.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));

        use super::PROJECT_TERMINAL_SHORTCUT_COMMAND_MAX_COUNT;
        use crate::types::project_terminal_shortcut_command::SaveProjectTerminalShortcutCommandInput;

        for index in 0..PROJECT_TERMINAL_SHORTCUT_COMMAND_MAX_COUNT {
            service
                .save_shortcut_command(SaveProjectTerminalShortcutCommandInput {
                    id: None,
                    project_id: project.id,
                    command: format!("cmd-{index}"),
                    sort_order: index,
                })
                .unwrap_or_else(|error| {
                    panic!("save within limit failed at {index}: {error:?}");
                });
        }

        let listed = service
            .list_shortcut_commands(
                crate::types::project_terminal_shortcut_command::ListProjectTerminalShortcutCommandsInput {
                    project_id: project.id,
                },
            )
            .expect("list shortcuts");
        assert_eq!(
            listed.commands.len() as i64,
            PROJECT_TERMINAL_SHORTCUT_COMMAND_MAX_COUNT
        );

        let error = service
            .save_shortcut_command(SaveProjectTerminalShortcutCommandInput {
                id: None,
                project_id: project.id,
                command: "cmd-overflow".to_string(),
                sort_order: PROJECT_TERMINAL_SHORTCUT_COMMAND_MAX_COUNT,
            })
            .expect_err("31st shortcut must be rejected");

        assert_eq!(error.reason.as_deref(), Some("shortcutLimitExceeded"));
        assert!(
            error
                .message
                .contains(&PROJECT_TERMINAL_SHORTCUT_COMMAND_MAX_COUNT.to_string()),
            "error message should include limit: {}",
            error.message
        );

        let serialized = serde_json::to_value(&error).expect("serialize error");
        let details = serialized
            .get("details")
            .and_then(|value| value.as_array())
            .expect("details array");
        let limit = details.iter().find_map(|detail| detail.get("limit"));
        assert_eq!(
            limit.and_then(|value| value.as_i64()),
            Some(PROJECT_TERMINAL_SHORTCUT_COMMAND_MAX_COUNT)
        );
    }

    fn wait_until_session_absent(manager: &PtySessionManager, session_id: i64) {
        for _ in 0..40 {
            if !manager.contains(session_id) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        assert!(
            !manager.contains(session_id),
            "session {session_id} still present"
        );
    }

    #[test]
    fn ensure_starts_empty_launch_command_as_shell_with_active_session() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let repository = ProjectRepository::new(&database.connection);
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let config = repository
            .insert_project_terminal_config(
                project.id,
                "shell-empty",
                &current_repo.to_string_lossy(),
                "",
            )
            .expect("insert empty launch config");

        let ensured = service
            .ensure_project_terminals(
                temp_dir.path(),
                EnsureProjectTerminalsInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("ensure shell terminals");

        assert!(
            ensured.shell_failures.is_empty(),
            "{:?}",
            ensured.shell_failures
        );
        assert_eq!(ensured.terminals.len(), 1);
        assert_eq!(ensured.terminals[0].config_id, config.id);
        assert_ne!(
            ensured.terminals[0].session_id, 0,
            "empty launchCommand Shell 类 ensure 后必须有活跃 sessionId"
        );
        assert!(manager.contains(ensured.terminals[0].session_id));
    }

    #[test]
    fn ensure_starts_default_shell_launch_command_with_active_session() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let created = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("create terminal");
        manager
            .kill(created.session_id)
            .expect("kill initial session");
        wait_until_session_absent(&manager, created.session_id);

        let ensured = service
            .ensure_project_terminals(
                temp_dir.path(),
                EnsureProjectTerminalsInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("ensure after kill");

        assert!(
            ensured.shell_failures.is_empty(),
            "{:?}",
            ensured.shell_failures
        );
        assert_eq!(ensured.terminals.len(), 1);
        assert_ne!(ensured.terminals[0].session_id, 0);
        assert_ne!(ensured.terminals[0].session_id, created.session_id);
        assert!(manager.contains(ensured.terminals[0].session_id));
    }

    #[test]
    fn ensure_is_idempotent_and_keeps_single_active_session() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let created = service
            .create_terminal(
                temp_dir.path(),
                CreateProjectTerminalInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("create terminal");

        let first = service
            .ensure_project_terminals(
                temp_dir.path(),
                EnsureProjectTerminalsInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("first ensure");
        let second = service
            .ensure_project_terminals(
                temp_dir.path(),
                EnsureProjectTerminalsInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("second ensure");

        assert_eq!(first.terminals[0].session_id, created.session_id);
        assert_eq!(second.terminals[0].session_id, created.session_id);

        let matching_sessions = registry
            .sessions
            .lock()
            .expect("registry sessions")
            .values()
            .filter(|session| {
                session.project_id == project.id && session.config_id == created.config_id
            })
            .count();
        assert_eq!(
            matching_sessions, 1,
            "ensure 不得对同一 config 产生双活 session"
        );
    }

    #[test]
    fn ensure_reports_shell_start_failure_without_pretending_success() {
        let _env_lock = lock_terminal_test_env();
        let _shell_guard = ShellEnvGuard::set_invalid_shell();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let repository = ProjectRepository::new(&database.connection);
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        let config = repository
            .insert_project_terminal_config(
                project.id,
                "broken-shell",
                &current_repo.to_string_lossy(),
                "",
            )
            .expect("insert shell config");

        let ensured = service
            .ensure_project_terminals(
                temp_dir.path(),
                EnsureProjectTerminalsInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("ensure should return Ok with shell_failures");

        assert_eq!(ensured.terminals.len(), 1);
        assert_eq!(ensured.terminals[0].session_id, 0);
        assert_eq!(ensured.shell_failures.len(), 1);
        assert_eq!(ensured.shell_failures[0].config_id, config.id);
        assert_eq!(ensured.shell_failures[0].name, "broken-shell");
        assert!(!ensured.shell_failures[0].message.is_empty());
    }

    #[test]
    fn ensure_command_type_is_not_reported_as_shell_failure() {
        let _env_lock = lock_terminal_test_env();
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let current_repo = std::env::current_dir()
            .expect("cwd")
            .parent()
            .expect("repo root")
            .to_path_buf();
        let project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "redwhisk".to_string(),
                repo_path: current_repo.to_string_lossy().to_string(),
                worktree_location: ProjectWorktreeLocation::RepoSibling,
                worktree_setup_command: "".to_string(),
            },
        )
        .expect("create project");

        let database = DatabaseConfig::new(temp_dir.path())
            .open()
            .expect("open database");
        crate::db::migrations::MigrationRunner::default()
            .run(&database.connection)
            .expect("run migrations");
        let repository = ProjectRepository::new(&database.connection);
        let service = ProjectTerminalService::new(ProjectRepository::new(&database.connection));
        let registry = ProjectTerminalRegistry::new();
        let manager = PtySessionManager::new();

        // InteractiveRun 会把业务命令包进默认 shell keepalive，因此即便命令不存在
        // 通常仍会起交互 shell；本断言只要求命令型不得进入 shell_failures。
        repository
            .insert_project_terminal_config(
                project.id,
                "command-type",
                &current_repo.to_string_lossy(),
                "/path/that/does/not/exist/redwhisk-cmd",
            )
            .expect("insert command config");

        let ensured = service
            .ensure_project_terminals(
                temp_dir.path(),
                EnsureProjectTerminalsInput {
                    project_id: project.id,
                },
                &registry,
                &manager,
            )
            .expect("ensure command type");

        assert!(
            ensured.shell_failures.is_empty(),
            "命令型不得进入 shell_failures: {:?}",
            ensured.shell_failures
        );
        assert_eq!(ensured.terminals.len(), 1);
        assert_eq!(ensured.terminals[0].name, "command-type");
    }
}
