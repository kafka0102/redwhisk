// Agent session 业务纵切：原 core/agent_session_service + session_workspace_service +
// commands/agent_session_commands + session_monitor_commands + session_workspace_commands。
// 详见 docs/architecture-design/backend-feature-first-refactor.md §四.1 与 ADR-0013。

pub mod commands;
pub mod session_monitor_commands;
pub mod workspace_commands;
mod service;
mod workspace;

pub use service::AgentSessionService;
pub(crate) use service::{
    IssueSessionArchive, agent_session_error_to_command_error,
    build_issue_session_archive, is_archived_issue_log_path,
    read_last_assistant_text_for_turn, remove_session_log_file,
};
#[cfg(test)]
pub(crate) use service::build_issue_archive_log_path;
