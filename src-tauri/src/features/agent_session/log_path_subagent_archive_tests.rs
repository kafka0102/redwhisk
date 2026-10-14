use super::build_issue_session_archive;
use crate::features::agent_session::TuiSessionLogSource;
use crate::types::agent_profile::AgentType;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem, SubagentRosterStatus,
    ToolCallDetail, ToolCallStatus,
};
use std::fs;
use std::path::Path;

const PROVIDER_SESSION_ID: &str = "019d8b4d-2998-7913-889d-fb3c32971610";

const CODEX_AGENT_TYPE: AgentType = AgentType::Codex;

fn codex_source<'a>(
    provider_session_id: Option<&'a str>,
    codex_home: Option<&'a Path>,
) -> TuiSessionLogSource<'a> {
    TuiSessionLogSource::new(Some(&CODEX_AGENT_TYPE), provider_session_id, codex_home)
}

#[test]
fn build_issue_session_archive_keeps_subagent_source_without_roster_bookkeeping() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let runtime_log_path = temp_dir.path().join("runtime.jsonl");
    let events = [
        AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 30,
            seq: 1,
            epoch: "epoch-test".to_string(),
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::AssistantMessage {
                    text: ("子路结论".to_string()).into(),
                    message_id: Some("a1".to_string()),
                    subagent_id: Some("thr_child".to_string()),
                },
                turn_id: None,
                seq: 1,
                timestamp: 1,
            },
            log_offset: None,
        },
        AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 30,
            seq: 2,
            epoch: "epoch-test".to_string(),
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::ToolCall {
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
                turn_id: None,
                seq: 2,
                timestamp: 2,
            },
            log_offset: None,
        },
        AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 30,
            seq: 3,
            epoch: "epoch-test".to_string(),
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::SubagentRoster {
                    subagent_id: "thr_child".to_string(),
                    status: SubagentRosterStatus::Ended,
                },
                turn_id: None,
                seq: 3,
                timestamp: 3,
            },
            log_offset: None,
        },
    ];
    let lines = events
        .iter()
        .map(|event| serde_json::to_string(event).expect("serialize event"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&runtime_log_path, format!("{lines}\n")).expect("write runtime log");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        1,
        16,
        7,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "json",
        codex_source(Some(PROVIDER_SESSION_ID), None),
    )
    .expect("build archive");
    let archived = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(archived.contains("子路结论"));
    assert!(archived.contains("thr_child"));
    assert!(!archived.contains("检查日志"));
    assert!(!archived.contains("subagent_roster"));
    assert!(!archived.contains("tool_call"));
}
