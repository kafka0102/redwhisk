//! 假 ACP 对端驱动 DeepSeek 会话：权限请求走既有卡片，允许写回一次性选项。

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::session::{DeepSeekSessionConfig, DeepSeekSessionHandle};
use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::session_handle::AgentSessionHandle;
use crate::types::agent_session::AgentPermissionDecision;
use crate::types::agent_session_stream::{
    AgentPermissionAction, AgentPermissionRequest, AgentStreamEvent, PermissionBehavior,
    PermissionKind,
};

const FAKE_ACP: &str = r#"#!/usr/bin/env bash
log="__LOG__"
printf 'ARGV:%s\n' "$*" >> "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  case "$method" in
    initialize)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1}}\n' "$id"
      ;;
    session/new)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"ds-perm-1"}}\n' "$id"
      ;;
    session/prompt)
      printf '%s\n' '{"jsonrpc":"2.0","id":42,"method":"session/request_permission","params":{"sessionId":"ds-perm-1","futureField":true,"toolCall":{"toolCallId":"call-1","title":"读取密钥","kind":"read","status":"pending","rawInput":{"path":"/tmp/secret"},"extra":1},"options":[{"optionId":"opt-allow-once","name":"Allow once","kind":"allow_once","extra":true},{"optionId":"opt-allow-always","name":"Always allow","kind":"allow_always"},{"optionId":"opt-reject-once","name":"Reject once","kind":"reject_once"},{"optionId":"opt-reject-always","name":"Reject always","kind":"reject_always"}]}}'
      IFS= read -r reply || exit 0
      printf '%s\n' "$reply" >> "$log"
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id"
      ;;
  esac
done
"#;

#[test]
fn permission_request_uses_existing_card_and_allow_writes_once_option() {
    let temp = tempfile::tempdir().expect("temp");
    let log_path = temp.path().join("acp.log");
    let binary = write_fake_dsh(temp.path(), &log_path);
    let event_log = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let handle = start_session(&binary, temp.path(), &event_log);

    handle.send_message("请读密钥".into()).expect("prompt");
    let requested = wait_until(Duration::from_secs(5), &event_log, |events| {
        events
            .iter()
            .any(|event| matches!(event, AgentStreamEvent::PermissionRequested { .. }))
    });
    let request = permission_request(&requested);
    assert_eq!(request.id, "42");
    assert_eq!(request.kind, PermissionKind::Tool);
    assert_eq!(request.title.as_deref(), Some("读取密钥"));
    assert_eq!(
        request.actions,
        vec![
            AgentPermissionAction {
                id: "accept".into(),
                label: "Allow".into(),
                behavior: PermissionBehavior::Allow,
            },
            AgentPermissionAction {
                id: "decline".into(),
                label: "Deny".into(),
                behavior: PermissionBehavior::Deny,
            },
        ]
    );

    AgentSessionHandle::respond_permission(&handle, "42", AgentPermissionDecision::Accept)
        .expect("allow");

    let resolved = wait_until(Duration::from_secs(5), &event_log, |events| {
        events.iter().any(|event| {
            matches!(
                event,
                AgentStreamEvent::PermissionResolved { request_id, .. } if request_id == "42"
            )
        }) && turn_completed(events)
    });
    assert!(
        resolved.iter().any(|event| matches!(
            event,
            AgentStreamEvent::PermissionResolved {
                request_id,
                resolution,
            } if request_id == "42" && resolution == "accept"
        )),
        "允许后既有权限卡应消失：{resolved:?}"
    );
    assert_eq!(permission_reply(&log_path)["result"], allow_once_result());
    handle.shutdown();
}

