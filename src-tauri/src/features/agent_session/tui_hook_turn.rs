//! Codex / Grok TUI hook → `agent_sessions.is_turn_running`。
//!
//! 规则只在这里。hook 命令与 socket 传输不做业务判断。
//! json 行的写入者仍只有 broadcaster；本模块 SQL 带 `display_mode='tui'`。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::Value;

use crate::db::agent_session_repository::AgentSessionRepository;

/// 漏掉 Stop 后清 running 的静默窗口。只清不置。
pub const TUI_HOOK_SILENCE_WINDOW: Duration = Duration::from_secs(3 * 60);

const LIST_CHANGED_REASON: &str = "tui_hook_turn";

/// 已关联到一条会话之后的 hook 事件。关联见 [`resolve_tui_hook_session`]。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedTuiHookEvent {
    pub session_id: i64,
    pub source: TuiHookSource,
    pub event_name: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TuiHookSource {
    Codex,
    Grok,
}

impl TuiHookSource {
    pub fn as_db_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Grok => "grok",
        }
    }
}

/// 关联输入：环境变量优先，payload 的 provider session id 回退。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TuiHookCorrelation {
    pub redwhisk_session_id: Option<i64>,
    pub agent_kind: Option<TuiHookSource>,
    pub payload: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TuiHookCorrelationFailure {
    /// 环境变量与 provider session id 都对不上。调用方计数后丢弃。
    Unmatched,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TuiHookApplyOutcome {
    pub changed: bool,
    /// 仅 `changed` 时有值。沿用已有 `agent-session-list-changed`。
    pub list_changed_reason: Option<&'static str>,
    /// 本次把标志从非 running 置为 running。心跳用它刷新静默墙钟。
    pub marked_running: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TurnFlagDecision {
    Start,
    Stop,
    Ignore,
}

/// 对已关联事件改 turn 标志。0 行、未知事件、json 行、条件不满足：不改。
///
/// 置 1 复用 broadcaster 处理 `TurnStarted` 的三步：
/// `update_turn_running(true)`、`clear_turn_ended_at`、`update_turn_started_at`。
/// 置 0 立即结束：`is_turn_running=0` 且 `turn_ended_at=NULL`，不走 json grace。
/// 不写 `current_turn_id`，不触发 `TurnCompleted` handler，不改 attention。
pub fn apply_tui_hook_event(
    repository: &AgentSessionRepository<'_>,
    event: &ResolvedTuiHookEvent,
    now: i64,
) -> rusqlite::Result<TuiHookApplyOutcome> {
    let unchanged = TuiHookApplyOutcome {
        changed: false,
        list_changed_reason: None,
        marked_running: false,
    };
    let Some(snapshot) = repository.find_tui_hook_turn_target(event.session_id)? else {
        return Ok(unchanged);
    };
    if snapshot.agent_type != event.source.as_db_str() {
        return Ok(unchanged);
    }
    match decide_turn_flag(event.source, &event.event_name, &event.payload, snapshot.is_turn_running)
    {
        TurnFlagDecision::Ignore => Ok(unchanged),
        TurnFlagDecision::Start => {
            repository.mark_tui_hook_turn_started(event.session_id, now)?;
            note_tui_hook_turn_started(event.session_id, now);
            Ok(TuiHookApplyOutcome {
                changed: true,
                list_changed_reason: Some(LIST_CHANGED_REASON),
                marked_running: true,
            })
        }
        TurnFlagDecision::Stop => {
            let changed = repository.clear_tui_hook_turn(event.session_id, now)?;
            if changed {
                forget_tui_hook_turn_clock(event.session_id);
            }
            Ok(TuiHookApplyOutcome {
                changed,
                list_changed_reason: changed.then_some(LIST_CHANGED_REASON),
                marked_running: false,
            })
        }
    }
}

/// 1. `REDWHISK_SESSION_ID` 命中 running + tui，且 `agent_type` 与 kind 一致。
/// 2. 否则用 payload 的 provider session id 匹配 `provider_session_id`。
/// 3. 都不中：丢弃，不按 CWD 猜测。
pub fn resolve_tui_hook_session(
    repository: &AgentSessionRepository<'_>,
    correlation: &TuiHookCorrelation,
) -> rusqlite::Result<Result<i64, TuiHookCorrelationFailure>> {
    if let (Some(session_id), Some(kind)) = (correlation.redwhisk_session_id, correlation.agent_kind)
    {
        if repository.tui_hook_session_matches_kind(session_id, kind.as_db_str())? {
            return Ok(Ok(session_id));
        }
    }
    if let Some(provider_session_id) = provider_session_id_from_payload(&correlation.payload) {
        if let Some(session_id) =
            repository.find_running_tui_session_by_provider_id(&provider_session_id)?
        {
            return Ok(Ok(session_id));
        }
    }
    Ok(Err(TuiHookCorrelationFailure::Unmatched))
}

fn tui_hook_running_clocks() -> &'static Mutex<HashMap<i64, i64>> {
    static CLOCKS: OnceLock<Mutex<HashMap<i64, i64>>> = OnceLock::new();
    CLOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// hook 把标志置为 running 时记下墙钟。静默窗口从这次起算；进程重启后清空。
pub fn note_tui_hook_turn_started(session_id: i64, now_ms: i64) {
    if let Ok(mut clocks) = tui_hook_running_clocks().lock() {
        clocks.insert(session_id, now_ms);
    }
}

/// 内存里是否还记着该 session 的静默墙钟。测试用来证明 Stop / 退出后已忘掉。
#[cfg(test)]
pub fn tui_hook_turn_clock_contains(session_id: i64) -> bool {
    tui_hook_running_clocks()
        .lock()
        .map(|clocks| clocks.contains_key(&session_id))
        .unwrap_or(false)
}

/// Stop 已实际把标志清掉后忘掉墙钟。否则心跳每 5 秒仍会对已停行打空 UPDATE。
fn forget_tui_hook_turn_clock(session_id: i64) {
    if let Ok(mut clocks) = tui_hook_running_clocks().lock() {
        clocks.remove(&session_id);
    }
}

/// 心跳旁路用的内存墙钟版本。清掉的 id 会从内存移除。没有墙钟的行不动。
pub fn expire_recorded_silent_tui_hook_turns(
    repository: &AgentSessionRepository<'_>,
    now_ms: i64,
) -> rusqlite::Result<Vec<i64>> {
    let clocks = tui_hook_running_clocks()
        .lock()
        .map(|clocks| clocks.clone())
        .unwrap_or_default();
    let (expired, stale) = expire_silent_tui_hook_turns(repository, &clocks, now_ms)?;
    if !expired.is_empty() || !stale.is_empty() {
        if let Ok(mut live) = tui_hook_running_clocks().lock() {
            for session_id in expired.iter().chain(stale.iter()) {
                live.remove(session_id);
            }
        }
    }
    Ok(expired)
}

/// 心跳旁路：标志仍为 1，且距最后一次「hook 置为 running」已满 3 分钟，则写 0。
/// 内存没有该行的墙钟（含进程重启）时不补半截 turn，也不置 1。
/// 返回实际被清掉的 session id（每个都应发 list-changed），
/// 以及窗口已满但行已不是 running tui 的 id（调用方应忘掉墙钟，不再空 UPDATE）。
pub fn expire_silent_tui_hook_turns(
    repository: &AgentSessionRepository<'_>,
    last_hook_running_at_ms: &HashMap<i64, i64>,
    now_ms: i64,
) -> rusqlite::Result<(Vec<i64>, Vec<i64>)> {
    let window_ms = TUI_HOOK_SILENCE_WINDOW.as_millis() as i64;
    let mut expired = Vec::new();
    let mut stale = Vec::new();
    for (session_id, marked_at) in last_hook_running_at_ms {
        if now_ms.saturating_sub(*marked_at) < window_ms {
            continue;
        }
        if repository.clear_tui_hook_turn(*session_id, now_ms)? {
            expired.push(*session_id);
        } else {
            stale.push(*session_id);
        }
    }
    expired.sort_unstable();
    stale.sort_unstable();
    Ok((expired, stale))
}

/// 从 payload 取 provider session id。Codex 字段 `session_id`，Grok 字段 `sessionId`，
/// 兼容另一侧别名。空串视为缺失。
pub fn provider_session_id_from_payload(payload: &Value) -> Option<String> {
    for key in ["session_id", "sessionId"] {
        if let Some(value) = payload.get(key).and_then(Value::as_str) {
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn decide_turn_flag(
    source: TuiHookSource,
    event_name: &str,
    payload: &Value,
    is_turn_running: bool,
) -> TurnFlagDecision {
    match (source, event_name) {
        (TuiHookSource::Codex | TuiHookSource::Grok, "UserPromptSubmit") => TurnFlagDecision::Start,
        (TuiHookSource::Codex, "Stop" | "Interrupt") => TurnFlagDecision::Stop,
        (TuiHookSource::Grok, "Stop") => {
            if grok_stop_ends_turn(payload) {
                TurnFlagDecision::Stop
            } else {
                TurnFlagDecision::Ignore
            }
        }
        (TuiHookSource::Grok, "StopFailure" | "StopCancelled") => TurnFlagDecision::Stop,
        (TuiHookSource::Grok, "Notification") if is_idle_prompt(payload) && is_turn_running => {
            TurnFlagDecision::Stop
        }
        _ => TurnFlagDecision::Ignore,
    }
}

/// reason 缺省或 `end_turn` 才结束。`shutdown` 及其它值不改。
fn grok_stop_ends_turn(payload: &Value) -> bool {
    match payload.get("reason").and_then(Value::as_str) {
        None => true,
        Some("end_turn") => true,
        Some(_) => false,
    }
}

fn is_idle_prompt(payload: &Value) -> bool {
    payload
        .get("notificationType")
        .and_then(Value::as_str)
        .is_some_and(|value| value == "idle_prompt")
}
