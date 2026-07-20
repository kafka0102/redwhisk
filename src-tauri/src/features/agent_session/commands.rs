use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::agent::descriptor_for;
use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::agent::session_registry::AgentSessionRegistry;
use crate::app_state::AppState;
use super::service::AgentSessionService;
use crate::features::issue::{analyze_attachment, sanitize_attachment_file_name};
use crate::logging::CommandResultExt;
use crate::types::agent_profile::AgentType;
use crate::types::agent_session::{
    AgentPermissionDecision, AgentSessionListResponse, AgentSessionStatus, CancelAgentTurnInput,
    DeleteAgentSessionInput, DeleteAgentSessionResult, InjectAgentSessionPromptInput,
    InjectAgentSessionPromptResult, ListAgentModelsInput, ListAgentModelsResult,
    ListAgentModesInput, ListAgentModesResult, ProjectGitBranchListInput,
    ProjectGitBranchListResult, ReadAgentTimelineInput, ReadAgentTimelineResult,
    RespondAgentPermissionInput, ResumeStructuredAgentSessionInput,
    ResumeStructuredAgentSessionResult, SaveAgentAttachmentInput, SaveAgentAttachmentResult,
    SendAgentMessageInput, SetAgentModeInput, SetAgentModelInput, SetAgentSessionAttentionInput,
    SetAgentSessionAttentionResult, SetAgentThinkingInput, StartAgentSessionInput,
    StartAgentSessionResult, StartStructuredAgentSessionInput, StartStructuredAgentSessionResult,
    UpdateAgentSessionTitleInput, UpdateAgentSessionTitleResult,
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
    status: Option<AgentSessionStatus>,
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
        let mut response = result.response;
        // 变更页 running 检测只关心 running session：按 status 过滤，避免每 5s 把全部
        //（含已结束）会话序列化回前端。其余调用方不传 status，仍取全量。
        if let Some(status) = status {
            response.sessions.retain(|session| session.status == status);
        }
        Ok(response)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 查询失败。",
        )
        .with_reason("queryFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("list_agent_sessions")
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
    let project_id = input.project_id;
    let event_data_dir = data_dir.clone();
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
                .with_reason("startFailed")
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            })?;

        let result = AgentSessionService::new(
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
        )?;
        crate::features::agent_session::workspace_commands::emit_code_workspace_roots_updated(
            &app,
            &event_data_dir,
            project_id,
        );
        Ok(result)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 启动失败。",
        )
        .with_reason("startFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("start_agent_session")
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
        .with_reason("gitBranchQueryFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("get_project_git_branches")
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
        .with_reason("followStatusUpdateFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("set_agent_session_attention")
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
        .with_reason("promptInjectFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;
    let pty_sessions = state.pty_sessions.clone();
    let agent_sessions = state.agent_sessions.clone();
    let project_id = input.project_id;
    tauri::async_runtime::spawn_blocking(move || {
        let result = AgentSessionService::inject_session_prompt_in_data_dir(
            data_dir,
            input,
            &pty_sessions,
            &agent_sessions,
        )?;
        // 注入成功后 attention 已清除。结构化 session 还会经 TurnStarted 触发刷新，
        // 但 PTY session 没有 turn 事件，这里统一广播，保证前端拿到最新状态
        // （尤其 attention 由 requested 回落 none）。
        emit_agent_session_list_changed(
            &app,
            project_id,
            Some(result.session_id),
            "session_prompt_injected",
        );
        Ok(result)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session prompt 注入失败。",
        )
        .with_reason("promptInjectFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("inject_agent_session_prompt")
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
        .with_reason("noStructuredSession")
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
        .with_reason("dataDirUnavailable")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 数据目录不可用。",
            )
            .with_reason("dataDirUnavailable")
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    Ok(data_dir)
}

/// 打开 agent session 数据库并跑迁移。返回的 `Database` 由调用方持有，
/// 供 `build_agent_session_service` 借用。
pub(crate) fn open_agent_session_database(
    app: &tauri::AppHandle,
) -> Result<crate::db::connection::Database, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 数据目录不可用。",
        )
        .with_reason("dataDirUnavailable")
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
            .with_reason("migrationFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
    Ok(database)
}

/// 基于已打开的连接构造 `AgentSessionService`。
pub(crate) fn build_agent_session_service(connection: &rusqlite::Connection) -> AgentSessionService<'_> {
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
    let event_data_dir = data_dir.clone();
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
        crate::features::agent_session::workspace_commands::emit_code_workspace_roots_updated(
            &app,
            &event_data_dir,
            project_id,
        );
        Ok(result)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 启动失败。",
        )
        .with_reason("startFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("start_structured_agent_session")
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
    let event_data_dir = data_dir.clone();
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
        crate::features::agent_session::workspace_commands::emit_code_workspace_roots_updated(
            &app,
            &event_data_dir,
            project_id,
        );
        Ok(result)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 恢复失败。",
        )
        .with_reason("restoreFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("resume_structured_agent_session")
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
        .with_reason("deleteFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("delete_agent_session")
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
        .with_reason("titleUpdateFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("update_agent_session_title")
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
        // 标记 follow_up turn 来源：覆盖前一个 turn 的 source，避免前一 turn 为 completion
        // 时，follow_up turn 完成误触发评论提取（提取仅在 source=='completion' 且 turn_id
        // 配对时触发）。写入失败不阻断消息发送（评论提取是旁路）。
        let _ = service.record_follow_up_turn_source(input.session_id);
        handle
            .send_message(input.message, input.attachments)
            .map_err(super::service::agent_session_error_to_command_error)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 消息发送失败。",
        )
        .with_reason("messageSendFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("send_agent_message")
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
                Err(super::service::agent_session_error_to_command_error(error))
            }
        }
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 取消失败。",
        )
        .with_reason("cancelFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("cancel_agent_turn")
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
                .with_reason("unsupportedPermissionDecision")
                .with_detail(ErrorDetail::new("Field").with_value("name", "decision"))
                .with_detail(
                    ErrorDetail::new("Value").with_value("decision", input.decision.clone()),
                )
            })?;
        handle
            .respond_permission(&input.request_id, decision)
            .map_err(super::service::agent_session_error_to_command_error)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 权限响应失败。",
        )
        .with_reason("permissionResponseFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("respond_agent_permission")
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
        service.find_project_session_record(input.project_id, input.session_id)?;
        let handle = require_structured_handle(&agent_sessions, input.session_id)?;
        // 模型写盘由 handle adapter 内部完成（ADR-0011）。
        handle
            .set_model(input.model_id)
            .map_err(super::service::agent_session_error_to_command_error)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 配置保存失败。",
        )
        .with_reason("configSaveFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("set_agent_model")
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
        // effort 写盘由 handle adapter 内部完成（ADR-0011）；Claude 仍返回不支持。
        handle
            .set_effort(input.effort)
            .map_err(super::service::agent_session_error_to_command_error)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 配置保存失败。",
        )
        .with_reason("configSaveFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("set_agent_thinking")
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
            .map_err(super::service::agent_session_error_to_command_error)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent 模式切换失败。",
        )
        .with_reason("modeSwitchFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("set_agent_mode")
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
        let descriptor = descriptor_for(&agent_type);
        let home_dir = app.path().home_dir().map_err(|error| {
            let (reason, message) = match descriptor.agent_type() {
                AgentType::Codex => ("codexConfigReadFailed", "读取 Codex 配置失败。"),
                AgentType::Claude => ("claudeConfigReadFailed", "读取 Claude 配置失败。"),
                AgentType::OpenCode => ("opencodeConfigReadFailed", "读取 OpenCode 配置失败。"),
                AgentType::Grok => ("grokConfigReadFailed", "读取 Grok 配置失败。"),
            };
            CommandError::new(CommandErrorCode::AgentSessionPersistenceFailed, message)
                .with_reason(reason)
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
        let models = descriptor.list_models(&home_dir);
        // 第三方接口（Claude 配置了 base_url / auth_token）不允许切换，前端展示只读标签。
        let is_read_only = descriptor.is_model_list_read_only(&home_dir);
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
        .with_reason("modelListReadFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("list_agent_models")
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
        .with_reason("modeListReadFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("list_agent_modes")
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
            .with_reason("attachmentDataDirUnavailable")
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
            .with_reason("attachmentDirCreateFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
        let dest = attachment_dir.join(&sanitized);
        fs::copy(&input.source_path, &dest).map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "附件复制失败。",
            )
            .with_reason("attachmentCopyFailed")
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
        .with_reason("attachmentSaveFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("save_agent_attachment")
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
        .with_reason("historyReadFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?
    .log_if_error("read_agent_timeline")
}