#[test]
fn permission_decline_writes_the_one_time_reject_option_and_clears_the_card() {
    let temp = tempfile::tempdir().expect("temp");
    let log_path = temp.path().join("acp.log");
    let binary = write_fake_dsh(temp.path(), &log_path);
    let event_log = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let handle = start_session(&binary, temp.path(), &event_log);

    handle.send_message("请读密钥".into()).expect("prompt");
    wait_until(Duration::from_secs(5), &event_log, |events| {
        events
            .iter()
            .any(|event| matches!(event, AgentStreamEvent::PermissionRequested { .. }))
    });
    AgentSessionHandle::respond_permission(&handle, "42", AgentPermissionDecision::Decline)
        .expect("deny");

    let resolved = wait_until(Duration::from_secs(5), &event_log, |events| {
        events.iter().any(|event| {
            matches!(
                event,
                AgentStreamEvent::PermissionResolved { request_id, resolution }
                    if request_id == "42" && resolution == "decline"
            )
        }) && turn_completed(events)
    });
    assert!(
        resolved
            .iter()
            .all(|event| !matches!(event, AgentStreamEvent::PermissionRequested { request } if request.id != "42")),
        "拒绝仍使用同一张既有权限卡：{resolved:?}"
    );
    assert_eq!(
        permission_reply(&log_path)["result"],
        serde_json::json!({
            "outcome": { "outcome": "selected", "optionId": "opt-reject-once" }
        })
    );
    handle.shutdown();
}

#[test]
fn dangerous_profile_allows_once_without_a_permission_card() {
    assert_auto_allow(true, None);
}

#[test]
fn full_access_mode_allows_once_without_a_permission_card() {
    assert_auto_allow(false, Some("full-access".to_string()));
}

fn allow_once_result() -> Value {
    serde_json::json!({
        "outcome": { "outcome": "selected", "optionId": "opt-allow-once" }
    })
}

fn permission_request(events: &[AgentStreamEvent]) -> AgentPermissionRequest {
    events
        .iter()
        .find_map(|event| match event {
            AgentStreamEvent::PermissionRequested { request } => Some(request.clone()),
            _ => None,
        })
        .expect("permission request")
}

fn permission_reply(log_path: &Path) -> Value {
    let traffic = fs::read_to_string(log_path).unwrap_or_default();
    let reply = traffic
        .lines()
        .find(|line| line.contains("\"outcome\""))
        .unwrap_or_else(|| panic!("ACP 没有收到权限回复：{traffic}"));
    serde_json::from_str(reply).unwrap_or_else(|error| panic!("{error}: {reply}"))
}

fn turn_completed(events: &[AgentStreamEvent]) -> bool {
    events.iter().any(|event| {
        matches!(
            event,
            AgentStreamEvent::TurnCompleted {
                stop_reason: Some(reason),
                ..
            } if reason == "end_turn"
        )
    })
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

fn assert_auto_allow(dangerous: bool, mode_id: Option<String>) {
    let temp = tempfile::tempdir().expect("temp");
    let log_path = temp.path().join("acp.log");
    let binary = write_fake_dsh(temp.path(), &log_path);
    let event_log = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let handle = DeepSeekSessionHandle::start(DeepSeekSessionConfig {
        project_id: 3,
        session_id: 8,
        binary: binary.to_string_lossy().into_owned(),
        cwd: temp.path().to_string_lossy().into_owned(),
        dangerous,
        mode_id,
        resume_session_id: None,
        broadcaster: AgentEventBroadcaster::new(),
        event_log: Arc::clone(&event_log),
    })
    .expect("start");

    handle.send_message("请读密钥".into()).expect("prompt");
    let events = wait_until(Duration::from_secs(5), &event_log, turn_completed);
    assert!(
        events
            .iter()
            .all(|event| !matches!(event, AgentStreamEvent::PermissionRequested { .. })),
        "自动允许不得发出需要用户处理的权限卡：{events:?}"
    );
    assert_eq!(permission_reply(&log_path)["result"], allow_once_result());
    handle.shutdown();
}

fn start_session(
    binary: &Path,
    cwd: &Path,
    event_log: &Arc<Mutex<Vec<AgentStreamEvent>>>,
) -> DeepSeekSessionHandle {
    DeepSeekSessionHandle::start(DeepSeekSessionConfig {
        project_id: 3,
        session_id: 8,
        binary: binary.to_string_lossy().into_owned(),
        cwd: cwd.to_string_lossy().into_owned(),
        dangerous: false,
        mode_id: None,
        resume_session_id: None,
        broadcaster: AgentEventBroadcaster::new(),
        event_log: Arc::clone(event_log),
    })
    .expect("start")
}

fn write_fake_dsh(dir: &Path, log_path: &Path) -> std::path::PathBuf {
    let script_path = dir.join("fake-dsh.sh");
    let script = FAKE_ACP.replace("__LOG__", &log_path.to_string_lossy());
    fs::write(&script_path, script).expect("write fake dsh");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&script_path).expect("meta").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions).expect("chmod");
    }
    script_path
}
