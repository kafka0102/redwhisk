use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use crate::agent::pty_session_manager::{
    read_terminal_snapshot, PendingPtySession, PtyRegisterError, PtySessionManager, PtySpawnRequest,
};
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project::ProjectSummary;
use crate::types::project_terminal::{
    CloseProjectTerminalInput, CreateProjectTerminalInput, CreateProjectTerminalResult,
    DeleteProjectTerminalConfigInput, DeleteProjectTerminalConfigResult, ListProjectTerminalsInput,
    ListProjectTerminalsResult, ProjectTerminalSummary, ReadProjectTerminalInput,
    ReadProjectTerminalResult, ResizeProjectTerminalInput, RestoreProjectTerminalInput,
    RestoreProjectTerminalResult, UpdateProjectTerminalConfigInput,
    UpdateProjectTerminalConfigResult, WriteProjectTerminalInput,
};
use crate::types::project_terminal_config::ProjectTerminalConfig;

const DEFAULT_PROJECT_TERMINAL_NAME: &str = "New Terminal";
const PROJECT_TERMINAL_LOG_DIR_NAME: &str = "project-terminal-logs";
const STARTUP_CHECK_TOTAL_MS: u64 = 500;
const STARTUP_CHECK_INTERVAL_MS: u64 = 25;

#[derive(Clone)]
pub struct ProjectTerminalRegistry {
    next_session_id: Arc<AtomicI64>,
    sessions: Arc<Mutex<HashMap<i64, ProjectTerminalSession>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProjectTerminalSession {
    project_id: i64,
    config_id: i64,
    name: String,
    log_path: String,
    is_active: bool,
}

pub struct ProjectTerminalService<'connection> {
    project_repository: ProjectRepository<'connection>,
}

