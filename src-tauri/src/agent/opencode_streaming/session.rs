//! OpenCode 结构化会话句柄（每轮 `run --format json`，`-s` 续接，无权限卡）。

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::opencode_streaming::argv::{
    append_attachment_paths, build_opencode_run_args, should_use_auto,
};
use crate::agent::opencode_streaming::event_mapper::{map_ndjson_value, MapContext};
use crate::agent::opencode_streaming::transport::{OpenCodeStreamingError, OpenCodeTransport};
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::types::agent_session::{AgentMessageAttachment, AgentPermissionDecision};
use crate::types::agent_session_stream::{
    AgentMode, AgentModel, AgentStreamEvent, AgentTimelineItem,
};

const CLIENT_INITIATED_CLOSE_REASON: &str = "客户端主动关闭";

#[derive(Clone)]
pub struct OpenCodeSessionConfig {
    pub project_id: i64,
    pub session_id: i64,
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
    current_turn_id: Option<String>,
    current_model: Option<String>,
    message_index: usize,
    turn_finalized: bool,
    thread_started_emitted: bool,
}

pub struct OpenCodeSessionHandle {
    transport: Mutex<Option<OpenCodeTransport>>,
    state: Arc<Mutex<SessionState>>,
    config: OpenCodeSessionConfig,
}

impl OpenCodeSessionHandle {
    pub fn start(config: OpenCodeSessionConfig) -> Result<Self, OpenCodeStreamingError> {
        let has_resume = config.resume_session_id.is_some();
        let state = Arc::new(Mutex::new(SessionState {
            session_id: config.resume_session_id.clone(),
            current_turn_id: None,
            current_model: config.model.clone(),
            message_index: 0,
            turn_finalized: true,
            thread_started_emitted: has_resume,
        }));

        if let Some(session_id) = config.resume_session_id.clone() {
            config.broadcaster.emit_stream_event(
                config.project_id,
                config.session_id,
                AgentStreamEvent::ThreadStarted {
                    thread_id: session_id,
                },
            );
        }

        Ok(Self {
            transport: Mutex::new(None),
            state,
            config,
        })
    }

    pub fn send_message(
        &self,
        text: String,
        attachments: Vec<AgentMessageAttachment>,
    ) -> Result<(), OpenCodeStreamingError> {
        if let Ok(mut guard) = self.transport.lock() {
            if let Some(prev) = guard.take() {
                prev.shutdown();
            }
        }

        let (session_id, model) = {
            let state = self
                .state
                .lock()
                .map_err(|_| OpenCodeStreamingError::Protocol("session 锁中毒".into()))?;
            (state.session_id.clone(), state.current_model.clone())
        };

        // OpenCode 仅文本 prompt：附件附成路径说明。
        let args = build_opencode_run_args(
            &append_attachment_paths(&text, &attachments),
            session_id.as_deref(),
            model.as_deref(),
            should_use_auto(self.config.mode_id.as_deref(), self.config.dangerous),
        );
        debug_assert!(
            !args.iter().any(|a| a == "--command"),
            "opencode json 路径禁止 --command"
        );

        // snapshot 可能含 run/--format；spawn 只用可执行首段避免重复。
        let program = program_from_binary(&self.config.binary);
        let transport = OpenCodeTransport::spawn(&program, &args, Some(&self.config.cwd))?;

        let turn_id = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| OpenCodeStreamingError::Protocol("session 锁中毒".into()))?;
            state.message_index = 0;
            state.turn_finalized = false;
            let turn_id = format!(
                "turn-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            );
            state.current_turn_id = Some(turn_id.clone());
            turn_id
        };

        self.config.broadcaster.emit_stream_event(
            self.config.project_id,
            self.config.session_id,
            timeline_event(
                &Some(turn_id.clone()),
                AgentTimelineItem::UserMessage {
                    text,
                    message_id: Some(format!("user-{turn_id}")),
                },
            ),
        );

        let state = Arc::clone(&self.state);
        let config = self.config.clone();
        let turn_id_for_handler = turn_id.clone();
        transport.set_message_handler(Arc::new(move |value| {
            handle_message(&state, &config, &turn_id_for_handler, value);
        }));

        let state_for_eof = Arc::clone(&self.state);
        let config_for_eof = self.config.clone();
        let turn_id_for_eof = turn_id.clone();
        let transport_for_eof = transport.clone();
        let rx = transport.subscribe_eof();
        std::thread::spawn(move || {
            if let Ok(reason) = rx.recv() {
                let finalized = mark_process_exit(&state_for_eof);
                if should_emit_turn_failed_on_process_exit(finalized, &reason) {
                    let stderr = transport_for_eof.stderr_tail();
                    let error = format_unexpected_exit_error(&reason, &stderr);
                    config_for_eof.broadcaster.emit_stream_event(
                        config_for_eof.project_id,
                        config_for_eof.session_id,
                        AgentStreamEvent::TurnFailed {
                            turn_id: Some(turn_id_for_eof),
                            error,
                            code: None,
                        },
                    );
                }
            }
        });

