use super::build_issue_session_archive;
use crate::features::agent_session::TuiSessionLogSource;
use crate::types::agent_profile::AgentType;
use rusqlite::Connection;
use serde_json::json;
use std::fs;
use std::path::Path;

const OPENCODE_SESSION_ID: &str = "ses_native_archive_fixture";

fn opencode_source<'a>(
    provider_session_id: Option<&'a str>,
    session_cwd: Option<&'a Path>,
    opencode_db_path: Option<&'a Path>,
) -> TuiSessionLogSource<'a> {
    TuiSessionLogSource::new(Some(&AgentType::OpenCode), provider_session_id, None)
        .with_opencode_db(session_cwd, opencode_db_path)
}

fn terminal_fallback_runtime() -> String {
    "$ ls\r\nfile.txt\r\n\r\nDone with archive.\r\n".to_string()
}

fn write_opencode_db(path: &Path, cwd: &Path) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("opencode db dir");
    }
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
        &[("prt_user_1", "text", "第一个问题")],
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
        &[
            (
                "prt_text_1",
                "text",
                "第一轮结论 <issue-comment>交付摘要</issue-comment>",
            ),
            ("prt_tool_final", "tool", "bash"),
        ],
    );
    insert_opencode_message(
        &connection,
        "msg_user_2",
        4,
        "user",
        &[(
            "prt_user_2",
            "text",
            "第二个问题\n\n## 标题\n\n```rust\nfn answer() {}\n```",
        )],
    );
    insert_opencode_message(
        &connection,
        "msg_final_2",
        5,
        "assistant",
        &[("prt_text_2", "text", "第二轮结论")],
    );
    connection
        .execute(
            "INSERT INTO session (id, directory) VALUES (?1, ?2)",
            ("ses_other", "/tmp/other"),
        )
        .expect("other session");
    connection
        .execute(
            "INSERT INTO message (id, session_id, time_created, data) VALUES (?1, ?2, ?3, ?4)",
            (
                "msg_other",
                "ses_other",
                9_i64,
                json!({"role": "user"}).to_string(),
            ),
        )
        .expect("other message");
    connection
        .execute(
            "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?1, ?2, ?3, ?4, ?5)",
            (
                "prt_other",
                "msg_other",
                "ses_other",
                9_i64,
                json!({"type": "text", "text": "别的会话不入档"}).to_string(),
            ),
        )
        .expect("other part");
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
                (part_id, message_id, OPENCODE_SESSION_ID, time_created, data.to_string()),
            )
            .expect("part");
    }
}

#[test]
fn build_tui_archive_prefers_opencode_native_session_turns() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work");
    fs::create_dir_all(&cwd).expect("cwd");
    let db_path = temp_dir.path().join("opencode.db");
    write_opencode_db(&db_path, &cwd);
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
        opencode_source(
            Some(OPENCODE_SESSION_ID),
            Some(cwd.as_path()),
            Some(db_path.as_path()),
        ),
    )
    .expect("build archive");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(content.contains("第一个问题"), "{content:?}");
    assert!(content.contains("第一轮结论"), "{content:?}");
    assert!(content.contains("第二个问题"), "{content:?}");
    assert!(content.contains("## 标题"), "{content:?}");
    assert!(content.contains("```rust"), "{content:?}");
    assert!(content.contains("fn answer() {}"), "{content:?}");
    assert!(content.contains("第二轮结论"), "{content:?}");
    assert!(content.contains("交付摘要"), "{content:?}");
    assert!(!content.contains("<issue-comment>"), "{content:?}");
    assert!(!content.contains("思考过程不应入档"), "{content:?}");
    assert!(!content.contains("ls -la"), "{content:?}");
    assert!(!content.contains("工具输出不入档"), "{content:?}");
    assert!(!content.contains("别的会话不入档"), "{content:?}");
    assert!(!content.contains("旧 PTY"), "{content:?}");
    assert!(!content.trim_start().starts_with('{'));
    assert_eq!(archive.latest_output.as_deref(), Some("第二轮结论"));
}

#[test]
fn build_tui_archive_opencode_wrong_cwd_falls_back_without_failing_completion() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work");
    let other = temp_dir.path().join("other");
    fs::create_dir_all(&cwd).expect("cwd");
    fs::create_dir_all(&other).expect("other");
    let db_path = temp_dir.path().join("opencode.db");
    write_opencode_db(&db_path, &cwd);
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
        opencode_source(
            Some(OPENCODE_SESSION_ID),
            Some(other.as_path()),
            Some(db_path.as_path()),
        ),
    )
    .expect("completion still succeeds");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(content.contains("$ ls"), "{content:?}");
    assert!(content.contains("Done with archive."), "{content:?}");
    assert!(!content.contains("第一个问题"), "{content:?}");
}

#[test]
fn build_tui_archive_opencode_corrupt_db_falls_back_without_failing_completion() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work");
    fs::create_dir_all(&cwd).expect("cwd");
    let db_path = temp_dir.path().join("opencode.db");
    fs::write(&db_path, "not a sqlite database").expect("write corrupt db");
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
        opencode_source(
            Some(OPENCODE_SESSION_ID),
            Some(cwd.as_path()),
            Some(db_path.as_path()),
        ),
    )
    .expect("completion still succeeds");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(content.contains("$ ls"), "{content:?}");
    assert!(content.contains("Done with archive."), "{content:?}");
}
