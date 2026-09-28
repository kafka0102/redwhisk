//! 运行中的结构化 agent 会话句柄注册表。
//!
//! 镜像 `PtySessionManager` 的 Clone + Arc 模式：Tauri 命令层通过
//! `AppState.agent_sessions` 拿到 `AgentSessionRegistry`（Clone 廉价，
//! 内部状态共享），按 `session_id` 取回 `Arc<dyn AgentSessionHandle>`。
//!
//! 注册表不绑定具体 agent 实现：Codex / 未来 Claude 等都通过实现
//! `AgentSessionHandle` trait 接入，注册时以 trait 对象存储。

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use super::session_handle::AgentSessionHandle;

/// 结构化 agent 会话注册表。Clone 共享底层 `Arc` 状态。
#[derive(Clone, Default)]
pub struct AgentSessionRegistry {
    store: Arc<AgentSessionStore>,
}

struct AgentSessionStore {
    sessions: Mutex<HashMap<i64, RegisteredSession>>,
    /// 已写入 DB（`running`）但尚未 register 真实 handle 的 session id。
    ///
    /// 用于在 `start_agent_session` / `resume_agent_session` 等
    /// 闭包内，DB 事务 commit 之后、handle 启动与 `register` 之前的窗口期，
    /// 让 `contains` 返回 `true`，避免并发 reconcile（如轮询
    /// `list_agent_sessions` 触发的 `reconcile_unrecoverable_running_sessions`）
    /// 把刚创建的 session 误判为"重启遗留"并标记 `stopped`。
    starting: Mutex<HashSet<i64>>,
}

/// 注册表里一条运行中的会话记录：句柄 + 它所属的项目。
///
/// 记录 `project_id` 使注册表能按项目关闭会话：项目关闭时，只 shutdown
/// 归属该项目的结构化句柄，不影响其它项目。
struct RegisteredSession {
    project_id: i64,
    handle: Arc<dyn AgentSessionHandle>,
}

impl Default for AgentSessionStore {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            starting: Mutex::new(HashSet::new()),
        }
    }
}

impl AgentSessionRegistry {
    pub fn new() -> Self {
        Self {
            store: Arc::new(AgentSessionStore {
                sessions: Mutex::new(HashMap::new()),
                starting: Mutex::new(HashSet::new()),
            }),
        }
    }

    /// 注册一个运行中的会话句柄，并登记其项目归属。若同 id 已存在，旧句柄被
    /// 覆盖（调用方负责确保旧句柄已 `shutdown`）。
    ///
    /// 注册成功后自动清除 `mark_starting` 留下的启动中标记。
    pub fn register(&self, project_id: i64, session_id: i64, handle: Arc<dyn AgentSessionHandle>) {
        if let Ok(mut sessions) = self.store.sessions.lock() {
            sessions.insert(session_id, RegisteredSession { project_id, handle });
        }
        if let Ok(mut starting) = self.store.starting.lock() {
            starting.remove(&session_id);
        }
    }

