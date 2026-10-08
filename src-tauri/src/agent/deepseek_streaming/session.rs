//! DeepSeek 结构化会话：`initialize` → `session/new` 或 `session/resume` → 每轮 `session/prompt`。
//!
//! 已提交的正文、思考和通用工具卡经 mapper 进入既有 `AgentStreamEvent`。
//! 权限请求归一成既有权限卡。图片仍未接入。取消走 ACP 通知，等 prompt 结算后再收尾。
//! 首次 `session/new` 的 `sessionId` 以 `ThreadStarted` 回流到既有 `provider_session_id`。
//! 再次启动用该标识调用 `session/resume`，不回放、不重插旧消息。

use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::deepseek_streaming::argv::{build_deepseek_acp_args, DEEPSEEK_FALLBACK_BINARY};
use crate::agent::deepseek_streaming::event_mapper::DeepSeekStreamMapper;
use crate::agent::deepseek_streaming::permission::{
    auto_allow_outcome, auto_allows, build_permission_request, decision_resolution,
    is_permission_request, outcome_for_decision, parse_options, permission_request_id,
};
use crate::agent::deepseek_streaming::transport::{
    DeepSeekStreamingError, DeepSeekStreamingTransport,
};
use crate::agent::provider_spawn::program_from_command_snapshot;
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::types::agent_session::{AgentMessageAttachment, AgentPermissionDecision};
use crate::types::agent_session_stream::{
    AgentMode, AgentModel, AgentStreamEvent, AgentTimelineItem,
};

struct PendingPermission {
    sender: mpsc::Sender<Value>,
    options: Vec<crate::agent::deepseek_streaming::permission::AcpPermissionOption>,
}

const INITIALIZE_METHOD: &str = "initialize";
const SESSION_NEW_METHOD: &str = "session/new";
const SESSION_RESUME_METHOD: &str = "session/resume";
const SESSION_PROMPT_METHOD: &str = "session/prompt";
const SESSION_CANCEL_METHOD: &str = "session/cancel";

/// DeepSeek 结构化会话配置。
#[derive(Clone)]
pub struct DeepSeekSessionConfig {
    pub project_id: i64,
    pub session_id: i64,
    /// 命令快照。spawn 只取可执行首段，参数固定为 `--profile acp`。
    pub binary: String,
    pub cwd: String,
    /// profile.dangerous。为真时自动允许，不发权限卡。
    pub dangerous: bool,
    /// 启动时冻结的 mode。`full-access` 时自动允许。
    pub mode_id: Option<String>,
    /// 已保存的 provider 会话标识。有值时续接，而不是再 `session/new`。
    pub resume_session_id: Option<String>,
    pub broadcaster: AgentEventBroadcaster,
    #[cfg(test)]
    pub event_log: Arc<Mutex<Vec<AgentStreamEvent>>>,
}

struct SessionState {
    session_id: Option<String>,
    mapper: DeepSeekStreamMapper,
    pending_permissions: HashMap<String, PendingPermission>,
}

/// 长驻 `dsh --profile acp` 会话。
pub struct DeepSeekSessionHandle {
    transport: Mutex<Option<DeepSeekStreamingTransport>>,
    state: Arc<Mutex<SessionState>>,
    config: DeepSeekSessionConfig,
}

