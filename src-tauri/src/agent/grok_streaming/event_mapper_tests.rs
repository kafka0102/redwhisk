//! `GrokStreamMapper` 单测：用实测 ACP 报文样例驱动，断言归一后的事件序列。
//!
//! fixture 取自 `docs/survey/grok-build-cli-probe-notes.md`（`grok 1.0.41` 实测）。

use super::*;
use serde_json::json;

fn prompt_meta(prompt_id: &str) -> Value {
    json!({ "promptId": prompt_id, "agentTimestampMs": 1_790_517_500_401i64 })
}

#[test]
fn maps_prompt_stream_to_event_sequence() {
    let mut mapper = GrokStreamMapper::new();

    // 建会话后的重复通知与 MCP/setup 进度：无对应位，不产生事件。
    for _ in 0..3 {
        assert!(mapper
            .on_notification(
                "session/update",
                &json!({"sessionId":"s-1","update":{"sessionUpdate":"available_commands_update","commands":[]}}),
            )
            .is_empty());
    }
    assert!(mapper
        .on_notification("_x.ai/mcp/init_progress", &json!({"total": 3, "connected": 1}))
        .is_empty());
    assert!(mapper
        .on_notification("_x.ai/session/setup", &json!({"phase": "auth"}))
        .is_empty());

    // 发起一轮 prompt。
    mapper.begin_turn("local-1".into());

    // 首个带 promptId 的通知开启 turn。
    let events = mapper.on_notification(
        "_x.ai/queue/changed",
        &json!({"runningPromptId": "p-1", "entries": []}),
    );
    assert!(matches!(
        events.as_slice(),
        [AgentStreamEvent::TurnStarted { turn_id: Some(id) }] if id == "p-1"
    ));

    let events = mapper.on_notification(
        "session/update",
        &json!({"update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"The"}},"_meta":prompt_meta("p-1")}),
    );
    assert!(matches!(
        events.as_slice(),
        [AgentStreamEvent::Timeline { item: AgentTimelineItem::Reasoning { text, .. }, .. }] if text == "The"
    ));
    // 累积：第二条推理 chunk 携带完整文本。
    let events = mapper.on_notification(
        "session/update",
        &json!({"update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":" user"}},"_meta":prompt_meta("p-1")}),
    );
    assert!(matches!(
        events.as_slice(),
        [AgentStreamEvent::Timeline { item: AgentTimelineItem::Reasoning { text, .. }, .. }] if text == "The user"
    ));

    let events = mapper.on_notification(
        "session/update",
        &json!({"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hi"}},"_meta":prompt_meta("p-1")}),
    );
    match events.as_slice() {
        [AgentStreamEvent::Timeline {
            item: AgentTimelineItem::AssistantMessage { text, message_id },
            ..
        }] => {
            assert_eq!(text, "hi");
            assert_eq!(message_id.as_deref(), Some("grok-msg-p-1"));
        }
        other => panic!("unexpected {other:?}"),
    }

    // turn_completed 携带整会话累计用量。
    let events = mapper.on_notification(
        "_x.ai/session_notification",
        &json!({"update":{"sessionUpdate":"turn_completed","elapsed_ms":12345,"usage":{"inputTokens":100,"outputTokens":10,"totalTokens":110,"cachedReadTokens":40,"cacheCreationTokens":0,"reasoningTokens":8,"modelCalls":1,"numTurns":1}}}),
    );
    match events.as_slice() {
        [AgentStreamEvent::UsageUpdated { usage }] => {
            assert_eq!(usage.session_token_input, Some(60));
            assert_eq!(usage.session_token_output, Some(10));
            assert_eq!(usage.session_token_cache, Some(40));
        }
        other => panic!("unexpected {other:?}"),
    }

    // session/prompt 结果收尾，带 stopReason 与用量。
    let events = mapper.on_prompt_result(&json!({
        "stopReason": "end_turn",
        "_meta": {"promptId": "p-1", "usage": {"inputTokens":100,"outputTokens":10,"totalTokens":110,"cachedReadTokens":40,"cacheCreationTokens":0}}
    }));
    match events.as_slice() {
        [AgentStreamEvent::TurnCompleted { turn_id, usage, stop_reason, .. }] => {
            assert_eq!(turn_id.as_deref(), Some("p-1"));
            assert_eq!(stop_reason.as_deref(), Some("end_turn"));
            assert_eq!(usage.as_ref().and_then(|u| u.session_token_cache), Some(40));
        }
        other => panic!("unexpected {other:?}"),
    }
    assert!(!mapper.is_turn_active());
}

