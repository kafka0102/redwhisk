use tauri::{Emitter, State};

use crate::app_state::AppState;
use super::service::ProjectTerminalService;
use crate::types::app_theme::{AppThemePreferenceChangedEvent, SetAppThemeInput};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project_terminal::{
    CloseProjectTerminalInput, CreateProjectTerminalInput, CreateProjectTerminalResult,
    CreateTemporaryProjectTerminalInput, CreateTemporaryProjectTerminalResult,
    DeleteProjectTerminalConfigInput, DeleteProjectTerminalConfigResult, ListProjectTerminalsInput,
    ListProjectTerminalsResult, ReadProjectTerminalInput, ReadProjectTerminalResult,
    ResizeProjectTerminalInput, RestoreProjectTerminalInput, RestoreProjectTerminalResult,
    SubscribeProjectTerminalOutputInput, UpdateProjectTerminalConfigInput,
    UpdateProjectTerminalConfigResult, WriteProjectTerminalInput,
};
use crate::types::project_terminal_shortcut_command::{
    DeleteProjectTerminalShortcutCommandInput, ListProjectTerminalShortcutCommandsInput,
    ListProjectTerminalShortcutCommandsResult, ProjectTerminalShortcutCommandRecord,
    ReadProjectTerminalCwdInput, ReadProjectTerminalCwdResult,
    SaveProjectTerminalShortcutCommandInput,
};

#[tauri::command]
pub fn create_project_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CreateProjectTerminalInput,
) -> Result<CreateProjectTerminalResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::create_terminal_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn create_temporary_project_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CreateTemporaryProjectTerminalInput,
) -> Result<CreateTemporaryProjectTerminalResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::create_temporary_terminal_for_agent_session_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

/// 全局主题偏好变更事件（跨窗 UI 同步）。
pub const APP_THEME_PREFERENCE_CHANGED_EVENT: &str = "app-theme-preference-changed";

/// 同步应用主题偏好与已解析终端背景主题：
/// - 更新 `PtySessionManager` 中的已解析主题（供后续 spawn 的 `COLORFGBG` / OSC 应答）
/// - 对已运行的 Agent TUI PTY 尽力推送 OSC 10/11/12 颜色报告
///   （项目终端交互 shell 不推送，避免命令行乱码；写失败不阻断本 command）
/// - 广播偏好变更事件，供各窗 `I18nProvider` 同步 UI 与 Settings 选中态
#[tauri::command]
pub fn set_app_theme(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SetAppThemeInput,
) -> Result<(), CommandError> {
    let event = apply_set_app_theme(&state.pty_sessions, &input);
    emit_app_theme_preference_changed(&app, &event);
    Ok(())
}

/// 应用主题写入核心：更新 PTY 主题状态并构造跨窗事件载荷（可单测）。
pub(crate) fn apply_set_app_theme(
    pty_sessions: &crate::agent::pty_session_manager::PtySessionManager,
    input: &SetAppThemeInput,
) -> AppThemePreferenceChangedEvent {
    pty_sessions.set_theme(input.theme);
    AppThemePreferenceChangedEvent {
        theme_preference: input.theme_preference,
    }
}

fn emit_app_theme_preference_changed(
    app: &tauri::AppHandle,
    event: &AppThemePreferenceChangedEvent,
) {
    let _ = app.emit(APP_THEME_PREFERENCE_CHANGED_EVENT, event);
}

