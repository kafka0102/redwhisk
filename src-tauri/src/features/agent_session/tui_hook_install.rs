//! Codex / Grok CLI hook 文件的安装与卸载。
//!
//! 只改调用方传入的路径。不读用户真实 `~/.codex` / `~/.grok`，不写
//! `~/.claude/settings.json`，不写已弃用的 `codex_hooks`。

use std::fs;
use std::io::{self, ErrorKind};
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

const GROK_HOOK_FILE_NAME: &str = "redwhisk.json";

struct HookEventSpec {
    name: &'static str,
    timeout: Option<u64>,
    matcher: Option<&'static str>,
}

const CODEX_EVENTS: &[HookEventSpec] = &[
    HookEventSpec {
        name: "UserPromptSubmit",
        timeout: Some(5),
        matcher: None,
    },
    HookEventSpec {
        name: "PreToolUse",
        timeout: Some(5),
        matcher: None,
    },
    HookEventSpec {
        name: "PostToolUse",
        timeout: Some(5),
        matcher: None,
    },
    HookEventSpec {
        name: "Stop",
        timeout: Some(5),
        matcher: None,
    },
    HookEventSpec {
        name: "Interrupt",
        timeout: None,
        matcher: None,
    },
];

const GROK_EVENTS: &[HookEventSpec] = &[
    HookEventSpec {
        name: "UserPromptSubmit",
        timeout: Some(5),
        matcher: None,
    },
    HookEventSpec {
        name: "PreToolUse",
        timeout: Some(5),
        matcher: Some("*"),
    },
    HookEventSpec {
        name: "PostToolUse",
        timeout: Some(5),
        matcher: Some("*"),
    },
    HookEventSpec {
        name: "PostToolUseFailure",
        timeout: Some(5),
        matcher: Some("*"),
    },
    HookEventSpec {
        name: "Stop",
        timeout: Some(5),
        matcher: None,
    },
    HookEventSpec {
        name: "StopFailure",
        timeout: Some(5),
        matcher: None,
    },
    HookEventSpec {
        name: "StopCancelled",
        timeout: Some(5),
        matcher: None,
    },
    HookEventSpec {
        name: "Notification",
        timeout: Some(5),
        matcher: Some("*"),
    },
];

pub fn install_codex_hooks(
    hooks_path: &Path,
    config_path: &Path,
    command_path: &str,
    enable_hooks_feature: bool,
) -> io::Result<()> {
    upsert_hook_file(hooks_path, command_path, "codex", CODEX_EVENTS)?;
    if enable_hooks_feature {
        enable_codex_hooks_feature(config_path)?;
    }
    Ok(())
}

pub fn uninstall_codex_hooks(hooks_path: &Path, command_path: &str) -> io::Result<()> {
    if !hooks_path.exists() {
        return Ok(());
    }
    let mut doc = load_json(hooks_path)?;
    remove_our_commands(&mut doc, command_path, "codex");
    save_json(hooks_path, &doc)
}

pub fn install_grok_hooks(hooks_dir: &Path, command_path: &str) -> io::Result<()> {
    upsert_hook_file(
        &hooks_dir.join(GROK_HOOK_FILE_NAME),
        command_path,
        "grok",
        GROK_EVENTS,
    )
}

