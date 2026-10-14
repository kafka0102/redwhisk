//! TUI hook 设置：路径、偏好与通道检查。文件改写复用 install 纯函数。
//!
//! 安装不改 Codex `config.toml`。`[features] hooks = true` 只由单独的 enable 写入。

use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

use super::tui_hook_install::{
    codex_hooks_feature_enabled, enable_codex_hooks_feature, install_codex_hooks,
    install_grok_hooks, uninstall_codex_hooks, uninstall_grok_hooks,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TuiHookAgentKind {
    Codex,
    Grok,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TuiHookRegistrationStatus {
    pub codex_registered: bool,
    pub grok_registered: bool,
    pub codex_hooks_feature_enabled: bool,
    pub channel_available: bool,
    pub registration_allowed: bool,
}

impl TuiHookRegistrationStatus {
    /// 检测只知道文件是否写上了 RedWhisk command，不知道 CLI 是否已信任。
    pub fn codex_registered_label_is_trusted(&self) -> bool {
        false
    }
}

pub fn detect_tui_hook_registration(
    home: &Path,
    command_path: &str,
) -> io::Result<TuiHookRegistrationStatus> {
    detect_tui_hook_registration_with_flags(home, command_path, false, false)
}

pub fn detect_tui_hook_registration_with_flags(
    home: &Path,
    command_path: &str,
    channel_available: bool,
    registration_allowed: bool,
) -> io::Result<TuiHookRegistrationStatus> {
    let codex_hooks = codex_hooks_path(home);
    let config = read_optional(&codex_config_path(home))?;
    Ok(TuiHookRegistrationStatus {
        codex_registered: file_contains_our_command(&codex_hooks, command_path, "codex")?,
        grok_registered: file_contains_our_command(&grok_hook_path(home), command_path, "grok")?,
        codex_hooks_feature_enabled: codex_hooks_feature_enabled(&config),
        channel_available,
        registration_allowed,
    })
}

/// 只写 hook 文件。不改 `config.toml`，即使 hooks feature 为 false。
pub fn install_tui_hook_registration(
    home: &Path,
    kind: TuiHookAgentKind,
    command_path: &str,
) -> io::Result<()> {
    match kind {
        TuiHookAgentKind::Codex => install_codex_hooks(
            &codex_hooks_path(home),
            &codex_config_path(home),
            command_path,
            false,
        ),
        TuiHookAgentKind::Grok => install_grok_hooks(&grok_hooks_dir(home), command_path),
    }
}

pub fn uninstall_tui_hook_registration(
    home: &Path,
    kind: TuiHookAgentKind,
    command_path: &str,
) -> io::Result<()> {
    match kind {
        TuiHookAgentKind::Codex => {
            uninstall_codex_hooks(&codex_hooks_path(home), command_path)
        }
        TuiHookAgentKind::Grok => uninstall_grok_hooks(&grok_hooks_dir(home), command_path),
    }
}

pub fn enable_codex_hooks_feature_file(config_path: &Path) -> io::Result<()> {
    enable_codex_hooks_feature(config_path)
}

/// 通道不可用时拒绝安装，不写 hook 文件。
pub fn apply_tui_hook_registration(
    home: &Path,
    kind: TuiHookAgentKind,
    command_path: &str,
    channel_available: bool,
) -> Result<(), CommandError> {
    if !channel_available {
        return Err(channel_unavailable_error());
    }
    install_tui_hook_registration(home, kind, command_path).map_err(hook_io_error)
}

pub fn channel_unavailable_error() -> CommandError {
    CommandError::new(
        CommandErrorCode::SettingsPersistenceFailed,
        "本机状态通道不可用。",
    )
    .with_reason("channelUnavailable")
}

pub fn codex_hooks_path(home: &Path) -> PathBuf {
    home.join(".codex").join("hooks.json")
}

pub fn codex_config_path(home: &Path) -> PathBuf {
    home.join(".codex").join("config.toml")
}

pub fn grok_hooks_dir(home: &Path) -> PathBuf {
    home.join(".grok").join("hooks")
}

pub fn grok_hook_path(home: &Path) -> PathBuf {
    grok_hooks_dir(home).join("redwhisk.json")
}

fn file_contains_our_command(path: &Path, command_path: &str, source: &str) -> io::Result<bool> {
    if command_path.is_empty() || !path.exists() {
        return Ok(false);
    }
    let text = std::fs::read_to_string(path)?;
    let needle = format!("{command_path} hook --source {source}");
    Ok(text.contains(&needle))
}

fn read_optional(path: &Path) -> io::Result<String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error),
    }
}

fn hook_io_error(error: io::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::SettingsPersistenceFailed,
        "TUI hook 注册失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
