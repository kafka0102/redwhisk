use std::collections::HashMap;
use std::sync::Mutex;

use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_registry::AgentSessionRegistry;
use crate::agent_skill::index::AgentSkillIndex;
use crate::features::code_language::CodeLanguageHostRegistry;
use crate::features::project_terminal::ProjectTerminalRegistry;
use crate::local_data_service::LocalDataService;

pub struct AppState {
    pub agent_skills: AgentSkillIndex,
    pub local_data: Mutex<LocalDataService>,
    pub pty_sessions: PtySessionManager,
    pub project_terminals: ProjectTerminalRegistry,
    pub code_language_hosts: CodeLanguageHostRegistry,
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
            code_language_hosts: CodeLanguageHostRegistry::new(),
            agent_event_broadcaster: AgentEventBroadcaster::new(),
            agent_sessions: AgentSessionRegistry::new(),
            project_windows: Mutex::new(HashMap::new()),
        }
    }

    /// 登记「项目当前显示在哪个窗口」，并返回被本次登记顶掉（displaced）的项目 id（升序）。
    /// - 同一项目重复登记会覆盖旧值；
    /// - 同一窗口先清除其它项目的归属（一窗一项目），避免本窗切换后旧项目仍被标为已开窗。
    ///
    /// 被顶掉的项目按「项目 → 窗口一对一」移除，随即不再显示在任何存活窗口。调用方需再用
    /// `AppHandle::get_webview_window` 核验其是否仍显示在别处后，才终止其运行态（避免误杀）。
    pub fn record_project_window(&self, project_id: i64, window_label: String) -> Vec<i64> {
        let Ok(mut windows) = self.project_windows.lock() else {
            return Vec::new();
        };
        let mut displaced = Vec::new();
        windows.retain(|id, label| {
            if *id == project_id {
                true
            } else if label.as_str() == window_label {
                displaced.push(*id);
                false
            } else {
                true
            }
        });
        windows.insert(project_id, window_label);
        displaced.sort_unstable();
        displaced
    }

    /// 查询项目当前所在窗口 label；调用方需再用 `AppHandle::get_webview_window` 核验窗口仍在。
    pub fn find_project_window(&self, project_id: i64) -> Option<String> {
        self.project_windows.lock().ok()?.get(&project_id).cloned()
    }

    /// 移除某项目已登记的窗口条目（窗口被销毁或项目重开时清理过期归属）。
    pub fn forget_project_window(&self, project_id: i64) {
        if let Ok(mut windows) = self.project_windows.lock() {
            windows.remove(&project_id);
        }
    }

    /// 窗口销毁时清除该窗口的全部归属，并返回其曾归属的项目 id 集合（升序）。
    ///
    /// 项目 → 窗口是一对一映射（`record_project_window` 保证同一项目只登记一个窗口），
    /// 因此被移除的项目随之不再显示在任何存活窗口 —— 调用方据此终止其运行态。
    pub fn take_projects_for_window(&self, window_label: &str) -> Vec<i64> {
        let Ok(mut windows) = self.project_windows.lock() else {
            return Vec::new();
        };
        let mut owned = Vec::new();
        windows.retain(|project_id, label| {
            let belongs_to_window = label.as_str() == window_label;
            if belongs_to_window {
                owned.push(*project_id);
            }
            !belongs_to_window
        });
        owned.sort_unstable();
        owned
    }

    /// 终止某项目的全部运行态，返回本次终止的 session id（升序）。
    ///
    /// 这是「终止项目运行态」的唯一入口：窗口销毁、主窗口切走项目、应用退出三种触发点共用，
    /// 保证行为一致。终止对象并列为：该项目全部 PTY 会话（项目终端与 TUI 模式 Agent 会话共用
    /// 同一注册路径）+ 该项目全部结构化 Agent 会话。已无运行态时返回空、不报错。
    pub fn terminate_project_runtime(&self, project_id: i64) -> Vec<i64> {
        let mut terminated = self.pty_sessions.kill_project(project_id);
        terminated.extend(self.agent_sessions.shutdown_project(project_id));
        terminated.sort_unstable();
        terminated
    }

    /// 终止当前所有仍持有运行态的项目（应用退出路径），返回被终止的项目 id（升序）。
    ///
    /// 以运行态注册表为准枚举项目（PTY 与结构化会话两个注册表取并集），不依赖窗口归属映射
    /// （退出时窗口可能已被销毁）；覆盖「只有结构化会话、没有 PTY」的项目。无运行态的项目
    /// 不会被枚举，因此不存在「已无运行态」导致的错误。
    pub fn terminate_all_project_runtimes(&self) -> Vec<i64> {
        let mut project_ids = self.pty_sessions.registered_project_ids();
        project_ids.extend(self.agent_sessions.registered_project_ids());
        project_ids.sort_unstable();
        project_ids.dedup();
        let mut terminated = Vec::new();
        for project_id in project_ids {
            if !self.terminate_project_runtime(project_id).is_empty() {
                terminated.push(project_id);
            }
        }
        terminated
    }
}

