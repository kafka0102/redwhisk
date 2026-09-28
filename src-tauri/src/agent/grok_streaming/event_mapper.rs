//! Grok ACP 通知 → `AgentStreamEvent` 归一（无 IO，可单测）。
//!
//! `GrokStreamMapper` 持有一轮 turn 的增量累积缓冲（ACP chunk 是差分），
//! 因此对外的 `AgentStreamEvent` 与前端 reducer 的合并语义对齐：
//! - `agent_message_chunk` → 累积后按稳定 `message_id` upsert 的 `AssistantMessage`；
//! - `agent_thought_chunk` → 累积后的 `Reasoning`（无 id，前端合并到上一条推理）；
//! - `tool_call` / `tool_call_update` → `ToolCall`（Pending → running → completed/failed）；
//! - 无对应位的事件（`available_commands_update` 重复推送、MCP / setup 进度、
//!   `tool_call_delta_chunk`、`pending_interaction` 等）既不新增事件类型，也不误发为 turn 事件。

use std::collections::HashMap;

use serde_json::Value;

use crate::agent::grok_streaming::tool_detail::{
    map_grok_tool_detail, tool_name_from_update, tool_output_text,
};
use crate::agent::grok_streaming::usage;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentTimelineItem, ToolCallStatus,
};

pub const METHOD_SESSION_UPDATE: &str = "session/update";
pub const METHOD_SESSION_NOTIFICATION: &str = "_x.ai/session_notification";

/// 一轮 turn 的事件归一状态机。
pub struct GrokStreamMapper {
    turn_id: Option<String>,
    turn_started: bool,
    turn_finalized: bool,
    assistant_text: String,
    reasoning_text: String,
    message_index: usize,
    /// 每个 toolCallId 首帧（`tool_call`）登记的工具名；后续 `tool_call_update`
    /// 只带 kind/title，用它保持同一工具名。
    tool_names: HashMap<String, String>,
}

impl Default for GrokStreamMapper {
    fn default() -> Self {
        Self::new()
    }
}

impl GrokStreamMapper {
    /// 创建一个空闲（无进行中 turn）的归一器。
    pub fn new() -> Self {
        Self {
            turn_id: None,
            turn_started: false,
            turn_finalized: true,
            assistant_text: String::new(),
            reasoning_text: String::new(),
            message_index: 0,
            tool_names: HashMap::new(),
        }
    }

    /// 开始新一轮（`session/prompt` 已发出）；`local_turn_id` 在服务端 `promptId`
    /// 到达前作为兜底 turn id。
    pub fn begin_turn(&mut self, local_turn_id: String) {
        self.turn_id = Some(local_turn_id);
        self.turn_started = false;
        self.turn_finalized = false;
        self.assistant_text.clear();
        self.reasoning_text.clear();
        self.message_index = 0;
        self.tool_names.clear();
    }

    /// 当前 turn id（服务端 `promptId` 优先，否则本地兜底 id）。
    pub fn turn_id(&self) -> Option<String> {
        self.turn_id.clone()
    }

    /// 是否有一轮正在运行（用于判断取消是否可中断）。
    pub fn is_turn_active(&self) -> bool {
        !self.turn_finalized && self.turn_id.is_some()
    }

    /// 归一一条服务端通知。
    pub fn on_notification(&mut self, method: &str, params: &Value) -> Vec<AgentStreamEvent> {
        let mut events = Vec::new();
        if let Some(event) = self.ensure_turn_started(params) {
            events.push(event);
        }
        match method {
            METHOD_SESSION_UPDATE => self.map_session_update(params, &mut events),
            METHOD_SESSION_NOTIFICATION => self.map_session_notification(params, &mut events),
            _ => {}
        }
        events
    }

    /// `session/prompt` 正常返回：收尾 turn 并带上用量与 stopReason。
    pub fn on_prompt_result(&mut self, result: &Value) -> Vec<AgentStreamEvent> {
        let mut events = Vec::new();
        if let Some(event) = self.ensure_turn_started(&Value::Null) {
            events.push(event);
        }
        if self.turn_finalized {
            return events;
        }
        let usage = result.get("_meta").and_then(usage::agent_usage_from_meta);
        let stop_reason = result
            .get("stopReason")
            .and_then(Value::as_str)
            .map(str::to_string);
        events.push(AgentStreamEvent::TurnCompleted {
            turn_id: self.turn_id.clone(),
            usage,
            stop_reason,
            subtype: None,
        });
        self.turn_finalized = true;
        events
    }

    /// `session/prompt` 返回错误：turn 失败收尾。
    pub fn on_prompt_error(&mut self, error: String) -> Vec<AgentStreamEvent> {
        let mut events = Vec::new();
        if let Some(event) = self.ensure_turn_started(&Value::Null) {
            events.push(event);
        }
        events.push(AgentStreamEvent::TurnFailed {
            turn_id: self.turn_id.clone(),
            error,
            code: None,
        });
        self.turn_finalized = true;
        events
    }

    /// 用户取消：直接收尾为 `TurnCanceled`。
    pub fn on_cancel(&mut self) -> AgentStreamEvent {
        self.turn_finalized = true;
        AgentStreamEvent::TurnCanceled {
            turn_id: self.turn_id.clone(),
            reason: "user_canceled".into(),
        }
    }

    /// 子进程异常退出：若 turn 未收尾则失败收口。
    pub fn on_process_exit(&mut self, error: String) -> Option<AgentStreamEvent> {
        if self.turn_finalized {
            return None;
        }
        self.turn_finalized = true;
        Some(AgentStreamEvent::TurnFailed {
            turn_id: self.turn_id.clone(),
            error,
            code: None,
        })
    }

