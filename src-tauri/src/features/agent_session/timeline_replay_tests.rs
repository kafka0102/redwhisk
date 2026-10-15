use std::fs;

use crate::features::agent_session::session_log_tail::{reset_tail_peak, tail_peak_bytes};
use crate::features::agent_session::timeline::read_timeline_from_log_path;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem, ToolCallDetail, ToolCallStatus,
};

fn envelope(seq: u64, turn_id: &str, item: AgentTimelineItem) -> AgentStreamEventEnvelope {
    AgentStreamEventEnvelope {
        project_id: 1,
        session_id: 337,
        seq,
        epoch: "epoch-test".to_string(),
        event: AgentStreamEvent::Timeline {
            item,
            turn_id: Some(turn_id.to_string()),
            seq,
            timestamp: seq as i64,
        },
        log_offset: None,
    }
}

fn write_log(path: &std::path::Path, events: &[AgentStreamEventEnvelope]) {
    let lines = events
        .iter()
        .map(|event| serde_json::to_string(event).expect("serialize"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(path, format!("{lines}\n")).expect("write log");
}

#[test]
fn open_replay_of_one_huge_turn_does_not_retain_every_snapshot_frame() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("huge-turn.jsonl");
    let frame = "快".repeat(20_000);
    let mut events = vec![AgentStreamEventEnvelope {
        project_id: 1,
        session_id: 337,
        seq: 1,
        epoch: "epoch-test".to_string(),
        event: AgentStreamEvent::TurnStarted {
            turn_id: Some("turn-huge".to_string()),
        },
        log_offset: None,
    }];
    for index in 0..30 {
        events.push(envelope(
            index + 2,
            "turn-huge",
            AgentTimelineItem::AssistantMessage {
                text: format!("{frame}-{index}").into(),
                message_id: Some("same-message".to_string()),
                subagent_id: None,
            },
        ));
    }
    events.push(envelope(
        40,
        "turn-huge",
        AgentTimelineItem::ToolCall {
            call_id: "call-1".to_string(),
            name: "shell".to_string(),
            detail: ToolCallDetail::Shell {
                command: "echo hi".to_string(),
                output: Some("ok".to_string()),
                exit_code: Some(0),
            },
            status: ToolCallStatus::Completed,
            error: None,
            subagent_id: None,
        },
    ));
    events.push(envelope(
        41,
        "turn-huge",
        AgentTimelineItem::AssistantMessage {
            text: format!("{frame}-final").into(),
            message_id: Some("same-message".to_string()),
            subagent_id: None,
        },
    ));
    write_log(&log_path, &events);
    let file_len = fs::metadata(&log_path).expect("meta").len();
    assert!(file_len > 1_500_000, "fixture too small: {file_len}");

    reset_tail_peak();
    let history =
        read_timeline_from_log_path(log_path.to_str().expect("utf8 path")).expect("read timeline");
    let peak = tail_peak_bytes();
    assert!(
        peak < 1_500_000,
        "open replay retained {peak} bytes of a {file_len} byte single turn"
    );
    assert_eq!(history.items.len(), 2);
    assert!(matches!(
        history.items.first().map(|entry| &entry.item),
        Some(AgentTimelineItem::ToolCall { call_id, .. }) if call_id == "call-1"
    ));
    assert_eq!(
        history.items.last().map(|entry| &entry.item),
        Some(&AgentTimelineItem::AssistantMessage {
            text: format!("{frame}-final").into(),
            message_id: Some("same-message".to_string()),
            subagent_id: None,
        })
    );
}
