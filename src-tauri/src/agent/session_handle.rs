//! Agent session 句柄的统一 trait 契约。
//!
//! 当前仅 Codex 有实现（`CodexSessionHandle`），但本 trait 为后续接入
//! Claude / 其他 agent 预留接缝：所有结构化会话命令通过 `Arc<dyn
//! AgentSessionHandle>` 调用，不直接依赖具体实现类型。
//!
//! 设计原则：
//! - trait 方法只用协议无关类型（`AgentModel` / `AgentMode` /
//!   `AgentTimelineItem` / `AgentPermissionDecision`），不泄露 codex
//!   app-server 的内部类型（如 `CodexMode` / `CodexAppServerError`）。
//! - `set_mode` 接收字符串 mode_id，由实现内部解析为各自的 mode 预设，
//!   避免命令层耦合具体 agent 的 mode 枚举。

use crate::types::agent_session::{AgentMessageAttachment, AgentPermissionDecision};
use crate::types::agent_session_stream::{AgentMode, AgentModel, AgentTimelineItem};

/// 结构化 agent session 调用过程中的归一化错误。
///
/// 各实现（codex / 未来 claude 等）的内部错误类型通过 `From` 转入本枚举，
/// 命令层统一用 `agent_session_error_to_command_error` 映射到 `CommandError`。
#[derive(Debug, thiserror::Error)]
pub enum AgentSessionError {
    /// agent 进程未运行 / 通道已关闭。
    #[error("agent 会话未运行：{0}")]
    NotRunning(String),
    /// agent 协议层错误（超时、序列化、非法响应等）。
    #[error("agent 会话协议错误：{0}")]
    Protocol(String),
    /// 不支持的协作模式 id（实现无法解析）。
    #[error("不支持的协作模式：{0}")]
    UnsupportedMode(String),
    /// 其他 agent 实现特定的错误。
    #[error("agent 会话调用失败：{0}")]
    Other(String),
}

impl From<crate::agent::codex_app_server::transport::CodexAppServerError> for AgentSessionError {
    fn from(error: crate::agent::codex_app_server::transport::CodexAppServerError) -> Self {
        use crate::agent::codex_app_server::transport::CodexAppServerError;
        match error {
            CodexAppServerError::BinaryNotFound(_)
            | CodexAppServerError::SpawnFailed(_)
            | CodexAppServerError::Closed(_) => AgentSessionError::NotRunning(error.to_string()),
            CodexAppServerError::RequestTimeout { .. }
            | CodexAppServerError::ServerError { .. }
            | CodexAppServerError::Protocol(_)
            | CodexAppServerError::Serialize(_)
            | CodexAppServerError::Io(_) => AgentSessionError::Protocol(error.to_string()),
        }
    }
}

/// 结构化 agent session 句柄的统一接口。
///
/// 实现者持有与 agent 进程的连接，负责消息收发、权限审批、模式切换、
/// 模型与用量查询、历史回放。所有方法对已关闭的会话应返回
/// `AgentSessionError::NotRunning`。
pub trait AgentSessionHandle: Send + Sync {
    /// 发送用户消息，发起新一轮 turn。
    ///
    /// `attachments` 为协议中立的附件列表（落盘路径 + 展示名 + 种类）；
    /// 空切片表示纯文本消息。具体 agent 实现负责把附件编码进各自协议
    /// 的输入块（codex → `TurnInput::Blocks`）。
    fn send_message(
        &self,
        text: String,
        attachments: Vec<AgentMessageAttachment>,
    ) -> Result<(), AgentSessionError>;

    /// 中断当前 turn；无 turn 运行时返回 `Ok(())`。
    fn cancel_turn(&self) -> Result<(), AgentSessionError>;

    /// 回复一个挂起的权限请求。
    fn respond_permission(
        &self,
        request_id: &str,
        decision: AgentPermissionDecision,
    ) -> Result<(), AgentSessionError>;

    /// 切换模型。
    fn set_model(&self, model_id: String) -> Result<(), AgentSessionError>;

    /// 切换 reasoning effort（Think 模式）；`None` 表示未指定。
    fn set_effort(&self, effort: Option<String>) -> Result<(), AgentSessionError>;

    /// 切换协作模式。`mode_id` 为字符串（如 `auto` / `full-access` /
    /// `read-only`），由实现内部解析为各自预设；无法解析时返回
    /// `AgentSessionError::UnsupportedMode`。
    fn set_mode(&self, mode_id: &str) -> Result<(), AgentSessionError>;

    /// 列出可用模型。
    fn list_models(&self) -> Result<Vec<AgentModel>, AgentSessionError>;

    /// 列出可用协作模式。无错误路径（实现保证返回至少默认模式）。
    fn list_modes(&self) -> Vec<AgentMode>;

    /// 读取 thread 历史，映射为 timeline items，供前端首次进入回放。
    fn read_timeline(&self) -> Result<Vec<AgentTimelineItem>, AgentSessionError>;

    /// 关闭会话：断开传输、注销广播游标。调用后句柄不再可用。
    fn shutdown(&self);

    /// 当前 thread 标识（codex threadId 等）；尚未建立时返回 `None`。
    fn thread_id(&self) -> Option<String>;
}
