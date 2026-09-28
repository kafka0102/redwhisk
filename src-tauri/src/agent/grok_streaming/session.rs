//! Grok 结构化会话句柄。
//!
//! 每个会话持有一个长驻 `grok agent stdio`（ACP）子进程：
//! 握手 `initialize` → `session/new`（新建）/ `session/load`（续接）→
//! 每轮 `session/prompt`，中断 `session/cancel`。
//!
//! 关键事实（见 `docs/survey/grok-build-acp-protocol-notes.md`）：
//! - `session/new` 的 `cwd` 必须规范化（Grok 会话落盘 key 取物理路径），
//!   否则 Grok Build TUI 在项目目录里看不到该会话；
//! - `session/new` 返回的 `sessionId` 以 `ThreadStarted` 事件回流，由既有
//!   broadcaster 写入 `provider_session_id`（本 adapter 不直接写库）；
//! - 进程一轮结束后不退出，由 `shutdown` 显式关闭。

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::grok_streaming::argv::{append_attachment_paths, build_grok_agent_args};
use crate::agent::grok_streaming::event_mapper::GrokStreamMapper;
use crate::agent::grok_streaming::transport::{
    GrokStreamingError, GrokStreamingTransport, CLIENT_INITIATED_CLOSE_REASON,
};
use crate::agent::provider_spawn::program_from_command_snapshot;
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::types::agent_session::{AgentMessageAttachment, AgentPermissionDecision};
use crate::types::agent_session_stream::{
    AgentMode, AgentModel, AgentStreamEvent, AgentTimelineItem,
};

pub const INITIALIZE_METHOD: &str = "initialize";
pub const SESSION_NEW_METHOD: &str = "session/new";
pub const SESSION_LOAD_METHOD: &str = "session/load";
pub const SESSION_PROMPT_METHOD: &str = "session/prompt";
pub const SESSION_CANCEL_METHOD: &str = "session/cancel";

const NO_INTERRUPTIBLE_TURN: &str = "没有可中断的 Turn";
const CANCEL_REQUEST_TIMEOUT_MS: u64 = 10_000;

/// Grok 结构化会话配置。
#[derive(Clone)]
pub struct GrokSessionConfig {
    pub project_id: i64,
    pub session_id: i64,
    /// provider 命令快照（结构化路径由 `build_launch_command_snapshot` 注入
    /// `agent stdio`；spawn 只取可执行首段）。
    pub binary: String,
    pub cwd: String,
    pub model: Option<String>,
    pub dangerous: bool,
    pub mode_id: Option<String>,
    pub broadcaster: AgentEventBroadcaster,
    pub resume_session_id: Option<String>,
}

struct SessionState {
    session_id: Option<String>,
    mapper: GrokStreamMapper,
}

/// 单个 Grok 结构化会话句柄：持有一个长驻 `grok agent stdio` 子进程。
pub struct GrokSessionHandle {
    transport: Mutex<Option<GrokStreamingTransport>>,
    state: Arc<Mutex<SessionState>>,
    config: GrokSessionConfig,
}