impl DeepSeekSessionHandle {
    /// 启动子进程并完成 `initialize`，然后 `session/new` 或 `session/resume`。
    pub fn start(config: DeepSeekSessionConfig) -> Result<Self, DeepSeekStreamingError> {
        let program = program_from_command_snapshot(&config.binary);
        let program = if program.is_empty() {
            DEEPSEEK_FALLBACK_BINARY
        } else {
            program
        };
        let cwd = canonical_cwd(&config.cwd);
        let transport =
            DeepSeekStreamingTransport::spawn(program, &build_deepseek_acp_args(), Some(&cwd))?;
        transport.request(INITIALIZE_METHOD, initialize_params())?;
        let session_id = match open_session(&transport, &cwd, config.resume_session_id.as_deref()) {
            Ok(session_id) => session_id,
            Err(error) => {
                if resume_session_id_from(config.resume_session_id.as_deref()).is_some() {
                    emit(
                        &config,
                        AgentStreamEvent::TurnFailed {
                            turn_id: None,
                            error: resume_failure_fact(&error),
                            code: None,
                        },
                    );
                    transport.shutdown();
                }
                return Err(error);
            }
        };
        let state = Arc::new(Mutex::new(SessionState {
            session_id: Some(session_id.clone()),
            mapper: DeepSeekStreamMapper::new(),
            pending_permissions: HashMap::new(),
        }));
        let handler_state = Arc::clone(&state);
        let handler_config = config.clone();
        transport.set_notification_handler(Arc::new(move |method, params| {
            handle_notification(&handler_state, &handler_config, method, params);
        }));
        let request_state = Arc::clone(&state);
        let request_config = config.clone();
        transport.set_server_request_handler(Arc::new(move |rpc_id, method, params| {
            handle_server_request(&request_state, &request_config, rpc_id, method, params)
        }));
        emit(
            &config,
            AgentStreamEvent::ThreadStarted {
                thread_id: session_id,
            },
        );
        Ok(Self {
            transport: Mutex::new(Some(transport)),
            state,
            config,
        })
    }

    /// 发送一条文字 prompt。附件留待后续票。
    pub fn send_message(&self, text: String) -> Result<(), DeepSeekStreamingError> {
        let transport = self.current_transport()?;
        let local_turn_id = format!("deepseek-turn-{}", now_ms());
        let (session_id, started) = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| DeepSeekStreamingError::Protocol("session 锁中毒".into()))?;
            if state.mapper.is_turn_active() {
                return Err(DeepSeekStreamingError::Protocol(
                    "已有未结束的 prompt".into(),
                ));
            }
            let session_id = state.session_id.clone().ok_or_else(|| {
                DeepSeekStreamingError::Protocol("deepseek 会话缺少 sessionId".into())
            })?;
            let started = state.mapper.begin_turn(local_turn_id.clone());
            (session_id, started)
        };
        emit(
            &self.config,
            timeline_event(
                Some(local_turn_id.clone()),
                AgentTimelineItem::UserMessage {
                    text: text.clone(),
                    message_id: Some(format!("user-{local_turn_id}")),
                },
            ),
        );
        emit(&self.config, started);

        let state = Arc::clone(&self.state);
        let config = self.config.clone();
        let params = json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": text }],
        });
        std::thread::spawn(move || {
            let result = transport.request(SESSION_PROMPT_METHOD, params);
            let events = state
                .lock()
                .map(|mut guard| match result {
                    Ok(value) => guard.mapper.on_prompt_result(&local_turn_id, &value),
                    Err(error) => guard
                        .mapper
                        .on_prompt_error(&local_turn_id, error.to_string()),
                })
                .unwrap_or_default();
            for event in events {
                emit(&config, event);
            }
        });
        Ok(())
    }

    pub fn thread_id(&self) -> Option<String> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.session_id.clone())
    }

    pub fn shutdown(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.pending_permissions.clear();
        }
        if let Ok(mut guard) = self.transport.lock() {
            if let Some(transport) = guard.take() {
                transport.shutdown();
            }
        }
        self.config
            .broadcaster
            .unregister_session(self.config.session_id);
    }

    fn current_transport(&self) -> Result<DeepSeekStreamingTransport, DeepSeekStreamingError> {
        let transport = self
            .transport
            .lock()
            .map_err(|_| DeepSeekStreamingError::Protocol("transport 锁中毒".into()))?
            .clone()
            .ok_or_else(|| DeepSeekStreamingError::Closed("deepseek 会话已关闭".into()))?;
        if transport.is_closed() {
            return Err(DeepSeekStreamingError::Closed("deepseek 会话已关闭".into()));
        }
        Ok(transport)
    }
}

