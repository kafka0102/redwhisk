//! 子代理 ACP 更新挂在自己的 `subagent_id` 上，不得并进父助手正文。
//!
//! 实测 `grok agent stdio` 会把子会话的 `session/update` 发到同一条连接上，
//! `sessionId` 是子会话。这些 chunk 常把一行状态包成 `\n \n…\n \n`。
//! 它们必须作为子代理自己的时间线项保留，不能并进父助手缓冲。

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
        } => Some(text.to_string()),
        _ => None,
    }
}

fn subagent_id_of(event: &AgentStreamEvent) -> Option<String> {
    match event {
        AgentStreamEvent::Timeline { item, .. } => match item {
            AgentTimelineItem::AssistantMessage { subagent_id, .. }
            | AgentTimelineItem::Reasoning { subagent_id, .. }
            | AgentTimelineItem::ToolCall { subagent_id, .. } => subagent_id.clone(),
            _ => None,
        },
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

    let spawned = mapper.on_notification(
        "_x.ai/session/update",
        &json!({
            "sessionId": "parent-session",
            "update": {
                "sessionUpdate": "subagent_spawned",
                "child_session_id": "child-session",
                "subagent_id": "child-session"
            }
        }),
    );
    assert!(matches!(
        spawned.as_slice(),
        [AgentStreamEvent::Timeline {
            item: AgentTimelineItem::SubagentRoster {
                subagent_id,
                status: crate::types::agent_session_stream::SubagentRosterStatus::Running,
            },
            ..
        }] if subagent_id == "child-session"
    ));

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
    let mut child_timeline = Vec::new();
    for params in &child_events {
        let events = mapper.on_notification("session/update", params);
        assert!(!events.is_empty(), "子会话正文与工具调用必须进入时间线");
        assert!(
            events
                .iter()
                .all(|event| subagent_id_of(event).as_deref() == Some("child-session")),
            "子会话项必须挂上 child_session_id：{events:?}"
        );
        child_timeline.extend(events);
    }
    assert_eq!(child_timeline.len(), 3);
    let child_message = child_timeline
        .iter()
        .rev()
        .find_map(assistant_text)
        .expect("child assistant text");
    assert_eq!(
        child_message,
        "\n \nSeam 已对齐票面。\n \n我先读 implement、TDD。"
    );

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

/// 回放 session 61 父进程 `updates.jsonl` 里真实出现过的子代理帧：
/// 父连接只收到 `subagent_spawned`，子会话正文与工具调用在子 `sessionId` 上。
#[test]
fn replayed_child_session_output_stays_on_its_own_timeline() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("local-go".into());
    let child = "01a13562-dc6f-7541-862e-05007e310f30";

    let spawned = mapper.on_notification(
        "_x.ai/session/update",
        &json!({
            "sessionId": "01a13442-9e37-7480-b4fd-562b88c7765c",
            "update": {
                "sessionUpdate": "subagent_spawned",
                "subagent_id": child,
                "child_session_id": child,
                "description": "实现前端 Base 地址行"
            }
        }),
    );
    assert!(spawned.iter().any(|event| matches!(
        event,
        AgentStreamEvent::Timeline {
            item: AgentTimelineItem::SubagentRoster { subagent_id, .. },
            ..
        } if subagent_id == child
    )));

    let message = mapper.on_notification(
        "session/update",
        &json!({
            "sessionId": child,
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "先写失败测试。"}
            }
        }),
    );
    assert_eq!(
        assistant_text(message.last().expect("child text")),
        Some("先写失败测试。".into())
    );
    let continued = mapper.on_notification(
        "session/update",
        &json!({
            "sessionId": child,
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "再补实现。"}
            }
        }),
    );
    assert_eq!(
        assistant_text(continued.last().expect("child text")),
        Some("先写失败测试。再补实现。".into())
    );
    let thought = mapper.on_notification(
        "session/update",
        &json!({
            "sessionId": child,
            "update": {
                "sessionUpdate": "agent_thought_chunk",
                "content": {"type": "text", "text": "先看规格。"}
            }
        }),
    );
    assert!(matches!(
        thought.last(),
        Some(AgentStreamEvent::Timeline {
            item: AgentTimelineItem::Reasoning { text, subagent_id: Some(id), .. },
            ..
        }) if text == "先看规格。" && id == child
    ));
    assert_eq!(
        subagent_id_of(message.last().unwrap()).as_deref(),
        Some(child)
    );

    let tool = mapper.on_notification(
        "session/update",
        &json!({
            "sessionId": child,
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "call-child-read",
                "title": "read_file",
                "rawInput": {"target_file": "/tmp/spec.md"}
            }
        }),
    );
    assert!(matches!(
        tool.as_slice(),
        [AgentStreamEvent::Timeline {
            item: AgentTimelineItem::ToolCall { subagent_id: Some(id), .. },
            ..
        }] if id == child
    ));

    let parent = mapper.on_notification(
        "session/update",
        &json!({
            "sessionId": "01a13442-9e37-7480-b4fd-562b88c7765c",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "实现还在跑。"}
            },
            "_meta": prompt_meta("parent-prompt")
        }),
    );
    assert_eq!(
        assistant_text(parent.last().expect("parent")),
        Some("实现还在跑。".into())
    );
    assert_eq!(subagent_id_of(parent.last().unwrap()), None);
    assert_eq!(&*mapper.assistant_text, "实现还在跑。");

    let finished = mapper.on_notification(
        "_x.ai/session/update",
        &json!({
            "sessionId": "01a13442-9e37-7480-b4fd-562b88c7765c",
            "update": {
                "sessionUpdate": "subagent_finished",
                "child_session_id": child,
                "status": "cancelled"
            }
        }),
    );
    assert!(matches!(
        finished.as_slice(),
        [AgentStreamEvent::Timeline {
            item: AgentTimelineItem::SubagentRoster {
                status: crate::types::agent_session_stream::SubagentRosterStatus::Ended,
                ..
            },
            ..
        }]
    ));
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
