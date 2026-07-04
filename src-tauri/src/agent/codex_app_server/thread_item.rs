//! codex thread item → `AgentTimelineItem` 映射。
//!
//! 把 codex 原始 item 归一化为 redwhisk 的 `AgentTimelineItem` 联合类型，
//! 让前端按 `type` 分发渲染。
//!
//! 首版覆盖 codex 0.x 常见 item 类型：userMessage / agentMessage / reasoning /
//! plan / commandExecution / fileChange / webSearch / contextCompaction。其余类型
//! （mcpToolCall / collabAgentToolCall / image*）暂归 `unknown` 或 `error`，
//! 保留原始 JSON 便于诊断，待后续 PR 补齐。

use serde_json::Value;

use super::notification::{normalize_thread_item_type, parse_search_mode};
use crate::types::agent_session_stream::{
    AgentTimelineItem, AgentUsage, CompactionStatus, SearchMode, ToolCallDetail, ToolCallStatus,
};

/// 把一个 codex thread item 映射为 `AgentTimelineItem`。
///
/// `include_user_message` 控制是否输出 user_message（历史回放时常需隐藏
/// 重复用户消息）。返回 `None` 表示该 item 无法映射（例如空文本）。
pub fn map_thread_item(item: &Value, include_user_message: bool) -> Option<AgentTimelineItem> {
    let raw_type = item.get("type").and_then(Value::as_str).unwrap_or("");
    let item_type = normalize_thread_item_type(raw_type);

    match item_type {
        "userMessage" => {
            if !include_user_message {
                return None;
            }
            let text = extract_user_text(item).unwrap_or_default();
            let message_id = str_field(item, "id");
            Some(AgentTimelineItem::UserMessage { text, message_id })
        }
        "agentMessage" => {
            let text = str_field(item, "text").unwrap_or_default();
            let message_id = str_field(item, "id");
            Some(AgentTimelineItem::AssistantMessage { text, message_id })
        }
        "reasoning" => {
            let summary = item.get("summary").and_then(Value::as_array).map(|parts| {
                parts
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("\n")
            });
            let content = item.get("content").and_then(Value::as_array).map(|parts| {
                parts
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("\n")
            });
            let text = summary.or(content)?;
            // Codex timeline 历史回放不携带 per-block 计时，duration_ms 留 None。
            Some(AgentTimelineItem::Reasoning {
                text,
                duration_ms: None,
            })
        }
        "plan" => {
            let call_id = str_field(item, "id")
                .or_else(|| str_field(item, "itemId"))
                .unwrap_or_else(|| "plan".to_string());
            let text = normalize_plan_text(str_field(item, "text").unwrap_or_default());
            if text.is_empty() {
                return None;
            }
            Some(AgentTimelineItem::ToolCall {
                call_id,
                name: "plan".into(),
                detail: ToolCallDetail::Plan { text },
                status: ToolCallStatus::Completed,
                error: None,
            })
        }
        "commandExecution" => map_command_execution(item),
        "fileChange" => map_file_change(item),
        "webSearch" => map_web_search(item),
        "contextCompaction" => Some(AgentTimelineItem::Compaction {
            status: CompactionStatus::Completed,
        }),
        "mcpToolCall" | "collabAgentToolCall" | "imageView" | "imageGeneration" => {
            map_unknown_tool_call(item, item_type)
        }
        _ => None,
    }
}

fn map_command_execution(item: &Value) -> Option<AgentTimelineItem> {
    let call_id = str_field(item, "id")
        .or_else(|| str_field(item, "callId"))
        .or_else(|| str_field(item, "call_id"))
        .unwrap_or_else(|| "shell".to_string());
    let command = normalize_command_value(item.get("command"));
    let output = str_field(item, "output")
        .or_else(|| str_field(item, "aggregatedOutput"))
        .or_else(|| str_field(item, "aggregated_output"))
        .or_else(|| str_field(item, "formatted_output"));
    let exit_code = item
        .get("exitCode")
        .or_else(|| item.get("exit_code"))
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok());
    let success = item.get("success").and_then(Value::as_bool);
    let running = is_item_running(item);

    let status = if running {
        ToolCallStatus::Running
    } else if success == Some(false) || exit_code.map(|code| code != 0).unwrap_or(false) {
        ToolCallStatus::Failed
    } else {
        ToolCallStatus::Completed
    };

    let error = if status == ToolCallStatus::Failed {
        str_field(item, "stderr").or(Some("Command failed".to_string()))
    } else {
        None
    };

    let command_str = command?;
    // cwd 暂不暴露到 UI，仅在未来诊断时使用。
    let _ = str_field(item, "cwd");
    Some(AgentTimelineItem::ToolCall {
        call_id,
        name: "shell".into(),
        detail: ToolCallDetail::Shell {
            command: command_str,
            output,
            exit_code,
        },
        status,
        error,
    })
}

