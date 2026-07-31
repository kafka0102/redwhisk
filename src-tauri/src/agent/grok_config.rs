//! `~/.grok/config.toml` 读取（仅 redwhisk 关心的子集）。
//!
//! 仿 [`crate::agent::codex_config`] 的纯函数 + `*_from_home(home_dir: &Path)` 范式。
//! grok CLI（Grok Build）配置为 TOML，默认模型在 `[models]` 表的 `default` 键：
//!
//! ```toml
//! [models]
//! default = "grok-build"
//! ```
//!
//! 来源：xAI 官方文档 https://docs.x.ai/build/settings 。

use std::fs;
use std::path::{Path, PathBuf};

const GROK_CONFIG_DIR_NAME: &str = ".grok";
const GROK_CONFIG_FILE_NAME: &str = "config.toml";
const MODELS_TABLE: &str = "models";
const DEFAULT_KEY: &str = "default";

/// 从 home 目录读取 `~/.grok/config.toml` 的 `[models].default`。
///
/// 文件不存在、无 `[models]` 表或缺 `default` 键时返回 `None`（best-effort，不阻断列表加载）。
pub fn read_default_model_from_home(home_dir: &Path) -> Option<String> {
    let content = fs::read_to_string(grok_config_path(home_dir)).ok()?;
    parse_default_model(&content)
}

fn grok_config_path(home_dir: &Path) -> PathBuf {
    home_dir
        .join(GROK_CONFIG_DIR_NAME)
        .join(GROK_CONFIG_FILE_NAME)
}

/// 解析 config.toml 文本中的 `[models].default`（纯函数，便于单测）。
///
/// 行扫描跟踪当前 `[table]`，仅当当前表为 `models` 时读取 `default` 赋值。
/// 不依赖 toml crate：redwhisk 关心的只是一个字符串赋值，行扫描足够且无新依赖。
pub(crate) fn parse_default_model(content: &str) -> Option<String> {
    let mut current_table: Option<String> = None;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(name) = parse_table_header(trimmed) {
            current_table = Some(name);
            continue;
        }
        if current_table.as_deref() == Some(MODELS_TABLE) {
            if let Some(value) = parse_string_assignment(trimmed, DEFAULT_KEY) {
                return Some(value);
            }
        }
    }
    None
}

/// 解析 `[ name ]` 表头为 `name`（去空白、去方括号）。
fn parse_table_header(line: &str) -> Option<String> {
    let line = line.trim();
    if !line.starts_with('[') || !line.ends_with(']') {
        return None;
    }
    let inner = line[1..line.len() - 1].trim();
    if inner.is_empty() || inner.starts_with('#') {
        return None;
    }
    Some(inner.to_string())
}

/// 解析 `<key> = "<value>"` 赋值；key 不符或值非带引号字符串时返回 None。
fn parse_string_assignment(line: &str, key: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if trimmed.starts_with('#') || !trimmed.starts_with(key) {
        return None;
    }
    let after_key = &trimmed[key.len()..];
    if !after_key.trim_start().starts_with('=') {
        return None;
    }
    let value = after_key.trim_start().trim_start_matches('=').trim_start();
    read_quoted_string(value)
}

fn read_quoted_string(value: &str) -> Option<String> {
    let mut chars = value.chars();
    if chars.next()? != '"' {
        return None;
    }
    let mut result = String::new();
    let mut is_escaped = false;
    for char in chars {
        if is_escaped {
            result.push(char);
            is_escaped = false;
            continue;
        }
        match char {
            '\\' => is_escaped = true,
            '"' => return Some(result),
            _ => result.push(char),
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_models_default() {
        let content = "[models]\ndefault = \"grok-build\"\n";
        assert_eq!(parse_default_model(content).as_deref(), Some("grok-build"));
    }

    #[test]
    fn parses_models_default_with_other_tables() {
        let content = "[auth]\ndefault = \"should-be-ignored\"\n\n[models]\ndefault = \"grok-4\"\n";
        assert_eq!(parse_default_model(content).as_deref(), Some("grok-4"));
    }

    #[test]
    fn ignores_default_in_unrelated_table() {
        let content = "[profiles.x]\ndefault = \"ignored\"\n";
        assert!(parse_default_model(content).is_none());
    }

    #[test]
    fn missing_models_table_returns_none() {
        let content = "[auth]\ntoken = \"abc\"\n";
        assert!(parse_default_model(content).is_none());
    }

    #[test]
    fn missing_default_key_returns_none() {
        let content = "[models]\nother = \"x\"\n";
        assert!(parse_default_model(content).is_none());
    }

    #[test]
    fn skips_comments_and_blank_lines() {
        let content = "# top comment\n\n[models]\n# default = \"commented\"\ndefault = \"real\"\n";
        assert_eq!(parse_default_model(content).as_deref(), Some("real"));
    }

    #[test]
    fn handles_table_header_whitespace() {
        let content = "[ models ]\ndefault = \"grok-build\"\n";
        assert_eq!(parse_default_model(content).as_deref(), Some("grok-build"));
    }

    #[test]
    fn missing_file_returns_none_from_home() {
        let temp = tempfile::tempdir().expect("temp dir");
        assert!(read_default_model_from_home(temp.path()).is_none());
    }

    #[test]
    fn reads_default_from_home_dir() {
        let temp = tempfile::tempdir().expect("temp dir");
        let grok_dir = temp.path().join(".grok");
        fs::create_dir_all(&grok_dir).expect("grok dir");
        fs::write(
            grok_dir.join("config.toml"),
            "[models]\ndefault = \"grok-build\"\n",
        )
        .expect("write config");
        assert_eq!(
            read_default_model_from_home(temp.path()).as_deref(),
            Some("grok-build")
        );
    }
}
