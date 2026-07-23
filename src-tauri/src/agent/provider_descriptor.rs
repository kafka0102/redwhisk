//! Provider 能力描述符：把 Codex / Claude 的启动期能力差异从 service / command 层
//! 下沉到 provider 实现。
//!
//! service / command 通过 [`descriptor_for`] 查表获取描述符，不再 `match agent_type`。
//! 新增第 3 种 agent：实现 [`AgentProviderDescriptor`] + 在 [`descriptor_for`] 注册一行，
//! service / command 零改动。见 ADR-0015。

use std::path::Path;

use crate::agent::claude_config;
use crate::agent::codex_app_server::session::default_codex_models_with_selected;
use crate::agent::codex_config;
use crate::types::agent_profile::AgentType;
use crate::types::agent_session_stream::AgentModel;

#[path = "provider_descriptor_command.rs"]
mod command;
use command::{
    CLAUDE_FALLBACK_BINARY, CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG, CODEX_FALLBACK_BINARY,
    OPENCODE_AUTO_ARG, OPENCODE_FALLBACK_BINARY, append_missing_args,
    build_claude_tui_command_snapshot, build_codex_tui_command_snapshot,
    build_opencode_tui_command_snapshot, claude_models_from_home,
    ensure_claude_bypass_permission_args,
};

/// 启动期 runtime 配置（model / effort），由 descriptor 按 provider 规则解析后填入
/// [`crate::agent::provider_factory::AgentSessionStartRequest`]。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeConfig {
    pub model: Option<String>,
    pub effort: Option<String>,
}

/// Provider 能力描述符：把 Codex / Claude 的启动期能力差异收回 provider 实现。
///
/// service / command 不再 `match agent_type`，而是 `descriptor_for(agent_type).<method>()`。
pub trait AgentProviderDescriptor: Send + Sync {
    /// 对应的 agent 类型。
    fn agent_type(&self) -> AgentType;

    /// 解析启动期 model / effort。
    ///
    /// `data_dir` 用于定位 provider 配置目录；`requested_*` 为调用方显式入参，优先于
    /// 配置文件读取。各 provider 决定是否读配置、是否忽略 effort。
    fn resolve_runtime_config(
        &self,
        data_dir: &Path,
        requested_model: Option<&str>,
        requested_effort: Option<&str>,
    ) -> RuntimeConfig;

    /// 构造 PTY 进程启动命令（补全 provider 必需的 bypass 参数）。
    ///
    /// 用于非 structured 的进程启动路径（`spawn_agent_process`）。
    fn build_command_snapshot_with_bypass(&self, raw_command: &str) -> String;

    /// 构造 issue launch 路径的 command snapshot。
    ///
    /// Codex 走 structured 协议（仅 trim，不加 CLI bypass）；Claude 走 CLI（补 bypass）。
    fn build_launch_command_snapshot(&self, raw_command: &str) -> String;

    /// 构造交互式 TUI 路径的 command snapshot（不含 app-server / stream-json）。
    ///
    /// `mode` 为 profile 协作模式 id；`dangerous` 为 profile 危险开关。
    /// 实现须按 provider 的交互式 CLI 语义映射审批/沙箱参数，且不得注入结构化协议参数。
    fn build_tui_command_snapshot(&self, raw_command: &str, mode: &str, dangerous: bool) -> String;

    /// resume 路径下 `command_snapshot` 为空时的兜底命令（provider 默认 binary + bypass）。
    fn fallback_command_when_snapshot_empty(&self) -> String;

    /// 列出 provider 可切换的模型（读 `home_dir` 下 provider 配置）。
    fn list_models(&self, home_dir: &Path) -> Vec<AgentModel>;

    /// 模型列表是否只读（第三方接口不允许切换）。
    fn is_model_list_read_only(&self, home_dir: &Path) -> bool;

    /// UI 能力投影（模型展示 / Think / modes 等），由 list_agent_models 下发前端。
    fn ui_capabilities(&self) -> crate::types::agent_session::AgentUiCapabilities;
}

/// 按 agent 类型查表获取 descriptor。
///
/// 2 种 provider 用 `match` 查表即可（编译期穷尽性是优点）；待第 3 种落地或需动态注册时
/// 再换 `HashMap`（见 ADR-0015）。
pub fn descriptor_for(agent_type: &AgentType) -> &'static dyn AgentProviderDescriptor {
    static CODEX: CodexDescriptor = CodexDescriptor;
    static CLAUDE: ClaudeDescriptor = ClaudeDescriptor;
    static OPENCODE: OpenCodeDescriptor = OpenCodeDescriptor;
    static GROK: StubDescriptor = StubDescriptor {
        agent_type: AgentType::Grok,
    };
    match agent_type {
        AgentType::Codex => &CODEX,
        AgentType::Claude => &CLAUDE,
        AgentType::OpenCode => &OPENCODE,
        AgentType::Grok => &GROK,
    }
}

