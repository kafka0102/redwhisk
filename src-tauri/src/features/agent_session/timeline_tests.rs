use std::fs;

use crate::features::agent_session::read_assistant_texts_for_turn;
use crate::features::agent_session::read_timeline_item_at_log_offset;
use crate::features::agent_session::timeline::read_timeline_from_log_path;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem, SubagentRosterStatus,
    ToolCallDetail, ToolCallStatus,
};

fn envelope(seq: u64, item: AgentTimelineItem) -> AgentStreamEventEnvelope {
    envelope_for_turn(seq, "turn-1", item)
}

fn envelope_for_turn(seq: u64, turn_id: &str, item: AgentTimelineItem) -> AgentStreamEventEnvelope {
    AgentStreamEventEnvelope {
        project_id: 8,
        session_id: 183,
        seq,
        epoch: "epoch-test".to_string(),
        event: AgentStreamEvent::Timeline {
            item,
            turn_id: Some(turn_id.to_string()),
            seq: 0,
            timestamp: seq as i64,
        },
    }
}

fn turn_started(seq: u64, turn_id: &str) -> AgentStreamEventEnvelope {
    AgentStreamEventEnvelope {
        project_id: 8,
        session_id: 183,
        seq,
        epoch: "epoch-test".to_string(),
        event: AgentStreamEvent::TurnStarted {
            turn_id: Some(turn_id.to_string()),
        },
    }
}

fn write_envelopes(path: &std::path::Path, events: &[AgentStreamEventEnvelope]) {
    let lines = events
        .iter()
        .map(|event| serde_json::to_string(event).expect("serialize"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(path, format!("{lines}\n")).expect("write log");
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
                subagent_id: None,
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
                subagent_id: None,
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
                subagent_id: None,
            },
        ),
        envelope(
            5,
            AgentTimelineItem::AssistantMessage {
                text: "我先对照电子书列表。\n\n对应接口：GET /queue/status".to_string(),
                message_id: Some("grok-msg-1".to_string()),
                subagent_id: None,
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
            subagent_id: None,
        })
    );
}

#[test]
fn read_timeline_opens_from_the_50th_turn_and_keeps_the_last_snapshot() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("turns.jsonl");
    let mut events = Vec::new();
    let mut seq = 1u64;
    for turn in 0..60 {
        let turn_id = format!("turn-{turn}");
        events.push(turn_started(seq, &turn_id));
        seq += 1;
        events.push(envelope_for_turn(
            seq,
            &turn_id,
            AgentTimelineItem::AssistantMessage {
                text: format!("draft-{turn}"),
                message_id: Some(format!("msg-{turn}")),
                subagent_id: None,
            },
        ));
        seq += 1;
        events.push(envelope_for_turn(
            seq,
            &turn_id,
            AgentTimelineItem::AssistantMessage {
                text: format!("final-{turn}"),
                message_id: Some(format!("msg-{turn}")),
                subagent_id: None,
            },
        ));
        seq += 1;
        events.push(envelope_for_turn(
            seq,
            &turn_id,
            AgentTimelineItem::ToolCall {
                call_id: format!("call-{turn}"),
                name: "shell".to_string(),
                detail: ToolCallDetail::Shell {
                    command: "echo".to_string(),
                    output: Some(format!("partial-{turn}")),
                    exit_code: None,
                },
                status: ToolCallStatus::Running,
                error: None,
                subagent_id: None,
            },
        ));
        seq += 1;
        events.push(envelope_for_turn(
            seq,
            &turn_id,
            AgentTimelineItem::ToolCall {
                call_id: format!("call-{turn}"),
                name: "shell".to_string(),
                detail: ToolCallDetail::Shell {
                    command: "echo".to_string(),
                    output: Some(format!("done-{turn}")),
                    exit_code: Some(0),
                },
                status: ToolCallStatus::Completed,
                error: None,
                subagent_id: None,
            },
        ));
        seq += 1;
    }
    write_envelopes(&log_path, &events);

    let history =
        read_timeline_from_log_path(log_path.to_str().expect("utf8 path")).expect("read timeline");
    assert_eq!(history.items.len(), 100);
    assert_eq!(
        history.items.first(),
        Some(&AgentTimelineItem::AssistantMessage {
            text: "final-10".to_string(),
            message_id: Some("msg-10".to_string()),
            subagent_id: None,
        })
    );
    assert!(history.items.iter().all(|item| match item {
        AgentTimelineItem::AssistantMessage { text, .. } => text.starts_with("final-"),
        AgentTimelineItem::ToolCall { detail, .. } => {
            matches!(detail, ToolCallDetail::Shell { output: Some(output), .. } if output.starts_with("done-"))
        }
        _ => false,
    }));
}

