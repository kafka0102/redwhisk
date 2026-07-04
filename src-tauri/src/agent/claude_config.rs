//! `~/.claude/settings.json` 读取与写入。
//!
//! 仿 [`crate::agent::codex_config`] 的纯函数 + `*_from_home(home_dir: &Path)` 范式。
//! 只读写 redwhisk 关心的子集字段：
//! - 顶层 `model`：Claude CLI 别名（如 `sonnet[1m]`）
//! - `env.ANTHROPIC_BASE_URL`：第三方网关地址（存在则判定为第三方接口）
//! - `env.ANTHROPIC_AUTH_TOKEN`：第三方网关 token
//! - `env.ANTHROPIC_MODEL`：env 级别的真实模型覆盖
//!
//! 写入采用 `serde_json::Value` 原地修改顶层 `model` 字段，保留其他字段
//! （hooks / env / plugins 等），避免破坏用户配置。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const CLAUDE_CONFIG_DIR_NAME: &str = ".claude";
const CLAUDE_CONFIG_FILE_NAME: &str = "settings.json";

const ENV_BASE_URL: &str = "ANTHROPIC_BASE_URL";
const ENV_AUTH_TOKEN: &str = "ANTHROPIC_AUTH_TOKEN";
const ENV_MODEL: &str = "ANTHROPIC_MODEL";

/// Claude 官方支持切换的模型别名（顶层 `model` 字段可接受的值）。
///
/// 仅当未检测到第三方接口时，前端才允许用户在这些模型间切换。
/// `(model_id, display_name)`。
pub const OFFICIAL_CLAUDE_MODELS: &[(&str, &str)] = &[
    ("opus", "Opus"),
    ("sonnet", "Sonnet"),
    ("haiku", "Haiku"),
];

/// redwhisk 关心的 `~/.claude/settings.json` 字段子集快照。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClaudeSettingsSnapshot {
    /// 顶层 `model` 字段（Claude CLI 别名，如 `sonnet[1m]`）。
    #[serde(default)]
    pub model: Option<String>,
    /// `env.ANTHROPIC_BASE_URL`：第三方网关地址。
    #[serde(default)]
    pub base_url: Option<String>,
    /// `env.ANTHROPIC_AUTH_TOKEN`：第三方网关 token。
    #[serde(default)]
    pub auth_token: Option<String>,
    /// `env.ANTHROPIC_MODEL`：env 级别的真实模型覆盖。
    #[serde(default)]
    pub anthropic_model: Option<String>,
}

/// 是否为第三方接口（存在 base_url 或 auth_token 即判定为第三方）。
///
/// 第三方接口下前端只读展示当前模型，不允许切换；官方接口下允许在
/// [`OFFICIAL_CLAUDE_MODELS`] 之间切换。
pub fn is_third_party(snapshot: &ClaudeSettingsSnapshot) -> bool {
    snapshot.base_url.is_some() || snapshot.auth_token.is_some()
}

/// 从 home 目录读取 `~/.claude/settings.json` 并提取关键字段子集。
///
/// 文件不存在或解析失败时返回 `None`（best-effort，不阻断列表加载）。
pub fn read_settings_from_home(home_dir: &Path) -> Option<ClaudeSettingsSnapshot> {
    let content = fs::read_to_string(claude_config_path(home_dir)).ok()?;
    parse_settings(&content)
}

/// 把顶层 `model` 字段写回 `~/.claude/settings.json`，保留其他字段。
///
/// 文件不存在时创建一个仅含 `model` 字段的最小配置。
pub fn write_model_to_home(home_dir: &Path, model: &str) -> io::Result<()> {
    let config_path = claude_config_path(home_dir);
    let existing = fs::read_to_string(&config_path).unwrap_or_default();
    let next = write_model_content(&existing, model);

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(config_path, next)
}

fn claude_config_path(home_dir: &Path) -> PathBuf {
    home_dir
        .join(CLAUDE_CONFIG_DIR_NAME)
        .join(CLAUDE_CONFIG_FILE_NAME)
}

/// 解析 settings.json 文本为快照（纯函数，便于单测）。
fn parse_settings(content: &str) -> Option<ClaudeSettingsSnapshot> {
    let value: serde_json::Value = serde_json::from_str(content).ok()?;
    let model = value
        .get("model")
        .and_then(serde_json::Value::as_str)
        .map(|s| s.to_string());
    let env = value.get("env");
    let base_url = env
        .and_then(|e| e.get(ENV_BASE_URL))
        .and_then(serde_json::Value::as_str)
        .map(|s| s.to_string());
    let auth_token = env
        .and_then(|e| e.get(ENV_AUTH_TOKEN))
        .and_then(serde_json::Value::as_str)
        .map(|s| s.to_string());
    let anthropic_model = env
        .and_then(|e| e.get(ENV_MODEL))
        .and_then(serde_json::Value::as_str)
        .map(|s| s.to_string());
    Some(ClaudeSettingsSnapshot {
        model,
        base_url,
        auth_token,
        anthropic_model,
    })
}

