use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde_json::json;

use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::migrations::MigrationRunner;

use super::TuiSessionMetricsSync;

const SESSION_ID: &str = "019d8b4d-2998-7913-889d-fb3c32971610";

#[test]
fn syncs_token_usage_and_processing_ms_for_running_tui_codex_session() {
    let connection = setup();
    insert_session(&connection, 501, "tui", 101, Some(SESSION_ID));
    let codex_home = tempfile::tempdir().expect("temp dir");
    let rollout = rollout_path(codex_home.path(), SESSION_ID);
    write_rollout(
        &rollout,
        &[
            item_completed("UserMessage", "turn-1", "text", "第一个问题"),
            item_completed("AgentMessage", "turn-1", "Text", "第一轮结论"),
            token_count(1_500, 400, 50, 300, 80),
            task_complete("turn-1", 41_989, "第一轮结论"),
        ],
    );

    let repository = AgentSessionRepository::new(&connection);
    let mut sync = TuiSessionMetricsSync::new();
    sync.sync_once(&repository, Some(codex_home.path()));

    // input = 未命中缓存 input - 缓存命中 + 缓存写入；输出含 reasoning；缓存为 cache 读取。
    assert_eq!(
        read_metrics(&connection, 501),
        (Some(1_150), Some(300), Some(400), 41_989)
    );
}

#[test]
fn leaves_json_session_untouched() {
    let connection = setup();
    insert_session(&connection, 502, "json", 101, Some(SESSION_ID));
    let codex_home = tempfile::tempdir().expect("temp dir");
    write_rollout(
        &rollout_path(codex_home.path(), SESSION_ID),
        &[
            token_count(1_500, 400, 50, 300, 80),
            task_complete("turn-1", 12_000, "结论"),
        ],
    );

    let repository = AgentSessionRepository::new(&connection);
    let mut sync = TuiSessionMetricsSync::new();
    sync.sync_once(&repository, Some(codex_home.path()));

    assert_eq!(read_metrics(&connection, 502), (None, None, None, 0));
}

#[test]
fn leaves_non_codex_tui_session_untouched() {
    let connection = setup();
    insert_session(&connection, 503, "tui", 102, Some(SESSION_ID));
    let codex_home = tempfile::tempdir().expect("temp dir");
    write_rollout(
        &rollout_path(codex_home.path(), SESSION_ID),
        &[
            token_count(1_500, 400, 50, 300, 80),
            task_complete("turn-1", 12_000, "结论"),
        ],
    );

    let repository = AgentSessionRepository::new(&connection);
    let mut sync = TuiSessionMetricsSync::new();
    sync.sync_once(&repository, Some(codex_home.path()));

    assert_eq!(read_metrics(&connection, 503), (None, None, None, 0));
}

#[test]
fn accumulates_metrics_across_ticks_and_waits_for_complete_lines() {
    let connection = setup();
    insert_session(&connection, 504, "tui", 101, Some(SESSION_ID));
    let codex_home = tempfile::tempdir().expect("temp dir");
    let rollout = rollout_path(codex_home.path(), SESSION_ID);
    // 第一轮完整落盘；第二轮的 token_count 行先写一半（尚无换行），
    // 模拟 session log 正在追加、末尾是不完整行。
    let second_token_line = token_count(3_000, 800, 50, 600, 100);
    let (partial, remainder) = second_token_line.split_at(second_token_line.len() / 2);
    write_rollout(
        &rollout,
        &[
            item_completed("UserMessage", "turn-1", "text", "第一个问题"),
            item_completed("AgentMessage", "turn-1", "Text", "第一轮结论"),
            token_count(1_500, 400, 50, 300, 80),
            task_complete("turn-1", 1_000, "第一轮结论"),
            partial.to_string(),
        ],
    );

    let repository = AgentSessionRepository::new(&connection);
    let mut sync = TuiSessionMetricsSync::new();
    sync.sync_once(&repository, Some(codex_home.path()));
    // 只消费完整行：第一轮用量与时长已入库，半行未计入。
    assert_eq!(
        read_metrics(&connection, 504),
        (Some(1_150), Some(300), Some(400), 1_000)
    );

    append_rollout(
        &rollout,
        &[
            remainder.to_string(),
            item_completed("AgentMessage", "turn-2", "Text", "第二轮结论"),
            task_complete("turn-2", 2_000, "第二轮结论"),
        ],
    );
    sync.sync_once(&repository, Some(codex_home.path()));

    // 累计覆盖写：token 取最后一条 token_count 快照，时长按 turn 求和。
    assert_eq!(
        read_metrics(&connection, 504),
        (Some(2_250), Some(600), Some(800), 3_000)
    );
}

