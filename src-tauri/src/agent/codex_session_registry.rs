//! 运行中的 Codex 结构化会话句柄注册表。
//!
//! 镜像 `PtySessionManager` 的 Clone + Arc 模式：Tauri 命令层通过
//! `AppState.codex_sessions` 拿到 `CodexSessionRegistry`（Clone 廉价，
//! 内部状态共享），按 `session_id` 取回 `Arc<CodexSessionHandle>`。
//!
//! 与 PTY 路径并存：现有 `start_agent_session` 仍走 PTY；结构化会话
//! （`start_structured_agent_session`）走本注册表 + `CodexSessionHandle`。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::codex_app_server::CodexSessionHandle;

/// Codex 结构化会话注册表。Clone 共享底层 `Arc` 状态。
#[derive(Clone, Default)]
pub struct CodexSessionRegistry {
    store: Arc<CodexSessionStore>,
}

struct CodexSessionStore {
    sessions: Mutex<HashMap<i64, Arc<CodexSessionHandle>>>,
}

impl Default for CodexSessionStore {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl CodexSessionRegistry {
    pub fn new() -> Self {
        Self {
            store: Arc::new(CodexSessionStore {
                sessions: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// 注册一个运行中的会话句柄。若同 id 已存在，旧句柄被覆盖
    /// （调用方负责确保旧句柄已 `shutdown`）。
    pub fn register(&self, session_id: i64, handle: Arc<CodexSessionHandle>) {
        if let Ok(mut sessions) = self.store.sessions.lock() {
            sessions.insert(session_id, handle);
        }
    }

    /// 注销会话句柄并返回（供调用方执行 `shutdown`）。
    pub fn unregister(&self, session_id: i64) -> Option<Arc<CodexSessionHandle>> {
        self.store
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(&session_id))
    }

    /// 取回运行中的会话句柄。
    pub fn get(&self, session_id: i64) -> Option<Arc<CodexSessionHandle>> {
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

    #[test]
    fn empty_registry_returns_none_and_does_not_contain() {
        let registry = CodexSessionRegistry::new();
        assert!(!registry.contains(1));
        assert!(registry.get(1).is_none());
        assert!(registry.unregister(1).is_none());
    }

    #[test]
    fn clone_shares_underlying_state() {
        let registry = CodexSessionRegistry::new();
        let cloned = registry.clone();
        // 两个 clone 共享底层 Arc：未注册的 session 在两侧一致。
        assert_eq!(registry.contains(99), cloned.contains(99));
        assert!(registry.get(99).is_none());
        assert!(cloned.get(99).is_none());
    }
}
