//! DeepSeek ACP `session/update` → `AgentStreamEvent`。
//!
//! `agent_message_chunk` / `agent_thought_chunk` 是已提交块。同一 messageId
//! 的正文本拼成一条助手消息；思考单独成推理块。`tool_call` 打开通用工具卡，
//! `tool_call_update` 把它收成完成或失败。不解析 shell / edit。`usage_update`
//! 的 used/size 是上下文窗口占用，不产生用量事件。未知字段与未知 sessionUpdate 忽略。

use std::collections::HashMap;
use std::time::Instant;

use serde_json::Value;

use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentTimelineItem, ToolCallDetail, ToolCallStatus,
};

const METHOD_SESSION_UPDATE: &str = "session/update";

/// 一轮 prompt 的已提交块归一状态。
pub struct DeepSeekStreamMapper {
    turn_id: Option<String>,
    turn_open: bool,
    messages: HashMap<String, String>,
    thoughts: HashMap<String, String>,
    tools: HashMap<String, DeepSeekToolCard>,
    seq: u64,
    started_at: Option<Instant>,
}

/// 同一 toolCallId 的通用工具卡。参数与结果只保留可读文本。
struct DeepSeekToolCard {
    name: String,
    raw_input: Option<String>,
    raw_output: Option<String>,
    status: ToolCallStatus,
}

impl Default for DeepSeekStreamMapper {
    fn default() -> Self {
        Self::new()
    }
}

impl DeepSeekStreamMapper {
    pub fn new() -> Self {
        Self {
            turn_id: None,
            turn_open: false,
            messages: HashMap::new(),
            thoughts: HashMap::new(),
            tools: HashMap::new(),
            seq: 0,
            started_at: None,
        }
    }

    /// 接受 prompt：记下 turn，并给出轮次开始事件。
    pub fn begin_turn(&mut self, local_turn_id: String) -> AgentStreamEvent {
        self.turn_id = Some(local_turn_id.clone());
        self.turn_open = true;
        self.messages.clear();
        self.thoughts.clear();
        self.tools.clear();
        self.seq = 0;
        self.started_at = Some(Instant::now());
        AgentStreamEvent::TurnStarted {
            turn_id: Some(local_turn_id),
        }
    }

    pub fn is_turn_active(&self) -> bool {
        self.turn_open && self.turn_id.is_some()
    }

    pub fn current_turn_id(&self) -> Option<String> {
        self.turn_id.clone().filter(|_| self.turn_open)
    }

    pub fn on_notification(&mut self, method: &str, params: &Value) -> Vec<AgentStreamEvent> {
        if method != METHOD_SESSION_UPDATE {
            return Vec::new();
        }
        let update = params.get("update").unwrap_or(&Value::Null);
        match string_field(update, "sessionUpdate").as_deref() {
            Some("agent_message_chunk") => self.push_message(update),
            Some("agent_thought_chunk") => self.push_thought(update),
            Some("tool_call") => self.push_tool(update, true),
            Some("tool_call_update") => self.push_tool(update, false),
            _ => Vec::new(),
        }
    }

    /// prompt 正常返回：只结束发起该 prompt 的那一轮。
    /// 不从 used/size 或其它窗口占用写用量。
    pub fn on_prompt_result(&mut self, turn_id: &str, result: &Value) -> Vec<AgentStreamEvent> {
        if !self.owns_turn(turn_id) {
            return Vec::new();
        }
        self.turn_open = false;
        let stop_reason = result
            .get("stopReason")
            .and_then(Value::as_str)
            .map(str::to_string);
        if stop_reason.as_deref() == Some("cancelled") {
            return vec![AgentStreamEvent::TurnCanceled {
                turn_id: self.turn_id.clone(),
                reason: "cancelled".into(),
            }];
        }
        vec![AgentStreamEvent::TurnCompleted {
            turn_id: self.turn_id.clone(),
            usage: None,
            stop_reason,
            subtype: None,
        }]
    }

    pub fn on_prompt_error(&mut self, turn_id: &str, error: String) -> Vec<AgentStreamEvent> {
        if !self.owns_turn(turn_id) {
            return Vec::new();
        }
        self.turn_open = false;
        vec![AgentStreamEvent::TurnFailed {
            turn_id: self.turn_id.clone(),
            error,
            code: None,
        }]
    }

    fn push_message(&mut self, update: &Value) -> Vec<AgentStreamEvent> {
        let Some(text) = content_text(update) else {
            return Vec::new();
        };
        let id = chunk_id(update, "deepseek-msg");
        let merged = {
            let entry = self.messages.entry(id.clone()).or_default();
            entry.push_str(&text);
            entry.clone()
        };
        vec![self.timeline(AgentTimelineItem::AssistantMessage {
            text: (merged).into(),
            message_id: Some(id),
            subagent_id: None,
        })]
    }

    fn push_thought(&mut self, update: &Value) -> Vec<AgentStreamEvent> {
        let Some(text) = content_text(update) else {
            return Vec::new();
        };
        let id = chunk_id(update, "deepseek-thought");
        let merged = {
            let entry = self.thoughts.entry(id).or_default();
            entry.push_str(&text);
            entry.clone()
        };
        vec![self.timeline(AgentTimelineItem::Reasoning {
            text: (merged).into(),
            // 已提交块不是进行中的推理。duration 表示这块已经结束，避免前端停在「正在思考」。
            duration_ms: self.committed_thought_duration_ms(),
            subagent_id: None,
        })]
    }

