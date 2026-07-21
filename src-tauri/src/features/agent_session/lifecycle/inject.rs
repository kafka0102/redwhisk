//! 按 Session 展示形式快照注入 prompt（不按 runtime membership 猜通道）。

use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_registry::AgentSessionRegistry;
use crate::features::agent_session::lifecycle::display_mode::{
    runtime_transport_from_raw, RuntimeTransport,
};
use crate::features::agent_session::service::{
    agent_session_error_to_command_error, inactive_terminal_error,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

pub(crate) struct InjectRuntimePorts<'a> {
    pub pty: &'a PtySessionManager,
    pub registry: &'a AgentSessionRegistry,
}

pub(crate) fn inject_prompt(
    display_mode: &str,
    session_id: i64,
    prompt: &str,
    ports: InjectRuntimePorts<'_>,
) -> Result<(), CommandError> {
    match runtime_transport_from_raw(display_mode)? {
        RuntimeTransport::InteractiveTui => {
            if !ports.pty.contains(session_id) {
                return Err(not_running(session_id));
            }
            ports
                .pty
                .write_input(session_id, prompt)
                .map_err(inactive_terminal_error)?;
            Ok(())
        }
        RuntimeTransport::StructuredJson => {
            let Some(handle) = ports.registry.get(session_id) else {
                return Err(not_running(session_id));
            };
            handle
                .send_message(prompt.to_string(), Vec::new())
                .map_err(agent_session_error_to_command_error)?;
            Ok(())
        }
    }
}

fn not_running(session_id: i64) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionNotRunning,
        "当前 Session 未运行，请先恢复会话后再注入。",
    )
    .with_reason("notRunningForInject")
    .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::pty_session_manager::PtySessionManager;
    use crate::agent::session_registry::AgentSessionRegistry;

    #[test]
    fn tui_without_pty_is_not_running() {
        let pty = PtySessionManager::new();
        let registry = AgentSessionRegistry::new();
        let err = inject_prompt(
            "tui",
            42,
            "hello\n",
            InjectRuntimePorts {
                pty: &pty,
                registry: &registry,
            },
        )
        .unwrap_err();
        assert_eq!(err.reason.as_deref(), Some("notRunningForInject"));
    }

    #[test]
    fn json_without_handle_is_not_running() {
        let pty = PtySessionManager::new();
        let registry = AgentSessionRegistry::new();
        let err = inject_prompt(
            "json",
            42,
            "hello",
            InjectRuntimePorts {
                pty: &pty,
                registry: &registry,
            },
        )
        .unwrap_err();
        assert_eq!(err.reason.as_deref(), Some("notRunningForInject"));
    }

    #[test]
    fn invalid_display_mode_is_validation_error() {
        let pty = PtySessionManager::new();
        let registry = AgentSessionRegistry::new();
        let err = inject_prompt(
            "pty",
            42,
            "hello",
            InjectRuntimePorts {
                pty: &pty,
                registry: &registry,
            },
        )
        .unwrap_err();
        assert_eq!(err.reason.as_deref(), Some("invalidDisplayMode"));
    }
}