#[cfg(test)]
mod tests {
    use super::AppState;
    use crate::agent::session_handle::AgentSessionHandle;
    use crate::agent::session_registry::test_support::RecordingStubHandle;
    use crate::local_data_service::LocalDataService;
    use std::sync::Arc;

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
    fn recording_project_clears_other_projects_on_same_window() {
        let state = empty_state();
        state.record_project_window(7, "main".to_string());
        state.record_project_window(9, "main".to_string());

        assert!(
            state.find_project_window(7).is_none(),
            "本窗切换到项目 9 后项目 7 不应仍占 main"
        );
        assert_eq!(
            state.find_project_window(9).as_deref(),
            Some("main"),
            "新项目应登记到 main"
        );
    }

    #[test]
    fn record_project_window_reports_displaced_project() {
        let state = empty_state();

        assert!(
            state.record_project_window(7, "main".to_string()).is_empty(),
            "首次登记没有项目被顶掉"
        );
        assert_eq!(
            state.record_project_window(9, "main".to_string()),
            vec![7],
            "同一窗口换项目应返回被顶掉的旧项目，供调用方核验其是否仍显示在别处"
        );
        assert!(
            state.record_project_window(9, "main".to_string()).is_empty(),
            "重复登记同一项目不应产生被顶掉项目"
        );
    }

    #[test]
    fn recording_project_on_one_window_does_not_displace_project_on_another_window() {
        let state = empty_state();
        state.record_project_window(7, "main".to_string());

        // 项目 7 显示在 main，项目 9 显示在 project-9：在 project-9 登记不涉及 main 上的 7。
        assert!(
            state
                .record_project_window(9, "project-9".to_string())
                .is_empty(),
            "另一窗口的项目不属于本窗，不构成被顶掉"
        );
        assert_eq!(
            state.find_project_window(7).as_deref(),
            Some("main"),
            "仍显示在其它窗口的项目不应进入被顶掉集合，也就不会被终止"
        );
    }