pub fn uninstall_grok_hooks(hooks_dir: &Path, command_path: &str) -> io::Result<()> {
    let path = hooks_dir.join(GROK_HOOK_FILE_NAME);
    if !path.exists() {
        return Ok(());
    }
    let mut doc = load_json(&path)?;
    remove_our_commands(&mut doc, command_path, "grok");
    if document_has_command(&doc) {
        save_json(&path, &doc)
    } else {
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

/// `codex features list` 一行：`name  stage  enabled`。
/// `hooks` 已是 stable 且当前为 true 时视为默认开启，调用方不得改 `config.toml`。
/// 不解析 `codex_hooks`。这是只读查询，不是启动 Codex agent。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CodexHooksFeature {
    pub stage: CodexFeatureStage,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CodexFeatureStage {
    Stable,
    Other,
}

impl CodexHooksFeature {
    #[cfg(test)]
    pub fn is_stable_and_enabled(self) -> bool {
        self.stage == CodexFeatureStage::Stable && self.enabled
    }

    /// 设置页只在有效值为 false 时给出单独的写入动作。
    pub fn effective_value_is_false(self) -> bool {
        !self.enabled
    }
}

pub(crate) fn parse_codex_hooks_feature(features_list: &str) -> Option<CodexHooksFeature> {
    for line in features_list.split('\n') {
        let mut parts = line.split_whitespace();
        let Some(name) = parts.next() else {
            continue;
        };
        if name != "hooks" {
            continue;
        }
        let stage = parts.next().unwrap_or("");
        let enabled = parts.next().unwrap_or("");
        return Some(CodexHooksFeature {
            stage: if stage == "stable" {
                CodexFeatureStage::Stable
            } else {
                CodexFeatureStage::Other
            },
            enabled: enabled == "true",
        });
    }
    None
}

/// 跑 `codex features list`。命令缺失、非 0、或输出里没有 `hooks` 行时返回 `None`。
/// 不启动 Codex agent 会话。
pub fn query_codex_hooks_feature(codex_bin: &Path) -> Option<CodexHooksFeature> {
    let output = Command::new(codex_bin)
        .args(["features", "list"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    parse_codex_hooks_feature(&text)
}

/// 识别 RedWhisk 自己的 hook command。安装、卸载、检测共用这一处。
pub fn is_redwhisk_hook_command(command: &str, command_path: &str, source: &str) -> bool {
    !command_path.is_empty()
        && command.contains(command_path)
        && command.contains(&format!("--source {source}"))
}

pub fn enable_codex_hooks_feature(config_path: &Path) -> io::Result<()> {
    let text = match fs::read_to_string(config_path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if !config_hooks_explicitly_false(&text) {
        return Ok(());
    }
    let updated = rewrite_features_hooks_true(&text);
    if updated == text {
        return Ok(());
    }
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(config_path, updated)
}

fn rewrite_features_hooks_true(text: &str) -> String {
    let mut in_features = false;
    let mut out = String::new();
    for (index, line) in text.split('\n').enumerate() {
        if index > 0 {
            out.push('\n');
        }
        let trimmed = line.trim().trim_end_matches('\r');
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_features = trimmed == "[features]";
            out.push_str(line);
            continue;
        }
        if in_features && hooks_assignment_value(trimmed) == Some("false") {
            out.push_str(&replace_hooks_false(line));
            continue;
        }
        out.push_str(line);
    }
    out
}

fn replace_hooks_false(line: &str) -> String {
    let Some((key, value)) = line.split_once('=') else {
        return line.to_string();
    };
    if key.trim() != "hooks" {
        return line.to_string();
    }
    format!("{key}={}", value.replacen("false", "true", 1))
}

fn config_hooks_explicitly_false(config_toml: &str) -> bool {
    let mut in_features = false;
    for line in config_toml.split('\n') {
        let trimmed = line.trim().trim_end_matches('\r');
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_features = trimmed == "[features]";
            continue;
        }
        if in_features && hooks_assignment_value(trimmed) == Some("false") {
            return true;
        }
    }
    false
}

fn hooks_assignment_value(trimmed: &str) -> Option<&str> {
    let without_comment = trimmed.split('#').next().unwrap_or(trimmed).trim();
    let (key, value) = without_comment.split_once('=')?;
    if key.trim() != "hooks" {
        return None;
    }
    Some(value.trim())
}

fn upsert_hook_file(
    path: &Path,
    command_path: &str,
    source: &str,
    events: &[HookEventSpec],
) -> io::Result<()> {
    let mut doc = if path.exists() {
        load_json(path)?
    } else {
        json!({ "hooks": {} })
    };
    remove_our_commands(&mut doc, command_path, source);
    let command = hook_command(command_path, source);
    for event in events {
        append_event_group(
            &mut doc,
            event.name,
            matcher_group(event.matcher, command_hook(&command, event.timeout)),
        );
    }
    save_json(path, &doc)
}

fn hook_command(command_path: &str, source: &str) -> String {
    format!("{command_path} hook --source {source}")
}

fn is_our_command(command: &str, command_path: &str, source: &str) -> bool {
    is_redwhisk_hook_command(command, command_path, source)
}

fn command_hook(command: &str, timeout: Option<u64>) -> Value {
    let mut hook = json!({
        "type": "command",
        "command": command,
    });
    if let Some(timeout) = timeout {
        hook["timeout"] = json!(timeout);
    }
    hook
}

fn matcher_group(matcher: Option<&str>, hook: Value) -> Value {
    let mut group = json!({ "hooks": [hook] });
    if let Some(matcher) = matcher {
        group["matcher"] = json!(matcher);
    }
    group
}

fn append_event_group(doc: &mut Value, event: &str, group: Value) {
    if !doc.is_object() {
        *doc = json!({ "hooks": {} });
    }
    let Some(root) = doc.as_object_mut() else {
        return;
    };
    let hooks = root.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let Some(events) = hooks.as_object_mut() else {
        return;
    };
    let groups = events.entry(event).or_insert_with(|| json!([]));
    if !groups.is_array() {
        *groups = json!([]);
    }
    if let Some(groups) = groups.as_array_mut() {
        groups.push(group);
    }
}

fn remove_our_commands(doc: &mut Value, command_path: &str, source: &str) {
    let Some(hooks) = doc.get_mut("hooks").and_then(Value::as_object_mut) else {
        return;
    };
    for groups in hooks.values_mut() {
        let Some(groups) = groups.as_array_mut() else {
            continue;
        };
        for group in groups.iter_mut() {
            let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
                continue;
            };
            list.retain(|hook| match hook.get("command").and_then(Value::as_str) {
                Some(command) => !is_our_command(command, command_path, source),
                None => true,
            });
        }
        groups.retain(|group| {
            group
                .get("hooks")
                .and_then(Value::as_array)
                .is_none_or(|list| !list.is_empty())
        });
    }
}

fn document_has_command(doc: &Value) -> bool {
    let Some(hooks) = doc.get("hooks").and_then(Value::as_object) else {
        return false;
    };
    hooks.values().any(|groups| {
        groups
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|group| {
                group
                    .get("hooks")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
            })
            .any(|hook| hook.get("command").and_then(Value::as_str).is_some())
    })
}

fn load_json(path: &Path) -> io::Result<Value> {
    let text = fs::read_to_string(path)?;
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&text).map_err(|error| io::Error::new(ErrorKind::InvalidData, error))
}

fn save_json(path: &Path, doc: &Value) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, doc.to_string())
}

#[path = "tui_hook_file_state.rs"]
mod file_state;

pub use file_state::{codex_hook_file_state, grok_hook_file_state, TuiHookFileState};
