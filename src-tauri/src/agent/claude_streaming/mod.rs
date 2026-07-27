//! Claude Code 结构化会话接入模块。
//!
//! 通过 `claude -p --output-format stream-json` 子进程接入 Claude Code，
//! 把其 NDJSON `SDKMessage` 流归一化为 `AgentStreamEvent` 后广播给前端。
//!
//! 与 `codex_app_server` 的关键差异：
//! - Claude 的 `stream-json` 是**单向流**（每行一个 SDKMessage，无 JSON-RPC
//!   的 request/response id 配对、无 server→client 审批 request），因此传输层
//!   去掉了 pending map 与 request/response 配对机制。
//! - 采用**单轮进程模型**：每次 `send_message` 启动一个 `claude -p` 进程，
//!   读完 `result` 后进程退出；多轮对话靠 `--resume <session_id>` 续接。
//!
//! 分层与 `codex_app_server` 对齐：
//! - `transport`：子进程生命周期与 NDJSON 帧解析
//! - `message`：SDKMessage JSON → 类型化枚举
//! - `event_mapper`：Claude 消息/工具调用 → `AgentTimelineItem` 映射
//! - `session`：`ClaudeSessionHandle`（实现 `AgentSessionHandle`）会话编排

pub mod event_mapper;
pub mod message;
pub mod session;
pub mod transport;
pub mod user_input;

pub use session::{ClaudeSessionConfig, ClaudeSessionHandle};
pub use transport::ClaudeStreamingError;
