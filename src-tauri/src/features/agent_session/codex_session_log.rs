//! Codex session log 读取与规范化（纯逻辑单元）。
//!
//! 给定 `CODEX_HOME` 与某个会话的 `provider_session_id`（或直接文件路径），
//! 定位本机 rollout（`sessions/**/rollout-*.jsonl`，兼容 `profiles/*/sessions/**`）
//! 并解析出规范化摘要：按顺序的 turn 列表、线程累计 Token 用量、累计处理时长。
//!
//! 模块零 DB / 运行时依赖；解析失败、文件缺失、空文件、非 JSON 行均返回 `None`
//! 或跳过对应行，不 panic、不报错中断。

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
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
    /// 已完成 turn 的 `duration_ms` 之和。进行中 turn 不计入这份快照。
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
    builder.ingest_lines(lines);
    builder.finish()
}

/// Codex session log 增量读取器：按字节偏移只消费新增的完整行，累计摘要。
///
/// 供运行期后台心跳复用同一套定位与解析：定位失败、IO / 编码错误一律静默跳过，
/// 不 panic。进程重启后从零重读一次即可——累计值可幂等重建。
#[derive(Default)]
pub(crate) struct CodexSessionLogTail {
    path: Option<PathBuf>,
    offset: u64,
    builder: SessionSummaryBuilder,
}

impl CodexSessionLogTail {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// 定位（首次或文件丢失后）并追加读取尚未消费的完整行。
    pub(crate) fn poll(&mut self, codex_home: &Path, provider_session_id: &str) {
        if self.path.is_none() {
            self.path = locate_session_log(codex_home, provider_session_id);
        }
        let Some(path) = self.path.clone() else {
            return;
        };

        let Ok(mut file) = File::open(&path) else {
            // 文件被移动 / 删除：下个 tick 重新定位。
            self.path = None;
            return;
        };
        let Ok(length) = file.metadata().map(|metadata| metadata.len()) else {
            return;
        };
        // 文件被截断 / 轮转：偏移与已累计值都作废，从头重建（累计可幂等重建）。
        if length < self.offset {
            self.offset = 0;
            self.builder = SessionSummaryBuilder::default();
        }
        if length == self.offset {
            return;
        }
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return;
        }
        let mut buffer = Vec::new();
        if file.read_to_end(&mut buffer).is_err() {
            return;
        }
        // 只消费到最后一个换行：末尾不完整行留待下个 tick 补齐后再解析。
        let Some(last_newline) = buffer.iter().rposition(|byte| *byte == b'\n') else {
            return;
        };
        let consumed = last_newline + 1;
        if let Ok(text) = std::str::from_utf8(&buffer[..consumed]) {
            self.builder.ingest_lines(text.lines());
        }
        self.offset += consumed as u64;
    }

    /// 当前线程累计 Token 用量（最后一次 `token_count` 快照）。
    pub(crate) fn token_usage(&self) -> Option<SessionTokenUsage> {
        self.builder.token_usage
    }

    /// 当前累计执行时长：已完成 turn 的 `duration_ms` 之和，加上进行中 turn
    /// 自 `task_started.started_at` 到现在的墙钟。没有进行中 turn 时与已完成之和相同。
    pub(crate) fn processing_ms(&self) -> u64 {
        self.builder.processing_ms_at(unix_now_ms())
    }
}

struct OpenTurn {
    turn_id: String,
    started_at_ms: u64,
}

#[derive(Default)]
struct SessionSummaryBuilder {
    turns: Vec<CodexSessionTurn>,
    index_by_turn_id: HashMap<String, usize>,
    token_usage: Option<SessionTokenUsage>,
    /// 已见到 `task_started`、尚未被带时长的 `task_complete` 封口的 turn。
    open_turn: Option<OpenTurn>,
}

impl SessionSummaryBuilder {
    fn ingest_lines<'a>(&mut self, lines: impl Iterator<Item = &'a str>) {
        for line in lines {
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                self.ingest(&value);
            }
        }
    }

    fn ingest(&mut self, value: &Value) {
        if value.get("type").and_then(Value::as_str) != Some("event_msg") {
            return;
        }
        let Some(payload) = value.get("payload") else {
            return;
        };

        match payload.get("type").and_then(Value::as_str) {
            Some("item_completed") => self.ingest_item(payload),
            Some("task_started") => self.ingest_task_started(payload),
            Some("task_complete") => self.ingest_task_complete(payload),
            Some("token_count") => self.ingest_token_count(payload),
            _ => {}
        }
    }

    fn ingest_task_started(&mut self, payload: &Value) {
        let Some(turn_id) = payload.get("turn_id").and_then(Value::as_str) else {
            return;
        };
        let Some(started_at_ms) = payload.get("started_at").and_then(unix_timestamp_ms) else {
            return;
        };
        // 同一 turn 的重复 task_started 不重置起点，避免进行中时长回跳。
        if self
            .open_turn
            .as_ref()
            .is_some_and(|open| open.turn_id == turn_id)
        {
            return;
        }
        // 上一个 turn 没有 task_complete 就被新 turn 取代时，用新起点封口。
        if let Some(previous) = self.open_turn.take() {
            let elapsed = started_at_ms.saturating_sub(previous.started_at_ms);
            let turn = self.ensure_turn(&previous.turn_id);
            if turn.duration_ms.is_none() {
                turn.duration_ms = Some(elapsed);
            }
        }
        self.open_turn = Some(OpenTurn {
            turn_id: turn_id.to_string(),
            started_at_ms,
        });
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

        if duration_ms.is_some()
            && self
                .open_turn
                .as_ref()
                .is_some_and(|open| open.turn_id == turn_id)
        {
            self.open_turn = None;
        }
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

        let processing_ms = self.processing_ms();
        Some(CodexSessionSummary {
            turns: self.turns,
            token_usage: self.token_usage,
            processing_ms,
        })
    }

    fn processing_ms(&self) -> u64 {
        self.completed_processing_ms()
    }

    fn completed_processing_ms(&self) -> u64 {
        self.turns.iter().filter_map(|turn| turn.duration_ms).sum()
    }

    /// 已完成时长，加上进行中 turn 到 `now_ms` 的墙钟。turn 之间的等待不计入。
    fn processing_ms_at(&self, now_ms: u64) -> u64 {
        let open_elapsed_ms = self
            .open_turn
            .as_ref()
            .map(|open| now_ms.saturating_sub(open.started_at_ms))
            .unwrap_or(0);
        self.completed_processing_ms()
            .saturating_add(open_elapsed_ms)
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

fn unix_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// Codex rollout 的 `started_at` / `completed_at` 是 unix 秒。大于等于 1e12 视为毫秒。
fn unix_timestamp_ms(value: &Value) -> Option<u64> {
    let raw = json_f64(value)?;
    if !raw.is_finite() || raw < 0.0 {
        return None;
    }
    if raw >= 1_000_000_000_000.0 {
        return Some(raw.round() as u64);
    }
    Some((raw * 1000.0).round() as u64)
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
