use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;

use super::*;

const SESSION_ID: &str = "019d8b4d-2998-7913-889d-fb3c32971610";

#[test]
fn reads_turns_usage_and_duration_from_matching_rollout() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let codex_home = temp_dir.path();
    let rollout = sessions_rollout_path(codex_home, SESSION_ID);
    write_file(
        &rollout,
        &[
            session_meta_line(SESSION_ID),
            item_completed_line("UserMessage", "turn-1", "text", "第一个问题"),
            item_completed_line("AgentMessage", "turn-1", "Text", "中间旁白"),
            item_completed_line("AgentMessage", "turn-1", "Text", "第一轮结论"),
            token_count_line(1_500, 400, 50, 300, 80),
            task_complete_line("turn-1", Some(41_989), None, Some("第一轮结论")),
            item_completed_line("UserMessage", "turn-2", "text", "第二个问题"),
            item_completed_line("AgentMessage", "turn-2", "Text", "第二轮结论"),
            token_count_line(3_000, 800, 50, 600, 100),
            task_complete_line("turn-2", Some(1_000), None, None),
        ],
    );

    let summary = read_codex_session_summary(codex_home, SESSION_ID).expect("summary");

    assert_eq!(
        summary.turns,
        vec![
            CodexSessionTurn {
                user_text: "第一个问题".to_string(),
                final_assistant_text: Some("第一轮结论".to_string()),
                duration_ms: Some(41_989),
            },
            CodexSessionTurn {
                user_text: "第二个问题".to_string(),
                final_assistant_text: Some("第二轮结论".to_string()),
                duration_ms: Some(1_000),
            },
        ]
    );
    assert_eq!(summary.processing_ms, 42_989);
    assert_eq!(
        summary.token_usage,
        Some(SessionTokenUsage {
            input: 2_250,
            output: 600,
            cache: 800,
        })
    );
}

#[test]
fn concatenates_text_parts_within_one_item() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let codex_home = temp_dir.path();
    let rollout = sessions_rollout_path(codex_home, SESSION_ID);
    write_file(
        &rollout,
        &[line(json!({
            "timestamp": "2026-09-27T10:04:22.000Z",
            "type": "event_msg",
            "payload": {
                "type": "item_completed",
                "turn_id": "turn-1",
                "item": {
                    "type": "UserMessage",
                    "content": [
                        { "type": "text", "text": "第一段" },
                        { "type": "image", "url": "ignored" },
                        { "type": "text", "text": "第二段" },
                    ],
                },
            },
        }))],
    );

    let summary = read_codex_session_summary(codex_home, SESSION_ID).expect("summary");

    assert_eq!(summary.turns.len(), 1);
    assert_eq!(summary.turns[0].user_text, "第一段第二段");
}

#[test]
fn prefers_most_recently_modified_rollout_for_same_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let codex_home = temp_dir.path();

    let stale = sessions_rollout_path(codex_home, SESSION_ID);
    write_file(
        &stale,
        &[item_completed_line(
            "UserMessage",
            "turn-1",
            "text",
            "旧会话",
        )],
    );
    set_modified_seconds_ago(&stale, 3_600);

    let fresh = codex_home
        .join("profiles")
        .join("default")
        .join("sessions")
        .join("2026")
        .join("09")
        .join("27")
        .join(format!("rollout-2026-09-27T11-00-00-{SESSION_ID}.jsonl"));
    write_file(
        &fresh,
        &[item_completed_line(
            "UserMessage",
            "turn-1",
            "text",
            "新会话",
        )],
    );

    let summary = read_codex_session_summary(codex_home, SESSION_ID).expect("summary");

    assert_eq!(summary.turns[0].user_text, "新会话");
}

#[test]
fn returns_none_when_no_rollout_matches_session_id() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let codex_home = temp_dir.path();
    let rollout = sessions_rollout_path(codex_home, "00000000-0000-0000-0000-000000000000");
    write_file(
        &rollout,
        &[item_completed_line(
            "UserMessage",
            "turn-1",
            "text",
            "别人的会话",
        )],
    );

    assert_eq!(read_codex_session_summary(codex_home, SESSION_ID), None);
}

#[test]
fn returns_none_when_session_log_file_is_missing() {
    let temp_dir = tempfile::tempdir().expect("temp dir");

    assert_eq!(
        read_codex_session_summary(temp_dir.path(), SESSION_ID),
        None
    );
    assert_eq!(
        read_codex_session_summary_from_path(&temp_dir.path().join("absent.jsonl")),
        None
    );
}

#[test]
fn returns_none_for_empty_file() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let path = temp_dir.path().join("empty.jsonl");
    write_file(&path, &[]);

    assert_eq!(read_codex_session_summary_from_path(&path), None);
}

#[test]
fn returns_none_for_file_that_is_not_utf8() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let path = temp_dir.path().join("broken.jsonl");
    fs::write(&path, [0xff, 0xfe, 0x00, 0x9f]).expect("write broken file");

    assert_eq!(read_codex_session_summary_from_path(&path), None);
}

#[test]
fn skips_non_json_and_unknown_lines() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let codex_home = temp_dir.path();
    let rollout = sessions_rollout_path(codex_home, SESSION_ID);
    write_file(
        &rollout,
        &[
            "这不是 JSON\n".to_string(),
            "{ 半截 JSON\n".to_string(),
            line(json!({ "type": "response_item", "payload": { "type": "message" } })),
            item_completed_line("AgentMessage", "turn-1", "Text", "只有结论"),
        ],
    );

    let summary = read_codex_session_summary(codex_home, SESSION_ID).expect("summary");

    assert_eq!(summary.turns.len(), 1);
    assert_eq!(summary.turns[0].user_text, "");
    assert_eq!(
        summary.turns[0].final_assistant_text,
        Some("只有结论".to_string())
    );
}

