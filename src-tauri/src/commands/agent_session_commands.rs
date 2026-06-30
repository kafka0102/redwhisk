use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::agent::codex_app_server::session::default_codex_models;
use crate::agent::codex_config;
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::app_state::AppState;
use crate::core::agent_session_service::AgentSessionService;
use crate::core::issue_service::{analyze_attachment, sanitize_attachment_file_name};
use crate::types::agent_session::{
    AgentPermissionDecision, AgentSessionListResponse, CancelAgentTurnInput,
    DeleteAgentSessionInput, DeleteAgentSessionResult, InjectAgentSessionPromptInput,
    InjectAgentSessionPromptResult, ListAgentModelsInput, ListAgentModelsResult,
    ListAgentModesInput, ListAgentModesResult, ProjectGitBranchListInput,
    ProjectGitBranchListResult, ReadAgentSessionTerminalInput, ReadAgentSessionTerminalResult,
    ReadAgentTimelineInput, ReadAgentTimelineResult, ResizeAgentSessionTerminalInput,
    RespondAgentPermissionInput, RestoreAgentSessionTerminalInput,
    RestoreAgentSessionTerminalResult, ResumeStructuredAgentSessionInput,
    ResumeStructuredAgentSessionResult, SaveAgentAttachmentInput, SaveAgentAttachmentResult,
    SendAgentMessageInput, SetAgentModeInput, SetAgentModelInput, SetAgentSessionAttentionInput,
    SetAgentSessionAttentionResult, SetAgentThinkingInput, StartAgentSessionInput,
    StartAgentSessionResult, StartStandaloneAgentSessionInput, StartStandaloneAgentSessionResult,
    StartStructuredAgentSessionInput, StartStructuredAgentSessionResult,
    UpdateAgentSessionTitleInput, UpdateAgentSessionTitleResult, WriteAgentSessionTerminalInput,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

const AGENT_SESSION_LIST_CHANGED_EVENT: &str = "agent-session-list-changed";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionListChangedPayload {
    project_id: i64,
    session_id: Option<i64>,
    reason: &'static str,
}

#[tauri::command]
pub fn list_agent_sessions(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<AgentSessionListResponse, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 查询失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 查询失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    let result = AgentSessionService::list_agent_sessions_in_data_dir(
        data_dir,
        project_id,
        &state.pty_sessions,
        &state.agent_sessions,
    )?;
    shutdown_runtime_sessions(&state, &result.pruned_runtime_session_ids);
    Ok(result.response)
}

#[tauri::command]
pub fn start_agent_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: StartAgentSessionInput,
) -> Result<StartAgentSessionResult, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 启动失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 启动失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    let database = crate::db::connection::DatabaseConfig::new(&data_dir)
        .open()
        .map_err(CommandError::from)?;
    crate::db::migrations::MigrationRunner::default()
        .run(&database.connection)
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 启动失败。",
            )
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

    AgentSessionService::new(
        crate::db::issue_repository::IssueRepository::new(&database.connection),
        crate::db::project_repository::ProjectRepository::new(&database.connection),
        crate::db::agent_profile_repository::AgentProfileRepository::new(&database.connection),
        crate::db::agent_session_repository::AgentSessionRepository::new(&database.connection),
    )
    .start_agent_session_with_runtime(
        data_dir,
        input,
        &state.pty_sessions,
        &state.agent_sessions,
        &state.agent_event_broadcaster,
    )
}

#[tauri::command]
pub fn get_project_git_branches(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectGitBranchListInput,
) -> Result<ProjectGitBranchListResult, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Git 分支查询失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Git 分支查询失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    AgentSessionService::get_project_git_branches_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn start_standalone_agent_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: StartStandaloneAgentSessionInput,
) -> Result<StartStandaloneAgentSessionResult, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 启动失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 启动失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    let database = crate::db::connection::DatabaseConfig::new(&data_dir)
        .open()
        .map_err(CommandError::from)?;
    crate::db::migrations::MigrationRunner::default()
        .run(&database.connection)
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 启动失败。",
            )
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

    AgentSessionService::new(
        crate::db::issue_repository::IssueRepository::new(&database.connection),
        crate::db::project_repository::ProjectRepository::new(&database.connection),
        crate::db::agent_profile_repository::AgentProfileRepository::new(&database.connection),
        crate::db::agent_session_repository::AgentSessionRepository::new(&database.connection),
    )
    .start_standalone_agent_session_with_pty(data_dir, input, &state.pty_sessions)
}