        if let Ok(mut guard) = self.transport.lock() {
            *guard = Some(transport);
        }
        Ok(())
    }

    pub fn cancel_turn(&self) -> Result<(), OpenCodeStreamingError> {
        if let Ok(mut guard) = self.transport.lock() {
            if let Some(transport) = guard.take() {
                transport.shutdown();
            }
        }
        let turn_id = self.current_turn_id();
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| OpenCodeStreamingError::Protocol("session 锁中毒".into()))?;
            state.turn_finalized = true;
            state.current_turn_id = None;
        }
        self.config.broadcaster.emit_stream_event(
            self.config.project_id,
            self.config.session_id,
            AgentStreamEvent::TurnCanceled {
                turn_id,
                reason: "user_canceled".into(),
            },
        );
        Ok(())
    }

    pub fn list_models(&self) -> Result<Vec<AgentModel>, OpenCodeStreamingError> {
        Ok(Vec::new())
    }

    pub fn list_modes(&self) -> Vec<AgentMode> {
        Vec::new()
    }

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

    pub fn session_id(&self) -> Option<String> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.session_id.clone())
    }

    fn current_turn_id(&self) -> Option<String> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.current_turn_id.clone())
    }
}

impl AgentSessionHandle for OpenCodeSessionHandle {
    fn send_message(
        &self,
        text: String,
        attachments: Vec<AgentMessageAttachment>,
    ) -> Result<(), AgentSessionError> {
        OpenCodeSessionHandle::send_message(self, text, attachments)
            .map_err(AgentSessionError::from)
    }

    fn cancel_turn(&self) -> Result<(), AgentSessionError> {
        OpenCodeSessionHandle::cancel_turn(self).map_err(AgentSessionError::from)
    }

    fn respond_permission(
        &self,
        _request_id: &str,
        _decision: AgentPermissionDecision,
    ) -> Result<(), AgentSessionError> {
        Err(AgentSessionError::NotRunning(
            "opencode json 会话不支持权限审批".into(),
        ))
    }

    fn set_model(&self, model_id: String) -> Result<(), AgentSessionError> {
        if let Ok(mut state) = self.state.lock() {
            state.current_model = Some(model_id.clone());
        }
        self.config.broadcaster.emit_stream_event(
            self.config.project_id,
            self.config.session_id,
            AgentStreamEvent::ModelChanged { model_id },
        );
        Ok(())
    }

    fn set_effort(&self, _effort: Option<String>) -> Result<(), AgentSessionError> {
        Err(AgentSessionError::UnsupportedMode(
            "opencode 暂不支持 reasoning effort".into(),
        ))
    }

    fn set_mode(&self, _mode_id: &str) -> Result<(), AgentSessionError> {
        Err(AgentSessionError::UnsupportedMode(
            "opencode 暂不支持协作模式切换".into(),
        ))
    }

    fn list_models(&self) -> Result<Vec<AgentModel>, AgentSessionError> {
        OpenCodeSessionHandle::list_models(self).map_err(AgentSessionError::from)
    }

    fn list_modes(&self) -> Vec<AgentMode> {
        OpenCodeSessionHandle::list_modes(self)
    }

    fn read_timeline(&self) -> Result<Vec<AgentTimelineItem>, AgentSessionError> {
        Ok(Vec::new())
    }

    fn shutdown(&self) {
        OpenCodeSessionHandle::shutdown(self)
    }

    fn thread_id(&self) -> Option<String> {
        OpenCodeSessionHandle::session_id(self)
    }
}

impl From<OpenCodeStreamingError> for AgentSessionError {
    fn from(error: OpenCodeStreamingError) -> Self {
        use OpenCodeStreamingError as E;
        match error {
            E::BinaryNotFound(_) | E::SpawnFailed(_) | E::Closed(_) => {
                AgentSessionError::NotRunning(error.to_string())
            }
            E::Protocol(_) | E::Serialize(_) | E::Io(_) => {
                AgentSessionError::Protocol(error.to_string())
            }
        }
    }
}

fn program_from_binary(binary: &str) -> String {
    binary
        .split_whitespace()
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("opencode")
        .into()
}