#[test]
fn accumulates_assistant_text_across_chunks() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());
    mapper.on_notification(
        "session/update",
        &json!({"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hel"}}}),
    );
    let events = mapper.on_notification(
        "session/update",
        &json!({"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"lo"}}}),
    );
    match events.as_slice() {
        [AgentStreamEvent::Timeline {
            item: AgentTimelineItem::AssistantMessage { text, message_id },
            ..
        }] => {
            assert_eq!(text, "Hello");
            assert_eq!(message_id.as_deref(), Some("grok-msg-t"));
        }
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn maps_tool_call_lifecycle_to_running_then_completed() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());

    let events = mapper.on_notification(
        "session/update",
        &json!({
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "call-1",
                "title": "read_file",
                "rawInput": {"target_file": "/tmp/hello.txt"},
                "_meta": {"x.ai/tool": {"name": "read_file", "kind": "read", "label": "Read"}}
            },
            "_meta": prompt_meta("p-1")
        }),
    );
    let running = last_tool_call(&events);
    assert_eq!(running.0, "call-1");
    assert_eq!(running.1, "read");
    assert_eq!(running.2, ToolCallStatus::Running);

    let events = mapper.on_notification(
        "session/update",
        &json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call-1",
                "status": "completed",
                "locations": [{"path": "/tmp/hello.txt"}],
                "rawOutput": {"type": "ReadFile", "FileContent": {"raw_output": "hello\n", "total_lines": 2}}
            },
            "_meta": prompt_meta("p-1")
        }),
    );
    let completed = last_tool_call(&events);
    assert_eq!(completed.2, ToolCallStatus::Completed);
    match completed.3 {
        crate::types::agent_session_stream::ToolCallDetail::Read { path, content } => {
            assert_eq!(path, "/tmp/hello.txt");
            assert_eq!(content.as_deref(), Some("hello\n"));
        }
        other => panic!("unexpected detail {other:?}"),
    }
}

#[test]
fn private_and_unknown_notifications_never_become_turn_events() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());
    // 先让 turn 正常开始（首个通知才负责发 TurnStarted）。
    mapper.on_notification("_x.ai/queue/changed", &json!({"runningPromptId": "p-1"}));
    for (method, params) in [
        (
            "_x.ai/session_notification",
            json!({"update":{"sessionUpdate":"tool_call_delta_chunk","tool_call_id":"c","arguments_delta":"{"}}),
        ),
        (
            "_x.ai/session_notification",
            json!({"update":{"sessionUpdate":"pending_interaction","tool_call_id":"c","kind":"permission"}}),
        ),
        (
            "_x.ai/session_notification",
            json!({"update":{"sessionUpdate":"hook_run_started","event_name":"user_prompt_submit"}}),
        ),
        ("session/update", json!({"update":{"sessionUpdate":"session_info_update"}})),
        ("_x.ai/sessions/changed", json!({"upserted":[]})),
        ("totally/unknown", json!({"whatever": true})),
    ] {
        let events = mapper.on_notification(method, &params);
        assert!(
            events.is_empty(),
            "notification {method} must not emit turn events, got {events:?}"
        );
    }
}

#[test]
fn tolerates_unknown_fields_in_known_notifications() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());
    let events = mapper.on_notification(
        "session/update",
        &json!({
            "sessionId": "s-1",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "hi"},
                "futureField": {"nested": [1, 2, 3]}
            },
            "_meta": {"promptId": "p-1", "futureMeta": true},
            "brandNewTopLevel": 42
        }),
    );
    assert_eq!(events.len(), 2);
    assert!(matches!(&events[0], AgentStreamEvent::TurnStarted { .. }));
    assert!(matches!(
        &events[1],
        AgentStreamEvent::Timeline { item: AgentTimelineItem::AssistantMessage { text, .. }, .. } if text == "hi"
    ));
}

#[test]
fn falls_back_to_local_turn_id_when_prompt_id_absent() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("local-9".into());
    let events = mapper.on_notification(
        "session/update",
        &json!({"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"x"}}}),
    );
    assert!(matches!(
        &events[0],
        AgentStreamEvent::TurnStarted { turn_id: Some(id) } if id == "local-9"
    ));
}

#[test]
fn cancel_and_process_exit_finalize_turn_once() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t-1".into());
    assert!(matches!(
        mapper.on_cancel(),
        AgentStreamEvent::TurnCanceled { turn_id: Some(id), .. } if id == "t-1"
    ));
    assert!(mapper.on_process_exit("boom".into()).is_none());
}

#[test]
fn process_exit_fails_an_unfinished_turn() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t-2".into());
    let event = mapper.on_process_exit("grok 进程退出".into()).expect("failure");
    assert!(matches!(
        event,
        AgentStreamEvent::TurnFailed { turn_id: Some(id), .. } if id == "t-2"
    ));
}

fn last_tool_call(
    events: &[AgentStreamEvent],
) -> (
    String,
    String,
    ToolCallStatus,
    crate::types::agent_session_stream::ToolCallDetail,
) {
    match events.last() {
        Some(AgentStreamEvent::Timeline {
            item:
                AgentTimelineItem::ToolCall {
                    call_id,
                    name,
                    detail,
                    status,
                    ..
                },
            ..
        }) => (call_id.clone(), name.clone(), *status, detail.clone()),
        other => panic!("unexpected {other:?}"),
    }
}
