//! 假 ACP 对端驱动 DeepSeek 续接：保存的 provider 会话标识走 `session/resume`。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::session::{DeepSeekSessionConfig, DeepSeekSessionHandle};
use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::provider_factory::{
    AgentSessionProviderFactory, AgentSessionStartRequest, DefaultAgentSessionProviderFactory,
    ThreadIdBackfill,
};
use crate::types::agent_profile::AgentType;
use crate::types::agent_session_stream::{AgentStreamEvent, AgentTimelineItem};

const SAVED_SESSION_ID: &str = "ds-saved";
const OLD_REPLY: &str = "旧答复";
const NEW_REPLY: &str = "新答复";

#[test]
fn new_session_publishes_the_provider_session_id_for_restart() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) = write_fake(temp.path(), "new.log", new_session_script());
    let event_log = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let handle =
        DeepSeekSessionHandle::start(config(&binary, temp.path(), None, Arc::clone(&event_log)))
            .expect("start");

    assert_eq!(handle.thread_id().as_deref(), Some("ds-session-1"));
    let events = event_log.lock().expect("events").clone();
    assert!(
        events.iter().any(|event| matches!(
            event,
            AgentStreamEvent::ThreadStarted { thread_id } if thread_id == "ds-session-1"
        )),
        "首次 session/new 必须把会话标识回流，实际：{events:?}"
    );
    let traffic = fs::read_to_string(&log).unwrap_or_default();
    assert!(traffic.contains("\"method\":\"session/new\""));
    assert!(!traffic.contains("\"method\":\"session/resume\""));
    handle.shutdown();
}

#[test]
fn restart_resumes_the_saved_session_and_appends_only_the_new_prompt() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) = write_fake(temp.path(), "resume.log", resume_script(false));
    let event_log = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let handle = DeepSeekSessionHandle::start(config(
        &binary,
        temp.path(),
        Some(SAVED_SESSION_ID),
        Arc::clone(&event_log),
    ))
    .expect("resume");

    assert_eq!(handle.thread_id().as_deref(), Some(SAVED_SESSION_ID));
    let before_prompt = event_log.lock().expect("events").clone();
    assert!(
        before_prompt
            .iter()
            .all(|event| !timeline_contains(event, OLD_REPLY)),
        "ACP 不回放旧更新时，不得把旧消息再插进消息流：{before_prompt:?}"
    );
    assert!(
        before_prompt
            .iter()
            .all(|event| !matches!(event, AgentStreamEvent::Timeline { .. })),
        "续接本身不产生 timeline：{before_prompt:?}"
    );

    handle.send_message("接着说".into()).expect("prompt");
    let events = wait_for_turn_completed(&event_log);
    assert_eq!(timeline_texts(&events, "user"), vec!["接着说".to_string()]);
    assert_eq!(
        timeline_texts(&events, "assistant"),
        vec![NEW_REPLY.to_string()]
    );
    assert!(
        events
            .iter()
            .all(|event| !timeline_contains(event, OLD_REPLY)),
        "旧答复不得重复出现：{events:?}"
    );

    let traffic = fs::read_to_string(&log).unwrap_or_default();
    assert!(
        traffic.contains("\"method\":\"session/resume\""),
        "再次启动必须 session/resume，实际：\n{traffic}"
    );
    assert!(
        traffic.contains(&format!("\"sessionId\":\"{SAVED_SESSION_ID}\"")),
        "续接与后续 prompt 必须沿用已保存标识，实际：\n{traffic}"
    );
    assert!(
        !traffic.contains("\"method\":\"session/new\""),
        "已有标识时不得再 session/new，实际：\n{traffic}"
    );
    handle.shutdown();
}

#[test]
fn factory_forwards_the_saved_id_into_session_resume() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) = write_fake(temp.path(), "factory.log", resume_script(false));
    let started = DefaultAgentSessionProviderFactory
        .start(AgentSessionStartRequest {
            agent_type: AgentType::DeepSeek,
            project_id: 7,
            session_id: 9,
            binary: binary.to_string_lossy().into_owned(),
            cwd: temp.path().to_string_lossy().into_owned(),
            mode_id: None,
            dangerous: false,
            model: None,
            effort: None,
            resume_thread_id: Some(SAVED_SESSION_ID.to_string()),
            broadcaster: AgentEventBroadcaster::new(),
            config_home: None,
        })
        .expect("factory resume");

    assert_eq!(started.backfill, ThreadIdBackfill::WhenPresent);
    assert_eq!(started.thread_id.as_deref(), Some(SAVED_SESSION_ID));
    assert_eq!(
        started.handle.thread_id().as_deref(),
        Some(SAVED_SESSION_ID)
    );
    let traffic = fs::read_to_string(&log).unwrap_or_default();
    assert!(traffic.contains("\"method\":\"session/resume\""));
    assert!(!traffic.contains("\"method\":\"session/new\""));
    started.handle.shutdown();
}