fn map_file_change(item: &Value) -> Option<AgentTimelineItem> {
    let call_id = str_field(item, "id")
        .or_else(|| str_field(item, "callId"))
        .or_else(|| str_field(item, "call_id"))
        .unwrap_or_else(|| "apply_patch".to_string());
    let changes = item.get("changes").cloned().unwrap_or(Value::Null);
    let files = parse_patch_changes(&changes);
    let first_path = files.first().map(|file| file.path.clone())?;
    let diff = files
        .iter()
        .find_map(|file| file.content.clone())
        .or_else(|| str_field(item, "diff"));
    let success = item.get("success").and_then(Value::as_bool);
    let running = is_item_running(item);

    let status = if running {
        ToolCallStatus::Running
    } else if success == Some(false) {
        ToolCallStatus::Failed
    } else {
        ToolCallStatus::Completed
    };
    let error = if status == ToolCallStatus::Failed {
        str_field(item, "stderr").or(Some("Patch apply failed".to_string()))
    } else {
        None
    };

    Some(AgentTimelineItem::ToolCall {
        call_id,
        name: "apply_patch".into(),
        detail: ToolCallDetail::Edit {
            path: first_path,
            diff,
        },
        status,
        error,
    })
}

fn map_web_search(item: &Value) -> Option<AgentTimelineItem> {
    let call_id = str_field(item, "id")
        .or_else(|| str_field(item, "callId"))
        .or_else(|| str_field(item, "call_id"))
        .unwrap_or_else(|| "web_search".to_string());
    let query = extract_search_query(item)?;
    let mode = str_field(item, "mode")
        .or_else(|| nested_str_field(item, &["input", "mode"]))
        .map(|value| parse_search_mode_str(&value))
        .unwrap_or(SearchMode::Content);
    let matches = extract_search_matches(item);
    let success = item.get("success").and_then(Value::as_bool);
    let running = is_item_running(item);

    let status = if running {
        ToolCallStatus::Running
    } else if success == Some(false) {
        ToolCallStatus::Failed
    } else {
        ToolCallStatus::Completed
    };
    let error = if status == ToolCallStatus::Failed {
        str_field(item, "error").or(Some("Web search failed".to_string()))
    } else {
        None
    };

    Some(AgentTimelineItem::ToolCall {
        call_id,
        name: "web_search".into(),
        detail: ToolCallDetail::Search {
            query,
            mode,
            matches,
        },
        status,
        error,
    })
}

fn map_unknown_tool_call(item: &Value, name: &str) -> Option<AgentTimelineItem> {
    let call_id = str_field(item, "id")
        .or_else(|| str_field(item, "callId"))
        .unwrap_or_else(|| name.to_string());
    let raw_input = item.get("input").cloned().filter(|value| !value.is_null());
    let raw_output = item.get("output").cloned().filter(|value| !value.is_null());
    Some(AgentTimelineItem::ToolCall {
        call_id,
        name: name.to_string(),
        detail: ToolCallDetail::Unknown {
            raw_input: raw_input.map(|value| value.to_string()),
            raw_output: raw_output.map(|value| value.to_string()),
        },
        status: ToolCallStatus::Completed,
        error: None,
    })
}

/// 从 codex patch `changes` 字段抽取文件列表。
///
/// changes 可能是数组（`[{path, content}]`）、单对象（`{path, content}`）
/// 或路径到内容的映射。
fn parse_patch_changes(changes: &Value) -> Vec<PatchFile> {
    if changes.is_null() {
        return Vec::new();
    }
    if let Some(array) = changes.as_array() {
        return array
            .iter()
            .filter_map(|entry| {
                let path = resolve_path(entry)?;
                let content = extract_patch_text(entry);
                Some(PatchFile { path, content })
            })
            .collect();
    }
    if let Some(record) = changes.as_object() {
        // 单对象形态：直接带 path 字段
        if let Some(path) = resolve_path(changes) {
            let content = extract_patch_text(changes);
            return vec![PatchFile { path, content }];
        }
        // 路径 → 内容映射形态
        return record
            .iter()
            .filter_map(|(path, value)| {
                if path.trim().is_empty() {
                    return None;
                }
                let content = extract_patch_text(value);
                Some(PatchFile {
                    path: path.clone(),
                    content,
                })
            })
            .collect();
    }
    Vec::new()
}

