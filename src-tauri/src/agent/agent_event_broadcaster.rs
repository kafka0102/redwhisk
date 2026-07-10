//! Codex session 结构化事件广播器。
//!
//! 负责把 `AgentStreamEvent` 包装成 `AgentStreamEventEnvelope` 并经 Tauri event
//! 广播给前端。每个 session 维护独立的 `seq` 计数器与 `epoch`，供前端做游标
//! 续传与历史回放对齐。事件名遵循项目 kebab-case 约定：
//! `agent-session-stream-event`。

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::connection::DatabaseConfig;
use crate::local_data_path::redwhisk_data_dir;
use crate::types::agent_session_stream::{AgentStreamEvent, AgentStreamEventEnvelope};

/// 结构化 Agent 事件流的 Tauri event 名。
pub const AGENT_SESSION_STREAM_EVENT: &str = "agent-session-stream-event";
pub const AGENT_SESSION_LIST_CHANGED_EVENT: &str = "agent-session-list-changed";
const LATEST_OUTPUT_UPDATE_INTERVAL: Duration = Duration::from_millis(750);
/// turn 正常完成后保留 "running" 展示的 grace 时长；过期后由延迟任务收尾。
pub const TURN_GRACE_MS: i64 = 3000;
/// grace 收尾延迟任务的额外缓冲，确保越过 grace 边界后再执行 CAS。
const TURN_GRACE_FINALIZE_BUFFER_MS: u64 = 1000;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionListChangedPayload {
    project_id: i64,
    session_id: Option<i64>,
    reason: &'static str,
}

/// 单个 session 的游标状态。
#[derive(Debug, Clone)]
struct SessionCursor {
    seq: u64,
    epoch: String,
}