impl AgentSessionHandle for DeepSeekSessionHandle {
    fn send_message(
        &self,
        text: String,
        attachments: Vec<AgentMessageAttachment>,
    ) -> Result<(), AgentSessionError> {
        if !attachments.is_empty() {
            return Err(AgentSessionError::Protocol("deepseek 附件尚未接入".into()));
        }
        DeepSeekSessionHandle::send_message(self, text).map_err(AgentSessionError::from)
    }

    fn cancel_turn(&self) -> Result<(), AgentSessionError> {
        let transport = self.current_transport().map_err(AgentSessionError::from)?;
        let session_id = {
            let state = self
                .state
                .lock()
                .map_err(|_| AgentSessionError::Protocol("session 锁中毒".into()))?;
            if !state.mapper.is_turn_active() {
                return Err(AgentSessionError::NoInterruptibleTurn);
            }
            state
                .session_id
                .clone()
                .ok_or_else(|| AgentSessionError::Protocol("deepseek 会话缺少 sessionId".into()))?
        };
        transport
            .notify(SESSION_CANCEL_METHOD, json!({ "sessionId": session_id }))
            .map_err(AgentSessionError::from)
    }

    fn respond_permission(
        &self,
        request_id: &str,
        decision: AgentPermissionDecision,
    ) -> Result<(), AgentSessionError> {
        let (sender, outcome) = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| AgentSessionError::Protocol("session 锁中毒".into()))?;
            let pending = state
                .pending_permissions
                .remove(request_id)
                .ok_or_else(|| {
                    AgentSessionError::Protocol(format!(
                        "no pending permission request: {request_id}"
                    ))
                })?;
            match outcome_for_decision(decision, &pending.options) {
                Ok(outcome) => (pending.sender, outcome),
                Err(error) => {
                    state
                        .pending_permissions
                        .insert(request_id.to_string(), pending);
                    return Err(AgentSessionError::from(error));
                }
            }
        };
        sender.send(outcome).map_err(|_| {
            AgentSessionError::Protocol("permission decision channel closed".into())
        })?;
        emit(
            &self.config,
            AgentStreamEvent::PermissionResolved {
                request_id: request_id.to_string(),
                resolution: decision_resolution(decision).to_string(),
            },
        );
        Ok(())
    }

    fn set_model(&self, _model_id: String) -> Result<(), AgentSessionError> {
        Err(AgentSessionError::UnsupportedMode(
            "deepseek 不支持切换模型".into(),
        ))
    }

    fn set_effort(&self, _effort: Option<String>) -> Result<(), AgentSessionError> {
        Err(AgentSessionError::UnsupportedMode(
            "deepseek 不支持推理强度".into(),
        ))
    }

    fn set_mode(&self, _mode_id: &str) -> Result<(), AgentSessionError> {
        Err(AgentSessionError::UnsupportedMode(
            "deepseek 不支持 mode".into(),
        ))
    }

    fn list_models(&self) -> Result<Vec<AgentModel>, AgentSessionError> {
        Ok(Vec::new())
    }

    fn list_modes(&self) -> Vec<AgentMode> {
        Vec::new()
    }

    fn read_timeline(&self) -> Result<Vec<AgentTimelineItem>, AgentSessionError> {
        Ok(Vec::new())
    }

    fn shutdown(&self) {
        DeepSeekSessionHandle::shutdown(self);
    }

    fn thread_id(&self) -> Option<String> {
        DeepSeekSessionHandle::thread_id(self)
    }
}

impl From<DeepSeekStreamingError> for AgentSessionError {
    fn from(error: DeepSeekStreamingError) -> Self {
        match error {
            DeepSeekStreamingError::BinaryNotFound(_)
            | DeepSeekStreamingError::SpawnFailed(_)
            | DeepSeekStreamingError::Closed(_) => AgentSessionError::NotRunning(error.to_string()),
            DeepSeekStreamingError::RequestTimeout { .. }
            | DeepSeekStreamingError::ServerError { .. }
            | DeepSeekStreamingError::Protocol(_)
            | DeepSeekStreamingError::Serialize(_)
            | DeepSeekStreamingError::Io(_) => AgentSessionError::Protocol(error.to_string()),
        }
    }
}

