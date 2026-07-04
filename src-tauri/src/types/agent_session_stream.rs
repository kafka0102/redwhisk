//! Codex session 结构化事件流的跨边界类型契约。
//!
//! 这些类型对应 `codex app-server` 经 Rust Core 归一化后广播给前端的
//! `AgentStreamEvent`。命名遵循项目约定：struct 使用 `camelCase`，事件与
//! 状态 enum 使用 `snake_case`。前端只消费这些结构，不发起业务写入。

use serde::{Deserialize, Serialize};

/// 顶层结构化事件，对应 `agent-session-stream-event` 广播载荷中的 `event` 字段。
///
/// 把 codex app-server 的 notification 归一化为按 `type` 区分的 union，
/// 前端用 `switch` 分发渲染。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum AgentStreamEvent {
    /// 新 thread 已建立（拿到 codex threadId）。
    ThreadStarted { thread_id: String },
    /// 一轮对话开始。
    TurnStarted { turn_id: Option<String> },
    /// 一轮对话正常结束，附带 token 用量。
    TurnCompleted {
        turn_id: Option<String>,
        usage: Option<AgentUsage>,
    },
    /// 一轮对话失败。
    TurnFailed {
        turn_id: Option<String>,
        error: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
    /// 一轮对话被中断。
    TurnCanceled {
        turn_id: Option<String>,
        reason: String,
    },
    /// timeline 项（消息、工具调用、推理等），是渲染消息流的核心载荷。
    Timeline {
        item: AgentTimelineItem,
        #[serde(skip_serializing_if = "Option::is_none")]
        turn_id: Option<String>,
        seq: u64,
        timestamp: i64,
    },
    /// 中途 token / 上下文窗口用量更新。
    UsageUpdated { usage: AgentUsage },
    /// 工具调用需要用户审批（命令执行、文件改动、用户输入）。
    PermissionRequested { request: AgentPermissionRequest },
    /// 审批已被解决（前端据此移除审批卡片）。
    PermissionResolved {
        request_id: String,
        resolution: String,
    },
    /// 协作模式切换（plan / code 等）。
    ModeChanged {
        current_mode_id: String,
        available_modes: Vec<AgentMode>,
    },
    /// 模型切换。
    ModelChanged { model_id: String },
    /// reasoning effort 切换或初始化。
    EffortChanged { effort: Option<String> },
}

/// timeline 项。
///
/// `tool_call` 通过 `detail` 二次分发到具体工具类型（shell / edit / search 等），
/// 让每种工具都有定制 UI 而非裸 stdout。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum AgentTimelineItem {
    UserMessage {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        message_id: Option<String>,
    },
    AssistantMessage {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        message_id: Option<String>,
    },
    Reasoning {
        text: String,
        /// reasoning 块持续时长（毫秒）。仅在块结束时（force flush）填充；
        /// 中间节流 flush 为 None。前端据此展示「思考过程 持续了 X 秒」。
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
    },
    ToolCall {
        call_id: String,
        name: String,
        detail: ToolCallDetail,
        status: ToolCallStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Todo {
        items: Vec<TodoItem>,
    },
    Error {
        message: String,
    },
    Compaction {
        status: CompactionStatus,
    },
}

/// 工具调用详情，首版实现 codex 用得到的子集。
///
/// `unknown` 作为兜底，保留原始 input/output 便于诊断。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum ToolCallDetail {
    Shell {
        command: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
    },
    Read {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        content: Option<String>,
    },
    Edit {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        diff: Option<String>,
    },
    Write {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        content: Option<String>,
    },
    Search {
        query: String,
        mode: SearchMode,
        matches: Vec<String>,
    },
    SubAgent {
        #[serde(skip_serializing_if = "Option::is_none")]
        child_session_id: Option<String>,
    },
    Plan {
        text: String,
    },
    Unknown {
        #[serde(skip_serializing_if = "Option::is_none")]
        raw_input: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        raw_output: Option<String>,
    },
}

/// 工具调用生命周期状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    Running,
    Completed,
    Failed,
    Canceled,
}

/// 搜索模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    Content,
    FilesWithMatches,
    Count,
}

/// 上下文压缩状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompactionStatus {
    Loading,
    Completed,
}

/// todo 项。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub text: String,
    pub completed: bool,
}

/// token / 上下文窗口用量。
///
/// 来自 codex `thread/tokenUsage/updated` 通知：`contextWindowMaxTokens`
/// 取 `model_context_window`，`contextWindowUsedTokens` 取 `last.total_tokens`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window_max_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window_used_tokens: Option<u64>,
}

/// 权限请求，对应 app-server 的 server→client request。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPermissionRequest {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub kind: PermissionKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub actions: Vec<AgentPermissionAction>,
}

/// 权限请求种类。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionKind {
    Tool,
    Plan,
    Question,
    Mode,
    Other,
}

/// 权限请求的可选动作。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPermissionAction {
    pub id: String,
    pub label: String,
    pub behavior: PermissionBehavior,
}

/// 权限动作行为。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionBehavior {
    Allow,
    Deny,
}

