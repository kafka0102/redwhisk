// Agent session 业务纵切：原 core/agent_session_service + session_workspace_service +
// commands/agent_session_commands + session_monitor_commands + session_workspace_commands。
// 详见 docs/architecture-design/backend-feature-first-refactor.md §四.1 与 ADR-0013。

pub mod commands;
pub mod tui_terminal_commands;
mod tui_terminal;
pub mod session_monitor_commands;
pub mod workspace_commands;
mod codex_session_id_capture;
mod command_snapshot;
mod launch;
mod log_path;
mod service;
mod timeline;
mod validation;
mod worktree_setup;
mod content_search;
mod workspace;

pub use service::AgentSessionService;
pub(crate) use service::agent_session_error_to_command_error;
pub(crate) use log_path::{
    IssueSessionArchive, build_issue_session_archive, is_archived_issue_log_path,
    remove_session_log_file,
};
pub(crate) use timeline::read_last_assistant_text_for_turn;
#[cfg(test)]
pub(crate) use log_path::build_issue_archive_log_path;

#[cfg(test)]
mod tui_start_tests;
