// Agent session 业务纵切：原 core/agent_session_service + session_workspace_service +
// commands/agent_session_commands + session_monitor_commands + session_workspace_commands。
// 详见 docs/architecture-design/backend-feature-first-refactor.md §四.1 与 ADR-0013。

mod active_time;
pub mod active_time_heartbeat;
mod codex_session_id_capture;
// 纯函数 seam，本票暂未接线；crate 级 `warnings = "deny"` 会把 dead_code 升级为
// 硬错误，故先以 pub 模块暴露。接线（归档 / 心跳）后应回落为私有 `mod` + `pub(crate)`。
pub mod codex_session_log;
mod command_snapshot;
pub mod commands;
mod content_search;
mod launch;
mod lifecycle;
mod log_path;
mod service;
pub mod session_monitor_commands;
mod startup_model;
mod terminal_archive_clean;
mod terminal_archive_render;
mod timeline;
mod tui_terminal;
pub mod tui_terminal_commands;
mod validation;
mod workspace;
mod workspace_checkout_filter;
mod workspace_checkout_ops;
pub mod workspace_commands;
mod workspace_diff;
mod workspace_diff_commit;
mod workspace_github;
mod workspace_merge_ops;
mod workspace_path_ops;
mod workspace_remote_ops;
mod worktree_setup;

#[cfg(test)]
pub(crate) use log_path::build_issue_archive_log_path;
pub(crate) use log_path::{
    build_issue_session_archive, is_archived_issue_log_path, remove_session_log_file,
    IssueSessionArchive,
};
pub(crate) use service::agent_session_error_to_command_error;
pub use service::AgentSessionService;
pub(crate) use timeline::read_assistant_texts_for_turn;

#[cfg(test)]
mod tui_start_tests;
