//! OpenCode 结构化会话接入模块。
//!
//! 通过 `opencode run --format json` 子进程接入 OpenCode，把其 NDJSON
//! 事件流归一化为 `AgentStreamEvent` 后广播给前端。
//!
//! 与 Claude streaming 同构：
//! - 单向 NDJSON stdout；每轮子进程；多轮靠 `-s <sessionID>` 续接。
//! - 无 JSON-RPC 审批通道；headless 靠 `--auto` 自动 once 批准。
//!
//! 分层：
//! - `transport`：子进程生命周期与 NDJSON 帧解析
//! - `event_mapper` / `tool_detail`：OpenCode 事件 → `AgentStreamEvent`
//! - `argv`：`run --format json` 启动参数
//! - `session`：`OpenCodeSessionHandle`（实现 `AgentSessionHandle`）

pub mod argv;
pub mod event_mapper;
pub mod session;
pub mod tool_detail;
pub mod transport;

pub use session::{OpenCodeSessionConfig, OpenCodeSessionHandle};
pub use transport::OpenCodeStreamingError;
