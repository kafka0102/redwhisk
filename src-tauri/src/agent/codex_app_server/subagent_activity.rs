//! Codex `SubAgentActivity`：父 thread 上的子智能体启动 / 结束。
//!
//! 新版 app-server 不再把任务描述和子 thread id 放进 `collabAgentToolCall`，
//! 而是另发 `SubAgentActivity`（kind = started / completed / interacted）。
//! `interrupted` 与 completed 一样收口这一路，只是拉起记录记为取消。
//! 拉起记录属于主智能体；花名册按 `agent_thread_id` 记这一路是否还在跑。

use serde_json::Value;

use crate::types::agent_session_stream::{AgentTimelineItem, ToolCallDetail, ToolCallStatus};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SubagentActivity {
    pub call_id: String,
    pub kind: SubagentActivityKind,
    pub agent_thread_id: String,
    pub agent_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SubagentActivityKind {
    Started,
    Completed,
    Interacted,
    Interrupted,
}

pub(super) fn parse_subagent_activity(item: &Value) -> Option<SubagentActivity> {
    let raw_type = item.get("type").and_then(Value::as_str)?;
    if !is_subagent_activity_type(raw_type) {
        return None;
    }
    let kind = parse_kind(item.get("kind").and_then(Value::as_str)?)?;
    let agent_thread_id = text_field(item, &["agentThreadId", "agent_thread_id"])?;
    let call_id =
        text_field(item, &["id", "callId", "call_id"]).unwrap_or_else(|| agent_thread_id.clone());
    Some(SubagentActivity {
        call_id,
        kind,
        agent_thread_id,
        agent_path: text_field(item, &["agentPath", "agent_path"]),
    })
}

pub(super) fn collab_launch_item(
    call_id: String,
    prompt: Option<String>,
    receiver_thread_id: String,
    status: ToolCallStatus,
) -> AgentTimelineItem {
    AgentTimelineItem::ToolCall {
        call_id,
        name: "collabAgentToolCall".into(),
        detail: ToolCallDetail::CollabAgent {
            prompt,
            receiver_thread_ids: vec![receiver_thread_id],
            sender_thread_id: None,
        },
        status,
        error: None,
        subagent_id: None,
    }
}

fn is_subagent_activity_type(raw: &str) -> bool {
    raw.eq_ignore_ascii_case("subagentactivity") || raw == "subAgentActivity"
}

fn parse_kind(raw: &str) -> Option<SubagentActivityKind> {
    match raw {
        "started" => Some(SubagentActivityKind::Started),
        "completed" => Some(SubagentActivityKind::Completed),
        "interacted" => Some(SubagentActivityKind::Interacted),
        "interrupted" => Some(SubagentActivityKind::Interrupted),
        _ => None,
    }
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
