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
use std::collections::HashSet;
use std::sync::Arc;

use serde_json::Value;

use crate::agent::grok_streaming::tool_detail::{
    location_paths, map_grok_tool_detail, merge_tool_input, tool_name_from_update, tool_output_text,
};
use crate::agent::grok_streaming::usage::GrokUsageLedger;
use crate::types::agent_session_stream::{AgentStreamEvent, AgentTimelineItem, ToolCallStatus};

#[path = "event_mapper_subagent.rs"]
mod subagent;

pub const METHOD_SESSION_UPDATE: &str = "session/update";
pub const METHOD_SESSION_NOTIFICATION: &str = "_x.ai/session_notification";

/// 一轮 turn 的事件归一状态机。
pub(crate) struct GrokStreamMapper {
    pub(super) turn_id: Option<String>,
    turn_started: bool,
    turn_finalized: bool,
    /// `session/prompt` 已经收尾后，Grok 仍可能换 `promptId` 继续吐正文。
    /// 冻结 id，避免同一段正文被拆成第二条消息。
    turn_id_frozen: bool,
    /// 收尾之后又收到产出。随后的 `turn_completed` / `response_completed`
    /// 必须再补一次 `TurnCompleted`，否则运行态不再收回，前端停在「正在思考」。
    /// 用户取消后保持 false：迟到产出不得把已取消的 turn 重新打开。
    follow_up_open: bool,
    /// 用户已点终止。与 prompt 正常返回不同，之后的工具 / 正文 / 推理都丢弃。
    user_canceled: bool,
    /// 当前完整正文。与刚发出的事件共享同一份 `Arc`，下一帧追加前才复制。
    pub(super) assistant_text: Arc<str>,
    pub(super) reasoning_text: Arc<str>,
    /// 子会话正文 / 推理按 `child_session_id` 分开累积，避免并进父缓冲。
    child_assistant_text: HashMap<String, Arc<str>>,
    child_reasoning_text: HashMap<String, Arc<str>>,
    message_index: usize,
    /// 每个 toolCallId 跨更新累积的状态（工具名 + 最近一次完整入参 / locations）。
    tool_calls: HashMap<String, ToolCallState>,
    pub(super) child_session_ids: HashSet<String>,
    usage_ledger: GrokUsageLedger,
}