    /// 注销会话句柄并返回（供调用方执行 `shutdown`）。
    ///
    /// 同时清除可能残留的启动中标记，避免标记泄漏。
    pub fn unregister(&self, session_id: i64) -> Option<Arc<dyn AgentSessionHandle>> {
        if let Ok(mut starting) = self.store.starting.lock() {
            starting.remove(&session_id);
        }
        self.store
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(&session_id).map(|entry| entry.handle))
    }

    /// 取回运行中的会话句柄。
    pub fn get(&self, session_id: i64) -> Option<Arc<dyn AgentSessionHandle>> {
        self.store.sessions.lock().ok().and_then(|sessions| {
            sessions
                .get(&session_id)
                .map(|entry| Arc::clone(&entry.handle))
        })
    }

    /// 关闭归属指定项目的全部结构化会话：逐个 `shutdown` 并从注册表摘除，
    /// 复用既有 shutdown 语义。返回本次关闭的 session id（升序）。
    ///
    /// 只作用于已 register 真实 handle 的会话；其它项目不受影响。项目无归属句柄
    /// 时返回空、不报错，因此重复调用安全。
    pub fn shutdown_project(&self, project_id: i64) -> Vec<i64> {
        let mut closed: Vec<(i64, Arc<dyn AgentSessionHandle>)> = match self.store.sessions.lock() {
            Ok(mut sessions) => {
                let session_ids: Vec<i64> = sessions
                    .iter()
                    .filter(|(_, entry)| entry.project_id == project_id)
                    .map(|(session_id, _)| *session_id)
                    .collect();
                session_ids
                    .into_iter()
                    .filter_map(|session_id| {
                        sessions
                            .remove(&session_id)
                            .map(|entry| (session_id, entry.handle))
                    })
                    .collect()
            }
            Err(_) => Vec::new(),
        };
        closed.sort_by_key(|(session_id, _)| *session_id);
        for (_, handle) in &closed {
            handle.shutdown();
        }
        closed
            .into_iter()
            .map(|(session_id, _)| session_id)
            .collect()
    }

    /// 当前仍持有结构化句柄的项目 id（去重、升序）。
    ///
    /// 应用退出时据此枚举需要终止的项目，与 [`AgentSessionRegistry::shutdown_project`]
    /// 配对使用；覆盖「只有结构化会话、没有 PTY」的项目。
    pub fn registered_project_ids(&self) -> Vec<i64> {
        let Ok(sessions) = self.store.sessions.lock() else {
            return Vec::new();
        };
        let mut project_ids: Vec<i64> = sessions.values().map(|entry| entry.project_id).collect();
        project_ids.sort_unstable();
        project_ids.dedup();
        project_ids
    }

    /// 判断指定会话是否仍由本注册表管理。
    ///
    /// 已 register 真实 handle，或处于 `mark_starting` 启动窗口期的 session
    /// 均返回 `true`。reconcile 据此跳过"正在启动但尚未 register"的 session。
    pub fn contains(&self, session_id: i64) -> bool {
        let (in_sessions, in_starting) =
            match (self.store.sessions.lock(), self.store.starting.lock()) {
                (Ok(sessions), Ok(starting)) => (
                    sessions.contains_key(&session_id),
                    starting.contains(&session_id),
                ),
                _ => (false, false),
            };
        in_sessions || in_starting
    }

    /// 标记 session 为"启动中"：DB 已写入 `running`，但 handle 尚未 register。
    ///
    /// 在 `start_agent_session` / `resume_agent_session` 等
    /// 闭包内，DB 事务 commit 之后、耗时 handle 启动之前调用。`register`
    /// 真实 handle 时自动清除该标记；启动失败时调用方应调 `unmark_starting`。
    pub fn mark_starting(&self, session_id: i64) {
        if let Ok(mut starting) = self.store.starting.lock() {
            starting.insert(session_id);
        }
    }

    /// 清除"启动中"标记（启动失败或无需标记时调用）。
    pub fn unmark_starting(&self, session_id: i64) {
        if let Ok(mut starting) = self.store.starting.lock() {
            starting.remove(&session_id);
        }
    }

    /// 返回当前已 register 真实 handle 的 session id 快照，供命令层清理
    /// 已不可见的运行时句柄。启动中（仅 `mark_starting`）的 session 不包含
    /// 在内——它们尚无真实 handle，不应被 `runtime_session_ids_to_cleanup`
    /// 当作已注册候选清理。
    pub fn session_ids(&self) -> Vec<i64> {
        self.store
            .sessions
            .lock()
            .map(|sessions| sessions.keys().copied().collect())
            .unwrap_or_default()
    }
}

/// 测试支撑：供 registry 自身与 `app_state` 的单元测试复用的句柄替身。
#[cfg(test)]
pub(crate) mod test_support {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
    use crate::types::agent_session::{AgentMessageAttachment, AgentPermissionDecision};
    use crate::types::agent_session_stream::{AgentMode, AgentModel, AgentTimelineItem};

