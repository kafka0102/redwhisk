//! codex app-server notification 解析。
//!
//! 把 codex 的 JSON-RPC notification（`method` + `params`）归一化为
//! 类型化 `CodexNotification`。上层 `session` 再把它转成
//! `AgentStreamEvent` 广播给前端。
//!
//! 覆盖的 method 取自 paseo codex-app-server-agent 实测集合，
//! 优先处理现代 `item/*` 通道（codex 0.x 新协议）；旧版 `codex_event`
//! 风格的 `msg.type=exec_command_*` 等通知因与 `item/*` 信息重叠，
//! 首版不单独解析，遇到时归入 `Unknown`。

use serde_json::Value;

use crate::types::agent_session_stream::SearchMode;

/// 已解析的 codex notification。
#[derive(Debug, Clone, PartialEq)]
pub enum CodexNotification {
    /// `thread/started`：thread 建立完成，拿到 threadId。
    ThreadStarted { thread_id: String },
    /// `turn/started`：一轮对话开始。
    TurnStarted {
        turn_id: String,
        thread_id: Option<String>,
    },
    /// `turn/completed`：一轮对话结束。
    TurnCompleted {
        turn_id: Option<String>,
        thread_id: Option<String>,
        status: String,
        error_message: Option<String>,
    },
    /// `thread/tokenUsage/updated`：token / 上下文窗口用量。
    TokenUsageUpdated { token_usage: Value },
    /// `thread/compacted`：上下文已压缩。
    ContextCompacted {
        thread_id: String,
        turn_id: Option<String>,
    },
    /// `item/agentMessage/delta`：assistant 文本增量。
    AgentMessageDelta {
        item_id: String,
        delta: String,
        thread_id: Option<String>,
    },
    /// `item/reasoning/summaryTextDelta`：reasoning 文本增量。
    ReasoningDelta {
        item_id: String,
        delta: String,
        thread_id: Option<String>,
    },
    /// `item/started` / `item/completed`：thread item 生命周期。
    /// `item` 字段是 codex 原始结构（type=commandExecution/fileChange/...）。
    ItemStarted {
        item: Value,
        thread_id: Option<String>,
    },
    ItemCompleted {
        item: Value,
        thread_id: Option<String>,
    },
    /// `item/commandExecution/terminalInteraction`：终端交互。
    TerminalInteraction {
        item_id: Option<String>,
        process_id: Option<String>,
        stdin: Option<String>,
    },
    /// `item/fileChange/outputDelta`：文件改动增量输出。
    FileChangeOutputDelta {
        item_id: String,
        delta: Option<String>,
    },
    /// `turn/planUpdated`：plan 步骤更新。
    PlanUpdated { plan: Vec<PlanStep> },
    /// `turn/diffUpdated`：轮次 diff 更新。
    DiffUpdated { diff: String },
    /// 未识别 method，保留原始载荷供诊断。
    Unknown { method: String, params: Value },
}

/// plan 步骤。
#[derive(Debug, Clone, PartialEq)]
pub struct PlanStep {
    pub step: Option<String>,
    pub status: Option<String>,
}

/// 解析一条 notification。
pub fn parse_notification(method: &str, params: &Value) -> CodexNotification {
    match method {
        "thread/started" => parse_thread_started(params),
        "turn/started" => parse_turn_started(params),
        "turn/completed" => parse_turn_completed(params),
        "thread/tokenUsage/updated" => CodexNotification::TokenUsageUpdated {
            token_usage: params.get("tokenUsage").cloned().unwrap_or(Value::Null),
        },
        "thread/compacted" => CodexNotification::ContextCompacted {
            thread_id: str_field(params, "threadId").unwrap_or_default(),
            turn_id: str_field(params, "turnId"),
        },
        "item/agentMessage/delta" => CodexNotification::AgentMessageDelta {
            item_id: str_field(params, "itemId").unwrap_or_default(),
            delta: str_field(params, "delta").unwrap_or_default(),
            thread_id: str_field(params, "threadId"),
        },
        "item/reasoning/summaryTextDelta" => CodexNotification::ReasoningDelta {
            item_id: str_field(params, "itemId").unwrap_or_default(),
            delta: str_field(params, "delta").unwrap_or_default(),
            thread_id: str_field(params, "threadId"),
        },
        "item/started" => CodexNotification::ItemStarted {
            item: params.get("item").cloned().unwrap_or(Value::Null),
            thread_id: str_field(params, "threadId"),
        },
        "item/completed" => CodexNotification::ItemCompleted {
            item: params.get("item").cloned().unwrap_or(Value::Null),
            thread_id: str_field(params, "threadId"),
        },
        "item/commandExecution/terminalInteraction" => CodexNotification::TerminalInteraction {
            item_id: str_field(params, "itemId"),
            process_id: str_field(params, "processId"),
            stdin: str_field(params, "stdin"),
        },
        "item/fileChange/outputDelta" => CodexNotification::FileChangeOutputDelta {
            item_id: str_field(params, "itemId").unwrap_or_default(),
            delta: str_field(params, "delta"),
        },
        "turn/planUpdated" => CodexNotification::PlanUpdated {
            plan: parse_plan_steps(params),
        },
        "turn/diffUpdated" => CodexNotification::DiffUpdated {
            diff: str_field(params, "diff").unwrap_or_default(),
        },
        _ => CodexNotification::Unknown {
            method: method.to_string(),
            params: params.clone(),
        },
    }
}

