use std::path::Path;

use crate::agent::codex_config;
use crate::db::agent_profile_repository::AgentProfileRow;
use crate::types::agent_profile::AgentType;



const CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG: &str = "--dangerously-bypass-approvals-and-sandbox";
const CLAUDE_PERMISSION_MODE_ARG: &str = "--permission-mode";
const CLAUDE_BYPASS_PERMISSIONS_MODE: &str = "bypassPermissions";

pub(super) fn build_command_snapshot(profile: &AgentProfileRow) -> String {
    agent_command_with_default_args(profile)
}


pub(super) fn build_structured_command_snapshot(profile: &AgentProfileRow) -> String {
    profile.command.trim().to_string()
}


pub(super) fn agent_command_with_default_args(profile: &AgentProfileRow) -> String {
    match profile.agent_type {
        AgentType::Codex => ensure_codex_bypass_arg(&profile.command),
        AgentType::Claude => ensure_claude_bypass_permission_args(&profile.command),
    }
}


pub(super) fn ensure_codex_bypass_arg(command: &str) -> String {
    append_missing_args(command, &[CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG])
}


fn ensure_claude_bypass_permission_args(command: &str) -> String {
    if command_has_arg(command, CLAUDE_PERMISSION_MODE_ARG) {
        command.trim().to_string()
    } else {
        append_missing_args(
            command,
            &[CLAUDE_PERMISSION_MODE_ARG, CLAUDE_BYPASS_PERMISSIONS_MODE],
        )
    }
}


fn append_missing_args(command: &str, args: &[&str]) -> String {
    let trimmed = command.trim();
    let mut command_line = trimmed.to_string();

    for arg in args {
        if command_has_arg(trimmed, arg) {
            continue;
        }

        if !command_line.is_empty() {
            command_line.push(' ');
        }
        command_line.push_str(arg);
    }

    command_line
}


fn command_has_arg(command: &str, arg: &str) -> bool {
    command.split_whitespace().any(|part| part == arg)
}


pub(super) fn read_codex_reasoning_effort_from_data_dir(data_dir: &Path) -> Option<String> {
    data_dir
        .parent()
        .and_then(codex_config::read_reasoning_effort_from_home)
}


pub(super) fn read_codex_model_from_data_dir(data_dir: &Path) -> Option<String> {
    data_dir
        .parent()
        .and_then(codex_config::read_model_from_home)
}