#[tauri::command]
pub fn read_agent_session_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ReadAgentSessionTerminalInput,
) -> Result<ReadAgentSessionTerminalResult, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 终端读取失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    AgentSessionService::read_terminal_snapshot_in_data_dir(
        data_dir,
        input.project_id,
        input.session_id,
        input.max_bytes.unwrap_or(32_768),
        &state.pty_sessions,
    )
}

#[tauri::command]
pub fn write_agent_session_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: WriteAgentSessionTerminalInput,
) -> Result<(), CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 终端写入失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    AgentSessionService::write_terminal_input_in_data_dir(data_dir, input, &state.pty_sessions)
}

#[tauri::command]
pub fn restore_agent_session_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: RestoreAgentSessionTerminalInput,
) -> Result<RestoreAgentSessionTerminalResult, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 终端恢复失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    AgentSessionService::restore_terminal_in_data_dir(data_dir, input, &state.pty_sessions)
}

#[tauri::command]
pub fn set_agent_session_attention(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SetAgentSessionAttentionInput,
) -> Result<SetAgentSessionAttentionResult, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 关注状态更新失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 关注状态更新失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    AgentSessionService::set_session_attention_in_data_dir(data_dir, input)
}

#[tauri::command]
pub fn inject_agent_session_prompt(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: InjectAgentSessionPromptInput,
) -> Result<InjectAgentSessionPromptResult, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session prompt 注入失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    AgentSessionService::inject_session_prompt_in_data_dir(data_dir, input, &state.pty_sessions)
}

#[tauri::command]
pub fn resize_agent_session_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ResizeAgentSessionTerminalInput,
) -> Result<(), CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 终端调整失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    AgentSessionService::resize_terminal_in_data_dir(data_dir, input, &state.pty_sessions)
}

// ---------------------------------------------------------------------------
// 结构化 Agent Session（codex app-server JSON-RPC 路径）命令
//
// 与上面的 PTY 命令并存。这些命令通过 `AppState.agent_sessions` 取回
// 运行中的 `CodexSessionHandle`，调用其方法驱动结构化事件流。
//
// 数据库打开沿用现有 PTY 命令范式（参见 `start_agent_session`）：每个命令
// 内联开库 + 跑迁移 + 构造 service，确保 service 的 `'connection` 借用
// 绑定到命令栈上的 `database`。
// ---------------------------------------------------------------------------

/// 从 registry 取回句柄；未注册时返回 `AgentSessionNotRunning`。
fn require_structured_handle(
    state: &State<'_, AppState>,
    session_id: i64,
) -> Result<Arc<dyn AgentSessionHandle>, CommandError> {
    state.agent_sessions.get(session_id).ok_or_else(|| {
        CommandError::new(
            CommandErrorCode::AgentSessionNotRunning,
            "当前 Session 没有运行中的结构化会话。",
        )
        .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id))
    })
}

/// 打开 agent session 数据库并跑迁移。返回的 `Database` 由调用方持有，
/// 供 `build_agent_session_service` 借用。
fn open_agent_session_database(
    app: &tauri::AppHandle,
) -> Result<crate::db::connection::Database, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 数据目录不可用。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    let database = crate::db::connection::DatabaseConfig::new(&data_dir)
        .open()
        .map_err(CommandError::from)?;
    crate::db::migrations::MigrationRunner::default()
        .run(&database.connection)
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 数据库迁移失败。",
            )
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
    Ok(database)
}

/// 基于已打开的连接构造 `AgentSessionService`。
fn build_agent_session_service(connection: &rusqlite::Connection) -> AgentSessionService<'_> {
    AgentSessionService::new(
        crate::db::issue_repository::IssueRepository::new(connection),
        crate::db::project_repository::ProjectRepository::new(connection),
        crate::db::agent_profile_repository::AgentProfileRepository::new(connection),
        crate::db::agent_session_repository::AgentSessionRepository::new(connection),
    )
}

fn shutdown_runtime_sessions(state: &State<'_, AppState>, session_ids: &[i64]) {
    for session_id in session_ids {
        if state.pty_sessions.contains(*session_id) {
            let _ = state.pty_sessions.kill(*session_id);
        }
        if let Some(handle) = state.agent_sessions.unregister(*session_id) {
            handle.shutdown();
        }
    }
}

