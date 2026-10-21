use std::fs;

use crate::features::agent_session::timeline::read_timeline_from_log_path_since;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem, SubagentRosterStatus,
    ToolCallDetail, ToolCallStatus,
};

fn envelope(seq: u64, item: AgentTimelineItem) -> AgentStreamEventEnvelope {
    AgentStreamEventEnvelope {
        project_id: 8,
        session_id: 243,
        seq,
        epoch: "epoch-test".to_string(),
        event: AgentStreamEvent::Timeline {
            item,
            turn_id: Some("turn-parent".to_string()),
            seq: 0,
            timestamp: seq as i64,
        },
        log_offset: None,
    }
}

fn roster(seq: u64, status: SubagentRosterStatus) -> AgentStreamEventEnvelope {
    envelope(
        seq,
        AgentTimelineItem::SubagentRoster {
            subagent_id: "01a15c58-e910-7c40-b311-94444fd563c0".to_string(),
            status,
        },
    )
}

fn shell(seq: u64) -> AgentStreamEventEnvelope {
    envelope(
        seq,
        AgentTimelineItem::ToolCall {
            call_id: format!("call-{seq}"),
            name: "shell".to_string(),
            detail: ToolCallDetail::Shell {
                command: "true".to_string(),
                output: None,
                exit_code: Some(0),
            },
            status: ToolCallStatus::Completed,
            error: None,
            subagent_id: None,
        },
    )
}

fn write_log(path: &std::path::Path, events: &[AgentStreamEventEnvelope]) {
    let lines = events
        .iter()
        .map(|event| serde_json::to_string(event).expect("serialize"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(path, format!("{lines}\n")).expect("write log");
}

fn has_ended_roster(items: &[crate::types::agent_session::TimelineHistoryItem]) -> bool {
    items.iter().any(|entry| {
        matches!(
            &entry.item,
            AgentTimelineItem::SubagentRoster {
                subagent_id,
                status: SubagentRosterStatus::Ended,
            } if subagent_id == "01a15c58-e910-7c40-b311-94444fd563c0"
        )
    })
}

/// `/root/ticket_01` 在前 50 次工具调用之前就结束了。
/// 打开窗口不再包含那条 ended，但切回时缓存仍记着 running，提交按钮会一直停在运行中。
#[test]
fn catch_up_returns_roster_ended_that_fell_outside_the_tool_window() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("roster-window.jsonl");
    let mut events = vec![
        roster(1, SubagentRosterStatus::Running),
        roster(2, SubagentRosterStatus::Ended),
    ];
    for seq in 3..53 {
        events.push(shell(seq));
    }
    write_log(&log_path, &events);
    let cursor = fs::metadata(&log_path).expect("metadata").len();

    let (history, reset_required) =
        read_timeline_from_log_path_since(log_path.to_str().expect("utf8"), Some(cursor))
            .expect("read");

    assert!(!reset_required);
    assert!(
        has_ended_roster(&history.items),
        "游标已经越过窗口外的 ended，补读仍要带回这路子智能体的结束状态"
    );

    let (opened, _) =
        read_timeline_from_log_path_since(log_path.to_str().expect("utf8"), None).expect("open");
    assert!(
        has_ended_roster(&opened.items),
        "重新打开时窗口里没有这路子智能体，仍要带上最后的 ended"
    );
}

#[test]
fn catch_up_prefers_roster_running_inside_the_window_over_older_ended() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let log_path = temp_dir.path().join("roster-restart.jsonl");
    let mut events = vec![roster(1, SubagentRosterStatus::Ended)];
    for seq in 2..22 {
        events.push(shell(seq));
    }
    events.push(roster(22, SubagentRosterStatus::Running));
    for seq in 23..63 {
        events.push(shell(seq));
    }
    write_log(&log_path, &events);
    let cursor = fs::metadata(&log_path).expect("metadata").len();

    let (history, _) =
        read_timeline_from_log_path_since(log_path.to_str().expect("utf8"), Some(cursor))
            .expect("read");

    assert!(
        history.items.iter().any(|entry| {
            matches!(
                &entry.item,
                AgentTimelineItem::SubagentRoster {
                    subagent_id,
                    status: SubagentRosterStatus::Running,
                } if subagent_id == "01a15c58-e910-7c40-b311-94444fd563c0"
            )
        }),
        "窗口内更新的 running 不能被更早的 ended 盖掉"
    );
    assert!(
        !has_ended_roster(&history.items),
        "补读只带回最后状态，不把已经过时的 ended 再写回去"
    );
}
