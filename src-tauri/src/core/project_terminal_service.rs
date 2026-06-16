use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use crate::agent::pty_session_manager::{
    read_terminal_snapshot, PendingPtySession, PtySessionManager, PtySpawnRequest,
};
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project::ProjectSummary;
use crate::types::project_terminal::{
    CloseProjectTerminalInput, CreateProjectTerminalInput, CreateProjectTerminalResult,
    ReadProjectTerminalInput, ReadProjectTerminalResult, ResizeProjectTerminalInput,
    RestoreProjectTerminalInput, RestoreProjectTerminalResult, WriteProjectTerminalInput,
};

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
                name: DEFAULT_PROJECT_TERMINAL_NAME.to_string(),
                log_path: log_path.to_string_lossy().to_string(),
                is_active: true,
            },
        ) {
            self.cleanup_failed_terminal_create(project.id, config.id, Some(pending))?;
            return Err(error);
        }

        let registry_on_exit = registry.clone();
        pty_sessions.register_for_project(project.id, session_id, pending, move |_| {
            registry_on_exit.mark_inactive(session_id);
        });

        Ok(CreateProjectTerminalResult {
            config_id: config.id,
            session_id,
            name: config.name,
            working_dir: config.working_dir,
            launch_command: config.launch_command,
        })
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
    use std::sync::{Mutex, OnceLock};

    use crate::agent::pty_session_manager::PtySessionManager;
    use crate::core::project_service::ProjectService;
    use crate::db::connection::DatabaseConfig;
    use crate::db::project_repository::ProjectRepository;
    use crate::types::project::{CreateProjectInput, ProjectCompletionPolicy};
    use crate::types::project_terminal::{
        CloseProjectTerminalInput, CreateProjectTerminalInput, ReadProjectTerminalInput,
        ResizeProjectTerminalInput, RestoreProjectTerminalInput, WriteProjectTerminalInput,
    };

    use super::{ProjectTerminalRegistry, ProjectTerminalService};

    fn terminal_test_env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
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
        let _env_lock = terminal_test_env_lock().lock().expect("terminal env lock");
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
        let _env_lock = terminal_test_env_lock().lock().expect("terminal env lock");
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
        let _env_lock = terminal_test_env_lock().lock().expect("terminal env lock");
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
    fn project_terminal_close_rejects_cross_project_session_without_removing_owner_session() {
        let _env_lock = terminal_test_env_lock().lock().expect("terminal env lock");
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
}
