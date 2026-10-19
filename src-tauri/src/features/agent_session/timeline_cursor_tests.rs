use std::fs;

use crate::features::agent_session::timeline::read_timeline_from_log_path_since;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem, ToolCallDetail, ToolCallStatus,
};

fn envelope(seq: u64, item: AgentTimelineItem) -> AgentStreamEventEnvelope {
    AgentStreamEventEnvelope {
        project_id: 1,
        session_id: 230,
        seq,
        epoch: "epoch-test".to_string(),
        event: AgentStreamEvent::Timeline {
            item,
            turn_id: Some("turn-1".to_string()),
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

fn running_tool() -> AgentTimelineItem {
    AgentTimelineItem::ToolCall {
        call_id: "call-read".to_string(),
        name: "read".to_string(),
        detail: ToolCallDetail::Read {
            path: "src/main.ts".to_string(),
            content: None,
        },
        status: ToolCallStatus::Running,
        error: None,
        subagent_id: None,
    }
}

fn shell_call(call_id: &str) -> AgentTimelineItem {
    AgentTimelineItem::ToolCall {
        call_id: call_id.to_string(),
        name: "shell".to_string(),
        detail: ToolCallDetail::Shell {
            command: format!("echo {call_id}"),
            output: Some("ok".to_string()),
            exit_code: Some(0),
        },
        status: ToolCallStatus::Completed,
        error: None,
        subagent_id: None,
    }
}

fn assistant(text: &str) -> AgentTimelineItem {
    AgentTimelineItem::AssistantMessage {
        text: text.to_string().into(),
        message_id: Some("msg-final".to_string()),
        subagent_id: None,
    }
}

fn line_offset(body: &str, event: &AgentStreamEventEnvelope) -> u64 {
    let line = serde_json::to_string(event).expect("line");
    body.find(&line).expect("line offset") as u64
}

#[test]
fn open_replay_since_cursor_returns_only_entries_after_that_byte() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("cursor.jsonl");
    let events = [
        envelope(1, running_tool()),
        envelope(2, assistant("离开后的完整正文")),
    ];
    write_log(&log_path, &events);
    let body = fs::read_to_string(&log_path).expect("read");
    let seen = line_offset(&body, &events[0]);
    let arrived = line_offset(&body, &events[1]);

    let (replay, reset_required) =
        read_timeline_from_log_path_since(log_path.to_str().expect("utf8"), Some(seen))
            .expect("incremental replay");

    assert!(!reset_required);
    assert_eq!(replay.items.len(), 1);
    match &replay.items[0].item {
        AgentTimelineItem::AssistantMessage { text, .. } => {
            assert_eq!(text.as_str(), "离开后的完整正文");
        }
        other => panic!("expected assistant message, got {other:?}"),
    }
    assert_eq!(replay.items[0].log_offset, Some(arrived));

    let (unchanged, unchanged_reset) =
        read_timeline_from_log_path_since(log_path.to_str().expect("utf8"), Some(arrived))
            .expect("nothing new");
    assert!(!unchanged_reset);
    assert!(unchanged.items.is_empty(), "游标已在最后一帧时不应重传整窗");
}

#[test]
fn open_replay_cursor_before_the_window_returns_every_item_inside_it() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("before-window.jsonl");
    let mut events = Vec::new();
    for index in 0..60 {
        events.push(envelope(index + 1, shell_call(&format!("call-{index}"))));
    }
    write_log(&log_path, &events);
    let body = fs::read_to_string(&log_path).expect("read");
    let before_window = line_offset(&body, &events[0]);

    let (replay, reset_required) =
        read_timeline_from_log_path_since(log_path.to_str().expect("utf8"), Some(before_window))
            .expect("cursor before window");

    assert!(!reset_required);
    let call_ids = replay
        .items
        .iter()
        .filter_map(|entry| match &entry.item {
            AgentTimelineItem::ToolCall { call_id, .. } => Some(call_id.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(call_ids.len(), 50);
    assert_eq!(call_ids.first().copied(), Some("call-10"));
    assert_eq!(call_ids.last().copied(), Some("call-59"));
}

#[test]
fn open_replay_without_cursor_returns_the_whole_window() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("whole-window.jsonl");
    let events = [
        envelope(1, running_tool()),
        envelope(2, assistant("窗口内正文")),
    ];
    write_log(&log_path, &events);

    let (replay, reset_required) =
        read_timeline_from_log_path_since(log_path.to_str().expect("utf8"), None)
            .expect("omitted cursor");

    assert!(!reset_required);
    assert_eq!(replay.items.len(), 2);
    match &replay.items[1].item {
        AgentTimelineItem::AssistantMessage { text, .. } => {
            assert_eq!(text.as_str(), "窗口内正文");
        }
        other => panic!("expected assistant message, got {other:?}"),
    }
}

#[test]
fn open_replay_cursor_past_a_truncated_log_requests_a_full_replace() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("truncated.jsonl");
    let events = [envelope(1, assistant("归档后的正文"))];
    write_log(&log_path, &events);
    let body = fs::read_to_string(&log_path).expect("read");
    let line_start = line_offset(&body, &events[0]);
    let inside_line = line_start + 4;

    let (replay, reset_required) =
        read_timeline_from_log_path_since(log_path.to_str().expect("utf8"), Some(inside_line))
            .expect("truncated");

    assert!(reset_required);
    assert!(
        replay.items.is_empty(),
        "失效游标不应把当前文件残片当成增量"
    );
}

#[test]
fn open_replay_since_cursor_still_reports_pending_permission() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("cursor-permission.jsonl");
    let events = [
        envelope(1, assistant("离开前的正文")),
        AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 230,
            seq: 2,
            epoch: "epoch-test".to_string(),
            event: AgentStreamEvent::PermissionRequested {
                request: crate::types::agent_session_stream::AgentPermissionRequest {
                    id: "perm-waiting".to_string(),
                    turn_id: Some("turn-1".to_string()),
                    kind: crate::types::agent_session_stream::PermissionKind::Tool,
                    title: Some("运行命令".to_string()),
                    description: None,
                    actions: Vec::new(),
                },
            },
            log_offset: None,
        },
    ];
    write_log(&log_path, &events);
    let body = fs::read_to_string(&log_path).expect("read");
    let left_before_request = line_offset(&body, &events[0]);

    let (replay, reset_required) = read_timeline_from_log_path_since(
        log_path.to_str().expect("utf8"),
        Some(left_before_request),
    )
    .expect("incremental replay");

    assert!(!reset_required);
    // 待审批是「当前状态快照」而不是增量：离开期间挂起的审批必须补回来，
    // 否则用户切回会话只看到空的待审批区，agent 一直卡在等写回。
    assert_eq!(replay.pending_permissions.len(), 1);
    assert_eq!(replay.pending_permissions[0].id, "perm-waiting");
    assert!(
        replay.items.iter().all(|entry| entry
            .log_offset
            .is_none_or(|offset| offset > left_before_request)),
        "游标只过滤时间轴条目"
    );
}
