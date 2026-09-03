//! OpenCode tool_use → `ToolCallDetail` 启发式映射。

use serde_json::Value;

use crate::types::agent_session_stream::{SearchMode, ToolCallDetail};

/// 启发式映射工具 detail（对齐 Claude event_mapper 子集）。
pub fn map_tool_detail(
    tool_name: &str,
    input: &Value,
    output: Option<&str>,
) -> (ToolCallDetail, String) {
    let lower = tool_name.to_ascii_lowercase();
    match lower.as_str() {
        "bash" | "shell" | "execute" | "run" => {
            let command = input
                .get("command")
                .or_else(|| input.get("cmd"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            (
                ToolCallDetail::Shell {
                    command,
                    output: output.map(str::to_string),
                    exit_code: input
                        .get("exit_code")
                        .or_else(|| input.get("exitCode"))
                        .and_then(Value::as_i64)
                        .map(|v| v as i32),
                },
                "shell".into(),
            )
        }
        "read" | "read_file" | "readfile" => {
            let path = path_from_input(input);
            (
                ToolCallDetail::Read {
                    path,
                    content: output.map(str::to_string),
                },
                "read".into(),
            )
        }
        "edit" | "str_replace" | "strreplace" | "apply_patch" => {
            let path = path_from_input(input);
            let diff = input
                .get("diff")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| output.map(str::to_string));
            (ToolCallDetail::Edit { path, diff }, "edit".into())
        }
        "write" | "write_file" | "writefile" | "create" => {
            let path = path_from_input(input);
            let content = input
                .get("content")
                .or_else(|| input.get("text"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| output.map(str::to_string));
            (ToolCallDetail::Write { path, content }, "write".into())
        }
        "grep" | "search" | "rg" | "glob" => {
            let query = input
                .get("query")
                .or_else(|| input.get("pattern"))
                .or_else(|| input.get("path"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let matches = output
                .map(|s| {
                    s.lines()
                        .filter(|l| !l.is_empty())
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
        _ => (
            ToolCallDetail::Unknown {
                raw_input: serde_json::to_string(input).ok(),
                raw_output: output.map(str::to_string),
            },
            tool_name.to_string(),
        ),
    }
}

fn path_from_input(input: &Value) -> String {
    input
        .get("path")
        .or_else(|| input.get("file"))
        .or_else(|| input.get("filePath"))
        .or_else(|| input.get("file_path"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_bash_to_shell() {
        let (detail, name) = map_tool_detail("bash", &json!({"command": "ls"}), Some("a.txt"));
        assert_eq!(name, "shell");
        assert!(matches!(
            detail,
            ToolCallDetail::Shell { command, output, .. }
                if command == "ls" && output.as_deref() == Some("a.txt")
        ));
    }

    #[test]
    fn maps_unknown_tool() {
        let (detail, name) = map_tool_detail("custom", &json!({"x": 1}), None);
        assert_eq!(name, "custom");
        assert!(matches!(detail, ToolCallDetail::Unknown { .. }));
    }
}
