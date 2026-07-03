//! Claude Code `SDKMessage` 解析。
//!
//! 把 `claude -p --output-format stream-json` 输出的每行 NDJSON（`SDKMessage`）
//! 解析为类型化枚举 `ClaudeStreamMessage`。
//!
//! 顶层按 `type` 区分，部分类型再按 `subtype` 二次区分。覆盖首版用得到的子集：
//! - `system/init`：会话初始化（含 session_id / model / cwd / tools）
//! - `system/permission_denied`：权限被自动拒绝
//! - `stream_event`：原生 Anthropic 流事件（增量文本 / 工具入参 / thinking）
//! - `assistant`：完整的 assistant 消息（含 content 块数组）
//! - `user`：用户消息，也承载 tool_result
//! - `result`：turn 结束（成功 / 各种错误 subtype）
//!
//! 未识别的 type/subtype 归入 `Other`，静默忽略，保证向前兼容。

use serde_json::Value;

/// 归一化后的 Claude SDKMessage。
#[derive(Debug, Clone, PartialEq)]
pub enum ClaudeStreamMessage {
    /// `system/init`：会话初始化。
    SystemInit {
        session_id: String,
        model: Option<String>,
        cwd: Option<String>,
        tools: Vec<String>,
    },
    /// `system/permission_denied`：权限被自动拒绝。
    SystemPermissionDenied {
        tool_name: Option<String>,
        message: Option<String>,
    },
    /// `stream_event`：原生 Anthropic 流事件（增量）。
    StreamEvent(AnthropicStreamEvent),
    /// `assistant`：完整的 assistant 消息。
    Assistant {
        message: AssistantMessage,
        session_id: Option<String>,
    },
    /// `user`：用户消息（含 tool_result）。
    User {
        message: UserMessage,
        session_id: Option<String>,
    },
    /// `result`：turn 结束。
    Result {
        subtype: String,
        is_error: bool,
        result_text: Option<String>,
        session_id: Option<String>,
        usage: Option<UsageStats>,
        errors: Vec<String>,
        stop_reason: Option<String>,
    },
    /// 未识别的消息，静默忽略。
    Other,
}

/// 原生 Anthropic 流事件（`stream_event.event`）。
#[derive(Debug, Clone, PartialEq)]
pub enum AnthropicStreamEvent {
    /// `message_start`：一条新消息开始。
    MessageStart { usage: Option<UsageStats> },
    /// `content_block_start`：新内容块开始（text / tool_use / thinking）。
    ContentBlockStart { index: usize, block: ContentBlock },
    /// `content_block_delta`：内容块增量。
    ContentBlockDelta { index: usize, delta: ContentDelta },
    /// `content_block_stop`：内容块结束。
    ContentBlockStop { index: usize },
    /// `message_delta`：消息级更新（stop_reason / usage）。
    MessageDelta {
        stop_reason: Option<String>,
        usage: Option<UsageStats>,
    },
    /// `message_stop`：消息结束。
    MessageStop,
    /// 未识别的流事件。
    Other,
}

/// 内容块（`content_block_start` 的 content）。
#[derive(Debug, Clone, PartialEq)]
pub enum ContentBlock {
    /// 文本块。
    Text { text: String },
    /// 工具调用块。
    ToolUse { id: String, name: String },
    /// thinking 块。
    Thinking { thinking: String },
    /// 未识别的块类型。
    Other,
}

/// 内容块增量（`content_block_delta` 的 delta）。
#[derive(Debug, Clone, PartialEq)]
pub enum ContentDelta {
    /// 文本增量。
    TextDelta { text: String },
    /// 工具入参 JSON 片段增量。
    InputJsonDelta { partial_json: String },
    /// thinking 增量。
    ThinkingDelta { thinking: String },
    /// 未识别的增量类型。
    Other,
}

/// assistant 消息（`assistant.message`）。
#[derive(Debug, Clone, PartialEq)]
pub struct AssistantMessage {
    /// content 块数组。
    pub blocks: Vec<AssistantBlock>,
    pub usage: Option<UsageStats>,
}