    fn push_tool(&mut self, update: &Value, opening: bool) -> Vec<AgentStreamEvent> {
        let call_id = string_field(update, "toolCallId")
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| "tool".to_string());
        let mut card = self.tools.remove(&call_id).unwrap_or(DeepSeekToolCard {
            name: "tool".into(),
            raw_input: None,
            raw_output: None,
            status: ToolCallStatus::Running,
        });
        if let Some(title) = string_field(update, "title").filter(|title| !title.is_empty()) {
            card.name = title;
        }
        if let Some(raw_input) = raw_input_text(update) {
            card.raw_input = Some(raw_input);
        }
        if let Some(raw_output) = content_result_text(update) {
            card.raw_output = Some(raw_output);
        }
        card.status = tool_status(update, opening, card.status);
        let event = self.timeline(AgentTimelineItem::ToolCall {
            call_id: call_id.clone(),
            name: card.name.clone(),
            detail: ToolCallDetail::Unknown {
                raw_input: card.raw_input.clone(),
                raw_output: card.raw_output.clone(),
            },
            status: card.status,
            error: None,
            subagent_id: None,
        });
        self.tools.insert(call_id, card);
        vec![event]
    }

    fn owns_turn(&self, turn_id: &str) -> bool {
        self.turn_open && self.turn_id.as_deref() == Some(turn_id)
    }

    fn committed_thought_duration_ms(&self) -> Option<u64> {
        let started_at = self.started_at?;
        Some(
            u64::try_from(started_at.elapsed().as_millis())
                .unwrap_or(u64::MAX)
                .max(1),
        )
    }

    fn timeline(&mut self, item: AgentTimelineItem) -> AgentStreamEvent {
        let event = AgentStreamEvent::Timeline {
            item,
            turn_id: self.turn_id.clone(),
            seq: self.seq,
            timestamp: 0,
        };
        self.seq += 1;
        event
    }
}

fn chunk_id(update: &Value, fallback_prefix: &str) -> String {
    string_field(update, "messageId")
        .or_else(|| string_field(update, "message_id"))
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| fallback_prefix.to_string())
}

fn content_text(update: &Value) -> Option<String> {
    let content = update.get("content").unwrap_or(&Value::Null);
    if let Some(text) = content.as_str() {
        return non_empty(text);
    }
    if let Some(text) = content.get("text").and_then(Value::as_str) {
        return non_empty(text);
    }
    if let Some(blocks) = content.as_array() {
        let joined: String = blocks
            .iter()
            .filter_map(|block| {
                block
                    .get("text")
                    .and_then(Value::as_str)
                    .or_else(|| block.get("content")?.get("text")?.as_str())
            })
            .collect();
        return non_empty(&joined);
    }
    update
        .get("text")
        .and_then(Value::as_str)
        .and_then(non_empty)
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn non_empty(text: &str) -> Option<String> {
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

fn raw_input_text(update: &Value) -> Option<String> {
    let raw = update.get("rawInput")?;
    match raw {
        Value::Null => None,
        Value::String(text) => non_empty(text),
        other => serde_json::to_string(other)
            .ok()
            .as_deref()
            .and_then(non_empty),
    }
}

fn tool_status(update: &Value, opening: bool, previous: ToolCallStatus) -> ToolCallStatus {
    match update.get("status").and_then(Value::as_str) {
        Some("completed") => ToolCallStatus::Completed,
        Some("failed") => ToolCallStatus::Failed,
        Some("in_progress") | Some("pending") => ToolCallStatus::Running,
        _ if opening => ToolCallStatus::Running,
        _ => previous,
    }
}

fn content_result_text(update: &Value) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(content) = update.get("content") {
        collect_result_text(content, &mut parts);
    }
    non_empty(&parts.join(""))
}

fn collect_result_text(value: &Value, parts: &mut Vec<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_result_text(item, parts);
            }
        }
        Value::String(text) => parts.push(text.clone()),
        Value::Object(fields) => match fields.get("type").and_then(Value::as_str) {
            Some("diff") | Some("terminal") => {}
            Some("text") => {
                if let Some(text) = fields.get("text").and_then(Value::as_str) {
                    parts.push(text.to_string());
                }
            }
            _ => {
                if let Some(text) = fields.get("text").and_then(Value::as_str) {
                    parts.push(text.to_string());
                } else if let Some(inner) = fields.get("content") {
                    collect_result_text(inner, parts);
                }
            }
        },
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn committed_thought_is_finished_and_stale_prompt_does_not_end_the_next_turn() {
        let mut mapper = DeepSeekStreamMapper::new();
        let _ = mapper.begin_turn("turn-a".into());
        let thought = mapper.on_notification(
            "session/update",
            &json!({"update": {"sessionUpdate": "agent_thought_chunk", "messageId": "t1", "content": {"type": "text", "text": "先想清楚"}}}),
        );
        match &thought[0] {
            AgentStreamEvent::Timeline {
                item:
                    AgentTimelineItem::Reasoning {
                        text,
                        duration_ms: Some(duration),
                        subagent_id: _,
                    },
                ..
            } => {
                assert_eq!(text, "先想清楚");
                assert!(*duration >= 1);
            }
            other => panic!("expected committed reasoning, got {other:?}"),
        }

        let _ = mapper.begin_turn("turn-b".into());
        assert!(mapper
            .on_prompt_result("turn-a", &json!({"stopReason": "end_turn"}))
            .is_empty());
        assert!(mapper.is_turn_active());
        assert!(matches!(
            mapper.on_prompt_result("turn-b", &json!({"stopReason": "end_turn"}))[0],
            AgentStreamEvent::TurnCompleted { .. }
        ));
    }
}
