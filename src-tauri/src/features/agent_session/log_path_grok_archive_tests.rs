use super::build_issue_session_archive;
use crate::features::agent_session::TuiSessionLogSource;
use crate::types::agent_profile::AgentType;
use serde_json::json;
use std::fs;
use std::path::Path;

const GROK_SESSION_ID: &str = "019d8b4d-2998-7913-889d-fb3c32971610";

fn grok_source<'a>(
    provider_session_id: Option<&'a str>,
    session_cwd: Option<&'a Path>,
    grok_sessions_root: Option<&'a Path>,
) -> TuiSessionLogSource<'a> {
    TuiSessionLogSource::new(Some(&AgentType::Grok), provider_session_id, None)
        .with_grok_session(session_cwd, grok_sessions_root)
}

fn write_grok_history(root: &Path, cwd: &Path, lines: &[String]) {
    let encoded = encode_grok_cwd(cwd);
    let path = root
        .join(encoded)
        .join(GROK_SESSION_ID)
        .join("chat_history.jsonl");
    fs::create_dir_all(path.parent().expect("history parent")).expect("create history dir");
    fs::write(path, format!("{}\n", lines.join("\n"))).expect("write history");
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

fn user_line(prompt_index: u64, query: &str, synthetic: bool) -> String {
    let content = format!("<skill>包装不入档</skill>\n<user_query>\n{query}\n</user_query>\n");
    let mut value = json!({
        "type": "user",
        "prompt_index": prompt_index,
        "content": content,
    });
    if synthetic {
        value["synthetic_reason"] = json!("skill_bootstrap");
    }
    value.to_string()
}

fn user_query_without_prompt_index(query: &str) -> String {
    json!({
        "type": "user",
        "content": format!("<user_query>\n{query}\n</user_query>"),
    })
    .to_string()
}

fn internal_prompt_with_index(prompt_index: u64) -> String {
    json!({
        "type": "user",
        "prompt_index": prompt_index,
        "content": "默认简体中文。这是内部子任务提示，没有 user_query。",
    })
    .to_string()
}

fn user_parts_line(prompt_index: u64, query: &str) -> String {
    json!({
        "type": "user",
        "prompt_index": prompt_index,
        "content": [{
            "type": "text",
            "text": format!("<user_query>{query}</user_query>"),
        }],
    })
    .to_string()
}

fn assistant_line(text: &str, tool_calls: Option<serde_json::Value>) -> String {
    let mut value = json!({
        "type": "assistant",
        "content": text,
    });
    if let Some(calls) = tool_calls {
        value["tool_calls"] = calls;
    }
    value.to_string()
}

fn grok_composer_runtime() -> String {
    "\
     ❯ 上述问题修复                                          4:41 PM

                                    ▲
 ┆   接用按钮，测试看悬停或聚焦后的可见文案，popup 没有               ┆
"
    .to_string()
}

#[test]
fn build_tui_archive_prefers_grok_session_store_turns() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work");
    fs::create_dir_all(&cwd).expect("cwd");
    let sessions = temp_dir.path().join("grok-sessions");
    write_grok_history(
        &sessions,
        &cwd,
        &[
            json!({"type": "system", "content": "系统提示不入档"}).to_string(),
            user_line(0, "第一个问题", true),
            user_line(1, "第一个问题", false),
            json!({"type": "reasoning", "content": "推理不入档"}).to_string(),
            assistant_line(
                "正在查工具",
                Some(json!([{"name": "shell", "arguments": "ls"}])),
            ),
            json!({"type": "tool_result", "content": "工具输出不入档"}).to_string(),
            assistant_line(
                "第一轮结论 <issue-comment>交付摘要</issue-comment>",
                Some(json!([])),
            ),
            user_parts_line(2, "第二个问题"),
            assistant_line("第二轮结论", None),
            user_query_without_prompt_index("继续"),
            assistant_line("第三轮结论", None),
            internal_prompt_with_index(9),
            assistant_line("内部提示后的正文不单独成轮", None),
        ],
    );

    let runtime_log_path = temp_dir.path().join("runtime.log");
    fs::write(&runtime_log_path, grok_composer_runtime()).expect("write runtime");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        1,
        16,
        7,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        grok_source(
            Some(GROK_SESSION_ID),
            Some(cwd.as_path()),
            Some(sessions.as_path()),
        ),
    )
    .expect("build archive");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(
        content.contains("第一个问题"),
        "missing turn 1 query: {content:?}"
    );
    assert!(
        content.contains("第一轮结论"),
        "missing turn 1 conclusion: {content:?}"
    );
    assert!(
        content.contains("第二个问题"),
        "missing turn 2 query: {content:?}"
    );
    assert!(
        content.contains("第二轮结论"),
        "missing turn 2 conclusion: {content:?}"
    );
    assert!(
        content.contains("继续"),
        "user query without prompt_index stays: {content:?}"
    );
    assert!(content.contains("第三轮结论"), "{content:?}");
    assert!(!content.contains("内部子任务提示"), "{content:?}");
    assert!(
        !content.contains("不单独成轮"),
        "text after an internal prompt is not this turn's conclusion: {content:?}"
    );
    assert!(!content.contains("系统提示不入档"), "{content:?}");
    assert!(!content.contains("推理不入档"), "{content:?}");
    assert!(!content.contains("工具输出不入档"), "{content:?}");
    assert!(!content.contains("正在查工具"), "{content:?}");
    assert!(!content.contains("包装不入档"), "{content:?}");
    assert!(!content.contains("<issue-comment>"), "{content:?}");
    assert!(
        !content.contains("接用按钮"),
        "composer fragment must not win: {content:?}"
    );
    assert!(
        content.contains("第一个问题\n\n第一轮结论"),
        "blocks separated by one blank line: {content:?}"
    );
    assert_eq!(archive.latest_output.as_deref(), Some("第三轮结论"));
}

