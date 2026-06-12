use std::sync::Mutex;

use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent_skill::index::AgentSkillIndex;
use crate::core::local_data_service::LocalDataService;

pub struct AppState {
    pub agent_skills: AgentSkillIndex,
    pub local_data: Mutex<LocalDataService>,
    pub pty_sessions: PtySessionManager,
}

impl AppState {
    pub fn new(local_data: LocalDataService) -> Self {
        Self {
            agent_skills: AgentSkillIndex::default(),
            local_data: Mutex::new(local_data),
            pty_sessions: PtySessionManager::new(),
        }
    }
}
