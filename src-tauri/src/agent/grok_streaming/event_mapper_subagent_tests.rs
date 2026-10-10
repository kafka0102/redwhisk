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

fn displayed_total(usage: &crate::types::agent_session_stream::AgentUsage) -> u64 {
    usage.session_token_input.unwrap_or(0)
        + usage.session_token_output.unwrap_or(0)
        + usage.session_token_cache.unwrap_or(0)
}

fn commit_total(events: &[AgentStreamEvent]) -> u64 {
    events.iter().fold(0, |total, event| {
        let usage = match event {
            AgentStreamEvent::UsageUpdated { usage } => usage,
            AgentStreamEvent::TurnCompleted {
                usage: Some(usage), ..
            } => usage,
            _ => return total,
        };
        assert_eq!(
            usage.session_token_merge,
            crate::types::agent_session_stream::SessionTokenMerge::TurnCommit
        );
        total + displayed_total(usage)
    })
}

#[test]
fn prompt_usage_adds_across_turns_and_counts_child_turns() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("local-1".into());
    let first = mapper.on_prompt_result(&json!({
        "stopReason": "end_turn",
        "_meta": {"promptId": "turn-7", "usage": {
            "inputTokens": 9_082_984, "outputTokens": 58_238, "cachedReadTokens": 8_420_352,
            "totalTokens": 9_141_222
        }}
    }));
    mapper.begin_turn("local-2".into());
    let last = mapper.on_prompt_result(&json!({
        "stopReason": "end_turn",
        "_meta": {"promptId": "turn-8", "usage": {
            "inputTokens": 599_064, "outputTokens": 536, "cachedReadTokens": 479_104,
            "totalTokens": 599_600
        }}
    }));
    // 重复通知不得把最后一轮再加一次。
    let duplicate = mapper.on_notification(
        "_x.ai/session/update",
        &json!({"update":{"sessionUpdate":"turn_completed","prompt_id":"turn-8","usage":{
            "inputTokens": 599_064, "outputTokens": 536, "cachedReadTokens": 479_104,
            "totalTokens": 599_600
        }}}),
    );
    assert!(duplicate.is_empty());

    mapper.on_notification(
        "_x.ai/session/update",
        &json!({
            "sessionId": "parent-session",
            "update": {"sessionUpdate": "subagent_spawned", "child_session_id": "child-session"}
        }),
    );
    let child = mapper.on_notification(
        "_x.ai/session/update",
        &json!({
            "sessionId": "child-session",
            "update": {"sessionUpdate": "turn_completed", "prompt_id": "child-prompt", "usage": {
                "inputTokens": 3_143_694, "outputTokens": 15_175, "cachedReadTokens": 2_887_680,
                "totalTokens": 3_158_869
            }}
        }),
    );

    let stored = commit_total(&first) + commit_total(&last) + commit_total(&child);
    assert_eq!(stored, 9_141_222 + 599_600 + 3_158_869);
    assert_ne!(stored, 599_600);
}