struct PatchFile {
    path: String,
    content: Option<String>,
}

fn resolve_path(record: &Value) -> Option<String> {
    str_field(record, "path")
        .or_else(|| str_field(record, "file_path"))
        .or_else(|| str_field(record, "filePath"))
        .filter(|path| !path.trim().is_empty())
}

fn extract_patch_text(value: &Value) -> Option<String> {
    for field in [
        "diff",
        "patch",
        "unified_diff",
        "unifiedDiff",
        "content",
        "newString",
    ] {
        if let Some(text) = str_field(value, field) {
            if !text.is_empty() {
                return Some(text);
            }
        }
    }
    None
}

fn extract_search_query(item: &Value) -> Option<String> {
    str_field(item, "query")
        .or_else(|| nested_str_field(item, &["input", "query"]))
        .or_else(|| nested_str_field(item, &["action", "query"]))
        .or_else(|| nested_str_field(item, &["output", "action", "query"]))
        .filter(|query| !query.trim().is_empty())
}

fn extract_search_matches(item: &Value) -> Vec<String> {
    for field in ["matches", "results", "sources"] {
        if let Some(matches) = item.get(field).and_then(values_to_search_matches) {
            return matches;
        }
    }
    if let Some(matches) = item
        .get("output")
        .and_then(|output| output.get("sources"))
        .and_then(values_to_search_matches)
    {
        return matches;
    }
    Vec::new()
}

fn values_to_search_matches(value: &Value) -> Option<Vec<String>> {
    let array = value.as_array()?;
    let matches = array
        .iter()
        .filter_map(value_to_search_match)
        .collect::<Vec<_>>();
    Some(matches)
}

fn value_to_search_match(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return non_empty_string(text);
    }
    let url = str_field(value, "url");
    let title = str_field(value, "title").or_else(|| str_field(value, "name"));
    match (title, url) {
        (Some(title), Some(url)) => non_empty_string(&format!("{title} {url}")),
        (None, Some(url)) => non_empty_string(&url),
        (Some(title), None) => non_empty_string(&title),
        (None, None) => None,
    }
}

fn is_item_running(item: &Value) -> bool {
    // codex item 没有 status 字段时默认 completed；带 `running: true` 的
    // exec/patch begin 通知会显式标记。
    item.get("running")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn normalize_command_value(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        // 剥离 `zsh -lc "cmd"` 外壳，保留内部命令。
        let wrapper = regex_lite(trimmed);
        return Some(wrapper);
    }
    if let Some(array) = value.as_array() {
        let parts: Vec<&str> = array.iter().filter_map(Value::as_str).collect();
        if parts.is_empty() {
            return None;
        }
        if parts.len() >= 3 && (parts[1] == "-lc" || parts[1] == "-c") {
            return parts.get(2).map(|s| s.to_string());
        }
        return Some(parts.join(" "));
    }
    None
}

fn regex_lite(value: &str) -> String {
    // 简化版：剥离 `sh -lc "..."` / `zsh -lc '...'` 外壳。
    let trimmed = value.trim();
    let prefix_patterns = [
        "/bin/zsh -lc ",
        "/bin/bash -lc ",
        "/bin/sh -lc ",
        "zsh -lc ",
        "bash -lc ",
        "sh -lc ",
        "/bin/zsh -c ",
        "zsh -c ",
        "bash -c ",
        "sh -c ",
    ];
    for prefix in prefix_patterns {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let rest = rest.trim();
            if (rest.starts_with('"') && rest.ends_with('"'))
                || (rest.starts_with('\'') && rest.ends_with('\''))
            {
                return rest[1..rest.len() - 1].to_string();
            }
            return rest.to_string();
        }
    }
    trimmed.to_string()
}

