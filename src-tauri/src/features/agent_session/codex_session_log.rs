//! Codex session log 读取与规范化（纯逻辑单元）。
//!
//! 给定 `CODEX_HOME` 与某个会话的 `provider_session_id`（或直接文件路径），
//! 定位本机 rollout（`sessions/**/rollout-*.jsonl`，兼容 `profiles/*/sessions/**`）
//! 并解析出规范化摘要：按顺序的 turn 列表、线程累计 Token 用量、累计处理时长。
//!
//! 模块零 DB / 运行时依赖；解析失败、文件缺失、空文件、非 JSON 行均返回 `None`
//! 或跳过对应行，不 panic、不报错中断。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::agent::session_token_usage::{normalize_codex_token_usage, SessionTokenUsage};

use super::codex_session_id_capture::{collect_rollout_candidates, collect_session_roots};

/// 一次 Codex 会话的规范化摘要。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CodexSessionSummary {
    /// 按事件出现顺序排列的 turn 列表。
    pub turns: Vec<CodexSessionTurn>,
    /// 线程累计 Token 用量；无 `token_count` 时为 `None`。
    pub token_usage: Option<SessionTokenUsage>,
    /// 各 turn `duration_ms` 之和。
    pub processing_ms: u64,
}

/// 单个 turn 的用户输入与该 turn 的最终结论。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CodexSessionTurn {
    /// 该 turn 的真实用户输入；缺失时为空串。
    pub user_text: String,
    /// 该 turn 最后一条助手消息；缺失时为 `None`。
    pub final_assistant_text: Option<String>,
    /// 该 turn 的处理耗时（毫秒）；缺失时为 `None`。
    pub duration_ms: Option<u64>,
}

/// 定位并读取某 `provider_session_id` 对应的 Codex session log。
pub fn read_codex_session_summary(
    codex_home: &Path,
    provider_session_id: &str,
) -> Option<CodexSessionSummary> {
    let path = locate_session_log(codex_home, provider_session_id)?;
    read_codex_session_summary_from_path(&path)
}

/// 从显式文件路径读取并规范化 Codex session log。
pub fn read_codex_session_summary_from_path(path: &Path) -> Option<CodexSessionSummary> {
    // 整文件读取：IO / 编码错误一律当作「无结果」，不返回看似完整的残缺摘要。
    let contents = fs::read_to_string(path).ok()?;
    parse_session_log(contents.lines())
}

/// 定位最近修改的匹配 rollout 文件；找不到返回 `None`。
fn locate_session_log(codex_home: &Path, provider_session_id: &str) -> Option<PathBuf> {
    if provider_session_id.is_empty() {
        return None;
    }

    let mut candidates = Vec::new();
    for root in collect_session_roots(codex_home) {
        collect_rollout_candidates(&root, &mut candidates);
    }

    // 同一 provider_session_id 只对应一个 rollout；多命中时以最近修改为准。
    candidates.retain(|candidate| {
        candidate
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|file_name| file_name.contains(provider_session_id))
    });
    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.modified_at));
    candidates
        .into_iter()
        .map(|candidate| candidate.path)
        .next()
}

fn parse_session_log<'a>(lines: impl Iterator<Item = &'a str>) -> Option<CodexSessionSummary> {
    let mut builder = SessionSummaryBuilder::default();
    for line in lines {
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            builder.ingest(&value);
        }
    }
    builder.finish()
}

#[derive(Default)]
struct SessionSummaryBuilder {
    turns: Vec<CodexSessionTurn>,
    index_by_turn_id: HashMap<String, usize>,
    token_usage: Option<SessionTokenUsage>,
}

impl SessionSummaryBuilder {
    fn ingest(&mut self, value: &Value) {
        if value.get("type").and_then(Value::as_str) != Some("event_msg") {
            return;
        }
        let Some(payload) = value.get("payload") else {
            return;
        };

        match payload.get("type").and_then(Value::as_str) {
            Some("item_completed") => self.ingest_item(payload),
            Some("task_complete") => self.ingest_task_complete(payload),
            Some("token_count") => self.ingest_token_count(payload),
            _ => {}
        }
    }

