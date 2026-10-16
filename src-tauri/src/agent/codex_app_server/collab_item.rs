//! Codex `collabAgentToolCall` → 拉起记录。
//!
//! 任务描述取 `prompt`，子 thread id 取 `receiverThreadIds`。
//! app-server 用 camelCase；rollout item 用 snake_case。两套都认。

use serde_json::Value;

use crate::types::agent_session_stream::{AgentTimelineItem, ToolCallDetail, ToolCallStatus};

pub(super) fn map_collab_agent_tool_call(item: &Value) -> Option<AgentTimelineItem> {
    let call_id =
        text_field(item, &["id", "callId"]).unwrap_or_else(|| "collabAgentToolCall".to_string());
    let prompt = text_field(item, &["prompt"]);
    let receiver_thread_ids = receiver_thread_ids(item);
    // `wait` 结束时 receiver 和 prompt 都是空的，不是一次拉起。
    if prompt.is_none() && receiver_thread_ids.is_empty() {
        return None;
    }
    Some(AgentTimelineItem::ToolCall {
        call_id,
        name: "collabAgentToolCall".into(),
        detail: ToolCallDetail::CollabAgent {
            prompt,
            sender_thread_id: text_field(item, &["senderThreadId", "sender_thread_id"]),
            receiver_thread_ids,
        },
        status: ToolCallStatus::Completed,
        error: None,
        subagent_id: None,
    })
}

fn text_field(item: &Value, fields: &[&str]) -> Option<String> {
    fields.iter().find_map(|field| {
        let trimmed = item.get(*field).and_then(Value::as_str)?.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn receiver_thread_ids(item: &Value) -> Vec<String> {
    let Some(values) = item
        .get("receiverThreadIds")
        .or_else(|| item.get("receiver_thread_ids"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    for value in values {
        let Some(id) = value.as_str().map(str::trim).filter(|id| !id.is_empty()) else {
            continue;
        };
        if ids.iter().any(|existing: &String| existing == id) {
            continue;
        }
        ids.push(id.to_string());
    }
    ids
}
