//! TUI + OpenCode Issue 归档：读本机 sqlite 会话库。
//!
//! 见 ADR-0053 第 4 条。仅 `agent_type=opencode` 时读取
//! `opencode.db` 里该 `session id` 的 message / part。会话目录必须与 cwd 一致。
//! 定位或解析失败返回 `None`，由调用方回退终端提取。测试传入临时库。

use std::path::Path;

use rusqlite::{params, Connection, OpenFlags};
use serde_json::Value;

use crate::types::agent_profile::AgentType;

use super::codex_tui_archive::{
    normalize_archive_block, push_user_archive_block, TuiSessionLogSource,
};

pub(super) fn opencode_session_archive_text(source: TuiSessionLogSource<'_>) -> Option<String> {
    let turns = opencode_session_turns(source)?;
    if turns.is_empty() {
        return None;
    }
    let mut blocks = Vec::new();
    for turn in turns {
        push_user_archive_block(&mut blocks, &turn.user_text);
        if let Some(conclusion) = turn.conclusion.as_deref() {
            push_block(&mut blocks, conclusion);
        }
    }
    let text = blocks.join("\n\n");
    (!text.is_empty()).then_some(text)
}

/// 切换到 json 时回填已完成轮次。定位或解析失败返回 `None`。
pub(super) fn opencode_session_turns(source: TuiSessionLogSource<'_>) -> Option<Vec<OpenCodeTurn>> {
    if source.agent_type != Some(&AgentType::OpenCode) {
        return None;
    }
    let provider_session_id = source.provider_session_id?;
    if provider_session_id.trim().is_empty() {
        return None;
    }
    let cwd = source.session_cwd?;
    if cwd.as_os_str().is_empty() {
        return None;
    }
    let db_path = source.opencode_db_path?;
    read_opencode_turns(db_path, provider_session_id, &cwd.to_string_lossy())
}

pub(super) struct OpenCodeTurn {
    pub(super) user_text: String,
    pub(super) conclusion: Option<String>,
}

struct OpenCodeMessage {
    role: String,
    texts: Vec<String>,
}

fn read_opencode_turns(
    db_path: &Path,
    provider_session_id: &str,
    cwd: &str,
) -> Option<Vec<OpenCodeTurn>> {
    let connection = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    if !session_directory_matches(&connection, provider_session_id, cwd)? {
        return None;
    }
    let messages = load_messages(&connection, provider_session_id).ok()?;
    Some(opencode_turns(&messages))
}

fn session_directory_matches(
    connection: &Connection,
    provider_session_id: &str,
    cwd: &str,
) -> Option<bool> {
    let directory: Option<String> = connection
        .query_row(
            "SELECT directory FROM session WHERE id = ?1",
            params![provider_session_id],
            |row| row.get(0),
        )
        .ok()?;
    Some(directory.as_deref() == Some(cwd))
}

fn load_messages(
    connection: &Connection,
    provider_session_id: &str,
) -> rusqlite::Result<Vec<OpenCodeMessage>> {
    let mut statement = connection.prepare(
        "SELECT id, data FROM message WHERE session_id = ?1 ORDER BY time_created ASC, id ASC",
    )?;
    let rows = statement.query_map(params![provider_session_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut messages = Vec::new();
    for row in rows {
        let (message_id, raw) = row?;
        let Some(message) = message_from_row(connection, &message_id, &raw) else {
            continue;
        };
        messages.push(message);
    }
    Ok(messages)
}

fn message_from_row(
    connection: &Connection,
    message_id: &str,
    raw: &str,
) -> Option<OpenCodeMessage> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let role = value.get("role").and_then(Value::as_str)?.to_string();
    if role != "user" && role != "assistant" {
        return None;
    }
    let texts = parts_for_message(connection, message_id).ok()?;
    Some(OpenCodeMessage { role, texts })
}

fn parts_for_message(connection: &Connection, message_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut statement = connection
        .prepare("SELECT data FROM part WHERE message_id = ?1 ORDER BY time_created ASC, id ASC")?;
    let rows = statement.query_map(params![message_id], |row| row.get::<_, String>(0))?;
    let mut texts = Vec::new();
    for row in rows {
        let raw = row?;
        let Ok(value) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("text") {
            continue;
        }
        if let Some(text) = value.get("text").and_then(Value::as_str) {
            texts.push(text.to_string());
        }
    }
    Ok(texts)
}

fn opencode_turns(messages: &[OpenCodeMessage]) -> Vec<OpenCodeTurn> {
    let user_indexes: Vec<usize> = messages
        .iter()
        .enumerate()
        .filter(|(_, message)| message.role == "user" && !joined_text(&message.texts).is_empty())
        .map(|(index, _)| index)
        .collect();
    user_indexes
        .iter()
        .enumerate()
        .map(|(turn_index, &start)| {
            let end = user_indexes
                .get(turn_index + 1)
                .copied()
                .unwrap_or(messages.len());
            OpenCodeTurn {
                user_text: joined_text(&messages[start].texts),
                conclusion: last_finished_assistant(&messages[start + 1..end]),
            }
        })
        .collect()
}

fn last_finished_assistant(messages: &[OpenCodeMessage]) -> Option<String> {
    messages.iter().rev().find_map(|message| {
        if message.role != "assistant" {
            return None;
        }
        let text = joined_text(&message.texts);
        if text.is_empty() {
            return None;
        }
        Some(text)
    })
}

fn joined_text(texts: &[String]) -> String {
    texts
        .iter()
        .map(|text| text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn push_block(blocks: &mut Vec<String>, text: &str) {
    let normalized = normalize_archive_block(text);
    if !normalized.is_empty() {
        blocks.push(normalized);
    }
}
