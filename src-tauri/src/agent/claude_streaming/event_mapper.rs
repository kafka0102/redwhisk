//! Claude 消息/工具调用 → `AgentTimelineItem` / 工具状态映射。
//!
//! 对标 `codex_app_server/thread_item.rs`。把 Claude 的 assistant content 块、
//! tool_result 块、用量统计映射为 redwhisk 的 `AgentTimelineItem` /
//! `ToolCallStatus` / `AgentUsage`，供 session 层组装 `AgentStreamEvent`。
//!
//! 工具映射对照（Claude tool_use → redwhisk ToolCallDetail）：
//! - `Bash` → `Shell { command, output, exit_code }`
//! - `Read` → `Read { path }`
//! - `Edit` → `Edit { path, diff }`
//! - `Write` → `Write { path }`
//! - `Glob` / `Grep` → `Search { query, mode, matches }`
//! - 其他 → `Unknown { raw_input, raw_output }`

use serde_json::Value;

use super::message::{AssistantBlock, UsageStats, UserBlock};
use crate::types::agent_session_stream::{AgentUsage, SearchMode, ToolCallDetail, ToolCallStatus};

/// 把 assistant 的 content 块拆解为 timeline items 的构造原料。
///
/// 返回值按 content 块顺序排列。text → AssistantText，thinking → Reasoning，
/// tool_use → ToolUse（status 初始为 Running，待 tool_result 回填）。
#[derive(Debug)]
pub enum MappedBlock {
    /// assistant 文本。
    AssistantText { text: String },
    /// reasoning 文本。
    Reasoning { text: String },
    /// 工具调用（初始 Running）。
    ToolUse {
        call_id: String,
        name: String,
        detail: ToolCallDetail,
        status: ToolCallStatus,
    },
}

/// 把 assistant content 块映射为 timeline 原料。
pub fn map_assistant_blocks(blocks: &[AssistantBlock]) -> Vec<MappedBlock> {
    blocks.iter().map(map_assistant_block).collect()
}

fn map_assistant_block(block: &AssistantBlock) -> MappedBlock {
    match block {
        AssistantBlock::Text { text } => MappedBlock::AssistantText { text: text.clone() },
        AssistantBlock::Thinking { thinking } => MappedBlock::Reasoning {
            text: thinking.clone(),
        },
        AssistantBlock::ToolUse { id, name, input } => {
            let (detail, tool_name) = map_tool_use(name, input);
            MappedBlock::ToolUse {
                call_id: id.clone(),
                name: tool_name,
                detail,
                status: ToolCallStatus::Running,
            }
        }
    }
}

/// 把单个 tool_use 映射为 `(ToolCallDetail, 展示用的 tool 名)`。
///
/// 展示名归一化为 redwhisk 约定：Bash → shell，Edit/Write → 原名，
/// Glob/Grep → search，其余保留 Claude 原名。
fn map_tool_use(name: &str, input: &Value) -> (ToolCallDetail, String) {
    match name {
        "Bash" => {
            let command = input
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            (
                ToolCallDetail::Shell {
                    command,
                    output: None,
                    exit_code: None,
                },
                "shell".into(),
            )
        }
        "Read" => {
            let path = input
                .get("file_path")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            (
                ToolCallDetail::Read {
                    path,
                    content: None,
                },
                "read".into(),
            )
        }
        "Edit" => {
            let path = input
                .get("file_path")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let diff = build_edit_diff(input);
            (ToolCallDetail::Edit { path, diff }, "edit".into())
        }
        "Write" => {
            let path = input
                .get("file_path")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            (
                ToolCallDetail::Write {
                    path,
                    content: None,
                },
                "write".into(),
            )
        }
        "Grep" | "Glob" => {
            let query = input
                .get("pattern")
                .and_then(Value::as_str)
                .or_else(|| input.get("query").and_then(Value::as_str))
                .unwrap_or_default()
                .to_string();
            let mode = if name == "Grep" {
                SearchMode::Content
            } else {
                SearchMode::FilesWithMatches
            };
            (
                ToolCallDetail::Search {
                    query,
                    mode,
                    matches: Vec::new(),
                },
                "search".into(),
            )
        }
        _ => {
            let raw_input = serde_json::to_string(input).ok();
            (
                ToolCallDetail::Unknown {
                    raw_input,
                    raw_output: None,
                },
                name.to_string(),
            )
        }
    }
}

/// 从 Edit 的 old_string / new_string 构造简易 diff 文本。
fn build_edit_diff(input: &Value) -> Option<String> {
    let old = input.get("old_string").and_then(Value::as_str);
    let new = input.get("new_string").and_then(Value::as_str);
    match (old, new) {
        (Some(old), Some(new)) => Some(format!("-{old}\n+{new}")),
        (None, Some(new)) => Some(format!("+{new}")),
        (Some(old), None) => Some(format!("-{old}")),
        (None, None) => None,
    }
}

/// tool_result 回填结果。
pub struct ToolResultUpdate {
    pub call_id: String,
    pub status: ToolCallStatus,
    /// 回填给 ToolCallDetail 的更新（如 Bash 的 output/exit_code）。
    pub patch: ToolResultPatch,
}

/// tool_result 对 ToolCallDetail 的部分更新。
pub enum ToolResultPatch {
    /// Bash 命令结果。
    Shell {
        output: Option<String>,
        exit_code: Option<i32>,
    },
    /// Read 的文件内容。
    Read { content: Option<String> },
    /// 其他工具：原始输出。
    Unknown { raw_output: Option<String> },
}

