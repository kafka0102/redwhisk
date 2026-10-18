//! Grok TUI provider session id 捕获：扫描 grok 本机会话存储
//! `<home>/.grok/sessions/<百分号编码 cwd>/<session-id>/summary.json`，
//! 按 `info.cwd` + `created_at` 匹配本次启动的会话。
//!
//! 与 `codex_session_id_capture` 同构：纯模块，零 DB 依赖，输入只有存储根与
//! 会话元信息，输出 `Option<String>`。持久化（开库、回写 `provider_session_id`）
//! 留在 service 侧。缺失时按窗口重试，因为 grok 写会话目录晚于 PTY 启动数秒。

use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use chrono::DateTime;
use serde_json::Value;

use crate::local_data_path::user_home_from_data_dir;
use crate::types::agent_profile::AgentType;

use super::grok_tui_archive::encode_grok_session_cwd;

/// Grok 启动（含 MCP 探测）到写入会话目录实测约 6 秒，留足余量。
const GROK_SESSION_CAPTURE_TOTAL_MS: u64 = 30_000;
const GROK_SESSION_CAPTURE_INTERVAL_MS: u64 = 500;
/// `created_at` 允许早于会话启动的毫秒数。同机时钟下本次会话的目录必然晚于
/// 记录 `started_at` 的 spawn，故只留极小余量：同 cwd 里更早的会话必须被排除，
/// 否则会把旧会话的 id 绑到新会话上（续接进错的对话）。
const SESSION_CAPTURE_SLACK_MS: i64 = 1_000;

const GROK_HOME_DIR_NAME: &str = ".grok";
const GROK_SESSIONS_DIR_NAME: &str = "sessions";
const SUMMARY_FILE_NAME: &str = "summary.json";

/// 是否为 Grok TUI 会话（决定是否尝试捕获 session_id）。
///
/// json / structured 的会话标识由 `ThreadStarted` 运行时回填，不走本模块。
pub(super) fn should_attempt(agent_type: &AgentType, display_mode: &str) -> bool {
    *agent_type == AgentType::Grok && display_mode == "tui"
}

/// 解析 grok 本机会话存储根：`<user home>/.grok/sessions`。
pub(super) fn resolve_sessions_root(data_dir: &Path) -> Option<PathBuf> {
    user_home_from_data_dir(data_dir)
        .map(|home| home.join(GROK_HOME_DIR_NAME).join(GROK_SESSIONS_DIR_NAME))
}

/// 单次匹配本次会话的 grok session id。续接与展示形式切换在库内标识为空时用它补查，
/// 不进入启动捕获的 30 秒轮询。
pub(super) fn resolve_once(root: &Path, cwd: &str, started_at: i64) -> Option<String> {
    detect_once(root, cwd, started_at)
}

/// 轮询匹配本次会话的 grok session id。文件命中即返回，未命中按间隔重试至超时。
pub(super) fn resolve(root: &Path, cwd: &str, started_at: i64) -> Option<String> {
    detect(
        root,
        cwd,
        started_at,
        GROK_SESSION_CAPTURE_TOTAL_MS,
        GROK_SESSION_CAPTURE_INTERVAL_MS,
    )
}

fn detect(
    root: &Path,
    cwd: &str,
    started_at: i64,
    total_ms: u64,
    interval_ms: u64,
) -> Option<String> {
    let attempts = std::cmp::max(1, total_ms / interval_ms);

    for attempt in 0..attempts {
        if let Some(session_id) = detect_once(root, cwd, started_at) {
            return Some(session_id);
        }

        if attempt + 1 < attempts {
            thread::sleep(Duration::from_millis(interval_ms));
        }
    }

    None
}

/// 同一 cwd 下可能有多条会话，取 `created_at` 最新的一条。
fn detect_once(root: &Path, cwd: &str, started_at: i64) -> Option<String> {
    let entries = fs::read_dir(root.join(encode_grok_session_cwd(cwd))).ok()?;
    let mut newest: Option<(i64, String)> = None;

    for entry in entries.flatten() {
        let session_dir = entry.path();
        if !session_dir.is_dir() {
            continue;
        }

        let Some(session_id) = session_dir.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(created_at) = session_created_at_millis(&session_dir, session_id, cwd) else {
            continue;
        };
        if created_at < started_at.saturating_sub(SESSION_CAPTURE_SLACK_MS) {
            continue;
        }

        if newest
            .as_ref()
            .map(|(newest_at, _)| created_at > *newest_at)
            .unwrap_or(true)
        {
            newest = Some((created_at, session_id.to_string()));
        }
    }

    newest.map(|(_, session_id)| session_id)
}

