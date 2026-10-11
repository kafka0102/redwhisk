//! Grok ACP 用量 → `AgentUsage` 归一（纯函数）。
//!
//! `session/prompt` 的 `_meta.usage` 和 `turn_completed.usage` 都是**这一轮 prompt**
//! 的用量，不是整段会话累计。同一 `promptId` 的 prompt 结果和 `turn_completed`
//! 只计一次。落库用 `TurnCommit`，把每一轮加进 Session 已有累计。

use std::collections::HashSet;

use serde_json::Value;

use crate::agent::session_token_usage::SessionTokenUsage;
use crate::types::agent_session_stream::{AgentUsage, SessionTokenMerge};

/// 从 Grok `_meta.usage`（本轮 prompt）取输入 / 输出 / 缓存三项。
///
/// 输入 = `inputTokens`（ACP 口径含 cache 读取）去掉 cache 读取、并计入
/// cache 写入；缓存只计 cache 读取。缺字段时返回 `None`，避免把空快照写库。
pub fn session_usage_from_value(usage: &Value) -> Option<SessionTokenUsage> {
    let input_tokens = u64_field(usage, "inputTokens")?;
    let cache = u64_field(usage, "cachedReadTokens").unwrap_or(0);
    let cache_write = u64_field(usage, "cacheCreationTokens").unwrap_or(0);
    let output = u64_field(usage, "outputTokens")?;
    Some(SessionTokenUsage {
        input: input_tokens
            .saturating_sub(cache)
            .saturating_add(cache_write),
        output,
        cache,
    })
}

/// 跨 prompt 累加 Grok 用量。同一 prompt 的重复通知不再加一次。
#[derive(Debug, Default)]
pub struct GrokUsageLedger {
    seen_prompt_ids: HashSet<String>,
}

impl GrokUsageLedger {
    /// 计入这一轮。已经计过的 `promptId` 返回 `None`。
    pub fn absorb(&mut self, prompt_id: Option<&str>, usage: &Value) -> Option<AgentUsage> {
        let turn = session_usage_from_value(usage)?;
        if let Some(prompt_id) = prompt_id.filter(|id| !id.is_empty()) {
            if !self.seen_prompt_ids.insert(prompt_id.to_string()) {
                return None;
            }
        }
        Some(AgentUsage {
            input_tokens: u64_field(usage, "inputTokens"),
            output_tokens: u64_field(usage, "outputTokens"),
            context_window_max_tokens: None,
            context_window_used_tokens: u64_field(usage, "totalTokens"),
            session_token_input: Some(turn.input),
            session_token_output: Some(turn.output),
            session_token_cache: Some(turn.cache),
            session_token_merge: SessionTokenMerge::TurnCommit,
        })
    }

    pub fn absorb_notification(&mut self, update: &Value) -> Option<AgentUsage> {
        match update.get("sessionUpdate").and_then(Value::as_str) {
            Some("turn_completed" | "response_completed") => {}
            _ => return None,
        }
        let prompt_id = update
            .get("prompt_id")
            .and_then(Value::as_str)
            .or_else(|| update.get("promptId").and_then(Value::as_str));
        update
            .get("usage")
            .and_then(|usage| self.absorb(prompt_id, usage))
    }

    pub fn absorb_prompt_result(&mut self, result: &Value) -> Option<AgentUsage> {
        let meta = result.get("_meta")?;
        let prompt_id = meta.get("promptId").and_then(Value::as_str);
        meta.get("usage")
            .and_then(|usage| self.absorb(prompt_id, usage))
    }
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
    fn ignores_per_turn_top_level_tokens_without_session_usage() {
        // `_meta` 顶层 token 只代表最后一次模型调用（本轮），不是整会话累计；
        // 缺 `usage` 时不得把它当成会话累计写库（见
        // `docs/survey/grok-build-cli-probe-notes.md` §3.4）。
        let mut ledger = GrokUsageLedger::default();
        let result = json!({
            "stopReason": "end_turn",
            "_meta": {
                "inputTokens": 30047,
                "outputTokens": 21,
                "totalTokens": 30068,
                "cachedReadTokens": 29952
            }
        });
        assert!(ledger.absorb_prompt_result(&result).is_none());
    }
}
