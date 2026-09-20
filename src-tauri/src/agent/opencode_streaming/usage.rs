use serde_json::Value;

use crate::types::agent_session_stream::AgentUsage;

pub fn usage_from_part(value: &Value) -> Option<AgentUsage> {
    let part = value.get("part")?;
    let tokens = part.get("tokens").or_else(|| part.get("usage"))?;
    let snapshot = crate::agent::session_token_usage::normalize_claude_token_usage(tokens);
    Some(AgentUsage {
        input_tokens: tokens
            .get("input")
            .or_else(|| tokens.get("input_tokens"))
            .and_then(Value::as_u64),
        output_tokens: tokens
            .get("output")
            .or_else(|| tokens.get("output_tokens"))
            .and_then(Value::as_u64),
        session_token_input: snapshot.as_ref().map(|usage| usage.input),
        session_token_output: snapshot.as_ref().map(|usage| usage.output),
        session_token_cache: snapshot.as_ref().map(|usage| usage.cache),
        session_token_merge: crate::types::agent_session_stream::SessionTokenMerge::TurnCommit,
        ..Default::default()
    })
}
