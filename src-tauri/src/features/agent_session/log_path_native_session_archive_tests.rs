use super::build_issue_session_archive;
use crate::features::agent_session::TuiSessionLogSource;
use crate::types::agent_profile::AgentType;
use serde_json::json;
use std::fs;
use std::path::Path;

const CLAUDE_SESSION_ID: &str = "39acacac-0cea-4c69-b279-febfc3e046ac";

fn claude_source<'a>(
    provider_session_id: Option<&'a str>,
    session_cwd: Option<&'a Path>,
    claude_projects_root: Option<&'a Path>,
) -> TuiSessionLogSource<'a> {
    TuiSessionLogSource::new(Some(&AgentType::Claude), provider_session_id, None)
        .with_claude_projects(session_cwd, claude_projects_root)
}

fn claude_project_dir_name(cwd: &Path) -> String {
    let mut encoded = String::from("-");
    for ch in cwd.to_string_lossy().chars() {
        if ch.is_ascii_alphanumeric() {
            encoded.push(ch);
        } else {
            encoded.push('-');
        }
    }
    encoded
}

fn write_claude_transcript(root: &Path, cwd: &Path, lines: &[String]) {
    let path = root
        .join(claude_project_dir_name(cwd))
        .join(format!("{CLAUDE_SESSION_ID}.jsonl"));
    fs::create_dir_all(path.parent().expect("claude project dir")).expect("create claude dir");
    fs::write(&path, format!("{}\n", lines.join("\n"))).expect("write claude transcript");
}

fn claude_user(text: &str, meta: bool) -> String {
    let mut value = json!({
        "type": "user",
        "sessionId": CLAUDE_SESSION_ID,
        "cwd": "/tmp/redwhisk",
        "isSidechain": false,
        "message": { "role": "user", "content": text },
    });
    if meta {
        value["isMeta"] = json!(true);
    }
    value.to_string()
}

fn claude_user_content_blocks(blocks: serde_json::Value) -> String {
    json!({
        "type": "user",
        "sessionId": CLAUDE_SESSION_ID,
        "cwd": "/tmp/redwhisk",
        "isSidechain": false,
        "message": { "role": "user", "content": blocks },
    })
    .to_string()
}

fn claude_user_tool_result() -> String {
    json!({
        "type": "user",
        "sessionId": CLAUDE_SESSION_ID,
        "isSidechain": false,
        "message": {
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": "toolu_1",
                "content": "工具输出不入档",
            }],
        },
    })
    .to_string()
}

fn claude_assistant(parts: serde_json::Value) -> String {
    json!({
        "type": "assistant",
        "sessionId": CLAUDE_SESSION_ID,
        "isSidechain": false,
        "message": {
            "role": "assistant",
            "content": parts,
        },
    })
    .to_string()
}

fn claude_sidechain_user() -> String {
    json!({
        "type": "user",
        "sessionId": CLAUDE_SESSION_ID,
        "isSidechain": true,
        "message": { "role": "user", "content": "子会话输入不入主归档" },
    })
    .to_string()
}

fn terminal_fallback_runtime() -> String {
    "$ ls\r\nfile.txt\r\n\r\nDone with archive.\r\n".to_string()
}