fn emit_agent_session_list_changed(
    app: &tauri::AppHandle,
    project_id: i64,
    session_id: Option<i64>,
    reason: &'static str,
) {
    let _ = app.emit(
        AGENT_SESSION_LIST_CHANGED_EVENT,
        AgentSessionListChangedPayload {
            project_id,
            session_id,
            reason,
        },
    );
}

#[tauri::command]
pub fn start_structured_agent_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: StartStructuredAgentSessionInput,
) -> Result<StartStructuredAgentSessionResult, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 启动失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 启动失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    let project_id = input.project_id;
    let result = AgentSessionService::start_structured_agent_session_in_data_dir(
        data_dir,
        input,
        &state.agent_sessions,
        &state.agent_event_broadcaster,
    )?;
    emit_agent_session_list_changed(&app, project_id, Some(result.session_id), "session_started");
    Ok(result)
}

#[tauri::command]
pub fn resume_structured_agent_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ResumeStructuredAgentSessionInput,
) -> Result<ResumeStructuredAgentSessionResult, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 恢复失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 恢复失败。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    let project_id = input.project_id;
    let result = AgentSessionService::resume_structured_agent_session_in_data_dir(
        data_dir,
        input,
        &state.agent_sessions,
        &state.agent_event_broadcaster,
    )?;
    emit_agent_session_list_changed(&app, project_id, Some(result.session_id), "session_resumed");
    Ok(result)
}

#[tauri::command]
pub fn delete_agent_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DeleteAgentSessionInput,
) -> Result<DeleteAgentSessionResult, CommandError> {
    let database = open_agent_session_database(&app)?;
    let service = build_agent_session_service(&database.connection);
    let result = service.delete_standalone_session(input.project_id, input.session_id)?;

    if let Some(handle) = state.agent_sessions.unregister(input.session_id) {
        handle.shutdown();
    }
    emit_agent_session_list_changed(
        &app,
        input.project_id,
        Some(input.session_id),
        "session_deleted",
    );

    Ok(result)
}

#[tauri::command]
pub fn update_agent_session_title(
    app: tauri::AppHandle,
    input: UpdateAgentSessionTitleInput,
) -> Result<UpdateAgentSessionTitleResult, CommandError> {
    let database = open_agent_session_database(&app)?;
    let service = build_agent_session_service(&database.connection);
    let project_id = input.project_id;
    let session_id = input.session_id;
    let result = service.update_standalone_session_title(input)?;
    emit_agent_session_list_changed(&app, project_id, Some(session_id), "session_updated");
    Ok(result)
}

#[tauri::command]
pub fn send_agent_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SendAgentMessageInput,
) -> Result<(), CommandError> {
    let database = open_agent_session_database(&app)?;
    let service = build_agent_session_service(&database.connection);
    service.find_project_session_record(input.project_id, input.session_id)?;
    let handle = require_structured_handle(&state, input.session_id)?;
    handle
        .send_message(input.message, input.attachments)
        .map_err(crate::core::agent_session_service::agent_session_error_to_command_error)
}

#[tauri::command]
pub fn cancel_agent_turn(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CancelAgentTurnInput,
) -> Result<(), CommandError> {
    let database = open_agent_session_database(&app)?;
    let service = build_agent_session_service(&database.connection);
    service.find_project_session_record(input.project_id, input.session_id)?;
    let Some(handle) = state.agent_sessions.get(input.session_id) else {
        return Ok(());
    };

    match handle.cancel_turn() {
        Ok(()) => Ok(()),
        Err(AgentSessionError::NotRunning(_)) => {
            state.agent_sessions.unregister(input.session_id);
            Ok(())
        }
        Err(error) => {
            Err(crate::core::agent_session_service::agent_session_error_to_command_error(error))
        }
    }
}

#[tauri::command]
pub fn respond_agent_permission(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: RespondAgentPermissionInput,
) -> Result<(), CommandError> {
    let database = open_agent_session_database(&app)?;
    let service = build_agent_session_service(&database.connection);
    service.find_project_session_record(input.project_id, input.session_id)?;
    let handle = require_structured_handle(&state, input.session_id)?;
    let decision = AgentPermissionDecision::from_str_literal(&input.decision).ok_or_else(|| {
        CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "不支持的权限决策。",
        )
        .with_detail(ErrorDetail::new("Field").with_value("name", "decision"))
        .with_detail(ErrorDetail::new("Value").with_value("decision", input.decision.clone()))
    })?;
    handle
        .respond_permission(&input.request_id, decision)
        .map_err(crate::core::agent_session_service::agent_session_error_to_command_error)
}

