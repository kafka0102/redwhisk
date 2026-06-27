use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

pub const OPEN_AGENT_SESSION_EVENT: &str = "open-agent-session";
const SESSION_MONITOR_HEIGHT: f64 = 44.0;
const SESSION_MONITOR_WIDTH: f64 = 44.0;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSessionMonitorWindowInput {
    pub owner_window_label: String,
    pub project_id: i64,
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
    let window_label = session_monitor_window_label(&input.owner_window_label);

    if let Some(existing_window) = app.get_webview_window(&window_label) {
        existing_window.show().map_err(|error| {
            session_monitor_error(&window_label, "会话监控窗口显示失败。", error.to_string())
        })?;

        return Ok(OpenSessionMonitorWindowResponse { window_label });
    }

    let monitor_window = tauri::WebviewWindowBuilder::new(
        &app,
        window_label.clone(),
        tauri::WebviewUrl::App(
            build_session_monitor_url(input.project_id, &input.owner_window_label).into(),
        ),
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
        session_monitor_error(&window_label, "会话监控窗口打开失败。", error.to_string())
    })?;

    let _ = monitor_window.set_visible_on_all_workspaces(true);

    Ok(OpenSessionMonitorWindowResponse { window_label })
}

#[tauri::command]
pub async fn close_session_monitor_window(
    app: tauri::AppHandle,
    input: CloseSessionMonitorWindowInput,
) -> Result<CloseSessionMonitorWindowResponse, CommandError> {
    let window_label = session_monitor_window_label(&input.owner_window_label);

    if let Some(existing_window) = app.get_webview_window(&window_label) {
        existing_window.close().map_err(|error| {
            session_monitor_error(&window_label, "会话监控窗口关闭失败。", error.to_string())
        })?;
    }

    Ok(CloseSessionMonitorWindowResponse { window_label })
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
            )
        })?;
    let emitted_window_label = target_window.label().to_string();

    target_window.unminimize().map_err(|error| {
        session_monitor_error(
            &emitted_window_label,
            "目标项目窗口恢复失败。",
            error.to_string(),
        )
    })?;
    target_window.show().map_err(|error| {
        session_monitor_error(
            &emitted_window_label,
            "目标项目窗口显示失败。",
            error.to_string(),
        )
    })?;
    target_window.set_focus().map_err(|error| {
        session_monitor_error(
            &emitted_window_label,
            "目标项目窗口聚焦失败。",
            error.to_string(),
        )
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
        )
    })?;

    Ok(OpenMonitoredAgentSessionResponse {
        emitted: true,
        window_label: emitted_window_label,
    })
}

fn build_session_monitor_url(project_id: i64, owner_window_label: &str) -> String {
    format!(
        "index.html?surface=session-monitor&projectId={project_id}&ownerWindowLabel={owner_window_label}"
    )
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

fn session_monitor_window_label(owner_window_label: &str) -> String {
    let normalized_owner_label = owner_window_label
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();

    format!("session-monitor-{normalized_owner_label}")
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
    fn monitor_window_label_is_scoped_to_owner_window() {
        assert_eq!(
            session_monitor_window_label("project-42"),
            "session-monitor-project-42"
        );
        assert_eq!(
            session_monitor_window_label("project:42/main"),
            "session-monitor-project-42-main"
        );
    }

    #[test]
    fn monitor_url_carries_project_and_owner_window() {
        assert_eq!(
            build_session_monitor_url(7, "project-7"),
            "index.html?surface=session-monitor&projectId=7&ownerWindowLabel=project-7"
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