#[derive(Debug, Clone)]
struct SessionPersistenceState {
    log_path: Option<String>,
    last_latest_output_write_at: Option<SystemTime>,
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
    persistence: std::sync::Arc<Mutex<HashMap<i64, SessionPersistenceState>>>,
    log_write_lock: std::sync::Arc<Mutex<()>>,
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
        if let Ok(mut persistence) = self.persistence.lock() {
            persistence.insert(
                session_id,
                SessionPersistenceState {
                    log_path: None,
                    last_latest_output_write_at: None,
                },
            );
        }
    }

    /// 注销 session，清理游标。
    pub fn unregister_session(&self, session_id: i64) {
        if let Ok(mut cursors) = self.cursors.lock() {
            cursors.remove(&session_id);
        }
        if let Ok(mut persistence) = self.persistence.lock() {
            persistence.remove(&session_id);
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
        let should_refresh_list = self.persist_stream_event(&envelope)
            || should_refresh_session_list_for_stream_event(&envelope.event);
        // 广播失败只忽略：前端可经 read_agent_timeline 补历史，不应阻塞 Agent 执行。
        let _ = app_handle.emit(AGENT_SESSION_STREAM_EVENT, envelope);
        if should_refresh_list {
            let _ = app_handle.emit(
                AGENT_SESSION_LIST_CHANGED_EVENT,
                AgentSessionListChangedPayload {
                    project_id,
                    session_id: Some(session_id),
                    reason: "session_stream_updated",
                },
            );
        }
    }

    /// grace 收尾：turn 正常完成进入 grace 后，由延迟任务在 GRACE_MS 过后调用。
    /// 用 CAS 仅在 turn 仍是预期结束态时置 `is_turn_running=0`，命中则广播
    /// list 刷新，让前端拿到 `is_turn_running=false`（解锁 composer / 停止 card 转圈）。
    fn finalize_turn_after_grace(
        &self,
        project_id: i64,
        session_id: i64,
        expected_turn_ended_at: i64,
    ) {
        let Some(app_handle) = self.app_handle.get() else {
            return;
        };
        let Ok(data_dir) = redwhisk_data_dir(app_handle) else {
            return;
        };
        let Ok(database) = DatabaseConfig::new(&data_dir).open() else {
            return;
        };
        let repository = AgentSessionRepository::new(&database.connection);
        let finalized = repository
            .finalize_turn_after_grace(session_id, expected_turn_ended_at)
            .unwrap_or(false);
        if finalized {
            let _ = app_handle.emit(
                AGENT_SESSION_LIST_CHANGED_EVENT,
                AgentSessionListChangedPayload {
                    project_id,
                    session_id: Some(session_id),
                    reason: "turn_grace_finalized",
                },
            );
        }
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

    fn persist_stream_event(&self, envelope: &AgentStreamEventEnvelope) -> bool {
        let Some(app_handle) = self.app_handle.get() else {
            return false;
        };
        let latest_output = latest_output_from_stream_event(&envelope.event);
        let should_update_latest_output = latest_output
            .as_ref()
            .map(|_| self.should_update_latest_output(envelope.session_id, &envelope.event))
            .unwrap_or(false);
        let decision = turn_running_from_stream_event(&envelope.event);
        // ThreadStarted 携带 agent 会话标识（Codex threadId / Claude session_id）。
        // Claude 首轮 send_message 在后台异步产生 session_id，无法在启动路径同步
        // 回填 DB；此处作为统一回流入口，把会话标识写入 codex_session_id 列，
        // 使崩溃后的 resume 续接能拿到标识（update SQL 自带
        // `WHERE codex_session_id IS NULL`，幂等且不覆盖已写入值）。
        let resume_session_id = session_id_from_thread_started(&envelope.event);
        let Some(log_path) = self.resolve_log_path(envelope.session_id, app_handle) else {
            return false;
        };

        let Ok(_write_guard) = self.log_write_lock.lock() else {
            return false;
        };

        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
            if let Ok(line) = serde_json::to_string(envelope) {
                let _ = writeln!(file, "{line}");
            }
        }

        if !should_update_latest_output && decision == TurnRunningDecision::None && resume_session_id.is_none() {
            return false;
        }
        let Ok(data_dir) = redwhisk_data_dir(app_handle) else {
            return false;
        };
        let Ok(database) = DatabaseConfig::new(&data_dir).open() else {
            return false;
        };
        let repository = AgentSessionRepository::new(&database.connection);
        let updated_at = current_epoch_millis();
        if should_update_latest_output {
            if let Some(latest_output) = latest_output.as_deref() {
                let _ =
                    repository.update_latest_output(envelope.session_id, latest_output, updated_at);
            }
        }
        match decision {
            TurnRunningDecision::Running => {
                let _ = repository.update_turn_running(envelope.session_id, true, updated_at);
                let _ = repository.clear_turn_ended_at(envelope.session_id);
                let _ = repository.update_turn_started_at(envelope.session_id, updated_at);
            }
            TurnRunningDecision::EndedWithGrace => {
                let _ = repository.record_turn_completed(envelope.session_id, updated_at);
                // 安排 grace 收尾：GRACE_MS 过后若 turn 未被新 turn 抢占，原子置
                // is_turn_running=0 并广播 list 刷新，避免前端单次刷新落在 grace
                // 窗口内导致 is_turn_running 永久卡 true。
                let broadcaster = self.clone();
                let project_id = envelope.project_id;
                let session_id = envelope.session_id;
                let expected_turn_ended_at = updated_at;
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(
                        (TURN_GRACE_MS as u64) + TURN_GRACE_FINALIZE_BUFFER_MS,
                    ));
                    broadcaster.finalize_turn_after_grace(
                        project_id,
                        session_id,
                        expected_turn_ended_at,
                    );
                });
            }
            TurnRunningDecision::EndedImmediately => {
                let _ = repository.update_turn_running(envelope.session_id, false, updated_at);
                let _ = repository.clear_turn_ended_at(envelope.session_id);
            }
            TurnRunningDecision::None => {}
        }
        if let Some(session_id) = resume_session_id {
            let _ = repository.update_codex_session_id(envelope.session_id, session_id);
        }
        true
    }

    fn resolve_log_path(&self, session_id: i64, app_handle: &AppHandle) -> Option<String> {
        if let Ok(persistence) = self.persistence.lock() {
            if let Some(state) = persistence.get(&session_id) {
                if let Some(log_path) = &state.log_path {
                    return Some(log_path.clone());
                }
            }
        }

        let Ok(data_dir) = redwhisk_data_dir(app_handle) else {
            return None;
        };
        let Ok(database) = DatabaseConfig::new(&data_dir).open() else {
            return None;
        };
        let repository = AgentSessionRepository::new(&database.connection);
        let Ok(Some(session)) = repository.find_by_id(session_id) else {
            return None;
        };
        if session.log_path.is_empty() {
            return None;
        }
        if let Ok(mut persistence) = self.persistence.lock() {
            persistence
                .entry(session_id)
                .or_insert(SessionPersistenceState {
                    log_path: None,
                    last_latest_output_write_at: None,
                })
                .log_path = Some(session.log_path.clone());
        }
        Some(session.log_path)
    }

    fn should_update_latest_output(&self, session_id: i64, event: &AgentStreamEvent) -> bool {
        let now = SystemTime::now();
        let is_important = !matches!(event, AgentStreamEvent::Timeline { .. });
        let Ok(mut persistence) = self.persistence.lock() else {
            return true;
        };
        let state = persistence
            .entry(session_id)
            .or_insert(SessionPersistenceState {
                log_path: None,
                last_latest_output_write_at: None,
            });
        let should_update = is_important
            || match state.last_latest_output_write_at {
                Some(last_write) => now
                    .duration_since(last_write)
                    .map(|elapsed| elapsed >= LATEST_OUTPUT_UPDATE_INTERVAL)
                    .unwrap_or(true),
                None => true,
            };
        if should_update {
            state.last_latest_output_write_at = Some(now);
        }
        should_update
    }
}