#[test]
fn build_tui_archive_prefers_claude_native_transcript_turns() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work.tree");
    fs::create_dir_all(&cwd).expect("cwd");
    let projects = temp_dir.path().join("claude-projects");
    write_claude_transcript(
        &projects,
        &cwd,
        &[
            json!({"type": "queue-operation", "content": "排队残句不入档"}).to_string(),
            json!({"type": "attachment", "attachment": {"content": "附件提示不入档"}}).to_string(),
            claude_user_content_blocks(json!([
                {"type": "text", "text": "第一个问题"},
                {"type": "text", "text": "补充说明"},
                {
                    "type": "tool_result",
                    "tool_use_id": "toolu_prior",
                    "content": "用户块里的工具结果不入档",
                },
            ])),
            claude_assistant(json!([
                {"type": "thinking", "thinking": "思考过程不应入档"},
                {"type": "tool_use", "name": "Bash", "input": {"command": "ls -la"}},
            ])),
            claude_user_tool_result(),
            claude_assistant(json!([
                {"type": "text", "text": "第一轮结论"},
                {"type": "tool_use", "name": "Bash", "input": {"command": "pwd"}},
                {"type": "text", "text": "<issue-comment>交付摘要</issue-comment>"},
            ])),
            claude_user(
                "第二个问题\n\n## 标题\n\n```rust\nfn answer() {}\n```",
                false,
            ),
            claude_user("系统补丁不入档", true),
            claude_sidechain_user(),
            claude_assistant(json!([
                {"type": "thinking", "thinking": "第二轮思考不入档"},
                {"type": "text", "text": "第二轮结论"},
            ])),
        ],
    );

    let runtime_log_path = temp_dir.path().join("runtime.log");
    fs::write(&runtime_log_path, "❯ 旧 PTY 输入\r\n旧 PTY 结论\r\n").expect("write runtime");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        1,
        16,
        7,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        claude_source(
            Some(CLAUDE_SESSION_ID),
            Some(cwd.as_path()),
            Some(projects.as_path()),
        ),
    )
    .expect("build archive");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(content.contains("第一个问题"), "{content:?}");
    assert!(content.contains("补充说明"), "{content:?}");
    assert!(content.contains("第一轮结论"), "{content:?}");
    assert!(content.contains("第二个问题"), "{content:?}");
    assert!(content.contains("## 标题"), "{content:?}");
    assert!(content.contains("```rust"), "{content:?}");
    assert!(content.contains("fn answer() {}"), "{content:?}");
    assert!(content.contains("第二轮结论"), "{content:?}");
    assert!(content.contains("交付摘要"), "{content:?}");
    assert!(!content.contains("<issue-comment>"), "{content:?}");
    assert!(!content.contains("思考过程不应入档"), "{content:?}");
    assert!(!content.contains("第二轮思考不入档"), "{content:?}");
    assert!(!content.contains("ls -la"), "{content:?}");
    assert!(!content.contains("pwd"), "{content:?}");
    assert!(!content.contains("工具输出不入档"), "{content:?}");
    assert!(!content.contains("用户块里的工具结果不入档"), "{content:?}");
    assert!(!content.contains("排队残句不入档"), "{content:?}");
    assert!(!content.contains("附件提示不入档"), "{content:?}");
    assert!(!content.contains("系统补丁不入档"), "{content:?}");
    assert!(!content.contains("子会话输入不入主归档"), "{content:?}");
    assert!(!content.contains("旧 PTY"), "{content:?}");
    assert!(!content.trim_start().starts_with('{'));
    assert_eq!(archive.latest_output.as_deref(), Some("第二轮结论"));
}

#[test]
fn build_tui_archive_claude_parse_failure_falls_back_without_failing_completion() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work");
    fs::create_dir_all(&cwd).expect("cwd");
    let projects = temp_dir.path().join("claude-projects");
    let path = projects
        .join(claude_project_dir_name(&cwd))
        .join(format!("{CLAUDE_SESSION_ID}.jsonl"));
    fs::create_dir_all(path.parent().expect("claude project dir")).expect("create claude dir");
    fs::write(&path, "{not-json\n").expect("write broken transcript");
    let runtime_log_path = temp_dir.path().join("runtime.log");
    fs::write(&runtime_log_path, terminal_fallback_runtime()).expect("write runtime");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        2,
        14,
        23,
        99,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        claude_source(
            Some(CLAUDE_SESSION_ID),
            Some(cwd.as_path()),
            Some(projects.as_path()),
        ),
    )
    .expect("completion still succeeds");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(content.contains("$ ls"), "{content:?}");
    assert!(content.contains("Done with archive."), "{content:?}");
    assert_eq!(archive.latest_output.as_deref(), Some("Done with archive."));
}

#[test]
fn build_tui_archive_leaves_json_claude_on_structured_log() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work");
    fs::create_dir_all(&cwd).expect("cwd");
    let projects = temp_dir.path().join("claude-projects");
    write_claude_transcript(&projects, &cwd, &[claude_user("会话记录里的问题", false)]);
    let runtime_log_path = temp_dir.path().join("runtime.jsonl");
    let line = json!({
        "projectId": 1,
        "sessionId": 30,
        "seq": 1,
        "epoch": "epoch-test",
        "event": {
            "type": "timeline",
            "item": {"type": "user_message", "text": "结构化用户消息", "messageId": "u1"},
            "turnId": null,
            "seq": 1,
            "timestamp": 1,
        },
    })
    .to_string();
    fs::write(&runtime_log_path, format!("{line}\n")).expect("write json log");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        1,
        16,
        7,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "json",
        claude_source(
            Some(CLAUDE_SESSION_ID),
            Some(cwd.as_path()),
            Some(projects.as_path()),
        ),
    )
    .expect("build json archive");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(content.contains("结构化用户消息"), "{content:?}");
    assert!(!content.contains("会话记录里的问题"), "{content:?}");
}