    /// 只记录 `shutdown` 调用次数的句柄替身：其余方法为空实现。
    pub(crate) struct RecordingStubHandle {
        shutdown_count: AtomicUsize,
    }

    impl RecordingStubHandle {
        pub(crate) fn new() -> Self {
            Self {
                shutdown_count: AtomicUsize::new(0),
            }
        }

        pub(crate) fn shutdown_count(&self) -> usize {
            self.shutdown_count.load(Ordering::Acquire)
        }
    }

    impl AgentSessionHandle for RecordingStubHandle {
        fn send_message(
            &self,
            _text: String,
            _attachments: Vec<AgentMessageAttachment>,
        ) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn cancel_turn(&self) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn respond_permission(
            &self,
            _request_id: &str,
            _decision: AgentPermissionDecision,
        ) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn set_model(&self, _model_id: String) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn set_effort(&self, _effort: Option<String>) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn set_mode(&self, _mode_id: &str) -> Result<(), AgentSessionError> {
            Ok(())
        }
        fn list_models(&self) -> Result<Vec<AgentModel>, AgentSessionError> {
            Ok(Vec::new())
        }
        fn list_modes(&self) -> Vec<AgentMode> {
            Vec::new()
        }
        fn read_timeline(&self) -> Result<Vec<AgentTimelineItem>, AgentSessionError> {
            Ok(Vec::new())
        }
        fn shutdown(&self) {
            self.shutdown_count.fetch_add(1, Ordering::AcqRel);
        }
        fn thread_id(&self) -> Option<String> {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::session_registry::test_support::RecordingStubHandle;

    #[test]
    fn empty_registry_returns_none_and_does_not_contain() {
        let registry = AgentSessionRegistry::new();
        assert!(!registry.contains(1));
        assert!(registry.get(1).is_none());
        assert!(registry.unregister(1).is_none());
    }

    #[test]
    fn register_then_get_and_unregister() {
        let registry = AgentSessionRegistry::new();
        let handle: Arc<dyn AgentSessionHandle> = Arc::new(RecordingStubHandle::new());
        registry.register(0, 7, Arc::clone(&handle));

        assert!(registry.contains(7));
        assert!(registry.get(7).is_some());
        let removed = registry.unregister(7);
        assert!(removed.is_some());
        assert!(!registry.contains(7));
    }

    #[test]
    fn clone_shares_underlying_state() {
        let registry = AgentSessionRegistry::new();
        let cloned = registry.clone();
        // 两个 clone 共享底层 Arc：未注册的 session 在两侧一致。
        assert_eq!(registry.contains(99), cloned.contains(99));
        assert!(registry.get(99).is_none());
        assert!(cloned.get(99).is_none());
    }

    #[test]
    fn mark_starting_makes_contains_true_without_real_handle() {
        // 模拟 start_agent_session 闭包内 DB insert 之后、register 之前的窗口：
        // session 已是 running 但尚无真实 handle，reconcile 据此跳过它。
        let registry = AgentSessionRegistry::new();
        assert!(!registry.contains(7));
        registry.mark_starting(7);
        assert!(registry.contains(7));
        // 启动窗口内 get 仍返回 None（无真实 handle）。
        assert!(registry.get(7).is_none());
    }

    #[test]
    fn register_clears_starting_marker() {
        let registry = AgentSessionRegistry::new();
        registry.mark_starting(7);
        assert!(registry.contains(7));

        let handle: Arc<dyn AgentSessionHandle> = Arc::new(RecordingStubHandle::new());
        registry.register(0, 7, Arc::clone(&handle));
        // register 后 starting 标记被清除，但 sessions 里有真实 handle，
        // contains 仍为 true，get 返回真实 handle。
        assert!(registry.contains(7));
        assert!(registry.get(7).is_some());

        // unregister 后回到完全不在册状态。
        assert!(registry.unregister(7).is_some());
        assert!(!registry.contains(7));
    }

    #[test]
    fn unmark_starting_restores_contains_to_false() {
        // 启动失败路径：mark_starting 后未 register，需显式 unmark 清理标记。
        let registry = AgentSessionRegistry::new();
        registry.mark_starting(7);
        assert!(registry.contains(7));
        registry.unmark_starting(7);
        assert!(!registry.contains(7));
    }

    #[test]
    fn unregister_also_clears_starting_marker() {
        // 兜底：unregister 应同时清 starting，避免标记泄漏。
        let registry = AgentSessionRegistry::new();
        registry.mark_starting(7);
        // 此时 sessions 为空，unregister 返回 None，但 starting 应被清除。
        assert!(registry.unregister(7).is_none());
        assert!(!registry.contains(7));
    }

    #[test]
    fn session_ids_excludes_starting_only_sessions() {
        // session_ids 只返回已 register 真实 handle 的 session，
        // starting 的 session 不包含，避免被 cleanup 当作已注册候选。
        let registry = AgentSessionRegistry::new();
        registry.mark_starting(7);
        let handle: Arc<dyn AgentSessionHandle> = Arc::new(RecordingStubHandle::new());
        registry.register(0, 9, handle);
        let ids = registry.session_ids();
        assert!(ids.contains(&9));
        assert!(!ids.contains(&7));
    }

    #[test]
    fn clone_shares_starting_state() {
        // 两个 clone 共享底层 Arc，mark_starting 在两侧可见。
        let registry = AgentSessionRegistry::new();
        let cloned = registry.clone();
        registry.mark_starting(7);
        assert!(cloned.contains(7));
        cloned.unmark_starting(7);
        assert!(!registry.contains(7));
    }

    #[test]
    fn shutdown_project_closes_only_target_project_handles() {
        let registry = AgentSessionRegistry::new();
        let target_a = Arc::new(RecordingStubHandle::new());
        let target_b = Arc::new(RecordingStubHandle::new());
        let other = Arc::new(RecordingStubHandle::new());
        registry.register(7, 11, Arc::clone(&target_a) as Arc<dyn AgentSessionHandle>);
        registry.register(7, 22, Arc::clone(&target_b) as Arc<dyn AgentSessionHandle>);
        registry.register(9, 33, Arc::clone(&other) as Arc<dyn AgentSessionHandle>);

        let closed = registry.shutdown_project(7);

        assert_eq!(closed, vec![11, 22], "应关闭目标项目的全部句柄（升序）");
        assert_eq!(target_a.shutdown_count(), 1, "目标句柄应被 shutdown 一次");
        assert_eq!(target_b.shutdown_count(), 1, "目标句柄应被 shutdown 一次");
        assert_eq!(other.shutdown_count(), 0, "不应关闭其它项目的句柄");
        assert!(!registry.contains(11), "关闭后目标句柄应已摘除");
        assert!(!registry.contains(22), "关闭后目标句柄应已摘除");
        assert!(registry.contains(33), "其它项目的句柄应保留");
        assert!(registry.get(33).is_some(), "其它项目的句柄应仍可取回");
    }

    #[test]
    fn shutdown_project_without_handles_is_noop() {
        let registry = AgentSessionRegistry::new();
        registry.register(7, 11, Arc::new(RecordingStubHandle::new()));

        assert!(
            registry.shutdown_project(404).is_empty(),
            "无归属该项目的句柄时不应关闭任何会话"
        );
        assert!(
            registry.shutdown_project(404).is_empty(),
            "重复关闭不存在的项目应安全返回"
        );
        assert!(registry.contains(11), "无关项目的句柄不受影响");
    }

    #[test]
    fn registered_project_ids_lists_each_project_once() {
        let registry = AgentSessionRegistry::new();
        assert!(
            registry.registered_project_ids().is_empty(),
            "空注册表不应枚举出项目"
        );

        registry.register(7, 11, Arc::new(RecordingStubHandle::new()));
        registry.register(7, 22, Arc::new(RecordingStubHandle::new()));
        registry.register(9, 33, Arc::new(RecordingStubHandle::new()));

        assert_eq!(
            registry.registered_project_ids(),
            vec![7, 9],
            "应返回仍持有结构化句柄的项目 id（去重、升序）"
        );
    }
}