    fn ingest_item(&mut self, payload: &Value) {
        let Some(item) = payload.get("item") else {
            return;
        };
        // 实测 rollout 把 `turn_id` 放在 `payload` 上，`item` 内没有。
        let Some(turn_id) = payload.get("turn_id").and_then(Value::as_str) else {
            return;
        };

        let text = collect_text_content(item);
        if text.is_empty() {
            return;
        }

        match item.get("type").and_then(Value::as_str) {
            Some("UserMessage") => self.ensure_turn(turn_id).user_text = text,
            Some("AgentMessage") => self.ensure_turn(turn_id).final_assistant_text = Some(text),
            _ => {}
        }
    }

    fn ingest_task_complete(&mut self, payload: &Value) {
        let Some(turn_id) = payload.get("turn_id").and_then(Value::as_str) else {
            return;
        };

        let duration_ms = payload
            .get("duration_ms")
            .and_then(json_u64)
            .or_else(|| timestamp_duration_ms(payload));
        let last_agent_message = payload
            .get("last_agent_message")
            .and_then(Value::as_str)
            .filter(|message| !message.is_empty())
            .map(str::to_string);

        let turn = self.ensure_turn(turn_id);
        if duration_ms.is_some() {
            turn.duration_ms = duration_ms;
        }
        if turn.final_assistant_text.is_none() {
            turn.final_assistant_text = last_agent_message;
        }
    }

    fn ingest_token_count(&mut self, payload: &Value) {
        let Some(total_token_usage) = payload
            .get("info")
            .and_then(|info| info.get("total_token_usage"))
        else {
            return;
        };

        // `total_token_usage` 本身即累计快照，包成 `total` 复用既有归一化口径。
        if let Some(usage) = normalize_codex_token_usage(&json!({ "total": total_token_usage })) {
            self.token_usage = Some(usage);
        }
    }

    fn ensure_turn(&mut self, turn_id: &str) -> &mut CodexSessionTurn {
        let index = match self.index_by_turn_id.get(turn_id) {
            Some(index) => *index,
            None => {
                let index = self.turns.len();
                self.turns.push(CodexSessionTurn::default());
                self.index_by_turn_id.insert(turn_id.to_string(), index);
                index
            }
        };
        &mut self.turns[index]
    }

    fn finish(self) -> Option<CodexSessionSummary> {
        if self.turns.is_empty() && self.token_usage.is_none() {
            return None;
        }

        let processing_ms = self.turns.iter().filter_map(|turn| turn.duration_ms).sum();
        Some(CodexSessionSummary {
            turns: self.turns,
            token_usage: self.token_usage,
            processing_ms,
        })
    }
}

fn collect_text_content(item: &Value) -> String {
    let Some(content) = item.get("content").and_then(Value::as_array) else {
        return String::new();
    };

    content
        .iter()
        .filter(|entry| {
            entry
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind.eq_ignore_ascii_case("text"))
        })
        .filter_map(|entry| entry.get("text").and_then(Value::as_str))
        .collect()
}

fn timestamp_duration_ms(payload: &Value) -> Option<u64> {
    let started_at = payload.get("started_at").and_then(json_f64)?;
    let completed_at = payload.get("completed_at").and_then(json_f64)?;
    let seconds = completed_at - started_at;
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    Some((seconds * 1000.0).round() as u64)
}

fn json_u64(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => number.as_u64().or_else(|| {
            number.as_f64().and_then(|float| {
                if float.is_finite() && float >= 0.0 && float.fract() == 0.0 {
                    Some(float as u64)
                } else {
                    None
                }
            })
        }),
        _ => None,
    }
}

fn json_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        _ => None,
    }
}

#[cfg(test)]
#[path = "codex_session_log_tests.rs"]
mod tests;
