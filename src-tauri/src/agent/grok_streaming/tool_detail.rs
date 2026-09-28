//! Grok ACP tool_call → `ToolCallDetail` 启发式映射（纯函数）。

use serde_json::Value;

use crate::types::agent_session_stream::{SearchMode, ToolCallDetail};

/// 启发式映射 Grok 工具调用（对齐既有 provider 的 detail 子集）。
///
/// `tool_name` 取 `_meta.x.ai/tool.name`（如 `read_file` / `run_terminal_command`）；
/// 工具名缺失或无法分类时，回退到 `rawInput.variant`（真实 `tool_call_update`
/// 报文带 `"variant":"ReadFile"`，而首个 `tool_call` 事件只带完整 `rawInput`、无 variant）；
/// `locations` 为 ACP `tool_call_update.locations[].path`，作为路径兜底。
pub fn map_grok_tool_detail(
    tool_name: &str,
    input: &Value,
    output: Option<&str>,
    locations: &[String],
) -> (ToolCallDetail, String) {
    // 先按工具名分类，再退到 rawInput.variant；两者都不命中即兜底 Unknown。
    let category = classify(&tool_name.to_ascii_lowercase())
        .or_else(|| string_field(input, &["variant"]).and_then(|variant| classify_variant(&variant)));
    let Some(category) = category else {
        return (
            ToolCallDetail::Unknown {
                raw_input: serde_json::to_string(input).ok(),
                raw_output: output.map(str::to_string),
            },
            if tool_name.is_empty() {
                "tool".into()
            } else {
                tool_name.to_string()
            },
        );
    };
    match category {
        ToolCategory::Shell => {
            let command =
                string_field(input, &["command", "cmd", "command_line"]).unwrap_or_default();
            (
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
            )
        }
        ToolCategory::Read => (
            ToolCallDetail::Read {
                path: path_field(input, locations),
                content: output.map(str::to_string),
            },
            "read".into(),
        ),
        ToolCategory::Write => (
            ToolCallDetail::Write {
                path: path_field(input, locations),
                content: string_field(input, &["content", "text"])
                    .or_else(|| output.map(str::to_string)),
            },
            "write".into(),
        ),
        ToolCategory::Edit => {
            let path = path_field(input, locations);
            let diff = string_field(input, &["diff"]).or_else(|| output.map(str::to_string));
            (ToolCallDetail::Edit { path, diff }, "edit".into())
        }
        ToolCategory::Search => {
            let query = string_field(input, &["query", "pattern"])
                .unwrap_or_else(|| path_field(input, locations));
            let matches = output
                .map(|text| {
                    text.lines()
                        .filter(|line| !line.is_empty())
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            (
                ToolCallDetail::Search {
                    query,
                    mode: SearchMode::Content,
                    matches,
                },
                "search".into(),
            )
        }
    }
}

/// 工具分类（仅覆盖既有 `ToolCallDetail` 子集）。
#[derive(Clone, Copy)]
enum ToolCategory {
    Shell,
    Read,
    Write,
    Edit,
    Search,
}

/// 按工具名分类：工具名是 `snake_case`（`read_file` / `run_terminal_command`），
/// 需要子串匹配以覆盖 `web_search`、`list_dir` 这类无分隔或非常规写法。
fn classify(signal: &str) -> Option<ToolCategory> {
    if signal.contains("terminal") || signal.contains("command") || signal.contains("shell") {
        return Some(ToolCategory::Shell);
    }
    if signal.contains("read") {
        return Some(ToolCategory::Read);
    }
    if signal.contains("write") {
        return Some(ToolCategory::Write);
    }
    if signal.contains("edit") || signal.contains("patch") || signal.contains("replace") {
        return Some(ToolCategory::Edit);
    }
    if signal.contains("search") || signal.contains("grep") || signal.contains("glob") {
        return Some(ToolCategory::Search);
    }
    None
}

/// 按 `rawInput.variant` 分类：variant 是 PascalCase（`ReadFile` /
/// `RunTerminalCommand`），按 camelCase 切词后做**整词**匹配——子串匹配会把
/// `Spreadsheet` 误判成 Read。
fn classify_variant(variant: &str) -> Option<ToolCategory> {
    let tokens: Vec<String> = split_camel_case(variant)
        .iter()
        .map(|token| token.to_ascii_lowercase())
        .collect();
    let has = |keys: &[&str]| tokens.iter().any(|token| keys.contains(&token.as_str()));
    if has(&["terminal", "command", "shell"]) {
        return Some(ToolCategory::Shell);
    }
    if has(&["read"]) {
        return Some(ToolCategory::Read);
    }
    if has(&["write"]) {
        return Some(ToolCategory::Write);
    }
    if has(&["edit", "patch", "replace"]) {
        return Some(ToolCategory::Edit);
    }
    if has(&["search", "grep", "glob"]) {
        return Some(ToolCategory::Search);
    }
    None
}

/// `ReadFile` → `["Read", "File"]`；无大写边界时返回整串（单 token）。
fn split_camel_case(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in input.chars() {
        if ch.is_ascii_uppercase() && !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
        current.push(ch);
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
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
    fn maps_read_file_variant_when_tool_name_absent() {
        // 真实报文：`tool_call_update` 的 `rawInput` 带 `"variant":"ReadFile"`，
        // 该更新事件不重新携带 `_meta.x.ai/tool`，variant 是这里的分类信号。
        let (detail, name) = map_grok_tool_detail(
            "",
            &json!({"variant": "ReadFile", "target_file": "/tmp/hello.txt"}),
            Some("hello\n"),
            &[],
        );
        assert_eq!(name, "read");
        assert!(matches!(
            detail,
            ToolCallDetail::Read { path, content }
                if path == "/tmp/hello.txt" && content.as_deref() == Some("hello\n")
        ));
    }

    #[test]
    fn variant_matches_whole_tokens_not_substrings() {
        // `Spreadsheet` 含子串 "read"，但 variant 走 camelCase 整词匹配，不应误判为 Read。
        let (detail, name) =
            map_grok_tool_detail("", &json!({"variant": "Spreadsheet", "sheet_id": "s1"}), None, &[]);
        assert_eq!(name, "tool");
        assert!(matches!(detail, ToolCallDetail::Unknown { .. }));
    }

    #[test]
    fn tool_name_signal_wins_over_variant() {
        // 工具名已能分类时以其为准，variant 仅作兜底。
        let (_, name) = map_grok_tool_detail(
            "run_terminal_command",
            &json!({"variant": "ReadFile", "command": "ls -la"}),
            None,
            &[],
        );
        assert_eq!(name, "shell");
    }

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