fn parse_thread_started(params: &Value) -> CodexNotification {
    let thread_id = params
        .get("thread")
        .and_then(|thread| thread.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    CodexNotification::ThreadStarted { thread_id }
}

fn parse_turn_started(params: &Value) -> CodexNotification {
    let turn_id = params
        .get("turn")
        .and_then(|turn| turn.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    CodexNotification::TurnStarted {
        turn_id,
        thread_id: str_field(params, "threadId"),
    }
}

fn parse_turn_completed(params: &Value) -> CodexNotification {
    let turn = params.get("turn").cloned().unwrap_or(Value::Null);
    CodexNotification::TurnCompleted {
        turn_id: turn.get("id").and_then(Value::as_str).map(String::from),
        thread_id: str_field(params, "threadId"),
        status: str_field(&turn, "status").unwrap_or_default(),
        error_message: turn
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .map(String::from),
    }
}

fn parse_plan_steps(params: &Value) -> Vec<PlanStep> {
    params
        .get("plan")
        .and_then(Value::as_array)
        .map(|steps| {
            steps
                .iter()
                .map(|step| PlanStep {
                    step: str_field(step, "step"),
                    status: str_field(step, "status"),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn str_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(|s| s.to_string())
}

/// 从 codex thread item 的 `type` 字段读取归一化类型名。
///
/// codex 同时下发 PascalCase（`CommandExecution`）与 camelCase
/// （`commandExecution`）两种形态；统一归一为 camelCase 供下游匹配。
pub fn normalize_thread_item_type(raw: &str) -> &str {
    match raw {
        "UserMessage" | "userMessage" => "userMessage",
        "AgentMessage" | "agentMessage" => "agentMessage",
        "Reasoning" | "reasoning" => "reasoning",
        "Plan" | "plan" => "plan",
        "CommandExecution" | "commandExecution" => "commandExecution",
        "FileChange" | "fileChange" => "fileChange",
        "McpToolCall" | "mcpToolCall" => "mcpToolCall",
        "WebSearch" | "webSearch" => "webSearch",
        "CollabAgentToolCall" | "collabAgentToolCall" => "collabAgentToolCall",
        "ImageView" | "imageView" => "imageView",
        "ImageGeneration" | "imageGeneration" => "imageGeneration",
        "contextCompaction" | "ContextCompaction" => "contextCompaction",
        other => other,
    }
}

/// 从原始 search mode 字符串归一化为 `SearchMode`。
pub fn parse_search_mode(value: &str) -> SearchMode {
    match value {
        "files_with_matches" | "filesWithMatches" => SearchMode::FilesWithMatches,
        "count" | "Count" => SearchMode::Count,
        _ => SearchMode::Content,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_thread_started() {
        let notification =
            parse_notification("thread/started", &json!({ "thread": { "id": "thr_1" } }));
        assert_eq!(
            notification,
            CodexNotification::ThreadStarted {
                thread_id: "thr_1".into(),
            }
        );
    }

    #[test]
    fn parses_turn_started_and_completed() {
        let started = parse_notification(
            "turn/started",
            &json!({ "threadId": "thr_1", "turn": { "id": "t1" } }),
        );
        assert_eq!(
            started,
            CodexNotification::TurnStarted {
                turn_id: "t1".into(),
                thread_id: Some("thr_1".into()),
            }
        );

        let completed = parse_notification(
            "turn/completed",
            &json!({
                "threadId": "thr_1",
                "turn": { "id": "t1", "status": "completed" }
            }),
        );
        assert_eq!(
            completed,
            CodexNotification::TurnCompleted {
                turn_id: Some("t1".into()),
                thread_id: Some("thr_1".into()),
                status: "completed".into(),
                error_message: None,
            }
        );
    }

    #[test]
    fn parses_token_usage_updated() {
        let notification = parse_notification(
            "thread/tokenUsage/updated",
            &json!({ "tokenUsage": { "model_context_window": 200000 } }),
        );
        match notification {
            CodexNotification::TokenUsageUpdated { token_usage } => {
                assert_eq!(token_usage["model_context_window"], 200_000);
            }
            other => panic!("期望 TokenUsageUpdated，实际 {other:?}"),
        }
    }

    #[test]
    fn parses_agent_message_delta() {
        let notification = parse_notification(
            "item/agentMessage/delta",
            &json!({ "threadId": "thr_1", "itemId": "i1", "delta": "hello" }),
        );
        assert_eq!(
            notification,
            CodexNotification::AgentMessageDelta {
                item_id: "i1".into(),
                delta: "hello".into(),
                thread_id: Some("thr_1".into()),
            }
        );
    }

    #[test]
    fn parses_item_started_with_command_execution() {
        let notification = parse_notification(
            "item/started",
            &json!({
                "threadId": "thr_1",
                "item": { "id": "i1", "type": "commandExecution", "command": "ls" }
            }),
        );
        match notification {
            CodexNotification::ItemStarted { item, thread_id } => {
                assert_eq!(item["type"], "commandExecution");
                assert_eq!(item["command"], "ls");
                assert_eq!(thread_id.as_deref(), Some("thr_1"));
            }
            other => panic!("期望 ItemStarted，实际 {other:?}"),
        }
    }

    #[test]
    fn unknown_method_preserved() {
        let notification = parse_notification("some/new/method", &json!({ "foo": "bar" }));
        match notification {
            CodexNotification::Unknown { method, params } => {
                assert_eq!(method, "some/new/method");
                assert_eq!(params["foo"], "bar");
            }
            other => panic!("期望 Unknown，实际 {other:?}"),
        }
    }

    #[test]
    fn normalizes_pascal_case_item_type() {
        assert_eq!(
            normalize_thread_item_type("CommandExecution"),
            "commandExecution"
        );
        assert_eq!(
            normalize_thread_item_type("commandExecution"),
            "commandExecution"
        );
        assert_eq!(normalize_thread_item_type("FileChange"), "fileChange");
        assert_eq!(normalize_thread_item_type("customThing"), "customThing");
    }
}
