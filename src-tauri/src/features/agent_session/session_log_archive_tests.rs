use super::build_issue_session_archive;
use crate::features::agent_session::TuiSessionLogSource;
use crate::types::agent_profile::AgentType;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem,
};
use std::fs;
use std::path::Path;

const PROVIDER_SESSION_ID: &str = "019d8b4d-2998-7913-889d-fb3c32971610";

fn codex_source<'a>(provider_session_id: Option<&'a str>) -> TuiSessionLogSource<'a> {
    TuiSessionLogSource::new(Some(&AgentType::Codex), provider_session_id, None::<&Path>)
}

#[test]
fn json_archive_scans_every_turn_and_keeps_the_last_assistant_text() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let runtime_log_path = temp_dir.path().join("runtime.jsonl");
    let mut lines = Vec::new();
    for turn in 0..60 {
        lines.push(format!(
            r#"{{"projectId":1,"sessionId":30,"seq":{seq},"epoch":"e","event":{{"type":"turn_started","turnId":"turn-{turn}"}}}}"#,
            seq = turn * 4 + 1,
        ));
        lines.push(format!(
            r#"{{"projectId":1,"sessionId":30,"seq":{seq},"epoch":"e","event":{{"type":"timeline","turnId":"turn-{turn}","seq":{seq},"timestamp":{turn},"item":{{"type":"user_message","text":"问-{turn}","messageId":"u-{turn}"}}}}}}"#,
            seq = turn * 4 + 2,
        ));
        lines.push(format!(
            r#"{{"projectId":1,"sessionId":30,"seq":{seq},"epoch":"e","event":{{"type":"timeline","turnId":"turn-{turn}","seq":{seq},"timestamp":{turn},"item":{{"type":"assistant_message","text":"草稿-{turn}","messageId":"shared"}}}}}}"#,
            seq = turn * 4 + 3,
        ));
        lines.push(format!(
            r#"{{"projectId":1,"sessionId":30,"seq":{seq},"epoch":"e","event":{{"type":"timeline","turnId":"turn-{turn}","seq":{seq},"timestamp":{turn},"item":{{"type":"tool_call","callId":"call-{turn}","name":"shell","status":"completed","detail":{{"type":"shell","command":"echo","output":"工具输出-{turn}","exitCode":0}}}}}}}}"#,
            seq = turn * 4 + 4,
        ));
    }
    lines.push(
        r#"{"projectId":1,"sessionId":30,"seq":999,"epoch":"e","event":{"type":"timeline","turnId":"turn-59","seq":999,"timestamp":999,"item":{"type":"assistant_message","text":"最终正文","messageId":"shared"}}}"#
            .to_string(),
    );
    fs::write(&runtime_log_path, lines.join("\n") + "\n").expect("write runtime log");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        1,
        16,
        8,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "json",
        codex_source(Some(PROVIDER_SESSION_ID)),
    )
    .expect("build archive");
    let archived = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(archived.contains("问-0"));
    assert!(archived.contains("问-59"));
    assert!(archived.contains("最终正文"));
    assert!(!archived.contains("草稿-"));
    assert!(!archived.contains("工具输出"));
    assert!(!archived.contains("tool_call"));
    assert_eq!(
        archived.matches("\"type\":\"assistant_message\"").count(),
        1
    );
}

#[test]
fn json_archive_keeps_distinct_message_ids_and_errors() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let runtime_log_path = temp_dir.path().join("runtime.jsonl");
    let events = [
        timeline(
            1,
            AgentTimelineItem::AssistantMessage {
                text: "甲".to_string(),
                message_id: Some("a".to_string()),
                subagent_id: None,
            },
        ),
        timeline(
            2,
            AgentTimelineItem::Error {
                message: "出错".to_string(),
            },
        ),
        timeline(
            3,
            AgentTimelineItem::AssistantMessage {
                text: "乙".to_string(),
                message_id: Some("b".to_string()),
                subagent_id: Some("child".to_string()),
            },
        ),
    ];
    let body = events
        .iter()
        .map(|event| serde_json::to_string(event).expect("serialize"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&runtime_log_path, format!("{body}\n")).expect("write");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        1,
        16,
        9,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "json",
        codex_source(None),
    )
    .expect("archive");
    let archived = fs::read_to_string(&archive.archive_path).expect("read");
    assert!(archived.contains("甲"));
    assert!(archived.contains("乙"));
    assert!(archived.contains("出错"));
}

fn timeline(seq: u64, item: AgentTimelineItem) -> AgentStreamEventEnvelope {
    AgentStreamEventEnvelope {
        project_id: 1,
        session_id: 30,
        seq,
        epoch: "e".to_string(),
        event: AgentStreamEvent::Timeline {
            item,
            turn_id: Some("t".to_string()),
            seq,
            timestamp: seq as i64,
        },
    }
}
