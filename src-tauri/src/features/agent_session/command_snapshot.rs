use crate::agent::descriptor_for;
use crate::db::agent_profile_repository::AgentProfileRow;

/// 从 profile 构造交互式 TUI command snapshot（mode/dangerous 映射由 descriptor 负责）。
pub(super) fn build_tui_command_snapshot_for_profile(profile: &AgentProfileRow) -> String {
    descriptor_for(&profile.agent_type).build_tui_command_snapshot(
        &profile.command,
        &profile.mode,
        profile.dangerous,
    )
}
