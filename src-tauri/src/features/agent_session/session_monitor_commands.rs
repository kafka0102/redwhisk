use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

use crate::app_state::AppState;
use super::service::AgentSessionService;
use crate::types::agent_session::AgentSessionListResponse;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

pub const OPEN_AGENT_SESSION_EVENT: &str = "open-agent-session";
const SESSION_MONITOR_HEIGHT: f64 = 44.0;
const SESSION_MONITOR_WIDTH: f64 = 44.0;
const SESSION_MONITOR_WINDOW_LABEL: &str = "session-monitor";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSessionMonitorWindowInput {
    pub owner_window_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSessionMonitorWindowResponse {
    pub window_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseSessionMonitorWindowInput {
    pub owner_window_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseSessionMonitorWindowResponse {
    pub window_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenMonitoredAgentSessionInput {
    pub owner_window_label: String,
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenMonitoredAgentSessionResponse {
    pub emitted: bool,
    pub window_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAgentSessionEventPayload {
    pub project_id: i64,
    pub session_id: i64,
}

#[tauri::command]
pub async fn open_session_monitor_window(
    app: tauri::AppHandle,
    input: OpenSessionMonitorWindowInput,
) -> Result<OpenSessionMonitorWindowResponse, CommandError> {
    let window_label = session_monitor_window_label();

    if let Some(existing_window) = app.get_webview_window(&window_label) {
        existing_window.show().map_err(|error| {
            session_monitor_error(&window_label, "会话监控窗口显示失败。", error.to_string()).with_reason("windowShowFailed")
        })?;

        return Ok(OpenSessionMonitorWindowResponse { window_label });
    }

    let monitor_window = tauri::WebviewWindowBuilder::new(
        &app,
        window_label.clone(),
        tauri::WebviewUrl::App(build_session_monitor_url(&input.owner_window_label).into()),
    )
    .title("RedWhisk Session Monitor")
    .inner_size(SESSION_MONITOR_WIDTH, SESSION_MONITOR_HEIGHT)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false)
    .shadow(false)
    .build()
    .map_err(|error| {
        session_monitor_error(&window_label, "会话监控窗口打开失败。", error.to_string()).with_reason("windowOpenFailed")
    })?;

    let _ = monitor_window.set_visible_on_all_workspaces(true);

    Ok(OpenSessionMonitorWindowResponse { window_label })
}

#[tauri::command]
pub async fn close_session_monitor_window(
    app: tauri::AppHandle,
    _input: CloseSessionMonitorWindowInput,
) -> Result<CloseSessionMonitorWindowResponse, CommandError> {
    let window_label = session_monitor_window_label();

    if let Some(existing_window) = app.get_webview_window(&window_label) {
        existing_window.close().map_err(|error| {
            session_monitor_error(&window_label, "会话监控窗口关闭失败。", error.to_string()).with_reason("windowCloseFailed")
        })?;
    }

    Ok(CloseSessionMonitorWindowResponse { window_label })
}

#[tauri::command]
pub fn list_monitored_agent_sessions(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<AgentSessionListResponse, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionPersistenceFailed,
            "Agent Session 查询失败。",
        ).with_reason("queryFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(
                CommandErrorCode::AgentSessionPersistenceFailed,
                "Agent Session 查询失败。",
            ).with_reason("queryFailed")
        })?;
        local_data
            .initialize(&data_dir)
            .map_err(CommandError::from)?;
    }

    AgentSessionService::list_monitored_agent_sessions_in_data_dir(
        data_dir,
        &state.pty_sessions,
        &state.agent_sessions,
    )
}

#[tauri::command]
pub async fn open_monitored_agent_session(
    app: tauri::AppHandle,
    input: OpenMonitoredAgentSessionInput,
) -> Result<OpenMonitoredAgentSessionResponse, CommandError> {
    let target_window_label = input.owner_window_label;
    let target_window = app
        .get_webview_window(&target_window_label)
        .or_else(|| app.get_webview_window(&format!("project-{}", input.project_id)))
        .or_else(|| app.get_webview_window("main"))
        .ok_or_else(|| {
            session_monitor_error(
                &target_window_label,
                "目标项目窗口不存在。",
                "No target window found".to_string(),
            ).with_reason("targetWindowNotFound")
        })?;
    let emitted_window_label = target_window.label().to_string();

    target_window.unminimize().map_err(|error| {
        session_monitor_error(
            &emitted_window_label,
            "目标项目窗口恢复失败。",
            error.to_string(),
        ).with_reason("targetWindowRestoreFailed")
    })?;
    target_window.show().map_err(|error| {
        session_monitor_error(
            &emitted_window_label,
            "目标项目窗口显示失败。",
            error.to_string(),
        ).with_reason("targetWindowShowFailed")
    })?;
    target_window.set_focus().map_err(|error| {
        session_monitor_error(
            &emitted_window_label,
            "目标项目窗口聚焦失败。",
            error.to_string(),
        ).with_reason("targetWindowFocusFailed")
    })?;
    app.emit_to(
        emitted_window_label.as_str(),
        OPEN_AGENT_SESSION_EVENT,
        monitored_agent_session_payload(input.project_id, input.session_id),
    )
    .map_err(|error| {
        session_monitor_error(
            &emitted_window_label,
            "目标项目窗口事件发送失败。",
            error.to_string(),
        ).with_reason("targetWindowEmitFailed")
    })?;

    Ok(OpenMonitoredAgentSessionResponse {
        emitted: true,
        window_label: emitted_window_label,
    })
}

fn build_session_monitor_url(owner_window_label: &str) -> String {
    format!("index.html?surface=session-monitor&ownerWindowLabel={owner_window_label}")
}

fn monitored_agent_session_payload(
    project_id: i64,
    session_id: i64,
) -> OpenAgentSessionEventPayload {
    OpenAgentSessionEventPayload {
        project_id,
        session_id,
    }
}

fn session_monitor_window_label() -> String {
    SESSION_MONITOR_WINDOW_LABEL.to_string()
}

fn session_monitor_error(window_label: &str, message: &str, cause: String) -> CommandError {
    CommandError::new(CommandErrorCode::ProjectPersistenceFailed, message)
        .with_detail(ErrorDetail::new("Window").with_value("label", window_label.to_string()))
        .with_detail(ErrorDetail::new("Cause").with_value("message", cause))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        build_session_monitor_url, monitored_agent_session_payload, session_monitor_window_label,
    };

    #[test]
    fn monitor_window_label_is_global() {
        assert_eq!(session_monitor_window_label(), "session-monitor");
    }

    #[test]
    fn monitor_url_carries_owner_window() {
        assert_eq!(
            build_session_monitor_url("project-7"),
            "index.html?surface=session-monitor&ownerWindowLabel=project-7"
        );
    }

    #[test]
    fn monitored_agent_session_payload_uses_camel_case_fields() {
        assert_eq!(
            serde_json::to_value(monitored_agent_session_payload(1, 9)).unwrap(),
            json!({
                "projectId": 1,
                "sessionId": 9
            })
        );
    }
}
