//! Codex app-server 接入层。
//!
//! 启动 `codex app-server` 子进程，通过 NDJSON over stdio 与之交互，
//! 把 codex 的 JSON-RPC 通知归一化为 `AgentStreamEvent` 广播给前端。
//!
//! 模块拆分（避免逻辑过度集中，参考 paseo codex-app-server-agent）：
//! - `transport`：子进程生命周期 + NDJSON 帧解析 + JSON-RPC 消息分发
//! - `notification`：codex 通知 method → 类型化 `CodexNotification`
//! - `thread_item`：codex thread item → `AgentTimelineItem` 映射
//! - `client`：高层 RPC 调用（initialize / turn/start / model/list 等）
//! - `session`：单个 agent session 的会话编排，持有 client 与权限挂起状态
//!
//! PTY + xterm 仅保留给项目终端；agent 会话改走本模块的结构化事件流。

pub mod client;
pub mod notification;
pub mod session;
pub mod thread_item;
pub mod transport;

pub use client::CodexAppServerClient;
pub use session::{CodexSessionConfig, CodexSessionHandle};
pub use transport::{CodexAppServerError, CodexTransport};
