use serde_json::Value;

use super::SessionTokenUsage;

/// 从 Codex `thread/tokenUsage/updated` 载荷取线程累计快照。
///
/// 优先 `total`，禁止把 `last` 再加一遍。
pub fn normalize_codex_token_usage(token_usage: &Value) -> Option<SessionTokenUsage> {
    let snapshot = token_usage
        .get("total")
        .or_else(|| token_usage.get("totalTokenUsage"))
        .or_else(|| token_usage.get("total_token_usage"))
        .or_else(|| token_usage.get("last"))
        .or_else(|| token_usage.get("lastTokenUsage"))
        .or_else(|| token_usage.get("last_token_usage"))
        .and_then(Value::as_object)?;
    let input_tokens = u64_field(snapshot, "input_tokens", "inputTokens")?;
    let cache = u64_field(snapshot, "cached_input_tokens", "cachedInputTokens").unwrap_or(0);
    let cache_write = u64_field(
        snapshot,
        "cache_creation_input_tokens",
        "cacheCreationInputTokens",
    )
    .or_else(|| {
        u64_field(
            snapshot,
            "cache_write_input_tokens",
            "cacheWriteInputTokens",
        )
    })
    .unwrap_or(0);
    let output = u64_field(snapshot, "output_tokens", "outputTokens")?;
    Some(SessionTokenUsage {
        input: input_tokens
            .saturating_sub(cache)
            .saturating_add(cache_write),
        output,
        cache,
    })
}

/// 从 Claude 原始用量收成输入 / 输出 / 缓存。
///
/// 输入 = 未命中缓存的 input + cache 写入；缓存只计 cache 读取。
pub fn normalize_claude_token_usage(usage: &Value) -> Option<SessionTokenUsage> {
    let object = usage.as_object()?;
    let input_tokens = u64_field(object, "input_tokens", "inputTokens")
        .or_else(|| u64_field(object, "input", "input"));
    let cache_write = u64_field(
        object,
        "cache_creation_input_tokens",
        "cacheCreationInputTokens",
    )
    .or_else(|| u64_field(object, "cache_write_input_tokens", "cacheWriteInputTokens"));
    let cache = u64_field(object, "cache_read_input_tokens", "cacheReadInputTokens");
    let output = u64_field(object, "output_tokens", "outputTokens")
        .or_else(|| u64_field(object, "output", "output"));
    let reasoning = u64_field(object, "reasoning_output_tokens", "reasoningOutputTokens")
        .or_else(|| u64_field(object, "reasoning_tokens", "reasoningTokens"));
    if input_tokens.is_none()
        && cache_write.is_none()
        && cache.is_none()
        && output.is_none()
        && reasoning.is_none()
    {
        return None;
    }
    Some(SessionTokenUsage {
        input: input_tokens
            .unwrap_or(0)
            .saturating_add(cache_write.unwrap_or(0)),
        output: output.unwrap_or(0).saturating_add(reasoning.unwrap_or(0)),
        cache: cache.unwrap_or(0),
    })
}

fn u64_field(object: &serde_json::Map<String, Value>, snake: &str, camel: &str) -> Option<u64> {
    object
        .get(snake)
        .or_else(|| object.get(camel))
        .and_then(json_u64)
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
    fn prefers_codex_total_and_maps_uncached_input_output_and_cache() {
        let usage = normalize_codex_token_usage(&json!({
            "model_context_window": 200_000,
            "last": {
                "input_tokens": 100,
                "cached_input_tokens": 20,
                "output_tokens": 30,
                "reasoning_output_tokens": 10,
            },
            "total": {
                "input_tokens": 1_500,
                "cached_input_tokens": 400,
                "output_tokens": 300,
                "reasoning_output_tokens": 80,
            },
        }));

        assert_eq!(
            usage,
            Some(SessionTokenUsage {
                input: 1_100,
                output: 300,
                cache: 400,
            })
        );
    }

    #[test]
    fn counts_codex_cache_write_as_input() {
        let usage = normalize_codex_token_usage(&json!({
            "total": {
                "input_tokens": 1_500,
                "cached_input_tokens": 400,
                "cache_creation_input_tokens": 50,
                "output_tokens": 300,
            },
        }));
        assert_eq!(
            usage,
            Some(SessionTokenUsage {
                input: 1_150,
                output: 300,
                cache: 400,
            })
        );
    }

    #[test]
    fn uses_codex_last_as_overwrite_snapshot_when_total_is_absent() {
        let usage = normalize_codex_token_usage(&json!({
            "last": {
                "input_tokens": 1_500,
                "cached_input_tokens": 400,
                "output_tokens": 300,
            },
        }));
        assert_eq!(
            usage,
            Some(SessionTokenUsage {
                input: 1_100,
                output: 300,
                cache: 400,
            })
        );
    }

    #[test]
    fn counts_claude_cache_write_as_input_and_cache_read_as_cache() {
        let usage = normalize_claude_token_usage(&json!({
            "input_tokens": 100,
            "output_tokens": 20,
            "cache_creation_input_tokens": 50,
            "cache_read_input_tokens": 200,
        }));
        assert_eq!(
            usage,
            Some(SessionTokenUsage {
                input: 150,
                output: 20,
                cache: 200,
            })
        );
    }

    #[test]
    fn adds_claude_reasoning_tokens_to_output_when_given_separately() {
        let usage = normalize_claude_token_usage(&json!({
            "input_tokens": 100,
            "output_tokens": 20,
            "reasoning_output_tokens": 8,
            "cache_read_input_tokens": 40,
        }));
        assert_eq!(
            usage,
            Some(SessionTokenUsage {
                input: 100,
                output: 28,
                cache: 40,
            })
        );
    }

    #[test]
    fn accepts_short_input_output_fields_for_other_agents() {
        let usage = normalize_claude_token_usage(&json!({
            "input": 10,
            "output": 20,
        }));
        assert_eq!(
            usage,
            Some(SessionTokenUsage {
                input: 10,
                output: 20,
                cache: 0,
            })
        );
    }
}
