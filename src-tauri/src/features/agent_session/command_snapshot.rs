use crate::agent::descriptor_for;
use crate::agent::provider_descriptor::append_model_arg_if_missing;
use crate::db::agent_profile_repository::AgentProfileRow;

/// 从 profile 构造交互式 TUI command snapshot（mode/dangerous 映射由 descriptor 负责）。
///
/// `requested_model` 为启动期模型选择（ADR-0036 第 8 条）：按该 provider 的 CLI
/// 模型参数名注入；未选模型或命令已含同类参数时快照与今天逐字符一致。
pub(super) fn build_tui_command_snapshot_for_profile(
    profile: &AgentProfileRow,
    requested_model: Option<&str>,
) -> String {
    let descriptor = descriptor_for(&profile.agent_type);
    let snapshot = descriptor.build_tui_command_snapshot(
        &profile.command,
        &profile.mode,
        profile.dangerous,
    );
    match requested_model.map(str::trim).filter(|model| !model.is_empty()) {
        Some(model) => append_model_arg_if_missing(&snapshot, descriptor.tui_model_flag(), model),
        None => snapshot,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::agent_profile::{AgentScope, AgentType};

    fn tui_profile(agent_type: AgentType, command: &str, mode: &str, dangerous: bool) -> AgentProfileRow {
        AgentProfileRow {
            id: 101,
            name: "TUI Test".to_string(),
            agent_type,
            command: command.to_string(),
            scope: AgentScope::Project,
            project_id: Some(1),
            mode: mode.to_string(),
            dangerous,
            default_skill: String::new(),
            prompt_template: String::new(),
            del: 0,
            display_mode: "tui".to_string(),
            enabled: true,
        }
    }

    #[test]
    fn tui_snapshot_injects_codex_model_arg() {
        let profile = tui_profile(AgentType::Codex, "codex", "auto", false);
        assert_eq!(
            build_tui_command_snapshot_for_profile(&profile, Some("gpt-5.5")),
            "codex --ask-for-approval on-request --sandbox workspace-write -m gpt-5.5"
        );
    }

    #[test]
    fn tui_snapshot_injects_claude_model_arg() {
        let profile = tui_profile(AgentType::Claude, "claude", "auto", false);
        assert_eq!(
            build_tui_command_snapshot_for_profile(&profile, Some("sonnet")),
            "claude --permission-mode auto --model sonnet"
        );
    }

    #[test]
    fn tui_snapshot_injects_grok_model_arg() {
        let profile = tui_profile(AgentType::Grok, "grok", "auto", false);
        assert_eq!(
            build_tui_command_snapshot_for_profile(&profile, Some("grok-4")),
            "grok -m grok-4"
        );
    }

    #[test]
    fn tui_snapshot_injects_opencode_model_arg() {
        let profile = tui_profile(AgentType::OpenCode, "opencode", "auto", false);
        assert_eq!(
            build_tui_command_snapshot_for_profile(&profile, Some("gpt-5.5")),
            "opencode -m gpt-5.5"
        );
    }

    #[test]
    fn tui_snapshot_does_not_duplicate_existing_model_arg() {
        let profile = tui_profile(AgentType::Claude, "claude --model=sonnet", "auto", false);
        assert_eq!(
            build_tui_command_snapshot_for_profile(&profile, Some("opus")),
            "claude --model=sonnet --permission-mode auto"
        );
    }

    #[test]
    fn tui_snapshot_without_model_matches_today() {
        let profile = tui_profile(AgentType::Codex, "codex", "auto", false);
        assert_eq!(
            build_tui_command_snapshot_for_profile(&profile, None),
            "codex --ask-for-approval on-request --sandbox workspace-write"
        );
        assert_eq!(
            build_tui_command_snapshot_for_profile(&profile, Some("   ")),
            "codex --ask-for-approval on-request --sandbox workspace-write"
        );
    }

    #[test]
    fn tui_snapshot_coexists_with_dangerous_mode() {
        let profile = tui_profile(AgentType::Codex, "codex", "full-access", true);
        assert_eq!(
            build_tui_command_snapshot_for_profile(&profile, Some("gpt-6-astra")),
            "codex --dangerously-bypass-approvals-and-sandbox -m gpt-6-astra"
        );
        let grok = tui_profile(AgentType::Grok, "grok", "full-access", true);
        assert_eq!(
            build_tui_command_snapshot_for_profile(&grok, Some("grok-4")),
            "grok --always-approve -m grok-4"
        );
    }
}
