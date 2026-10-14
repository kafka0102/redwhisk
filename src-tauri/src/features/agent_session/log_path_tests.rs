use super::build_issue_session_archive;
use crate::features::agent_session::TuiSessionLogSource;
use crate::types::agent_profile::AgentType;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem, ToolCallDetail, ToolCallStatus,
};
use serde_json::json;
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
fn build_issue_session_archive_writes_plain_text_for_tui() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let runtime_log_path = temp_dir.path().join("runtime-tui.log");
    let runtime = "$ ls\r\nfile.txt\r\n\r\n\u{280b} Working(on it...)\r\n\u{2819}\r\n\r\nDone with archive.\r\n";
    fs::write(&runtime_log_path, runtime).expect("write runtime log");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        2,
        14,
        23,
        99,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        codex_source(None, None),
    )
    .expect("build tui archive");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(
        !content.trim_start().starts_with('{'),
        "tui archive must be plain text, got: {content:?}"
    );
    assert!(
        !content.contains("projectId"),
        "must not wrap JSON envelope"
    );
    assert!(!content.contains("assistant_message"));
    assert!(!content.contains("Working("));
    assert!(content.contains("$ ls"));
    assert!(content.contains("Done with archive."));
    assert_eq!(archive.latest_output.as_deref(), Some("Done with archive."));
    assert_eq!(
        archive.runtime_path,
        runtime_log_path.to_string_lossy().to_string()
    );
}

#[test]
fn build_issue_session_archive_filters_out_tool_calls_and_reasoning_for_json() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let runtime_log_path = temp_dir.path().join("runtime.jsonl");
    let events = [
        AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 30,
            seq: 1,
            epoch: "epoch-test".to_string(),
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::UserMessage {
                    text: "请总结".to_string(),
                    message_id: Some("u1".to_string()),
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
                item: AgentTimelineItem::Reasoning {
                    text: ("分析中".to_string()).into(),
                    duration_ms: Some(10),
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
                item: AgentTimelineItem::ToolCall {
                    call_id: "call-1".to_string(),
                    name: "shell".to_string(),
                    detail: ToolCallDetail::Unknown {
                        raw_input: Some("ls".to_string()),
                        raw_output: Some("file.txt".to_string()),
                    },
                    status: ToolCallStatus::Completed,
                    error: None,
                    subagent_id: None,
                },
                turn_id: None,
                seq: 3,
                timestamp: 3,
            },
            log_offset: None,
        },
        AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 30,
            seq: 4,
            epoch: "epoch-test".to_string(),
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::AssistantMessage {
                    text: ("已完成归纳".to_string()).into(),
                    message_id: Some("a1".to_string()),
                    subagent_id: None,
                },
                turn_id: None,
                seq: 4,
                timestamp: 4,
            },
            log_offset: None,
        },
        AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 30,
            seq: 5,
            epoch: "epoch-test".to_string(),
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::Error {
                    message: "收尾失败".to_string(),
                },
                turn_id: None,
                seq: 5,
                timestamp: 5,
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

    assert_eq!(
        archive.runtime_path,
        runtime_log_path.to_string_lossy().to_string()
    );
    assert_eq!(archive.latest_output.as_deref(), Some("收尾失败"));

    let archived_lines = fs::read_to_string(&archive.archive_path).expect("read archive log");
    assert!(!archived_lines.contains("tool_call"));
    assert!(!archived_lines.contains("reasoning"));
    assert!(archived_lines.contains("user_message"));
    assert!(archived_lines.contains("assistant_message"));
    assert!(archived_lines.contains("error"));
}

#[test]
fn build_tui_archive_uses_render_for_fullscreen_paint() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let runtime = temp_dir.path().join("runtime.log");
    // 全屏 CUP 重绘：简单剥壳无换行；回放后应得到分行正文
    let raw = "\u{1b}[1;1H\u{1b}[2J\u{1b}[1;1H❯ fix remote detect\u{1b}[2;1Hdone: added 60s fetch";
    std::fs::write(&runtime, raw).expect("write runtime");
    let archive = build_issue_session_archive(
        temp_dir.path(),
        1,
        212,
        259,
        374,
        runtime.to_string_lossy().as_ref(),
        "tui",
        codex_source(None, None),
    )
    .expect("archive");
    let content = std::fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(
        content.contains("fix remote detect") || content.contains("done: added 60s fetch"),
        "archive should extract core text, got={content:?}"
    );
    assert!(!content.trim().is_empty(), "archive must not be empty");
}

