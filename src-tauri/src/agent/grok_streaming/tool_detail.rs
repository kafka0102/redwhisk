//! Grok ACP tool_call → `ToolCallDetail` 启发式映射（纯函数）。

use serde_json::Value;

use crate::types::agent_session_stream::{SearchMode, ToolCallDetail};

/// 启发式映射 Grok 工具调用（对齐既有 provider 的 detail 子集）。
///
/// `tool_name` 取 `_meta.x.ai/tool.name`（如 `read_file` / `run_terminal_command`）；
/// `locations` 为 ACP `tool_call_update.locations[].path`，作为路径兜底。
pub fn map_grok_tool_detail(
    tool_name: &str,
    input: &Value,
    output: Option<&str>,
    locations: &[String],
) -> (ToolCallDetail, String) {
    let lower = tool_name.to_ascii_lowercase();
    if lower.contains("terminal") || lower.contains("command") || lower.contains("shell") {
        let command = string_field(input, &["command", "cmd", "command_line"]).unwrap_or_default();
        return (
            ToolCallDetail::Shell {
                command,
                output: output.map(str::to_string),
                exit_code: input
                    .get("exit_code")
                    .or_else(|| input.get("exitCode"))
                    .and_then(Value::as_i64)
                    .map(|value| value as i32),
            },
            "shell".into(),
        );
    }
    if lower.contains("read") {
        return (
            ToolCallDetail::Read {
                path: path_field(input, locations),
                content: output.map(str::to_string),
            },
            "read".into(),
        );
    }
    if lower.contains("write") {
        return (
            ToolCallDetail::Write {
                path: path_field(input, locations),
                content: string_field(input, &["content", "text"]).or_else(|| output.map(str::to_string)),
            },
            "write".into(),
        );
    }
    if lower.contains("edit") || lower.contains("patch") || lower.contains("replace") {
        let path = path_field(input, locations);
        let diff = string_field(input, &["diff"]).or_else(|| output.map(str::to_string));
        return (ToolCallDetail::Edit { path, diff }, "edit".into());
    }
    if lower.contains("search") || lower.contains("grep") || lower.contains("glob") {
        let query =
            string_field(input, &["query", "pattern"]).unwrap_or_else(|| path_field(input, locations));
        let matches = output
            .map(|text| {
                text.lines()
                    .filter(|line| !line.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        return (
            ToolCallDetail::Search {
                query,
                mode: SearchMode::Content,
                matches,
            },
            "search".into(),
        );
    }
    (
        ToolCallDetail::Unknown {
            raw_input: serde_json::to_string(input).ok(),
            raw_output: output.map(str::to_string),
        },
        if tool_name.is_empty() {
            "tool".into()
        } else {
            tool_name.to_string()
        },
    )
}

/// 工具展示名：优先 `_meta.x.ai/tool.label`，回退 `_meta.x.ai/tool.name`，再回退 title。
pub fn tool_name_from_update(update: &Value) -> String {
    update
        .get("_meta")
        .and_then(|meta| meta.get("x.ai/tool"))
        .and_then(|tool| {
            tool.get("name")
                .and_then(Value::as_str)
                .or_else(|| tool.get("label").and_then(Value::as_str))
        })
        .or_else(|| update.get("title").and_then(Value::as_str))
        .or_else(|| update.get("name").and_then(Value::as_str))
        .unwrap_or("")
        .to_string()
}

/// 从 rawOutput / content 提取可展示文本（Grok 各工具结构不一，做 best-effort）。
pub fn tool_output_text(update: &Value) -> Option<String> {
    if let Some(text) = update
        .get("content")
        .and_then(Value::as_array)
        .and_then(|blocks| {
            let mut parts = Vec::new();
            for block in blocks {
                if let Some(text) = block
                    .get("content")
                    .and_then(|content| content.get("text"))
                    .and_then(Value::as_str)
                {
                    parts.push(text.to_string());
                }
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(""))
            }
        })
    {
        return Some(text);
    }
    let raw = update.get("rawOutput")?;
    if let Some(text) = raw.as_str() {
        return Some(text.to_string());
    }
    raw.get("FileContent")
        .and_then(|file| file.get("raw_output"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| serde_json::to_string(raw).ok())
}

fn path_field(input: &Value, locations: &[String]) -> String {
    string_field(
        input,
        &["target_file", "path", "file", "file_path", "absolute_path"],
    )
    .or_else(|| locations.first().cloned())
    .unwrap_or_default()
}

fn string_field(input: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| input.get(*key).and_then(Value::as_str))
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_read_file_with_target_file_path() {
        let (detail, name) = map_grok_tool_detail(
            "read_file",
            &json!({"variant": "ReadFile", "target_file": "/tmp/hello.txt"}),
            Some("hello\n"),
            &["/tmp/hello.txt".to_string()],
        );
        assert_eq!(name, "read");
        assert!(matches!(
            detail,
            ToolCallDetail::Read { path, content }
                if path == "/tmp/hello.txt" && content.as_deref() == Some("hello\n")
        ));
    }

    #[test]
    fn maps_terminal_command_to_shell() {
        let (detail, name) = map_grok_tool_detail(
            "run_terminal_command",
            &json!({"command": "ls -la"}),
            Some("a.txt"),
            &[],
        );
        assert_eq!(name, "shell");
        assert!(matches!(
            detail,
            ToolCallDetail::Shell { command, .. } if command == "ls -la"
        ));
    }

    #[test]
    fn unknown_tool_falls_back_to_unknown_with_raw_input() {
        let (detail, name) = map_grok_tool_detail("custom_tool", &json!({"x": 1}), None, &[]);
        assert_eq!(name, "custom_tool");
        assert!(matches!(detail, ToolCallDetail::Unknown { raw_input: Some(_), .. }));
    }

    #[test]
    fn tool_name_prefers_meta_name_then_title() {
        assert_eq!(
            tool_name_from_update(
                &json!({"_meta": {"x.ai/tool": {"name": "read_file", "label": "Read"}}, "title": "t"})
            ),
            "read_file"
        );
        assert_eq!(tool_name_from_update(&json!({"title": "Read `x`"})), "Read `x`");
        assert_eq!(tool_name_from_update(&json!({})), "");
    }

    #[test]
    fn extracts_read_file_raw_output() {
        let update = json!({
            "rawOutput": {
                "type": "ReadFile",
                "FileContent": {"raw_output": "hello\n", "total_lines": 2}
            }
        });
        assert_eq!(tool_output_text(&update).as_deref(), Some("hello\n"));
    }
}
