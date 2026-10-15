//! TUI + Grok Issue 归档：读本机会话存储里已提交的用户输入与最终结论。
//!
//! 见 ADR-0052。仅 `display_mode=tui` 且 `agent_type=grok` 时读取
//! `<sessions>/<urlencoded cwd>/<provider session id>/chat_history.jsonl`。
//! 定位或解析失败返回 `None`，由调用方回退终端提取。测试传入临时 sessions 根，
//! 不读用户本机 `~/.grok/sessions`。

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::types::agent_profile::AgentType;
use crate::types::agent_session::AgentSessionRecord;

use super::codex_tui_archive::{normalize_archive_block, TuiSessionLogSource};
use super::service::preferred_session_cwd;

const CHAT_HISTORY_FILE_NAME: &str = "chat_history.jsonl";
const GROK_SESSIONS_DIR: &str = ".grok/sessions";

/// 完成归档持有的路径。`TuiSessionLogSource` 只借引用，路径必须活过归档构建。
pub(crate) struct TuiArchiveSource {
    agent_type: Option<AgentType>,
    provider_session_id: Option<String>,
    codex_home: Option<PathBuf>,
    session_cwd: PathBuf,
    grok_sessions_root: Option<PathBuf>,
}

impl TuiArchiveSource {
    /// cwd 与启动 TUI 相同：`workspace_path` 非空则用它，否则 `working_dir`。
    /// `grok_sessions_root` 缺省为 `~/.grok/sessions`；home 缺失则为 `None`，回退终端提取。
    /// 测试传入临时根，避免读用户本机真实会话。
    pub(crate) fn new(
        agent_type: Option<AgentType>,
        session: &AgentSessionRecord,
        codex_home: Option<PathBuf>,
        user_home: Option<&Path>,
        grok_sessions_root: Option<PathBuf>,
    ) -> Self {
        let grok_sessions_root = grok_sessions_root.or_else(|| {
            user_home
                .filter(|home| !home.as_os_str().is_empty())
                .map(|home| home.join(GROK_SESSIONS_DIR))
        });
        Self {
            agent_type,
            provider_session_id: session.provider_session_id.clone(),
            codex_home,
            session_cwd: PathBuf::from(preferred_session_cwd(session)),
            grok_sessions_root,
        }
    }

    pub(crate) fn as_log_source(&self) -> TuiSessionLogSource<'_> {
        TuiSessionLogSource::new(
            self.agent_type.as_ref(),
            self.provider_session_id.as_deref(),
            self.codex_home.as_deref(),
        )
        .with_grok_session(
            Some(self.session_cwd.as_path()),
            self.grok_sessions_root.as_deref(),
        )
    }
}

pub(super) fn grok_session_archive_text(source: TuiSessionLogSource<'_>) -> Option<String> {
    if source.agent_type != Some(&AgentType::Grok) {
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
    let root = source.grok_sessions_root?;
    let path = grok_chat_history_path(root, cwd, provider_session_id);
    let raw = fs::read_to_string(path).ok()?;
    let text = render_grok_archive_text(&raw)?;
    (!text.is_empty()).then_some(text)
}

fn grok_chat_history_path(root: &Path, cwd: &Path, provider_session_id: &str) -> PathBuf {
    let encoded_cwd = encode_grok_session_cwd(&cwd.to_string_lossy());
    root.join(encoded_cwd)
        .join(provider_session_id)
        .join(CHAT_HISTORY_FILE_NAME)
}

/// Grok 会话目录名：绝对 cwd 的百分号编码。非字母数字按 UTF-8 字节编码。
fn encode_grok_session_cwd(cwd: &str) -> String {
    let mut encoded = String::new();
    for byte in cwd.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn render_grok_archive_text(raw: &str) -> Option<String> {
    let records = parse_grok_records(raw)?;
    let turns = grok_turns(&records);
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

struct GrokTurn {
    user_text: String,
    conclusion: Option<String>,
}

struct GrokRecord {
    kind: GrokRecordKind,
    synthetic: bool,
    tool_calls_present_and_nonempty: bool,
    text: String,
}

enum GrokRecordKind {
    User,
    Assistant,
    Other,
}

fn parse_grok_records(raw: &str) -> Option<Vec<GrokRecord>> {
    let mut records = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(trimmed).ok()?;
        records.push(record_from_value(&value));
    }
    Some(records)
}

fn record_from_value(value: &Value) -> GrokRecord {
    let kind = match value.get("type").and_then(Value::as_str) {
        Some("user") => GrokRecordKind::User,
        Some("assistant") => GrokRecordKind::Assistant,
        _ => GrokRecordKind::Other,
    };
    let tool_calls_present_and_nonempty = match value.get("tool_calls") {
        None | Some(Value::Null) => false,
        Some(Value::Array(calls)) => !calls.is_empty(),
        Some(_) => true,
    };
    GrokRecord {
        kind,
        synthetic: value.get("synthetic_reason").is_some()
            && !value.get("synthetic_reason").is_some_and(Value::is_null),
        tool_calls_present_and_nonempty,
        text: content_text(value.get("content")),
    }
}

fn content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

fn grok_turns(records: &[GrokRecord]) -> Vec<GrokTurn> {
    let user_indexes: Vec<usize> = records
        .iter()
        .enumerate()
        .filter(|(_, record)| is_submitted_user(record))
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
            let user_text = user_query_body(&records[start].text);
            let conclusion_end = records[start + 1..end]
                .iter()
                .position(|record| is_internal_user(record))
                .map(|offset| start + 1 + offset)
                .unwrap_or(end);
            let conclusion = last_finished_assistant(&records[start + 1..conclusion_end]);
            GrokTurn {
                user_text,
                conclusion,
            }
        })
        .collect()
}

fn last_finished_assistant(records: &[GrokRecord]) -> Option<String> {
    records.iter().rev().find_map(|record| {
        if !matches!(record.kind, GrokRecordKind::Assistant) {
            return None;
        }
        if record.tool_calls_present_and_nonempty {
            return None;
        }
        if record.text.trim().is_empty() {
            return None;
        }
        Some(record.text.clone())
    })
}

fn is_internal_user(record: &GrokRecord) -> bool {
    matches!(record.kind, GrokRecordKind::User)
        && !record.synthetic
        && user_query_body(&record.text).is_empty()
}

fn is_submitted_user(record: &GrokRecord) -> bool {
    // 已提交用户输入以 `<user_query>` 为准。部分真实输入没有 prompt_index；
    // 带 prompt_index 但没有 user_query 的是内部提示，不单独成轮。
    matches!(record.kind, GrokRecordKind::User)
        && !record.synthetic
        && !user_query_body(&record.text).is_empty()
}

fn user_query_body(content: &str) -> String {
    let Some(start) = content.find("<user_query>") else {
        return String::new();
    };
    let after = &content[start + "<user_query>".len()..];
    let body = after
        .split_once("</user_query>")
        .map(|(inside, _)| inside)
        .unwrap_or("");
    body.trim().to_string()
}

fn push_block(blocks: &mut Vec<String>, text: &str) {
    let normalized = normalize_archive_block(text);
    if !normalized.is_empty() {
        blocks.push(normalized);
    }
}
