pub mod agent;
pub mod agent_skill;
pub mod app_state;
pub mod commands;
pub mod core;
pub mod db;
pub mod git;
pub mod local_data_path;
pub mod logging;
pub mod types;

use agent::latest_output_writer::LatestOutputWriter;
use app_state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use commands::agent_skill_commands::trigger_global_skill_refresh;
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
            commands::agent_skill_commands::list_agent_skills,
            commands::agent_skill_commands::refresh_agent_skills,
            commands::core_commands::initialize_local_data,
            commands::project_commands::create_project,
            commands::project_commands::list_projects,
            commands::project_commands::open_project,
            commands::project_commands::open_project_window,
            commands::project_commands::update_project_settings,
            commands::project_commands::validate_project_repo_path,
            commands::project_terminal_commands::create_project_terminal,
            commands::project_terminal_commands::create_temporary_project_terminal,
            commands::project_terminal_commands::list_project_terminals,
            commands::project_terminal_commands::read_project_terminal,
            commands::project_terminal_commands::write_project_terminal,
            commands::project_terminal_commands::restore_project_terminal,
            commands::project_terminal_commands::subscribe_project_terminal_output,
            commands::project_terminal_commands::unsubscribe_project_terminal_output,
            commands::project_terminal_commands::resize_project_terminal,
            commands::project_terminal_commands::close_project_terminal,
            commands::project_terminal_commands::update_project_terminal_config,
            commands::project_terminal_commands::delete_project_terminal_config,
            commands::project_terminal_commands::list_project_terminal_shortcut_commands,
            commands::project_terminal_commands::save_project_terminal_shortcut_command,
            commands::project_terminal_commands::delete_project_terminal_shortcut_command,
            commands::project_terminal_commands::read_project_terminal_cwd,
            commands::issue_commands::list_issues,
            commands::issue_commands::create_issue,
            commands::issue_commands::update_issue,
            commands::issue_commands::preview_issue_attachment,
            commands::issue_commands::export_issue_attachment,
            commands::issue_commands::save_issue_attachment_draft,
            commands::issue_commands::mark_issue_review,
            commands::issue_commands::advance_issue_status,
            commands::issue_commands::complete_issue_manual,
            commands::issue_commands::complete_issue_clean,
            commands::issue_commands::complete_issue_flow,
            commands::issue_commands::prepare_agent_commit_completion,
            commands::issue_commands::send_agent_commit_prompt,
            commands::issue_commands::detect_agent_commit_completion,
            commands::issue_commands::get_issue_summary,
            commands::issue_commands::get_issue_timeline,
            commands::issue_commands::delete_issue,
            commands::issue_commands::get_issue_worktree_status,
            commands::issue_commands::delete_issue_worktree,
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
            commands::settings_commands::detect_codex_command,
            commands::settings_commands::test_agent_command,
            commands::settings_commands::list_agent_profiles,
            commands::settings_commands::save_agent_profile,
            commands::settings_commands::delete_agent_profile,
            commands::settings_commands::list_project_labels,
            commands::settings_commands::save_project_label,
            commands::settings_commands::delete_project_label,
            commands::settings_commands::list_saved_agent_skills,
            commands::settings_commands::save_saved_agent_skill,
            commands::settings_commands::delete_saved_agent_skill,
            commands::settings_commands::get_user_profile,
            commands::settings_commands::update_user_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
