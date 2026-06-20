//! 运行中的结构化 agent 会话句柄注册表。
//!
//! 镜像 `PtySessionManager` 的 Clone + Arc 模式：Tauri 命令层通过
//! `AppState.agent_sessions` 拿到 `AgentSessionRegistry`（Clone 廉价，
//! 内部状态共享），按 `session_id` 取回 `Arc<dyn AgentSessionHandle>`。
//!
//! 注册表不绑定具体 agent 实现：Codex / 未来 Claude 等都通过实现
//! `AgentSessionHandle` trait 接入，注册时以 trait 对象存储。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::session_handle::AgentSessionHandle;

/// 结构化 agent 会话注册表。Clone 共享底层 `Arc` 状态。
#[derive(Clone, Default)]
pub struct AgentSessionRegistry {
    store: Arc<AgentSessionStore>,
}

struct AgentSessionStore {
    sessions: Mutex<HashMap<i64, Arc<dyn AgentSessionHandle>>>,
}

impl Default for AgentSessionStore {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl AgentSessionRegistry {
    pub fn new() -> Self {
        Self {
            store: Arc::new(AgentSessionStore {
                sessions: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// 注册一个运行中的会话句柄。若同 id 已存在，旧句柄被覆盖
    /// （调用方负责确保旧句柄已 `shutdown`）。
    pub fn register(&self, session_id: i64, handle: Arc<dyn AgentSessionHandle>) {
        if let Ok(mut sessions) = self.store.sessions.lock() {
            sessions.insert(session_id, handle);
        }
    }

    /// 注销会话句柄并返回（供调用方执行 `shutdown`）。
    pub fn unregister(&self, session_id: i64) -> Option<Arc<dyn AgentSessionHandle>> {
        self.store
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(&session_id))
    }

    /// 取回运行中的会话句柄。
    pub fn get(&self, session_id: i64) -> Option<Arc<dyn AgentSessionHandle>> {
        self.store
            .sessions
            .lock()
            .ok()
            .and_then(|sessions| sessions.get(&session_id).cloned())
    }

    /// 判断指定会话是否仍在注册表中。
    pub fn contains(&self, session_id: i64) -> bool {
        self.store
            .sessions
            .lock()
            .map(|sessions| sessions.contains_key(&session_id))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::session_handle::AgentSessionError;
    use crate::types::agent_session::{AgentMessageAttachment, AgentPermissionDecision};
    use crate::types::agent_session_stream::{AgentMode, AgentModel, AgentTimelineItem};

    /// 测试用的空句柄实现，仅用于验证注册表的存取语义。
    struct StubHandle;

    impl AgentSessionHandle for StubHandle {
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
        fn shutdown(&self) {}
        fn thread_id(&self) -> Option<String> {
            None
        }
    }

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
        let handle: Arc<dyn AgentSessionHandle> = Arc::new(StubHandle);
        registry.register(7, Arc::clone(&handle));

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
}