// ===== Codex =====

/// Codex provider 描述符。
#[derive(Debug, Clone, Copy)]
pub struct CodexDescriptor;

impl AgentProviderDescriptor for CodexDescriptor {
    fn agent_type(&self) -> AgentType {
        AgentType::Codex
    }

    fn resolve_runtime_config(
        &self,
        data_dir: &Path,
        requested_model: Option<&str>,
        requested_effort: Option<&str>,
    ) -> RuntimeConfig {
        // Codex 配置目录 = data_dir 的父目录（~/.codex 与 data_dir 同级约定）。
        let home = data_dir.parent();
        let model = requested_model
            .map(str::to_string)
            .or_else(|| home.and_then(codex_config::read_model_from_home));
        let effort = requested_effort
            .map(str::to_string)
            .or_else(|| home.and_then(codex_config::read_reasoning_effort_from_home));
        RuntimeConfig { model, effort }
    }

    fn build_command_snapshot_with_bypass(&self, raw_command: &str) -> String {
        append_missing_args(raw_command, &[CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG])
    }

    fn build_launch_command_snapshot(&self, raw_command: &str) -> String {
        // structured 协议走 app-server，CLI 命令只需 trim，不加 bypass。
        raw_command.trim().to_string()
    }

    fn build_tui_command_snapshot(&self, raw_command: &str, mode: &str, dangerous: bool) -> String {
        build_codex_tui_command_snapshot(raw_command, mode, dangerous)
    }

    fn fallback_command_when_snapshot_empty(&self) -> String {
        append_missing_args(
            CODEX_FALLBACK_BINARY,
            &[CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG],
        )
    }

    fn list_models(&self, home_dir: &Path) -> Vec<AgentModel> {
        default_codex_models_with_selected(codex_config::read_model_from_home(home_dir).as_deref())
    }

    fn is_model_list_read_only(&self, _home_dir: &Path) -> bool {
        false
    }

    fn ui_capabilities(&self) -> crate::types::agent_session::AgentUiCapabilities {
        crate::types::agent_session::AgentUiCapabilities {
            model_type_label: "Codex".to_string(),
            can_show_model: true,
            supports_model_switching: true,
            supports_reasoning_effort: true,
            supports_modes: true,
        }
    }
}

// ===== Claude =====

/// Claude provider 描述符。
#[derive(Debug, Clone, Copy)]
pub struct ClaudeDescriptor;

impl AgentProviderDescriptor for ClaudeDescriptor {
    fn agent_type(&self) -> AgentType {
        AgentType::Claude
    }

    fn resolve_runtime_config(
        &self,
        _data_dir: &Path,
        requested_model: Option<&str>,
        _requested_effort: Option<&str>,
    ) -> RuntimeConfig {
        // Claude 不支持 reasoning effort；model 取调用方入参。
        RuntimeConfig {
            model: requested_model.map(str::to_string),
            effort: None,
        }
    }

    fn build_command_snapshot_with_bypass(&self, raw_command: &str) -> String {
        ensure_claude_bypass_permission_args(raw_command)
    }

    fn build_launch_command_snapshot(&self, raw_command: &str) -> String {
        ensure_claude_bypass_permission_args(raw_command)
    }

    fn build_tui_command_snapshot(&self, raw_command: &str, mode: &str, dangerous: bool) -> String {
        build_claude_tui_command_snapshot(raw_command, mode, dangerous)
    }

    fn fallback_command_when_snapshot_empty(&self) -> String {
        ensure_claude_bypass_permission_args(CLAUDE_FALLBACK_BINARY)
    }

    fn list_models(&self, home_dir: &Path) -> Vec<AgentModel> {
        claude_models_from_home(home_dir)
    }

    fn is_model_list_read_only(&self, home_dir: &Path) -> bool {
        claude_config::read_settings_from_home(home_dir)
            .map(|snapshot| claude_config::is_third_party(&snapshot))
            .unwrap_or(false)
    }

    fn ui_capabilities(&self) -> crate::types::agent_session::AgentUiCapabilities {
        crate::types::agent_session::AgentUiCapabilities {
            model_type_label: "Claude".to_string(),
            can_show_model: true,
            supports_model_switching: true,
            supports_reasoning_effort: false,
            supports_modes: false,
        }
    }
}

