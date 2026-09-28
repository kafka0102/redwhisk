//! Codex session_id 捕获：扫描 `CODEX_HOME`（默认 `~/.codex`）下的
//! `sessions/**/rollout-*.jsonl`（`codex-tui` 会话主来源）与
//! `session_index.jsonl`（回退来源），按 `working_dir` + 时间窗匹配出当前会话的
//! codex thread id。
//!
//! 与 agent_session 编排解耦的纯谓词模块：零 DB 依赖，输入只有 codex_home
//! 与会话元信息，输出 `Option<String>`。service 仅持有一次 `resolve` 调用，
//! 持久化（开库、migration、回写 provider_session_id）留在 service 侧。

use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, UNIX_EPOCH};

use serde_json::Value;

const CODEX_SESSION_CAPTURE_TOTAL_MS: u64 = 5_000;
const CODEX_SESSION_CAPTURE_INTERVAL_MS: u64 = 250;
const SESSION_CAPTURE_WINDOW_MS: i64 = 60_000;

const ROLLOUT_FILE_PREFIX: &str = "rollout-";
const ROLLOUT_FILE_SUFFIX: &str = ".jsonl";

/// 一个 `rollout-*.jsonl` 候选文件及其最近修改时间。
pub(super) struct RolloutCandidate {
    pub(super) modified_at: i64,
    pub(super) path: PathBuf,
}

/// 启动命令是否为 codex 二进制（决定是否尝试捕获 session_id）。
pub(super) fn should_attempt_codex_session_capture(command: &str) -> bool {
    let Some(program) = command.split_whitespace().next() else {
        return false;
    };

    Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("codex"))
        .unwrap_or(false)
}

/// 解析 `CODEX_HOME`，缺省回退到 `$HOME/.codex`。
pub(super) fn resolve_codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))
}

/// 在 `codex_home` 下扫描并轮询匹配当前会话的 codex session_id。
///
/// 深模块入口：调用方只需提供 codex_home 与会话元信息，轮询节奏（总时长 / 间隔）
/// 由本模块常量决定。文件命中即返回，未命中按间隔重试至超时。
pub(super) fn resolve(codex_home: &Path, working_dir: &str, started_at: i64) -> Option<String> {
    detect_codex_session_id_from_home(
        codex_home,
        working_dir,
        started_at,
        CODEX_SESSION_CAPTURE_TOTAL_MS,
        CODEX_SESSION_CAPTURE_INTERVAL_MS,
    )
}

fn detect_codex_session_id_from_home(
    codex_home: &Path,
    working_dir: &str,
    started_at: i64,
    total_ms: u64,
    interval_ms: u64,
) -> Option<String> {
    let attempts = std::cmp::max(1, total_ms / interval_ms);

    for attempt in 0..attempts {
        if let Some(session_id) = detect_codex_session_id_once(codex_home, working_dir, started_at)
        {
            return Some(session_id);
        }

        if attempt + 1 < attempts {
            thread::sleep(Duration::from_millis(interval_ms));
        }
    }

    None
}

fn detect_codex_session_id_once(
    codex_home: &Path,
    working_dir: &str,
    started_at: i64,
) -> Option<String> {
    if let Some(session_id) = detect_from_session_index(codex_home, working_dir, started_at) {
        return Some(session_id);
    }

    detect_from_rollout_files(codex_home, working_dir, started_at)
}

/// 回退来源：`session_index.jsonl` 中登记的 session（JSON 快照会话走这条）。
fn detect_from_session_index(
    codex_home: &Path,
    working_dir: &str,
    started_at: i64,
) -> Option<String> {
    let session_index = codex_home.join("session_index.jsonl");
    let Ok(lines) = fs::read_to_string(session_index) else {
        return None;
    };
    let session_roots = collect_session_roots(codex_home);

    for line in lines.lines().rev().take(20) {
        let Some(session_id) = serde_json::from_str::<Value>(line).ok().and_then(|value| {
            value
                .get("id")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        }) else {
            continue;
        };

        let Some(session_file) = find_session_file_by_id(&session_roots, &session_id) else {
            continue;
        };
        if !is_recent_enough(&session_file, started_at) {
            continue;
        }

        if session_file_matches_working_dir(&session_file, &session_id, working_dir) {
            return Some(session_id);
        }
    }

    None
}

