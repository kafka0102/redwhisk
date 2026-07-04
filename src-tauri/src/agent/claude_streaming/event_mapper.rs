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
#[derive(Debug)]
pub struct ToolResultUpdate {
    pub call_id: String,
    pub status: ToolCallStatus,
    /// 回填给 ToolCallDetail 的更新（如 Bash 的 output/exit_code）。
    pub patch: ToolResultPatch,
}

/// tool_result 对 ToolCallDetail 的部分更新。
#[derive(Debug)]
pub enum ToolResultPatch {
    /// Bash 命令结果。
    Shell {
        output: Option<String>,
        exit_code: Option<i32>,
    },
    /// Read 的文件内容。
    Read { content: Option<String> },
    /// Edit 结果：成功结果无信息量（"文件已被成功修改"），不回填文本，
    /// 仅保留与 tool_use 阶段一致的 detail type，避免前端 reducer 因 type
    /// 不一致整体覆盖丢失 path/diff。失败时 is_error 已体现在 ToolResultUpdate.status。
    Edit,
    /// Write 结果：同 Edit，成功无信息量，仅保持 type 一致。
    Write,
    /// 其他工具：原始输出。
    Unknown { raw_output: Option<String> },
}

/// 解析 user 消息里的 tool_result 块，返回更新列表。
///
/// `resolve_tool_name` 把 tool_use_id 映射到该调用对应的原始工具名
/// （如 "Bash" / "Read" / "Edit"）。用于保留 tool_result 回填时的工具类型，
/// 避免把已建立的 `Read { path }` / `Edit { path }` 降级成 `Unknown`。
/// 若映射缺失（未捕获到对应的 tool_use 块），回退到 `Unknown`。
pub fn map_tool_results(
    blocks: &[UserBlock],
    resolve_tool_name: impl Fn(&str) -> Option<String>,
) -> Vec<ToolResultUpdate> {
    blocks
        .iter()
        .filter_map(|block| match block {
            UserBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                let tool_name = resolve_tool_name(tool_use_id);
                let output = if content.is_empty() {
                    None
                } else {
                    Some(content.clone())
                };
                let patch =
                    build_tool_result_patch(tool_name.as_deref(), output, content, *is_error);
                Some(ToolResultUpdate {
                    call_id: tool_use_id.clone(),
                    status: if *is_error {
                        ToolCallStatus::Failed
                    } else {
                        ToolCallStatus::Completed
                    },
                    patch,
                })
            }
            UserBlock::Text { .. } => None,
        })
        .collect()
}

/// 根据已知工具名派生对应类型的 patch，保持与 tool_use 阶段一致的 detail type。
///
/// 已知工具：Bash → Shell（output 取 content，exit_code 解析自尾部，缺失则 None），
/// Read → Read，Edit/Write → 同名空 patch（成功结果无信息量，仅保持 type 一致，
/// 由前端 reducer 字段级合并保留 tool_use 阶段的 path/diff）。未知或缺失工具名
/// → Unknown。保持类型一致是关键：前端 reducer 在 type 一致时做字段级合并
/// （incoming 空字段保留 existing），type 不一致时整体覆盖；若降级到 Unknown
/// 会丢失 tool_use 阶段的 path/command/diff。
///
/// `is_error` 用于未来扩展失败文案回填（当前 Edit/Write 失败已由 status=Failed 表达）。
fn build_tool_result_patch(
    tool_name: Option<&str>,
    output: Option<String>,
    content: &str,
    _is_error: bool,
) -> ToolResultPatch {
    match tool_name {
        Some("Bash") => {
            let exit_code = extract_exit_code(content);
            ToolResultPatch::Shell { output, exit_code }
        }
        Some("Read") => ToolResultPatch::Read { content: output },
        Some("Edit") => ToolResultPatch::Edit,
        Some("Write") => ToolResultPatch::Write,
        _ => ToolResultPatch::Unknown { raw_output: output },
    }
}