    fn ensure_turn_started(&mut self, params: &Value) -> Option<AgentStreamEvent> {
        if let Some(prompt_id) = turn_id_from_params(params) {
            self.turn_id = Some(prompt_id);
        }
        if self.turn_finalized || self.turn_started {
            return None;
        }
        self.turn_id.as_ref()?;
        self.turn_started = true;
        Some(AgentStreamEvent::TurnStarted {
            turn_id: self.turn_id.clone(),
        })
    }

    fn map_session_update(&mut self, params: &Value, events: &mut Vec<AgentStreamEvent>) {
        let update = params.get("update").unwrap_or(&Value::Null);
        match string_field(update, "sessionUpdate").as_deref() {
            Some("agent_message_chunk") => {
                if let Some(delta) = content_text(update) {
                    self.assistant_text.push_str(&delta);
                    let message_id = format!(
                        "grok-msg-{}",
                        self.turn_id.as_deref().unwrap_or("turn")
                    );
                    events.push(self.timeline(AgentTimelineItem::AssistantMessage {
                        text: self.assistant_text.clone(),
                        message_id: Some(message_id),
                    }));
                }
            }
            Some("agent_thought_chunk") => {
                if let Some(delta) = content_text(update) {
                    self.reasoning_text.push_str(&delta);
                    events.push(self.timeline(AgentTimelineItem::Reasoning {
                        text: self.reasoning_text.clone(),
                        duration_ms: None,
                    }));
                }
            }
            Some("tool_call") | Some("tool_call_update") => {
                if let Some(event) = self.map_tool_call(update) {
                    events.push(event);
                }
            }
            // available_commands_update / session_info_update / 其它：无对应位，幂等忽略。
            _ => {}
        }
    }

    fn map_session_notification(&mut self, params: &Value, events: &mut Vec<AgentStreamEvent>) {
        let update = params.get("update").unwrap_or(&Value::Null);
        match string_field(update, "sessionUpdate").as_deref() {
            Some("turn_completed") | Some("response_completed") => {
                if let Some(usage) = usage::agent_usage_from_meta(update) {
                    events.push(AgentStreamEvent::UsageUpdated { usage });
                }
            }
            // tool_call_delta_chunk / pending_interaction / interaction_resolved /
            // hook_* / subagent_* / plan_* 等：仅内部状态，不映射为 turn 事件。
            _ => {}
        }
    }

    fn map_tool_call(&mut self, update: &Value) -> Option<AgentStreamEvent> {
        let call_id = string_field(update, "toolCallId")?;
        let tool_name = self
            .tool_names
            .get(&call_id)
            .cloned()
            .or_else(|| non_empty(&tool_name_from_update(update)))
            .or_else(|| string_field(update, "kind"))
            .unwrap_or_default();
        if !tool_name.is_empty() {
            self.tool_names.insert(call_id.clone(), tool_name.clone());
        }
        let input = update.get("rawInput").cloned().unwrap_or(Value::Null);
        let locations = location_paths(update);
        let output = tool_output_text(update);
        let status = tool_status(update.get("status").and_then(Value::as_str));
        let (detail, display_name) =
            map_grok_tool_detail(&tool_name, &input, output.as_deref(), &locations);
        let error = if status == ToolCallStatus::Failed {
            output.clone()
        } else {
            None
        };
        self.message_index = self.message_index.saturating_add(1);
        Some(self.timeline(AgentTimelineItem::ToolCall {
            call_id,
            name: display_name,
            detail,
            status,
            error,
        }))
    }

    fn timeline(&self, item: AgentTimelineItem) -> AgentStreamEvent {
        AgentStreamEvent::Timeline {
            item,
            turn_id: self.turn_id.clone(),
            seq: 0,
            timestamp: 0,
        }
    }
}

/// 从通知 params 解析服务端 prompt id（`_meta.promptId` 优先，其次队列 `runningPromptId`）。
pub fn turn_id_from_params(params: &Value) -> Option<String> {
    params
        .get("_meta")
        .and_then(|meta| meta.get("promptId"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            params
                .get("runningPromptId")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
        })
        .map(str::to_string)
}

/// ACP chunk 的文本载荷（`content.text` 为主，兼容字符串 / 数组 / 直接 `text`）。
pub fn content_text(update: &Value) -> Option<String> {
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
                    .or_else(|| block.get("content").and_then(|c| c.get("text")).and_then(Value::as_str))
            })
            .collect();
        return non_empty(&joined);
    }
    update
        .get("text")
        .and_then(Value::as_str)
        .and_then(non_empty)
}

fn tool_status(status: Option<&str>) -> ToolCallStatus {
    match status {
        Some("completed") => ToolCallStatus::Completed,
        Some("failed") | Some("error") => ToolCallStatus::Failed,
        Some("cancelled") | Some("canceled") => ToolCallStatus::Canceled,
        // tool_call（Pending）与 tool_call_update（in_progress）都视为运行中。
        _ => ToolCallStatus::Running,
    }
}

fn location_paths(update: &Value) -> Vec<String> {
    update
        .get("locations")
        .and_then(Value::as_array)
        .map(|locations| {
            locations
                .iter()
                .filter_map(|location| {
                    location
                        .get("path")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default()
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

#[cfg(test)]
#[path = "event_mapper_tests.rs"]
mod tests;
