//! `GrokSessionHandle` 集成测试：用假 `grok` 可执行文件扮演 ACP 服务端驱动。
//!
//! 不启真实 grok、不依赖网络与凭据。假服务端把收到的每一行 JSON-RPC 请求
//! 原样写入日志文件，便于断言 adapter 真实下发的握手 / prompt 参数。

use super::*;
use crate::agent::grok_streaming::event_mapper::GrokStreamMapper;
use crate::types::agent_session_stream::{AgentStreamEvent, AgentTimelineItem, ToolCallStatus};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const FAKE_SERVER_TEMPLATE: &str = r#"#!/usr/bin/env bash
log="__LOG__"
fail_load="__FAIL_LOAD__"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  case "$method" in
    initialize)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}\n' "$id"
      ;;
    session/new)
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"grok-fake-1","update":{"sessionUpdate":"available_commands_update","commands":[]}}}\n'
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"grok-fake-1","configOptions":[{"id":"model","type":"select"}]}}\n' "$id"
      ;;
    session/load)
      if [ "$fail_load" = "1" ]; then
        printf '{"jsonrpc":"2.0","id":%s,"error":{"message":"session not found"}}\n' "$id"
      else
        printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"grok-fake-1"}}\n' "$id"
      fi
      ;;
    session/prompt)
      printf '{"jsonrpc":"2.0","method":"_x.ai/queue/changed","params":{"entries":[],"runningPromptId":"grok-prompt-1"}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"The"}},"_meta":{"promptId":"grok-prompt-1"}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hi"}},"_meta":{"promptId":"grok-prompt-1"}}}\n'
      printf '{"jsonrpc":"2.0","method":"_x.ai/session_notification","params":{"update":{"sessionUpdate":"turn_completed","usage":{"inputTokens":100,"outputTokens":10,"totalTokens":110,"cachedReadTokens":40,"cacheCreationTokens":0,"numTurns":1}}}}\n'
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn","_meta":{"promptId":"grok-prompt-1","usage":{"inputTokens":100,"outputTokens":10,"totalTokens":110,"cachedReadTokens":40,"cacheCreationTokens":0}}}}\n' "$id"
      ;;
    session/cancel)
      printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id"
      ;;
    *)
      printf '{"jsonrpc":"2.0","id":%s,"error":{"message":"unexpected method"}}\n' "$id"
      ;;
  esac
done
"#;

fn write_fake_grok(dir: &Path, log_name: &str, fail_load: bool) -> (PathBuf, PathBuf) {
    let log_path = dir.join(log_name);
    let script_path = dir.join(format!("fake-{log_name}.sh"));
    let script = FAKE_SERVER_TEMPLATE
        .replace("__LOG__", &log_path.to_string_lossy())
        .replace("__FAIL_LOAD__", if fail_load { "1" } else { "0" });
    fs::write(&script_path, script).expect("write fake grok");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&script_path).expect("meta").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions).expect("chmod");
    }
    (script_path, log_path)
}

fn config(
    binary: &Path,
    cwd: &Path,
    resume_session_id: Option<&str>,
) -> GrokSessionConfig {
    GrokSessionConfig {
        project_id: 1,
        session_id: 2,
        binary: binary.to_string_lossy().into_owned(),
        cwd: cwd.to_string_lossy().into_owned(),
        model: Some("grok-4.7-build".into()),
        dangerous: true,
        mode_id: Some("full-access".into()),
        broadcaster: AgentEventBroadcaster::new(),
        resume_session_id: resume_session_id.map(str::to_string),
    }
}

fn wait_for_log(path: &Path, needle: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let content = fs::read_to_string(path).unwrap_or_default();
        if content.contains(needle) {
            return content;
        }
        if Instant::now() >= deadline {
            panic!("fake grok never received {needle:?}; log:\n{content}");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn starts_session_and_exposes_session_id_from_session_new() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, _log) = write_fake_grok(temp.path(), "start.log", false);

    let handle =
        GrokSessionHandle::start(config(&binary, temp.path(), None)).expect("start grok session");

    assert_eq!(handle.thread_id().as_deref(), Some("grok-fake-1"));
    assert_eq!(handle.session_id().as_deref(), Some("grok-fake-1"));

    handle.shutdown();
}

#[test]
fn uses_session_load_for_resume_and_keeps_original_id() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) = write_fake_grok(temp.path(), "resume.log", false);

    let handle = GrokSessionHandle::start(config(
        &binary,
        temp.path(),
        Some("grok-existing-session"),
    ))
    .expect("resume grok session");

    assert_eq!(handle.thread_id().as_deref(), Some("grok-existing-session"));
    let content = wait_for_log(&log, "\"method\":\"session/load\"");
    assert!(content.contains("grok-existing-session"));
    assert!(!content.contains("\"method\":\"session/new\""));

    handle.shutdown();
}

#[test]
fn resume_falls_back_to_new_session_when_load_fails() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) = write_fake_grok(temp.path(), "fallback.log", true);

    let handle = GrokSessionHandle::start(config(&binary, temp.path(), Some("stale-session")))
        .expect("fallback to session/new");

    assert_eq!(handle.thread_id().as_deref(), Some("grok-fake-1"));
    let content = wait_for_log(&log, "\"method\":\"session/new\"");
    assert!(content.contains("\"method\":\"session/load\""));

    handle.shutdown();
}

