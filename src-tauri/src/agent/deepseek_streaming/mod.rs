//! DeepSeek Harness 结构化会话（`dsh --profile acp`）。
//!
//! 不与 Grok 共用传输或映射：DeepSeek 的 chunk 是已提交块，不是逐字增量。

pub mod argv;
pub mod event_mapper;
pub mod session;
pub mod transport;

pub use session::{DeepSeekSessionConfig, DeepSeekSessionHandle};

#[cfg(test)]
#[path = "session_tests.rs"]
mod session_tests;

#[cfg(test)]
#[path = "session_tool_tests.rs"]
mod session_tool_tests;