#[test]
fn silently_skips_when_no_session_log_matches() {
    let connection = setup();
    insert_session(&connection, 505, "tui", 101, Some("missing-session-id"));
    let codex_home = tempfile::tempdir().expect("temp dir");
    write_rollout(
        &rollout_path(codex_home.path(), SESSION_ID),
        &[token_count(1_500, 400, 50, 300, 80)],
    );

    let repository = AgentSessionRepository::new(&connection);
    let mut sync = TuiSessionMetricsSync::new();
    sync.sync_once(&repository, Some(codex_home.path()));

    assert_eq!(read_metrics(&connection, 505), (None, None, None, 0));
}

fn setup() -> Connection {
    let connection = Connection::open_in_memory().expect("open database");
    MigrationRunner::default()
        .run(&connection)
        .expect("run migrations");
    connection
        .execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (1, 'RedWhisk', ?1, 1, 1)",
            params![std::env::temp_dir().to_string_lossy().to_string()],
        )
        .expect("insert project");
    for (id, agent_type) in [(101, "codex"), (102, "claude")] {
        connection
            .execute(
                "INSERT INTO agent_profiles (
                   id, name, agent_type, command, scope, project_id, mode, dangerous,
                   default_skill, prompt_template, del, display_mode, enabled
                 ) VALUES (?1, ?2, ?3, ?3, 'project', 1, 'full-auto', 1, '', '', 0, 'tui', 1)",
                params![id, agent_type, agent_type],
            )
            .expect("insert agent profile");
    }
    connection
}

fn insert_session(
    connection: &Connection,
    id: i64,
    display_mode: &str,
    agent_profile_id: i64,
    provider_session_id: Option<&str>,
) {
    connection
        .execute(
            "INSERT INTO agent_sessions (
               id, project_id, number, issue_id, title, agent_profile_id, status, attention,
               working_dir, command_snapshot, prompt_snapshot, workspace_mode,
               target_branch, workspace_branch, workspace_path, worktree_root_path,
               provider_session_id, log_path, display_mode, list_inserted_at,
               last_active_at, started_at, closed_at, del
             ) VALUES (
               ?1, 1, ?1, NULL, NULL, ?2, 'running', 'none',
               '/tmp', '', '', 'current_branch',
               NULL, NULL, '/tmp', NULL,
               ?3, '/tmp/session.jsonl', ?4, 1,
               1, 1, NULL, 0
             )",
            params![id, agent_profile_id, provider_session_id, display_mode],
        )
        .expect("insert agent session");
}

fn read_metrics(connection: &Connection, id: i64) -> (Option<i64>, Option<i64>, Option<i64>, i64) {
    connection
        .query_row(
            "SELECT token_input, token_output, token_cache, processing_ms
             FROM agent_sessions WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("read session metrics")
}

fn rollout_path(codex_home: &Path, session_id: &str) -> PathBuf {
    codex_home
        .join("sessions")
        .join("2026")
        .join("09")
        .join("27")
        .join(format!("rollout-2026-09-27T10-04-21-{session_id}.jsonl"))
}

fn write_rollout(path: &Path, lines: &[String]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create session dir");
    }
    fs::write(path, lines.concat()).expect("write session log");
}

fn append_rollout(path: &Path, lines: &[String]) {
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(path)
        .expect("open session log for append");
    file.write_all(lines.concat().as_bytes())
        .expect("append session log");
}

fn item_completed(item_type: &str, turn_id: &str, text_type: &str, text: &str) -> String {
    line(json!({
        "timestamp": "2026-09-27T10:04:22.000Z",
        "type": "event_msg",
        "payload": {
            "type": "item_completed",
            "turn_id": turn_id,
            "item": {
                "type": item_type,
                "content": [{ "type": text_type, "text": text }],
            },
        },
    }))
}

fn token_count(
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

fn task_complete(turn_id: &str, duration_ms: u64, last_agent_message: &str) -> String {
    line(json!({
        "timestamp": "2026-09-27T10:04:24.000Z",
        "type": "event_msg",
        "payload": {
            "type": "task_complete",
            "turn_id": turn_id,
            "duration_ms": duration_ms,
            "last_agent_message": last_agent_message,
        },
    }))
}

fn line(value: serde_json::Value) -> String {
    format!("{value}\n")
}