/// `summary.json` 的 `info.id` 与目录名一致、`info.cwd` 与会话 cwd 一致时，
/// 返回 `created_at` 的毫秒时间戳。
fn session_created_at_millis(session_dir: &Path, session_id: &str, cwd: &str) -> Option<i64> {
    let raw = fs::read_to_string(session_dir.join(SUMMARY_FILE_NAME)).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let info = value.get("info")?;

    if info.get("id").and_then(Value::as_str) != Some(session_id) {
        return None;
    }
    if info.get("cwd").and_then(Value::as_str) != Some(cwd) {
        return None;
    }

    DateTime::parse_from_rfc3339(value.get("created_at").and_then(Value::as_str)?)
        .ok()
        .map(|created_at| created_at.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    const SESSION_ID: &str = "01a14e62-5f07-7f80-8262-1d6d588f76af";
    const WORKING_DIR: &str = "/tmp/redwhisk";

    #[test]
    fn resolve_matches_recent_session_for_working_dir() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let started_at = current_millis();
        write_session(temp_dir.path(), SESSION_ID, WORKING_DIR, started_at);

        let detected = detect(temp_dir.path(), WORKING_DIR, started_at, 1, 1);

        assert_eq!(detected.as_deref(), Some(SESSION_ID));
    }

    #[test]
    fn resolve_ignores_session_for_other_working_dir() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let started_at = current_millis();
        write_session(temp_dir.path(), SESSION_ID, "/tmp/other", started_at);

        let detected = detect(temp_dir.path(), WORKING_DIR, started_at, 1, 1);

        assert_eq!(detected, None);
    }

    #[test]
    fn resolve_ignores_session_created_before_this_launch() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let started_at = current_millis();
        write_session(
            temp_dir.path(),
            SESSION_ID,
            WORKING_DIR,
            started_at - SESSION_CAPTURE_SLACK_MS - 1,
        );

        let detected = detect(temp_dir.path(), WORKING_DIR, started_at, 1, 1);

        assert_eq!(detected, None);
    }

    #[test]
    fn resolve_prefers_newest_session_in_same_working_dir() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let started_at = current_millis();
        write_session(temp_dir.path(), SESSION_ID, WORKING_DIR, started_at);
        write_session(
            temp_dir.path(),
            "01a14e62-0000-7000-8000-000000000000",
            WORKING_DIR,
            started_at + 2_000,
        );

        let detected = detect(temp_dir.path(), WORKING_DIR, started_at, 1, 1);

        assert_eq!(
            detected.as_deref(),
            Some("01a14e62-0000-7000-8000-000000000000")
        );
    }

    #[test]
    fn resolve_ignores_session_dir_without_summary() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let started_at = current_millis();
        fs::create_dir_all(
            temp_dir
                .path()
                .join(encode_grok_session_cwd(WORKING_DIR))
                .join(SESSION_ID),
        )
        .expect("create session dir");

        let detected = detect(temp_dir.path(), WORKING_DIR, started_at, 1, 1);

        assert_eq!(detected, None);
    }

    fn write_session(root: &Path, session_id: &str, cwd: &str, created_at_ms: i64) {
        let session_dir = root.join(encode_grok_session_cwd(cwd)).join(session_id);
        fs::create_dir_all(&session_dir).expect("create session dir");
        let created_at = DateTime::from_timestamp_millis(created_at_ms)
            .expect("timestamp")
            .to_rfc3339();
        fs::write(
            session_dir.join(SUMMARY_FILE_NAME),
            format!(
                r#"{{"info":{{"id":"{session_id}","cwd":"{cwd}"}},"created_at":"{created_at}"}}"#
            ),
        )
        .expect("write summary");
    }

    fn current_millis() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("unix time")
            .as_millis() as i64
    }
}
