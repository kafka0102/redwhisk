//! Codex session 结构化事件广播器。
//!
//! 负责把 `AgentStreamEvent` 包装成 `AgentStreamEventEnvelope` 并经 Tauri event
//! 广播给前端。每个 session 维护独立的 `seq` 计数器与 `epoch`，供前端做游标
//! 续传与历史回放对齐。事件名遵循项目 kebab-case 约定：
//! `agent-session-stream-event`。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use crate::types::agent_session_stream::{AgentStreamEvent, AgentStreamEventEnvelope};

/// 结构化 Agent 事件流的 Tauri event 名。
pub const AGENT_SESSION_STREAM_EVENT: &str = "agent-session-stream-event";

/// 单个 session 的游标状态。
#[derive(Debug, Clone)]
struct SessionCursor {
    seq: u64,
    epoch: String,
}

/// 跨 session 共享的事件广播器。
///
/// `AppHandle` 在 Tauri setup 阶段经 `set_app_handle` 注入（与
/// `PtySessionManager::set_output_sink` 同一模式），因为 `AppState::new`
/// 在 `manage()` 调用时还没有 `AppHandle`。`Clone` 廉价（内部 `Arc`），
/// 可被各 codex session 句柄持有。
#[derive(Clone, Default)]
pub struct AgentEventBroadcaster {
    app_handle: std::sync::Arc<OnceLock<AppHandle>>,
    cursors: std::sync::Arc<Mutex<HashMap<i64, SessionCursor>>>,
}

impl AgentEventBroadcaster {
    pub fn new() -> Self {
        Self::default()
    }

    /// 注入 `AppHandle`，仅在 setup 阶段调用一次。
    ///
    /// 重复调用会被忽略，保留首次注入的 handle，避免运行期被替换。
    pub fn set_app_handle(&self, app_handle: AppHandle) {
        let _ = self.app_handle.set(app_handle);
    }

    /// 注册一个新 session，分配起始游标。
    ///
    /// `epoch` 用纳秒时间戳，保证 session 重建后前端能识别历史游标失效。
    pub fn register_session(&self, session_id: i64) {
        let epoch = format!(
            "epoch-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        if let Ok(mut cursors) = self.cursors.lock() {
            cursors.insert(session_id, SessionCursor { seq: 0, epoch });
        }
    }

    /// 注销 session，清理游标。
    pub fn unregister_session(&self, session_id: i64) {
        if let Ok(mut cursors) = self.cursors.lock() {
            cursors.remove(&session_id);
        }
    }

    /// 广播一条结构化事件。
    ///
    /// `seq` 自增后写入 envelope；若 session 未注册（异常路径）则按 0 起步
    /// 并补一个临时 epoch，避免事件丢失，同时不会污染已注册 session 的游标。
    /// 若 `AppHandle` 尚未注入（setup 未完成），事件被丢弃——此路径不应发生
    /// 在正常运行期，调用方无需处理。
    pub fn emit_stream_event(&self, project_id: i64, session_id: i64, event: AgentStreamEvent) {
        let Some(app_handle) = self.app_handle.get() else {
            return;
        };
        let (seq, epoch) = self.advance_cursor(session_id);
        let envelope = AgentStreamEventEnvelope {
            project_id,
            session_id,
            seq,
            epoch,
            event,
        };
        // 广播失败只忽略：前端可经 read_agent_timeline 补历史，不应阻塞 Agent 执行。
        let _ = app_handle.emit(AGENT_SESSION_STREAM_EVENT, envelope);
    }

    fn advance_cursor(&self, session_id: i64) -> (u64, String) {
        let mut cursors = match self.cursors.lock() {
            Ok(cursors) => cursors,
            Err(_) => return (0, "epoch-unknown".into()),
        };
        let cursor = cursors.entry(session_id).or_insert_with(|| SessionCursor {
            seq: 0,
            epoch: "epoch-unknown".into(),
        });
        cursor.seq = cursor.seq.saturating_add(1);
        (cursor.seq, cursor.epoch.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advance_cursor_increments_seq_per_session() {
        let broadcaster = AgentEventBroadcaster::new();
        // register_session 后游标从 0 起步，advance 后变 1。
        broadcaster.register_session(7);
        let (seq1, epoch1) = broadcaster.advance_cursor(7);
        let (seq2, epoch2) = broadcaster.advance_cursor(7);
        assert_eq!(seq1, 1);
        assert_eq!(seq2, 2);
        assert_eq!(epoch1, epoch2);

        // 另一个 session 独立计数。
        let (seq_other, _) = broadcaster.advance_cursor(8);
        assert_eq!(seq_other, 1);
    }

    #[test]
    fn unregister_removes_cursor() {
        let broadcaster = AgentEventBroadcaster::new();
        broadcaster.register_session(7);
        broadcaster.advance_cursor(7);
        broadcaster.unregister_session(7);
        // 注销后再 advance：回到 epoch-unknown 起步，证明游标已被清除。
        let (seq, epoch) = broadcaster.advance_cursor(7);
        assert_eq!(seq, 1);
        assert_eq!(epoch, "epoch-unknown");
    }

    #[test]
    fn event_name_is_kebab_case() {
        assert_eq!(AGENT_SESSION_STREAM_EVENT, "agent-session-stream-event");
    }
}