/// 协作模式（plan / code 等）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMode {
    pub mode_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// 可选模型。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModel {
    pub model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_default: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_reasoning_effort: Option<String>,
    pub supported_reasoning_efforts: Vec<String>,
}

/// `agent-session-stream-event` 的完整广播载荷。
///
/// `seq` 为单 session 内单调递增的事件序号；`epoch` 在 session 重建时更换，
/// 供前端做游标续传与历史回放对齐。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStreamEventEnvelope {
    pub project_id: i64,
    pub session_id: i64,
    pub seq: u64,
    pub epoch: String,
    pub event: AgentStreamEvent,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_assistant_message_timeline_with_snake_case_type() {
        let event = AgentStreamEvent::Timeline {
            item: AgentTimelineItem::AssistantMessage {
                text: "hello".into(),
                message_id: Some("m1".into()),
            },
            turn_id: None,
            seq: 3,
            timestamp: 1_700_000_000_000,
        };

        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(value["type"], "timeline");
        assert_eq!(value["item"]["type"], "assistant_message");
        assert_eq!(value["item"]["text"], "hello");
        assert_eq!(value["item"]["messageId"], "m1");
        assert_eq!(value["seq"], 3);
    }

    #[test]
    fn serializes_tool_call_with_detail_tag() {
        let event = AgentStreamEvent::Timeline {
            item: AgentTimelineItem::ToolCall {
                call_id: "c1".into(),
                name: "shell".into(),
                detail: ToolCallDetail::Shell {
                    command: "ls".into(),
                    output: Some("a\nb".into()),
                    exit_code: Some(0),
                },
                status: ToolCallStatus::Completed,
                error: None,
            },
            turn_id: Some("t1".into()),
            seq: 1,
            timestamp: 1_700_000_000_000,
        };

        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(value["item"]["detail"]["type"], "shell");
        assert_eq!(value["item"]["detail"]["command"], "ls");
        assert_eq!(value["item"]["detail"]["exitCode"], 0);
        assert_eq!(value["item"]["status"], "completed");
    }

    #[test]
    fn serializes_usage_updated_with_camel_case_fields() {
        let event = AgentStreamEvent::UsageUpdated {
            usage: AgentUsage {
                input_tokens: Some(10),
                output_tokens: None,
                context_window_max_tokens: Some(200_000),
                context_window_used_tokens: Some(1_801),
            },
        };

        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(value["type"], "usage_updated");
        assert_eq!(value["usage"]["inputTokens"], 10);
        assert!(value["usage"].get("outputTokens").is_none());
        assert_eq!(value["usage"]["contextWindowMaxTokens"], 200_000);
        assert_eq!(value["usage"]["contextWindowUsedTokens"], 1_801);
    }

    #[test]
    fn serializes_envelope_with_camel_case_top_level() {
        let envelope = AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 2,
            seq: 5,
            epoch: "epoch-1".into(),
            event: AgentStreamEvent::ThreadStarted {
                thread_id: "thr_1".into(),
            },
        };

        let value = serde_json::to_value(&envelope).unwrap();
        assert_eq!(value["projectId"], 1);
        assert_eq!(value["sessionId"], 2);
        assert_eq!(value["seq"], 5);
        assert_eq!(value["epoch"], "epoch-1");
        assert_eq!(value["event"]["type"], "thread_started");
        assert_eq!(value["event"]["threadId"], "thr_1");
    }

    #[test]
    fn permission_request_serializes_actions() {
        let request = AgentPermissionRequest {
            id: "req_1".into(),
            turn_id: Some("t1".into()),
            kind: PermissionKind::Tool,
            title: Some("Run command".into()),
            description: None,
            actions: vec![AgentPermissionAction {
                id: "accept".into(),
                label: "Allow".into(),
                behavior: PermissionBehavior::Allow,
            }],
        };

        let value = serde_json::to_value(&request).unwrap();
        assert_eq!(value["kind"], "tool");
        assert_eq!(value["actions"][0]["behavior"], "allow");
        assert!(value.get("description").is_none());
    }

    #[test]
    fn agent_model_serializes_efforts() {
        let model = AgentModel {
            model_id: "gpt-5".into(),
            display_name: Some("GPT-5".into()),
            is_default: Some(true),
            default_reasoning_effort: Some("medium".into()),
            supported_reasoning_efforts: vec![
                "low".into(),
                "medium".into(),
                "high".into(),
                "xhigh".into(),
            ],
        };

        let value = serde_json::to_value(&model).unwrap();
        assert_eq!(value["modelId"], "gpt-5");
        assert_eq!(
            value["supportedReasoningEfforts"],
            json!(["low", "medium", "high", "xhigh"])
        );
    }

    #[test]
    fn effort_changed_serializes_with_nullable_effort() {
        let event = AgentStreamEvent::EffortChanged {
            effort: Some("high".into()),
        };

        let value = serde_json::to_value(&event).unwrap();

        assert_eq!(value, json!({ "type": "effort_changed", "effort": "high" }));
    }
}