#[test]
fn read_timeline_keeps_every_turn_when_fewer_than_50_including_unfinished() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("short.jsonl");
    let events = vec![
        turn_started(1, "turn-0"),
        envelope_for_turn(
            2,
            "turn-0",
            AgentTimelineItem::UserMessage {
                text: "第一轮".to_string(),
                message_id: Some("u0".to_string()),
            },
        ),
        turn_started(3, "turn-1"),
        envelope_for_turn(
            4,
            "turn-1",
            AgentTimelineItem::UserMessage {
                text: "未结束".to_string(),
                message_id: Some("u1".to_string()),
            },
        ),
    ];
    write_envelopes(&log_path, &events);
    let history =
        read_timeline_from_log_path(log_path.to_str().expect("utf8 path")).expect("read timeline");
    assert_eq!(history.items.len(), 2);
    assert_eq!(
        history.items.last(),
        Some(&AgentTimelineItem::UserMessage {
            text: "未结束".to_string(),
            message_id: Some("u1".to_string()),
        })
    );
}

#[test]
fn read_assistant_texts_for_turn_keeps_last_snapshot_inside_the_window() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("assistant-window.jsonl");
    let mut events = Vec::new();
    for turn in 0..55 {
        let turn_id = format!("turn-{turn}");
        events.push(turn_started(turn * 3 + 1, &turn_id));
        events.push(envelope_for_turn(
            turn * 3 + 2,
            &turn_id,
            AgentTimelineItem::AssistantMessage {
                text: format!("draft-{turn}"),
                message_id: Some("same".to_string()),
                subagent_id: None,
            },
        ));
        events.push(envelope_for_turn(
            turn * 3 + 3,
            &turn_id,
            AgentTimelineItem::AssistantMessage {
                text: format!("final-{turn}"),
                message_id: Some("same".to_string()),
                subagent_id: None,
            },
        ));
    }
    write_envelopes(&log_path, &events);

    let path = log_path.to_str().expect("utf8 path");
    assert_eq!(
        read_assistant_texts_for_turn(path, "turn-54"),
        vec!["final-54".to_string()]
    );
    assert!(read_assistant_texts_for_turn(path, "turn-0").is_empty());
}

#[test]
fn read_timeline_item_at_log_offset_returns_that_line_only() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("offset.jsonl");
    let events = [
        envelope(
            1,
            AgentTimelineItem::UserMessage {
                text: "前面".to_string(),
                message_id: Some("u0".to_string()),
            },
        ),
        envelope(
            2,
            AgentTimelineItem::ToolCall {
                call_id: "call-1".to_string(),
                name: "shell".to_string(),
                detail: ToolCallDetail::Shell {
                    command: "echo".to_string(),
                    output: Some("完整输出".to_string()),
                    exit_code: Some(0),
                },
                status: ToolCallStatus::Completed,
                error: None,
                subagent_id: None,
            },
        ),
    ];
    write_envelopes(&log_path, &events);
    let body = fs::read_to_string(&log_path).expect("read");
    let needle = serde_json::to_string(&events[1]).expect("needle");
    let offset = body.find(&needle).expect("offset") as u64;
    let item = read_timeline_item_at_log_offset(log_path.to_str().expect("utf8 path"), offset)
        .expect("item");
    assert_eq!(
        item,
        AgentTimelineItem::ToolCall {
            call_id: "call-1".to_string(),
            name: "shell".to_string(),
            detail: ToolCallDetail::Shell {
                command: "echo".to_string(),
                output: Some("完整输出".to_string()),
                exit_code: Some(0),
            },
            status: ToolCallStatus::Completed,
            error: None,
            subagent_id: None,
        }
    );
    let error = read_timeline_item_at_log_offset(log_path.to_str().expect("utf8 path"), offset + 4);
    assert!(error.is_err());
}