impl Default for ProjectTerminalRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ProjectTerminalRegistry {
    pub fn new() -> Self {
        Self {
            next_session_id: Arc::new(AtomicI64::new(-1)),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn allocate_session_id(&self) -> i64 {
        self.next_session_id.fetch_sub(1, Ordering::SeqCst)
    }

    fn insert(&self, session_id: i64, session: ProjectTerminalSession) -> Result<(), CommandError> {
        self.sessions
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 保存失败。"))?
            .insert(session_id, session);
        Ok(())
    }

    fn find(
        &self,
        project_id: i64,
        session_id: i64,
    ) -> Result<ProjectTerminalSession, CommandError> {
        self.sessions
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 查询失败。"))?
            .get(&session_id)
            .filter(|session| session.project_id == project_id)
            .cloned()
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::ProjectTerminalValidationFailed,
                    "Project Terminal 不存在。",
                )
                .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
                .with_detail(
                    ErrorDetail::new("ProjectTerminal").with_value("sessionId", session_id),
                )
            })
    }

    fn sessions_by_config_id(
        &self,
        project_id: i64,
        config_id: i64,
    ) -> Result<Vec<(i64, ProjectTerminalSession)>, CommandError> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 查询失败。"))?
            .iter()
            .filter(|(_, session)| {
                session.project_id == project_id && session.config_id == config_id
            })
            .map(|(session_id, session)| (*session_id, session.clone()))
            .collect();

        Ok(session)
    }

    fn rename_session(
        &self,
        project_id: i64,
        config_id: i64,
        name: &str,
    ) -> Result<(), CommandError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 保存失败。"))?;
        for (_, session) in sessions.iter_mut().filter(|(_, session)| {
            session.project_id == project_id && session.config_id == config_id
        }) {
            session.name = name.to_string();
        }

        Ok(())
    }

    fn remove_sessions_by_config_id(
        &self,
        project_id: i64,
        config_id: i64,
    ) -> Result<Vec<(i64, ProjectTerminalSession)>, CommandError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 删除失败。"))?;
        let session_ids = sessions
            .iter()
            .filter(|(_, session)| {
                session.project_id == project_id && session.config_id == config_id
            })
            .map(|(session_id, _)| *session_id)
            .collect::<Vec<_>>();
        let removed = session_ids
            .into_iter()
            .filter_map(|session_id| {
                sessions
                    .remove(&session_id)
                    .map(|session| (session_id, session))
            })
            .collect();

        Ok(removed)
    }

    pub fn mark_inactive(&self, session_id: i64) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(session) = sessions.get_mut(&session_id) {
                session.is_active = false;
            }
        }
    }

    fn remove(
        &self,
        project_id: i64,
        session_id: i64,
    ) -> Result<ProjectTerminalSession, CommandError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 删除失败。"))?;
        let session = sessions.get(&session_id).cloned().ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::ProjectTerminalValidationFailed,
                "Project Terminal 不存在。",
            )
            .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            .with_detail(ErrorDetail::new("ProjectTerminal").with_value("sessionId", session_id))
        })?;

        if session.project_id != project_id {
            return Err(CommandError::new(
                CommandErrorCode::ProjectTerminalValidationFailed,
                "Project Terminal 不属于当前 Project。",
            )
            .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            .with_detail(ErrorDetail::new("ProjectTerminal").with_value("sessionId", session_id)));
        }

        sessions.remove(&session_id);

        Ok(session)
    }
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
        let session_id = registry.allocate_session_id();
        let log_path = terminal_log_path(data_dir.as_ref(), project.id, session_id)?;
        let shell_command = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let config = self
            .project_repository
            .insert_project_terminal_config(
                project.id,
                DEFAULT_PROJECT_TERMINAL_NAME,
                &project.repo_path,
                &shell_command,
            )
            .map_err(project_terminal_database_error)?;

        let pending = match pty_sessions.spawn_pending(&PtySpawnRequest {
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
                name: DEFAULT_PROJECT_TERMINAL_NAME.to_string(),
                log_path: log_path.to_string_lossy().to_string(),
                is_active: true,
            },
        ) {
            self.cleanup_failed_terminal_create(project.id, config.id, Some(pending))?;
            return Err(error);
        }

        let registry_on_exit = registry.clone();
        if let Err(PtyRegisterError { message, pending }) =
            pty_sessions.register_for_project(project.id, session_id, pending, move |_| {
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
            name: config.name,
            working_dir: config.working_dir,
            launch_command: config.launch_command,
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
        let sessions = registry.sessions_by_config_id(input.project_id, input.config_id)?;

        self.project_repository
            .delete_project_terminal_config(input.project_id, input.config_id)
            .map_err(project_terminal_database_error)?;

        let session_id = if let Some((session_id, _)) =
            preferred_project_terminal_session(sessions.clone(), pty_sessions)
        {
            let removed =
                registry.remove_sessions_by_config_id(input.project_id, input.config_id)?;
            for (removed_session_id, removed_session) in removed {
                if removed_session.is_active && pty_sessions.contains(removed_session_id) {
                    let _ = pty_sessions.kill(removed_session_id);
                }
            }
            Some(session_id)
        } else if !sessions.is_empty() {
            let removed =
                registry.remove_sessions_by_config_id(input.project_id, input.config_id)?;
            for (removed_session_id, removed_session) in removed {
                if removed_session.is_active && pty_sessions.contains(removed_session_id) {
                    let _ = pty_sessions.kill(removed_session_id);
                }
            }
            sessions.first().map(|(session_id, _)| *session_id)
        } else {
            None
        };

        Ok(DeleteProjectTerminalConfigResult {
            config_id: input.config_id,
            session_id,
        })
    }

    pub fn restore_project_terminals(
        &self,
        data_dir: impl AsRef<Path>,
        project_id: i64,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        self.project_by_id(project_id)?;
        let configs = self
            .project_repository
            .list_project_terminal_configs(project_id)
            .map_err(project_terminal_database_error)?;

        for config in configs {
            let sessions = registry.sessions_by_config_id(project_id, config.id)?;
            if let Some((session_id, session)) =
                preferred_project_terminal_session(sessions.clone(), pty_sessions)
            {
                if session.is_active && pty_sessions.contains(session_id) {
                    continue;
                }
            }

            let _ = registry.remove_sessions_by_config_id(project_id, config.id);

            let _ =
                self.start_terminal_for_config(data_dir.as_ref(), &config, registry, pty_sessions);
        }

        Ok(())
    }

    pub fn read_terminal_snapshot(
        &self,
        input: ReadProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<ReadProjectTerminalResult, CommandError> {
        self.project_by_id(input.project_id)?;
        let session = registry.find(input.project_id, input.session_id)?;
        let snapshot = read_terminal_snapshot(
            Path::new(&session.log_path),
            input.max_bytes.unwrap_or(32_768),
        )
        .map_err(project_terminal_start_error)?;

        Ok(ReadProjectTerminalResult {
            session_id: input.session_id,
            snapshot,
            is_active: session.is_active && pty_sessions.contains(input.session_id),
        })
    }

    pub fn write_terminal_input(
        &self,
        input: WriteProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        self.project_by_id(input.project_id)?;
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

    pub fn restore_terminal(
        &self,
        input: RestoreProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<RestoreProjectTerminalResult, CommandError> {
        self.project_by_id(input.project_id)?;
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
            chunks: snapshot.chunks,
            is_complete: snapshot.is_complete,
            is_active: true,
        })
    }

    pub fn resize_terminal(
        &self,
        input: ResizeProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        self.project_by_id(input.project_id)?;
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

    pub fn read_terminal_snapshot_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: ReadProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<ReadProjectTerminalResult, CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).read_terminal_snapshot(
            input,
            registry,
            pty_sessions,
        )
    }

    pub fn write_terminal_input_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: WriteProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).write_terminal_input(input, registry, pty_sessions)
    }

    pub fn restore_terminal_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: RestoreProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<RestoreProjectTerminalResult, CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).restore_terminal(input, registry, pty_sessions)
    }

    pub fn resize_terminal_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: ResizeProjectTerminalInput,
        registry: &ProjectTerminalRegistry,
        pty_sessions: &PtySessionManager,
    ) -> Result<(), CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectTerminalService::new(repository).resize_terminal(input, registry, pty_sessions)
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

