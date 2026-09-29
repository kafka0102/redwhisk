use std::fs;

use crate::features::agent_session::timeline::read_timeline_from_log_path;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem, ToolCallDetail, ToolCallStatus,
};

fn envelope(seq: u64, item: AgentTimelineItem) -> AgentStreamEventEnvelope {
    AgentStreamEventEnvelope {
        project_id: 8,
        session_id: 183,
        seq,
        epoch: "epoch-test".to_string(),
        event: AgentStreamEvent::Timeline {
            item,
            turn_id: Some("turn-1".to_string()),
            seq: 0,
            timestamp: seq as i64,
        },
    }
}

/// Grok 整轮共用一个 messageId。正文先出现，工具插在中间，随后同一条正文
/// 累积出结论。历史折叠必须把结论排到工具后面，不能留在最初的位置。
#[test]
fn grok_same_message_update_after_tool_moves_conclusion_after_tools() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("grok-order.jsonl");
    let events = [
        envelope(
            1,
            AgentTimelineItem::UserMessage {
                text: "参考电子书页面加上清理队列".to_string(),
                message_id: Some("user-1".to_string()),
            },
        ),
        envelope(
            2,
            AgentTimelineItem::AssistantMessage {
                text: "我先对照电子书列表。".to_string(),
                message_id: Some("grok-msg-1".to_string()),
            },
        ),
        envelope(
            3,
            AgentTimelineItem::ToolCall {
                call_id: "call-1".to_string(),
                name: "shell".to_string(),
                detail: ToolCallDetail::Shell {
                    command: "pnpm test".to_string(),
                    output: None,
                    exit_code: None,
                },
                status: ToolCallStatus::Running,
                error: None,
            },
        ),
        envelope(
            4,
            AgentTimelineItem::ToolCall {
                call_id: "call-1".to_string(),
                name: "shell".to_string(),
                detail: ToolCallDetail::Shell {
                    command: "pnpm test".to_string(),
                    output: Some("33 passed".to_string()),
                    exit_code: Some(0),
                },
                status: ToolCallStatus::Completed,
                error: None,
            },
        ),
        envelope(
            5,
            AgentTimelineItem::AssistantMessage {
                text: "我先对照电子书列表。\n\n对应接口：GET /queue/status".to_string(),
                message_id: Some("grok-msg-1".to_string()),
            },
        ),
    ];
    let lines = events
        .iter()
        .map(|event| serde_json::to_string(event).expect("serialize"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&log_path, format!("{lines}\n")).expect("write log");

    let history =
        read_timeline_from_log_path(log_path.to_str().expect("utf8 path")).expect("read timeline");
    let kinds: Vec<&str> = history
        .items
        .iter()
        .map(|item| match item {
            AgentTimelineItem::UserMessage { .. } => "user",
            AgentTimelineItem::AssistantMessage { .. } => "assistant",
            AgentTimelineItem::ToolCall { .. } => "tool",
            AgentTimelineItem::Reasoning { .. } => "reasoning",
            _ => "other",
        })
        .collect();

    assert_eq!(kinds, vec!["user", "tool", "assistant"]);
    assert_eq!(
        history.items.last(),
        Some(&AgentTimelineItem::AssistantMessage {
            text: "我先对照电子书列表。\n\n对应接口：GET /queue/status".to_string(),
            message_id: Some("grok-msg-1".to_string()),
        })
    );
}