#[test]
fn rejected_resume_does_not_stay_running_and_records_the_failure() {
    let temp = tempfile::tempdir().expect("temp");
    let (binary, log) = write_fake(temp.path(), "reject.log", resume_script(true));
    let event_log = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let error = DeepSeekSessionHandle::start(config(
        &binary,
        temp.path(),
        Some(SAVED_SESSION_ID),
        Arc::clone(&event_log),
    ))
    .map(|handle| {
        handle.shutdown();
        panic!("resume 被拒绝时不得留下仍在运行的会话");
    })
    .expect_err("resume rejected");

    assert!(
        error.to_string().contains("session not found"),
        "失败事实必须带拒绝原因，实际：{error}"
    );
    let events = event_log.lock().expect("events").clone();
    assert!(
        events.iter().any(|event| matches!(
            event,
            AgentStreamEvent::TurnFailed { error, turn_id: None, .. }
                if error == "session not found"
        )),
        "消息流必须留下英文失败事实，实际：{events:?}"
    );
    assert!(
        events
            .iter()
            .all(|event| !matches!(event, AgentStreamEvent::TurnStarted { .. })),
        "拒绝后续接不得停在运行中：{events:?}"
    );
    assert_process_gone(&pid_path(&log));
    let traffic = fs::read_to_string(&log).unwrap_or_default();
    assert!(traffic.contains("\"method\":\"session/resume\""));
    assert!(
        !traffic.contains("\"method\":\"session/new\""),
        "拒绝后不得改开一个空会话，实际：\n{traffic}"
    );
}

fn config(
    binary: &Path,
    cwd: &Path,
    resume_session_id: Option<&str>,
    event_log: Arc<Mutex<Vec<AgentStreamEvent>>>,
) -> DeepSeekSessionConfig {
    DeepSeekSessionConfig {
        project_id: 7,
        session_id: 9,
        binary: binary.to_string_lossy().into_owned(),
        cwd: cwd.to_string_lossy().into_owned(),
        dangerous: false,
        mode_id: None,
        resume_session_id: resume_session_id.map(str::to_string),
        broadcaster: AgentEventBroadcaster::new(),
        event_log,
    }
}

fn resume_script(reject: bool) -> String {
    let resume_result = if reject {
        r#"printf '{"jsonrpc":"2.0","id":%s,"error":{"message":"session not found"}}\n' "$id""#
    } else {
        r#"printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"ds-saved","history":[{"text":"旧答复"}]}}\n' "$id""#
    };
    acp_script(resume_result, "ds-empty")
}

fn new_session_script() -> String {
    acp_script(
        r#"printf '{"jsonrpc":"2.0","id":%s,"error":{"message":"unexpected resume"}}\n' "$id""#,
        "ds-session-1",
    )
}

fn acp_script(resume_result: &str, new_session_id: &str) -> String {
    format!(
        r#"#!/usr/bin/env bash
log="__LOG__"
printf '%s\n' "$$" > "$log.pid"
printf 'ARGV:%s\n' "$*" >> "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  case "$method" in
    initialize)
      printf '{{"jsonrpc":"2.0","id":%s,"result":{{"protocolVersion":1}}}}\n' "$id"
      ;;
    session/resume)
      {resume_result}
      ;;
    session/new)
      printf '{{"jsonrpc":"2.0","id":%s,"result":{{"sessionId":"{new_session_id}"}}}}\n' "$id"
      ;;
    session/prompt)
      printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"update":{{"sessionUpdate":"agent_message_chunk","messageId":"msg-new","content":{{"type":"text","text":"新答复"}}}}}}}}'
      printf '{{"jsonrpc":"2.0","id":%s,"result":{{"stopReason":"end_turn"}}}}\n' "$id"
      ;;
    *)
      printf '{{"jsonrpc":"2.0","id":%s,"error":{{"message":"unexpected method"}}}}\n' "$id"
      ;;
  esac
done
"#,
        resume_result = resume_result,
        new_session_id = new_session_id
    )
}

fn pid_path(log: &Path) -> PathBuf {
    PathBuf::from(format!("{}.pid", log.display()))
}

fn assert_process_gone(pid_file: &Path) {
    let deadline = Instant::now() + Duration::from_secs(5);
    let pid = loop {
        if let Ok(text) = fs::read_to_string(pid_file) {
            if let Ok(pid) = text.trim().parse::<i32>() {
                break pid;
            }
        }
        if Instant::now() >= deadline {
            panic!("假 ACP 没有写下 pid：{}", pid_file.display());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    loop {
        let alive = std::process::Command::new("kill")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .args(["-0", &pid.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if !alive {
            return;
        }
        if Instant::now() >= deadline {
            panic!("resume 被拒绝后进程 {pid} 仍在运行");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn timeline_contains(event: &AgentStreamEvent, needle: &str) -> bool {
    match event {
        AgentStreamEvent::Timeline { item, .. } => match item {
            AgentTimelineItem::UserMessage { text, .. } => text.contains(needle),
            AgentTimelineItem::AssistantMessage { text, .. }
            | AgentTimelineItem::Reasoning { text, .. } => text.contains(needle),
            _ => false,
        },
        _ => false,
    }
}

fn timeline_texts(events: &[AgentStreamEvent], kind: &str) -> Vec<String> {
    events
        .iter()
        .filter_map(|event| match event {
            AgentStreamEvent::Timeline { item, .. } => match (kind, item) {
                ("user", AgentTimelineItem::UserMessage { text, .. }) => Some(text.clone()),
                ("assistant", AgentTimelineItem::AssistantMessage { text, .. }) => {
                    Some(text.to_string())
                }
                _ => None,
            },
            _ => None,
        })
        .collect()
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

fn wait_for_turn_completed(events: &Arc<Mutex<Vec<AgentStreamEvent>>>) -> Vec<AgentStreamEvent> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let current = events.lock().expect("event log").clone();
        if turn_completed(&current) {
            return current;
        }
        if Instant::now() >= deadline {
            panic!("新 prompt 没有出现在同一条消息流：{current:?}");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn write_fake(dir: &Path, log_name: &str, script: String) -> (PathBuf, PathBuf) {
    let log_path = dir.join(log_name);
    let script_path = dir.join(format!("fake-{log_name}.sh"));
    let script = script.replace("__LOG__", &log_path.to_string_lossy());
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
