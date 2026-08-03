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
use crate::agent::grok_config;
use crate::types::agent_profile::AgentType;
use crate::types::agent_session_stream::AgentModel;

#[path = "provider_descriptor_command.rs"]
mod command;
use command::{
    CLAUDE_FALLBACK_BINARY, CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG, CODEX_FALLBACK_BINARY,
    GROK_ALWAYS_APPROVE_ARG, GROK_FALLBACK_BINARY, OPENCODE_AUTO_ARG, OPENCODE_FALLBACK_BINARY,
    append_missing_args, build_claude_tui_command_snapshot, build_claude_tui_resume_command,
    build_codex_tui_command_snapshot, build_codex_tui_resume_command, build_grok_tui_command_snapshot,
    build_grok_tui_resume_command, build_opencode_structured_command_snapshot,
    build_opencode_tui_command_snapshot, build_opencode_tui_resume_command, claude_models_from_home,
    ensure_claude_bypass_permission_args,
};

/// 启动期 runtime 配置（model / effort），由 descriptor 按 provider 规则解析后填入
/// [`crate::agent::provider_factory::AgentSessionStartRequest`]。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeConfig {
    pub model: Option<String>,
    pub effort: Option<String>,
}

/// TUI 首条 prompt 投递方式（ADR-0022：能作 CLI 参数则注入参数，否则 stdin）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TuiInitialPromptDelivery {
    /// `cmd <prompt>` 位置参数（codex / claude / grok）。
    TrailingArgument,
    /// `cmd --prompt <prompt>`（opencode）。
    PromptFlag,
    /// PTY 就绪后写 stdin + CR（未知/自定义 binary 回退）。
    StdinSubmit,
}

/// 把首条 prompt 落到具体 spawn 命令 / trailing argv / stdin 注入计划。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TuiInitialPromptPlan {
    /// 实际 spawn 使用的命令（OpenCode 会内联 `--prompt`；其余保持 snapshot）。
    pub spawn_command: String,
    /// 作为位置参数附加的 prompt（仅 TrailingArgument）。
    pub trailing_prompt: Option<String>,
    /// register 后是否再写 stdin（仅 StdinSubmit）。
    pub inject_stdin_after_register: bool,
}

/// 按 provider 解析 TUI 首条 prompt 投递计划；不改 DB 中的 command_snapshot。
pub fn plan_tui_initial_prompt(
    agent_type: &AgentType,
    command_snapshot: &str,
    prompt: &str,
) -> TuiInitialPromptPlan {
    match descriptor_for(agent_type).tui_initial_prompt_delivery() {
        TuiInitialPromptDelivery::TrailingArgument => TuiInitialPromptPlan {
            spawn_command: command_snapshot.to_string(),
            trailing_prompt: Some(prompt.to_string()),
            inject_stdin_after_register: false,
        },
        TuiInitialPromptDelivery::PromptFlag => TuiInitialPromptPlan {
            spawn_command: command::append_prompt_flag_arg(command_snapshot, prompt),
            trailing_prompt: None,
            inject_stdin_after_register: false,
        },
        TuiInitialPromptDelivery::StdinSubmit => TuiInitialPromptPlan {
            spawn_command: command_snapshot.to_string(),
            trailing_prompt: None,
            inject_stdin_after_register: true,
        },
    }
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

    /// 构造交互式 TUI resume 启动命令（基于已持久化的 `command_snapshot` + Provider 会话标识）。
    ///
    /// **不**改写 DB 中的 `command_snapshot`；**不**注入额外 prompt。
    /// resume 命令只用于本次 spawn。
    fn build_tui_resume_command(&self, command_snapshot: &str, provider_session_id: &str) -> String;

    /// TUI 首条 prompt 如何投递（CLI 参数优先，stdin 仅作回退）。
    fn tui_initial_prompt_delivery(&self) -> TuiInitialPromptDelivery;

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
/// 4 种 provider 用 `match` 查表即可（编译期穷尽性是优点）；若未来需动态注册再换
/// `HashMap`（见 ADR-0015）。
pub fn descriptor_for(agent_type: &AgentType) -> &'static dyn AgentProviderDescriptor {
    static CODEX: CodexDescriptor = CodexDescriptor;
    static CLAUDE: ClaudeDescriptor = ClaudeDescriptor;
    static OPENCODE: OpenCodeDescriptor = OpenCodeDescriptor;
    static GROK: GrokDescriptor = GrokDescriptor;
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

    fn build_tui_resume_command(&self, command_snapshot: &str, provider_session_id: &str) -> String {
        build_codex_tui_resume_command(command_snapshot, provider_session_id)
    }

    fn tui_initial_prompt_delivery(&self) -> TuiInitialPromptDelivery {
        TuiInitialPromptDelivery::TrailingArgument
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
            supports_tui_resume: true,
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

    fn build_tui_resume_command(&self, command_snapshot: &str, provider_session_id: &str) -> String {
        build_claude_tui_resume_command(command_snapshot, provider_session_id)
    }

    fn tui_initial_prompt_delivery(&self) -> TuiInitialPromptDelivery {
        TuiInitialPromptDelivery::TrailingArgument
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
            supports_tui_resume: true,
        }
    }
}

