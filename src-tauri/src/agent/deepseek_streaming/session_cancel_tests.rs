//! 假 ACP 对端驱动 DeepSeek 会话：取消是通知，结算后轮次停止。

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::session::{DeepSeekSessionConfig, DeepSeekSessionHandle};
use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::types::agent_session_stream::AgentStreamEvent;

const FAKE_ACP: &str = r#"#!/usr/bin/env bash
log="__LOG__"
printf 'ARGV:%s\n' "$*" >> "$log"
prompt_open=0
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  printf '%s\n' "$line" >> "$log"
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  case "$method" in
    initialize)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1}}\n' "$id"
      ;;
    session/new)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"ds-session-cancel"}}\n' "$id"
      ;;
    session/prompt)
      if [[ "$prompt_open" -eq 0 ]]; then
        prompt_open=1
        while [[ ! -f "__CANCEL_SEEN__" ]]; do
          if printf '%s' "$line" | grep -q '"method":"session/cancel"'; then
            break
          fi
          if ! IFS= read -r line; then
            exit 0
          fi
          printf '%s\n' "$line" >> "$log"
          if printf '%s' "$line" | grep -q '"method":"session/cancel"'; then
            break
          fi
        done
        touch "__CANCEL_SEEN__"
        printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"cancelled"}}\n' "$id"
      else
        printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id"
      fi
      ;;
    session/cancel)
      touch "__CANCEL_SEEN__"
      ;;
  esac
done
"#;

#[test]
fn canceling_the_running_turn_notifies_acp_and_stops_as_canceled() {
    let temp = tempfile::tempdir().expect("temp");
    let log_path = temp.path().join("acp.log");
    let binary = write_fake_dsh(temp.path(), &log_path);
    let event_log = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let handle = DeepSeekSessionHandle::start(DeepSeekSessionConfig {
        project_id: 3,
        session_id: 5,
        binary: binary.to_string_lossy().into_owned(),
        cwd: temp.path().to_string_lossy().into_owned(),
        dangerous: false,
        mode_id: None,
        broadcaster: AgentEventBroadcaster::new(),
        event_log: Arc::clone(&event_log),
    })
    .expect("start");

    handle
        .send_message("请停下来".into())
        .expect("prompt starts");
    AgentSessionHandle::cancel_turn(&handle).expect("cancel notifies ACP");

    let events = wait_until(Duration::from_secs(5), &event_log, |events| {
        events
            .iter()
            .any(|event| matches!(event, AgentStreamEvent::TurnCanceled { .. }))
    });
    assert!(
        events.iter().any(|event| matches!(
            event,
            AgentStreamEvent::TurnCanceled { reason, .. } if reason == "cancelled"
        )),
        "取消结算必须是 TurnCanceled，实际：{events:?}"
    );
    assert!(
        events
            .iter()
            .all(|event| !matches!(event, AgentStreamEvent::TurnCompleted { .. })),
        "取消不得显示成正常完成：{events:?}"
    );

    let traffic = fs::read_to_string(&log_path).unwrap_or_default();
    let cancel_line = traffic
        .lines()
        .find(|line| line.contains("\"method\":\"session/cancel\""))
        .unwrap_or("");
    assert!(
        !cancel_line.is_empty(),
        "必须向 ACP 发送 session/cancel，实际：\n{traffic}"
    );
    assert!(
        !cancel_line.contains("\"id\""),
        "session/cancel 必须是无 id 的通知，实际：{cancel_line}"
    );
    assert!(
        cancel_line.contains("\"sessionId\":\"ds-session-cancel\""),
        "取消通知必须带当前 sessionId，实际：{cancel_line}"
    );

    handle
        .send_message("下一轮".into())
        .expect("turn stopped, so the next prompt is accepted");
    let events = wait_until(Duration::from_secs(5), &event_log, |events| {
        events.iter().any(|event| {
            matches!(
                event,
                AgentStreamEvent::TurnCompleted {
                    stop_reason: Some(reason),
                    ..
                } if reason == "end_turn"
            )
        })
    });
    assert!(events.iter().any(|event| matches!(
        event,
        AgentStreamEvent::TurnCompleted {
            stop_reason: Some(reason),
            ..
        } if reason == "end_turn"
    )));

    handle.shutdown();
}

const FAILING_ACP: &str = r#"#!/usr/bin/env bash
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  case "$method" in
    initialize)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1}}\n' "$id"
      ;;
    session/new)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"ds-session-fail"}}\n' "$id"
      ;;
    session/prompt)
      if [[ "$line" == *"再试一次"* ]]; then
        printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id"
      else
        printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32000,"message":"upstream exploded"}}\n' "$id"
      fi
      ;;
  esac
