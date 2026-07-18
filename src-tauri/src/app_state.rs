use std::collections::HashMap;
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
    /// 项目当前所在窗口的映射（projectId → windowLabel）。切换项目时据此去重：
    /// 若目标项目已显示在某窗口（含被 main 占用的），聚焦该窗口而非新开。
    /// 在 `open_project` 成功后按调用方窗口登记；窗口销毁时清除指向它的条目。
    project_windows: Mutex<HashMap<i64, String>>,
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
            project_windows: Mutex::new(HashMap::new()),
        }
    }

    /// 登记「项目当前显示在哪个窗口」。重复登记同一项目会覆盖旧值（窗口切换后更新归属）。
    pub fn record_project_window(&self, project_id: i64, window_label: String) {
        if let Ok(mut windows) = self.project_windows.lock() {
            windows.insert(project_id, window_label);
        }
    }

    /// 查询项目当前所在窗口 label；调用方需再用 `AppHandle::get_webview_window` 核验窗口仍在。
    pub fn find_project_window(&self, project_id: i64) -> Option<String> {
        self.project_windows
            .lock()
            .ok()?
            .get(&project_id)
            .cloned()
    }

    /// 移除某项目已登记的窗口条目（窗口被销毁或项目重开时清理过期归属）。
    pub fn forget_project_window(&self, project_id: i64) {
        if let Ok(mut windows) = self.project_windows.lock() {
            windows.remove(&project_id);
        }
    }

    /// 窗口销毁时清除所有指向该 label 的映射（同一窗口不会同时显示多个项目，retain 足够）。
    pub fn forget_window(&self, window_label: &str) {
        if let Ok(mut windows) = self.project_windows.lock() {
            windows.retain(|_, label| label != window_label);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AppState;
    use crate::local_data_service::LocalDataService;

    fn empty_state() -> AppState {
        AppState::new(LocalDataService::new())
    }

    #[test]
    fn records_and_finds_project_window() {
        let state = empty_state();
        state.record_project_window(7, "main".to_string());

        assert_eq!(
            state.find_project_window(7).as_deref(),
            Some("main"),
            "登记后应能按项目查到窗口"
        );
    }

    #[test]
    fn recording_again_overwrites_previous_window() {
        let state = empty_state();
        state.record_project_window(7, "main".to_string());
        state.record_project_window(7, "project-7".to_string());

        assert_eq!(
            state.find_project_window(7).as_deref(),
            Some("project-7"),
            "项目换窗口后应反映最新归属"
        );
    }

    #[test]
    fn forget_window_clears_only_matching_entries() {
        let state = empty_state();
        state.record_project_window(7, "main".to_string());
        state.record_project_window(9, "project-9".to_string());

        state.forget_window("main");

        assert!(
            state.find_project_window(7).is_none(),
            "main 销毁后项目 7 的归属应清除"
        );
        assert_eq!(
            state.find_project_window(9).as_deref(),
            Some("project-9"),
            "其它窗口的归属不应受影响"
        );
    }

    #[test]
    fn forget_project_window_is_scoped() {
        let state = empty_state();
        state.record_project_window(7, "main".to_string());
        state.record_project_window(9, "main".to_string());

        state.forget_project_window(7);

        assert!(
            state.find_project_window(7).is_none(),
            "按项目清除只移除指定项目"
        );
        assert_eq!(
            state.find_project_window(9).as_deref(),
            Some("main"),
            "同窗口的其它项目归属应保留"
        );
    }
}
