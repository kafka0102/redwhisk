use crate::db::agent_profile_repository::AgentProfileRow;

/// 构造 structured stream 路径的 command snapshot：仅 trim，不补 CLI bypass 参数。
///
/// structured 协议走 app-server，CLI 命令本身不需 bypass。provider 特性差异
/// （Codex launch 走 structured / Claude launch 走 CLI bypass）已下沉到
/// [`crate::agent::descriptor_for`] 的 `build_launch_command_snapshot`。
/// 本函数是 structured 路径的通用 trim，与 agent 类型无关。
pub(super) fn build_structured_command_snapshot(profile: &AgentProfileRow) -> String {
    profile.command.trim().to_string()
}