// ===== OpenCode =====

/// OpenCode provider 描述符。
///
/// TUI 走进程级 PTY（ADR-0022）；structured/json 走 `run --format json` 会话。
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
        build_opencode_structured_command_snapshot(raw_command)
    }

    fn build_tui_command_snapshot(&self, raw_command: &str, mode: &str, dangerous: bool) -> String {
        build_opencode_tui_command_snapshot(raw_command, mode, dangerous)
    }

    fn build_tui_resume_command(&self, command_snapshot: &str, provider_session_id: &str) -> String {
        build_opencode_tui_resume_command(command_snapshot, provider_session_id)
    }

    fn tui_initial_prompt_delivery(&self) -> TuiInitialPromptDelivery {
        TuiInitialPromptDelivery::PromptFlag
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
            supports_tui_resume: true,
        }
    }
}

// ===== Grok =====

/// Grok provider 描述符。
///
/// TUI-only：经交互式 PTY 启动（ADR-0022）；displayMode 锁定 tui，不接结构化 json
/// 路径（`provider_factory` 对 Grok 保留防御性拒绝）。模型只读展示，读 `~/.grok/config.toml`
/// 的 `[models].default`。
#[derive(Debug, Clone, Copy)]
pub struct GrokDescriptor;

impl AgentProviderDescriptor for GrokDescriptor {
    fn agent_type(&self) -> AgentType {
        AgentType::Grok
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
        // dangerous 预览 / bypass 路径：与 TUI 启动一致地补 --always-approve（见 ADR-0020 #6）。
        append_missing_args(raw_command.trim(), &[GROK_ALWAYS_APPROVE_ARG])
    }

    fn build_launch_command_snapshot(&self, raw_command: &str) -> String {
        // Grok 仅 TUI 启动；structured launch 路径不可达，保持 trim 不注入结构化参数。
        raw_command.trim().to_string()
    }

    fn build_tui_command_snapshot(&self, raw_command: &str, mode: &str, dangerous: bool) -> String {
        build_grok_tui_command_snapshot(raw_command, mode, dangerous)
    }

    fn build_tui_resume_command(&self, command_snapshot: &str, provider_session_id: &str) -> String {
        build_grok_tui_resume_command(command_snapshot, provider_session_id)
    }

    fn tui_initial_prompt_delivery(&self) -> TuiInitialPromptDelivery {
        TuiInitialPromptDelivery::TrailingArgument
    }

    fn fallback_command_when_snapshot_empty(&self) -> String {
        GROK_FALLBACK_BINARY.to_string()
    }

    fn list_models(&self, home_dir: &Path) -> Vec<AgentModel> {
        // 只读展示 `[models].default`；读不到则空（前端不展示模型）。
        grok_config::read_default_model_from_home(home_dir)
            .map(|model| AgentModel {
                model_id: model.clone(),
                display_name: Some(model),
                is_default: Some(true),
                default_reasoning_effort: None,
                supported_reasoning_efforts: Vec::new(),
            })
            .into_iter()
            .collect()
    }

    fn is_model_list_read_only(&self, _home_dir: &Path) -> bool {
        true
    }

    fn ui_capabilities(&self) -> crate::types::agent_session::AgentUiCapabilities {
        crate::types::agent_session::AgentUiCapabilities {
            model_type_label: "Grok".to_string(),
            can_show_model: true,
            supports_model_switching: false,
            supports_reasoning_effort: false,
            supports_modes: false,
            supports_tui_resume: true,
        }
    }
}

#[cfg(test)]
#[path = "provider_descriptor_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "provider_descriptor_grok_tests.rs"]
mod grok_tests;

#[cfg(test)]
#[path = "provider_descriptor_resume_tests.rs"]
mod resume_tests;

#[cfg(test)]
#[path = "provider_descriptor_prompt_tests.rs"]
mod prompt_tests;