/// 主来源：`codex-tui` 的 rollout 不写入 `session_index.jsonl`，直接扫描近期
/// rollout 文件首行的 `payload.id` / `payload.cwd` 匹配 `working_dir`。
fn detect_from_rollout_files(
    codex_home: &Path,
    working_dir: &str,
    started_at: i64,
) -> Option<String> {
    let mut candidates = Vec::new();
    for root in collect_session_roots(codex_home) {
        collect_rollout_candidates(&root, &mut candidates);
    }

    // 按 mtime 倒序遍历，最近写入的会话优先，且避免全量读取内容。
    candidates.retain(|candidate| is_within_capture_window(candidate.modified_at, started_at));
    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.modified_at));

    for candidate in candidates {
        if let Some(session_id) = rollout_matches_working_dir(&candidate.path, working_dir) {
            return Some(session_id);
        }
    }

    None
}

/// 递归收集 `rollout-*.jsonl` 候选（文件路径 + 最近修改时间）。
///
/// 会话标识捕获与 session log 读取共用本函数，保证 `sessions/` 与
/// `profiles/*/sessions/` 的扫描事实只有一套。
pub(super) fn collect_rollout_candidates(dir: &Path, candidates: &mut Vec<RolloutCandidate>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rollout_candidates(&path, candidates);
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.starts_with(ROLLOUT_FILE_PREFIX) || !file_name.ends_with(ROLLOUT_FILE_SUFFIX)
        {
            continue;
        }

        if let Some(modified_at) = file_mtime_millis(&path) {
            candidates.push(RolloutCandidate { modified_at, path });
        }
    }
}

fn rollout_matches_working_dir(path: &Path, working_dir: &str) -> Option<String> {
    let payload = read_first_line_payload(path)?.get("payload")?.clone();

    if payload.get("cwd").and_then(|value| value.as_str()) != Some(working_dir) {
        return None;
    }

    payload
        .get("id")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

pub(super) fn collect_session_roots(codex_home: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let top_level_sessions = codex_home.join("sessions");
    if top_level_sessions.is_dir() {
        roots.push(top_level_sessions);
    }

    let profiles_dir = codex_home.join("profiles");
    if let Ok(entries) = fs::read_dir(profiles_dir) {
        for entry in entries.flatten() {
            let sessions_dir = entry.path().join("sessions");
            if sessions_dir.is_dir() {
                roots.push(sessions_dir);
            }
        }
    }

    roots
}

fn find_session_file_by_id(roots: &[PathBuf], session_id: &str) -> Option<PathBuf> {
    for root in roots {
        if let Some(path) = find_session_file_in_dir(root, session_id) {
            return Some(path);
        }
    }

    None
}

fn find_session_file_in_dir(root: &Path, session_id: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_session_file_in_dir(&path, session_id) {
                return Some(found);
            }
            continue;
        }

        let file_name = path.file_name()?.to_str()?;
        if file_name.contains(session_id) {
            return Some(path);
        }
    }

    None
}

fn is_recent_enough(path: &Path, started_at: i64) -> bool {
    file_mtime_millis(path)
        .map(|modified_at| is_within_capture_window(modified_at, started_at))
        .unwrap_or(false)
}

fn is_within_capture_window(modified_at: i64, started_at: i64) -> bool {
    modified_at >= started_at.saturating_sub(SESSION_CAPTURE_WINDOW_MS)
}

pub(super) fn file_mtime_millis(path: &Path) -> Option<i64> {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
}

fn session_file_matches_working_dir(path: &Path, session_id: &str, working_dir: &str) -> bool {
    let Some(payload) =
        read_first_line_payload(path).and_then(|value| value.get("payload").cloned())
    else {
        return false;
    };

    payload.get("id").and_then(|value| value.as_str()) == Some(session_id)
        && payload.get("cwd").and_then(|value| value.as_str()) == Some(working_dir)
}

