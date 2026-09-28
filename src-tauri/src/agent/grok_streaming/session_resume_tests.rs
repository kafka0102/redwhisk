//! `GrokSessionHandle` 恢复路径集成测试：`session/load` 之后仍是同一个 Grok 会话。
//!
//! 用假 `grok` 可执行文件扮演 ACP 服务端；不启真实 grok、不依赖网络与凭据。
//! 假服务端与事件断言辅助复用 `session_test_support`，不与 `session_tests` 重复样板。

use super::session_test_support::*;
use super::*;
use crate::agent::grok_streaming::event_mapper::GrokStreamMapper;
use crate::types::agent_session_stream::{AgentStreamEvent, SessionTokenMerge};

/// 恢复（`session/load`）后的轮次必须沿用原 session id，不悄悄切到新会话。
#[test]
fn resumed_session_prompts_with_the_original_session_id() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) = write_fake_grok(temp.path(), "resume-prompt.log", false);

    let handle =
        GrokSessionHandle::start(config(&binary, temp.path(), Some("grok-existing-session")))
            .expect("resume grok session");
    handle
        .send_message("continue the same session".into(), Vec::new())
        .expect("send message");

    let content = wait_for_log(&log, "\"method\":\"session/prompt\"");
    assert!(
        content.contains("\"sessionId\":\"grok-existing-session\""),
        "恢复后的 prompt 未沿用原 session id，log:\n{content}"
    );
    assert!(!content.contains("grok-fake-1"));

    handle.shutdown();
}

/// 恢复后的轮次事件与用量口径必须与新建会话一致（整会话累计 + `Overwrite`）。
#[test]
fn resumed_session_emits_same_turn_events_and_cumulative_usage_as_new() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, _log) = write_fake_grok(temp.path(), "resume-stream.log", false);

    let transport = GrokStreamingTransport::spawn(
        &binary.to_string_lossy(),
        &["agent".into(), "stdio".into()],
        Some(&temp.path().to_string_lossy()),
    )
    .expect("spawn fake grok");
    transport
        .request(INITIALIZE_METHOD, json!({"protocolVersion": 1}))
        .expect("initialize");
    let loaded = transport
        .request(
            SESSION_LOAD_METHOD,
            json!({"sessionId": "grok-existing-session", "cwd": "/tmp", "mcpServers": []}),
        )
        .expect("session/load");
    assert_eq!(loaded["sessionId"], "grok-fake-1");

    let collected = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let sink = Arc::clone(&collected);
    let mapper = Arc::new(Mutex::new({
        let mut mapper = GrokStreamMapper::new();
        mapper.begin_turn("local-turn".into());
        mapper
    }));
    let handler_mapper = Arc::clone(&mapper);
    transport.set_notification_handler(Arc::new(move |method, params| {
        let events = handler_mapper
            .lock()
            .expect("mapper lock")
            .on_notification(method, params);
        sink.lock().expect("sink lock").extend(events);
    }));

    let result = transport
        .request(
            SESSION_PROMPT_METHOD,
            json!({"sessionId": "grok-existing-session", "prompt": [{"type": "text", "text": "hi"}]}),
        )
        .expect("session/prompt");

    let notifications = collected.lock().expect("events").clone();
    assert_eq!(
        summarize(&notifications),
        vec![
            "turn_started".to_string(),
            "reasoning".to_string(),
            "assistant_message".to_string(),
            "usage_updated".to_string(),
        ]
    );

    let completion = mapper
        .lock()
        .expect("mapper lock")
        .on_prompt_result(&result);
    match completion.as_slice() {
        [AgentStreamEvent::TurnCompleted {
            usage: Some(usage),
            stop_reason,
            ..
        }] => {
            assert_eq!(usage.session_token_input, Some(100 - 40));
            assert_eq!(usage.session_token_output, Some(10));
            assert_eq!(usage.session_token_cache, Some(40));
            assert_eq!(usage.session_token_merge, SessionTokenMerge::Overwrite);
            assert_eq!(stop_reason.as_deref(), Some("end_turn"));
        }
        other => panic!("unexpected completion events {other:?}"),
    }

    transport.shutdown();
}
