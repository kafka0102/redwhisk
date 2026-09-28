//! `GrokSessionHandle` 异常路径集成测试：协议错误、进程异常退出与诊断信息。
//!
//! 用假 `grok` 可执行文件扮演 ACP 服务端；不启真实 grok、不依赖网络与凭据。

use super::session_test_support::*;
use super::*;
use crate::agent::grok_streaming::event_mapper::GrokStreamMapper;
use crate::types::agent_session_stream::AgentStreamEvent;
use std::time::Duration;

/// 回放 `session/prompt` 返回 JSON-RPC 协议错误的假服务端。
const FAKE_SERVER_PROMPT_ERROR_TEMPLATE: &str = r#"#!/usr/bin/env bash
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
      printf '{"jsonrpc":"2.0","id":%s,"error":{"message":"model overloaded"}}\n' "$id"
      ;;
    *)
      printf '{"jsonrpc":"2.0","id":%s,"error":{"message":"unexpected method"}}\n' "$id"
      ;;
  esac
done
"#;

/// 轮次进行中写 stderr 并以退出码 7 异常退出的假服务端。
const FAKE_SERVER_CRASH_TEMPLATE: &str = r#"#!/usr/bin/env bash
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
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"partial"}},"_meta":{"promptId":"grok-prompt-1"}}}\n'
      printf 'fatal: upstream exploded\n' >&2
      exit 7
      ;;
    *)
      printf '{"jsonrpc":"2.0","id":%s,"error":{"message":"unexpected method"}}\n' "$id"
      ;;
  esac
done
"#;

#[test]
fn prompt_protocol_error_maps_to_turn_failure_with_diagnostic() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, _log) = write_fake_template(
        temp.path(),
        "prompt-error.log",
        FAKE_SERVER_PROMPT_ERROR_TEMPLATE,
    );
    let transport = spawn_fake_transport(&binary, temp.path());

    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("local-turn".into());
    let error = transport
        .request(
            SESSION_PROMPT_METHOD,
            json!({"sessionId": "grok-fake-1", "prompt": [{"type": "text", "text": "hi"}]}),
        )
        .expect_err("prompt must fail on protocol error");
    assert!(
        matches!(error, GrokStreamingError::ServerError { .. }),
        "unexpected error {error:?}"
    );

    let events = mapper.on_prompt_error(error.to_string());
    match events.as_slice() {
        [
            AgentStreamEvent::TurnStarted { .. },
            AgentStreamEvent::TurnFailed { error, .. },
        ] => assert!(
            error.contains("model overloaded"),
            "turn failure must carry the server error, got {error:?}"
        ),
        other => panic!("unexpected {other:?}"),
    }

    transport.shutdown();
}

#[test]
fn process_exit_mid_turn_fails_with_stderr_tail() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, _log) = write_fake_template(temp.path(), "crash.log", FAKE_SERVER_CRASH_TEMPLATE);
    let transport = spawn_fake_transport(&binary, temp.path());
    let eof = transport.subscribe_eof();

    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("local-turn".into());
    let error = transport
        .request(
            SESSION_PROMPT_METHOD,
            json!({"sessionId": "grok-fake-1", "prompt": [{"type": "text", "text": "hi"}]}),
        )
        .expect_err("in-flight prompt must fail when the process dies");
    assert!(
        matches!(error, GrokStreamingError::Closed(_)),
        "unexpected error {error:?}"
    );

    let reason = eof
        .recv_timeout(Duration::from_secs(5))
        .expect("process EOF reason");
    let stderr = wait_for_stderr(&transport, "upstream exploded");
    assert!(
        reason.contains("stdout EOF"),
        "unexpected exit reason {reason:?}"
    );

    // 生产路径把该诊断并入轮次失败信息（含 stderr 尾巴）。
    let message = prompt_failure_message(&error, &transport);
    assert!(
        message.contains("upstream exploded"),
        "prompt failure must include stderr tail, got {message:?}"
    );

    let event = mapper
        .on_process_exit(format_unexpected_exit_error(&reason, &stderr))
        .expect("unfinished turn must fail");
    assert!(matches!(
        event,
        AgentStreamEvent::TurnFailed { error, .. } if error.contains("upstream exploded")
    ));

    transport.shutdown();
}
