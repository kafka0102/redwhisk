//! `GrokSessionHandle` 反向请求（权限审批）用例：假 grok 发 `session/request_permission`。
//!
//! 真机现场：grok 进入 `permission_prompt` 后一直等客户端写回，客户端不回复整轮就
//! 永久挂住（会话日志停在 `tool_call` + `status: running`）。因此这里断言的核心是
//! **反向请求一定有回复**：auto 模式直接放行，安全模式挂卡片等用户决策，未支持的
//! 请求回 JSON-RPC error，都不能静默丢弃。

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::session_test_support::*;
use super::*;
use crate::types::agent_session::AgentPermissionDecision;
use crate::types::agent_session_stream::{AgentStreamEvent, PermissionKind};

/// 真机 grok 1.0.52 的权限反向请求形状（`id` 从 0 起编号，四个一次性/长期选项）。
const PERMISSION_REQUEST: &str = r#"{"jsonrpc":"2.0","id":0,"method":"session/request_permission","params":{"sessionId":"grok-perm-1","toolCall":{"toolCallId":"call-1","title":"Run python3 -c print(1)","rawInput":{"command":"python3 -c print(1)"}},"options":[{"optionId":"always-allow","name":"Yes, and do not ask again for bash commands","kind":"allow_always"},{"optionId":"allow-once","name":"Yes, proceed","kind":"allow_once"},{"optionId":"reject-once","name":"No, and tell Grok what to do differently","kind":"reject_once"},{"optionId":"reject-always","name":"No, and do not ask again for this command","kind":"reject_always"}]}}"#;

/// 同形态但方法不是权限请求：客户端应回 error，让 grok 立即失败而不是永久等待。
const ASK_USER_QUESTION: &str = r#"{"jsonrpc":"2.0","id":0,"method":"x.ai/ask_user_question","params":{"sessionId":"grok-perm-1","questions":[]}}"#;

#[test]
fn always_approve_session_allows_once_without_a_card() {
    assert_auto_allow(true, Some("full-access"));
}

#[test]
fn dangerous_profile_allows_once_without_a_card() {
    assert_auto_allow(true, None);
}

fn assert_auto_allow(dangerous: bool, mode_id: Option<&str>) {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) =
        write_fake_reverse_request_server(temp.path(), "perm.log", PERMISSION_REQUEST);
    let config = grok_session_config_with_mode(&binary, temp.path(), None, dangerous, mode_id);
    let events = Arc::clone(&config.event_log);
    let handle = GrokSessionHandle::start(config).expect("start grok session");

    handle
        .send_message("跑个命令".into(), Vec::new())
        .expect("prompt");

    let reply = wait_for_reverse_reply(&log);
    assert_eq!(
        reply["result"],
        serde_json::json!({"outcome": {"outcome": "selected", "optionId": "allow-once"}}),
        "--always-approve 会话必须直接回一次性允许"
    );
    assert!(
        events.lock().expect("event log").is_empty(),
        "自动放行不得发权限卡：{:?}",
        events.lock().expect("event log")
    );
    handle.shutdown();
}

#[test]
fn safe_mode_shows_the_card_and_writes_the_decision_back() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) =
        write_fake_reverse_request_server(temp.path(), "perm.log", PERMISSION_REQUEST);
    let config = grok_session_config_with_mode(&binary, temp.path(), None, false, None);
    let events = Arc::clone(&config.event_log);
    let handle = GrokSessionHandle::start(config).expect("start grok session");

    handle
        .send_message("跑个命令".into(), Vec::new())
        .expect("prompt");
    let request = wait_for_permission_request(&events);
    assert_eq!(request.id, "0");
    assert_eq!(request.kind, PermissionKind::Tool);
    assert_eq!(request.title.as_deref(), Some("Run python3 -c print(1)"));
    assert!(
        raw_traffic(&log)
            .lines()
            .all(|line| !line.contains("\"id\":0")),
        "用户还没决策，不得抢先写回：{}",
        raw_traffic(&log)
    );

    AgentSessionHandle::respond_permission(&handle, "0", AgentPermissionDecision::Accept)
        .expect("allow");

    let reply = wait_for_reverse_reply(&log);
    assert_eq!(
        reply["result"],
        serde_json::json!({"outcome": {"outcome": "selected", "optionId": "allow-once"}})
    );
    wait_for_resolution(&events, "0", "accept");
    handle.shutdown();
}