/// 在现有 settings.json 文本中替换顶层 `model` 字段（纯函数，便于单测）。
///
/// 用 `serde_json::Value` 解析 → 修改 → 序列化，保留其他字段。
/// 解析失败（非合法 JSON）时退化为写入仅含 `model` 的最小对象。
fn write_model_content(content: &str, model: &str) -> String {
    let mut root: serde_json::Value =
        serde_json::from_str(content).unwrap_or_else(|_| serde_json::json!({}));
    if !root.is_object() {
        root = serde_json::json!({});
    }
    if let serde_json::Value::Object(map) = &mut root {
        map.insert(
            "model".to_string(),
            serde_json::Value::String(model.to_string()),
        );
    }
    // pretty 序列化，保持与 Claude CLI 原生格式一致。
    serde_json::to_string_pretty(&root).unwrap_or_else(|_| format!("{{\n  \"model\": \"{model}\"\n}}"))
        + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_official_settings() {
        let content = r#"{
            "model": "sonnet",
            "env": {},
            "hooks": {}
        }"#;
        let snapshot = parse_settings(content).expect("应解析成功");
        assert_eq!(snapshot.model.as_deref(), Some("sonnet"));
        assert!(snapshot.base_url.is_none());
        assert!(snapshot.auth_token.is_none());
        assert!(!is_third_party(&snapshot));
    }

    #[test]
    fn parses_third_party_settings() {
        let content = r#"{
            "model": "sonnet[1m]",
            "env": {
                "ANTHROPIC_BASE_URL": "http://example.com:9009",
                "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
                "ANTHROPIC_MODEL": "glm-5.2[1m]"
            }
        }"#;
        let snapshot = parse_settings(content).expect("应解析成功");
        assert_eq!(snapshot.model.as_deref(), Some("sonnet[1m]"));
        assert_eq!(snapshot.base_url.as_deref(), Some("http://example.com:9009"));
        assert_eq!(snapshot.auth_token.as_deref(), Some("sk-xxx"));
        assert_eq!(snapshot.anthropic_model.as_deref(), Some("glm-5.2[1m]"));
        assert!(is_third_party(&snapshot));
    }

    #[test]
    fn missing_file_returns_none_from_home() {
        let temp = tempfile::tempdir().expect("temp dir");
        // 未创建 .claude/settings.json，应返回 None 而非 panic。
        assert!(read_settings_from_home(temp.path()).is_none());
    }

    #[test]
    fn reads_settings_from_home_dir() {
        let temp = tempfile::tempdir().expect("temp dir");
        let claude_dir = temp.path().join(".claude");
        fs::create_dir_all(&claude_dir).expect("claude dir");
        fs::write(
            claude_dir.join("settings.json"),
            r#"{"model": "opus", "env": {}}"#,
        )
        .expect("write settings");

        let snapshot = read_settings_from_home(temp.path()).expect("应读到快照");
        assert_eq!(snapshot.model.as_deref(), Some("opus"));
        assert!(!is_third_party(&snapshot));
    }

    #[test]
    fn write_model_preserves_other_fields() {
        let temp = tempfile::tempdir().expect("temp dir");
        let claude_dir = temp.path().join(".claude");
        fs::create_dir_all(&claude_dir).expect("claude dir");
        let config_path = claude_dir.join("settings.json");
        fs::write(
            &config_path,
            r#"{
  "model": "sonnet",
  "env": {
    "ANTHROPIC_BASE_URL": "http://x:9009"
  },
  "hooks": {
    "Notification": []
  }
}"#,
        )
        .expect("write settings");

        write_model_to_home(temp.path(), "opus").expect("write model");

        let after = fs::read_to_string(&config_path).expect("read after write");
        let snapshot = parse_settings(&after).expect("应能重新解析");
        assert_eq!(snapshot.model.as_deref(), Some("opus"));
        // 其他字段保留。
        assert_eq!(snapshot.base_url.as_deref(), Some("http://x:9009"));
        assert!(after.contains("Notification"));
    }

    #[test]
    fn write_model_creates_minimal_config_when_absent() {
        let temp = tempfile::tempdir().expect("temp dir");
        // 不预先创建文件。
        write_model_to_home(temp.path(), "haiku").expect("write model");

        let snapshot = read_settings_from_home(temp.path()).expect("应读到快照");
        assert_eq!(snapshot.model.as_deref(), Some("haiku"));
    }

    #[test]
    fn official_models_constant_contains_common_aliases() {
        let ids: Vec<&str> = OFFICIAL_CLAUDE_MODELS.iter().map(|(id, _)| *id).collect();
        assert!(ids.contains(&"opus"));
        assert!(ids.contains(&"sonnet"));
        assert!(ids.contains(&"haiku"));
    }
}