fn latest_output_from_stream_event(event: &AgentStreamEvent) -> Option<String> {
    let text = match event {
        AgentStreamEvent::Timeline { item, .. } => latest_output_from_timeline_item(item),
        AgentStreamEvent::TurnFailed { error, .. } => Some(error.as_str()),
        AgentStreamEvent::PermissionRequested { request } => {
            request.title.as_deref().or(request.description.as_deref())
        }
        AgentStreamEvent::ModeChanged {
            current_mode_id, ..
        } => Some(current_mode_id.as_str()),
        AgentStreamEvent::ModelChanged { model_id } => Some(model_id.as_str()),
        _ => None,
    }?;
    truncate_latest_output(text)
}

fn should_refresh_session_list_for_stream_event(event: &AgentStreamEvent) -> bool {
    !matches!(event, AgentStreamEvent::Timeline { .. })
}

/// turn 运行态的三态决策，供 `persist_stream_event` 决定如何写 DB。
///
/// - `Running`：turn 开始，置 `is_turn_running=1` 并清 `turn_ended_at`。
/// - `EndedWithGrace`：turn 正常结束或 codex 瞬态空错误，进入 grace period：
///   只写 `turn_ended_at`，不置 `is_turn_running=0`，由后续 grace 扫描收尾。
/// - `EndedImmediately`：turn 真失败或被取消，立即置 `is_turn_running=0` 并清
///   `turn_ended_at`。
/// - `None`：非 turn 事件，不动 turn 相关字段。
#[derive(Debug, Clone, PartialEq, Eq)]
enum TurnRunningDecision {
    Running,
    EndedWithGrace,
    EndedImmediately,
    None,
}

fn turn_running_from_stream_event(event: &AgentStreamEvent) -> TurnRunningDecision {
    match event {
        AgentStreamEvent::TurnStarted { .. } => TurnRunningDecision::Running,
        AgentStreamEvent::TurnCompleted { .. } => TurnRunningDecision::EndedWithGrace,
        AgentStreamEvent::TurnFailed { error, .. } => {
            if error.trim().is_empty() {
                TurnRunningDecision::EndedWithGrace
            } else {
                TurnRunningDecision::EndedImmediately
            }
        }
        AgentStreamEvent::TurnCanceled { .. } => TurnRunningDecision::EndedImmediately,
        _ => TurnRunningDecision::None,
    }
}

/// 从 `ThreadStarted` 事件提取 agent 会话标识（Codex threadId / Claude session_id）。
///
/// 用于在事件回流时回填 DB 的 `codex_session_id` 列。空字符串视为缺失返回 None，
/// 避免把无效值写入。
fn session_id_from_thread_started(event: &AgentStreamEvent) -> Option<&str> {
    match event {
        AgentStreamEvent::ThreadStarted { thread_id } if !thread_id.is_empty() => {
            Some(thread_id.as_str())
        }
        _ => None,
    }
}