impl GrokSessionHandle {
    /// 启子进程并完成 ACP 握手（`initialize` + `session/new` 或 `session/load`）。
    ///
    /// 握手成功后以 `ThreadStarted` 事件回流 `sessionId`；失败返回传输层错误。
    pub fn start(config: GrokSessionConfig) -> Result<Self, GrokStreamingError> {
        let program = program_from_command_snapshot(&config.binary);
        let program = if program.is_empty() { "grok" } else { program };
        let args = build_grok_agent_args(
            config.mode_id.as_deref(),
            config.dangerous,
            config.model.as_deref(),
        );
        let cwd = canonical_cwd(&config.cwd);
        let transport = GrokStreamingTransport::spawn(&program, &args, Some(&cwd))?;

        transport.request(INITIALIZE_METHOD, initialize_params())?;
        let session_id =
            start_session(&transport, &cwd, config.resume_session_id.as_deref())?;

        let state = Arc::new(Mutex::new(SessionState {
            session_id: Some(session_id.clone()),
            mapper: GrokStreamMapper::new(),
        }));

        let handler_state = Arc::clone(&state);
        let handler_config = config.clone();
        transport.set_notification_handler(Arc::new(move |method, params| {
            handle_notification(&handler_state, &handler_config, method, params);
        }));

        watch_process_exit(&transport, Arc::clone(&state), config.clone());

        config.broadcaster.emit_stream_event(
            config.project_id,
            config.session_id,
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

    /// 发送用户消息（发起一轮 `session/prompt`）。
    ///
    /// `session/prompt` 会一直阻塞到整轮结束，因此写入后台线程；本方法只保证
    /// prompt 已入队并立即返回。
    pub fn send_message(
        &self,
        text: String,
        attachments: Vec<AgentMessageAttachment>,
    ) -> Result<(), GrokStreamingError> {
        let transport = self.current_transport()?;
        let session_id = self
            .state
            .lock()
            .map_err(|_| GrokStreamingError::Protocol("session 锁中毒".into()))?
            .session_id
            .clone()
            .ok_or_else(|| GrokStreamingError::Protocol("grok 会话缺少 sessionId".into()))?;

        let prompt = append_attachment_paths(&text, &attachments);
        let local_turn_id = format!("grok-turn-{}", now_ms());
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| GrokStreamingError::Protocol("session 锁中毒".into()))?;
            state.mapper.begin_turn(local_turn_id.clone());
        }
        self.config.broadcaster.emit_stream_event(
            self.config.project_id,
            self.config.session_id,
            timeline_event(
                Some(local_turn_id.clone()),
                AgentTimelineItem::UserMessage {
                    text,
                    message_id: Some(format!("user-{local_turn_id}")),
                },
            ),
        );

        let state = Arc::clone(&self.state);
        let config = self.config.clone();
        let params = json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": prompt }],
        });
        std::thread::spawn(move || {
            let result = transport.request(SESSION_PROMPT_METHOD, params);
            let events = state
                .lock()
                .map(|mut guard| match result {
                    Ok(value) => guard.mapper.on_prompt_result(&value),
                    Err(error) => {
                        let message = prompt_failure_message(&error, &transport);
                        guard.mapper.on_prompt_error(message)
                    }
                })
                .unwrap_or_default();
            emit_all(&config, events);
        });
        Ok(())
    }

    /// 中断当前 Turn：向服务端发 `session/cancel` 并广播 `TurnCanceled`。
    ///
    /// 没有可中断 Turn 时返回 `NO_INTERRUPTIBLE_TURN`（映射为
    /// `AgentSessionError::NoInterruptibleTurn`），不做空成功。
    pub fn cancel_turn(&self) -> Result<(), GrokStreamingError> {
        let transport = self.current_transport()?;
        let (event, session_id) = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| GrokStreamingError::Protocol("session 锁中毒".into()))?;
            if !state.mapper.is_turn_active() {
                return Err(GrokStreamingError::Protocol(NO_INTERRUPTIBLE_TURN.into()));
            }
            (state.mapper.on_cancel(), state.session_id.clone())
        };
        if let Some(session_id) = session_id {
            std::thread::spawn(move || {
                let _ = transport.request_with_timeout(
                    SESSION_CANCEL_METHOD,
                    json!({ "sessionId": session_id }),
                    CANCEL_REQUEST_TIMEOUT_MS,
                );
            });
        }
        self.config.broadcaster.emit_stream_event(
            self.config.project_id,
            self.config.session_id,
            event,
        );
        Ok(())
    }

    /// 当前 ACP `sessionId`（握手后即有值；尚未建立时返回 `None`）。
    pub fn session_id(&self) -> Option<String> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.session_id.clone())
    }

    /// 关闭会话：kill 子进程并注销广播游标。
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.transport.lock() {
            if let Some(transport) = guard.take() {
                transport.shutdown();
            }
        }
        self.config
            .broadcaster
            .unregister_session(self.config.session_id);
    }

    fn current_transport(&self) -> Result<GrokStreamingTransport, GrokStreamingError> {
        let transport = self
            .transport
            .lock()
            .map_err(|_| GrokStreamingError::Protocol("transport 锁中毒".into()))?
            .clone()
            .ok_or_else(|| GrokStreamingError::Closed("grok 会话已关闭".into()))?;
        if transport.is_closed() {
            return Err(GrokStreamingError::Closed("grok 会话已关闭".into()));
        }
        Ok(transport)
    }
}

impl AgentSessionHandle for GrokSessionHandle {
    fn send_message(
        &self,
        text: String,
        attachments: Vec<AgentMessageAttachment>,
    ) -> Result<(), AgentSessionError> {
        GrokSessionHandle::send_message(self, text, attachments).map_err(AgentSessionError::from)
    }

    fn cancel_turn(&self) -> Result<(), AgentSessionError> {
        GrokSessionHandle::cancel_turn(self).map_err(AgentSessionError::from)
    }

    fn respond_permission(
        &self,
        _request_id: &str,
        _decision: AgentPermissionDecision,
    ) -> Result<(), AgentSessionError> {
        Err(AgentSessionError::NotRunning(
            "grok json 会话本期不支持权限审批".into(),
        ))
    }

    fn set_model(&self, _model_id: String) -> Result<(), AgentSessionError> {
        // 模型只在启动期经 `agent -m` 透传（ADR-0047）；会话内切换未启用，
        // 不做无效果的 ModelChanged 广播。
        Err(AgentSessionError::UnsupportedMode(
            "grok 会话内暂不支持切换模型".into(),
        ))
    }

    fn set_effort(&self, _effort: Option<String>) -> Result<(), AgentSessionError> {
        Err(AgentSessionError::UnsupportedMode(
            "grok 暂不支持 reasoning effort".into(),
        ))
    }

