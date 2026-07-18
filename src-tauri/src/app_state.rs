use std::sync::Mutex;

use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_registry::AgentSessionRegistry;
use crate::agent_skill::index::AgentSkillIndex;
use crate::local_data_service::LocalDataService;
use crate::features::project_terminal::ProjectTerminalRegistry;

pub struct AppState {
    pub agent_skills: AgentSkillIndex,
    pub local_data: Mutex<LocalDataService>,
    pub pty_sessions: PtySessionManager,
    pub project_terminals: ProjectTerminalRegistry,
    /// 结构化 agent session 事件广播器，AppHandle 在 setup 阶段注入。
    pub agent_event_broadcaster: AgentEventBroadcaster,
    /// 运中的结构化 agent 会话句柄注册表（Codex / 未来 Claude 等共用）。
    pub agent_sessions: AgentSessionRegistry,
}

impl AppState {
    pub fn new(local_data: LocalDataService) -> Self {
        Self {
            agent_skills: AgentSkillIndex::default(),
            local_data: Mutex::new(local_data),
            pty_sessions: PtySessionManager::new(),
            project_terminals: ProjectTerminalRegistry::new(),
            agent_event_broadcaster: AgentEventBroadcaster::new(),
            agent_sessions: AgentSessionRegistry::new(),
        }
    }
}
