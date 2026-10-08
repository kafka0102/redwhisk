//! DeepSeek Harness provider 描述符。
//!
//! 只有 json。结构化命令固定为 `dsh --profile acp`。不提供模型目录、
//! 推理强度、mode 或 TUI 续接。

use std::path::Path;

use crate::agent::deepseek_streaming::argv::{
    build_deepseek_structured_command_snapshot, DEEPSEEK_FALLBACK_BINARY,
};
use crate::types::agent_profile::AgentType;
use crate::types::agent_session::AgentUiCapabilities;
use crate::types::agent_session_stream::AgentModel;

use super::{AgentProviderDescriptor, RuntimeConfig, TuiInitialPromptDelivery};

/// DeepSeek Harness provider 描述符。
#[derive(Debug, Clone, Copy)]
pub struct DeepSeekDescriptor;

impl AgentProviderDescriptor for DeepSeekDescriptor {
    fn agent_type(&self) -> AgentType {
        AgentType::DeepSeek
    }

    fn resolve_runtime_config(
        &self,
        _data_dir: &Path,
        _command: &str,
        _requested_model: Option<&str>,
        _requested_effort: Option<&str>,
    ) -> RuntimeConfig {
        RuntimeConfig {
            model: None,
            effort: None,
            config_home: None,
        }
    }

    fn build_command_snapshot_with_bypass(&self, raw_command: &str) -> String {
        build_deepseek_structured_command_snapshot(raw_command)
    }

    fn build_launch_command_snapshot(&self, raw_command: &str) -> String {
        build_deepseek_structured_command_snapshot(raw_command)
    }

    fn build_tui_command_snapshot(
        &self,
        raw_command: &str,
        _mode: &str,
        _dangerous: bool,
    ) -> String {
        // 没有 TUI。即便误调用，也不要启动 web。
        build_deepseek_structured_command_snapshot(raw_command)
    }

    fn tui_model_flag(&self) -> &str {
        "-m"
    }

    fn build_tui_resume_command(
        &self,
        command_snapshot: &str,
        _provider_session_id: &str,
    ) -> String {
        build_deepseek_structured_command_snapshot(command_snapshot)
    }

    fn tui_initial_prompt_delivery(&self) -> TuiInitialPromptDelivery {
        TuiInitialPromptDelivery::StdinSubmit
    }

    fn fallback_command_when_snapshot_empty(&self) -> String {
        format!("{DEEPSEEK_FALLBACK_BINARY} --profile acp")
    }

    fn list_models(&self, _home_dir: &Path, _command: &str) -> Vec<AgentModel> {
        Vec::new()
    }

    fn is_model_list_read_only(&self, _home_dir: &Path) -> bool {
        true
    }

    fn accepted_display_mode(&self, raw: &str) -> Result<String, &'static str> {
        if raw.trim().eq_ignore_ascii_case("json") {
            Ok("json".to_string())
        } else {
            Err("deepseek displayMode must be json")
        }
    }

    fn ui_capabilities(&self) -> AgentUiCapabilities {
        AgentUiCapabilities {
            model_type_label: "DeepSeek".to_string(),
            can_show_model: false,
            supports_model_switching: false,
            supports_reasoning_effort: false,
            supports_modes: false,
            supports_tui_resume: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::provider_descriptor::descriptor_for;

    #[test]
    fn launch_snapshot_is_dsh_profile_acp() {
        let descriptor = descriptor_for(&AgentType::DeepSeek);
        assert_eq!(
            descriptor.build_launch_command_snapshot("dsh"),
            "dsh --profile acp"
        );
        assert_eq!(
            descriptor.build_launch_command_snapshot("dsh web"),
            "dsh --profile acp"
        );
        assert_eq!(
            descriptor.build_command_snapshot_with_bypass("dsh --profile sdk"),
            "dsh --profile acp"
        );
        assert_eq!(descriptor.agent_type(), AgentType::DeepSeek);
    }

    #[test]
    fn display_mode_rejects_anything_but_json() {
        let descriptor = descriptor_for(&AgentType::DeepSeek);
        assert_eq!(
            descriptor.accepted_display_mode("json").as_deref(),
            Ok("json")
        );
        assert_eq!(
            descriptor.accepted_display_mode(" JSON ").as_deref(),
            Ok("json")
        );
        assert!(descriptor.accepted_display_mode("tui").is_err());
        assert!(descriptor.accepted_display_mode("pty").is_err());
    }

    #[test]
    fn ui_hides_model_effort_and_mode() {
        let caps = descriptor_for(&AgentType::DeepSeek).ui_capabilities();
        assert!(!caps.can_show_model);
        assert!(!caps.supports_model_switching);
        assert!(!caps.supports_reasoning_effort);
        assert!(!caps.supports_modes);
        assert!(!caps.supports_tui_resume);
        assert!(descriptor_for(&AgentType::DeepSeek)
            .list_models(Path::new("/tmp"), "dsh")
            .is_empty());
    }
}