/// 从 Bash 工具结果文本尾部解析 exit code。
///
/// Claude Code 的 Bash 工具结果通常在末尾以明确标记附上退出码，常见格式：
/// - `exit_code: N`（auto-commit 脚本与其他遵循该约定的输出）
/// - `Exit code: N`
/// 仅匹配这些明确前缀，避免误解析普通输出行（如 "exiting..."）。
fn extract_exit_code(content: &str) -> Option<i32> {
    content.lines().rev().find_map(|line| {
        let trimmed = line.trim();
        let value = trimmed
            .strip_prefix("exit_code:")
            .or_else(|| trimmed.strip_prefix("Exit code:"))?;
        value
            .trim()
            .trim_end_matches(';')
            .trim()
            .parse::<i32>()
            .ok()
    })
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
        let updates = map_tool_results(&blocks, |_| None);
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[0].call_id, "t1");
        assert_eq!(updates[0].status, ToolCallStatus::Completed);
        assert_eq!(updates[1].call_id, "t2");
        assert_eq!(updates[1].status, ToolCallStatus::Failed);
    }

    #[test]
    fn tool_result_preserves_read_patch_type_when_tool_name_known() {
        let blocks = vec![UserBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: "file contents".into(),
            is_error: false,
        }];
        let updates = map_tool_results(&blocks, |id| (id == "t1").then(|| "Read".to_string()));
        assert_eq!(updates.len(), 1);
        match &updates[0].patch {
            ToolResultPatch::Read { content } => {
                assert_eq!(content.as_deref(), Some("file contents"));
            }
            other => panic!("期望 Read patch，实际 {other:?}"),
        }
    }

    #[test]
    fn tool_result_preserves_shell_patch_type_when_tool_name_known() {
        let blocks = vec![UserBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: "ls output\nexit_code: 0".into(),
            is_error: false,
        }];
        let updates = map_tool_results(&blocks, |id| (id == "t1").then(|| "Bash".to_string()));
        assert_eq!(updates.len(), 1);
        match &updates[0].patch {
            ToolResultPatch::Shell { output, exit_code } => {
                assert_eq!(output.as_deref(), Some("ls output\nexit_code: 0"));
                assert_eq!(*exit_code, Some(0));
            }
            other => panic!("期望 Shell patch，实际 {other:?}"),
        }
    }

    #[test]
    fn tool_result_preserves_edit_patch_type_when_tool_name_known() {
        // Edit 的 tool_result（"文件已被成功修改"）成功结果无信息量，
        // 不应回填 raw_output 导致前端 reducer 把 Edit 降级成 Unknown。
        // 这里断言 patch 仍为 Edit（保持 type 一致，path/diff 由 reducer 字段级合并保留）。
        let blocks = vec![UserBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: "The file has been updated".into(),
            is_error: false,
        }];
        let updates = map_tool_results(&blocks, |id| (id == "t1").then(|| "Edit".to_string()));
        assert_eq!(updates.len(), 1);
        assert!(
            matches!(&updates[0].patch, ToolResultPatch::Edit),
            "期望 Edit patch，实际 {:?}",
            updates[0].patch
        );
    }

    #[test]
    fn tool_result_preserves_write_patch_type_when_tool_name_known() {
        let blocks = vec![UserBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: "The file has been updated".into(),
            is_error: false,
        }];
        let updates = map_tool_results(&blocks, |id| (id == "t1").then(|| "Write".to_string()));
        assert_eq!(updates.len(), 1);
        assert!(
            matches!(&updates[0].patch, ToolResultPatch::Write),
            "期望 Write patch，实际 {:?}",
            updates[0].patch
        );
    }

    #[test]
    fn tool_result_falls_back_to_unknown_when_tool_name_missing() {
        let blocks = vec![UserBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: "raw".into(),
            is_error: false,
        }];
        let updates = map_tool_results(&blocks, |_| None);
        assert_eq!(updates.len(), 1);
        assert!(matches!(
            &updates[0].patch,
            ToolResultPatch::Unknown { raw_output } if raw_output.as_deref() == Some("raw")
        ));
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
