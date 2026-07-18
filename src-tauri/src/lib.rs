pub mod agent;
pub mod agent_skill;
pub mod app_state;
pub mod commands;
pub mod core;
pub mod db;
pub mod features;
pub mod git;
pub mod local_data_path;
pub mod logging;
pub mod types;

use agent::latest_output_writer::LatestOutputWriter;
use app_state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use features::settings::agent_skill_commands::trigger_global_skill_refresh;
use core::local_data_service::LocalDataService;
use local_data_path::redwhisk_data_dir;
use logging::Logger;
use serde::Serialize;
use tauri::{Emitter, Manager};

const AGENT_SESSION_TERMINAL_OUTPUT_EVENT: &str = "agent-session-terminal-output";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputEventPayload {
    project_id: i64,
    session_id: i64,
    sequence: u64,
    data: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new(LocalDataService::new()))
        .setup(|app| {
            let data_dir = redwhisk_data_dir(app.handle())?;
            // 先初始化全局 Logger，后续启动流程即可记录关键操作与错误日志。
            Logger::init(data_dir.clone());
            // 启动即清空所有终端历史日志，软件再次打开不保留上次会话输出。
            features::project_terminal::purge_terminal_log_dir(&data_dir);
            let app_handle = app.handle().clone();
            let latest_output_writer = LatestOutputWriter::new(data_dir);
            let state = app.state::<AppState>();
            state.pty_sessions.set_output_sink(move |event| {
                latest_output_writer.record_terminal_output(&event);
                let payload = TerminalOutputEventPayload {
                    project_id: event.project_id,
                    session_id: event.session_id,
                    sequence: event.sequence,
                    data: STANDARD.encode(&event.data),
                };
                let _ = app_handle.emit(AGENT_SESSION_TERMINAL_OUTPUT_EVENT, payload);
            });
            state
                .agent_event_broadcaster
                .set_app_handle(app.handle().clone());
            trigger_global_skill_refresh(app.handle().clone(), state.agent_skills.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            features::settings::agent_skill_commands::list_agent_skills,
            features::settings::agent_skill_commands::refresh_agent_skills,
            commands::core_commands::initialize_local_data,
            features::project::commands::create_project,
            features::project::commands::list_projects,
            features::project::commands::open_project,
            features::project::commands::open_project_window,
            features::project::commands::update_project_settings,
            features::project::commands::validate_project_repo_path,
            features::project_terminal::commands::create_project_terminal,
            features::project_terminal::commands::create_temporary_project_terminal,
            features::project_terminal::commands::list_project_terminals,
            features::project_terminal::commands::read_project_terminal,
            features::project_terminal::commands::write_project_terminal,
            features::project_terminal::commands::restore_project_terminal,
            features::project_terminal::commands::subscribe_project_terminal_output,
            features::project_terminal::commands::unsubscribe_project_terminal_output,
            features::project_terminal::commands::resize_project_terminal,
            features::project_terminal::commands::close_project_terminal,
            features::project_terminal::commands::update_project_terminal_config,
            features::project_terminal::commands::delete_project_terminal_config,
            features::project_terminal::commands::list_project_terminal_shortcut_commands,
            features::project_terminal::commands::save_project_terminal_shortcut_command,
            features::project_terminal::commands::delete_project_terminal_shortcut_command,
            features::project_terminal::commands::read_project_terminal_cwd,
            features::project_terminal::commands::set_app_theme,
            features::issue::commands::list_issues,
            features::issue::commands::create_issue,
            features::issue::commands::update_issue,
            features::issue::commands::preview_issue_attachment,
            features::issue::commands::export_issue_attachment,
            features::issue::commands::save_issue_attachment_draft,
            features::issue::commands::mark_issue_review,
            features::issue::commands::advance_issue_status,
            features::issue::commands::complete_issue_manual,
            features::issue::commands::complete_issue_clean,
            features::issue::commands::complete_issue_flow,
            features::issue::commands::prepare_agent_commit_completion,
            features::issue::commands::send_agent_commit_prompt,
            features::issue::commands::detect_agent_commit_completion,
            features::issue::commands::get_issue_summary,
            features::issue::commands::get_issue_timeline,
            features::issue::commands::delete_issue,
            features::issue::commands::get_issue_worktree_status,
            features::issue::commands::delete_issue_worktree,
            commands::agent_session_commands::list_agent_sessions,
            commands::agent_session_commands::start_agent_session,
            commands::agent_session_commands::get_project_git_branches,
            commands::agent_session_commands::set_agent_session_attention,
            commands::agent_session_commands::inject_agent_session_prompt,
            commands::agent_session_commands::start_structured_agent_session,
            commands::agent_session_commands::resume_structured_agent_session,
            commands::agent_session_commands::delete_agent_session,
            commands::agent_session_commands::update_agent_session_title,
            commands::agent_session_commands::send_agent_message,
            commands::agent_session_commands::cancel_agent_turn,
            commands::agent_session_commands::respond_agent_permission,
            commands::agent_session_commands::set_agent_model,
            commands::agent_session_commands::set_agent_thinking,
            commands::agent_session_commands::set_agent_mode,
            commands::agent_session_commands::list_agent_models,
            commands::agent_session_commands::list_agent_modes,
            commands::agent_session_commands::save_agent_attachment,
            commands::agent_session_commands::read_agent_timeline,
            commands::session_workspace_commands::get_project_worktree_changes,
            commands::session_workspace_commands::list_code_workspace_roots,
            commands::session_workspace_commands::get_project_worktree_commit_history,
            commands::session_workspace_commands::get_project_worktree_file_tree,
            commands::session_workspace_commands::read_project_worktree_file,
            commands::session_workspace_commands::read_project_worktree_diff,
            commands::session_monitor_commands::open_session_monitor_window,
            commands::session_monitor_commands::close_session_monitor_window,
            commands::session_monitor_commands::open_monitored_agent_session,
            commands::session_monitor_commands::list_monitored_agent_sessions,
            features::settings::commands::detect_codex_command,
            features::settings::commands::test_agent_command,
            features::settings::commands::list_agent_profiles,
            features::settings::commands::save_agent_profile,
            features::settings::commands::delete_agent_profile,
            features::settings::commands::list_project_labels,
            features::settings::commands::save_project_label,
            features::settings::commands::delete_project_label,
            features::settings::commands::list_saved_agent_skills,
            features::settings::commands::save_saved_agent_skill,
            features::settings::commands::delete_saved_agent_skill,
            features::settings::commands::get_user_profile,
            features::settings::commands::update_user_profile,
            features::app_update::commands::get_update_status,
            features::app_update::commands::dismiss_update_prompt
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