#[test]
fn sends_prompt_with_user_text_and_model_argv() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) = write_fake_grok(temp.path(), "prompt.log", false);

    let handle =
        GrokSessionHandle::start(config(&binary, temp.path(), None)).expect("start grok session");
    handle
        .send_message("hello from redwhisk".into(), Vec::new())
        .expect("send message");

    let content = wait_for_log(&log, "\"method\":\"session/prompt\"");
    assert!(content.contains("hello from redwhisk"));
    assert!(content.contains("\"sessionId\":\"grok-fake-1\""));

    handle.shutdown();
}

#[test]
fn canonicalizes_cwd_before_session_new() {
    let temp = tempfile::tempdir().expect("temp");
    let real = temp.path().join("real-project");
    fs::create_dir_all(&real).expect("real dir");
    let link = temp.path().join("linked-project");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&real, &link).expect("symlink");
    #[cfg(not(unix))]
    let link = real.clone();

    let (binary, log) = write_fake_grok(temp.path(), "cwd.log", false);
    let handle = GrokSessionHandle::start(config(&binary, &link, None)).expect("start");

    let expected = fs::canonicalize(&real).expect("canonical");
    let content = wait_for_log(&log, "\"method\":\"session/new\"");
    assert!(
        content.contains(&format!("\"cwd\":\"{}\"", expected.to_string_lossy())),
        "session/new must carry canonical cwd, log:\n{content}"
    );

    handle.shutdown();
}

#[test]
fn cancel_without_active_turn_is_not_a_silent_success() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, _log) = write_fake_grok(temp.path(), "cancel.log", false);
    let handle = GrokSessionHandle::start(config(&binary, temp.path(), None)).expect("start");

    let as_trait: &dyn AgentSessionHandle = &handle;
    assert!(matches!(
        as_trait.cancel_turn(),
        Err(AgentSessionError::NoInterruptibleTurn)
    ));

    handle.shutdown();
}

#[test]
fn fake_server_drives_assistant_and_reasoning_stream_events() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, _log) = write_fake_grok(temp.path(), "stream.log", false);

    // 直接驱动 transport + mapper（与 session 内部装配一致），断言事件序列。
    let transport = GrokStreamingTransport::spawn(
        &binary.to_string_lossy(),
        &["agent".into(), "stdio".into()],
        Some(&temp.path().to_string_lossy()),
    )
    .expect("spawn fake grok");
    transport
        .request(INITIALIZE_METHOD, json!({"protocolVersion": 1}))
        .expect("initialize");
    let session = transport
        .request(SESSION_NEW_METHOD, json!({"cwd": "/tmp", "mcpServers": []}))
        .expect("session/new");
    assert_eq!(session["sessionId"], "grok-fake-1");

    let collected = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let sink = Arc::clone(&collected);
    let mapper = Mutex::new({
        let mut mapper = GrokStreamMapper::new();
        mapper.begin_turn("local-turn".into());
        mapper
    });
    transport.set_notification_handler(Arc::new(move |method, params| {
        let events = mapper
            .lock()
            .expect("mapper lock")
            .on_notification(method, params);
        sink.lock().expect("sink lock").extend(events);
    }));

    transport
        .request(
            SESSION_PROMPT_METHOD,
            json!({"sessionId": "grok-fake-1", "prompt": [{"type": "text", "text": "hi"}]}),
        )
        .expect("session/prompt");

    let events = collected.lock().expect("events").clone();
    assert_eq!(summarize(&events), vec![
        "turn_started".to_string(),
        "reasoning".to_string(),
        "assistant_message".to_string(),
        "usage_updated".to_string(),
    ]);

    transport.shutdown();
}

fn summarize(events: &[AgentStreamEvent]) -> Vec<String> {
    events
        .iter()
        .map(|event| match event {
            AgentStreamEvent::TurnStarted { .. } => "turn_started".to_string(),
            AgentStreamEvent::UsageUpdated { .. } => "usage_updated".to_string(),
            AgentStreamEvent::Timeline { item, .. } => match item {
                AgentTimelineItem::Reasoning { .. } => "reasoning".to_string(),
                AgentTimelineItem::AssistantMessage { .. } => "assistant_message".to_string(),
                AgentTimelineItem::ToolCall { status, .. } => match status {
                    ToolCallStatus::Completed => "tool_completed".to_string(),
                    ToolCallStatus::Failed => "tool_failed".to_string(),
                    _ => "tool_running".to_string(),
                },
                other => format!("timeline:{other:?}"),
            },
            other => format!("{other:?}"),
        })
        .collect()
}

#[test]
fn formats_unexpected_exit_error_with_stderr_tail() {
    assert_eq!(
        format_unexpected_exit_error("stdout EOF", "  "),
        "grok 进程退出：stdout EOF"
    );
    assert!(format_unexpected_exit_error("stdout EOF", "boom").contains("stderr:\nboom"));
}