fn handle_message(
    state: &Arc<Mutex<SessionState>>,
    config: &OpenCodeSessionConfig,
    turn_id: &str,
    value: &Value,
) {
    let (ctx, already_thread_started) = {
        let guard = match state.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        (
            MapContext {
                turn_id: Some(turn_id.to_string()),
                message_index: guard.message_index,
            },
            guard.thread_started_emitted,
        )
    };

    let outcome = map_ndjson_value(value, &ctx);

    if let Some(session_id) = outcome.session_id.clone() {
        let mut emit_thread_started = false;
        if let Ok(mut guard) = state.lock() {
            if guard.session_id.as_deref() != Some(session_id.as_str()) {
                guard.session_id = Some(session_id.clone());
            }
            if !guard.thread_started_emitted {
                guard.thread_started_emitted = true;
                emit_thread_started = true;
            }
            let _ = already_thread_started;
            guard.message_index = outcome.next_message_index;
            if outcome.turn_finalized {
                guard.turn_finalized = true;
            }
        }
        if emit_thread_started {
            config.broadcaster.emit_stream_event(
                config.project_id,
                config.session_id,
                AgentStreamEvent::ThreadStarted {
                    thread_id: session_id,
                },
            );
        }
    } else if let Ok(mut guard) = state.lock() {
        guard.message_index = outcome.next_message_index;
        if outcome.turn_finalized {
            guard.turn_finalized = true;
        }
    }

    for event in outcome.events {
        config
            .broadcaster
            .emit_stream_event(config.project_id, config.session_id, event);
    }
}

fn mark_process_exit(state: &Arc<Mutex<SessionState>>) -> bool {
    if let Ok(mut guard) = state.lock() {
        let finalized = guard.turn_finalized;
        guard.current_turn_id = None;
        guard.turn_finalized = true;
        finalized
    } else {
        true
    }
}

fn should_emit_turn_failed_on_process_exit(finalized: bool, reason: &str) -> bool {
    !finalized && reason != CLIENT_INITIATED_CLOSE_REASON
}

fn format_unexpected_exit_error(reason: &str, stderr_tail: &str) -> String {
    let stderr = stderr_tail.trim();
    if stderr.is_empty() {
        return format!("opencode 进程退出：{reason}");
    }
    format!("opencode 进程退出：{reason}\nstderr:\n{stderr}")
}

fn timeline_event(turn_id: &Option<String>, item: AgentTimelineItem) -> AgentStreamEvent {
    AgentStreamEvent::Timeline {
        item,
        turn_id: turn_id.clone(),
        seq: 0,
        timestamp: now_ms(),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn program_from_binary_strips_structured_snapshot() {
        assert_eq!(
            program_from_binary("opencode run --format json"),
            "opencode"
        );
        assert_eq!(
            program_from_binary("  /usr/bin/opencode --auto "),
            "/usr/bin/opencode"
        );
        assert_eq!(program_from_binary(""), "opencode");
    }

    #[test]
    fn start_with_resume_exposes_thread_id() {
        let handle = OpenCodeSessionHandle::start(OpenCodeSessionConfig {
            project_id: 1,
            session_id: 2,
            binary: "opencode".into(),
            cwd: "/tmp".into(),
            model: None,
            dangerous: false,
            mode_id: None,
            broadcaster: AgentEventBroadcaster::new(),
            resume_session_id: Some("ses_resume".into()),
        })
        .expect("start");
        assert_eq!(handle.thread_id().as_deref(), Some("ses_resume"));
    }

    #[test]
    fn start_without_resume_has_no_thread_id_yet() {
        let handle = OpenCodeSessionHandle::start(OpenCodeSessionConfig {
            project_id: 1,
            session_id: 2,
            binary: "opencode".into(),
            cwd: "/tmp".into(),
            model: Some("x".into()),
            dangerous: true,
            mode_id: Some("full-access".into()),
            broadcaster: AgentEventBroadcaster::new(),
            resume_session_id: None,
        })
        .expect("start");
        assert!(handle.thread_id().is_none());
    }

    #[test]
    fn handle_rejects_permission_and_modes() {
        let handle = OpenCodeSessionHandle::start(OpenCodeSessionConfig {
            project_id: 1,
            session_id: 2,
            binary: "opencode".into(),
            cwd: "/tmp".into(),
            model: None,
            dangerous: false,
            mode_id: None,
            broadcaster: AgentEventBroadcaster::new(),
            resume_session_id: None,
        })
        .expect("start");
        let as_trait: &dyn AgentSessionHandle = &handle;
        assert!(matches!(
            as_trait.respond_permission("r1", AgentPermissionDecision::Accept),
            Err(AgentSessionError::NotRunning(_))
        ));
        assert!(matches!(
            as_trait.set_mode("auto"),
            Err(AgentSessionError::UnsupportedMode(_))
        ));
        assert!(matches!(
            as_trait.set_effort(Some("high".into())),
            Err(AgentSessionError::UnsupportedMode(_))
        ));
    }
}