#[test]
fn subagent_output_source_survives_log_reread() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("subagent-source.jsonl");
    let lines = [
        r#"{"projectId":8,"sessionId":183,"seq":1,"epoch":"epoch-test","event":{"type":"timeline","seq":1,"timestamp":1,"turnId":"turn-1","item":{"type":"user_message","text":"看一下","messageId":"u1"}}}"#,
        r#"{"projectId":8,"sessionId":183,"seq":2,"epoch":"epoch-test","event":{"type":"timeline","seq":2,"timestamp":2,"turnId":"turn-1","item":{"type":"assistant_message","text":"主智能体","messageId":"m1"}}}"#,
        r#"{"projectId":8,"sessionId":183,"seq":3,"epoch":"epoch-test","event":{"type":"timeline","seq":3,"timestamp":3,"turnId":"turn-1","item":{"type":"assistant_message","text":"子智能体第一路","messageId":"m1","subagentId":"thr_child"}}}"#,
        r#"{"projectId":8,"sessionId":183,"seq":4,"epoch":"epoch-test","event":{"type":"timeline","seq":4,"timestamp":4,"turnId":"turn-1","item":{"type":"assistant_message","text":"子智能体第一路完整","messageId":"m1","subagentId":"thr_child"}}}"#,
        r#"{"projectId":8,"sessionId":183,"seq":5,"epoch":"epoch-test","event":{"type":"timeline","seq":5,"timestamp":5,"turnId":"turn-1","item":{"type":"tool_call","callId":"c1","name":"shell","status":"completed","subagentId":"thr_child","detail":{"type":"shell","command":"ls"}}}}"#,
        r#"{"projectId":8,"sessionId":183,"seq":6,"epoch":"epoch-test","event":{"type":"timeline","seq":6,"timestamp":6,"turnId":"turn-1","item":{"type":"reasoning","text":"子线程在想","subagentId":"thr_child"}}}"#,
    ];
    fs::write(&log_path, lines.join("\n") + "\n").expect("write log");

    let history =
        read_timeline_from_log_path(log_path.to_str().expect("utf8 path")).expect("read timeline");
    let value = serde_json::to_value(&history.items).expect("items");
    assert_eq!(
        value,
        serde_json::json!([
            {"type":"user_message","text":"看一下","messageId":"u1"},
            {"type":"assistant_message","text":"主智能体","messageId":"m1"},
            {"type":"assistant_message","text":"子智能体第一路完整","messageId":"m1","subagentId":"thr_child"},
            {"type":"tool_call","callId":"c1","name":"shell","status":"completed","subagentId":"thr_child","detail":{"type":"shell","command":"ls"}},
            {"type":"reasoning","text":"子线程在想","subagentId":"thr_child"},
        ])
    );
}

#[test]
fn read_timeline_replays_collab_prompt_and_ended_roster() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("roster.jsonl");
    let events = [
        envelope(
            1,
            AgentTimelineItem::ToolCall {
                call_id: "call_spawn".to_string(),
                name: "collabAgentToolCall".to_string(),
                detail: ToolCallDetail::CollabAgent {
                    prompt: Some("检查日志".to_string()),
                    receiver_thread_ids: vec!["thr_child".to_string()],
                    sender_thread_id: Some("thr_parent".to_string()),
                },
                status: ToolCallStatus::Completed,
                error: None,
                subagent_id: None,
            },
        ),
        envelope(
            2,
            AgentTimelineItem::SubagentRoster {
                subagent_id: "thr_child".to_string(),
                status: SubagentRosterStatus::Ended,
            },
        ),
        envelope(
            3,
            AgentTimelineItem::AssistantMessage {
                text: "查完了".to_string(),
                message_id: Some("m1".to_string()),
                subagent_id: Some("thr_child".to_string()),
            },
        ),
    ];
    let lines = events
        .iter()
        .map(|event| serde_json::to_string(event).expect("serialize"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&log_path, format!("{lines}\n")).expect("write log");

    let history = read_timeline_from_log_path(log_path.to_str().expect("path")).expect("read");
    assert_eq!(
        history.items,
        vec![
            AgentTimelineItem::ToolCall {
                call_id: "call_spawn".to_string(),
                name: "collabAgentToolCall".to_string(),
                detail: ToolCallDetail::CollabAgent {
                    prompt: Some("检查日志".to_string()),
                    receiver_thread_ids: vec!["thr_child".to_string()],
                    sender_thread_id: Some("thr_parent".to_string()),
                },
                status: ToolCallStatus::Completed,
                error: None,
                subagent_id: None,
            },
            AgentTimelineItem::SubagentRoster {
                subagent_id: "thr_child".to_string(),
                status: SubagentRosterStatus::Ended,
            },
            AgentTimelineItem::AssistantMessage {
                text: "查完了".to_string(),
                message_id: Some("m1".to_string()),
                subagent_id: Some("thr_child".to_string()),
            },
        ]
    );
}