#[tauri::command]
pub fn read_project_terminal(
    state: State<'_, AppState>,
    input: ReadProjectTerminalInput,
) -> Result<ReadProjectTerminalResult, CommandError> {
    ProjectTerminalService::read_terminal_snapshot(
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn list_project_terminals(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ListProjectTerminalsInput,
) -> Result<ListProjectTerminalsResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::list_project_terminals_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn write_project_terminal(
    state: State<'_, AppState>,
    input: WriteProjectTerminalInput,
) -> Result<(), CommandError> {
    // 热路径：禁止 prepare_data_dir / open SQLite（每个按键一次）。
    ProjectTerminalService::write_terminal_input(
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn restore_project_terminal(
    state: State<'_, AppState>,
    input: RestoreProjectTerminalInput,
) -> Result<RestoreProjectTerminalResult, CommandError> {
    ProjectTerminalService::restore_terminal(
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn subscribe_project_terminal_output(
    state: State<'_, AppState>,
    input: SubscribeProjectTerminalOutputInput,
) -> Result<(), CommandError> {
    ProjectTerminalService::subscribe_terminal_output(
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn unsubscribe_project_terminal_output(
    state: State<'_, AppState>,
    input: SubscribeProjectTerminalOutputInput,
) -> Result<(), CommandError> {
    ProjectTerminalService::unsubscribe_terminal_output(
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn resize_project_terminal(
    state: State<'_, AppState>,
    input: ResizeProjectTerminalInput,
) -> Result<(), CommandError> {
    // 热路径：FitAddon 频繁触发，禁止 open SQLite。
    ProjectTerminalService::resize_terminal(
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn close_project_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CloseProjectTerminalInput,
) -> Result<(), CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::close_terminal_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn update_project_terminal_config(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: UpdateProjectTerminalConfigInput,
) -> Result<UpdateProjectTerminalConfigResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::update_project_terminal_config_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn delete_project_terminal_config(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DeleteProjectTerminalConfigInput,
) -> Result<DeleteProjectTerminalConfigResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::delete_project_terminal_config_in_data_dir(
        data_dir,
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn list_project_terminal_shortcut_commands(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ListProjectTerminalShortcutCommandsInput,
) -> Result<ListProjectTerminalShortcutCommandsResult, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::list_shortcut_commands_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn save_project_terminal_shortcut_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SaveProjectTerminalShortcutCommandInput,
) -> Result<ProjectTerminalShortcutCommandRecord, CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::save_shortcut_command_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn delete_project_terminal_shortcut_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DeleteProjectTerminalShortcutCommandInput,
) -> Result<(), CommandError> {
    let data_dir = prepare_project_terminal_data_dir(&app, &state)?;
    ProjectTerminalService::delete_shortcut_command_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn read_project_terminal_cwd(
    state: State<'_, AppState>,
    input: ReadProjectTerminalCwdInput,
) -> Result<ReadProjectTerminalCwdResult, CommandError> {
    ProjectTerminalService::read_terminal_cwd(
        input,
        &state.project_terminals,
        &state.pty_sessions,
    )
}

fn prepare_project_terminal_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<std::path::PathBuf, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::ProjectTerminalPersistenceFailed,
            "Project Terminal 保存失败。",
        ).with_reason("saveFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::ProjectTerminalPersistenceFailed,
                "Project Terminal 保存失败。",
            ).with_reason("saveFailed")
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}


#[cfg(test)]
mod set_app_theme_tests {
    use super::apply_set_app_theme;
    use crate::agent::pty_session_manager::PtySessionManager;
    use crate::types::app_theme::{
        SetAppThemeInput, TerminalBackgroundTheme, ThemePreference,
    };

    #[test]
    fn apply_set_app_theme_stores_resolved_theme_and_returns_preference_event() {
        let manager = PtySessionManager::new();
        let input = SetAppThemeInput {
            theme_preference: ThemePreference::System,
            theme: TerminalBackgroundTheme::Light,
        };

        let event = apply_set_app_theme(&manager, &input);

        assert_eq!(event.theme_preference, ThemePreference::System);
        assert_eq!(
            manager.theme_for_test(),
            TerminalBackgroundTheme::Light
        );
    }

    #[test]
    fn apply_set_app_theme_preserves_dark_preference_with_dark_resolved_theme() {
        let manager = PtySessionManager::new();
        let input = SetAppThemeInput {
            theme_preference: ThemePreference::Dark,
            theme: TerminalBackgroundTheme::Dark,
        };

        let event = apply_set_app_theme(&manager, &input);

        assert_eq!(event.theme_preference, ThemePreference::Dark);
        assert_eq!(manager.theme_for_test(), TerminalBackgroundTheme::Dark);
    }

    #[test]
    fn apply_set_app_theme_succeeds_with_no_live_sessions() {
        let manager = PtySessionManager::new();
        let input = SetAppThemeInput {
            theme_preference: ThemePreference::Light,
            theme: TerminalBackgroundTheme::Light,
        };
        let event = apply_set_app_theme(&manager, &input);
        assert_eq!(event.theme_preference, ThemePreference::Light);
        assert_eq!(manager.theme_for_test(), TerminalBackgroundTheme::Light);
    }

    #[test]
    fn apply_set_app_theme_pushes_osc_to_live_sessions_best_effort() {
        use crate::agent::pty_osc_color_reply::format_theme_osc_color_reports;

        let manager = PtySessionManager::new();
        let buf = manager.insert_capturing_session_for_test(42);
        manager.insert_failing_session_for_test(43);

        let input = SetAppThemeInput {
            theme_preference: ThemePreference::System,
            theme: TerminalBackgroundTheme::Light,
        };
        let event = apply_set_app_theme(&manager, &input);

        assert_eq!(event.theme_preference, ThemePreference::System);
        assert_eq!(manager.theme_for_test(), TerminalBackgroundTheme::Light);
        assert_eq!(
            buf.lock().expect("buf").as_slice(),
            format_theme_osc_color_reports(TerminalBackgroundTheme::Light).as_slice()
        );

        let _ = manager.kill(42);
        let _ = manager.kill(43);
    }
}
