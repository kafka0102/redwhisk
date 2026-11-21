use crate::types::agent_profile::AgentScope;
use crate::types::errors::{CommandError, CommandErrorCode};

pub(super) const AGENT_PROFILE_LIMIT_PER_SCOPE: i64 = 30;

pub(super) fn ensure_agent_profile_capacity(
    scope: &AgentScope,
    active_count: i64,
) -> Result<(), CommandError> {
    if active_count < AGENT_PROFILE_LIMIT_PER_SCOPE {
        return Ok(());
    }

    let scope_name = match scope {
        AgentScope::Global => "global",
        AgentScope::Project => "project",
    };
    Err(CommandError::new(
        CommandErrorCode::AgentProfileValidationFailed,
        format!("Up to {AGENT_PROFILE_LIMIT_PER_SCOPE} {scope_name} agent profiles can be saved."),
    )
    .with_reason("agentProfileLimitExceeded"))
}
