//! 假 ACP 对端驱动 DeepSeek 会话：断言已提交答复、推理块和轮次。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::session::{DeepSeekSessionConfig, DeepSeekSessionHandle};
use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::types::agent_session_stream::{AgentStreamEvent, AgentTimelineItem};

const FAKE_ACP: &str = r#"#!/usr/bin/env bash
log="__LOG__"
printf 'ARGV:%s\n' "$*" >> "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  case "$method" in
    initialize)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1,"extra":true}}\n' "$id"
      ;;
    session/new)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"ds-session-1","modes":["plan"]}}\n' "$id"
      ;;
    session/prompt)
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"usage_update","used":12,"size":100,"futureField":true}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_thought_chunk","messageId":"thought-1","content":{"type":"text","text":"先想清楚"},"vendor":{"trace":1}}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","messageId":"msg-1","content":{"type":"text","text":"第一段"},"extra":1}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","messageId":"msg-1","content":{"type":"text","text":"第二段"}}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"not_a_real_update","payload":{"keep":true}}}}'
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn","_meta":{"usage":{"used":12,"size":100}}}}\n' "$id"
      ;;
    *)
      printf '{"jsonrpc":"2.0","id":%s,"error":{"message":"unexpected method"}}\n' "$id"
      ;;
  esac
done
"#;

#[test]
fn committed_chunks_merge_into_one_assistant_message_and_end_the_turn() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) = write_fake_dsh(temp.path());
    let event_log = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let handle = DeepSeekSessionHandle::start(DeepSeekSessionConfig {
        project_id: 7,
        session_id: 9,
        binary: binary.to_string_lossy().into_owned(),
        cwd: temp.path().to_string_lossy().into_owned(),
        dangerous: false,
        mode_id: None,
        broadcaster: AgentEventBroadcaster::new(),
        event_log: Arc::clone(&event_log),
    })
    .expect("start deepseek session");

    assert_eq!(handle.thread_id().as_deref(), Some("ds-session-1"));
    handle.send_message("请回答".into()).expect("send prompt");

    let events = wait_for_turn_completed(&event_log);
    let user_texts = timeline_texts(&events, "user");
    let assistant_texts = timeline_texts(&events, "assistant");
    let reasoning_texts = timeline_texts(&events, "reasoning");

    assert_eq!(user_texts, vec!["请回答".to_string()]);
    assert_eq!(
        assistant_texts.last().map(String::as_str),
        Some("第一段第二段")
    );
    assert!(
        assistant_texts.iter().all(|text| text != "第二段"),
        "同一 messageId 不得只留下后一段：{assistant_texts:?}"
    );
    assert_eq!(assistant_message_ids(&events), vec!["msg-1".to_string()]);
    assert_eq!(reasoning_texts, vec!["先想清楚".to_string()]);
    assert!(
        events.iter().any(|event| matches!(
            event,
            AgentStreamEvent::Timeline {
                item: AgentTimelineItem::Reasoning {
                    duration_ms: Some(_),
                    ..
                },
                ..
            }
        )),
        "已提交思考必须带结束时长，不能停在正在思考"
    );
    assert!(turn_started_before_completed(&events));
    assert!(
        events
            .iter()
            .all(|event| !matches!(event, AgentStreamEvent::UsageUpdated { .. })),
        "上下文窗口占用不得写入用量事件：{events:?}"
    );
    assert!(events.iter().all(|event| {
        !matches!(
            event,
            AgentStreamEvent::ModeChanged { .. }
                | AgentStreamEvent::ModelChanged { .. }
                | AgentStreamEvent::EffortChanged { .. }
        )
    }));

    let traffic = fs::read_to_string(&log).unwrap_or_default();
    assert!(
        traffic.contains("ARGV:--profile acp\n"),
        "启动参数必须是 --profile acp，实际：\n{traffic}"
    );
    assert!(!traffic.contains("sdk"));
    assert!(!traffic.contains("web"));
    assert!(traffic.contains("\"method\":\"initialize\""));
    assert!(traffic.contains("\"method\":\"session/new\""));
    assert!(traffic.contains("\"method\":\"session/prompt\""));
    assert!(traffic.contains("请回答"));

    handle.shutdown();
}

