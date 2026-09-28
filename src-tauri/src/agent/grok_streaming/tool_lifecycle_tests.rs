//! `GrokStreamMapper` 工具调用生命周期单测：用实测 ACP 工具报文样例驱动。
//!
//! fixture 取自 `docs/survey/grok-build-cli-probe-notes.md`（`grok 1.0.41` 实测）§3.5。

use super::*;
use serde_json::json;

use crate::types::agent_session_stream::ToolCallDetail;

fn prompt_meta(prompt_id: &str) -> Value {
    json!({ "promptId": prompt_id, "agentTimestampMs": 1_790_517_500_401i64 })
}

/// 最近一条 `ToolCall` 时间线事件的可断言快照。
#[derive(Debug, Clone)]
struct ToolCallSnapshot {
    call_id: String,
    name: String,
    status: ToolCallStatus,
    detail: ToolCallDetail,
}

fn last_tool_call(events: &[AgentStreamEvent]) -> ToolCallSnapshot {
    match events.last() {
        Some(AgentStreamEvent::Timeline {
            item:
                AgentTimelineItem::ToolCall {
                    call_id,
                    name,
                    detail,
                    status,
                    ..
                },
            ..
        }) => ToolCallSnapshot {
            call_id: call_id.clone(),
            name: name.clone(),
            status: *status,
            detail: detail.clone(),
        },
        other => panic!("unexpected {other:?}"),
    }
}

/// 真实 `read_file` 报文（§3.5）：`tool_call`（Pending，完整 `rawInput`）→
/// 进行中 `tool_call_update`（带 `variant` / `locations`、无 status）→ completed。
/// ACP 的 Pending / InProgress 都归一到 `ToolCallStatus::Running`（`ToolCallStatus`
/// 无 Pending 变体）。
#[test]
fn maps_tool_call_lifecycle_pending_running_to_completed() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());

    let events = mapper.on_notification(
        "session/update",
        &json!({
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "call-1",
                "title": "read_file",
                "rawInput": {"target_file": "/tmp/hello.txt"},
                "_meta": {"x.ai/tool": {"name": "read_file", "kind": "read", "label": "Read"}}
            },
            "_meta": prompt_meta("p-1")
        }),
    );
    let pending = last_tool_call(&events);
    assert_eq!(pending.call_id, "call-1");
    assert_eq!(pending.name, "read");
    assert_eq!(pending.status, ToolCallStatus::Running);

    let events = mapper.on_notification(
        "session/update",
        &json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call-1",
                "kind": "read",
                "title": "Read `/tmp/hello.txt`",
                "locations": [{"path": "/tmp/hello.txt"}],
                "rawInput": {"variant": "ReadFile", "target_file": "/tmp/hello.txt"}
            },
            "_meta": prompt_meta("p-1")
        }),
    );
    let running = last_tool_call(&events);
    assert_eq!(running.call_id, "call-1");
    assert_eq!(running.status, ToolCallStatus::Running);

    // 完成帧只带 content / rawOutput，不带 rawInput / locations（§3.5）。
    let events = mapper.on_notification(
        "session/update",
        &json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call-1",
                "status": "completed",
                "content": [{"type": "content", "content": {"type": "text", "text": "hello\n"}}],
                "rawOutput": {"type": "ReadFile", "FileContent": {"raw_output": "hello\n", "total_lines": 2}}
            },
            "_meta": prompt_meta("p-1")
        }),
    );
    let completed = last_tool_call(&events);
    assert_eq!(completed.status, ToolCallStatus::Completed);
    match completed.detail {
        ToolCallDetail::Read { path, content } => {
            assert_eq!(path, "/tmp/hello.txt");
            assert_eq!(content.as_deref(), Some("hello\n"));
        }
        other => panic!("unexpected detail {other:?}"),
    }
}

/// 失败终帧：`status:"failed"` + content 错误文本 → `ToolCallStatus::Failed` + error。
#[test]
fn maps_tool_call_lifecycle_running_to_failed() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());

    let events = mapper.on_notification(
        "session/update",
        &json!({
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "call-1",
                "title": "read_file",
                "rawInput": {"target_file": "/tmp/missing.txt"},
                "_meta": {"x.ai/tool": {"name": "read_file", "kind": "read"}}
            },
            "_meta": prompt_meta("p-1")
        }),
    );
    assert_eq!(last_tool_call(&events).status, ToolCallStatus::Running);

    let events = mapper.on_notification(
        "session/update",
        &json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call-1",
                "status": "failed",
                "content": [{"type": "content", "content": {"type": "text", "text": "ENOENT: no such file"}}]
            },
            "_meta": prompt_meta("p-1")
        }),
    );
    let failed = last_tool_call(&events);
    assert_eq!(failed.call_id, "call-1");
    assert_eq!(failed.status, ToolCallStatus::Failed);
    match events.last() {
        Some(AgentStreamEvent::Timeline {
            item: AgentTimelineItem::ToolCall { error, .. },
            ..
        }) => assert_eq!(error.as_deref(), Some("ENOENT: no such file")),
        other => panic!("unexpected {other:?}"),
    }
}

