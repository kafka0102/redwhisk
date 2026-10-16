//! TUI + Claude Code Issue 归档：读本机 `~/.claude/projects` 会话记录。
//!
//! 见 ADR-0053 第 4 条。仅 `agent_type=claude` 时读取
//! `<projects>/<编码 cwd>/<provider session id>.jsonl`。定位或解析失败返回
//! `None`，由调用方回退终端提取。测试传入临时 projects 根，不读用户本机记录。

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::types::agent_profile::AgentType;

use super::codex_tui_archive::{normalize_archive_block, TuiSessionLogSource};

pub(super) fn claude_session_archive_text(source: TuiSessionLogSource<'_>) -> Option<String> {
    if source.agent_type != Some(&AgentType::Claude) {
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
    let root = source.claude_projects_root?;
    let path = claude_transcript_path(root, cwd, provider_session_id);
    let raw = fs::read_to_string(path).ok()?;
    let text = render_claude_archive_text(&raw)?;
    (!text.is_empty()).then_some(text)
}

fn claude_transcript_path(root: &Path, cwd: &Path, provider_session_id: &str) -> PathBuf {
    root.join(encode_claude_project_dir(&cwd.to_string_lossy()))
        .join(format!("{provider_session_id}.jsonl"))
}

/// Claude 项目目录名：以 `-` 开头，路径里每个非字母数字都换成 `-`。
fn encode_claude_project_dir(cwd: &str) -> String {
    let mut encoded = String::from("-");
    for ch in cwd.chars() {
        if ch.is_ascii_alphanumeric() {
            encoded.push(ch);
        } else {
            encoded.push('-');
        }
    }
    encoded
}

fn render_claude_archive_text(raw: &str) -> Option<String> {
    let records = parse_claude_records(raw)?;
    let turns = claude_turns(&records);
    if turns.is_empty() {
        return None;
    }
    let mut blocks = Vec::new();
    for turn in turns {
        push_block(&mut blocks, &turn.user_text);
        if let Some(conclusion) = turn.conclusion.as_deref() {
            push_block(&mut blocks, conclusion);
        }
    }
    let text = blocks.join("\n\n");
    (!text.is_empty()).then_some(text)
}

struct ClaudeTurn {
    user_text: String,
    conclusion: Option<String>,
}

struct ClaudeRecord {
    kind: ClaudeRecordKind,
    text: String,
}

enum ClaudeRecordKind {
    User,
    Assistant,
}

fn parse_claude_records(raw: &str) -> Option<Vec<ClaudeRecord>> {
    let mut records = Vec::new();
    let mut saw_line = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        saw_line = true;
        let value: Value = serde_json::from_str(trimmed).ok()?;
        if let Some(record) = record_from_value(&value) {
            records.push(record);
        }
    }
    saw_line.then_some(records)
}

fn record_from_value(value: &Value) -> Option<ClaudeRecord> {
    if value
        .get("isSidechain")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return None;
    }
    match value.get("type").and_then(Value::as_str) {
        Some("user") => user_record(value),
        Some("assistant") => Some(assistant_record(value)),
        _ => None,
    }
}

fn user_record(value: &Value) -> Option<ClaudeRecord> {
    if value.get("isMeta").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let content = value
        .get("message")
        .and_then(|message| message.get("content"))?;
    let text = user_content_text(content);
    if text.trim().is_empty() {
        return None;
    }
    Some(ClaudeRecord {
        kind: ClaudeRecordKind::User,
        text,
    })
}

fn user_content_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                if part.get("type").and_then(Value::as_str) != Some("text") {
                    return None;
                }
                part.get("text").and_then(Value::as_str).map(str::to_string)
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
        _ => String::new(),
    }
}

fn assistant_record(value: &Value) -> ClaudeRecord {
    let content = value
        .get("message")
        .and_then(|message| message.get("content"));
    let mut texts = Vec::new();
    if let Some(Value::Array(parts)) = content {
        for part in parts {
            if part.get("type").and_then(Value::as_str) != Some("text") {
                continue;
            }
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                texts.push(text);
            }
        }
    }
    ClaudeRecord {
        kind: ClaudeRecordKind::Assistant,
        text: texts.join("\n\n"),
    }
}

fn claude_turns(records: &[ClaudeRecord]) -> Vec<ClaudeTurn> {
    let user_indexes: Vec<usize> = records
        .iter()
        .enumerate()
        .filter(|(_, record)| matches!(record.kind, ClaudeRecordKind::User))
        .map(|(index, _)| index)
        .collect();
    user_indexes
        .iter()
        .enumerate()
        .map(|(turn_index, &start)| {
            let end = user_indexes
                .get(turn_index + 1)
                .copied()
                .unwrap_or(records.len());
            ClaudeTurn {
                user_text: records[start].text.clone(),
                conclusion: last_finished_assistant(&records[start + 1..end]),
            }
        })
        .collect()
}

fn last_finished_assistant(records: &[ClaudeRecord]) -> Option<String> {
    records.iter().rev().find_map(|record| {
        if !matches!(record.kind, ClaudeRecordKind::Assistant) {
            return None;
        }
        if record.text.trim().is_empty() {
            return None;
        }
        Some(record.text.clone())
    })
}

fn push_block(blocks: &mut Vec<String>, text: &str) {
    let normalized = normalize_archive_block(text);
    if !normalized.is_empty() {
        blocks.push(normalized);
    }
}
