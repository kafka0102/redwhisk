//! Codex session 结构化事件流的跨边界类型契约。
//!
//! 这些类型对应 `codex app-server` 经 Rust Core 归一化后广播给前端的
//! `AgentStreamEvent`。命名遵循项目约定：struct 使用 `camelCase`，事件与
//! 状态 enum 使用 `snake_case`。前端只消费这些结构，不发起业务写入。

use std::hash::{Hash, Hasher};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

/// 助手正文与推理的共享快照。序列化仍是 JSON 字符串。
/// 克隆只增加引用计数，下一帧需要追加时才复制正文。
#[derive(Clone, Debug, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SnapshotText(Arc<str>);

impl SnapshotText {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for SnapshotText {
    fn default() -> Self {
        Self(Arc::from(""))
    }
}

impl From<String> for SnapshotText {
    fn from(value: String) -> Self {
        Self(Arc::from(value))
    }
}

impl From<&str> for SnapshotText {
    fn from(value: &str) -> Self {
        Self(Arc::from(value))
    }
}

impl From<Arc<str>> for SnapshotText {
    fn from(value: Arc<str>) -> Self {
        Self(value)
    }
}

impl AsRef<str> for SnapshotText {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl std::borrow::Borrow<str> for SnapshotText {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

impl std::ops::Deref for SnapshotText {
    type Target = str;

    fn deref(&self) -> &str {
        self.as_str()
    }
}

impl PartialEq for SnapshotText {
    fn eq(&self, other: &Self) -> bool {
        self.as_str() == other.as_str()
    }
}

impl PartialEq<str> for SnapshotText {
    fn eq(&self, other: &str) -> bool {
        self.as_str() == other
    }
}

impl PartialEq<&str> for SnapshotText {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

impl PartialEq<String> for SnapshotText {
    fn eq(&self, other: &String) -> bool {
        self.as_str() == other.as_str()
    }
}

impl Hash for SnapshotText {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.as_str().hash(state);
    }
}

impl std::fmt::Display for SnapshotText {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

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
        /// SDK `result.stop_reason`：正常为 `end_turn`。异常终止（`max_tokens` /
        /// `tool_use` / 空值等）可据此区分「正常完成」与「被提前掐断」。
        #[serde(skip_serializing_if = "Option::is_none")]
        stop_reason: Option<String>,
        /// SDK `result.subtype`（`success` / `error_max_tokens` 等）。
        #[serde(skip_serializing_if = "Option::is_none")]
        subtype: Option<String>,
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
        text: SnapshotText,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message_id: Option<String>,
        /// 子智能体 thread id。缺省表示主智能体。必须在项上，重读日志时广播外壳不会留下。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        subagent_id: Option<String>,
    },
    Reasoning {
        text: SnapshotText,
        /// reasoning 块持续时长（毫秒）。仅在块结束时（force flush）填充；
        /// 中间节流 flush 为 None。前端据此展示「思考过程 持续了 X 秒」。
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        /// 子智能体 thread id。缺省表示主智能体。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        subagent_id: Option<String>,
    },
    ToolCall {
        call_id: String,
        name: String,
        detail: ToolCallDetail,
        status: ToolCallStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        /// 子智能体 thread id。缺省表示主智能体。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        subagent_id: Option<String>,
    },
    Todo {
        items: Vec<TodoItem>,
    },
    Error {
        message: String,
    },
    Compaction {
        status: CompactionStatus,
        /// 子智能体 thread id。缺省表示主智能体；子 thread 的压缩只属于这一路。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        subagent_id: Option<String>,
    },
    /// 可回放的子智能体花名册记录。不代表主 Turn，也不进入消息卡片。
    SubagentRoster {
        subagent_id: String,
        status: SubagentRosterStatus,
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
    /// Codex collab 拉起记录。子 thread id 来自 receiverThreadIds，描述来自 prompt。
    CollabAgent {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
        receiver_thread_ids: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sender_thread_id: Option<String>,
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

/// 子智能体在花名册里的运行状态。只描述这一路，不表示主 Turn。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubagentRosterStatus {
    Running,
    Ended,
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
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
    /// Session Token 消耗累计输入快照；与 composer 上下文占用无关。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_token_input: Option<u64>,
    /// Session Token 消耗累计输出快照；与 composer 上下文占用无关。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_token_output: Option<u64>,
    /// Session Token 消耗累计缓存读取快照；与 composer 上下文占用无关。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_token_cache: Option<u64>,
    /// Session Token 落库合并策略；只在进程内使用，不跨边界下发。
    #[serde(skip)]
    pub session_token_merge: SessionTokenMerge,
}

/// Session Token 消耗写入 Session 记录的合并方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SessionTokenMerge {
    /// Codex 线程累计：覆盖写入。
    #[default]
    Overwrite,
    /// 当前 turn 最新用量：覆盖本 turn 部分，落盘 committed+current。
    TurnLatest,
    /// turn 结束定稿：累进 committed。
    TurnCommit,
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
    /// 发给 LLM 的模型参数。与配置别名不同时才下发；缺省时展示层回退 `model_id`。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wire_model: Option<String>,
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
    /// 刚写入的会话日志行起始字节。写盘时为空，所以不会进 JSONL；广播前再填上。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_offset: Option<u64>,
}

#[cfg(test)]
#[path = "agent_session_stream_tests.rs"]
mod tests;
