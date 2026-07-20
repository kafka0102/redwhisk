pub mod agent;
pub mod agent_skill;
pub mod app_state;
pub mod commands;
pub mod db;
pub mod features;
pub mod git;
pub mod local_data_path;
pub mod local_data_service;
pub mod logging;
pub mod types;

use agent::latest_output_writer::LatestOutputWriter;
use app_state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use features::settings::agent_skill_commands::trigger_global_skill_refresh;
use local_data_service::LocalDataService;
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
            let latest_output_writer = LatestOutputWriter::new(data_dir.clone());
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
            // 异步播种内置 agent（ADR-0020）：开库 + 跑迁移 + 检测 codex/claude/opencode/grok
            // 命令是否安装，对已装且库中无任何记录者插入默认 global profile。不阻塞启动；
            // 失败仅记日志，不影响应用可用性。
            let seed_data_dir = data_dir.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) =
                    features::settings::SettingsService::seed_builtin_agents_in_data_dir(seed_data_dir)
                {
                    eprintln!("[settings] 内置 agent 自动播种失败：{error:?}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // 窗口关闭后清除其项目归属，避免切换菜单把已不存在的窗口当作「已打开」而无法新建。
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<AppState>() {
                    state.forget_window(window.label());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            features::settings::agent_skill_commands::list_agent_skills,
            features::settings::agent_skill_commands::refresh_agent_skills,
            commands::core_commands::initialize_local_data,
            features::project::commands::create_project,
            features::project::commands::list_projects,
            features::project::commands::remove_project_from_list,
            features::project::commands::delete_project,
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
            features::agent_session::commands::list_agent_sessions,
            features::agent_session::commands::start_agent_session,
            features::agent_session::commands::get_project_git_branches,
            features::agent_session::commands::set_agent_session_attention,
            features::agent_session::commands::inject_agent_session_prompt,
            features::agent_session::commands::start_structured_agent_session,
            features::agent_session::commands::resume_structured_agent_session,
            features::agent_session::commands::delete_agent_session,
            features::agent_session::commands::update_agent_session_title,
            features::agent_session::commands::send_agent_message,
            features::agent_session::commands::cancel_agent_turn,
            features::agent_session::commands::respond_agent_permission,
            features::agent_session::commands::set_agent_model,
            features::agent_session::commands::set_agent_thinking,
            features::agent_session::commands::set_agent_mode,
            features::agent_session::commands::list_agent_models,
            features::agent_session::commands::list_agent_modes,
            features::agent_session::commands::save_agent_attachment,
            features::agent_session::commands::read_agent_timeline,
            features::agent_session::tui_terminal_commands::write_agent_session_terminal,
            features::agent_session::tui_terminal_commands::resize_agent_session_terminal,
            features::agent_session::tui_terminal_commands::restore_agent_session_terminal,
            features::agent_session::tui_terminal_commands::subscribe_agent_session_terminal_output,
            features::agent_session::tui_terminal_commands::unsubscribe_agent_session_terminal_output,
            features::agent_session::tui_terminal_commands::read_agent_session_terminal,
            features::agent_session::workspace_commands::get_project_worktree_changes,
            features::agent_session::workspace_commands::list_code_workspace_roots,
            features::agent_session::workspace_commands::get_project_worktree_commit_history,
            features::agent_session::workspace_commands::get_project_worktree_file_tree,
            features::agent_session::workspace_commands::search_project_worktree_content,
            features::agent_session::workspace_commands::read_project_worktree_file,
            features::agent_session::workspace_commands::read_project_worktree_diff,
            features::agent_session::session_monitor_commands::open_session_monitor_window,
            features::agent_session::session_monitor_commands::close_session_monitor_window,
            features::agent_session::session_monitor_commands::open_monitored_agent_session,
            features::agent_session::session_monitor_commands::list_monitored_agent_sessions,
            features::settings::commands::detect_codex_command,
            features::settings::commands::test_agent_command,
            features::settings::commands::list_agent_profiles,
            features::settings::commands::save_agent_profile,
            features::settings::commands::delete_agent_profile,
            features::settings::commands::preview_agent_command_args,
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