fn extract_user_text(item: &Value) -> Option<String> {
    let content = item.get("content")?;
    let array = content.as_array()?;
    let parts: Vec<&str> = array
        .iter()
        .filter(|entry| entry.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|entry| entry.get("text").and_then(Value::as_str))
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn normalize_plan_text(text: String) -> String {
    text.lines()
        .map(|line| line.trim_end())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// 从 codex `tokenUsage` 通知载荷提取 `AgentUsage`。
///
/// - `contextWindowMaxTokens` ← `model_context_window` / `modelContextWindow`
/// - `contextWindowUsedTokens` ← `last.total_tokens` / `last.totalTokens`
/// - `inputTokens` / `outputTokens` ← `last.inputTokens` / `last.outputTokens`
pub fn extract_usage(token_usage: &Value) -> Option<AgentUsage> {
    let usage = token_usage.as_object()?;
    let last = usage.get("last").and_then(Value::as_object);
    let context_window_max_tokens = first_positive_finite_u64(
        usage.get("model_context_window").and_then(Value::as_u64),
        usage.get("modelContextWindow").and_then(Value::as_u64),
    );
    let context_window_used_tokens = last.and_then(|last_obj| {
        first_positive_finite_u64(
            last_obj.get("total_tokens").and_then(Value::as_u64),
            last_obj.get("totalTokens").and_then(Value::as_u64),
        )
    });
    let input_tokens =
        last.and_then(|last_obj| last_obj.get("inputTokens").and_then(Value::as_u64));
    let output_tokens =
        last.and_then(|last_obj| last_obj.get("outputTokens").and_then(Value::as_u64));

    if input_tokens.is_none()
        && output_tokens.is_none()
        && context_window_max_tokens.is_none()
        && context_window_used_tokens.is_none()
    {
        return None;
    }

    Some(AgentUsage {
        input_tokens,
        output_tokens,
        context_window_max_tokens,
        context_window_used_tokens,
    })
}

fn first_positive_finite_u64(primary: Option<u64>, secondary: Option<u64>) -> Option<u64> {
    if let Some(value) = primary {
        if value > 0 {
            return Some(value);
        }
    }
    if let Some(value) = secondary {
        if value > 0 {
            return Some(value);
        }
    }
    None
}

/// 把 webSearch item 的 mode 字符串转成 `SearchMode`（供未来扩展使用）。
pub fn parse_search_mode_str(value: &str) -> SearchMode {
    parse_search_mode(value)
}

fn str_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(|s| s.to_string())
}

fn nested_str_field(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for field in path {
        current = current.get(field)?;
    }
    current.as_str().map(|s| s.to_string())
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_agent_message() {
        let item = map_thread_item(
            &json!({ "id": "m1", "type": "AgentMessage", "text": "hello" }),
            true,
        );
        assert_eq!(
            item,
            Some(AgentTimelineItem::AssistantMessage {
                text: "hello".into(),
                message_id: Some("m1".into()),
            })
        );
    }

    #[test]
    fn maps_user_message_respects_include_flag() {
        let item_value = json!({
            "id": "u1",
            "type": "UserMessage",
            "content": [{ "type": "text", "text": "hi" }],
        });
        assert!(map_thread_item(&item_value, true).is_some());
        assert!(map_thread_item(&item_value, false).is_none());
    }

    #[test]
    fn maps_command_execution_with_exit_code() {
        let item = map_thread_item(
            &json!({
                "id": "c1",
                "type": "commandExecution",
                "command": "ls",
                "exitCode": 0,
                "aggregatedOutput": "a\nb",
            }),
            true,
        );
        match item {
            Some(AgentTimelineItem::ToolCall {
                name,
                detail,
                status,
                ..
            }) => {
                assert_eq!(name, "shell");
                assert_eq!(status, ToolCallStatus::Completed);
                match detail {
                    ToolCallDetail::Shell {
                        command,
                        output,
                        exit_code,
                    } => {
                        assert_eq!(command, "ls");
                        assert_eq!(output.as_deref(), Some("a\nb"));
                        assert_eq!(exit_code, Some(0));
                    }
                    other => panic!("期望 Shell detail，实际 {other:?}"),
                }
            }
            other => panic!("期望 ToolCall，实际 {other:?}"),
        }
    }

    #[test]
    fn strips_shell_wrapper_from_command() {
        let item = map_thread_item(
            &json!({
                "id": "c2",
                "type": "commandExecution",
                "command": "zsh -lc 'git status'",
                "exitCode": 0,
            }),
            true,
        );
        match item {
            Some(AgentTimelineItem::ToolCall {
                detail: ToolCallDetail::Shell { command, .. },
                ..
            }) => {
                assert_eq!(command, "git status");
            }
            other => panic!("期望 ToolCall，实际 {other:?}"),
        }
    }

    #[test]
    fn maps_file_change_from_array_changes() {
        let item = map_thread_item(
            &json!({
                "id": "f1",
                "type": "fileChange",
                "changes": [
                    { "path": "src/main.rs", "diff": "diff --git" }
                ],
                "success": true,
            }),
            true,
        );
        match item {
            Some(AgentTimelineItem::ToolCall {
                name,
                detail,
                status,
                ..
            }) => {
                assert_eq!(name, "apply_patch");
                assert_eq!(status, ToolCallStatus::Completed);
                match detail {
                    ToolCallDetail::Edit { path, diff } => {
                        assert_eq!(path, "src/main.rs");
                        assert_eq!(diff.as_deref(), Some("diff --git"));
                    }
                    other => panic!("期望 Edit detail，实际 {other:?}"),
                }
            }
            other => panic!("期望 ToolCall，实际 {other:?}"),
        }
    }

    #[test]
    fn maps_web_search_with_query_and_matches() {
        let item = map_thread_item(
            &json!({
                "id": "s1",
                "type": "webSearch",
                "query": "Beijing weather today",
                "mode": "count",
                "matches": [
                    "Weather https://weather.example/beijing",
                    { "title": "Forecast", "url": "https://example.com/forecast" }
                ],
            }),
            true,
        );
        match item {
            Some(AgentTimelineItem::ToolCall {
                name,
                detail,
                status,
                ..
            }) => {
                assert_eq!(name, "web_search");
                assert_eq!(status, ToolCallStatus::Completed);
                match detail {
                    ToolCallDetail::Search {
                        query,
                        mode,
                        matches,
                    } => {
                        assert_eq!(query, "Beijing weather today");
                        assert_eq!(mode, SearchMode::Count);
                        assert_eq!(
                            matches,
                            vec![
                                "Weather https://weather.example/beijing",
                                "Forecast https://example.com/forecast",
                            ]
                        );
                    }
                    other => panic!("期望 Search detail，实际 {other:?}"),
                }
            }
            other => panic!("期望 ToolCall，实际 {other:?}"),
        }
    }

    #[test]
    fn maps_web_search_from_output_action_sources() {
        let item = map_thread_item(
            &json!({
                "id": "s2",
                "type": "WebSearch",
                "output": {
                    "action": {
                        "type": "search",
                        "query": "weather: Beijing",
                    },
                    "sources": [
                        { "type": "url", "url": "https://weather.example/beijing" }
                    ]
                },
            }),
            true,
        );
        match item {
            Some(AgentTimelineItem::ToolCall {
                detail:
                    ToolCallDetail::Search {
                        query,
                        mode,
                        matches,
                    },
                ..
            }) => {
                assert_eq!(query, "weather: Beijing");
                assert_eq!(mode, SearchMode::Content);
                assert_eq!(matches, vec!["https://weather.example/beijing"]);
            }
            other => panic!("期望 Search tool call，实际 {other:?}"),
        }
    }

    #[test]
    fn maps_context_compaction() {
        let item = map_thread_item(&json!({ "type": "contextCompaction" }), true);
        assert_eq!(
            item,
            Some(AgentTimelineItem::Compaction {
                status: CompactionStatus::Completed,
            })
        );
    }

    #[test]
    fn extracts_usage_from_token_usage() {
        let usage = extract_usage(&json!({
            "model_context_window": 200_000,
            "last": {
                "total_tokens": 1_801,
                "inputTokens": 1_500,
                "outputTokens": 301,
            }
        }));
        let usage = usage.expect("usage 不应为空");
        assert_eq!(usage.context_window_max_tokens, Some(200_000));
        assert_eq!(usage.context_window_used_tokens, Some(1_801));
        assert_eq!(usage.input_tokens, Some(1_500));
        assert_eq!(usage.output_tokens, Some(301));
    }

    #[test]
    fn extract_usage_returns_none_for_empty_payload() {
        assert!(extract_usage(&json!({})).is_none());
    }
}
