use super::build_issue_session_archive;
use crate::features::agent_session::TuiSessionLogSource;
use crate::types::agent_profile::AgentType;
use rusqlite::Connection;
use serde_json::json;
use std::fs;
use std::path::Path;

const CODEX_SESSION_ID: &str = "019d8b4d-2998-7913-889d-fb3c32971610";
const CLAUDE_SESSION_ID: &str = "39acacac-0cea-4c69-b279-febfc3e046ac";
const GROK_SESSION_ID: &str = "019d8b4d-2998-7913-889d-fb3c32971610";
const OPENCODE_SESSION_ID: &str = "ses_native_archive_fixture";

const MARKED_ARCHIVE: &str = "\
› 第一行
›
› 第二行

# 结论

第一段。


第二段。
";

#[test]
fn codex_session_archive_marks_user_lines_and_keeps_conclusion_blanks() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let codex_home = temp_dir.path().join("codex-home");
    write_codex_rollout(
        &codex_home,
        &[
            session_meta_line(CODEX_SESSION_ID),
            item_completed_line("UserMessage", "turn-1", "text", "第一行\n\n第二行"),
            item_completed_line("Reasoning", "turn-1", "Text", "思考过程不应入档"),
            item_completed_line("CommandExecution", "turn-1", "Text", "ls -la"),
            item_completed_line(
                "AgentMessage",
                "turn-1",
                "Text",
                "# 结论\n\n第一段。\n\n\n第二段。",
            ),
        ],
    );
    let content = archive_content(
        &temp_dir,
        TuiSessionLogSource::new(
            Some(&AgentType::Codex),
            Some(CODEX_SESSION_ID),
            Some(codex_home.as_path()),
        ),
    );
    assert_eq!(content, MARKED_ARCHIVE);
    assert!(!content.contains("思考过程不应入档"), "{content:?}");
    assert!(!content.contains("ls -la"), "{content:?}");
    assert!(!content.contains("旧 PTY"), "{content:?}");
}

#[test]
fn claude_session_archive_marks_user_lines_and_keeps_conclusion_blanks() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work.tree");
    fs::create_dir_all(&cwd).expect("cwd");
    let projects = temp_dir.path().join("claude-projects");
    write_claude_transcript(
        &projects,
        &cwd,
        &[
            claude_user("第一行\n\n第二行"),
            claude_assistant(json!([
                {"type": "thinking", "thinking": "思考过程不应入档"},
                {"type": "tool_use", "name": "Bash", "input": {"command": "ls -la"}},
                {"type": "text", "text": "# 结论\n\n第一段。\n\n\n第二段。"},
            ])),
        ],
    );
    let content = archive_content(
        &temp_dir,
        TuiSessionLogSource::new(Some(&AgentType::Claude), Some(CLAUDE_SESSION_ID), None)
            .with_claude_projects(Some(cwd.as_path()), Some(projects.as_path())),
    );
    assert_eq!(content, MARKED_ARCHIVE);
    assert!(!content.contains("思考过程不应入档"), "{content:?}");
    assert!(!content.contains("ls -la"), "{content:?}");
    assert!(!content.contains("旧 PTY"), "{content:?}");
}

#[test]
fn grok_session_archive_marks_user_lines_and_keeps_conclusion_blanks() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work");
    fs::create_dir_all(&cwd).expect("cwd");
    let sessions = temp_dir.path().join("grok-sessions");
    let history = sessions
        .join(encode_grok_cwd(&cwd))
        .join(GROK_SESSION_ID)
        .join("chat_history.jsonl");
    fs::create_dir_all(history.parent().expect("history parent")).expect("history dir");
    fs::write(
        &history,
        format!(
            "{}\n{}\n{}\n{}\n{}\n",
            json!({"type": "reasoning", "content": "推理不入档"}),
            json!({
                "type": "user",
                "prompt_index": 1,
                "content": "<user_query>\n第一行\n\n第二行\n</user_query>",
            }),
            json!({
                "type": "assistant",
                "content": "正在查工具",
                "tool_calls": [{"name": "shell", "arguments": "ls"}],
            }),
            json!({"type": "tool_result", "content": "工具输出不入档"}),
            json!({"type": "assistant", "content": "# 结论\n\n第一段。\n\n\n第二段。"}),
        ),
    )
    .expect("write grok history");

    let content = archive_content(
        &temp_dir,
        TuiSessionLogSource::new(Some(&AgentType::Grok), Some(GROK_SESSION_ID), None)
            .with_grok_session(Some(cwd.as_path()), Some(sessions.as_path())),
    );
    assert_eq!(content, MARKED_ARCHIVE);
    assert!(!content.contains("推理不入档"), "{content:?}");
    assert!(!content.contains("工具输出不入档"), "{content:?}");
    assert!(!content.contains("正在查工具"), "{content:?}");
    assert!(!content.contains("旧 PTY"), "{content:?}");
}