fn read_first_line_payload(path: &Path) -> Option<Value> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return None,
    };
    let mut reader = BufReader::new(file);
    let mut first_line = String::new();
    if reader.read_line(&mut first_line).is_err() {
        return None;
    }

    serde_json::from_str::<Value>(&first_line).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    #[test]
    fn detect_codex_session_id_from_home_matches_recent_session_file_by_working_dir() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_home = temp_dir.path();
        let session_id = "019d8b4d-2998-7913-889d-fb3c32971610";
        let working_dir = "/tmp/redwhisk";
        let started_at = current_millis();

        fs::write(
            codex_home.join("session_index.jsonl"),
            format!(
                "{{\"id\":\"{session_id}\",\"thread_name\":\"test\",\"updated_at\":\"2026-06-07T00:00:00Z\"}}\n"
            ),
        )
        .expect("write session index");

        let session_file = codex_home
            .join("profiles")
            .join("test")
            .join("sessions")
            .join("2026")
            .join("06")
            .join("07")
            .join(format!("rollout-2026-06-07T00-00-00-{session_id}.jsonl"));
        create_session_file(&session_file, session_id, working_dir);

        let detected = detect_codex_session_id_from_home(codex_home, working_dir, started_at, 1, 1);

        assert_eq!(detected.as_deref(), Some(session_id));
    }

    #[test]
    fn detect_codex_session_id_from_home_ignores_session_for_other_working_dir() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_home = temp_dir.path();
        let session_id = "019d8b4d-2998-7913-889d-fb3c32971610";
        let started_at = current_millis();

        fs::write(
            codex_home.join("session_index.jsonl"),
            format!(
                "{{\"id\":\"{session_id}\",\"thread_name\":\"test\",\"updated_at\":\"2026-06-07T00:00:00Z\"}}\n"
            ),
        )
        .expect("write session index");

        let session_file = codex_home
            .join("profiles")
            .join("test")
            .join("sessions")
            .join("2026")
            .join("06")
            .join("07")
            .join(format!("rollout-2026-06-07T00-00-00-{session_id}.jsonl"));
        create_session_file(&session_file, session_id, "/tmp/other-project");

        let detected =
            detect_codex_session_id_from_home(codex_home, "/tmp/redwhisk", started_at, 1, 1);

        assert_eq!(detected, None);
    }

    #[test]
    fn detect_codex_session_id_from_home_matches_recent_rollout_without_index_entry() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_home = temp_dir.path();
        let session_id = "019d8b4d-2998-7913-889d-fb3c32971610";
        let working_dir = "/tmp/redwhisk";
        let started_at = current_millis();

        // 不存在 session_index.jsonl，只能靠 rollout 扫描命中。
        let rollout_file = sessions_rollout_path(codex_home, session_id);
        create_session_file(&rollout_file, session_id, working_dir);

        let detected = detect_codex_session_id_from_home(codex_home, working_dir, started_at, 1, 1);

        assert_eq!(detected.as_deref(), Some(session_id));
    }

    #[test]
    fn detect_codex_session_id_from_home_matches_recent_rollout_under_profiles_root() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_home = temp_dir.path();
        let session_id = "019d8b4d-2998-7913-889d-fb3c32971610";
        let working_dir = "/tmp/redwhisk";
        let started_at = current_millis();

        let rollout_file = codex_home
            .join("profiles")
            .join("test")
            .join("sessions")
            .join("2026")
            .join("09")
            .join("27")
            .join(format!("rollout-2026-09-27T10-04-21-{session_id}.jsonl"));
        create_session_file(&rollout_file, session_id, working_dir);

        let detected = detect_codex_session_id_from_home(codex_home, working_dir, started_at, 1, 1);

        assert_eq!(detected.as_deref(), Some(session_id));
    }

    #[test]
    fn detect_codex_session_id_from_home_ignores_rollout_for_other_working_dir() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_home = temp_dir.path();
        let session_id = "019d8b4d-2998-7913-889d-fb3c32971610";
        let started_at = current_millis();

        let rollout_file = sessions_rollout_path(codex_home, session_id);
        create_session_file(&rollout_file, session_id, "/tmp/other-project");

        let detected =
            detect_codex_session_id_from_home(codex_home, "/tmp/redwhisk", started_at, 1, 1);

        assert_eq!(detected, None);
    }

    #[test]
    fn detect_codex_session_id_from_home_ignores_stale_rollout() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let codex_home = temp_dir.path();
        let session_id = "019d8b4d-2998-7913-889d-fb3c32971610";
        let working_dir = "/tmp/redwhisk";
        // 文件 mtime 为“现在”，用远未来的 started_at 模拟其落在时间窗之外。
        let started_at = current_millis() + 24 * 60 * 60 * 1_000;

        let rollout_file = sessions_rollout_path(codex_home, session_id);
        create_session_file(&rollout_file, session_id, working_dir);

        let detected = detect_codex_session_id_from_home(codex_home, working_dir, started_at, 1, 1);

        assert_eq!(detected, None);
    }

    fn sessions_rollout_path(codex_home: &Path, session_id: &str) -> PathBuf {
        codex_home
            .join("sessions")
            .join("2026")
            .join("09")
            .join("27")
            .join(format!("rollout-2026-09-27T10-04-21-{session_id}.jsonl"))
    }

    fn create_session_file(path: &Path, session_id: &str, working_dir: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create session dir");
        }

        fs::write(
            path,
            format!(
                "{{\"timestamp\":\"2026-06-07T00:00:00.000Z\",\"type\":\"session_meta\",\"payload\":{{\"id\":\"{session_id}\",\"cwd\":\"{working_dir}\"}}}}\n"
            ),
        )
        .expect("write session file");
    }

    fn current_millis() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("unix time")
            .as_millis() as i64
    }
}