    #[test]
    fn take_projects_for_window_returns_owned_and_leaves_other_windows() {
        let state = empty_state();
        state.record_project_window(7, "main".to_string());
        state.record_project_window(9, "project-9".to_string());

        let orphaned = state.take_projects_for_window("main");

        assert_eq!(
            orphaned,
            vec![7],
            "窗口销毁后应返回其曾归属的项目；其它窗口的项目不应进入集合"
        );
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
    fn take_projects_for_window_without_projects_is_empty() {
        let state = empty_state();
        state.record_project_window(7, "main".to_string());

        assert!(
            state.take_projects_for_window("empty-window").is_empty(),
            "未归属任何项目的窗口不应产生待终止项目"
        );
        assert_eq!(
            state.find_project_window(7).as_deref(),
            Some("main"),
            "无关窗口的清理不应影响既有归属"
        );
    }

    #[test]
    fn forget_project_window_is_scoped() {
        let state = empty_state();
        state.record_project_window(7, "main".to_string());
        state.record_project_window(9, "project-9".to_string());

        state.forget_project_window(7);

        assert!(
            state.find_project_window(7).is_none(),
            "按项目清除只移除指定项目"
        );
        assert_eq!(
            state.find_project_window(9).as_deref(),
            Some("project-9"),
            "其它项目归属应保留"
        );
    }

    #[test]
    fn terminate_project_runtime_terminates_only_target_project_sessions() {
        let state = empty_state();
        state
            .pty_sessions
            .insert_capturing_session_for_project_for_test(11, 7, true);
        state
            .pty_sessions
            .insert_capturing_session_for_project_for_test(22, 9, true);

        assert_eq!(
            state.terminate_project_runtime(7),
            vec![11],
            "共享终止入口应终止目标项目的全部会话"
        );
        assert_eq!(
            state.terminate_project_runtime(9),
            vec![22],
            "终止一个项目不应影响其它项目"
        );
    }

    #[test]
    fn terminate_all_project_runtimes_covers_every_project_with_sessions() {
        let state = empty_state();
        state
            .pty_sessions
            .insert_capturing_session_for_project_for_test(11, 7, true);
        state
            .pty_sessions
            .insert_capturing_session_for_project_for_test(22, 7, true);
        state
            .pty_sessions
            .insert_capturing_session_for_project_for_test(33, 9, true);

        assert_eq!(
            state.terminate_all_project_runtimes(),
            vec![7, 9],
            "应用退出应对所有仍持有运行态的项目执行终止"
        );
    }

    #[test]
    fn terminate_all_project_runtimes_without_sessions_is_noop() {
        let state = empty_state();

        assert!(
            state.terminate_all_project_runtimes().is_empty(),
            "无任何运行态时退出终止应安全返回、不报错"
        );
    }

    #[test]
    fn terminate_project_runtime_closes_structured_sessions_of_target_project() {
        let state = empty_state();
        let target = Arc::new(RecordingStubHandle::new());
        let other = Arc::new(RecordingStubHandle::new());
        state
            .agent_sessions
            .register(7, 11, Arc::clone(&target) as Arc<dyn AgentSessionHandle>);
        state
            .agent_sessions
            .register(9, 22, Arc::clone(&other) as Arc<dyn AgentSessionHandle>);

        let terminated = state.terminate_project_runtime(7);

        assert_eq!(
            terminated,
            vec![11],
            "共享终止入口应关闭目标项目的结构化会话"
        );
        assert_eq!(target.shutdown_count(), 1, "目标结构化句柄应被关闭一次");
        assert!(!state.agent_sessions.contains(11), "关闭后目标句柄应已摘除");
        assert_eq!(other.shutdown_count(), 0, "不应关闭其它项目的结构化句柄");
        assert!(state.agent_sessions.contains(22), "其它项目句柄应保留");
    }

    #[test]
    fn terminate_project_runtime_closes_both_pty_and_structured_sessions() {
        let state = empty_state();
        state
            .pty_sessions
            .insert_capturing_session_for_project_for_test(11, 7, true);
        let handle = Arc::new(RecordingStubHandle::new());
        state
            .agent_sessions
            .register(7, 44, Arc::clone(&handle) as Arc<dyn AgentSessionHandle>);

        let terminated = state.terminate_project_runtime(7);

        assert_eq!(
            terminated,
            vec![11, 44],
            "终止入口应同时覆盖 PTY 与结构化会话（升序）"
        );
        assert_eq!(handle.shutdown_count(), 1, "结构化句柄应被关闭一次");
    }

    #[test]
    fn terminate_all_project_runtimes_covers_structured_only_projects() {
        let state = empty_state();
        let a = Arc::new(RecordingStubHandle::new());
        let b = Arc::new(RecordingStubHandle::new());
        state
            .agent_sessions
            .register(7, 11, Arc::clone(&a) as Arc<dyn AgentSessionHandle>);
        state
            .agent_sessions
            .register(9, 22, Arc::clone(&b) as Arc<dyn AgentSessionHandle>);

        assert_eq!(
            state.terminate_all_project_runtimes(),
            vec![7, 9],
            "仅有结构化会话、没有 PTY 的项目也应被退出终止枚举覆盖"
        );
        assert_eq!(a.shutdown_count(), 1, "项目 7 的结构化句柄应被关闭");
        assert_eq!(b.shutdown_count(), 1, "项目 9 的结构化句柄应被关闭");
    }
}