#[test]
fn build_tui_archive_prefers_codex_session_log_turns() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let data_dir = temp_dir.path().join("data");
    fs::create_dir_all(&data_dir).expect("data dir");
    let codex_home = temp_dir.path().join("codex-home");
    write_codex_rollout(
        &codex_home,
        &[
            session_meta_line(PROVIDER_SESSION_ID),
            item_completed_line("UserMessage", "turn-1", "text", "第一个问题"),
            item_completed_line("Reasoning", "turn-1", "Text", "思考过程不应入档"),
            item_completed_line("CommandExecution", "turn-1", "Text", "ls -la"),
            item_completed_line(
                "AgentMessage",
                "turn-1",
                "Text",
                "第一轮结论 <issue-comment>交付摘要</issue-comment>",
            ),
            task_complete_line("turn-1", Some(1_000)),
            item_completed_line("UserMessage", "turn-2", "text", "第二个问题"),
            item_completed_line("AgentMessage", "turn-2", "Text", "第二轮结论"),
        ],
    );

    // 同一会话的 PTY runtime log 仍存在；session log 必须优先。
    let runtime_log_path = temp_dir.path().join("runtime.log");
    fs::write(&runtime_log_path, "❯ 旧 PTY 输入\r\n旧 PTY 结论\r\n").expect("write runtime");

    let archive = build_issue_session_archive(
        &data_dir,
        1,
        16,
        7,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        codex_source(Some(PROVIDER_SESSION_ID), Some(codex_home.as_path())),
    )
    .expect("build archive");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(content.contains("第一个问题"), "missing turn 1 user text");
    assert!(content.contains("第一轮结论"), "missing turn 1 conclusion");
    assert!(content.contains("第二个问题"), "missing turn 2 user text");
    assert!(content.contains("第二轮结论"), "missing turn 2 conclusion");
    assert!(
        !content.contains("思考过程不应入档"),
        "reasoning must not be archived"
    );
    assert!(
        !content.contains("ls -la"),
        "tool output must not be archived"
    );
    assert!(
        !content.contains("<issue-comment>") && !content.contains("</issue-comment>"),
        "delivery tags must be stripped"
    );
    assert!(
        !content.contains("旧 PTY"),
        "session log must take precedence over PTY text"
    );
    assert_eq!(archive.latest_output.as_deref(), Some("第二轮结论"));
}

#[test]
fn build_tui_archive_renders_session_log_turns_with_fixed_spacing() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let codex_home = temp_dir.path().join("codex-home");
    write_codex_rollout(
        &codex_home,
        &[
            session_meta_line(PROVIDER_SESSION_ID),
            // 用户块含 Markdown 两空格硬换行，必须原样保留。
            item_completed_line("UserMessage", "turn-1", "text", "第一行  \n第二行"),
            // 结论块含多余空行与交付标签：压空行、去标签。
            item_completed_line(
                "AgentMessage",
                "turn-1",
                "Text",
                "\n\n结论一\n\n\n结论二 <issue-comment>摘要</issue-comment>",
            ),
            item_completed_line("UserMessage", "turn-2", "text", "追问"),
            item_completed_line("AgentMessage", "turn-2", "Text", "结论三"),
        ],
    );
    let runtime_log_path = temp_dir.path().join("runtime.log");
    fs::write(&runtime_log_path, "旧 PTY 内容\r\n").expect("write runtime");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        1,
        16,
        7,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        codex_source(Some(PROVIDER_SESSION_ID), Some(codex_home.as_path())),
    )
    .expect("build archive");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(
        content.contains("第一行  \n第二行"),
        "hard line break must be preserved, got={content:?}"
    );
    assert!(
        !content.contains("\n\n\n"),
        "consecutive blank lines must collapse to one, got={content:?}"
    );
    assert!(
        content.contains("结论一\n\n结论二 摘要"),
        "blank runs inside a block collapse to one, got={content:?}"
    );
    assert!(
        content.contains("追问\n\n结论三"),
        "turn user block and conclusion block separated by one blank line, got={content:?}"
    );
    assert_eq!(archive.latest_output.as_deref(), Some("结论三"));
}

#[test]
fn build_tui_archive_falls_back_to_pty_when_session_log_missing() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let codex_home = temp_dir.path().join("empty-codex-home");
    fs::create_dir_all(&codex_home).expect("codex home");
    let runtime_log_path = temp_dir.path().join("runtime-tui.log");
    fs::write(
        &runtime_log_path,
        "$ ls\r\nfile.txt\r\n\r\nDone with archive.\r\n",
    )
    .expect("write runtime log");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        2,
        14,
        23,
        99,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        codex_source(Some(PROVIDER_SESSION_ID), Some(codex_home.as_path())),
    )
    .expect("build tui archive");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(!content.trim_start().starts_with('{'));
    assert!(content.contains("$ ls"));
    assert!(content.contains("Done with archive."));
    assert_eq!(archive.latest_output.as_deref(), Some("Done with archive."));
}

fn write_codex_rollout(codex_home: &Path, lines: &[String]) {
    let path = codex_home
        .join("sessions")
        .join("2026")
        .join("09")
        .join("27")
        .join(format!(
            "rollout-2026-09-27T10-04-21-{PROVIDER_SESSION_ID}.jsonl"
        ));
    fs::create_dir_all(path.parent().expect("rollout parent")).expect("create rollout dir");
    fs::write(path, format!("{}\n", lines.join("\n"))).expect("write rollout");
}

fn session_meta_line(session_id: &str) -> String {
    json!({
        "timestamp": "2026-09-27T10:04:21.000Z",
        "type": "session_meta",
        "payload": { "id": session_id, "cwd": "/tmp/redwhisk" },
    })
    .to_string()
}

fn item_completed_line(item_type: &str, turn_id: &str, content_type: &str, text: &str) -> String {
    json!({
        "timestamp": "2026-09-27T10:04:22.000Z",
        "type": "event_msg",
        "payload": {
            "type": "item_completed",
            "turn_id": turn_id,
            "item": {
                "type": item_type,
                "content": [{ "type": content_type, "text": text }],
            },
        },
    })
    .to_string()
}

fn task_complete_line(turn_id: &str, duration_ms: Option<u64>) -> String {
    json!({
        "timestamp": "2026-09-27T10:04:23.000Z",
        "type": "event_msg",
        "payload": {
            "type": "task_complete",
            "turn_id": turn_id,
            "duration_ms": duration_ms,
        },
    })
    .to_string()
}