#[test]
fn second_prompt_is_rejected_while_the_first_turn_is_still_running() {
    let temp = tempfile::tempdir().expect("temp");
    let log_path = temp.path().join("hold.log");
    let script_path = temp.path().join("fake-hold.sh");
    let script = format!(
        r#"#!/usr/bin/env bash
log="{log}"
printf 'ARGV:%s\n' "$*" >> "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  case "$method" in
    initialize)
      printf '{{"jsonrpc":"2.0","id":%s,"result":{{"protocolVersion":1}}}}\n' "$id"
      ;;
    session/new)
      printf '{{"jsonrpc":"2.0","id":%s,"result":{{"sessionId":"ds-session-1"}}}}\n' "$id"
      ;;
    session/prompt)
      sleep 30
      ;;
  esac
done
"#,
        log = log_path.display()
    );
    fs::write(&script_path, script).expect("write");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&script_path).expect("meta").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions).expect("chmod");
    }
    let handle = DeepSeekSessionHandle::start(DeepSeekSessionConfig {
        project_id: 1,
        session_id: 2,
        binary: script_path.to_string_lossy().into_owned(),
        cwd: temp.path().to_string_lossy().into_owned(),
        dangerous: false,
        mode_id: None,
        broadcaster: AgentEventBroadcaster::new(),
        event_log: Arc::new(Mutex::new(Vec::new())),
    })
    .expect("start");
    handle.send_message("第一轮".into()).expect("first prompt");
    let error = handle.send_message("第二轮".into()).expect_err("busy");
    assert!(error.to_string().contains("未结束"));
    handle.shutdown();
}

fn timeline_texts(events: &[AgentStreamEvent], kind: &str) -> Vec<String> {
    events
        .iter()
        .filter_map(|event| match event {
            AgentStreamEvent::Timeline { item, .. } => match (kind, item) {
                ("user", AgentTimelineItem::UserMessage { text, .. }) => Some(text.clone()),
                ("assistant", AgentTimelineItem::AssistantMessage { text, .. }) => {
                    Some(text.clone())
                }
                ("reasoning", AgentTimelineItem::Reasoning { text, .. }) => Some(text.clone()),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

fn assistant_message_ids(events: &[AgentStreamEvent]) -> Vec<String> {
    let mut ids = Vec::new();
    for event in events {
        if let AgentStreamEvent::Timeline {
            item: AgentTimelineItem::AssistantMessage { message_id, .. },
            ..
        } = event
        {
            let id = message_id.clone().unwrap_or_default();
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    ids
}

fn turn_started_before_completed(events: &[AgentStreamEvent]) -> bool {
    let started = events
        .iter()
        .position(|event| matches!(event, AgentStreamEvent::TurnStarted { .. }));
    let completed = events.iter().position(|event| {
        matches!(
            event,
            AgentStreamEvent::TurnCompleted {
                stop_reason: Some(reason),
                ..
            } if reason == "end_turn"
        )
    });
    match (started, completed) {
        (Some(started), Some(completed)) => started < completed,
        _ => false,
    }
}

fn wait_for_turn_completed(events: &Arc<Mutex<Vec<AgentStreamEvent>>>) -> Vec<AgentStreamEvent> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let current = events.lock().expect("event log").clone();
        if turn_started_before_completed(&current) {
            return current;
        }
        if Instant::now() >= deadline {
            panic!("prompt 没有在时限内从运行变为结束：{current:?}");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn write_fake_dsh(dir: &Path) -> (PathBuf, PathBuf) {
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
    (script_path, log_path)
}
