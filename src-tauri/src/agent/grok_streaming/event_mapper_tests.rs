//! `GrokStreamMapper` 单测：用实测 ACP 报文样例驱动，断言归一后的事件序列。
//!
//! fixture 取自 `docs/survey/grok-build-cli-probe-notes.md`（`grok 1.0.41` 实测）。

use super::*;
use crate::types::agent_session_stream::{AgentUsage, SessionTokenMerge};
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
        .on_notification(
            "_x.ai/mcp/init_progress",
            &json!({"total": 3, "connected": 1})
        )
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
        [AgentStreamEvent::TurnCompleted {
            turn_id,
            usage,
            stop_reason,
            ..
        }] => {
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

// 工具调用生命周期 / 增量裁决 / 未知工具兜底的断言见 `tool_lifecycle_tests.rs`，
// 本文件只保留 turn 级事件序列断言。

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
        (
            "session/update",
            json!({"update":{"sessionUpdate":"session_info_update"}}),
        ),
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
    let event = mapper
        .on_process_exit("grok 进程退出".into())
        .expect("failure");
    assert!(matches!(
        event,
        AgentStreamEvent::TurnFailed { turn_id: Some(id), .. } if id == "t-2"
    ));
}

fn completed_usage(events: &[AgentStreamEvent]) -> AgentUsage {
    events
        .iter()
        .find_map(|event| match event {
            AgentStreamEvent::TurnCompleted {
                usage: Some(usage), ..
            } => Some(usage.clone()),
            _ => None,
        })
        .expect("turn completed with usage")
}

#[test]
fn prompt_result_uses_session_cumulative_usage_not_per_turn_tokens() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());
    // `_meta` 顶层 token 只代表本轮最后一次模型调用；`_meta.usage` 才是整会话累计。
    // 缺 `usage` 时不得把本轮值当成会话累计（会污染「Session Token 消耗」）。
    let events = mapper.on_prompt_result(&json!({
        "stopReason": "end_turn",
        "_meta": {
            "promptId": "p-1",
            "inputTokens": 30047,
            "outputTokens": 21,
            "totalTokens": 30068,
            "cachedReadTokens": 29952
        }
    }));
    match events.as_slice() {
        [AgentStreamEvent::TurnStarted { .. }, AgentStreamEvent::TurnCompleted { usage, .. }] => {
            assert!(
                usage.is_none(),
                "per-turn tokens leaked into session usage: {usage:?}"
            )
        }
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn consecutive_turn_results_overwrite_session_cumulative_usage_without_accumulating() {
    let mut mapper = GrokStreamMapper::new();

    mapper.begin_turn("t1".into());
    let first = mapper.on_prompt_result(&json!({
        "stopReason": "end_turn",
        "_meta": {"promptId": "p1", "usage": {
            "inputTokens": 29971, "outputTokens": 398, "totalTokens": 30369,
            "cachedReadTokens": 1152, "cacheCreationTokens": 0, "numTurns": 1
        }}
    }));
    let first_usage = completed_usage(&first);
    assert_eq!(first_usage.session_token_input, Some(29_971 - 1_152));
    assert_eq!(first_usage.session_token_output, Some(398));
    assert_eq!(first_usage.session_token_cache, Some(1_152));
    assert_eq!(
        first_usage.session_token_merge,
        SessionTokenMerge::Overwrite
    );

    // 第二轮：`_meta.usage` 已是整会话累计（numTurns=2），不是本轮 30047/21/29952。
    mapper.begin_turn("t2".into());
    let second = mapper.on_prompt_result(&json!({
        "stopReason": "end_turn",
        "_meta": {"promptId": "p2", "usage": {
            "inputTokens": 60063, "outputTokens": 67, "totalTokens": 60130,
            "cachedReadTokens": 59904, "cacheCreationTokens": 0, "numTurns": 2
        }}
    }));
    let second_usage = completed_usage(&second);
    assert_eq!(second_usage.session_token_input, Some(60_063 - 59_904));
    assert_eq!(second_usage.session_token_output, Some(67));
    assert_eq!(second_usage.session_token_cache, Some(59_904));
    assert_eq!(
        second_usage.session_token_merge,
        SessionTokenMerge::Overwrite
    );
    // Overwrite：第二轮取累计覆盖，不是两轮相加。
    assert_ne!(
        second_usage.session_token_cache,
        Some(1_152 + 59_904),
        "session cumulative usage must not be added turn over turn"
    );
}

#[test]
fn usage_notification_does_not_finalize_and_prompt_result_finalizes_once() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());

    // `response_completed` 带整会话累计用量：只更新用量，不收尾 turn。
    let events = mapper.on_notification(
        "_x.ai/session_notification",
        &json!({"update":{"sessionUpdate":"response_completed","usage":{
            "inputTokens":100,"outputTokens":10,"cachedReadTokens":40
        }}}),
    );
    assert!(matches!(
        events.as_slice(),
        [
            AgentStreamEvent::TurnStarted { .. },
            AgentStreamEvent::UsageUpdated { .. }
        ]
    ));
    assert!(mapper.is_turn_active(), "usage 通知本身不得收尾 turn");

    // 权威收尾来源是 `session/prompt` 结果（带 stopReason + `_meta.usage`）。
    let result = json!({
        "stopReason": "end_turn",
        "_meta": {"promptId": "p-1", "usage": {
            "inputTokens": 100, "outputTokens": 10, "cachedReadTokens": 40
        }}
    });
    let events = mapper.on_prompt_result(&result);
    assert!(matches!(
        events.as_slice(),
        [AgentStreamEvent::TurnCompleted { stop_reason: Some(reason), .. }] if reason == "end_turn"
    ));
    assert!(!mapper.is_turn_active());

    // 重复到达的结果不再二次收尾。
    assert!(mapper.on_prompt_result(&result).is_empty());
}

