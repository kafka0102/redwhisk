use std::fs;

use crate::features::agent_session::session_log_tail::{reset_tail_peak, tail_peak_bytes};
use crate::features::agent_session::timeline::read_timeline_from_log_path;
use crate::types::agent_session_stream::{
    AgentPermissionAction, AgentPermissionRequest, AgentStreamEvent, AgentStreamEventEnvelope,
    AgentTimelineItem, PermissionBehavior, PermissionKind, ToolCallDetail, ToolCallStatus,
};

fn permission_requested(seq: u64, request_id: &str) -> AgentStreamEventEnvelope {
    AgentStreamEventEnvelope {
        project_id: 1,
        session_id: 337,
        seq,
        epoch: "epoch-test".to_string(),
        event: AgentStreamEvent::PermissionRequested {
            request: AgentPermissionRequest {
                id: request_id.to_string(),
                turn_id: Some("turn-perm".to_string()),
                kind: PermissionKind::Tool,
                title: Some("运行命令".to_string()),
                description: None,
                actions: vec![AgentPermissionAction {
                    id: "accept".to_string(),
                    label: "允许".to_string(),
                    behavior: PermissionBehavior::Allow,
                }],
            },
        },
        log_offset: None,
    }
}

fn permission_resolved(seq: u64, request_id: &str) -> AgentStreamEventEnvelope {
    AgentStreamEventEnvelope {
        project_id: 1,
        session_id: 337,
        seq,
        epoch: "epoch-test".to_string(),
        event: AgentStreamEvent::PermissionResolved {
            request_id: request_id.to_string(),
            resolution: "allow".to_string(),
        },
        log_offset: None,
    }
}

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

fn shell_call(call_id: &str, output: &str) -> AgentTimelineItem {
    AgentTimelineItem::ToolCall {
        call_id: call_id.to_string(),
        name: "shell".to_string(),
        detail: ToolCallDetail::Shell {
            command: format!("echo {call_id}"),
            output: Some(output.to_string()),
            exit_code: Some(0),
        },
        status: ToolCallStatus::Completed,
        error: None,
        subagent_id: None,
    }
}

/// 一次 session Turn 里可以有远超 50 次命令行调用。
/// 打开回放只留末尾 50 次，且不把更早的助手快照帧读进时间轴。
#[test]
fn open_replay_keeps_the_last_50_command_calls_of_one_session_turn() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("commands.jsonl");
    let frame = "旧".repeat(4_000);
    let mut events = vec![AgentStreamEventEnvelope {
        project_id: 1,
        session_id: 337,
        seq: 1,
        epoch: "epoch-test".to_string(),
        event: AgentStreamEvent::TurnStarted {
            turn_id: Some("turn-only".to_string()),
        },
        log_offset: None,
    }];
    let mut seq = 2u64;
    for index in 0..40 {
        events.push(envelope(
            seq,
            "turn-only",
            AgentTimelineItem::AssistantMessage {
                text: format!("{frame}-{index}").into(),
                message_id: Some("old-message".to_string()),
                subagent_id: None,
            },
        ));
        seq += 1;
    }
    for index in 0..60 {
        events.push(envelope(
            seq,
            "turn-only",
            shell_call(&format!("call-{index}"), &format!("partial-{index}")),
        ));
        seq += 1;
        events.push(envelope(
            seq,
            "turn-only",
            shell_call(&format!("call-{index}"), &format!("done-{index}")),
        ));
        seq += 1;
    }
    write_log(&log_path, &events);
    let file_len = fs::metadata(&log_path).expect("meta").len();

    reset_tail_peak();
    let history =
        read_timeline_from_log_path(log_path.to_str().expect("utf8 path")).expect("read timeline");
    let peak = tail_peak_bytes();
    let call_ids = history
        .items
        .iter()
        .filter_map(|entry| match &entry.item {
            AgentTimelineItem::ToolCall { call_id, .. } => Some(call_id.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();

    assert_eq!(
        call_ids.len(),
        50,
        "loaded {} command calls",
        call_ids.len()
    );
    assert_eq!(call_ids.first().copied(), Some("call-10"));
    assert_eq!(call_ids.last().copied(), Some("call-59"));
    assert!(
        history.items.iter().all(|entry| match &entry.item {
            AgentTimelineItem::AssistantMessage { message_id, .. } => {
                message_id.as_deref() != Some("old-message")
            }
            AgentTimelineItem::ToolCall { detail, .. } => {
                matches!(detail, ToolCallDetail::Shell { output: Some(output), .. } if output.starts_with("done-"))
            }
            _ => false,
        }),
        "window kept an older snapshot or the prefix message"
    );
    assert!(
        peak < usize::try_from(file_len / 2).unwrap_or(usize::MAX),
        "open replay retained {peak} bytes while locating 50 command calls in a {file_len} byte log"
    );
}

#[test]
fn open_replay_collects_permission_requests_that_are_still_waiting() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("permissions.jsonl");
    let events = [
        envelope(
            1,
            "turn-perm",
            AgentTimelineItem::AssistantMessage {
                text: "先看看".to_string().into(),
                message_id: Some("msg-perm".to_string()),
                subagent_id: None,
            },
        ),
        permission_requested(2, "perm-approved"),
        permission_resolved(3, "perm-approved"),
        permission_requested(4, "perm-waiting"),
        // 同一条请求被重复写入（重连 / 重放）时不应重复挂起两张卡片。
        permission_requested(5, "perm-waiting"),
    ];
    write_log(&log_path, &events);

    let history = read_timeline_from_log_path(log_path.to_str().expect("utf8")).expect("replay");

    let pending = history.pending_permissions;
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, "perm-waiting");
    assert_eq!(pending[0].kind, PermissionKind::Tool);
}