/// assistant content 块。
#[derive(Debug, Clone, PartialEq)]
pub enum AssistantBlock {
    /// 文本块。
    Text { text: String },
    /// thinking 块。
    Thinking { thinking: String },
    /// 工具调用块（已包含完整 input）。
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
}

/// user 消息（`user.message`）。
#[derive(Debug, Clone, PartialEq)]
pub struct UserMessage {
    /// content 块数组（通常为 tool_result）。
    pub blocks: Vec<UserBlock>,
}

/// user content 块。
#[derive(Debug, Clone, PartialEq)]
pub enum UserBlock {
    /// 工具结果。
    ToolResult {
        tool_use_id: String,
        content: String,
        is_error: bool,
    },
    /// 纯文本。
    Text { text: String },
}

/// token 用量。
#[derive(Debug, Clone, PartialEq)]
pub struct UsageStats {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub context_window_max_tokens: Option<u64>,
}

/// 解析一行 SDKMessage JSON。
pub fn parse_message(value: &Value) -> ClaudeStreamMessage {
    let message_type = value.get("type").and_then(Value::as_str).unwrap_or("");
    match message_type {
        "system" => parse_system(value),
        "stream_event" => parse_stream_event(value),
        "assistant" => parse_assistant(value),
        "user" => parse_user(value),
        "result" => parse_result(value),
        _ => ClaudeStreamMessage::Other,
    }
}