// ===== OpenCode =====

/// OpenCode provider 描述符。
///
/// 本期开放 TUI 进程级启动（ADR-0022）；json / `run --format` 由后续票接入。
#[derive(Debug, Clone, Copy)]
pub struct OpenCodeDescriptor;

impl AgentProviderDescriptor for OpenCodeDescriptor {
    fn agent_type(&self) -> AgentType {
        AgentType::OpenCode
    }

    fn resolve_runtime_config(
        &self,
        _data_dir: &Path,
        requested_model: Option<&str>,
        _requested_effort: Option<&str>,
    ) -> RuntimeConfig {
        RuntimeConfig {
            model: requested_model.map(str::to_string),
            effort: None,
        }
    }

    fn build_command_snapshot_with_bypass(&self, raw_command: &str) -> String {
        append_missing_args(raw_command.trim(), &[OPENCODE_AUTO_ARG])
    }

    fn build_launch_command_snapshot(&self, raw_command: &str) -> String {
        // structured/json 尚未解锁：launch snapshot 仅 trim，不注入 run/--format。
        raw_command.trim().to_string()
    }

    fn build_tui_command_snapshot(&self, raw_command: &str, mode: &str, dangerous: bool) -> String {
        build_opencode_tui_command_snapshot(raw_command, mode, dangerous)
    }

    fn fallback_command_when_snapshot_empty(&self) -> String {
        OPENCODE_FALLBACK_BINARY.to_string()
    }

    fn list_models(&self, _home_dir: &Path) -> Vec<AgentModel> {
        Vec::new()
    }

    fn is_model_list_read_only(&self, _home_dir: &Path) -> bool {
        true
    }

    fn ui_capabilities(&self) -> crate::types::agent_session::AgentUiCapabilities {
        crate::types::agent_session::AgentUiCapabilities {
            model_type_label: "OpenCode".to_string(),
            can_show_model: true,
            supports_model_switching: false,
            supports_reasoning_effort: false,
            supports_modes: false,
        }
    }
}

// ===== Grok（占位 descriptor） =====
//
// Grok 仍仅登记展示；descriptor 最小占位，provider_factory 启动路由不接。

/// Grok 的占位 descriptor（尚未接入会话执行）。
#[derive(Debug, Clone)]
pub struct StubDescriptor {
    agent_type: AgentType,
}

impl AgentProviderDescriptor for StubDescriptor {
    fn agent_type(&self) -> AgentType {
        self.agent_type.clone()
    }

    fn resolve_runtime_config(
        &self,
        _data_dir: &Path,
        requested_model: Option<&str>,
        _requested_effort: Option<&str>,
    ) -> RuntimeConfig {
        RuntimeConfig {
            model: requested_model.map(str::to_string),
            effort: None,
        }
    }

    fn build_command_snapshot_with_bypass(&self, raw_command: &str) -> String {
        raw_command.trim().to_string()
    }

    fn build_launch_command_snapshot(&self, raw_command: &str) -> String {
        raw_command.trim().to_string()
    }

    fn build_tui_command_snapshot(
        &self,
        raw_command: &str,
        _mode: &str,
        _dangerous: bool,
    ) -> String {
        raw_command.trim().to_string()
    }

    fn fallback_command_when_snapshot_empty(&self) -> String {
        match self.agent_type {
            AgentType::Grok => "grok".to_string(),
            AgentType::OpenCode => OPENCODE_FALLBACK_BINARY.to_string(),
            _ => String::new(),
        }
    }

    fn list_models(&self, _home_dir: &Path) -> Vec<AgentModel> {
        Vec::new()
    }

    fn is_model_list_read_only(&self, _home_dir: &Path) -> bool {
        true
    }

    fn ui_capabilities(&self) -> crate::types::agent_session::AgentUiCapabilities {
        let model_type_label = match self.agent_type {
            AgentType::Grok => "Grok",
            AgentType::OpenCode => "OpenCode",
            AgentType::Codex => "Codex",
            AgentType::Claude => "Claude",
        };
        crate::types::agent_session::AgentUiCapabilities {
            model_type_label: model_type_label.to_string(),
            can_show_model: false,
            supports_model_switching: false,
            supports_reasoning_effort: false,
            supports_modes: false,
        }
    }
}

#[cfg(test)]
#[path = "provider_descriptor_tests.rs"]
mod tests;
