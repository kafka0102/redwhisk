//! Grok ACP 用量 → `AgentUsage` 归一（纯函数）。
//!
//! Grok 的 `_meta.usage` 是**整会话累计**口径（camelCase：`inputTokens` /
//! `outputTokens` / `cachedReadTokens` / `cacheCreationTokens` / `reasoningTokens`）。
//! 本模块把它收成既有 `session_token_input` / `session_token_output` /
//! `session_token_cache` 三项，落库合并用 `Overwrite`（与 Codex 线程累计一致）。

use serde_json::Value;

use crate::agent::session_token_usage::SessionTokenUsage;
use crate::types::agent_session_stream::{AgentUsage, SessionTokenMerge};

/// 从 Grok `_meta.usage`（会话累计）取输入 / 输出 / 缓存三项。
///
/// 输入 = `inputTokens`（ACP 口径含 cache 读取）去掉 cache 读取、并计入
/// cache 写入；缓存只计 cache 读取。缺字段时返回 `None`，避免把空快照写库。
pub fn session_usage_from_value(usage: &Value) -> Option<SessionTokenUsage> {
    let input_tokens = u64_field(usage, "inputTokens")?;
    let cache = u64_field(usage, "cachedReadTokens").unwrap_or(0);
    let cache_write = u64_field(usage, "cacheCreationTokens").unwrap_or(0);
    let output = u64_field(usage, "outputTokens")?;
    Some(SessionTokenUsage {
        input: input_tokens.saturating_sub(cache).saturating_add(cache_write),
        output,
        cache,
    })
}

/// 把会话累计用量归一为广播用 `AgentUsage`（`Overwrite` 合并）。
pub fn agent_usage_from_value(usage: &Value) -> Option<AgentUsage> {
    let snapshot = session_usage_from_value(usage)?;
    Some(AgentUsage {
        input_tokens: u64_field(usage, "inputTokens"),
        output_tokens: u64_field(usage, "outputTokens"),
        context_window_max_tokens: None,
        context_window_used_tokens: u64_field(usage, "totalTokens"),
        session_token_input: Some(snapshot.input),
        session_token_output: Some(snapshot.output),
        session_token_cache: Some(snapshot.cache),
        session_token_merge: SessionTokenMerge::Overwrite,
    })
}

/// 从任意 JSON（`_meta.usage` / `update.usage`）取并归一。
pub fn agent_usage_from_meta(meta: &Value) -> Option<AgentUsage> {
    meta.get("usage")
        .and_then(agent_usage_from_value)
        .or_else(|| agent_usage_from_value(meta))
}

fn u64_field(object: &Value, key: &str) -> Option<u64> {
    object.get(key).and_then(json_u64)
}

fn json_u64(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => number.as_u64().or_else(|| {
            number.as_f64().and_then(|float| {
                if float.is_finite() && float >= 0.0 && float.fract() == 0.0 {
                    Some(float as u64)
                } else {
                    None
                }
            })
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_accumulated_session_usage_without_double_counting_cache() {
        let usage = json!({
            "inputTokens": 60063,
            "outputTokens": 67,
            "totalTokens": 60130,
            "cachedReadTokens": 59904,
            "cacheCreationTokens": 0,
            "reasoningTokens": 44,
            "modelCalls": 2,
            "numTurns": 2
        });

        assert_eq!(
            session_usage_from_value(&usage),
            Some(SessionTokenUsage {
                input: 159,
                output: 67,
                cache: 59904,
            })
        );
    }

    #[test]
    fn counts_cache_creation_as_input() {
        let usage = json!({
            "inputTokens": 100,
            "outputTokens": 10,
            "cachedReadTokens": 40,
            "cacheCreationTokens": 25
        });
        assert_eq!(
            session_usage_from_value(&usage),
            Some(SessionTokenUsage {
                input: 85,
                output: 10,
                cache: 40,
            })
        );
    }

    #[test]
    fn returns_none_without_input_or_output() {
        assert!(session_usage_from_value(&json!({"cachedReadTokens": 5})).is_none());
    }

    #[test]
    fn agent_usage_uses_overwrite_merge_and_exposes_total_tokens() {
        let usage = json!({
            "inputTokens": 10,
            "outputTokens": 5,
            "totalTokens": 20,
            "cachedReadTokens": 0
        });
        let agent = agent_usage_from_value(&usage).expect("usage");
        assert_eq!(agent.session_token_input, Some(10));
        assert_eq!(agent.session_token_output, Some(5));
        assert_eq!(agent.session_token_cache, Some(0));
        assert_eq!(agent.context_window_used_tokens, Some(20));
        assert_eq!(agent.session_token_merge, SessionTokenMerge::Overwrite);
    }

    #[test]
    fn agent_usage_from_meta_prefers_nested_usage() {
        let meta = json!({
            "inputTokens": 1,
            "outputTokens": 1,
            "usage": { "inputTokens": 30, "outputTokens": 7, "cachedReadTokens": 20 }
        });
        let agent = agent_usage_from_meta(&meta).expect("usage");
        assert_eq!(agent.session_token_input, Some(10));
        assert_eq!(agent.session_token_output, Some(7));
    }
}
