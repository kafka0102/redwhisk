//! Grok 结构化会话测试的共享夹具。
//!
//! 仅测试编译；被 `session_tests` / `session_resume_tests` / `session_failure_tests`
//! 复用，避免各写一份「落盘假 `grok` 脚本 + 握手 + 事件断言」的样板。
//! 不启真实 grok、不依赖网络与凭据。

use super::*;
use crate::types::agent_session_stream::{AgentStreamEvent, AgentTimelineItem, ToolCallStatus};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// 基础假 ACP 服务端：`initialize` / `session/new` / `session/load`（可注入失败）/
/// `session/prompt`（一条最小轮次流 + 整会话累计用量）/ `session/cancel`。
pub(super) const FAKE_SERVER_TEMPLATE: &str = r#"#!/usr/bin/env bash
log="__LOG__"
fail_load="__FAIL_LOAD__"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  case "$method" in
    initialize)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}\n' "$id"
      ;;
    session/new)
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"grok-fake-1","update":{"sessionUpdate":"available_commands_update","commands":[]}}}\n'
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"grok-fake-1","configOptions":[{"id":"model","type":"select"}]}}\n' "$id"
      ;;
    session/load)
      if [ "$fail_load" = "1" ]; then
        printf '{"jsonrpc":"2.0","id":%s,"error":{"message":"session not found"}}\n' "$id"
      else
        printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"grok-fake-1"}}\n' "$id"
      fi
      ;;
    session/prompt)
      printf '{"jsonrpc":"2.0","method":"_x.ai/queue/changed","params":{"entries":[],"runningPromptId":"grok-prompt-1"}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"The"}},"_meta":{"promptId":"grok-prompt-1"}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hi"}},"_meta":{"promptId":"grok-prompt-1"}}}\n'
      printf '{"jsonrpc":"2.0","method":"_x.ai/session_notification","params":{"update":{"sessionUpdate":"turn_completed","usage":{"inputTokens":100,"outputTokens":10,"totalTokens":110,"cachedReadTokens":40,"cacheCreationTokens":0,"numTurns":1}}}}\n'
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn","_meta":{"promptId":"grok-prompt-1","usage":{"inputTokens":100,"outputTokens":10,"totalTokens":110,"cachedReadTokens":40,"cacheCreationTokens":0}}}}\n' "$id"
      ;;
    session/cancel)
      printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id"
      ;;
    *)
      printf '{"jsonrpc":"2.0","id":%s,"error":{"message":"unexpected method"}}\n' "$id"
      ;;
  esac
done
"#;

/// 落盘回放 [`FAKE_SERVER_TEMPLATE`] 的假服务端脚本，返回 (脚本路径, 日志路径)。
pub(super) fn write_fake_grok(dir: &Path, log_name: &str, fail_load: bool) -> (PathBuf, PathBuf) {
    let log_path = dir.join(log_name);
    let script_path = dir.join(format!("fake-{log_name}.sh"));
    let script = FAKE_SERVER_TEMPLATE
        .replace("__LOG__", &log_path.to_string_lossy())
        .replace("__FAIL_LOAD__", if fail_load { "1" } else { "0" });
    write_script(&script_path, &script);
    (script_path, log_path)
}

/// 把事件序列压成可断言的短标签，便于跨用例比较轮次口径。
pub(super) fn summarize(events: &[AgentStreamEvent]) -> Vec<String> {
    events
        .iter()
        .map(|event| match event {
            AgentStreamEvent::TurnStarted { .. } => "turn_started".to_string(),
            AgentStreamEvent::UsageUpdated { .. } => "usage_updated".to_string(),
            AgentStreamEvent::Timeline { item, .. } => match item {
                AgentTimelineItem::Reasoning { .. } => "reasoning".to_string(),
                AgentTimelineItem::AssistantMessage { .. } => "assistant_message".to_string(),
                AgentTimelineItem::ToolCall { status, .. } => match status {
                    ToolCallStatus::Completed => "tool_completed".to_string(),
                    ToolCallStatus::Failed => "tool_failed".to_string(),
                    _ => "tool_running".to_string(),
                },
                other => format!("timeline:{other:?}"),
            },
            other => format!("{other:?}"),
        })
        .collect()
}

/// 指向假服务端脚本的会话配置（危险模式 + full-access，与真机 TUI 默认对齐）。
pub(super) fn config(
    binary: &Path,
    cwd: &Path,
    resume_session_id: Option<&str>,
) -> GrokSessionConfig {
    GrokSessionConfig {
        project_id: 1,
        session_id: 2,
        binary: binary.to_string_lossy().into_owned(),
        cwd: cwd.to_string_lossy().into_owned(),
        model: Some("grok-4.7-build".into()),
        dangerous: true,
        mode_id: Some("full-access".into()),
        broadcaster: AgentEventBroadcaster::new(),
        resume_session_id: resume_session_id.map(str::to_string),
    }
}

/// 轮询等待假服务端日志出现指定内容，避免与写日志线程竞态。
pub(super) fn wait_for_log(path: &Path, needle: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let content = fs::read_to_string(path).unwrap_or_default();
        if content.contains(needle) {
            return content;
        }
        if Instant::now() >= deadline {
            panic!("fake grok never received {needle:?}; log:\n{content}");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// 写入可执行脚本并置 0o755（POSIX）。
pub(super) fn write_script(script_path: &Path, script: &str) {
    fs::write(script_path, script).expect("write fake grok");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(script_path).expect("meta").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(script_path, permissions).expect("chmod");
    }
}

/// 回放假服务端模板并替换 `__LOG__`，返回 (脚本路径, 日志路径)。
pub(super) fn write_fake_template(
    dir: &Path,
    log_name: &str,
    template: &str,
) -> (PathBuf, PathBuf) {
    let log_path = dir.join(log_name);
    let script_path = dir.join(format!("fake-{log_name}.sh"));
    write_script(
        &script_path,
        &template.replace("__LOG__", &log_path.to_string_lossy()),
    );
    (script_path, log_path)
}

/// spawn 假服务端并完成 `initialize` + `session/new` 握手。
pub(super) fn spawn_fake_transport(binary: &Path, cwd: &Path) -> GrokStreamingTransport {
    let transport = GrokStreamingTransport::spawn(
        &binary.to_string_lossy(),
        &["agent".into(), "stdio".into()],
        Some(&cwd.to_string_lossy()),
    )
    .expect("spawn fake grok");
    transport
        .request(INITIALIZE_METHOD, json!({"protocolVersion": 1}))
        .expect("initialize");
    transport
        .request(
            SESSION_NEW_METHOD,
            json!({"cwd": cwd.to_string_lossy(), "mcpServers": []}),
        )
        .expect("session/new");
    transport
}

/// 轮询等待 stderr 尾巴出现指定内容（规避与 stderr 读线程的竞态）。
pub(super) fn wait_for_stderr(transport: &GrokStreamingTransport, needle: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let tail = transport.stderr_tail();
        if tail.contains(needle) {
            return tail;
        }
        if Instant::now() >= deadline {
            panic!("stderr tail never contained {needle:?}: {tail:?}");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}