#[test]
fn build_tui_archive_keeps_only_user_query_when_grok_turn_never_finishes() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work");
    fs::create_dir_all(&cwd).expect("cwd");
    let sessions = temp_dir.path().join("grok-sessions");
    write_grok_history(
        &sessions,
        &cwd,
        &[
            user_line(1, "只有工具的一轮", false),
            assistant_line("还在调工具", Some(json!([{"name": "read"}]))),
            assistant_line("   ", None),
        ],
    );
    let runtime_log_path = temp_dir.path().join("runtime.log");
    fs::write(&runtime_log_path, "旧 PTY 结论\n").expect("write runtime");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        1,
        16,
        7,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        grok_source(
            Some(GROK_SESSION_ID),
            Some(cwd.as_path()),
            Some(sessions.as_path()),
        ),
    )
    .expect("build archive");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(content.contains("只有工具的一轮"), "{content:?}");
    assert!(!content.contains("还在调工具"), "{content:?}");
    assert!(!content.contains("旧 PTY"), "{content:?}");
    assert_eq!(archive.latest_output.as_deref(), Some("只有工具的一轮"));
}

#[test]
fn build_tui_archive_falls_back_to_terminal_without_grok_composer_fragment() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work");
    fs::create_dir_all(&cwd).expect("cwd");
    let sessions = temp_dir.path().join("missing-sessions");
    let runtime_log_path = temp_dir.path().join("runtime.log");
    fs::write(&runtime_log_path, grok_composer_runtime()).expect("write runtime");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        1,
        16,
        7,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        grok_source(
            Some(GROK_SESSION_ID),
            Some(cwd.as_path()),
            Some(sessions.as_path()),
        ),
    )
    .expect("build archive");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(
        content.contains("上述问题修复"),
        "submitted prompt stays: {content:?}"
    );
    assert!(
        !content.contains("接用按钮"),
        "composer fragment dropped: {content:?}"
    );
    let latest = archive.latest_output.as_deref().unwrap_or("");
    assert!(
        latest.contains("上述问题修复"),
        "latest output stays on the submitted prompt: {latest:?}"
    );
    assert!(!latest.contains("接用按钮"), "{latest:?}");
}

#[test]
fn build_tui_archive_encodes_non_ascii_cwd_as_utf8_bytes() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("工作区");
    fs::create_dir_all(&cwd).expect("cwd");
    let sessions = temp_dir.path().join("grok-sessions");
    write_grok_history(
        &sessions,
        &cwd,
        &[
            user_line(1, "中文目录问题", false),
            assistant_line("中文目录结论", None),
        ],
    );
    let runtime_log_path = temp_dir.path().join("runtime.log");
    fs::write(&runtime_log_path, grok_composer_runtime()).expect("write runtime");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        1,
        16,
        7,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        grok_source(
            Some(GROK_SESSION_ID),
            Some(cwd.as_path()),
            Some(sessions.as_path()),
        ),
    )
    .expect("build archive");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(content.contains("中文目录结论"), "{content:?}");
    assert!(!content.contains("接用按钮"), "{content:?}");
}

#[test]
fn build_tui_archive_grok_parse_failure_falls_back_without_failing_completion() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let cwd = temp_dir.path().join("work");
    fs::create_dir_all(&cwd).expect("cwd");
    let sessions = temp_dir.path().join("grok-sessions");
    let encoded = encode_grok_cwd(&cwd);
    let path = sessions
        .join(encoded)
        .join(GROK_SESSION_ID)
        .join("chat_history.jsonl");
    fs::create_dir_all(path.parent().expect("parent")).expect("dir");
    fs::write(&path, "{not-json\n").expect("write broken history");
    let runtime_log_path = temp_dir.path().join("runtime.log");
    fs::write(&runtime_log_path, grok_composer_runtime()).expect("write runtime");

    let archive = build_issue_session_archive(
        temp_dir.path(),
        1,
        16,
        7,
        30,
        runtime_log_path.to_string_lossy().as_ref(),
        "tui",
        grok_source(
            Some(GROK_SESSION_ID),
            Some(cwd.as_path()),
            Some(sessions.as_path()),
        ),
    )
    .expect("parse failure must not fail completion");

    let content = fs::read_to_string(&archive.archive_path).expect("read archive");
    assert!(content.contains("上述问题修复"), "{content:?}");
    assert!(!content.contains("接用按钮"), "{content:?}");
}
