pub mod agent;
pub mod agent_skill;
pub mod app_state;
pub mod commands;
pub mod core;
pub mod db;
pub mod git;
pub mod local_data_path;
pub mod types;

use agent::latest_output_writer::LatestOutputWriter;
use app_state::AppState;
use commands::agent_skill_commands::trigger_global_skill_refresh;
use core::local_data_service::LocalDataService;
use local_data_path::redwhisk_data_dir;
use tauri::{Emitter, Manager};

const AGENT_SESSION_TERMINAL_OUTPUT_EVENT: &str = "agent-session-terminal-output";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new(LocalDataService::new()))
        .setup(|app| {
            let app_handle = app.handle().clone();
            let latest_output_writer = LatestOutputWriter::new(redwhisk_data_dir(app.handle())?);
            let state = app.state::<AppState>();
            state.pty_sessions.set_output_sink(move |event| {
                latest_output_writer.record_terminal_output(&event);
                let _ = app_handle.emit(AGENT_SESSION_TERMINAL_OUTPUT_EVENT, event);
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
            commands::project_commands::update_project_completion_policy,
            commands::project_commands::update_project_settings,
            commands::project_commands::validate_project_repo_path,
            commands::project_terminal_commands::create_project_terminal,
            commands::project_terminal_commands::create_temporary_project_terminal,
            commands::project_terminal_commands::list_project_terminals,
            commands::project_terminal_commands::read_project_terminal,
            commands::project_terminal_commands::write_project_terminal,
            commands::project_terminal_commands::restore_project_terminal,
            commands::project_terminal_commands::resize_project_terminal,
            commands::project_terminal_commands::close_project_terminal,
            commands::project_terminal_commands::update_project_terminal_config,
            commands::project_terminal_commands::delete_project_terminal_config,
            commands::issue_commands::list_issues,
            commands::issue_commands::create_issue,
            commands::issue_commands::update_issue,
            commands::issue_commands::preview_issue_attachment,
            commands::issue_commands::export_issue_attachment,
            commands::issue_commands::mark_issue_review,
            commands::issue_commands::advance_issue_status,
            commands::issue_commands::complete_issue_manual,
            commands::issue_commands::complete_issue_clean,
            commands::issue_commands::prepare_agent_commit_completion,
            commands::issue_commands::send_agent_commit_prompt,
            commands::issue_commands::detect_agent_commit_completion,
            commands::issue_commands::get_issue_summary,
            commands::issue_commands::delete_issue,
            commands::agent_session_commands::list_agent_sessions,
            commands::agent_session_commands::start_agent_session,
            commands::agent_session_commands::get_project_git_branches,
            commands::agent_session_commands::start_standalone_agent_session,
            commands::agent_session_commands::read_agent_session_terminal,
            commands::agent_session_commands::write_agent_session_terminal,
            commands::agent_session_commands::restore_agent_session_terminal,
            commands::agent_session_commands::set_agent_session_attention,
            commands::agent_session_commands::inject_agent_session_prompt,
            commands::agent_session_commands::resize_agent_session_terminal,
            commands::agent_session_commands::start_structured_agent_session,
            commands::agent_session_commands::resume_structured_agent_session,
            commands::agent_session_commands::delete_agent_session,
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
            commands::session_workspace_commands::get_project_worktree_file_tree,
            commands::session_workspace_commands::read_project_worktree_file,
            commands::session_workspace_commands::read_project_worktree_diff,
            commands::settings_commands::detect_codex_command,
            commands::settings_commands::test_agent_command,
            commands::settings_commands::list_agent_profiles,
            commands::settings_commands::save_agent_profile,
            commands::settings_commands::delete_agent_profile,
            commands::settings_commands::list_project_labels,
            commands::settings_commands::save_project_label,
            commands::settings_commands::delete_project_label
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
