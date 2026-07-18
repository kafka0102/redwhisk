use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use crate::agent::pty_session_manager::PtySessionManager;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project_terminal::ProjectTerminalSummary;
use crate::types::project_terminal_config::ProjectTerminalConfig;

use super::service::project_terminal_persistence_error;

#[derive(Clone)]
pub struct ProjectTerminalRegistry {
    next_session_id: Arc<AtomicI64>,
    pub(super) sessions: Arc<Mutex<HashMap<i64, ProjectTerminalSession>>>,
    project_locks: Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>,
    config_locks: Arc<Mutex<HashMap<(i64, i64), Arc<Mutex<()>>>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProjectTerminalSession {
    pub(super) project_id: i64,
    pub(super) config_id: i64,
    pub(super) name: String,
    pub(super) log_path: String,
    pub(super) is_active: bool,
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
            project_locks: Arc::new(Mutex::new(HashMap::new())),
            config_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn allocate_session_id(&self) -> i64 {
        self.next_session_id.fetch_sub(1, Ordering::SeqCst)
    }

    pub(super) fn insert(&self, session_id: i64, session: ProjectTerminalSession) -> Result<(), CommandError> {
        self.sessions
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 保存失败。").with_reason("saveFailed"))?
            .insert(session_id, session);
        Ok(())
    }

    pub(super) fn find(
        &self,
        project_id: i64,
        session_id: i64,
    ) -> Result<ProjectTerminalSession, CommandError> {
        self.sessions
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 查询失败。").with_reason("queryFailed"))?
            .get(&session_id)
            .filter(|session| session.project_id == project_id)
            .cloned()
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::ProjectTerminalValidationFailed,
                    "Project Terminal 不存在。",
                ).with_reason("terminalNotFound")
                .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
                .with_detail(
                    ErrorDetail::new("ProjectTerminal").with_value("sessionId", session_id),
                )
            })
    }

    pub(super) fn sessions_by_config_id(
        &self,
        project_id: i64,
        config_id: i64,
    ) -> Result<Vec<(i64, ProjectTerminalSession)>, CommandError> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 查询失败。").with_reason("queryFailed"))?
            .iter()
            .filter(|(_, session)| {
                session.project_id == project_id && session.config_id == config_id
            })
            .map(|(session_id, session)| (*session_id, session.clone()))
            .collect();

        Ok(session)
    }

    pub(super) fn rename_session(
        &self,
        project_id: i64,
        config_id: i64,
        name: &str,
    ) -> Result<(), CommandError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 保存失败。").with_reason("saveFailed"))?;
        for (_, session) in sessions.iter_mut().filter(|(_, session)| {
            session.project_id == project_id && session.config_id == config_id
        }) {
            session.name = name.to_string();
        }

        Ok(())
    }

    pub(super) fn remove_sessions_by_config_id(
        &self,
        project_id: i64,
        config_id: i64,
    ) -> Result<Vec<(i64, ProjectTerminalSession)>, CommandError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 删除失败。").with_reason("deleteFailed"))?;
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

    pub(super) fn remove(
        &self,
        project_id: i64,
        session_id: i64,
    ) -> Result<ProjectTerminalSession, CommandError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 删除失败。").with_reason("deleteFailed"))?;
        let session = sessions.get(&session_id).cloned().ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::ProjectTerminalValidationFailed,
                "Project Terminal 不存在。",
            ).with_reason("terminalNotFound")
            .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            .with_detail(ErrorDetail::new("ProjectTerminal").with_value("sessionId", session_id))
        })?;

        if session.project_id != project_id {
            return Err(CommandError::new(
                CommandErrorCode::ProjectTerminalValidationFailed,
                "Project Terminal 不属于当前 Project。",
            ).with_reason("terminalNotInProject")
            .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            .with_detail(ErrorDetail::new("ProjectTerminal").with_value("sessionId", session_id)));
        }

        sessions.remove(&session_id);

        Ok(session)
    }

    pub(super) fn with_config_lock<T>(
        &self,
        project_id: i64,
        config_id: i64,
        action: impl FnOnce() -> Result<T, CommandError>,
    ) -> Result<T, CommandError> {
        let lock = {
            let mut config_locks = self
                .config_locks
                .lock()
                .map_err(|_| project_terminal_persistence_error("Project Terminal 保存失败。").with_reason("saveFailed"))?;
            config_locks
                .entry((project_id, config_id))
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };

        let _guard = lock
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 保存失败。").with_reason("saveFailed"))?;
        action()
    }

    pub(super) fn with_project_lock<T>(
        &self,
        project_id: i64,
        action: impl FnOnce() -> Result<T, CommandError>,
    ) -> Result<T, CommandError> {
        let lock = {
            let mut project_locks = self
                .project_locks
                .lock()
                .map_err(|_| project_terminal_persistence_error("Project Terminal 保存失败。").with_reason("saveFailed"))?;
            project_locks
                .entry(project_id)
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };

        let _guard = lock
            .lock()
            .map_err(|_| project_terminal_persistence_error("Project Terminal 保存失败。").with_reason("saveFailed"))?;
        action()
    }
}
pub(super) fn project_terminal_summary(
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

pub(super) fn preferred_project_terminal_session(
    sessions: Vec<(i64, ProjectTerminalSession)>,
    pty_sessions: &PtySessionManager,
) -> Option<(i64, ProjectTerminalSession)> {
    sessions
        .iter()
        .find(|(session_id, session)| session.is_active && pty_sessions.contains(*session_id))
        .cloned()
        .or_else(|| sessions.into_iter().next())
}

pub(super) fn final_path_segment(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}