/// 解析 user 消息里的 tool_result 块，返回更新列表。
pub fn map_tool_results(blocks: &[UserBlock]) -> Vec<ToolResultUpdate> {
    blocks
        .iter()
        .filter_map(|block| match block {
            UserBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => Some(ToolResultUpdate {
                call_id: tool_use_id.clone(),
                status: if *is_error {
                    ToolCallStatus::Failed
                } else {
                    ToolCallStatus::Completed
                },
                patch: ToolResultPatch::Unknown {
                    raw_output: if content.is_empty() {
                        None
                    } else {
                        Some(content.clone())
                    },
                },
            }),
            UserBlock::Text { .. } => None,
        })
        .collect()
}

/// 从用量统计构造 `AgentUsage`。
pub fn map_usage(stats: &UsageStats) -> AgentUsage {
    AgentUsage {
        input_tokens: stats.input_tokens,
        output_tokens: stats.output_tokens,
        context_window_max_tokens: stats.context_window_max_tokens,
        context_window_used_tokens: stats.input_tokens,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::agent_session_stream::ToolCallDetail;
    use serde_json::json;

    fn tool_use(name: &str, input: Value) -> AssistantBlock {
        AssistantBlock::ToolUse {
            id: "tool_1".into(),
            name: name.into(),
            input,
        }
    }

    #[test]
    fn maps_bash_tool_use_to_shell() {
        let blocks = vec![tool_use("Bash", json!({ "command": "ls -la" }))];
        let mapped = map_assistant_blocks(&blocks);
        match &mapped[0] {
            MappedBlock::ToolUse {
                name,
                detail,
                status,
                ..
            } => {
                assert_eq!(name, "shell");
                assert!(
                    matches!(detail, ToolCallDetail::Shell { command, .. } if command == "ls -la")
                );
                assert_eq!(*status, ToolCallStatus::Running);
            }
            other => panic!("期望 ToolUse，实际 {other:?}"),
        }
    }

    #[test]
    fn maps_edit_tool_use_with_diff() {
        let blocks = vec![tool_use(
            "Edit",
            json!({ "file_path": "src/a.rs", "old_string": "old", "new_string": "new" }),
        )];
        let mapped = map_assistant_blocks(&blocks);
        match &mapped[0] {
            MappedBlock::ToolUse { name, detail, .. } => {
                assert_eq!(name, "edit");
                match detail {
                    ToolCallDetail::Edit { path, diff } => {
                        assert_eq!(path, "src/a.rs");
                        assert_eq!(diff.as_deref(), Some("-old\n+new"));
                    }
                    other => panic!("期望 Edit，实际 {other:?}"),
                }
            }
            other => panic!("期望 ToolUse，实际 {other:?}"),
        }
    }

    #[test]
    fn maps_grep_to_search() {
        let blocks = vec![tool_use("Grep", json!({ "pattern": "TODO" }))];
        let mapped = map_assistant_blocks(&blocks);
        match &mapped[0] {
            MappedBlock::ToolUse { name, detail, .. } => {
                assert_eq!(name, "search");
                assert!(
                    matches!(detail, ToolCallDetail::Search { query, mode, .. } if query == "TODO" && *mode == SearchMode::Content)
                );
            }
            other => panic!("期望 ToolUse，实际 {other:?}"),
        }
    }

    #[test]
    fn maps_unknown_tool_to_unknown() {
        let blocks = vec![tool_use("CustomTool", json!({ "x": 1 }))];
        let mapped = map_assistant_blocks(&blocks);
        match &mapped[0] {
            MappedBlock::ToolUse { name, detail, .. } => {
                assert_eq!(name, "CustomTool");
                assert!(matches!(detail, ToolCallDetail::Unknown { .. }));
            }
            other => panic!("期望 ToolUse，实际 {other:?}"),
        }
    }

    #[test]
    fn maps_text_and_thinking_blocks() {
        let blocks = vec![
            AssistantBlock::Thinking {
                thinking: "let me think".into(),
            },
            AssistantBlock::Text {
                text: "hello".into(),
            },
        ];
        let mapped = map_assistant_blocks(&blocks);
        assert!(matches!(&mapped[0], MappedBlock::Reasoning { text } if text == "let me think"));
        assert!(matches!(&mapped[1], MappedBlock::AssistantText { text } if text == "hello"));
    }

    #[test]
    fn maps_tool_result_to_completed_or_failed() {
        let blocks = vec![
            UserBlock::ToolResult {
                tool_use_id: "t1".into(),
                content: "ok".into(),
                is_error: false,
            },
            UserBlock::ToolResult {
                tool_use_id: "t2".into(),
                content: "err".into(),
                is_error: true,
            },
        ];
        let updates = map_tool_results(&blocks);
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[0].call_id, "t1");
        assert_eq!(updates[0].status, ToolCallStatus::Completed);
        assert_eq!(updates[1].call_id, "t2");
        assert_eq!(updates[1].status, ToolCallStatus::Failed);
    }

    #[test]
    fn maps_usage() {
        let stats = UsageStats {
            input_tokens: Some(100),
            output_tokens: Some(5),
            context_window_max_tokens: Some(200000),
        };
        let usage = map_usage(&stats);
        assert_eq!(usage.input_tokens, Some(100));
        assert_eq!(usage.output_tokens, Some(5));
        assert_eq!(usage.context_window_max_tokens, Some(200000));
        assert_eq!(usage.context_window_used_tokens, Some(100));
    }
}