#[test]
fn returns_none_when_file_holds_no_recognizable_event() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let path = temp_dir.path().join("noise.jsonl");
    write_file(&path, &["乱码\n".to_string(), "{}\n".to_string()]);

    assert_eq!(read_codex_session_summary_from_path(&path), None);
}

#[test]
fn keeps_turns_when_task_complete_and_token_count_are_absent() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let path = temp_dir.path().join("partial.jsonl");
    write_file(
        &path,
        &[
            item_completed_line("UserMessage", "turn-1", "text", "问题"),
            item_completed_line("AgentMessage", "turn-1", "Text", "结论"),
        ],
    );

    let summary = read_codex_session_summary_from_path(&path).expect("summary");

    assert_eq!(summary.processing_ms, 0);
    assert_eq!(summary.token_usage, None);
    assert_eq!(
        summary.turns,
        vec![CodexSessionTurn {
            user_text: "问题".to_string(),
            final_assistant_text: Some("结论".to_string()),
            duration_ms: None,
        }]
    );
}

#[test]
fn falls_back_to_last_agent_message_and_timestamp_duration() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let path = temp_dir.path().join("fallback.jsonl");
    write_file(
        &path,
        &[task_complete_line(
            "turn-1",
            None,
            Some((1_750_000_000.0, 1_750_000_002.5)),
            Some("兜底结论"),
        )],
    );

    let summary = read_codex_session_summary_from_path(&path).expect("summary");

    assert_eq!(summary.turns.len(), 1);
    assert_eq!(
        summary.turns[0].final_assistant_text,
        Some("兜底结论".to_string())
    );
    assert_eq!(summary.turns[0].duration_ms, Some(2_500));
    assert_eq!(summary.processing_ms, 2_500);
}

#[test]
fn ignores_items_without_turn_id() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let path = temp_dir.path().join("no-turn-id.jsonl");
    write_file(
        &path,
        &[
            line(json!({
                    "type": "event_msg",
                    "payload": {
                        "type": "item_completed",
                        "item": {
                            "type": "UserMessage",
                        "content": [{ "type": "text", "text": "无 turn_id" }],
                    },
                },
            })),
            item_completed_line("UserMessage", "turn-1", "text", "有 turn_id"),
        ],
    );

    let summary = read_codex_session_summary_from_path(&path).expect("summary");

    assert_eq!(summary.turns.len(), 1);
    assert_eq!(summary.turns[0].user_text, "有 turn_id");
}

fn sessions_rollout_path(codex_home: &Path, session_id: &str) -> PathBuf {
    codex_home
        .join("sessions")
        .join("2026")
        .join("09")
        .join("27")
        .join(format!("rollout-2026-09-27T10-04-21-{session_id}.jsonl"))
}

fn write_file(path: &Path, lines: &[String]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create session dir");
    }
    fs::write(path, lines.concat()).expect("write session log");
}

fn set_modified_seconds_ago(path: &Path, seconds: u64) {
    let modified = std::time::SystemTime::now() - std::time::Duration::from_secs(seconds);
    fs::File::options()
        .write(true)
        .open(path)
        .expect("open for mtime")
        .set_modified(modified)
        .expect("set mtime");
}

fn line(value: serde_json::Value) -> String {
    format!("{value}\n")
}

fn session_meta_line(session_id: &str) -> String {
    line(json!({
        "timestamp": "2026-09-27T10:04:21.000Z",
        "type": "session_meta",
        "payload": { "id": session_id, "cwd": "/tmp/redwhisk" },
    }))
}

fn item_completed_line(item_type: &str, turn_id: &str, text_type: &str, text: &str) -> String {
    line(json!({
        "timestamp": "2026-09-27T10:04:22.000Z",
        "type": "event_msg",
        "payload": {
            "type": "item_completed",
            // 实测 rollout 的 turn_id 挂在 payload 上
            "turn_id": turn_id,
            "item": {
                "type": item_type,
                "content": [{ "type": text_type, "text": text }],
            },
        },
    }))
}

fn token_count_line(
    input_tokens: u64,
    cached_input_tokens: u64,
    cache_write_input_tokens: u64,
    output_tokens: u64,
    reasoning_output_tokens: u64,
) -> String {
    line(json!({
        "timestamp": "2026-09-27T10:04:23.000Z",
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "info": {
                "total_token_usage": {
                    "input_tokens": input_tokens,
                    "cached_input_tokens": cached_input_tokens,
                    "cache_write_input_tokens": cache_write_input_tokens,
                    "output_tokens": output_tokens,
                    "reasoning_output_tokens": reasoning_output_tokens,
                },
            },
        },
    }))
}

fn task_complete_line(
    turn_id: &str,
    duration_ms: Option<u64>,
    timestamp_duration_seconds: Option<(f64, f64)>,
    last_agent_message: Option<&str>,
) -> String {
    let mut payload = json!({ "type": "task_complete", "turn_id": turn_id });
    if let Some(duration_ms) = duration_ms {
        payload["duration_ms"] = json!(duration_ms);
    }
    if let Some((started_at, completed_at)) = timestamp_duration_seconds {
        payload["started_at"] = json!(started_at);
        payload["completed_at"] = json!(completed_at);
    }
    if let Some(message) = last_agent_message {
        payload["last_agent_message"] = json!(message);
    }
    line(json!({
        "timestamp": "2026-09-27T10:04:24.000Z",
        "type": "event_msg",
        "payload": payload,
    }))
}
