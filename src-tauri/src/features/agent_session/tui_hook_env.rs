//! Codex / Grok TUI spawn 与 resume 注入的两个环境变量。
//!
//! 项目终端不走这里。其它 agent 返回空表，`spawn_pending` 的既有环境保持不变。

use std::collections::BTreeMap;

pub const REDWHISK_SESSION_ID: &str = "REDWHISK_SESSION_ID";
pub const REDWHISK_AGENT_KIND: &str = "REDWHISK_AGENT_KIND";

/// 仅 `codex` / `grok` 返回两个键。session id 为十进制。
pub fn tui_hook_spawn_env(agent_type: &str, session_id: i64) -> BTreeMap<String, String> {
    match agent_type {
        "codex" | "grok" => {
            let mut env = BTreeMap::new();
            env.insert(REDWHISK_SESSION_ID.to_string(), session_id.to_string());
            env.insert(REDWHISK_AGENT_KIND.to_string(), agent_type.to_string());
            env
        }
        _ => BTreeMap::new(),
    }
}
