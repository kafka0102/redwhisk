//! Grok provider 描述符（从 `provider_descriptor` 拆出，控制单文件行数）。

use std::path::Path;

use crate::agent::grok_config;
use crate::types::agent_profile::AgentType;
use crate::types::agent_session::AgentUiCapabilities;
use crate::types::agent_session_stream::AgentModel;

use super::command::{
    append_missing_args, build_grok_tui_command_snapshot, build_grok_tui_resume_command,
    GROK_ALWAYS_APPROVE_ARG, GROK_FALLBACK_BINARY,
};
use super::{AgentProviderDescriptor, RuntimeConfig, TuiInitialPromptDelivery};

/// Grok provider 描述符。
///
/// TUI-only：经交互式 PTY 启动（ADR-0022）；displayMode 锁定 tui，不接结构化 json
/// 路径（`provider_factory` 对 Grok 保留防御性拒绝）。模型候选读 `~/.grok/config.toml`：
/// 存在 `[model.<别名>]` 表时逐表枚举（`[models].default` 对应项标默认），否则回退
/// 单条默认模型；列表不再整体只读，会话内仍因 `supports_model_switching=false` 不可切换。
#[derive(Debug, Clone, Copy)]
pub struct GrokDescriptor;

impl AgentProviderDescriptor for GrokDescriptor {
    fn agent_type(&self) -> AgentType {
        AgentType::Grok
    }

    fn resolve_runtime_config(
        &self,
        data_dir: &Path,
        _command: &str,
        requested_model: Option<&str>,
        _requested_effort: Option<&str>,
    ) -> RuntimeConfig {
        RuntimeConfig {
            model: requested_model.map(str::to_string),
            effort: None,
            config_home: data_dir.parent().map(Path::to_path_buf),
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

    fn build_tui_resume_command(
        &self,
        command_snapshot: &str,
        provider_session_id: &str,
    ) -> String {
        build_grok_tui_resume_command(command_snapshot, provider_session_id)
    }

    fn tui_initial_prompt_delivery(&self) -> TuiInitialPromptDelivery {
        TuiInitialPromptDelivery::TrailingArgument
    }

    fn fallback_command_when_snapshot_empty(&self) -> String {
        GROK_FALLBACK_BINARY.to_string()
    }

    fn list_models(&self, home_dir: &Path, _command: &str) -> Vec<AgentModel> {
        let aliases = grok_config::read_model_aliases_from_home(home_dir);
        if aliases.is_empty() {
            // 无别名表时保持既有语义：单条默认模型；读不到则空（前端不展示）。
            return grok_config::read_default_model_from_home(home_dir)
                .map(|model| AgentModel {
                    model_id: model.clone(),
                    display_name: Some(model),
                    is_default: Some(true),
                    default_reasoning_effort: None,
                    supported_reasoning_efforts: Vec::new(),
                })
                .into_iter()
                .collect();
        }
        let default_model = grok_config::read_default_model_from_home(home_dir);
        aliases
            .into_iter()
            .map(|alias| {
                let is_default = default_model.as_deref() == Some(alias.as_str());
                AgentModel {
                    model_id: alias.clone(),
                    display_name: Some(alias),
                    is_default: Some(is_default),
                    default_reasoning_effort: None,
                    supported_reasoning_efforts: Vec::new(),
                }
            })
            .collect()
    }

    fn is_model_list_read_only(&self, _home_dir: &Path) -> bool {
        false
    }

    fn ui_capabilities(&self) -> AgentUiCapabilities {
        AgentUiCapabilities {
            model_type_label: "Grok".to_string(),
            can_show_model: true,
            supports_model_switching: false,
            supports_reasoning_effort: false,
            supports_modes: false,
            supports_tui_resume: true,
        }
    }
}