    fn set_mode(&self, _mode_id: &str) -> Result<(), AgentSessionError> {
        Err(AgentSessionError::UnsupportedMode(
            "grok 暂不支持协作模式切换".into(),
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
        GrokSessionHandle::shutdown(self)
    }

    fn thread_id(&self) -> Option<String> {
        GrokSessionHandle::session_id(self)
    }
}

impl From<GrokStreamingError> for AgentSessionError {
    fn from(error: GrokStreamingError) -> Self {
        use GrokStreamingError as E;
        match error {
            E::BinaryNotFound(_) | E::SpawnFailed(_) | E::Closed(_) => {
                AgentSessionError::NotRunning(error.to_string())
            }
            E::Protocol(message) if message == NO_INTERRUPTIBLE_TURN => {
                AgentSessionError::NoInterruptibleTurn
            }
            E::Protocol(_) | E::RequestTimeout { .. } | E::ServerError { .. } | E::Serialize(_)
            | E::Io(_) => AgentSessionError::Protocol(error.to_string()),
        }
    }
}

fn start_session(
    transport: &GrokStreamingTransport,
    cwd: &str,
    resume_session_id: Option<&str>,
) -> Result<String, GrokStreamingError> {
    if let Some(session_id) = resume_session_id {
        // 续接优先 `session/load`；失败回退新建并把新 sessionId 回写。
        let load = transport.request(
            SESSION_LOAD_METHOD,
            json!({ "sessionId": session_id, "cwd": cwd, "mcpServers": [] }),
        );
        if load.is_ok() {
            return Ok(session_id.to_string());
        }
    }
    let result = transport.request(
        SESSION_NEW_METHOD,
        json!({ "cwd": cwd, "mcpServers": [] }),
    )?;
    result
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            GrokStreamingError::Protocol("session/new 响应缺少 sessionId".into())
        })
}

fn initialize_params() -> Value {
    json!({
        "protocolVersion": 1,
        "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false } },
        "clientInfo": { "name": "redwhisk", "version": env!("CARGO_PKG_VERSION") },
    })
}

fn watch_process_exit(
    transport: &GrokStreamingTransport,
    state: Arc<Mutex<SessionState>>,
    config: GrokSessionConfig,
) {
    let transport = transport.clone();
    let rx = transport.subscribe_eof();
    std::thread::spawn(move || {
        let Ok(reason) = rx.recv() else { return };
        if reason == CLIENT_INITIATED_CLOSE_REASON {
            return;
        }
        let error = format_unexpected_exit_error(&reason, &transport.stderr_tail());
        let event = state
            .lock()
            .ok()
            .and_then(|mut guard| guard.mapper.on_process_exit(error));
        if let Some(event) = event {
            config
                .broadcaster
                .emit_stream_event(config.project_id, config.session_id, event);
        }
    });
}

fn handle_notification(
    state: &Arc<Mutex<SessionState>>,
    config: &GrokSessionConfig,
    method: &str,
    params: &Value,
) {
    let events = match state.lock() {
        Ok(mut guard) => guard.mapper.on_notification(method, params),
        Err(_) => return,
    };
    emit_all(config, events);
}

fn emit_all(config: &GrokSessionConfig, events: Vec<AgentStreamEvent>) {
    for event in events {
        config
            .broadcaster
            .emit_stream_event(config.project_id, config.session_id, event);
    }
}

/// 规范化工作目录（Grok 会话落盘 key 取物理路径；符号链接字面路径会导致
/// Grok Build TUI 看不到会话）。规范化失败时回退原始路径。
fn canonical_cwd(cwd: &str) -> String {
    std::fs::canonicalize(cwd)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| cwd.trim().to_string())
}

fn format_unexpected_exit_error(reason: &str, stderr_tail: &str) -> String {
    append_stderr_tail(format!("grok 进程退出：{reason}"), stderr_tail)
}

/// 轮次请求失败时的诊断信息：通道 / 进程异常（`Closed`）附上 stderr 尾巴，
/// 便于区分协议错误与进程崩溃；其余错误保持原样。
fn prompt_failure_message(
    error: &GrokStreamingError,
    transport: &GrokStreamingTransport,
) -> String {
    match error {
        GrokStreamingError::Closed(_) => {
            append_stderr_tail(error.to_string(), &transport.stderr_tail())
        }
        _ => error.to_string(),
    }
}

/// 在诊断信息末尾追加 stderr 尾巴（空白则原样返回）。
fn append_stderr_tail(message: String, stderr_tail: &str) -> String {
    let stderr = stderr_tail.trim();
    if stderr.is_empty() {
        message
    } else {
        format!("{message}\nstderr:\n{stderr}")
    }
}

fn timeline_event(turn_id: Option<String>, item: AgentTimelineItem) -> AgentStreamEvent {
    AgentStreamEvent::Timeline {
        item,
        turn_id,
        seq: 0,
        timestamp: now_ms(),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "session_test_support.rs"]
mod session_test_support;

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "session_resume_tests.rs"]
mod resume_tests;

#[cfg(test)]
#[path = "session_failure_tests.rs"]
mod failure_tests;
