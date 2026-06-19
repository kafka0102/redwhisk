use std::sync::Mutex;

use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent_skill::index::AgentSkillIndex;
use crate::core::local_data_service::LocalDataService;
use crate::core::project_terminal_service::ProjectTerminalRegistry;

pub struct AppState {
    pub agent_skills: AgentSkillIndex,
    pub local_data: Mutex<LocalDataService>,
    pub pty_sessions: PtySessionManager,
    pub project_terminals: ProjectTerminalRegistry,
    /// Codex session 结构化事件广播器，AppHandle 在 setup 阶段注入。
    pub agent_event_broadcaster: AgentEventBroadcaster,
}

impl AppState {
    pub fn new(local_data: LocalDataService) -> Self {
        Self {
            agent_skills: AgentSkillIndex::default(),
            local_data: Mutex::new(local_data),
            pty_sessions: PtySessionManager::new(),
            project_terminals: ProjectTerminalRegistry::new(),
            agent_event_broadcaster: AgentEventBroadcaster::new(),
        }
    }
}