fn latest_output_from_timeline_item(
    item: &crate::types::agent_session_stream::AgentTimelineItem,
) -> Option<&str> {
    use crate::types::agent_session_stream::{AgentTimelineItem, ToolCallDetail};

    match item {
        AgentTimelineItem::AssistantMessage { text, .. }
        | AgentTimelineItem::UserMessage { text, .. }
        | AgentTimelineItem::Reasoning { text, .. } => Some(text.as_str()),
        AgentTimelineItem::ToolCall { name, detail, .. } => match detail {
            ToolCallDetail::Shell { command, .. } => Some(command.as_str()),
            ToolCallDetail::Read { path, .. }
            | ToolCallDetail::Edit { path, .. }
            | ToolCallDetail::Write { path, .. } => Some(path.as_str()),
            ToolCallDetail::Search { query, .. } => Some(query.as_str()),
            ToolCallDetail::Plan { text } => Some(text.as_str()),
            ToolCallDetail::SubAgent { .. } | ToolCallDetail::Unknown { .. } => Some(name.as_str()),
        },
        AgentTimelineItem::Todo { .. } => Some("Plan updated"),
        AgentTimelineItem::Error { message } => Some(message.as_str()),
        AgentTimelineItem::Compaction { .. } => Some("Context compacted"),
    }
}

fn truncate_latest_output(text: &str) -> Option<String> {
    let latest_line = text
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    Some(latest_line.chars().take(500).collect())
}

fn current_epoch_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
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

    #[test]
    fn latest_output_updates_are_throttled_for_timeline_events() {
        let broadcaster = AgentEventBroadcaster::new();
        let event = AgentStreamEvent::Timeline {
            item: crate::types::agent_session_stream::AgentTimelineItem::AssistantMessage {
                text: "hello".into(),
                message_id: Some("a1".into()),
            },
            turn_id: None,
            seq: 0,
            timestamp: 0,
        };

        assert!(broadcaster.should_update_latest_output(7, &event));
        assert!(!broadcaster.should_update_latest_output(7, &event));

        let important = AgentStreamEvent::ModelChanged {
            model_id: "gpt-5".into(),
        };
        assert!(broadcaster.should_update_latest_output(7, &important));
    }

    #[test]
    fn turn_running_state_is_derived_from_turn_events() {
        use TurnRunningDecision as D;
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnStarted { turn_id: None }),
            D::Running
        );
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnCompleted {
                turn_id: None,
                usage: None,
            }),
            D::EndedWithGrace
        );
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnFailed {
                turn_id: None,
                error: "failed".to_string(),
                code: None,
            }),
            D::EndedImmediately
        );
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnCanceled {
                turn_id: None,
                reason: "canceled".to_string(),
            }),
            D::EndedImmediately
        );
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::ModelChanged {
                model_id: "gpt-5".to_string(),
            }),
            D::None
        );
    }

    #[test]
    fn turn_decision_maps_turn_events() {
        use TurnRunningDecision as D;
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnStarted { turn_id: None }),
            D::Running
        );
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnCompleted {
                turn_id: None,
                usage: None,
            }),
            D::EndedWithGrace
        );
        // 空 error 的 turn_failed → grace（codex 瞬态空错误）
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnFailed {
                turn_id: None,
                error: "".to_string(),
                code: None,
            }),
            D::EndedWithGrace
        );
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnFailed {
                turn_id: None,
                error: "   ".to_string(),
                code: None,
            }),
            D::EndedWithGrace
        );
        // 带 error 的 turn_failed → 立即终止（真失败）
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnFailed {
                turn_id: None,
                error: "boom".to_string(),
                code: None,
            }),
            D::EndedImmediately
        );
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnCanceled {
                turn_id: None,
                reason: "user".to_string(),
            }),
            D::EndedImmediately
        );
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::ModelChanged {
                model_id: "gpt-5".to_string(),
            }),
            D::None
        );
    }

    #[test]
    fn session_id_from_thread_started_extracts_non_empty_thread_id() {
        // 正常 ThreadStarted：返回 thread_id 切片，供回填 DB。
        let event = AgentStreamEvent::ThreadStarted {
            thread_id: "thr_abc".into(),
        };
        assert_eq!(session_id_from_thread_started(&event), Some("thr_abc"));
    }

    #[test]
    fn session_id_from_thread_started_rejects_empty_thread_id() {
        // 空 thread_id 视为缺失，避免把无效值写入 codex_session_id 列。
        let event = AgentStreamEvent::ThreadStarted {
            thread_id: String::new(),
        };
        assert_eq!(session_id_from_thread_started(&event), None);
    }

    #[test]
    fn session_id_from_thread_started_returns_none_for_other_events() {
        // 非 ThreadStarted 事件一律返回 None。
        assert_eq!(
            session_id_from_thread_started(&AgentStreamEvent::TurnStarted { turn_id: None }),
            None
        );
        assert_eq!(
            session_id_from_thread_started(&AgentStreamEvent::ModelChanged {
                model_id: "gpt-5".into(),
            }),
            None
        );
    }
}
