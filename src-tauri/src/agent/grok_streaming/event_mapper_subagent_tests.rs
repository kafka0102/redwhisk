//! 子代理 ACP 更新不得进入父会话正文。
//!
//! 实测 `grok agent stdio` 会把子会话的 `session/update` 发到同一条连接上，
//! `sessionId` 是子会话。这些 chunk 常把一行状态包成 `\n \n…\n \n`，
//! 若并进父助手缓冲，完成归档会拆行并带上整段过程独白。

use super::*;
use serde_json::json;

fn prompt_meta(prompt_id: &str) -> Value {
    json!({ "promptId": prompt_id, "agentTimestampMs": 1_791_639_520_000i64 })
}

fn assistant_text(event: &AgentStreamEvent) -> Option<String> {
    match event {
        AgentStreamEvent::Timeline {
            item: AgentTimelineItem::AssistantMessage { text, .. },
            ..
        } => Some(text.clone()),
        _ => None,
    }
}

#[test]
fn child_session_chunks_do_not_enter_parent_assistant_text() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("local-go".into());

    let parent_status = mapper.on_notification(
        "session/update",
        &json!({
            "sessionId": "parent-session",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "进入自动阶段。"}
            },
            "_meta": prompt_meta("parent-prompt")
        }),
    );
    assert_eq!(
        assistant_text(parent_status.last().expect("parent status")),
        Some("进入自动阶段。".to_string())
    );

    assert!(mapper
        .on_notification(
            "_x.ai/session/update",
            &json!({
                "sessionId": "parent-session",
                "update": {
                    "sessionUpdate": "subagent_spawned",
                    "child_session_id": "child-session",
                    "subagent_id": "child-session"
                }
            }),
        )
        .is_empty());

    let child_events = [
        json!({
            "sessionId": "child-session",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "\n \nSeam 已对齐票面。\n \n"}
            },
            "_meta": prompt_meta("child-prompt")
        }),
        json!({
            "sessionId": "child-session",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "我先读 implement、TDD。"}
            },
            "_meta": prompt_meta("child-prompt")
        }),
        json!({
            "sessionId": "child-session",
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "call-child",
                "title": "read_file",
                "rawInput": {"target_file": "/tmp/x"}
            },
            "_meta": prompt_meta("child-prompt")
        }),
    ];
    for params in &child_events {
        assert!(
            mapper.on_notification("session/update", params).is_empty(),
            "子会话更新不应进入父时间线"
        );
    }

    let done = mapper.on_notification(
        "session/update",
        &json!({
            "sessionId": "parent-session",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "自动阶段已经跑完。"}
            },
            "_meta": prompt_meta("parent-prompt")
        }),
    );
    match done.as_slice() {
        [AgentStreamEvent::Timeline {
            item:
                AgentTimelineItem::AssistantMessage {
                    text,
                    message_id,
                    subagent_id: None,
                },
            ..
        }] => {
            assert_eq!(text, "进入自动阶段。自动阶段已经跑完。");
            assert_eq!(message_id.as_deref(), Some("grok-msg-parent-prompt"));
            assert!(!text.contains('\n'), "父正文不应被子会话的拆行片段打断");
        }
        other => panic!("unexpected {other:?}"),
    }
}
