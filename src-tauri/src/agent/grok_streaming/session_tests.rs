//! `GrokSessionHandle` 集成测试：用假 `grok` 可执行文件扮演 ACP 服务端驱动。
//!
//! 不启真实 grok、不依赖网络与凭据。假服务端把收到的每一行 JSON-RPC 请求
//! 原样写入日志文件，便于断言 adapter 真实下发的握手 / prompt 参数。

use super::*;
use super::session_test_support::*;
use crate::agent::grok_streaming::event_mapper::GrokStreamMapper;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentTimelineItem, ToolCallDetail, ToolCallStatus,
};
use std::fs;

/// 回放真实 `grok 1.0.41` 工具报文样例的假 ACP 服务端
/// （取自 `docs/survey/grok-build-cli-probe-notes.md` §3.5）。
const FAKE_SERVER_TOOL_TEMPLATE: &str = r#"#!/usr/bin/env bash
log="__LOG__"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  case "$method" in
    initialize)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1}}\n' "$id"
      ;;
    session/new)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"grok-fake-1"}}\n' "$id"
      ;;
    session/prompt)
      printf '%s\n' '{"jsonrpc":"2.0","method":"_x.ai/queue/changed","params":{"entries":[],"runningPromptId":"grok-prompt-1"}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"grok-fake-1","update":{"sessionUpdate":"tool_call","toolCallId":"call-1","title":"read_file","rawInput":{"target_file":"/tmp/hello.txt"},"_meta":{"x.ai/tool":{"version":1,"name":"read_file","kind":"read","namespace":"grok_build","label":"Read","read_only":true}}},"_meta":{"promptId":"grok-prompt-1"}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"_x.ai/session_notification","params":{"update":{"sessionUpdate":"tool_call_delta_chunk","tool_call_id":"call-1","tool_index":0,"name":"read_file","arguments_delta":""}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"call-1","kind":"read","title":"Read `/tmp/hello.txt`","locations":[{"path":"/tmp/hello.txt"}],"rawInput":{"variant":"ReadFile","target_file":"/tmp/hello.txt"}},"_meta":{"promptId":"grok-prompt-1"}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"call-1","status":"completed","content":[{"type":"content","content":{"type":"text","text":"hello"}}],"rawOutput":{"type":"ReadFile","FileContent":{"absolute_path":"/private/tmp/hello.txt","raw_output":"hello","total_lines":1}}},"_meta":{"promptId":"grok-prompt-1"}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"call-2","title":"acme_mcp__do_thing","rawInput":{"variant":"Custom","arg":1}},"_meta":{"promptId":"grok-prompt-1"}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"call-2","status":"completed","rawOutput":{"type":"Custom","value":"done"}},"_meta":{"promptId":"grok-prompt-1"}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"call-2","status":"completed","rawOutput":{"type":"Custom","value":"done"}},"_meta":{"promptId":"grok-prompt-1"}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}},"_meta":{"promptId":"grok-prompt-1"}}}'
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn","_meta":{"promptId":"grok-prompt-1"}}}\n' "$id"
      ;;
    *)
      printf '{"jsonrpc":"2.0","id":%s,"error":{"message":"unexpected method"}}\n' "$id"
      ;;
  esac
done
"#;

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

#[test]
fn fake_server_replays_real_tool_call_lifecycle() {
    let temp = tempfile::tempdir().expect("temp");
    let log = temp.path().join("tool.log");
    let script_path = temp.path().join("fake-tool.sh");
    write_script(
        &script_path,
        &FAKE_SERVER_TOOL_TEMPLATE.replace("__LOG__", &log.to_string_lossy()),
    );

    let cwd = temp.path().to_string_lossy().into_owned();
    let transport = GrokStreamingTransport::spawn(
        &script_path.to_string_lossy(),
        &["agent".into(), "stdio".into()],
        Some(&cwd),
    )
    .expect("spawn fake grok");
    transport
        .request(INITIALIZE_METHOD, json!({"protocolVersion": 1}))
        .expect("initialize");
    transport
        .request(SESSION_NEW_METHOD, json!({"cwd": cwd, "mcpServers": []}))
        .expect("session/new");

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
            json!({"sessionId": "grok-fake-1", "prompt": [{"type": "text", "text": "read hello.txt"}]}),
        )
        .expect("session/prompt");

    let events = collected.lock().expect("events").clone();
    // 完整生命周期：TurnStarted → Pending/进行中（同一卡片）→ 完成；随后未知工具
    // （含重复推送）复用同一卡片；最后助手消息。`tool_call_delta_chunk` 被忽略。
    assert_eq!(
        summarize(&events),
        vec![
            "turn_started".to_string(),
            "tool_running".to_string(),
            "tool_running".to_string(),
            "tool_completed".to_string(),
            "tool_running".to_string(),
            "tool_completed".to_string(),
            "tool_completed".to_string(),
            "assistant_message".to_string(),
        ]
    );

    let tool_calls: Vec<_> = events
        .iter()
        .filter_map(|event| match event {
            AgentStreamEvent::Timeline {
                item:
                    AgentTimelineItem::ToolCall {
                        call_id,
                        status,
                        detail,
                        ..
                    },
                ..
            } => Some((call_id.clone(), *status, detail.clone())),
            _ => None,
        })
        .collect();
    // 多次更新 / 重复推送都复用同一 call id（前端按 callId upsert，不新增卡片）。
    let read_calls: Vec<_> = tool_calls
        .iter()
        .filter(|(call_id, ..)| call_id == "call-1")
        .cloned()
        .collect();
    let unknown_calls: Vec<_> = tool_calls
        .iter()
        .filter(|(call_id, ..)| call_id == "call-2")
        .cloned()
        .collect();
    assert_eq!(read_calls.len(), 3, "{tool_calls:?}");
    assert_eq!(unknown_calls.len(), 3, "{tool_calls:?}");

    let (_, read_status, read_detail) = read_calls.last().expect("read tool").clone();
    assert_eq!(read_status, ToolCallStatus::Completed);
    match read_detail {
        ToolCallDetail::Read { path, content } => {
            assert_eq!(path, "/tmp/hello.txt");
            assert_eq!(content.as_deref(), Some("hello"));
        }
        other => panic!("unexpected detail {other:?}"),
    }

    // 未知工具（无 `_meta.x.ai/tool`）落 Unknown 兜底，保留原始输入 / 输出。
    let (_, unknown_status, unknown_detail) = unknown_calls.last().expect("unknown tool").clone();
    assert_eq!(unknown_status, ToolCallStatus::Completed);
    match unknown_detail {
        ToolCallDetail::Unknown { raw_input, raw_output } => {
            assert!(raw_input.as_deref().unwrap_or_default().contains("\"arg\":1"));
            assert!(raw_output.as_deref().unwrap_or_default().contains("done"));
        }
        other => panic!("unexpected detail {other:?}"),
    }

    transport.shutdown();
}

#[test]
fn formats_unexpected_exit_error_with_stderr_tail() {
    assert_eq!(
        format_unexpected_exit_error("stdout EOF", "  "),
        "grok 进程退出：stdout EOF"
    );
    assert!(format_unexpected_exit_error("stdout EOF", "boom").contains("stderr:\nboom"));
}