#[test]
fn safe_mode_decline_writes_the_reject_once_option() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) =
        write_fake_reverse_request_server(temp.path(), "perm.log", PERMISSION_REQUEST);
    let config = grok_session_config_with_mode(&binary, temp.path(), None, false, None);
    let events = Arc::clone(&config.event_log);
    let handle = GrokSessionHandle::start(config).expect("start grok session");

    handle
        .send_message("跑个命令".into(), Vec::new())
        .expect("prompt");
    wait_for_permission_request(&events);

    AgentSessionHandle::respond_permission(&handle, "0", AgentPermissionDecision::Decline)
        .expect("deny");

    let reply = wait_for_reverse_reply(&log);
    assert_eq!(
        reply["result"],
        serde_json::json!({"outcome": {"outcome": "selected", "optionId": "reject-once"}})
    );
    wait_for_resolution(&events, "0", "decline");
    handle.shutdown();
}

#[test]
fn unsupported_reverse_request_is_answered_with_an_error_instead_of_being_dropped() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) =
        write_fake_reverse_request_server(temp.path(), "perm.log", ASK_USER_QUESTION);
    let config = grok_session_config_with_mode(&binary, temp.path(), None, false, None);
    let handle = GrokSessionHandle::start(config).expect("start grok session");

    handle
        .send_message("问个问题".into(), Vec::new())
        .expect("prompt");

    let reply = wait_for_reverse_reply(&log);
    let message = reply["error"]["message"].as_str().unwrap_or_default();
    assert!(
        message.contains("unhandled ACP request: x.ai/ask_user_question"),
        "未支持的反向请求必须回 error：{reply}"
    );
    handle.shutdown();
}

#[test]
fn resolving_an_unknown_request_is_a_protocol_error() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, _log) =
        write_fake_reverse_request_server(temp.path(), "perm.log", PERMISSION_REQUEST);
    let config = grok_session_config_with_mode(&binary, temp.path(), None, false, None);
    let handle = GrokSessionHandle::start(config).expect("start grok session");

    let error = AgentSessionHandle::respond_permission(
        &handle,
        "does-not-exist",
        AgentPermissionDecision::Accept,
    )
    .expect_err("unknown request id");
    assert!(
        error.to_string().contains("does-not-exist"),
        "错误须可追溯：{error}"
    );
    handle.shutdown();
}

fn wait_for_permission_request(
    events: &Arc<Mutex<Vec<AgentStreamEvent>>>,
) -> crate::types::agent_session_stream::AgentPermissionRequest {
    wait_until(Duration::from_secs(10), events, |current| {
        current
            .iter()
            .any(|event| matches!(event, AgentStreamEvent::PermissionRequested { .. }))
    })
    .into_iter()
    .find_map(|event| match event {
        AgentStreamEvent::PermissionRequested { request } => Some(request),
        _ => None,
    })
    .expect("permission request")
}

fn wait_for_resolution(
    events: &Arc<Mutex<Vec<AgentStreamEvent>>>,
    request_id: &str,
    resolution: &str,
) {
    wait_until(Duration::from_secs(10), events, |current| {
        current.iter().any(|event| {
            matches!(
                event,
                AgentStreamEvent::PermissionResolved { request_id: id, resolution: value }
                    if id == request_id && value == resolution
            )
        })
    });
}

/// 等假 grok 收到写回的响应（日志里 `"id":0` 那一行，即反向请求的回复）。
fn wait_for_reverse_reply(log_path: &Path) -> Value {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let traffic = raw_traffic(log_path);
        if let Some(reply) = traffic
            .lines()
            .find(|line| line.contains("\"id\":0"))
            .map(str::to_string)
        {
            return serde_json::from_str(&reply).unwrap_or_else(|error| panic!("{error}: {reply}"));
        }
        if Instant::now() >= deadline {
            panic!("grok 没等到反向请求的回复，整轮会挂住：{traffic}");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn raw_traffic(log_path: &Path) -> String {
    fs::read_to_string(log_path).unwrap_or_default()
}

fn wait_until(
    budget: Duration,
    events: &Arc<Mutex<Vec<AgentStreamEvent>>>,
    ready: impl Fn(&[AgentStreamEvent]) -> bool,
) -> Vec<AgentStreamEvent> {
    let deadline = Instant::now() + budget;
    loop {
        let current = events.lock().expect("event log").clone();
        if ready(&current) {
            return current;
        }
        if Instant::now() >= deadline {
            panic!("事件没有在时限内出现：{current:?}");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}
