//! 判断已安装的 hook 文件是否仍覆盖当前事件表。不改文件。

use std::io;
use std::path::Path;

use serde_json::Value;

use super::{is_our_command, load_json, HookEventSpec, CODEX_EVENTS, GROK_EVENTS};

/// 没有 RedWhisk command 视为未安装，包括文件不存在。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TuiHookFileState {
    Missing,
    Current,
    Outdated,
}

pub fn codex_hook_file_state(
    hooks_path: &Path,
    command_path: &str,
) -> io::Result<TuiHookFileState> {
    hook_file_state(hooks_path, command_path, "codex", CODEX_EVENTS)
}

pub fn grok_hook_file_state(hooks_path: &Path, command_path: &str) -> io::Result<TuiHookFileState> {
    hook_file_state(hooks_path, command_path, "grok", GROK_EVENTS)
}

fn hook_file_state(
    path: &Path,
    command_path: &str,
    source: &str,
    events: &[HookEventSpec],
) -> io::Result<TuiHookFileState> {
    if command_path.is_empty() || !path.exists() {
        return Ok(TuiHookFileState::Missing);
    }
    let doc = load_json(path)?;
    if !document_has_our_command(&doc, command_path, source) {
        return Ok(TuiHookFileState::Missing);
    }
    if events
        .iter()
        .all(|event| event_matches(&doc, event, command_path, source))
    {
        Ok(TuiHookFileState::Current)
    } else {
        Ok(TuiHookFileState::Outdated)
    }
}

fn document_has_our_command(doc: &Value, command_path: &str, source: &str) -> bool {
    let Some(hooks) = doc.get("hooks").and_then(Value::as_object) else {
        return false;
    };
    hooks.values().any(|groups| {
        groups.as_array().into_iter().flatten().any(|group| {
            group
                .get("hooks")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .any(|hook| {
                    hook.get("command")
                        .and_then(Value::as_str)
                        .is_some_and(|command| is_our_command(command, command_path, source))
                })
        })
    })
}

fn event_matches(doc: &Value, event: &HookEventSpec, command_path: &str, source: &str) -> bool {
    let Some(groups) = doc
        .get("hooks")
        .and_then(|hooks| hooks.get(event.name))
        .and_then(Value::as_array)
    else {
        return false;
    };
    groups.iter().any(|group| {
        matcher_matches(group, event.matcher)
            && group
                .get("hooks")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .any(|hook| {
                    hook.get("command")
                        .and_then(Value::as_str)
                        .is_some_and(|command| is_our_command(command, command_path, source))
                        && timeout_matches(hook, event.timeout)
                })
    })
}

fn matcher_matches(group: &Value, expected: Option<&str>) -> bool {
    let actual = group.get("matcher").and_then(Value::as_str);
    match expected {
        Some(expected) => actual == Some(expected),
        None => actual.is_none(),
    }
}

fn timeout_matches(hook: &Value, expected: Option<u64>) -> bool {
    hook.get("timeout").and_then(Value::as_u64) == expected
}