#[test]
fn cancel_is_not_undone_by_late_completion_or_error() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());
    mapper.on_notification("_x.ai/queue/changed", &json!({"runningPromptId": "p-1"}));

    assert!(matches!(
        mapper.on_cancel(),
        AgentStreamEvent::TurnCanceled { turn_id: Some(id), .. } if id == "p-1"
    ));
    // 服务端随后仍回完成 / 错误 / 进程退出事件：均不得重复收尾。
    assert!(mapper
        .on_prompt_result(&json!({
            "stopReason": "end_turn",
            "_meta": {"usage": {"inputTokens": 1, "outputTokens": 1, "cachedReadTokens": 0}}
        }))
        .is_empty());
    assert!(mapper.on_prompt_error("channel closed".into()).is_empty());
    assert!(mapper.on_process_exit("boom".into()).is_none());
}

#[test]
fn prompt_complete_and_unmapped_notifications_never_finalize_or_start_turn() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());
    mapper.on_notification("_x.ai/queue/changed", &json!({"runningPromptId": "p-1"}));

    // 收尾来源里的 prompt_complete 与无承接位事件都不新增事件，也不收尾 turn。
    for (method, params) in [
        (
            "_x.ai/session/prompt_complete",
            json!({"promptId": "p-1", "stopReason": "end_turn", "agentResult": {}}),
        ),
        (
            "session/update",
            json!({"update":{"sessionUpdate":"available_commands_update","commands":[]}}),
        ),
        (
            "_x.ai/mcp/init_progress",
            json!({"total": 3, "connected": 1}),
        ),
        ("_x.ai/session/setup", json!({"phase": "auth"})),
        (
            "_x.ai/session_notification",
            json!({"update":{"sessionUpdate":"hook_run_started","event_name":"user_prompt_submit"}}),
        ),
        (
            "_x.ai/session_notification",
            json!({"update":{"sessionUpdate":"hook_execution","event_name":"session_start","runs":[]}}),
        ),
        (
            "session/update",
            json!({"update":{"sessionUpdate":"session_info_update","title":"x"}}),
        ),
    ] {
        assert!(
            mapper.on_notification(method, &params).is_empty(),
            "notification {method} must not emit turn events"
        );
    }
    assert!(mapper.is_turn_active(), "无承接位事件不得收尾 turn");

    // 重复推送可用命令表仍然幂等。
    for _ in 0..3 {
        assert!(mapper
            .on_notification(
                "session/update",
                &json!({"update":{"sessionUpdate":"available_commands_update","commands":[]}}),
            )
            .is_empty());
    }
}