#[test]
fn opencode_session_archive_marks_user_lines_and_keeps_conclusion_blanks() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work");
    fs::create_dir_all(&cwd).expect("cwd");
    let db_path = temp_dir.path().join("opencode.db");
    write_opencode_marked_turn(&db_path, &cwd);

    let content = archive_content(
        &temp_dir,
        TuiSessionLogSource::new(Some(&AgentType::OpenCode), Some(OPENCODE_SESSION_ID), None)
            .with_opencode_db(Some(cwd.as_path()), Some(db_path.as_path())),
    );
    assert_eq!(content, MARKED_ARCHIVE);
    assert!(!content.contains("思考过程不应入档"), "{content:?}");
    assert!(!content.contains("ls -la"), "{content:?}");
    assert!(!content.contains("工具输出不入档"), "{content:?}");
    assert!(!content.contains("旧 PTY"), "{content:?}");
}

fn archive_content(temp_dir: &tempfile::TempDir, source: TuiSessionLogSource<'_>) -> String {
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
        source,
    )
    .expect("build archive");
    fs::read_to_string(&archive.archive_path).expect("read archive")
}

fn write_codex_rollout(codex_home: &Path, lines: &[String]) {
    let path = codex_home
        .join("sessions")
        .join("2026")
        .join("09")
        .join("27")
        .join(format!(
            "rollout-2026-09-27T10-04-21-{CODEX_SESSION_ID}.jsonl"
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

fn claude_user(text: &str) -> String {
    json!({
        "type": "user",
        "sessionId": CLAUDE_SESSION_ID,
        "cwd": "/tmp/redwhisk",
        "isSidechain": false,
        "message": { "role": "user", "content": text },
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

fn write_opencode_marked_turn(path: &Path, cwd: &Path) {
    let connection = Connection::open(path).expect("open opencode db");
    connection
        .execute_batch(
            "
            CREATE TABLE session (
                id TEXT PRIMARY KEY,
                directory TEXT
            );
            CREATE TABLE message (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                time_created INTEGER,
                data TEXT
            );
            CREATE TABLE part (
                id TEXT PRIMARY KEY,
                message_id TEXT,
                session_id TEXT,
                time_created INTEGER,
                data TEXT
            );
            ",
        )
        .expect("schema");
    connection
        .execute(
            "INSERT INTO session (id, directory) VALUES (?1, ?2)",
            (OPENCODE_SESSION_ID, cwd.to_string_lossy().as_ref()),
        )
        .expect("session");
    insert_opencode_message(
        &connection,
        "msg_user_1",
        1,
        "user",
        &[("prt_user_1", "text", "第一行\n\n第二行")],
    );
    insert_opencode_message(
        &connection,
        "msg_tool",
        2,
        "assistant",
        &[
            ("prt_reason_1", "reasoning", "思考过程不应入档"),
            ("prt_tool_1", "tool", "bash"),
        ],
    );
    insert_opencode_message(
        &connection,
        "msg_final_1",
        3,
        "assistant",
        &[("prt_text_1", "text", "# 结论\n\n第一段。\n\n\n第二段。")],
    );
}

fn insert_opencode_message(
    connection: &Connection,
    message_id: &str,
    time_created: i64,
    role: &str,
    parts: &[(&str, &str, &str)],
) {
    connection
        .execute(
            "INSERT INTO message (id, session_id, time_created, data) VALUES (?1, ?2, ?3, ?4)",
            (
                message_id,
                OPENCODE_SESSION_ID,
                time_created,
                json!({"role": role}).to_string(),
            ),
        )
        .expect("message");
    for (part_id, part_type, body) in parts {
        let data = if *part_type == "tool" {
            json!({
                "type": "tool",
                "tool": body,
                "state": {"input": {"command": "ls -la"}, "output": "工具输出不入档"},
            })
        } else {
            json!({"type": part_type, "text": body})
        };
        connection
            .execute(
                "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?1, ?2, ?3, ?4, ?5)",
                (
                    part_id,
                    message_id,
                    OPENCODE_SESSION_ID,
                    time_created,
                    data.to_string(),
                ),
            )
            .expect("part");
    }
}
