//! `GrokSessionHandle` 恢复路径集成测试：`session/load` 之后仍是同一个 Grok 会话。
//!
//! 用假 `grok` 可执行文件扮演 ACP 服务端；不启真实 grok、不依赖网络与凭据。
//!
//! 事件观测 seam：`AgentEventBroadcaster` 在没有 `AppHandle` 时按设计丢弃事件，
//! headless 测试拿不到 handle 的 Tauri 广播；因此 handle 层断言「恢复保留原 id，
//! 且后续轮次仍发给原会话」，事件序列与用量口径则与既有 adapter 事件用例同 seam
//! （`transport + GrokStreamMapper`，即 `GrokSessionHandle` 内部的同一装配）。

use super::session_test_support::*;
use super::*;
use crate::types::agent_session_stream::{AgentStreamEvent, SessionTokenMerge};

/// 恢复（`session/load`）后的轮次必须沿用原 session id，不悄悄切到新会话。
#[test]
fn resumed_session_prompts_with_the_original_session_id() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) = write_fake_grok(temp.path(), "resume-prompt.log", false);

    let handle = GrokSessionHandle::start(grok_session_config(
        &binary,
        temp.path(),
        Some("grok-existing-session"),
    ))
    .expect("resume grok session");
    assert_eq!(
        handle.session_id().as_deref(),
        Some("grok-existing-session")
    );

    handle
        .send_message("continue the same session".into(), Vec::new())
        .expect("send message");

    let content = wait_for_log(&log, "\"method\":\"session/prompt\"");
    assert!(
        content.contains("\"sessionId\":\"grok-existing-session\""),
        "恢复后的 prompt 未沿用原 session id，log:\n{content}"
    );
    assert!(!content.contains("grok-fake-1"));
    assert_eq!(
        handle.session_id().as_deref(),
        Some("grok-existing-session")
    );

    handle.shutdown();
}

/// 恢复后的轮次事件与用量口径必须与新建会话一致（本轮差额 + `TurnCommit`）。
#[test]
fn resumed_session_emits_same_turn_events_and_cumulative_usage_as_new() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, _log) = write_fake_grok(temp.path(), "resume-stream.log", false);

    let transport = spawn_initialized_fake_transport(&binary, temp.path());
    let loaded = transport
        .request(
            SESSION_LOAD_METHOD,
            json!({"sessionId": "grok-existing-session", "cwd": "/tmp", "mcpServers": []}),
        )
        .expect("session/load");
    assert_eq!(loaded["sessionId"], "grok-fake-1");

    let collector = collect_events(&transport);
    let result = transport
        .request(
            SESSION_PROMPT_METHOD,
            json!({"sessionId": "grok-existing-session", "prompt": [{"type": "text", "text": "hi"}]}),
        )
        .expect("session/prompt");

    let notifications = collector.events.lock().expect("events").clone();
    assert_eq!(
        summarize(&notifications),
        vec![
            "turn_started".to_string(),
            "reasoning".to_string(),
            "assistant_message".to_string(),
            "usage_updated".to_string(),
        ]
    );

    let completion = collector
        .mapper
        .lock()
        .expect("mapper lock")
        .on_prompt_result(&result);
    match completion.as_slice() {
        [AgentStreamEvent::TurnCompleted {
            usage: None,
            stop_reason,
            ..
        }] => {
            assert_eq!(stop_reason.as_deref(), Some("end_turn"));
        }
        other => panic!("unexpected completion events {other:?}"),
    }
    let usage = notifications.iter().find_map(|event| match event {
        AgentStreamEvent::UsageUpdated { usage } => Some(usage),
        _ => None,
    });
    let usage = usage.expect("turn usage");
    assert_eq!(usage.session_token_input, Some(100 - 40));
    assert_eq!(usage.session_token_output, Some(10));
    assert_eq!(usage.session_token_cache, Some(40));
    assert_eq!(usage.session_token_merge, SessionTokenMerge::TurnCommit);

    transport.shutdown();
}