#[tauri::command]
pub fn set_agent_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SetAgentModelInput,
) -> Result<(), CommandError> {
    let database = open_agent_session_database(&app)?;
    let service = build_agent_session_service(&database.connection);
    service.find_project_session_record(input.project_id, input.session_id)?;
    let handle = require_structured_handle(&state, input.session_id)?;
    handle
        .set_model(input.model_id)
        .map_err(crate::core::agent_session_service::agent_session_error_to_command_error)
}

#[tauri::command]
pub fn set_agent_thinking(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SetAgentThinkingInput,
) -> Result<(), CommandError> {
    let database = open_agent_session_database(&app)?;
    let service = build_agent_session_service(&database.connection);
    service.find_project_session_record(input.project_id, input.session_id)?;
    let handle = require_structured_handle(&state, input.session_id)?;
    if let Some(effort) = input.effort.as_deref() {
        let home_dir = app.path().home_dir().map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent 配置保存失败。",
            )
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
        codex_config::write_reasoning_effort_to_home(&home_dir, effort).map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent 配置保存失败。",
            )
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
    }
    handle
        .set_effort(input.effort)
        .map_err(crate::core::agent_session_service::agent_session_error_to_command_error)
}

#[tauri::command]
pub fn set_agent_mode(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SetAgentModeInput,
) -> Result<(), CommandError> {
    let database = open_agent_session_database(&app)?;
    let service = build_agent_session_service(&database.connection);
    service.find_project_session_record(input.project_id, input.session_id)?;
    let handle = require_structured_handle(&state, input.session_id)?;
    handle
        .set_mode(&input.mode_id)
        .map_err(crate::core::agent_session_service::agent_session_error_to_command_error)
}

#[tauri::command]
pub fn list_agent_models(
    app: tauri::AppHandle,
    input: ListAgentModelsInput,
) -> Result<ListAgentModelsResult, CommandError> {
    let database = open_agent_session_database(&app)?;
    let service = build_agent_session_service(&database.connection);
    service.find_project_session_record(input.project_id, input.session_id)?;
    Ok(ListAgentModelsResult {
        models: default_codex_models(),
    })
}

#[tauri::command]
pub fn list_agent_modes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ListAgentModesInput,
) -> Result<ListAgentModesResult, CommandError> {
    let database = open_agent_session_database(&app)?;
    let service = build_agent_session_service(&database.connection);
    service.find_project_session_record(input.project_id, input.session_id)?;
    let handle = require_structured_handle(&state, input.session_id)?;
    Ok(ListAgentModesResult {
        modes: handle.list_modes(),
    })
}

#[tauri::command]
pub fn save_agent_attachment(
    app: tauri::AppHandle,
    input: SaveAgentAttachmentInput,
) -> Result<SaveAgentAttachmentResult, CommandError> {
    let database = open_agent_session_database(&app)?;
    let service = build_agent_session_service(&database.connection);
    // 归属校验（不依赖句柄，session 行存在即可）。
    service.find_project_session_record(input.project_id, input.session_id)?;

    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "附件保存失败：数据目录不可用。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    let sanitized = sanitize_attachment_file_name(&input.display_name);
    let analysis = analyze_attachment(&input.display_name, None);
    let attachment_dir: PathBuf = data_dir
        .join("agent-attachments")
        .join(input.session_id.to_string());
    fs::create_dir_all(&attachment_dir).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "附件目录创建失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;
    let dest = attachment_dir.join(&sanitized);
    fs::copy(&input.source_path, &dest).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "附件复制失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        .with_detail(ErrorDetail::new("Source").with_value("path", input.source_path.clone()))
    })?;

    Ok(SaveAgentAttachmentResult {
        path: dest.to_string_lossy().to_string(),
        display_name: sanitized,
        kind: analysis.kind.into(),
    })
}

#[tauri::command]
pub async fn read_agent_timeline(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ReadAgentTimelineInput,
) -> Result<ReadAgentTimelineResult, CommandError> {
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let database = open_agent_session_database(&app)?;
        let service = build_agent_session_service(&database.connection);
        service.read_agent_timeline(
            input.project_id,
            input.session_id,
            agent_sessions.get(input.session_id),
        )
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 历史读取失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}
