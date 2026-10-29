// Agent session 业务纵切：原 core/agent_session_service + session_workspace_service +
// commands/agent_session_commands + session_monitor_commands + session_workspace_commands。
// 详见 docs/architecture-design/backend-feature-first-refactor.md §四.1 与 ADR-0013。

mod active_time;
pub mod active_time_heartbeat;
mod claude_tui_archive;
mod codex_session_id_capture;
mod codex_session_log;
mod codex_tui_archive;
mod command_snapshot;
mod completed_review;
mod display_mode_switch;
mod display_mode_switch_backfill;
mod display_mode_switch_relaunch;
pub(crate) use display_mode_switch::NativeSessionHomes;
pub mod commands;
mod content_search;
mod grok_session_id_capture;
mod grok_tui_archive;
mod launch;
mod lifecycle;
mod log_path;
mod opencode_tui_archive;
mod service;
mod session_log_archive;
mod session_log_assistant;
mod session_log_line;
mod session_log_lookup;
mod session_log_tail;
pub mod session_monitor_commands;
mod startup_model;
pub(crate) mod steer_command;
mod terminal_archive_clean;
mod terminal_archive_render;
mod timeline;
mod tui_hook_dispatch;
mod tui_hook_env;
mod tui_hook_install;
mod tui_hook_settings;
mod tui_hook_socket;
pub use tui_hook_dispatch::run_tui_hook_command_from_process;
pub(crate) use tui_hook_dispatch::spawn_tui_hook_listener;
#[cfg(test)]
pub(crate) use tui_hook_install::parse_codex_hooks_feature;
pub(crate) use tui_hook_install::{query_codex_hooks_feature, CodexHooksFeature};
pub(crate) use tui_hook_settings::{
    apply_tui_hook_registration, channel_unavailable_error,
    detect_tui_hook_registration_with_feature, enable_codex_hooks_feature_file,
    uninstall_tui_hook_registration, upgrade_stale_tui_hook_files, TuiHookAgentKind,
    TuiHookRegistrationStatus,
};
pub(crate) use tui_hook_socket::tui_hook_socket_path;
mod tui_hook_turn;
mod tui_session_metrics_sync;
mod tui_terminal;
pub mod tui_terminal_commands;
mod validation;
mod workspace;
mod workspace_checkout_filter;
mod workspace_checkout_ops;
pub mod workspace_commands;
mod workspace_diff;
mod workspace_diff_commit;
mod workspace_diff_preview;
mod workspace_github;
mod workspace_merge_ops;
mod workspace_path_ops;
mod workspace_preview;
mod workspace_remote_ops;
mod worktree_setup;

pub(crate) use codex_session_id_capture::resolve_codex_home;
#[cfg(test)]
pub(crate) use codex_tui_archive::TuiSessionLogSource;
pub(crate) use grok_tui_archive::TuiArchiveSource;
#[cfg(test)]
pub(crate) use log_path::build_issue_archive_log_path;
pub(crate) use log_path::{
    build_issue_session_archive, is_archived_issue_log_path, remove_session_log_file,
    IssueSessionArchive,
};
pub(crate) use service::agent_session_error_to_command_error;
pub use service::AgentSessionService;
pub(crate) use session_log_lookup::{
    read_assistant_texts_for_turn, read_timeline_item_at_log_offset,
};

#[cfg(test)]
mod completed_review_tests;
#[cfg(test)]
mod timeline_cursor_tests;
#[cfg(test)]
mod timeline_replay_tests;
#[cfg(test)]
mod timeline_roster_window_tests;
#[cfg(test)]
mod timeline_tests;
#[cfg(test)]
mod tui_hook_env_tests;
#[cfg(test)]
mod tui_hook_install_tests;
#[cfg(test)]
mod tui_hook_settings_tests;
#[cfg(test)]
mod tui_hook_socket_tests;
#[cfg(test)]
mod tui_hook_turn_fallback_tests;
#[cfg(test)]
pub(crate) mod tui_hook_turn_tests;
#[cfg(test)]
mod tui_start_tests;
