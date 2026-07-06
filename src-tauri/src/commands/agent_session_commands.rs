use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::agent::claude_config;
use crate::agent::codex_app_server::session::default_codex_models_with_selected;
use crate::agent::codex_config;
use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::agent::session_registry::AgentSessionRegistry;
use crate::app_state::AppState;
use crate::core::agent_session_service::AgentSessionService;
use crate::core::issue_service::{analyze_attachment, sanitize_attachment_file_name};
use crate::types::agent_profile::AgentType;
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
pub async fn list_agent_sessions(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<AgentSessionListResponse, CommandError> {
    let data_dir = prepare_agent_session_data_dir(&app, &state)?;
    let pty_sessions = state.pty_sessions.clone();
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = AgentSessionService::list_agent_sessions_in_data_dir(
            data_dir,
            project_id,
            &pty_sessions,
            &agent_sessions,
        )?;
        shutdown_runtime_sessions(
            &pty_sessions,
            &agent_sessions,
            &result.pruned_runtime_session_ids,
        );
        Ok(result.response)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 查询失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn start_agent_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: StartAgentSessionInput,
) -> Result<StartAgentSessionResult, CommandError> {
    let data_dir = prepare_agent_session_data_dir(&app, &state)?;
    let pty_sessions = state.pty_sessions.clone();
    let agent_sessions = state.agent_sessions.clone();
    let agent_event_broadcaster = state.agent_event_broadcaster.clone();
    tauri::async_runtime::spawn_blocking(move || {
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
            &pty_sessions,
            &agent_sessions,
            &agent_event_broadcaster,
        )
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 启动失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn get_project_git_branches(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectGitBranchListInput,
) -> Result<ProjectGitBranchListResult, CommandError> {
    let data_dir = prepare_agent_session_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        AgentSessionService::get_project_git_branches_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Git 分支查询失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn start_standalone_agent_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: StartStandaloneAgentSessionInput,
) -> Result<StartStandaloneAgentSessionResult, CommandError> {
    let data_dir = prepare_agent_session_data_dir(&app, &state)?;
    let pty_sessions = state.pty_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
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
        .start_standalone_agent_session_with_pty(data_dir, input, &pty_sessions)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 启动失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn read_agent_session_terminal(
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
    let pty_sessions = state.pty_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        AgentSessionService::read_terminal_snapshot_in_data_dir(
            data_dir,
            input.project_id,
            input.session_id,
            input.max_bytes.unwrap_or(32_768),
            &pty_sessions,
        )
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 终端读取失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn write_agent_session_terminal(
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
    let pty_sessions = state.pty_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        AgentSessionService::write_terminal_input_in_data_dir(data_dir, input, &pty_sessions)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 终端写入失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn restore_agent_session_terminal(
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
    let pty_sessions = state.pty_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        AgentSessionService::restore_terminal_in_data_dir(data_dir, input, &pty_sessions)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 终端恢复失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn set_agent_session_attention(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SetAgentSessionAttentionInput,
) -> Result<SetAgentSessionAttentionResult, CommandError> {
    let data_dir = prepare_agent_session_data_dir(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        AgentSessionService::set_session_attention_in_data_dir(data_dir, input)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 关注状态更新失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn inject_agent_session_prompt(
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
    let pty_sessions = state.pty_sessions.clone();
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        AgentSessionService::inject_session_prompt_in_data_dir(
            data_dir,
            input,
            &pty_sessions,
            &agent_sessions,
        )
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session prompt 注入失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn resize_agent_session_terminal(
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
    let pty_sessions = state.pty_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        AgentSessionService::resize_terminal_in_data_dir(data_dir, input, &pty_sessions)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 终端调整失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
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
    agent_sessions: &AgentSessionRegistry,
    session_id: i64,
) -> Result<Arc<dyn AgentSessionHandle>, CommandError> {
    agent_sessions.get(session_id).ok_or_else(|| {
        CommandError::new(
            CommandErrorCode::AgentSessionNotRunning,
            "当前 Session 没有运行中的结构化会话。",
        )
        .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id))
    })
}

/// 在 `spawn_blocking` 闭包前调用：解析 data_dir 并完成幂等本地数据初始化。
///
/// 这一步只做轻量的目录解析与迁移幂等检查，不涉及重计算，留在 async command
/// 体内同步执行即可；真正阻塞的 DB / git / spawn 操作应放入 `spawn_blocking`。
fn prepare_agent_session_data_dir(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<std::path::PathBuf, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 数据目录不可用。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 数据目录不可用。",
            )
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
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

fn shutdown_runtime_sessions(
    pty_sessions: &PtySessionManager,
    agent_sessions: &AgentSessionRegistry,
    session_ids: &[i64],
) {
    for session_id in session_ids {
        if pty_sessions.contains(*session_id) {
            let _ = pty_sessions.kill(*session_id);
        }
        if let Some(handle) = agent_sessions.unregister(*session_id) {
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
pub async fn start_structured_agent_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: StartStructuredAgentSessionInput,
) -> Result<StartStructuredAgentSessionResult, CommandError> {
    let data_dir = prepare_agent_session_data_dir(&app, &state)?;
    let agent_sessions = state.agent_sessions.clone();
    let agent_event_broadcaster = state.agent_event_broadcaster.clone();
    let project_id = input.project_id;
    tauri::async_runtime::spawn_blocking(move || {
        let result = AgentSessionService::start_structured_agent_session_in_data_dir(
            data_dir,
            input,
            &agent_sessions,
            &agent_event_broadcaster,
        )?;
        emit_agent_session_list_changed(
            &app,
            project_id,
            Some(result.session_id),
            "session_started",
        );
        Ok(result)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 启动失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn resume_structured_agent_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ResumeStructuredAgentSessionInput,
) -> Result<ResumeStructuredAgentSessionResult, CommandError> {
    let data_dir = prepare_agent_session_data_dir(&app, &state)?;
    let agent_sessions = state.agent_sessions.clone();
    let agent_event_broadcaster = state.agent_event_broadcaster.clone();
    let project_id = input.project_id;
    tauri::async_runtime::spawn_blocking(move || {
        let result = AgentSessionService::resume_structured_agent_session_in_data_dir(
            data_dir,
            input,
            &agent_sessions,
            &agent_event_broadcaster,
        )?;
        emit_agent_session_list_changed(
            &app,
            project_id,
            Some(result.session_id),
            "session_resumed",
        );
        Ok(result)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 恢复失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn delete_agent_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: DeleteAgentSessionInput,
) -> Result<DeleteAgentSessionResult, CommandError> {
    let agent_sessions = state.agent_sessions.clone();
    let project_id = input.project_id;
    let session_id = input.session_id;
    tauri::async_runtime::spawn_blocking(move || {
        let database = open_agent_session_database(&app)?;
        let service = build_agent_session_service(&database.connection);
        let result = service.delete_standalone_session(input.project_id, input.session_id)?;

        if let Some(handle) = agent_sessions.unregister(input.session_id) {
            handle.shutdown();
        }
        emit_agent_session_list_changed(&app, project_id, Some(session_id), "session_deleted");

        Ok(result)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 删除失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn update_agent_session_title(
    app: tauri::AppHandle,
    input: UpdateAgentSessionTitleInput,
) -> Result<UpdateAgentSessionTitleResult, CommandError> {
    let project_id = input.project_id;
    let session_id = input.session_id;
    tauri::async_runtime::spawn_blocking(move || {
        let database = open_agent_session_database(&app)?;
        let service = build_agent_session_service(&database.connection);
        let result = service.update_standalone_session_title(input)?;
        emit_agent_session_list_changed(&app, project_id, Some(session_id), "session_updated");
        Ok(result)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 标题更新失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn send_agent_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SendAgentMessageInput,
) -> Result<(), CommandError> {
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let database = open_agent_session_database(&app)?;
        let service = build_agent_session_service(&database.connection);
        service.find_project_session_record(input.project_id, input.session_id)?;
        let handle = require_structured_handle(&agent_sessions, input.session_id)?;
        handle
            .send_message(input.message, input.attachments)
            .map_err(crate::core::agent_session_service::agent_session_error_to_command_error)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 消息发送失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn cancel_agent_turn(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CancelAgentTurnInput,
) -> Result<(), CommandError> {
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let database = open_agent_session_database(&app)?;
        let service = build_agent_session_service(&database.connection);
        service.find_project_session_record(input.project_id, input.session_id)?;
        let Some(handle) = agent_sessions.get(input.session_id) else {
            return Ok(());
        };

        match handle.cancel_turn() {
            Ok(()) => Ok(()),
            Err(AgentSessionError::NotRunning(_)) => {
                agent_sessions.unregister(input.session_id);
                Ok(())
            }
            Err(error) => {
                Err(crate::core::agent_session_service::agent_session_error_to_command_error(error))
            }
        }
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 取消失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn respond_agent_permission(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: RespondAgentPermissionInput,
) -> Result<(), CommandError> {
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let database = open_agent_session_database(&app)?;
        let service = build_agent_session_service(&database.connection);
        service.find_project_session_record(input.project_id, input.session_id)?;
        let handle = require_structured_handle(&agent_sessions, input.session_id)?;
        let decision =
            AgentPermissionDecision::from_str_literal(&input.decision).ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::AgentSessionValidationFailed,
                    "不支持的权限决策。",
                )
                .with_detail(ErrorDetail::new("Field").with_value("name", "decision"))
                .with_detail(
                    ErrorDetail::new("Value").with_value("decision", input.decision.clone()),
                )
            })?;
        handle
            .respond_permission(&input.request_id, decision)
            .map_err(crate::core::agent_session_service::agent_session_error_to_command_error)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 权限响应失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn set_agent_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SetAgentModelInput,
) -> Result<(), CommandError> {
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let database = open_agent_session_database(&app)?;
        let service = build_agent_session_service(&database.connection);
        let agent_type = service.find_session_agent_type(input.project_id, input.session_id)?;
        let handle = require_structured_handle(&agent_sessions, input.session_id)?;
        // 把用户切换后的模型持久化回 provider 配置，保证下次 spawn
        // （以及应用重启后）沿用同一模型。
        let home_dir = if matches!(agent_type, AgentType::Claude | AgentType::Codex) {
            Some(app.path().home_dir().map_err(|error| {
                CommandError::new(
                    CommandErrorCode::AgentSessionPersistenceFailed,
                    "Agent 配置保存失败。",
                )
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            })?)
        } else {
            None
        };
        if matches!(agent_type, AgentType::Claude) {
            claude_config::write_model_to_home(
                home_dir
                    .as_deref()
                    .expect("Claude model persistence requires home dir"),
                &input.model_id,
            )
            .map_err(|error| {
                CommandError::new(
                    CommandErrorCode::AgentSessionPersistenceFailed,
                    "Agent 配置保存失败。",
                )
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            })?;
        }
        if matches!(agent_type, AgentType::Codex) {
            codex_config::write_model_to_home(
                home_dir
                    .as_deref()
                    .expect("Codex model persistence requires home dir"),
                &input.model_id,
            )
            .map_err(|error| {
                CommandError::new(
                    CommandErrorCode::AgentSessionPersistenceFailed,
                    "Agent 配置保存失败。",
                )
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            })?;
        }
        handle
            .set_model(input.model_id)
            .map_err(crate::core::agent_session_service::agent_session_error_to_command_error)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 配置保存失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn set_agent_thinking(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SetAgentThinkingInput,
) -> Result<(), CommandError> {
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let database = open_agent_session_database(&app)?;
        let service = build_agent_session_service(&database.connection);
        service.find_project_session_record(input.project_id, input.session_id)?;
        let handle = require_structured_handle(&agent_sessions, input.session_id)?;
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
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 配置保存失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn set_agent_mode(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: SetAgentModeInput,
) -> Result<(), CommandError> {
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let database = open_agent_session_database(&app)?;
        let service = build_agent_session_service(&database.connection);
        service.find_project_session_record(input.project_id, input.session_id)?;
        let handle = require_structured_handle(&agent_sessions, input.session_id)?;
        handle
            .set_mode(&input.mode_id)
            .map_err(crate::core::agent_session_service::agent_session_error_to_command_error)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 模式切换失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn list_agent_models(
    app: tauri::AppHandle,
    input: ListAgentModelsInput,
) -> Result<ListAgentModelsResult, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let database = open_agent_session_database(&app)?;
        let service = build_agent_session_service(&database.connection);
        let agent_type = service.find_session_agent_type(input.project_id, input.session_id)?;
        let models = match agent_type {
            AgentType::Codex => {
                let home_dir = app.path().home_dir().map_err(|error| {
                    CommandError::new(
                        CommandErrorCode::AgentSessionPersistenceFailed,
                        "读取 Codex 配置失败。",
                    )
                    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
                })?;
                default_codex_models_with_selected(
                    codex_config::read_model_from_home(&home_dir).as_deref(),
                )
            }
            AgentType::Claude => {
                let home_dir = app.path().home_dir().map_err(|error| {
                    CommandError::new(
                        CommandErrorCode::AgentSessionPersistenceFailed,
                        "读取 Claude 配置失败。",
                    )
                    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
                })?;
                claude_models_from_home(&home_dir)
            }
        };
        // 第三方接口（Claude 配置了 base_url / auth_token）不允许切换，前端展示只读标签。
        let is_read_only = matches!(agent_type, AgentType::Claude)
            && app
                .path()
                .home_dir()
                .ok()
                .and_then(|home| claude_config::read_settings_from_home(&home))
                .map(|s| claude_config::is_third_party(&s))
                .unwrap_or(false);
        Ok(ListAgentModelsResult {
            models,
            is_read_only: Some(is_read_only),
        })
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 模型列表读取失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

/// 从 `~/.claude/settings.json` 解析 Claude 可用模型列表。
///
/// - 第三方接口（存在 base_url / auth_token）：返回单个只读模型，modelId 取
///   `env.ANTHROPIC_MODEL` 或顶层 `model`，前端展示但不允许切换。
/// - 官方接口：返回 opus / sonnet / haiku 列表，当前 settings.json 的 `model`
///   字段对应项标 `is_default`，允许用户切换并持久化。
fn claude_models_from_home(
    home_dir: &std::path::Path,
) -> Vec<crate::types::agent_session_stream::AgentModel> {
    use crate::types::agent_session_stream::AgentModel;
    let snapshot = match claude_config::read_settings_from_home(home_dir) {
        Some(s) => s,
        None => return Vec::new(),
    };
    if claude_config::is_third_party(&snapshot) {
        // 第三方接口：只读展示当前真实模型（env.ANTHROPIC_MODEL 优先于顶层 model）。
        let current = snapshot.anthropic_model.or(snapshot.model.clone());
        let model_id = current.clone().unwrap_or_else(|| "claude".to_string());
        return vec![AgentModel {
            model_id,
            display_name: current,
            is_default: Some(true),
            default_reasoning_effort: None,
            supported_reasoning_efforts: Vec::new(),
        }];
    }
    // 官方接口：返回 opus / sonnet / haiku，当前 settings.json 的 model 标默认。
    let current = snapshot.model.as_deref();
    claude_config::OFFICIAL_CLAUDE_MODELS
        .iter()
        .map(|(model_id, display_name)| AgentModel {
            model_id: model_id.to_string(),
            display_name: Some(display_name.to_string()),
            // 当前 settings.json 的 model 字段匹配则标默认（兼容 "sonnet[1m]" 等带后缀别名）。
            is_default: Some(current.is_some_and(|c| c == *model_id || c.starts_with(model_id))),
            default_reasoning_effort: None,
            supported_reasoning_efforts: Vec::new(),
        })
        .collect()
}

#[tauri::command]
pub async fn list_agent_modes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ListAgentModesInput,
) -> Result<ListAgentModesResult, CommandError> {
    let agent_sessions = state.agent_sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let database = open_agent_session_database(&app)?;
        let service = build_agent_session_service(&database.connection);
        service.find_project_session_record(input.project_id, input.session_id)?;
        let handle = require_structured_handle(&agent_sessions, input.session_id)?;
        Ok(ListAgentModesResult {
            modes: handle.list_modes(),
        })
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 模式列表读取失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
}

#[tauri::command]
pub async fn save_agent_attachment(
    app: tauri::AppHandle,
    input: SaveAgentAttachmentInput,
) -> Result<SaveAgentAttachmentResult, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "附件保存失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
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
