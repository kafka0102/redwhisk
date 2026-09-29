//! Grok ACP 通知 → `AgentStreamEvent` 归一（无 IO，可单测）。
//!
//! `GrokStreamMapper` 持有一轮 turn 的增量累积缓冲（ACP chunk 是差分），
//! 因此对外的 `AgentStreamEvent` 与前端 reducer 的合并语义对齐：
//! - `agent_message_chunk` → 累积后按稳定 `message_id` upsert 的 `AssistantMessage`；
//! - `agent_thought_chunk` → 累积后的 `Reasoning`（无 id，前端合并到上一条推理）；
//! - `tool_call` / `tool_call_update` → `ToolCall`（Pending → running → completed/failed）；
//! - 无对应位的事件（`available_commands_update` 重复推送、MCP / setup 进度、
//!   `tool_call_delta_chunk`、`pending_interaction` 等）既不新增事件类型，也不误发为 turn 事件。
//!
//! **`tool_call_delta_chunk` 裁决**：实测首个 `tool_call` 事件已携带完整 `rawInput`，
//! 且该增量帧的 `arguments_delta` 为空串（无信息增量），故**不累积增量**——只按
//! call id 累积完整入参（对多次 `rawInput` 做浅合并）与 `locations`（见
//! `ToolCallState`）。裁决依据见
//! `docs/survey/grok-build-cli-probe-notes.md` §3.5 与 ADR-0047「工具参数增量裁决」。

use std::collections::HashMap;

use serde_json::Value;

use crate::agent::grok_streaming::tool_detail::{
    map_grok_tool_detail, tool_name_from_update, tool_output_text,
};
use crate::agent::grok_streaming::usage;
use crate::types::agent_session_stream::{AgentStreamEvent, AgentTimelineItem, ToolCallStatus};

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
    /// 每个 toolCallId 跨更新累积的状态（工具名 + 最近一次完整入参 / locations）。
    tool_calls: HashMap<String, ToolCallState>,
}

/// 同一 toolCallId 跨更新的累积状态。
///
/// 真实报文里首个 `tool_call` 帧带完整 `rawInput`，进行中的 `tool_call_update`
/// 带 `rawInput.variant` / `locations`，而完成帧（`status:"completed"`）只带
/// `content` / `rawOutput`、**不再携带** `rawInput` / `locations`（见
/// `docs/survey/grok-build-cli-probe-notes.md` §3.5）。若每帧只按当前 update
/// 现算详情，完成帧会退化成空壳（丢 path、未知工具丢 rawInput），故在此按
/// call id 累积入参（对多次 `rawInput` 做浅合并）与 locations，供后续帧复用。
#[derive(Default)]
struct ToolCallState {
    name: Option<String>,
    raw_input: Value,
    locations: Vec<String>,
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
            tool_calls: HashMap::new(),
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
        self.tool_calls.clear();
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
        // 幂等：取消 / 进程退出 / 已收尾后再到达的错误不重复收尾。
        if self.turn_finalized {
            return events;
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
                    let message_id =
                        format!("grok-msg-{}", self.turn_id.as_deref().unwrap_or("turn"));
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
            // `tool_call_delta_chunk`（工具参数增量）**有意忽略、不累积**：实测
            // `arguments_delta` 为空串，首个 `tool_call` 已带完整 rawInput，没有信息增量
            // （裁决见模块文档与 ADR-0047「工具参数增量裁决」）。
            // pending_interaction / interaction_resolved / hook_* / subagent_* / plan_*
            // 等同为仅内部状态，不映射为 turn 事件。
            _ => {}
        }
    }

    fn map_tool_call(&mut self, update: &Value) -> Option<AgentStreamEvent> {
        let call_id = string_field(update, "toolCallId")?;
        let incoming_input = update
            .get("rawInput")
            .filter(|value| !value.is_null())
            .cloned();
        let incoming_locations = location_paths(update);
        let (tool_name, input, locations) = {
            let state = self.tool_calls.entry(call_id.clone()).or_default();
            if state.name.is_none() {
                state.name = non_empty(&tool_name_from_update(update))
                    .or_else(|| string_field(update, "kind"));
            }
            if let Some(input) = incoming_input {
                state.raw_input = merge_tool_input(&state.raw_input, &input);
            }
            if !incoming_locations.is_empty() {
                state.locations = incoming_locations;
            }
            (
                state.name.clone().unwrap_or_default(),
                state.raw_input.clone(),
                state.locations.clone(),
            )
        };
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
                block.get("text").and_then(Value::as_str).or_else(|| {
                    block
                        .get("content")
                        .and_then(|c| c.get("text"))
                        .and_then(Value::as_str)
                })
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

/// 合并同一 toolCallId 的两次 `rawInput`。真实报文里首个 `tool_call` 给完整入参，
/// 后续 `tool_call_update` 可能只带 `variant` 等子集；整段覆盖会丢字段，故对 JSON
/// 对象做浅合并（同名字段以新值为准），非对象入参直接取新值。
fn merge_tool_input(existing: &Value, incoming: &Value) -> Value {
    match (existing, incoming) {
        (Value::Object(previous), Value::Object(next)) => {
            let mut merged = previous.clone();
            for (key, value) in next {
                merged.insert(key.clone(), value.clone());
            }
            Value::Object(merged)
        }
        (_, incoming) => incoming.clone(),
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

#[cfg(test)]
#[path = "tool_lifecycle_tests.rs"]
mod tool_lifecycle_tests;