fn parse_system(value: &Value) -> ClaudeStreamMessage {
    let subtype = value.get("subtype").and_then(Value::as_str).unwrap_or("");
    match subtype {
        "init" => ClaudeStreamMessage::SystemInit {
            session_id: value
                .get("session_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            model: value.get("model").and_then(Value::as_str).map(String::from),
            cwd: value.get("cwd").and_then(Value::as_str).map(String::from),
            tools: value
                .get("tools")
                .and_then(Value::as_array)
                .map(|tools| {
                    tools
                        .iter()
                        .filter_map(|tool| tool.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
        },
        "permission_denied" => ClaudeStreamMessage::SystemPermissionDenied {
            tool_name: value
                .get("tool_name")
                .and_then(Value::as_str)
                .map(String::from),
            message: value
                .get("message")
                .and_then(Value::as_str)
                .map(String::from),
        },
        _ => ClaudeStreamMessage::Other,
    }
}

fn parse_stream_event(value: &Value) -> ClaudeStreamMessage {
    let event = value.get("event");
    let Some(event_type) = event.and_then(|e| e.get("type")).and_then(Value::as_str) else {
        return ClaudeStreamMessage::Other;
    };
    let event = event.cloned().unwrap_or(Value::Null);
    let parsed = match event_type {
        "message_start" => {
            let usage = event
                .get("message")
                .and_then(|m| m.get("usage"))
                .and_then(parse_usage);
            AnthropicStreamEvent::MessageStart { usage }
        }
        "content_block_start" => {
            let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let block = parse_content_block(event.get("content_block").unwrap_or(&Value::Null));
            AnthropicStreamEvent::ContentBlockStart { index, block }
        }
        "content_block_delta" => {
            let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let delta = parse_content_delta(event.get("delta").unwrap_or(&Value::Null));
            AnthropicStreamEvent::ContentBlockDelta { index, delta }
        }
        "content_block_stop" => {
            let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            AnthropicStreamEvent::ContentBlockStop { index }
        }
        "message_delta" => {
            let stop_reason = event
                .get("delta")
                .and_then(|d| d.get("stop_reason"))
                .and_then(Value::as_str)
                .map(String::from);
            let usage = event.get("usage").and_then(parse_usage);
            AnthropicStreamEvent::MessageDelta { stop_reason, usage }
        }
        "message_stop" => AnthropicStreamEvent::MessageStop,
        _ => AnthropicStreamEvent::Other,
    };
    ClaudeStreamMessage::StreamEvent(parsed)
}

fn parse_content_block(value: &Value) -> ContentBlock {
    let block_type = value.get("type").and_then(Value::as_str).unwrap_or("");
    match block_type {
        "text" => ContentBlock::Text {
            text: value
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        },
        "tool_use" => ContentBlock::ToolUse {
            id: value
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            name: value
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        },
        "thinking" => ContentBlock::Thinking {
            thinking: value
                .get("thinking")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        },
        _ => ContentBlock::Other,
    }
}

fn parse_content_delta(value: &Value) -> ContentDelta {
    let delta_type = value.get("type").and_then(Value::as_str).unwrap_or("");
    match delta_type {
        "text_delta" => ContentDelta::TextDelta {
            text: value
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        },
        "input_json_delta" => ContentDelta::InputJsonDelta {
            partial_json: value
                .get("partial_json")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        },
        "thinking_delta" => ContentDelta::ThinkingDelta {
            thinking: value
                .get("thinking")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        },
        _ => ContentDelta::Other,
    }
}

fn parse_assistant(value: &Value) -> ClaudeStreamMessage {
    let message = value.get("message").unwrap_or(&Value::Null);
    let blocks = message
        .get("content")
        .and_then(Value::as_array)
        .map(|content| content.iter().filter_map(parse_assistant_block).collect())
        .unwrap_or_default();
    let usage = message.get("usage").and_then(parse_usage);
    ClaudeStreamMessage::Assistant {
        message: AssistantMessage { blocks, usage },
        session_id: value
            .get("session_id")
            .and_then(Value::as_str)
            .map(String::from),
    }
}

fn parse_assistant_block(value: &Value) -> Option<AssistantBlock> {
    let block_type = value.get("type").and_then(Value::as_str)?;
    Some(match block_type {
        "text" => AssistantBlock::Text {
            text: value
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        },
        "thinking" => AssistantBlock::Thinking {
            thinking: value
                .get("thinking")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        },
        "tool_use" => AssistantBlock::ToolUse {
            id: value
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            name: value
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            input: value.get("input").cloned().unwrap_or(Value::Null),
        },
        _ => return None,
    })
}

fn parse_user(value: &Value) -> ClaudeStreamMessage {
    let message = value.get("message").unwrap_or(&Value::Null);
    let blocks = message
        .get("content")
        .and_then(Value::as_array)
        .map(|content| content.iter().filter_map(parse_user_block).collect())
        .unwrap_or_default();
    ClaudeStreamMessage::User {
        message: UserMessage { blocks },
        session_id: value
            .get("session_id")
            .and_then(Value::as_str)
            .map(String::from),
    }
}

fn parse_user_block(value: &Value) -> Option<UserBlock> {
    let block_type = value.get("type").and_then(Value::as_str)?;
    Some(match block_type {
        "tool_result" => {
            let tool_use_id = value
                .get("tool_use_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            // tool_result 的 content 可能是字符串，也可能是块数组（取首个 text）。
            let content = extract_tool_result_content(value.get("content"));
            let is_error = value
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            UserBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            }
        }
        "text" => UserBlock::Text {
            text: value
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        },
        _ => return None,
    })
}

/// tool_result 的 content 可能是字符串或块数组，统一提取为字符串。
fn extract_tool_result_content(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    if let Some(array) = content.as_array() {
        let mut parts = Vec::new();
        for block in array {
            if let Some(text) = block.get("text").and_then(Value::as_str) {
                parts.push(text.to_string());
            }
        }
        return parts.join("\n");
    }
    String::new()
}

fn parse_result(value: &Value) -> ClaudeStreamMessage {
    let subtype = value
        .get("subtype")
        .and_then(Value::as_str)
        .unwrap_or("success")
        .to_string();
    let is_error = value
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let result_text = value
        .get("result")
        .and_then(Value::as_str)
        .map(String::from);
    let session_id = value
        .get("session_id")
        .and_then(Value::as_str)
        .map(String::from);
    let usage = value.get("usage").and_then(parse_usage);
    let errors = value
        .get("errors")
        .and_then(Value::as_array)
        .map(|errors| {
            errors
                .iter()
                .filter_map(|e| e.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let stop_reason = value
        .get("stop_reason")
        .and_then(Value::as_str)
        .map(String::from);
    ClaudeStreamMessage::Result {
        subtype,
        is_error,
        result_text,
        session_id,
        usage,
        errors,
        stop_reason,
    }
}

/// 解析用量，优先取 result.modelUsage 里的 contextWindow（更准）。
fn parse_usage(value: &Value) -> Option<UsageStats> {
    let input_tokens = value.get("input_tokens").and_then(Value::as_u64);
    let output_tokens = value.get("output_tokens").and_then(Value::as_u64);
    let context_window_max_tokens = value
        .get("context_window")
        .and_then(Value::as_u64)
        .or_else(|| value.get("contextWindow").and_then(Value::as_u64));
    if input_tokens.is_none() && output_tokens.is_none() && context_window_max_tokens.is_none() {
        return None;
    }
    Some(UsageStats {
        input_tokens,
        output_tokens,
        context_window_max_tokens,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_system_init() {
        let value = json!({
            "type": "system",
            "subtype": "init",
            "session_id": "abc-123",
            "model": "glm-5.2",
            "cwd": "/tmp",
            "tools": ["Bash", "Read", "Edit"]
        });
        let parsed = parse_message(&value);
        match parsed {
            ClaudeStreamMessage::SystemInit {
                session_id,
                model,
                cwd,
                tools,
            } => {
                assert_eq!(session_id, "abc-123");
                assert_eq!(model.as_deref(), Some("glm-5.2"));
                assert_eq!(cwd.as_deref(), Some("/tmp"));
                assert_eq!(tools, vec!["Bash", "Read", "Edit"]);
            }
            other => panic!("期望 SystemInit，实际 {other:?}"),
        }
    }

    #[test]
    fn parses_stream_event_text_delta() {
        let value = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "text_delta", "text": "hel" }
            }
        });
        let parsed = parse_message(&value);
        match parsed {
            ClaudeStreamMessage::StreamEvent(AnthropicStreamEvent::ContentBlockDelta {
                index,
                delta: ContentDelta::TextDelta { text },
            }) => {
                assert_eq!(index, 0);
                assert_eq!(text, "hel");
            }
            other => panic!("期望 ContentBlockDelta，实际 {other:?}"),
        }
    }

    #[test]
    fn parses_stream_event_content_block_start_tool_use() {
        let value = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 1,
                "content_block": { "type": "tool_use", "id": "tool_1", "name": "Bash" }
            }
        });
        let parsed = parse_message(&value);
        match parsed {
            ClaudeStreamMessage::StreamEvent(AnthropicStreamEvent::ContentBlockStart {
                index,
                block: ContentBlock::ToolUse { id, name },
            }) => {
                assert_eq!(index, 1);
                assert_eq!(id, "tool_1");
                assert_eq!(name, "Bash");
            }
            other => panic!("期望 ContentBlockStart ToolUse，实际 {other:?}"),
        }
    }

    #[test]
    fn parses_assistant_message_with_blocks() {
        let value = json!({
            "type": "assistant",
            "session_id": "s1",
            "message": {
                "content": [
                    { "type": "text", "text": "hello" },
                    { "type": "tool_use", "id": "tool_1", "name": "Bash", "input": { "command": "ls" } }
                ],
                "usage": { "input_tokens": 10, "output_tokens": 5 }
            }
        });
        let parsed = parse_message(&value);
        match parsed {
            ClaudeStreamMessage::Assistant {
                message,
                session_id,
            } => {
                assert_eq!(session_id.as_deref(), Some("s1"));
                assert_eq!(message.blocks.len(), 2);
                assert!(matches!(
                    &message.blocks[0],
                    AssistantBlock::Text { text } if text == "hello"
                ));
                match &message.blocks[1] {
                    AssistantBlock::ToolUse { id, name, input } => {
                        assert_eq!(id, "tool_1");
                        assert_eq!(name, "Bash");
                        assert_eq!(input["command"], "ls");
                    }
                    other => panic!("期望 ToolUse，实际 {other:?}"),
                }
                assert_eq!(message.usage.as_ref().unwrap().input_tokens, Some(10));
            }
            other => panic!("期望 Assistant，实际 {other:?}"),
        }
    }

    #[test]
    fn parses_user_tool_result() {
        let value = json!({
            "type": "user",
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "tool_1",
                        "content": "file.txt\nmain.rs",
                        "is_error": false
                    }
                ]
            }
        });
        let parsed = parse_message(&value);
        match parsed {
            ClaudeStreamMessage::User { message, .. } => {
                assert_eq!(message.blocks.len(), 1);
                match &message.blocks[0] {
                    UserBlock::ToolResult {
                        tool_use_id,
                        content,
                        is_error,
                    } => {
                        assert_eq!(tool_use_id, "tool_1");
                        assert_eq!(content, "file.txt\nmain.rs");
                        assert!(!is_error);
                    }
                    other => panic!("期望 ToolResult，实际 {other:?}"),
                }
            }
            other => panic!("期望 User，实际 {other:?}"),
        }
    }

    #[test]
    fn parses_result_success() {
        let value = json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "result": "OK",
            "session_id": "s1",
            "usage": { "input_tokens": 100, "output_tokens": 3 },
            "stop_reason": "end_turn"
        });
        let parsed = parse_message(&value);
        match parsed {
            ClaudeStreamMessage::Result {
                subtype,
                is_error,
                result_text,
                session_id,
                usage,
                errors,
                stop_reason,
            } => {
                assert_eq!(subtype, "success");
                assert!(!is_error);
                assert_eq!(result_text.as_deref(), Some("OK"));
                assert_eq!(session_id.as_deref(), Some("s1"));
                assert_eq!(usage.unwrap().input_tokens, Some(100));
                assert!(errors.is_empty());
                assert_eq!(stop_reason.as_deref(), Some("end_turn"));
            }
            other => panic!("期望 Result，实际 {other:?}"),
        }
    }

    #[test]
    fn parses_result_error_max_turns() {
        let value = json!({
            "type": "result",
            "subtype": "error_max_turns",
            "is_error": true,
            "errors": ["超过最大轮次"]
        });
        let parsed = parse_message(&value);
        match parsed {
            ClaudeStreamMessage::Result {
                subtype,
                is_error,
                errors,
                ..
            } => {
                assert_eq!(subtype, "error_max_turns");
                assert!(is_error);
                assert_eq!(errors, vec!["超过最大轮次"]);
            }
            other => panic!("期望 Result，实际 {other:?}"),
        }
    }

    #[test]
    fn unknown_type_returns_other() {
        let value = json!({ "type": "some_future_type" });
        assert_eq!(parse_message(&value), ClaudeStreamMessage::Other);
    }

    #[test]
    fn parses_tool_result_block_array_content() {
        let value = json!({
            "type": "user",
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "t2",
                        "content": [
                            { "type": "text", "text": "line1" },
                            { "type": "text", "text": "line2" }
                        ]
                    }
                ]
            }
        });
        let parsed = parse_message(&value);
        match parsed {
            ClaudeStreamMessage::User { message, .. } => match &message.blocks[0] {
                UserBlock::ToolResult { content, .. } => assert_eq!(content, "line1\nline2"),
                other => panic!("期望 ToolResult，实际 {other:?}"),
            },
            other => panic!("期望 User，实际 {other:?}"),
        }
    }

    #[test]
    fn parses_usage_with_context_window() {
        let value = json!({ "input_tokens": 50, "contextWindow": 200000 });
        let usage = parse_usage(&value).unwrap();
        assert_eq!(usage.input_tokens, Some(50));
        assert_eq!(usage.context_window_max_tokens, Some(200000));
    }
}
