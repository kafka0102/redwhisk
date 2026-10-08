//! 假 ACP 对端驱动 DeepSeek 会话：工具卡只走通用 timeline，不拆成命令或 diff。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::session::{DeepSeekSessionConfig, DeepSeekSessionHandle};
use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentTimelineItem, ToolCallDetail, ToolCallStatus,
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
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"ds-session-tools"}}\n' "$id"
      ;;
    session/prompt)
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"call-read","title":"read_file","status":"in_progress","rawInput":{"path":"/tmp/note.txt"}}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"call-read","status":"completed","content":[{"type":"content","content":{"type":"text","text":"笔记正文"}}]}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"call-fail","title":"bash","status":"in_progress","rawInput":{"command":"ls"}}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"call-fail","status":"failed","content":[{"type":"content","content":{"type":"text","text":"命令失败"}}]}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"call-bad","title":"custom_tool","status":"in_progress","rawInput":"not-json {"}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"call-edit","title":"apply_patch","status":"in_progress","rawInput":{"path":"src/a.rs"}}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"call-edit","status":"completed","content":[{"type":"diff","path":"src/a.rs","oldText":"old","newText":"+new line"},{"type":"content","content":{"type":"text","text":"已修改"}}]}}}'
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id"
      ;;
  esac
done
"#;

#[test]
fn tool_updates_become_generic_cards_with_readable_results() {
    let temp = tempfile::tempdir().expect("temp");
    let binary = write_fake_dsh(temp.path());
    let event_log = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let handle = DeepSeekSessionHandle::start(DeepSeekSessionConfig {
        project_id: 3,
        session_id: 4,
        binary: binary.to_string_lossy().into_owned(),
        cwd: temp.path().to_string_lossy().into_owned(),
        dangerous: false,
        mode_id: None,
        broadcaster: AgentEventBroadcaster::new(),
        event_log: Arc::clone(&event_log),
    })
    .expect("start deepseek session");

    handle.send_message("请用工具".into()).expect("send prompt");
    let events = wait_for_turn_completed(&event_log);
    let tools = tool_snapshots(&events);

    let read_running = first_tool(&tools, "call-read");
    assert_eq!(read_running.name, "read_file");
    assert_eq!(read_running.status, ToolCallStatus::Running);
    assert_eq!(
        read_running.raw_input.as_deref(),
        Some(r#"{"path":"/tmp/note.txt"}"#)
    );

    let read_done = last_tool(&tools, "call-read");
    assert_eq!(read_done.status, ToolCallStatus::Completed);
    assert_eq!(read_done.raw_output.as_deref(), Some("笔记正文"));
    assert!(
        tool_index(&tools, "call-read", ToolCallStatus::Running)
            < tool_index(&tools, "call-read", ToolCallStatus::Completed)
    );

    let failed = last_tool(&tools, "call-fail");
    assert_eq!(failed.name, "bash");
    assert_eq!(failed.status, ToolCallStatus::Failed);
    assert_eq!(failed.raw_output.as_deref(), Some("命令失败"));

    let invalid = first_tool(&tools, "call-bad");
    assert_eq!(invalid.name, "custom_tool");
    assert_eq!(invalid.status, ToolCallStatus::Running);
    assert_eq!(invalid.raw_input.as_deref(), Some("not-json {"));

    let edited = last_tool(&tools, "call-edit");
    assert_eq!(edited.name, "apply_patch");
    assert_eq!(edited.status, ToolCallStatus::Completed);
    assert_eq!(edited.raw_output.as_deref(), Some("已修改"));
    assert_ne!(edited.raw_output.as_deref(), Some("+new line"));

    assert!(
        tools.iter().all(|tool| tool.generic),
        "工具卡必须保持通用详情，不能变成命令输出或文件 diff：{tools:?}"
    );

    handle.shutdown();
}

#[derive(Debug)]
struct ToolSnapshot {
    call_id: String,
    name: String,
    status: ToolCallStatus,
    raw_input: Option<String>,
    raw_output: Option<String>,
    generic: bool,
}

fn tool_snapshots(events: &[AgentStreamEvent]) -> Vec<ToolSnapshot> {
    events
        .iter()
        .filter_map(|event| match event {
            AgentStreamEvent::Timeline {
                item:
                    AgentTimelineItem::ToolCall {
                        call_id,
                        name,
                        detail,
                        status,
                        ..
                    },
                ..
            } => {
                let (raw_input, raw_output, generic) = match detail {
                    ToolCallDetail::Unknown {
                        raw_input,
                        raw_output,
                    } => (raw_input.clone(), raw_output.clone(), true),
                    _ => (None, None, false),
                };
                Some(ToolSnapshot {
                    call_id: call_id.clone(),
                    name: name.clone(),
                    status: *status,
                    raw_input,
                    raw_output,
                    generic,
                })
            }
            _ => None,
        })
        .collect()
}

fn first_tool<'a>(tools: &'a [ToolSnapshot], call_id: &str) -> &'a ToolSnapshot {
    tools
        .iter()
        .find(|tool| tool.call_id == call_id)
        .unwrap_or_else(|| panic!("缺少工具卡 {call_id}：{tools:?}"))
}

fn last_tool<'a>(tools: &'a [ToolSnapshot], call_id: &str) -> &'a ToolSnapshot {
    tools
        .iter()
        .rev()
        .find(|tool| tool.call_id == call_id)
        .unwrap_or_else(|| panic!("缺少工具卡 {call_id}：{tools:?}"))
}

fn tool_index(tools: &[ToolSnapshot], call_id: &str, status: ToolCallStatus) -> usize {
    tools
        .iter()
        .position(|tool| tool.call_id == call_id && tool.status == status)
        .unwrap_or_else(|| panic!("缺少 {call_id} / {status:?}：{tools:?}"))
}

fn wait_for_turn_completed(events: &Arc<Mutex<Vec<AgentStreamEvent>>>) -> Vec<AgentStreamEvent> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let current = events.lock().expect("event log").clone();
        let started = current
            .iter()
            .any(|event| matches!(event, AgentStreamEvent::TurnStarted { .. }));
        let completed = current.iter().any(|event| {
            matches!(
                event,
                AgentStreamEvent::TurnCompleted {
                    stop_reason: Some(reason),
                    ..
                } if reason == "end_turn"
            )
        });
        if started && completed {
            return current;
        }
        if Instant::now() >= deadline {
            panic!("prompt 没有在时限内结束：{current:?}");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn write_fake_dsh(dir: &Path) -> PathBuf {
    let log_path = dir.join("acp.log");
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
