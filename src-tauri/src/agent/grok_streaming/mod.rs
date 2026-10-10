//! Grok 结构化会话接入模块（`grok agent stdio`，ACP JSON-RPC 2.0 over stdio）。
//!
//! 与 Codex app-server 同形态：长驻子进程 + JSON-RPC 双工，把 Grok 私有事件
//! 归一化为 `AgentStreamEvent` 后广播给前端；TUI 路径完全不变（仍走 PTY）。
//!
//! 分层：
//! - `transport`：子进程生命周期 + 按行 JSON-RPC 帧解析与请求 id 关联
//! - `event_mapper`：ACP 通知 → `AgentStreamEvent`（增量累积、幂等）
//! - `tool_detail` / `usage`：工具调用与用量归一（纯函数）
//! - `argv`：结构化启动参数 `agent [--always-approve] [-m model] stdio`
//! - `session`：`GrokSessionHandle`（实现 `AgentSessionHandle`）
//!
//! 用量口径：每一轮 prompt 的 `usage` 是本轮差额，同一 `promptId` 只计一次，
//! 落库用 `TurnCommit` 加进 Session 累计。
//! 执行时长：沿用 ADR-0043 的 json 活跃时长心跳（`is_turn_running` 由本模块广播的
//! `TurnStarted` / `TurnCompleted` / `TurnFailed` / `TurnCanceled` 驱动），Grok 不新增
//! 字段、不旁路。

pub mod argv;
pub mod event_mapper;
pub mod session;
pub mod tool_detail;
pub mod transport;
pub(crate) mod usage;

pub use session::{GrokSessionConfig, GrokSessionHandle};
pub use transport::GrokStreamingError;