fn project_terminal_summary(
    config: ProjectTerminalConfig,
    session: Option<(i64, ProjectTerminalSession)>,
    pty_sessions: &PtySessionManager,
) -> ProjectTerminalSummary {
    let session_id = match session {
        Some((session_id, session)) if session.is_active && pty_sessions.contains(session_id) => {
            session_id
        }
        _ => 0,
    };

    ProjectTerminalSummary {
        config_id: config.id,
        session_id,
        name: config.name,
        working_dir: config.working_dir,
        launch_command: config.launch_command,
    }
}

fn preferred_project_terminal_session(
    sessions: Vec<(i64, ProjectTerminalSession)>,
    pty_sessions: &PtySessionManager,
) -> Option<(i64, ProjectTerminalSession)> {
    sessions
        .iter()
        .find(|(session_id, session)| session.is_active && pty_sessions.contains(*session_id))
        .cloned()
        .or_else(|| sessions.into_iter().next())
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
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

    Ok(database)
}

fn terminal_log_path(
    data_dir: &Path,
    project_id: i64,
    session_id: i64,
) -> Result<PathBuf, CommandError> {
    let log_dir = data_dir.join(PROJECT_TERMINAL_LOG_DIR_NAME);
    std::fs::create_dir_all(&log_dir).map_err(|error| {
        CommandError::new(
            CommandErrorCode::ProjectTerminalPersistenceFailed,
            "Project Terminal 保存失败。",
        )
        .with_detail(
            ErrorDetail::new("Path").with_value("path", log_dir.to_string_lossy().to_string()),
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    Ok(log_dir.join(format!(
        "project-{project_id}-terminal-{}.log",
        session_id.abs()
    )))
}

fn project_terminal_database_error(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectTerminalPersistenceFailed,
        "Project Terminal 保存失败。",
    )
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
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.into()))
}

fn project_terminal_persistence_error(message: &str) -> CommandError {
    CommandError::new(CommandErrorCode::ProjectTerminalPersistenceFailed, message)
}

#[cfg(test)]
mod tests {
    use std::sync::{Mutex, MutexGuard, OnceLock};

    use crate::agent::pty_session_manager::PtySessionManager;
    use crate::core::project_service::ProjectService;
    use crate::db::connection::DatabaseConfig;
    use crate::db::project_repository::ProjectRepository;
    use crate::types::project::{CreateProjectInput, ProjectCompletionPolicy};
    use crate::types::project_terminal::{
        CloseProjectTerminalInput, CreateProjectTerminalInput, DeleteProjectTerminalConfigInput,
        ListProjectTerminalsInput, ReadProjectTerminalInput, ResizeProjectTerminalInput,
        RestoreProjectTerminalInput, UpdateProjectTerminalConfigInput, WriteProjectTerminalInput,
    };

    use super::{ProjectTerminalRegistry, ProjectTerminalService};

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
                completion_policy: ProjectCompletionPolicy::Manual,
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
                completion_policy: ProjectCompletionPolicy::Manual,
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
        assert_eq!(created.name, "New Terminal");
        assert_eq!(created.working_dir, current_repo.to_string_lossy());
        assert!(!created.launch_command.is_empty());

        service
            .write_terminal_input(
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
            let snapshot = service
                .read_terminal_snapshot(
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

        let restored = service
            .restore_terminal(
                RestoreProjectTerminalInput {
                    project_id: project.id,
                    session_id: created.session_id,
                },
                &registry,
                &manager,
            )
            .expect("restore terminal");
        assert!(restored.is_active);

        service
            .resize_terminal(
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
                completion_policy: ProjectCompletionPolicy::Manual,
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
                completion_policy: ProjectCompletionPolicy::Manual,
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
                completion_policy: ProjectCompletionPolicy::Manual,
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
                completion_policy: ProjectCompletionPolicy::Manual,
            },
        )
        .expect("create owner project");
        let other_project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "other".to_string(),
                repo_path: other_repo.to_string_lossy().to_string(),
                completion_policy: ProjectCompletionPolicy::Manual,
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

        let snapshot = service
            .read_terminal_snapshot(
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
                completion_policy: ProjectCompletionPolicy::Manual,
            },
        )
        .expect("create owner project");
        let other_project = ProjectService::create_project_in_data_dir(
            temp_dir.path(),
            CreateProjectInput {
                name: "other".to_string(),
                repo_path: other_repo.to_string_lossy().to_string(),
                completion_policy: ProjectCompletionPolicy::Manual,
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
                completion_policy: ProjectCompletionPolicy::Manual,
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
}