/// 同一 toolCallId 跨更新的累积状态。
///
/// 真实报文里首个 `tool_call` 帧带完整 `rawInput`，进行中的 `tool_call_update`
/// 带 `rawInput.variant` / `locations`，而完成帧（`status:"completed"`）只带
/// `content` / `rawOutput`、**不再携带** `rawInput` / `locations`（见
/// `docs/survey/grok-build-cli-probe-notes.md` §3.5）。若每帧只按当前 update
/// 现算详情，完成帧会退化成空壳（丢 path、未知工具丢 rawInput），故在此按
/// call id 累积入参（对多次 `rawInput` 做浅合并）与 locations，供后续帧复用。
/// 完整输出只放进刚发出的事件，这里不另留一份。
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
            turn_id_frozen: false,
            follow_up_open: false,
            user_canceled: false,
            assistant_text: Arc::from(""),
            reasoning_text: Arc::from(""),
            child_assistant_text: HashMap::new(),
            child_reasoning_text: HashMap::new(),
            message_index: 0,
            tool_calls: HashMap::new(),
            child_session_ids: subagent::new_child_ids(),
            usage_ledger: GrokUsageLedger::default(),
        }
    }

    /// 开始新一轮（`session/prompt` 已发出）；`local_turn_id` 在服务端 `promptId`
    /// 到达前作为兜底 turn id。
    pub fn begin_turn(&mut self, local_turn_id: String) {
        self.turn_id = Some(local_turn_id);
        self.turn_started = false;
        self.turn_finalized = false;
        self.turn_id_frozen = false;
        self.follow_up_open = false;
        self.user_canceled = false;
        self.assistant_text = Arc::from("");
        self.reasoning_text = Arc::from("");
        self.child_assistant_text.clear();
        self.child_reasoning_text.clear();
        self.message_index = 0;
        self.tool_calls.clear();
    }

    /// 是否有一轮正在运行（用于判断取消是否可中断）。
    pub fn is_turn_active(&self) -> bool {
        !self.turn_finalized && self.turn_id.is_some()
    }

    /// 归一一条服务端通知。
    pub fn on_notification(&mut self, method: &str, params: &Value) -> Vec<AgentStreamEvent> {
        self.note_subagent_spawned(params);
        // 子会话和父会话共用这一条 stdio。正文 / 工具必须进时间线并挂上
        // `subagent_id`，但不能写进父助手缓冲，也不能重开父 turn。
        let child_session_id = self.child_session_id(params);
        if child_session_id.is_some() {
            return self.map_child_notification(method, params, child_session_id);
        }
        let mut events = Vec::new();
        if let Some(event) = self.ensure_turn_started(params) {
            events.push(event);
        }
        match method {
            METHOD_SESSION_UPDATE => self.map_session_update(params, &mut events, None),
            METHOD_SESSION_NOTIFICATION | "_x.ai/session/update" => {
                self.map_session_notification(params, &mut events)
            }
            _ => {}
        }
        if let Some(event) = self.subagent_lifecycle_event(params) {
            events.push(event);
        }
        events
    }

    pub fn on_prompt_result(&mut self, result: &Value) -> Vec<AgentStreamEvent> {
        let mut events = Vec::new();
        if let Some(event) = self.ensure_turn_started(&Value::Null) {
            events.push(event);
        }
        if self.turn_finalized {
            return events;
        }
        let usage = self.usage_ledger.absorb_prompt_result(result);
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
        self.close_turn();
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
        self.close_turn();
        events
    }

    /// 用户取消：直接收尾为 `TurnCanceled`，并拒绝之后的续写重开。
    pub fn on_cancel(&mut self) -> AgentStreamEvent {
        self.user_canceled = true;
        self.close_turn();
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
        self.close_turn();
        Some(AgentStreamEvent::TurnFailed {
            turn_id: self.turn_id.clone(),
            error,
            code: None,
        })
    }

    fn ensure_turn_started(&mut self, params: &Value) -> Option<AgentStreamEvent> {
        self.adopt_turn_id(params);
        if self.turn_finalized || self.turn_started {
            return None;
        }
        self.turn_id.as_ref()?;
        self.turn_started = true;
        Some(AgentStreamEvent::TurnStarted {
            turn_id: self.turn_id.clone(),
        })
    }

    /// 收尾后不再接受新的服务端 `promptId`。续写帧仍挂在原来的 turn 上。
    fn adopt_turn_id(&mut self, params: &Value) {
        if self.turn_id_frozen {
            return;
        }
        if let Some(prompt_id) = turn_id_from_params(params) {
            self.turn_id = Some(prompt_id);
        }
    }

    fn close_turn(&mut self) {
        self.turn_finalized = true;
        self.turn_id_frozen = true;
        self.follow_up_open = false;
    }

    /// prompt 正常返回后又有正文 / 推理 / 工具，说明这轮还没真正停。
    /// 用户取消是终态：迟到产出保持关闭，不再重开 turn。
    fn note_output_while_closed(&mut self) -> bool {
        if self.user_canceled {
            return false;
        }
        if !self.turn_finalized {
            return true;
        }
        self.turn_finalized = false;
        self.follow_up_open = true;
        true
    }

    pub(super) fn map_session_update(
        &mut self,
        params: &Value,
        events: &mut Vec<AgentStreamEvent>,
        subagent_id: Option<String>,
    ) {
        let update = params.get("update").unwrap_or(&Value::Null);
        match string_field(update, "sessionUpdate").as_deref() {
            Some("agent_message_chunk") => {
                if let Some(delta) = content_text(update) {
                    if subagent_id.is_none() && !self.note_output_while_closed() {
                        return;
                    }
                    let text = self.append_assistant_text(subagent_id.as_deref(), &delta);
                    let message_id = match subagent_id.as_deref() {
                        Some(child_session_id) => format!("grok-msg-{child_session_id}"),
                        None => format!("grok-msg-{}", self.turn_id.as_deref().unwrap_or("turn")),
                    };
                    events.push(self.timeline(AgentTimelineItem::AssistantMessage {
                        text: text.into(),
                        message_id: Some(message_id),
                        subagent_id,
                    }));
                }
            }
            Some("agent_thought_chunk") => {
                if let Some(delta) = content_text(update) {
                    if subagent_id.is_none() && !self.note_output_while_closed() {
                        return;
                    }
                    let text = self.append_reasoning_text(subagent_id.as_deref(), &delta);
                    events.push(self.timeline(AgentTimelineItem::Reasoning {
                        text: text.into(),
                        duration_ms: None,
                        subagent_id,
                    }));
                }
            }
            Some("tool_call") | Some("tool_call_update") => {
                if let Some(event) = self.map_tool_call(update, subagent_id.clone()) {
                    events.push(event);
                }
            }
            // available_commands_update / session_info_update / 其它：无对应位，幂等忽略。
            _ => {}
        }
    }

    pub(super) fn map_session_notification(
        &mut self,
        params: &Value,
        events: &mut Vec<AgentStreamEvent>,
    ) {
        let update = params.get("update").unwrap_or(&Value::Null);
        match string_field(update, "sessionUpdate").as_deref() {
            Some("turn_completed") | Some("response_completed") => {
                let usage = self.usage_ledger.absorb_notification(update);
                if let Some(usage) = usage.clone() {
                    events.push(AgentStreamEvent::UsageUpdated { usage });
                }
                // 进行中的 turn 仍以 `session/prompt` 结果为权威收尾。只有 prompt
                // 已经返回、之后又有续写时，这条通知才是续写的结束信号。
                if self.follow_up_open {
                    events.push(AgentStreamEvent::TurnCompleted {
                        turn_id: self.turn_id.clone(),
                        usage,
                        stop_reason: None,
                        subtype: None,
                    });
                    self.close_turn();
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

    fn map_tool_call(
        &mut self,
        update: &Value,
        subagent_id: Option<String>,
    ) -> Option<AgentStreamEvent> {
        let call_id = string_field(update, "toolCallId")?;
        if subagent_id.is_none() && !self.note_output_while_closed() {
            return None;
        }
        // 入参和 locations 只留在 state，供完成帧复用。这里按引用读取，
        // 不再为本次事件额外克隆一份 Value。完整输出不进 state。
        let output = tool_output_text(update);
        let status = tool_status(update.get("status").and_then(Value::as_str));
        let failed = status == ToolCallStatus::Failed;
        let (detail, display_name) = {
            let state = self.tool_calls.entry(call_id.clone()).or_default();
            if state.name.is_none() {
                state.name = non_empty(&tool_name_from_update(update))
                    .or_else(|| string_field(update, "kind"));
            }
            if let Some(input) = update.get("rawInput").filter(|value| !value.is_null()) {
                state.raw_input = merge_tool_input(&state.raw_input, input);
            }
            let incoming_locations = location_paths(update);
            if !incoming_locations.is_empty() {
                state.locations = incoming_locations;
            }
            let tool_name = state.name.clone().unwrap_or_default();
            map_grok_tool_detail(
                &tool_name,
                &state.raw_input,
                (!failed).then_some(output.as_deref()).flatten(),
                &state.locations,
            )
        };
        let error = failed.then_some(output).flatten();
        self.message_index = self.message_index.saturating_add(1);
        Some(self.timeline(AgentTimelineItem::ToolCall {
            call_id,
            name: display_name,
            detail,
            status,
            error,
            subagent_id,
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
pub(crate) fn turn_id_from_params(params: &Value) -> Option<String> {
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
pub(crate) fn content_text(update: &Value) -> Option<String> {
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
#[path = "event_mapper_follow_up_tests.rs"]
mod follow_up_tests;

#[cfg(test)]
#[path = "event_mapper_cancel_tests.rs"]
mod cancel_tests;

#[cfg(test)]
#[path = "tool_lifecycle_tests.rs"]
mod tool_lifecycle_tests;

#[cfg(test)]
#[path = "event_mapper_subagent_tests.rs"]
mod subagent_tests;