done
"#;

#[test]
fn failed_prompt_surfaces_the_reason_and_stops_the_turn() {
    let temp = tempfile::tempdir().expect("temp");
    let binary = write_script(temp.path(), "fake-fail.sh", FAILING_ACP);
    let event_log = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let handle = DeepSeekSessionHandle::start(DeepSeekSessionConfig {
        project_id: 4,
        session_id: 6,
        binary: binary.to_string_lossy().into_owned(),
        cwd: temp.path().to_string_lossy().into_owned(),
        dangerous: false,
        mode_id: None,
        broadcaster: AgentEventBroadcaster::new(),
        event_log: Arc::clone(&event_log),
    })
    .expect("start");

    handle.send_message("会失败".into()).expect("prompt starts");
    let events = wait_until(Duration::from_secs(5), &event_log, |events| {
        events
            .iter()
            .any(|event| matches!(event, AgentStreamEvent::TurnFailed { .. }))
    });
    assert!(
        events.iter().any(|event| matches!(
            event,
            AgentStreamEvent::TurnFailed { error, .. } if error.contains("upstream exploded")
        )),
        "失败消息流必须带原因，实际：{events:?}"
    );
    assert!(
        events
            .iter()
            .all(|event| !matches!(event, AgentStreamEvent::TurnCompleted { .. })),
        "失败不得显示成正常完成：{events:?}"
    );

    handle
        .send_message("再试一次".into())
        .expect("failed turn stopped, so the next prompt is accepted");
    let events = wait_until(Duration::from_secs(5), &event_log, |events| {
        events.iter().any(|event| {
            matches!(
                event,
                AgentStreamEvent::TurnCompleted {
                    stop_reason: Some(reason),
                    ..
                } if reason == "end_turn"
            )
        })
    });
    assert!(events.iter().any(|event| matches!(
        event,
        AgentStreamEvent::TurnCompleted {
            stop_reason: Some(reason),
            ..
        } if reason == "end_turn"
    )));

    handle.shutdown();
}

#[test]
fn cancel_without_a_running_turn_does_not_fail_the_session() {
    let temp = tempfile::tempdir().expect("temp");
    let binary = write_script(temp.path(), "fake-idle.sh", FAILING_ACP);
    let event_log = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let handle = DeepSeekSessionHandle::start(DeepSeekSessionConfig {
        project_id: 8,
        session_id: 9,
        binary: binary.to_string_lossy().into_owned(),
        cwd: temp.path().to_string_lossy().into_owned(),
        dangerous: false,
        mode_id: None,
        broadcaster: AgentEventBroadcaster::new(),
        event_log: Arc::clone(&event_log),
    })
    .expect("start");

    let error = AgentSessionHandle::cancel_turn(&handle).expect_err("idle cancel");
    assert!(matches!(error, AgentSessionError::NoInterruptibleTurn));
    let events = event_log.lock().expect("event log").clone();
    assert!(
        events
            .iter()
            .all(|event| !matches!(event, AgentStreamEvent::TurnFailed { .. })),
        "空取消不得把会话打成失败：{events:?}"
    );

    handle
        .send_message("再试一次".into())
        .expect("session still accepts a prompt");
    let events = wait_until(Duration::from_secs(5), &event_log, |events| {
        events.iter().any(|event| {
            matches!(
                event,
                AgentStreamEvent::TurnCompleted {
                    stop_reason: Some(reason),
                    ..
                } if reason == "end_turn"
            )
        })
    });
    assert!(
        events
            .iter()
            .all(|event| !matches!(event, AgentStreamEvent::TurnFailed { .. })),
        "空取消之后的正常轮不得失败：{events:?}"
    );

    handle.shutdown();
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

fn write_fake_dsh(dir: &Path, log_path: &Path) -> std::path::PathBuf {
    let script_path = dir.join("fake-dsh.sh");
    let cancel_seen = dir.join("cancel-seen");
    let script = FAKE_ACP
        .replace("__LOG__", &log_path.to_string_lossy())
        .replace("__CANCEL_SEEN__", &cancel_seen.to_string_lossy());
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

fn write_script(dir: &Path, name: &str, source: &str) -> std::path::PathBuf {
    let script_path = dir.join(name);
    fs::write(&script_path, source).expect("write fake dsh");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&script_path).expect("meta").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions).expect("chmod");
    }
    script_path
}