#[test]
fn build_tui_archive_keeps_codex_and_grok_native_turns() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work");
    fs::create_dir_all(&cwd).expect("cwd");
    let codex_home = temp_dir.path().join("codex-home");
    let provider_session_id = "019d8b4d-2998-7913-889d-fb3c32971610";
    write_codex_rollout(
        &codex_home,
        provider_session_id,
        &[
            json!({
                "timestamp": "2026-09-27T10:04:21.000Z",
                "type": "session_meta",
                "payload": { "id": provider_session_id, "cwd": "/tmp/redwhisk" },
            })
            .to_string(),
            json!({
                "timestamp": "2026-09-27T10:04:22.000Z",
                "type": "event_msg",
                "payload": {
                    "type": "item_completed",
                    "turn_id": "turn-1",
                    "item": {
                        "type": "UserMessage",
                        "content": [{ "type": "text", "text": "Codex 问题" }],
                    },
                },
            })
            .to_string(),
            json!({
                "timestamp": "2026-09-27T10:04:23.000Z",
                "type": "event_msg",
                "payload": {
                    "type": "item_completed",
                    "turn_id": "turn-1",
                    "item": {
                        "type": "AgentMessage",
                        "content": [{ "type": "Text", "text": "Codex 结论" }],
                    },
                },
            })
            .to_string(),
        ],
    );
    let runtime_log_path = temp_dir.path().join("runtime.log");
    fs::write(&runtime_log_path, "❯ 旧 PTY 输入\r\n旧 PTY 结论\r\n").expect("write runtime");

    let codex = build_issue_session_archive(
        temp_dir.path(),
        1,
        16,
        7,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        TuiSessionLogSource::new(
            Some(&AgentType::Codex),
            Some(provider_session_id),
            Some(codex_home.as_path()),
        ),
    )
    .expect("codex archive");
    let codex_content = fs::read_to_string(&codex.archive_path).expect("read codex");
    assert!(codex_content.contains("Codex 问题"), "{codex_content:?}");
    assert!(codex_content.contains("Codex 结论"), "{codex_content:?}");
    assert!(!codex_content.contains("旧 PTY"), "{codex_content:?}");

    let sessions = temp_dir.path().join("grok-sessions");
    let history = sessions
        .join(encode_grok_cwd(&cwd))
        .join(provider_session_id)
        .join("chat_history.jsonl");
    fs::create_dir_all(history.parent().expect("history parent")).expect("history dir");
    fs::write(
        &history,
        format!(
            "{}\n{}\n",
            json!({
                "type": "user",
                "content": "<user_query>\nGrok 问题\n</user_query>",
            }),
            json!({"type": "assistant", "content": "Grok 结论"}),
        ),
    )
    .expect("write grok history");

    let grok = build_issue_session_archive(
        temp_dir.path(),
        1,
        17,
        8,
        31,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        TuiSessionLogSource::new(Some(&AgentType::Grok), Some(provider_session_id), None)
            .with_grok_session(Some(cwd.as_path()), Some(sessions.as_path())),
    )
    .expect("grok archive");
    let grok_content = fs::read_to_string(&grok.archive_path).expect("read grok");
    assert!(grok_content.contains("Grok 问题"), "{grok_content:?}");
    assert!(grok_content.contains("Grok 结论"), "{grok_content:?}");
    assert!(!grok_content.contains("旧 PTY"), "{grok_content:?}");
}

fn write_codex_rollout(codex_home: &Path, provider_session_id: &str, lines: &[String]) {
    let path = codex_home
        .join("sessions")
        .join("2026")
        .join("09")
        .join("27")
        .join(format!(
            "rollout-2026-09-27T10-04-21-{provider_session_id}.jsonl"
        ));
    fs::create_dir_all(path.parent().expect("rollout parent")).expect("create rollout dir");
    fs::write(path, format!("{}\n", lines.join("\n"))).expect("write rollout");
}

fn encode_grok_cwd(cwd: &Path) -> String {
    let mut encoded = String::new();
    for byte in cwd.to_string_lossy().as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

#[test]
fn build_tui_archive_keeps_user_turn_when_native_conclusion_is_missing() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work");
    fs::create_dir_all(&cwd).expect("cwd");
    let projects = temp_dir.path().join("claude-projects");
    write_claude_transcript(
        &projects,
        &cwd,
        &[
            claude_user("只提交了问题", false),
            claude_assistant(json!([
                {"type": "thinking", "thinking": "还在想"},
                {"type": "tool_use", "name": "Read", "input": {"file_path": "src/main.rs"}},
            ])),
        ],
    );
    let runtime_log_path = temp_dir.path().join("runtime.log");
    fs::write(&runtime_log_path, "❯ 输入框残句不该覆盖\r\n").expect("write runtime");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        1,
        16,
        7,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        claude_source(
            Some(CLAUDE_SESSION_ID),
            Some(cwd.as_path()),
            Some(projects.as_path()),
        ),
    )
    .expect("build archive");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(content.contains("只提交了问题"), "{content:?}");
    assert!(!content.contains("还在想"), "{content:?}");
    assert!(!content.contains("src/main.rs"), "{content:?}");
    assert!(!content.contains("输入框残句"), "{content:?}");
}
