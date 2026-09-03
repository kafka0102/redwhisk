//! OpenCode NDJSON → `AgentStreamEvent` 映射（调研子集，未知 type 忽略）。

use serde_json::Value;

use crate::agent::opencode_streaming::tool_detail::map_tool_detail;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentTimelineItem, AgentUsage, ToolCallStatus,
};

#[derive(Debug, Clone)]
pub struct MapContext {
    pub turn_id: Option<String>,
    pub message_index: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MapOutcome {
    pub events: Vec<AgentStreamEvent>,
    pub session_id: Option<String>,
    pub turn_finalized: bool,
    pub next_message_index: usize,
}
pub fn map_ndjson_value(value: &Value, ctx: &MapContext) -> MapOutcome {
    let session_id = extract_session_id(value);
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();

    match event_type {
        "step_start" => MapOutcome {
            events: vec![AgentStreamEvent::TurnStarted {
                turn_id: turn_id_from_part(value).or_else(|| ctx.turn_id.clone()),
            }],
            session_id,
            turn_finalized: false,
            next_message_index: ctx.message_index,
        },
        "step_finish" => MapOutcome {
            events: vec![AgentStreamEvent::TurnCompleted {
                turn_id: turn_id_from_part(value).or_else(|| ctx.turn_id.clone()),
                usage: usage_from_part(value),
                stop_reason: None,
                subtype: None,
            }],
            session_id,
            turn_finalized: true,
            next_message_index: ctx.message_index,
        },
        "text" => {
            let text = part_text(value).unwrap_or_default();
            if text.is_empty() {
                return empty_outcome(session_id, ctx.message_index);
            }
            let message_id = format!(
                "opencode-text-{}-{}",
                ctx.turn_id.as_deref().unwrap_or("turn"),
                ctx.message_index
            );
            MapOutcome {
                events: vec![timeline(
                    &ctx.turn_id,
                    AgentTimelineItem::AssistantMessage {
                        text,
                        message_id: Some(message_id),
                    },
                )],
                session_id,
                turn_finalized: false,
                next_message_index: ctx.message_index.saturating_add(1),
            }
        }
        "reasoning" => {
            let text = part_text(value).unwrap_or_default();
            if text.is_empty() {
                return empty_outcome(session_id, ctx.message_index);
            }
            MapOutcome {
                events: vec![timeline(
                    &ctx.turn_id,
                    AgentTimelineItem::Reasoning {
                        text,
                        duration_ms: None,
                    },
                )],
                session_id,
                turn_finalized: false,
                next_message_index: ctx.message_index,
            }
        }
        "tool_use" => map_tool_use(value, ctx, session_id),
        "error" => map_error(value, ctx, session_id),
        _ => empty_outcome(session_id, ctx.message_index),
    }
}
fn empty_outcome(session_id: Option<String>, message_index: usize) -> MapOutcome {
    MapOutcome {
        events: Vec::new(),
        session_id,
        turn_finalized: false,
        next_message_index: message_index,
    }
}
fn map_error(value: &Value, ctx: &MapContext, session_id: Option<String>) -> MapOutcome {
    let message = error_message(value);
    let events = vec![
        timeline(
            &ctx.turn_id,
            AgentTimelineItem::Error {
                message: message.clone(),
            },
        ),
        AgentStreamEvent::TurnFailed {
            turn_id: ctx.turn_id.clone(),
            error: message,
            code: error_name(value),
        },
    ];
    MapOutcome {
        events,
        session_id,
        turn_finalized: true,
        next_message_index: ctx.message_index,
    }
}
fn map_tool_use(value: &Value, ctx: &MapContext, session_id: Option<String>) -> MapOutcome {
    let part = value.get("part").unwrap_or(value);
    let tool_name = part
        .get("tool")
        .or_else(|| part.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("tool");
    let call_id = part
        .get("callID")
        .or_else(|| part.get("callId"))
        .or_else(|| part.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("opencode-tool-{}", ctx.message_index));

    let state = part.get("state").cloned().unwrap_or(Value::Null);
    let failed = matches!(
        state.get("status").and_then(Value::as_str),
        Some("error" | "failed")
    );
    let status = if failed {
        ToolCallStatus::Failed
    } else {
        ToolCallStatus::Completed
    };
    let error = if failed {
        tool_error_message(&state)
    } else {
        None
    };
    let input = state.get("input").cloned().unwrap_or(Value::Null);
    let output = value_as_string(state.get("output")).or_else(|| {
        part.get("output")
            .and_then(Value::as_str)
            .map(str::to_string)
    });

    let (detail, display_name) = map_tool_detail(tool_name, &input, output.as_deref());

    MapOutcome {
        events: vec![timeline(
            &ctx.turn_id,
            AgentTimelineItem::ToolCall {
                call_id,
                name: display_name,
                detail,
                status,
                error,
            },
        )],
        session_id,
        turn_finalized: false,
        next_message_index: ctx.message_index,
    }
}
pub fn extract_session_id(value: &Value) -> Option<String> {
    value
        .get("sessionID")
        .or_else(|| value.get("sessionId"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}
fn turn_id_from_part(value: &Value) -> Option<String> {
    value
        .get("part")
        .and_then(|part| {
            part.get("id")
                .or_else(|| part.get("messageID"))
                .or_else(|| part.get("messageId"))
        })
        .and_then(Value::as_str)
        .map(str::to_string)
}
fn part_text(value: &Value) -> Option<String> {
    value
        .get("part")
        .and_then(|part| part.get("text"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            value
                .get("text")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}
fn usage_from_part(value: &Value) -> Option<AgentUsage> {
    let part = value.get("part")?;
    let tokens = part.get("tokens").or_else(|| part.get("usage"))?;
    Some(AgentUsage {
        input_tokens: tokens
            .get("input")
            .or_else(|| tokens.get("input_tokens"))
            .and_then(Value::as_u64),
        output_tokens: tokens
            .get("output")
            .or_else(|| tokens.get("output_tokens"))
            .and_then(Value::as_u64),
        context_window_max_tokens: None,
        context_window_used_tokens: None,
    })
}
fn error_message(value: &Value) -> String {
    let error = value.get("error");
    if let Some(err) = error {
        if let Some(msg) = err
            .get("data")
            .and_then(|d| d.get("message"))
            .and_then(Value::as_str)
        {
            return msg.to_string();
        }
        if let Some(msg) = err.get("message").and_then(Value::as_str) {
            return msg.to_string();
        }
        if let Some(name) = err.get("name").and_then(Value::as_str) {
            return name.to_string();
        }
        if let Some(s) = err.as_str() {
            return s.to_string();
        }
    }
    "opencode 返回错误".to_string()
}
fn error_name(value: &Value) -> Option<String> {
    value
        .get("error")
        .and_then(|e| e.get("name"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn tool_error_message(state: &Value) -> Option<String> {
    state
        .get("error")
        .and_then(|e| {
            e.as_str()
                .map(str::to_string)
                .or_else(|| e.get("message").and_then(Value::as_str).map(str::to_string))
        })
        .or_else(|| {
            state
                .get("output")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}
fn value_as_string(value: Option<&Value>) -> Option<String> {
    value.and_then(|v| {
        v.as_str()
            .map(str::to_string)
            .or_else(|| serde_json::to_string(v).ok())
    })
}
fn timeline(turn_id: &Option<String>, item: AgentTimelineItem) -> AgentStreamEvent {
    AgentStreamEvent::Timeline {
        item,
        turn_id: turn_id.clone(),
        seq: 0,
        timestamp: 0,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::agent_session_stream::ToolCallDetail;
    use serde_json::json;

    fn ctx() -> MapContext {
        MapContext {
            turn_id: Some("turn-1".into()),
            message_index: 0,
        }
    }

    #[test]
    fn maps_step_start_to_turn_started() {
        let out = map_ndjson_value(
            &json!({"type":"step_start","sessionID":"ses_abc","part":{"id":"part-1"}}),
            &ctx(),
        );
        assert_eq!(out.session_id.as_deref(), Some("ses_abc"));
        assert!(matches!(
            &out.events[0],
            AgentStreamEvent::TurnStarted { turn_id: Some(id) } if id == "part-1"
        ));
        assert!(!out.turn_finalized);
    }

    #[test]
    fn maps_step_finish_to_turn_completed() {
        let value = json!({
            "type": "step_finish",
            "sessionID": "ses_abc",
            "part": {
                "id": "part-2",
                "type": "step-finish",
                "tokens": { "input": 10, "output": 20 }
            }
        });
        let out = map_ndjson_value(&value, &ctx());
        assert!(out.turn_finalized);
        match &out.events[0] {
            AgentStreamEvent::TurnCompleted { turn_id, usage, .. } => {
                assert_eq!(turn_id.as_deref(), Some("part-2"));
                let usage = usage.as_ref().expect("usage");
                assert_eq!(usage.input_tokens, Some(10));
                assert_eq!(usage.output_tokens, Some(20));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn maps_text_to_assistant_message() {
        let out = map_ndjson_value(
            &json!({"type":"text","sessionID":"ses_1","part":{"text":"hello world","time":{"end":1}}}),
            &ctx(),
        );
        assert_eq!(out.next_message_index, 1);
        match &out.events[0] {
            AgentStreamEvent::Timeline {
                item: AgentTimelineItem::AssistantMessage { text, message_id },
                ..
            } => {
                assert_eq!(text, "hello world");
                assert!(message_id
                    .as_ref()
                    .is_some_and(|id| id.contains("opencode-text")));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn maps_reasoning() {
        let out = map_ndjson_value(
            &json!({"type":"reasoning","sessionID":"ses_1","part":{"text":"thinking..."}}),
            &ctx(),
        );
        assert!(matches!(
            &out.events[0],
            AgentStreamEvent::Timeline { item: AgentTimelineItem::Reasoning { text, .. }, .. }
                if text == "thinking..."
        ));
    }

    #[test]
    fn maps_tool_use_completed_shell() {
        let value = json!({
            "type": "tool_use",
            "sessionID": "ses_1",
            "part": {
                "id": "p1",
                "type": "tool",
                "tool": "bash",
                "callID": "call-1",
                "state": {
                    "status": "completed",
                    "input": { "command": "ls -la" },
                    "output": "file.txt"
                }
            }
        });
        let out = map_ndjson_value(&value, &ctx());
        match &out.events[0] {
            AgentStreamEvent::Timeline {
                item:
                    AgentTimelineItem::ToolCall {
                        call_id,
                        name,
                        detail,
                        status,
                        error,
                    },
                ..
            } => {
                assert_eq!(call_id, "call-1");
                assert_eq!(name, "shell");
                assert_eq!(*status, ToolCallStatus::Completed);
                assert!(error.is_none());
                assert!(matches!(
                    detail,
                    ToolCallDetail::Shell { command, output, .. }
                        if command == "ls -la" && output.as_deref() == Some("file.txt")
                ));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn maps_tool_use_error_to_failed() {
        let value = json!({
            "type": "tool_use",
            "sessionID": "ses_1",
            "part": {
                "tool": "read",
                "callID": "c2",
                "state": {
                    "status": "error",
                    "input": { "path": "/tmp/x" },
                    "error": "not found"
                }
            }
        });
        let out = map_ndjson_value(&value, &ctx());
        match &out.events[0] {
            AgentStreamEvent::Timeline {
                item:
                    AgentTimelineItem::ToolCall {
                        name,
                        status,
                        error,
                        detail,
                        ..
                    },
                ..
            } => {
                assert_eq!(name, "read");
                assert_eq!(*status, ToolCallStatus::Failed);
                assert_eq!(error.as_deref(), Some("not found"));
                assert!(matches!(detail, ToolCallDetail::Read { path, .. } if path == "/tmp/x"));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn maps_error_to_timeline_and_turn_failed() {
        let value = json!({
            "type": "error",
            "timestamp": 1784801716412i64,
            "sessionID": "ses_0718724eaffe3Oo6svlXn9Yl8g",
            "error": {
                "name": "UnknownError",
                "data": { "message": "Failed to get direct access token: 401 Unauthorized" }
            }
        });
        let out = map_ndjson_value(&value, &ctx());
        assert!(out.turn_finalized);
        assert_eq!(
            out.session_id.as_deref(),
            Some("ses_0718724eaffe3Oo6svlXn9Yl8g")
        );
        assert_eq!(out.events.len(), 2);
        assert!(matches!(
            &out.events[0],
            AgentStreamEvent::Timeline {
                item: AgentTimelineItem::Error { message },
                ..
            } if message.contains("401 Unauthorized")
        ));
        assert!(matches!(
            &out.events[1],
            AgentStreamEvent::TurnFailed {
                error,
                code: Some(code),
                ..
            } if error.contains("401") && code == "UnknownError"
        ));
    }

    #[test]
    fn ignores_unknown_type_but_keeps_session_id() {
        let out = map_ndjson_value(
            &json!({"type":"session.status","sessionID":"ses_x","status":"idle"}),
            &ctx(),
        );
        assert!(out.events.is_empty());
        assert_eq!(out.session_id.as_deref(), Some("ses_x"));
        assert!(!out.turn_finalized);
    }
}
