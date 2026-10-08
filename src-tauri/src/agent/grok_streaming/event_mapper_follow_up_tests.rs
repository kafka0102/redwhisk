//! `session/prompt` 提前返回后的续写收尾。
//!
//! Grok 会在 prompt 结果之后换 `promptId` 继续吐正文，结束时只发
//! `turn_completed` / `response_completed` 用量通知。这条通知必须补一次
//! `TurnCompleted`，否则运行态不再收回，会话页停在「正在思考」。

use super::*;
use serde_json::json;

fn prompt_meta(prompt_id: &str) -> Value {
    json!({ "promptId": prompt_id, "agentTimestampMs": 1_790_517_500_401i64 })
}

#[test]
fn prompt_result_then_follow_up_stream_closes_on_later_turn_notification() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("local-1".into());
    let events = mapper.on_notification(
        "session/update",
        &json!({"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hi"}},"_meta":prompt_meta("p-1")}),
    );
    assert!(matches!(
        events.as_slice(),
        [
            AgentStreamEvent::TurnStarted { .. },
            AgentStreamEvent::Timeline {
                item: AgentTimelineItem::AssistantMessage { text, message_id },
                ..
            },
        ] if text == "hi" && message_id.as_deref() == Some("grok-msg-p-1")
    ));

    let done = mapper.on_prompt_result(&json!({
        "stopReason": "end_turn",
        "_meta": {"promptId": "p-1", "usage": {"inputTokens": 10, "outputTokens": 1, "cachedReadTokens": 0}}
    }));
    assert!(matches!(
        done.as_slice(),
        [AgentStreamEvent::TurnCompleted { stop_reason: Some(reason), .. }] if reason == "end_turn"
    ));
    assert!(!mapper.is_turn_active());

    // prompt 刚结束、还没有续写时，迟到的用量通知不得再收尾一次。
    let late = mapper.on_notification(
        "_x.ai/session_notification",
        &json!({"update":{"sessionUpdate":"turn_completed","usage":{"inputTokens":10,"outputTokens":1,"cachedReadTokens":0}}}),
    );
    assert!(matches!(
        late.as_slice(),
        [AgentStreamEvent::UsageUpdated { .. }]
    ));

    let more = mapper.on_notification(
        "session/update",
        &json!({"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"!"}},"_meta":prompt_meta("task-completed-call-20b778ba-1")}),
    );
    assert!(
        mapper.is_turn_active(),
        "prompt 返回后的续写必须重新打开 turn"
    );
    match more.as_slice() {
        [AgentStreamEvent::Timeline {
            item: AgentTimelineItem::AssistantMessage { text, message_id },
            ..
        }] => {
            assert_eq!(text, "hi!");
            assert_eq!(
                message_id.as_deref(),
                Some("grok-msg-p-1"),
                "续写不得因 promptId 变化拆成第二条消息"
            );
        }
        other => panic!("unexpected {other:?}"),
    }

    let closed = mapper.on_notification(
        "_x.ai/session_notification",
        &json!({"update":{"sessionUpdate":"turn_completed","usage":{"inputTokens":12,"outputTokens":2,"cachedReadTokens":0}}}),
    );
    assert!(
        matches!(
            closed.as_slice(),
            [
                AgentStreamEvent::UsageUpdated { .. },
                AgentStreamEvent::TurnCompleted {
                    stop_reason: None,
                    ..
                },
            ]
        ),
        "续写结束的 turn_completed 必须收尾，实际 {closed:?}"
    );
    assert!(!mapper.is_turn_active());

    let again = mapper.on_notification(
        "_x.ai/session_notification",
        &json!({"update":{"sessionUpdate":"response_completed","usage":{"inputTokens":12,"outputTokens":2,"cachedReadTokens":0}}}),
    );
    assert!(matches!(
        again.as_slice(),
        [AgentStreamEvent::UsageUpdated { .. }]
    ));
}