/// 后续更新帧只带 `rawInput` 子集（如仅 `variant`）时，浅合并应保留首帧的完整入参，
/// 否则完成帧的详情会丢 path。
#[test]
fn partial_update_input_does_not_drop_earlier_arguments() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());

    mapper.on_notification(
        "session/update",
        &json!({
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "call-1",
                "title": "read_file",
                "rawInput": {"target_file": "/tmp/hello.txt"},
                "_meta": {"x.ai/tool": {"name": "read_file", "kind": "read"}}
            },
            "_meta": prompt_meta("p-1")
        }),
    );

    let events = mapper.on_notification(
        "session/update",
        &json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call-1",
                "rawInput": {"variant": "ReadFile"}
            },
            "_meta": prompt_meta("p-1")
        }),
    );
    match last_tool_call(&events).detail {
        ToolCallDetail::Read { path, .. } => assert_eq!(path, "/tmp/hello.txt"),
        other => panic!("unexpected detail {other:?}"),
    }
}

/// 同一 toolCallId 的重复更新只累积到同一张卡片：每条事件都复用同一 call_id，
/// 由 provider 无关的前端 reducer 按 callId upsert（不产生重复卡片）。
#[test]
fn repeated_updates_reuse_the_same_call_id() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());

    let mut call_ids = Vec::new();
    let mut statuses = Vec::new();
    let updates = [
        json!({"sessionUpdate":"tool_call","toolCallId":"call-9","title":"run_terminal_command",
               "rawInput":{"command":"ls"},"_meta":{"x.ai/tool":{"name":"run_terminal_command","kind":"other"}}}),
        json!({"sessionUpdate":"tool_call_update","toolCallId":"call-9","kind":"other"}),
        json!({"sessionUpdate":"tool_call_update","toolCallId":"call-9","status":"completed",
               "content":[{"type":"content","content":{"type":"text","text":"a.txt\n"}}]}),
    ];
    for update in updates {
        let events = mapper.on_notification(
            "session/update",
            &json!({"update": update, "_meta": prompt_meta("p-1")}),
        );
        let snapshot = last_tool_call(&events);
        call_ids.push(snapshot.call_id);
        statuses.push(snapshot.status);
    }

    assert_eq!(call_ids, vec!["call-9", "call-9", "call-9"]);
    assert_eq!(
        statuses,
        vec![
            ToolCallStatus::Running,
            ToolCallStatus::Running,
            ToolCallStatus::Completed
        ]
    );
}

/// 未知工具（如 MCP 工具）落 `Unknown` 兜底，并在整个生命周期保留原始输入 / 输出。
#[test]
fn unknown_tool_falls_back_and_preserves_raw_input_output() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());

    let events = mapper.on_notification(
        "session/update",
        &json!({
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "call-mcp",
                "title": "acme_mcp__do_thing",
                "rawInput": {"variant": "Custom", "arg": 1}
            },
            "_meta": prompt_meta("p-1")
        }),
    );
    let created = last_tool_call(&events);
    assert_eq!(created.name, "acme_mcp__do_thing");
    match created.detail {
        ToolCallDetail::Unknown { raw_input, .. } => {
            assert!(raw_input.as_deref().unwrap_or_default().contains("\"arg\":1"));
        }
        other => panic!("unexpected detail {other:?}"),
    }

    let events = mapper.on_notification(
        "session/update",
        &json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call-mcp",
                "status": "completed",
                "rawOutput": {"type": "Custom", "value": "done"}
            },
            "_meta": prompt_meta("p-1")
        }),
    );
    let completed = last_tool_call(&events);
    assert_eq!(completed.status, ToolCallStatus::Completed);
    match completed.detail {
        ToolCallDetail::Unknown { raw_input, raw_output } => {
            assert!(raw_input.as_deref().unwrap_or_default().contains("\"arg\":1"));
            assert!(raw_output
                .as_deref()
                .unwrap_or_default()
                .contains("\"value\":\"done\""));
        }
        other => panic!("unexpected detail {other:?}"),
    }
}

/// 裁决证据：首个 `tool_call` 已带完整 `rawInput`，且实测 `tool_call_delta_chunk`
/// 的 `arguments_delta` 为空串 —— 增量帧没有信息增量，忽略不累积也不会丢参数。
#[test]
fn delta_chunk_carries_no_increment_and_is_safely_ignored() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("t".into());

    let events = mapper.on_notification(
        "session/update",
        &json!({
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "call-1",
                "title": "read_file",
                "rawInput": {"target_file": "/tmp/hello.txt"},
                "_meta": {"x.ai/tool": {"name": "read_file", "kind": "read"}}
            },
            "_meta": prompt_meta("p-1")
        }),
    );
    match last_tool_call(&events).detail {
        ToolCallDetail::Read { path, .. } => assert_eq!(path, "/tmp/hello.txt"),
        other => panic!("unexpected detail {other:?}"),
    }

    // 实测增量帧：arguments_delta 为空串，忽略后不产生任何事件。
    assert!(mapper
        .on_notification(
            "_x.ai/session_notification",
            &json!({"update":{"sessionUpdate":"tool_call_delta_chunk","tool_call_id":"call-1",
                "tool_index":0,"name":"read_file","arguments_delta":""}}),
        )
        .is_empty());

    // 完成后仍拿到完整入参与结构化结果，证明未累积增量也未丢参数。
    let events = mapper.on_notification(
        "session/update",
        &json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call-1",
                "status": "completed",
                "rawOutput": {"type": "ReadFile", "FileContent": {"raw_output": "hello\n"}}
            },
            "_meta": prompt_meta("p-1")
        }),
    );
    match last_tool_call(&events).detail {
        ToolCallDetail::Read { path, content } => {
            assert_eq!(path, "/tmp/hello.txt");
            assert_eq!(content.as_deref(), Some("hello\n"));
        }
        other => panic!("unexpected detail {other:?}"),
    }
}
