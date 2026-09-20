//! Session Token 消耗：把各 provider 原始用量收成同一组输入 / 输出 / 缓存。

mod normalize;
mod persist;

pub use normalize::{normalize_claude_token_usage, normalize_codex_token_usage};
#[cfg(test)]
pub use persist::persist_session_token_usage;
pub use persist::{
    persist_session_token_usage_with, session_token_usage_from_event, SessionTokenAccumulator,
};

/// 规范化后的 Session Token 消耗三项累计值。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SessionTokenUsage {
    pub input: u64,
    pub output: u64,
    pub cache: u64,
}

impl SessionTokenUsage {
    fn saturating_add(self, other: Self) -> Self {
        Self {
            input: self.input.saturating_add(other.input),
            output: self.output.saturating_add(other.output),
            cache: self.cache.saturating_add(other.cache),
        }
    }
}

#[cfg(test)]
mod persist_tests;