fn start_session(
    transport: &DeepSeekStreamingTransport,
    cwd: &str,
) -> Result<String, DeepSeekStreamingError> {
    let result = transport.request(SESSION_NEW_METHOD, json!({ "cwd": cwd, "mcpServers": [] }))?;
    result
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| DeepSeekStreamingError::Protocol("session/new 响应缺少 sessionId".into()))
}

fn open_session(
    transport: &DeepSeekStreamingTransport,
    cwd: &str,
    resume_session_id: Option<&str>,
) -> Result<String, DeepSeekStreamingError> {
    if let Some(session_id) = resume_session_id_from(resume_session_id) {
        // 拒绝时不回退 `session/new`，避免开出一条丢掉历史的空会话。
        transport.request(
            SESSION_RESUME_METHOD,
            json!({ "sessionId": session_id, "cwd": cwd, "mcpServers": [] }),
        )?;
        return Ok(session_id.to_string());
    }
    start_session(transport, cwd)
}

/// 空白标识不算续接。factory 的回填判断与这里共用，避免两处规则分叉。
pub(crate) fn resume_session_id_from(raw: Option<&str>) -> Option<&str> {
    raw.map(str::trim).filter(|value| !value.is_empty())
}

fn resume_failure_fact(error: &DeepSeekStreamingError) -> String {
    match error {
        DeepSeekStreamingError::ServerError { message } if !message.trim().is_empty() => {
            message.clone()
        }
        _ => "session resume rejected".to_string(),
    }
}

fn initialize_params() -> Value {
    json!({
        "protocolVersion": 1,
        "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false } },
        "clientInfo": { "name": "redwhisk", "version": env!("CARGO_PKG_VERSION") },
    })
}

fn handle_server_request(
    state: &Arc<Mutex<SessionState>>,
    config: &DeepSeekSessionConfig,
    rpc_id: &Value,
    method: &str,
    params: &Value,
) -> Result<Value, DeepSeekStreamingError> {
    if !is_permission_request(method) {
        return Err(DeepSeekStreamingError::Protocol(format!(
            "unhandled ACP request: {method}"
        )));
    }
    let options = parse_options(params);
    if auto_allows(config.dangerous, config.mode_id.as_deref()) {
        return auto_allow_outcome(&options);
    }
    let request_id = permission_request_id(rpc_id);
    let turn_id = state
        .lock()
        .ok()
        .and_then(|guard| guard.mapper.current_turn_id());
    let request = build_permission_request(request_id.clone(), turn_id, params);
    let (sender, receiver) = mpsc::channel();
    {
        let mut guard = state
            .lock()
            .map_err(|_| DeepSeekStreamingError::Protocol("session 锁中毒".into()))?;
        guard
            .pending_permissions
            .insert(request_id, PendingPermission { sender, options });
    }
    emit(config, AgentStreamEvent::PermissionRequested { request });
    receiver
        .recv()
        .map_err(|_| DeepSeekStreamingError::Closed("permission decision channel closed".into()))
}

fn handle_notification(
    state: &Arc<Mutex<SessionState>>,
    config: &DeepSeekSessionConfig,
    method: &str,
    params: &Value,
) {
    let events = match state.lock() {
        Ok(mut guard) => guard.mapper.on_notification(method, params),
        Err(_) => return,
    };
    for event in events {
        emit(config, event);
    }
}

fn emit(config: &DeepSeekSessionConfig, event: AgentStreamEvent) {
    #[cfg(test)]
    {
        if let Ok(mut log) = config.event_log.lock() {
            log.push(event.clone());
        }
    }
    config
        .broadcaster
        .emit_stream_event(config.project_id, config.session_id, event);
}

fn timeline_event(turn_id: Option<String>, item: AgentTimelineItem) -> AgentStreamEvent {
    AgentStreamEvent::Timeline {
        item,
        turn_id,
        seq: 0,
        timestamp: now_ms(),
    }
}

fn canonical_cwd(cwd: &str) -> String {
    std::fs::canonicalize(cwd)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| cwd.to_string())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
