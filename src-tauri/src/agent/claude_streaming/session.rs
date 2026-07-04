//! Claude Code 结构化会话编排。
//!
//! `ClaudeSessionHandle` 实现 `AgentSessionHandle` trait，把
//! `claude -p --output-format stream-json` 的 NDJSON 流归一化为
//! `AgentStreamEvent` 并经 `AgentEventBroadcaster` 广播。
//!
//! 单轮进程模型：每次 `send_message` 启动一个 `claude -p` 进程，把用户
//! 文本作为 `-p` 参数传入；多轮对话靠 `--resume <session_id>` 续接同一
//! Claude session。进程读到 `result` 行后退出，本端在 stdout EOF 时清理
//! 当前 turn。
//!
//! 与 `CodexSessionHandle` 的关键差异：
//! - 无 thread/handshake（Claude `-p` 是单次 query，无 JSON-RPC 握手）
//! - 无审批应答通道（bypassPermissions 模式下权限自动放行）
//! - timeline 无历史回放（`read_timeline` 返回空，依赖实时事件流）

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;

use super::event_mapper::{
    map_assistant_blocks, map_tool_results, map_usage, MappedBlock, ToolResultPatch,
};
use super::message::{
    parse_message, AnthropicStreamEvent, ClaudeStreamMessage, ContentBlock, ContentDelta,
};
use super::transport::{ClaudeStreamingError, ClaudeTransport};
use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::types::agent_session::{AgentMessageAttachment, AgentPermissionDecision};
use crate::types::agent_session_stream::{
    AgentMode, AgentModel, AgentStreamEvent, AgentTimelineItem, ToolCallDetail, ToolCallStatus,
};

/// assistant 文本增量节流间隔，避免逐 token 广播。
const DELTA_FLUSH_INTERVAL: Duration = Duration::from_millis(80);

/// claude `-p` 输出格式所需的固定参数。
const STREAM_JSON_ARGS: &[&str] = &[
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "bypassPermissions",
];

/// session 启动配置。
#[derive(Clone)]
pub struct ClaudeSessionConfig {
    pub project_id: i64,
    pub session_id: i64,
    /// claude 可执行路径（通常 `claude`）。
    pub binary: String,
    pub cwd: String,
    /// 初始模型（None 时由 claude 选默认）。
    pub model: Option<String>,
    pub broadcaster: AgentEventBroadcaster,
    /// 续接已存在的 Claude session_id；为 None 时新建。
    pub resume_session_id: Option<String>,
}

/// 会话级共享状态（Arc + Mutex，供 message handler 线程访问）。
struct SessionState {
    /// Claude session_id（从 system/init 或 result 读）。
    session_id: Option<String>,
    /// 当前 turn 的进程标识（单轮模型下用进程启动时间戳模拟）。
    current_turn_id: Option<String>,
    current_model: Option<String>,
    /// 流式文本增量累积：block_index → 累积文本。
    text_buffer: HashMap<usize, String>,
    /// 流式文本上次 flush 时间：block_index → flush 时间。
    text_last_flush_at: HashMap<usize, Instant>,
    /// 流式文本上次 flush 长度：block_index → 已广播字节长度。
    text_flushed_len: HashMap<usize, usize>,
    /// 流式 reasoning（thinking）增量累积：block_index → 累积文本。
    ///
    /// 与 Codex 的 reasoning_buffer 对齐：Claude 的 ThinkingDelta 原始片段
    /// 先累积，再按节流间隔广播完整文本，避免前端按尾项替换语义产生堆积。
    reasoning_buffer: HashMap<usize, String>,
    /// reasoning 上次 flush 时间：block_index → flush 时间。
    reasoning_last_flush_at: HashMap<usize, Instant>,
    /// reasoning 上次 flush 长度：block_index → 已广播字节长度。
    reasoning_flushed_len: HashMap<usize, usize>,
    /// reasoning 块开始时间：block_index → 首帧 Instant。
    ///
    /// 用于 per-block 计时，在块结束（force flush）时计算 duration_ms。
    reasoning_started_at: HashMap<usize, Instant>,
    /// 流式工具入参累积：block_index → 累积 partial_json。
    tool_input_buffer: HashMap<usize, String>,
    /// 当前 turn 的 tool_use 映射：block_index → (call_id, tool_name)。
    tool_index: HashMap<usize, (String, String)>,
    /// 当前 turn 是否已发过 result（防止 EOF 时重复发 TurnFailed）。
    turn_finalized: bool,
    /// 最近已知 cwd（best-effort，来自 system/init）。
    last_known_cwd: Option<String>,
}

/// Claude session 句柄。
pub struct ClaudeSessionHandle {
    /// 当前 turn 的传输层；None = 无 turn 运行。
    transport: Mutex<Option<ClaudeTransport>>,
    state: Arc<Mutex<SessionState>>,
    config: ClaudeSessionConfig,
}

impl ClaudeSessionHandle {
    /// 初始化 session（不立即启动进程）。
    ///
    /// 若 `resume_session_id` 为 Some，则使用已有 session_id；否则 session_id
    /// 在首轮 `send_message` 时从 `system/init` / `result` 获取。
    /// 广播 `ThreadStarted` 以对齐前端契约（用 session_id 模拟 thread_id）。
    pub fn start(config: ClaudeSessionConfig) -> Result<Self, ClaudeStreamingError> {
        let state = Arc::new(Mutex::new(SessionState {
            session_id: config.resume_session_id.clone(),
            current_turn_id: None,
            current_model: config.model.clone(),
            text_buffer: HashMap::new(),
            text_last_flush_at: HashMap::new(),
            text_flushed_len: HashMap::new(),
            reasoning_buffer: HashMap::new(),
            reasoning_last_flush_at: HashMap::new(),
            reasoning_flushed_len: HashMap::new(),
            reasoning_started_at: HashMap::new(),
            tool_input_buffer: HashMap::new(),
            tool_index: HashMap::new(),
            turn_finalized: true,
            last_known_cwd: None,
        }));

        // 广播 thread_started，对齐前端契约。
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

    /// 发送用户消息：启动一个 claude `-p` 进程，等待结果流。
    pub fn send_message(
        &self,
        text: String,
        _attachments: Vec<AgentMessageAttachment>,
    ) -> Result<(), ClaudeStreamingError> {
        let (session_id, model) = {
            let state = self
                .state
                .lock()
                .map_err(|_| ClaudeStreamingError::Protocol("session 锁中毒".into()))?;
            (state.session_id.clone(), state.current_model.clone())
        };

        // 构造 claude 命令参数。
        let args = build_claude_args(&text, session_id.as_deref(), model.as_deref());
        let transport = ClaudeTransport::spawn(&self.config.binary, &args, Some(&self.config.cwd))?;

        // 重置当前 turn 状态。
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| ClaudeStreamingError::Protocol("session 锁中毒".into()))?;
            state.text_buffer.clear();
            state.text_last_flush_at.clear();
            state.text_flushed_len.clear();
            state.reasoning_buffer.clear();
            state.reasoning_last_flush_at.clear();
            state.reasoning_flushed_len.clear();
            state.reasoning_started_at.clear();
            state.tool_input_buffer.clear();
            state.tool_index.clear();
            state.turn_finalized = false;
            state.current_turn_id = Some(format!(
                "turn-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            ));
        }

        let turn_id = self.current_turn_id();
        self.config.broadcaster.emit_stream_event(
            self.config.project_id,
            self.config.session_id,
            AgentStreamEvent::TurnStarted {
                turn_id: turn_id.clone(),
            },
        );

        // 注册 message handler。
        let state = Arc::clone(&self.state);
        let config = self.config.clone();
        let turn_id_for_handler = turn_id.clone();
        transport.set_message_handler(Arc::new(move |value| {
            handle_message(&state, &config, &turn_id_for_handler, value);
        }));

        // 订阅 EOF：进程退出时若未发 result，补发 TurnFailed。
        let state_for_eof = Arc::clone(&self.state);
        let config_for_eof = self.config.clone();
        let turn_id_for_eof = turn_id.clone();
        let rx = transport.subscribe_eof();
        std::thread::spawn(move || {
            if let Ok(reason) = rx.recv() {
                let finalized = handle_process_exit(&state_for_eof, &reason);
                if !finalized {
                    config_for_eof.broadcaster.emit_stream_event(
                        config_for_eof.project_id,
                        config_for_eof.session_id,
                        AgentStreamEvent::TurnFailed {
                            turn_id: turn_id_for_eof,
                            error: format!("claude 进程退出：{reason}"),
                            code: None,
                        },
                    );
                }
            }
        });

        // 存入当前 transport（替换旧的，旧的自然 drop）。
        if let Ok(mut guard) = self.transport.lock() {
            *guard = Some(transport);
        }
        Ok(())
    }

    /// 中断当前 turn：kill 当前 claude 进程。
    pub fn cancel_turn(&self) -> Result<(), ClaudeStreamingError> {
        let turn_id = self.current_turn_id();
        let has_turn = turn_id.is_some();

        // kill 进程。
        if let Ok(mut guard) = self.transport.lock() {
            if let Some(transport) = guard.take() {
                transport.shutdown();
            }
        }

        if has_turn {
            self.mark_turn_finalized();
            self.config.broadcaster.emit_stream_event(
                self.config.project_id,
                self.config.session_id,
                AgentStreamEvent::TurnCanceled {
                    turn_id,
                    reason: "用户中断".into(),
                },
            );
        }
        Ok(())
    }

    /// 切换模型。下一次 `send_message` 会带上新 model。
    pub fn set_model(&self, model_id: String) -> Result<(), ClaudeStreamingError> {
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| ClaudeStreamingError::Protocol("session 锁中毒".into()))?;
            state.current_model = Some(model_id.clone());
        }
        self.config.broadcaster.emit_stream_event(
            self.config.project_id,
            self.config.session_id,
            AgentStreamEvent::ModelChanged { model_id },
        );
        Ok(())
    }

    /// 列出可用模型（首版返回空，capabilities 已关闭切换）。
    pub fn list_models(&self) -> Result<Vec<AgentModel>, ClaudeStreamingError> {
        Ok(Vec::new())
    }

    /// 列出可用模式（首版返回单元素默认模式）。
    pub fn list_modes(&self) -> Vec<AgentMode> {
        vec![AgentMode {
            mode_id: "default".into(),
            name: Some("Default".into()),
        }]
    }

    /// 关闭 session：kill 当前进程、注销游标。
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

    /// 当前 Claude session_id（对应前端契约的 thread_id）。
    pub fn session_id(&self) -> Option<String> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.session_id.clone())
    }

    /// 最近已知 cwd（来自 system/init，best-effort）。
    pub fn last_known_cwd(&self) -> Option<String> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.last_known_cwd.clone())
    }

    fn current_turn_id(&self) -> Option<String> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.current_turn_id.clone())
    }

    fn mark_turn_finalized(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.turn_finalized = true;
            state.current_turn_id = None;
        }
    }
}

impl AgentSessionHandle for ClaudeSessionHandle {
    fn send_message(
        &self,
        text: String,
        attachments: Vec<AgentMessageAttachment>,
    ) -> Result<(), AgentSessionError> {
        ClaudeSessionHandle::send_message(self, text, attachments).map_err(AgentSessionError::from)
    }

    fn cancel_turn(&self) -> Result<(), AgentSessionError> {
        ClaudeSessionHandle::cancel_turn(self).map_err(AgentSessionError::from)
    }

    fn respond_permission(
        &self,
        _request_id: &str,
        _decision: AgentPermissionDecision,
    ) -> Result<(), AgentSessionError> {
        // bypassPermissions 模式下无审批应答通道；权限能力已关闭，不应被调用。
        Err(AgentSessionError::NotRunning(
            "claude 结构化会话不支持的权限审批".into(),
        ))
    }

    fn set_model(&self, model_id: String) -> Result<(), AgentSessionError> {
        ClaudeSessionHandle::set_model(self, model_id).map_err(AgentSessionError::from)
    }

    fn set_effort(&self, _effort: Option<String>) -> Result<(), AgentSessionError> {
        Err(AgentSessionError::UnsupportedMode(
            "claude 暂不支持 reasoning effort".into(),
        ))
    }

    fn set_mode(&self, _mode_id: &str) -> Result<(), AgentSessionError> {
        Err(AgentSessionError::UnsupportedMode(
            "claude 暂不支持协作模式切换".into(),
        ))
    }

    fn list_models(&self) -> Result<Vec<AgentModel>, AgentSessionError> {
        ClaudeSessionHandle::list_models(self).map_err(AgentSessionError::from)
    }

    fn list_modes(&self) -> Vec<AgentMode> {
        ClaudeSessionHandle::list_modes(self)
    }

    fn read_timeline(&self) -> Result<Vec<AgentTimelineItem>, AgentSessionError> {
        // 单轮模型下 timeline 经实时事件流广播；无历史回放接口。
        Ok(Vec::new())
    }

    fn shutdown(&self) {
        ClaudeSessionHandle::shutdown(self)
    }

    fn thread_id(&self) -> Option<String> {
        ClaudeSessionHandle::session_id(self)
    }

    fn last_known_cwd(&self) -> Option<String> {
        ClaudeSessionHandle::last_known_cwd(self)
    }
}

impl From<ClaudeStreamingError> for AgentSessionError {
    fn from(error: ClaudeStreamingError) -> Self {
        use ClaudeStreamingError as E;
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

/// 构造 claude 命令参数：`-p <prompt> --output-format stream-json ... [--resume <id>] [--model <m>]`。
fn build_claude_args(
    prompt: &str,
    resume_session_id: Option<&str>,
    model: Option<&str>,
) -> Vec<String> {
    let mut args = vec!["-p".to_string(), prompt.to_string()];
    for arg in STREAM_JSON_ARGS {
        args.push(arg.to_string());
    }
    if let Some(session_id) = resume_session_id {
        args.push("--resume".into());
        args.push(session_id.to_string());
    }
    if let Some(model) = model {
        args.push("--model".into());
        args.push(model.to_string());
    }
    args
}

/// 处理一条 SDKMessage：归一化为 AgentStreamEvent 并广播。
fn handle_message(
    state: &Arc<Mutex<SessionState>>,
    config: &ClaudeSessionConfig,
    turn_id: &Option<String>,
    value: &Value,
) {
    let message = parse_message(value);
    let events = build_events(state, config, turn_id, message);
    for event in events {
        config
            .broadcaster
            .emit_stream_event(config.project_id, config.session_id, event);
    }
}

/// 把归一化消息转换为 `AgentStreamEvent` 列表。
fn build_events(
    state: &Arc<Mutex<SessionState>>,
    _config: &ClaudeSessionConfig,
    turn_id: &Option<String>,
    message: ClaudeStreamMessage,
) -> Vec<AgentStreamEvent> {
    let mut events = Vec::new();
    match message {
        ClaudeStreamMessage::SystemInit {
            session_id,
            model,
            cwd,
            ..
        } => {
            if let Ok(mut guard) = state.lock() {
                if guard.session_id.is_none() {
                    guard.session_id = Some(session_id.clone());
                }
                if model.is_some() {
                    guard.current_model = model.clone();
                }
                if cwd.is_some() {
                    guard.last_known_cwd = cwd.clone();
                }
            }
            // 首次拿到 session_id 时补发 ThreadStarted。
            if !session_id.is_empty() {
                events.push(AgentStreamEvent::ThreadStarted {
                    thread_id: session_id,
                });
            }
            // 补发 ModelChanged：claude CLI 启动后从 settings.json / --model 解析出
            // 实际生效模型，需广播给前端，使 composer 的模型选择器展示当前模型
            // （否则前端 state.model 永远为 null）。
            if let Some(model_id) = model.filter(|m| !m.is_empty()) {
                events.push(AgentStreamEvent::ModelChanged { model_id });
            }
        }
        ClaudeStreamMessage::StreamEvent(event) => {
            events.extend(handle_stream_event(state, turn_id, event));
        }
        ClaudeStreamMessage::Assistant { message, .. } => {
            // 完整 assistant 消息：用 content 块组装 timeline。
            // 先 flush 残留的流式文本与 reasoning（stream-json 模式下完整 assistant
            // 消息与流式增量可能重复到达，先 flush 保证不丢失尾部内容）。
            flush_all_text_deltas(state, turn_id)
                .into_iter()
                .for_each(|e| events.push(e));
            flush_all_reasoning_deltas(state, turn_id)
                .into_iter()
                .for_each(|e| events.push(e));
            let mapped = map_assistant_blocks(&message.blocks);
            for block in mapped {
                match block {
                    MappedBlock::AssistantText { text } => {
                        if !text.is_empty() {
                            events.push(timeline_event(
                                turn_id,
                                AgentTimelineItem::AssistantMessage {
                                    text,
                                    message_id: None,
                                },
                            ));
                        }
                    }
                    MappedBlock::Reasoning { text } => {
                        if !text.is_empty() {
                            events.push(timeline_event(
                                turn_id,
                                AgentTimelineItem::Reasoning {
                                    text,
                                    // 完整 assistant 消息无 per-block 计时上下文，不填充 duration。
                                    duration_ms: None,
                                },
                            ));
                        }
                    }
                    MappedBlock::ToolUse {
                        call_id,
                        name,
                        detail,
                        status,
                    } => {
                        events.push(timeline_event(
                            turn_id,
                            AgentTimelineItem::ToolCall {
                                call_id,
                                name,
                                detail,
                                status,
                                error: None,
                            },
                        ));
                    }
                }
            }
            if let Some(usage) = message.usage {
                events.push(AgentStreamEvent::UsageUpdated {
                    usage: map_usage(&usage),
                });
            }
        }
        ClaudeStreamMessage::User { message, .. } => {
            let updates = map_tool_results(&message.blocks);
            for update in updates {
                events.push(timeline_event(
                    turn_id,
                    AgentTimelineItem::ToolCall {
                        call_id: update.call_id.clone(),
                        name: tool_name_for_patch(&update.patch),
                        detail: patch_detail(update.patch),
                        status: update.status,
                        error: None,
                    },
                ));
            }
        }
        ClaudeStreamMessage::Result {
            is_error,
            usage,
            session_id,
            errors,
            ..
        } => {
            // flush 残留文本与 reasoning（turn 结束前确保所有增量都已广播）。
            flush_all_text_deltas(state, turn_id)
                .into_iter()
                .for_each(|e| events.push(e));
            flush_all_reasoning_deltas(state, turn_id)
                .into_iter()
                .for_each(|e| events.push(e));
            // 记录 session_id（续接用）。
            if let Ok(mut guard) = state.lock() {
                if let Some(sid) = session_id {
                    guard.session_id = Some(sid);
                }
                guard.turn_finalized = true;
                guard.current_turn_id = None;
            }
            if let Some(usage) = usage {
                events.push(AgentStreamEvent::UsageUpdated {
                    usage: map_usage(&usage),
                });
            }
            if !is_error {
                events.push(AgentStreamEvent::TurnCompleted {
                    turn_id: turn_id.clone(),
                    usage: None,
                });
            } else {
                events.push(AgentStreamEvent::TurnFailed {
                    turn_id: turn_id.clone(),
                    error: errors.join("; "),
                    code: None,
                });
            }
        }
        ClaudeStreamMessage::SystemPermissionDenied { tool_name, message } => {
            // bypass 模式下不应出现；若出现则作为 error 提示。
            let desc = match (tool_name, message) {
                (Some(tool), Some(msg)) => format!("{tool}: {msg}"),
                (Some(tool), None) => tool,
                (None, Some(msg)) => msg,
                (None, None) => "权限被拒绝".into(),
            };
            events.push(timeline_event(
                turn_id,
                AgentTimelineItem::Error { message: desc },
            ));
        }
        ClaudeStreamMessage::Other => {}
    }
    events
}

/// 处理 stream_event（流式增量）。
fn handle_stream_event(
    state: &Arc<Mutex<SessionState>>,
    turn_id: &Option<String>,
    event: AnthropicStreamEvent,
) -> Vec<AgentStreamEvent> {
    let mut events = Vec::new();
    match event {
        AnthropicStreamEvent::ContentBlockStart { index, block } => {
            if let Ok(mut guard) = state.lock() {
                match block {
                    ContentBlock::Text { .. } => {
                        guard.text_buffer.entry(index).or_default();
                        guard.text_last_flush_at.remove(&index);
                        guard.text_flushed_len.remove(&index);
                    }
                    ContentBlock::ToolUse { id, name } => {
                        guard.tool_index.insert(index, (id, name));
                        guard.tool_input_buffer.entry(index).or_default();
                    }
                    ContentBlock::Thinking { thinking } => {
                        // 累积模式（与 Text 一致）：首帧文本记入 buffer，并记录块开始时间用于计时。
                        // flush 在 ThinkingDelta / ContentBlockStop 时发生，避免在此处二次加锁。
                        let buffer = guard.reasoning_buffer.entry(index).or_default();
                        let was_empty = buffer.is_empty();
                        buffer.push_str(&thinking);
                        if was_empty {
                            guard.reasoning_started_at.insert(index, Instant::now());
                        }
                        guard.reasoning_last_flush_at.remove(&index);
                        guard.reasoning_flushed_len.remove(&index);
                    }
                    ContentBlock::Other => {}
                }
            }
        }
        AnthropicStreamEvent::ContentBlockDelta { index, delta } => match delta {
            ContentDelta::TextDelta { text } => {
                if let Ok(mut guard) = state.lock() {
                    guard.text_buffer.entry(index).or_default().push_str(&text);
                }
                // 尝试节流 flush。
                if let Some(event) = try_flush_text_delta(state, index, false) {
                    events.push(event);
                }
            }
            ContentDelta::InputJsonDelta { partial_json } => {
                if let Ok(mut guard) = state.lock() {
                    guard
                        .tool_input_buffer
                        .entry(index)
                        .or_default()
                        .push_str(&partial_json);
                }
            }
            ContentDelta::ThinkingDelta { thinking } => {
                // 累积 thinking 增量，按节流间隔 flush 完整文本（与 text delta 对齐）。
                if let Ok(mut guard) = state.lock() {
                    let buffer = guard.reasoning_buffer.entry(index).or_default();
                    let was_empty = buffer.is_empty();
                    buffer.push_str(&thinking);
                    if was_empty {
                        guard.reasoning_started_at.insert(index, Instant::now());
                    }
                }
                if let Some(event) = try_flush_reasoning_delta(state, index, false) {
                    events.push(event);
                }
            }
            ContentDelta::Other => {}
        },
        AnthropicStreamEvent::ContentBlockStop { index } => {
            // block 结束时强制 flush 文本。
            if let Some(event) = try_flush_text_delta(state, index, true) {
                events.push(event);
            }
            // thinking 块结束：强制 flush 完整 reasoning 文本，并带上 per-block 计时。
            if let Some(event) = try_flush_reasoning_delta(state, index, true) {
                events.push(event);
            }
            // 工具入参完成：发 ToolCall（Running，等 assistant 完整消息或 tool_result 回填）。
            if let Ok(guard) = state.lock() {
                if let Some((id, name)) = guard.tool_index.get(&index).cloned() {
                    let input_json = guard
                        .tool_input_buffer
                        .get(&index)
                        .cloned()
                        .unwrap_or_default();
                    let input: Value = serde_json::from_str(&input_json).unwrap_or(Value::Null);
                    let (detail, tool_name) = map_tool_use_from_input(&name, &input);
                    events.push(timeline_event(
                        turn_id,
                        AgentTimelineItem::ToolCall {
                            call_id: id,
                            name: tool_name,
                            detail,
                            status: ToolCallStatus::Running,
                            error: None,
                        },
                    ));
                }
            }
        }
        AnthropicStreamEvent::MessageStart { usage } => {
            if let Some(usage) = usage {
                events.push(AgentStreamEvent::UsageUpdated {
                    usage: map_usage(&usage),
                });
            }
        }
        AnthropicStreamEvent::MessageDelta { usage, .. } => {
            if let Some(usage) = usage {
                events.push(AgentStreamEvent::UsageUpdated {
                    usage: map_usage(&usage),
                });
            }
        }
        AnthropicStreamEvent::MessageStop | AnthropicStreamEvent::Other => {}
    }
    events
}

/// 尝试 flush 一个 text block 的累积文本（节流）。
///
/// 返回 `Timeline{AssistantMessage}` 事件（带完整累积文本，前端幂等替换）。
/// `force=true` 时无视节流立即 flush（用于 block stop / turn 结束）。
fn try_flush_text_delta(
    state: &Arc<Mutex<SessionState>>,
    index: usize,
    force: bool,
) -> Option<AgentStreamEvent> {
    let now = Instant::now();
    let mut guard = state.lock().ok()?;
    let text = guard.text_buffer.get(&index).cloned()?;
    if text.is_empty() {
        return None;
    }
    let flushed_len = guard.text_flushed_len.get(&index).copied().unwrap_or(0);
    if text.len() == flushed_len {
        return None;
    }
    let should_flush = force
        || match guard.text_last_flush_at.get(&index) {
            Some(last) => now.duration_since(*last) >= DELTA_FLUSH_INTERVAL,
            None => true,
        };
    if !should_flush {
        return None;
    }
    guard.text_last_flush_at.insert(index, now);
    guard.text_flushed_len.insert(index, text.len());
    let turn_id = guard.current_turn_id.clone();
    // 返回完整文本作为 AssistantMessage（message_id 用 block index 派生）。
    Some(AgentStreamEvent::Timeline {
        item: AgentTimelineItem::AssistantMessage {
            text,
            message_id: Some(format!("claude-text-{index}")),
        },
        turn_id,
        seq: 0,
        timestamp: now_ms(),
    })
}

/// 强制 flush 所有残留的 text 增量（turn 结束 / assistant 完整消息到来时）。
fn flush_all_text_deltas(
    state: &Arc<Mutex<SessionState>>,
    _turn_id: &Option<String>,
) -> Vec<AgentStreamEvent> {
    let indices: Vec<usize> = state
        .lock()
        .ok()
        .map(|guard| guard.text_buffer.keys().copied().collect())
        .unwrap_or_default();
    indices
        .into_iter()
        .filter_map(|index| try_flush_text_delta(state, index, true))
        .collect()
}

/// 尝试 flush 一个 reasoning（thinking）block 的累积文本（节流）。
///
/// 返回 `Timeline{Reasoning}` 事件（带完整累积文本，前端幂等替换）。
/// `force=true` 时无视节流立即 flush（用于 block stop / turn 结束），
/// 此时若存在块开始时间，则计算并携带 `duration_ms`，供前端展示
/// 「思考过程 持续了 X 秒」。中间节流 flush 不携带 duration（块尚未结束）。
fn try_flush_reasoning_delta(
    state: &Arc<Mutex<SessionState>>,
    index: usize,
    force: bool,
) -> Option<AgentStreamEvent> {
    let now = Instant::now();
    let mut guard = state.lock().ok()?;
    let text = guard.reasoning_buffer.get(&index).cloned()?;
    if text.is_empty() {
        return None;
    }
    let flushed_len = guard
        .reasoning_flushed_len
        .get(&index)
        .copied()
        .unwrap_or(0);
    let text_changed = text.len() != flushed_len;
    // 块结束（force）时即使文本未变，也可能需要补发 duration（节流 flush 不带 duration）。
    // 仅当 force 且存在 started_at 时，允许「文本未变但补 duration」的一次广播。
    let has_duration_to_emit = force
        && guard
            .reasoning_started_at
            .get(&index)
            .map(|started| now.duration_since(*started).as_millis() > 0)
            .unwrap_or(false);
    if !text_changed && !has_duration_to_emit {
        return None;
    }
    let should_flush = force
        || text_changed
        || match guard.reasoning_last_flush_at.get(&index) {
            Some(last) => now.duration_since(*last) >= DELTA_FLUSH_INTERVAL,
            None => true,
        };
    if !should_flush {
        return None;
    }
    guard.reasoning_last_flush_at.insert(index, now);
    // 补发 duration 后清除 started_at，避免后续重复补发。
    let duration_ms = if force {
        guard
            .reasoning_started_at
            .remove(&index)
            .map(|started| now.duration_since(started).as_millis() as u64)
    } else {
        None
    };
    // 若文本未变（仅补 duration），不更新 flushed_len，保持已 flush 状态。
    if text_changed {
        guard.reasoning_flushed_len.insert(index, text.len());
    }
    let turn_id = guard.current_turn_id.clone();
    Some(AgentStreamEvent::Timeline {
        item: AgentTimelineItem::Reasoning { text, duration_ms },
        turn_id,
        seq: 0,
        timestamp: now_ms(),
    })
}

/// 强制 flush 所有残留的 reasoning 增量（turn 结束 / assistant 完整消息到来时）。
fn flush_all_reasoning_deltas(
    state: &Arc<Mutex<SessionState>>,
    _turn_id: &Option<String>,
) -> Vec<AgentStreamEvent> {
    let indices: Vec<usize> = state
        .lock()
        .ok()
        .map(|guard| guard.reasoning_buffer.keys().copied().collect())
        .unwrap_or_default();
    indices
        .into_iter()
        .filter_map(|index| try_flush_reasoning_delta(state, index, true))
        .collect()
}

/// 进程退出处理：返回是否已 finalize（发过 result）。
fn handle_process_exit(state: &Arc<Mutex<SessionState>>, _reason: &str) -> bool {
    if let Ok(mut guard) = state.lock() {
        let finalized = guard.turn_finalized;
        guard.current_turn_id = None;
        guard.turn_finalized = true;
        finalized
    } else {
        true
    }
}

/// 由 tool_name 和 input 构造 ToolCallDetail（复用 event_mapper 的映射逻辑）。
fn map_tool_use_from_input(name: &str, input: &Value) -> (ToolCallDetail, String) {
    use super::event_mapper::map_assistant_blocks;
    let block = super::message::AssistantBlock::ToolUse {
        id: String::new(),
        name: name.to_string(),
        input: input.clone(),
    };
    match map_assistant_blocks(&[block]).into_iter().next() {
        Some(MappedBlock::ToolUse { detail, name, .. }) => (detail, name),
        _ => (
            ToolCallDetail::Unknown {
                raw_input: serde_json::to_string(input).ok(),
                raw_output: None,
            },
            name.to_string(),
        ),
    }
}

fn tool_name_for_patch(patch: &ToolResultPatch) -> String {
    match patch {
        ToolResultPatch::Shell { .. } => "shell".into(),
        ToolResultPatch::Read { .. } => "read".into(),
        ToolResultPatch::Unknown { .. } => "tool".into(),
    }
}

fn patch_detail(patch: ToolResultPatch) -> ToolCallDetail {
    match patch {
        ToolResultPatch::Shell { output, exit_code } => ToolCallDetail::Shell {
            command: String::new(),
            output,
            exit_code,
        },
        ToolResultPatch::Read { content } => ToolCallDetail::Read {
            path: String::new(),
            content,
        },
        ToolResultPatch::Unknown { raw_output } => ToolCallDetail::Unknown {
            raw_input: None,
            raw_output,
        },
    }
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
    use serde_json::json;

    #[test]
    fn build_args_without_resume_or_model() {
        let args = build_claude_args("hello", None, None);
        assert_eq!(args[0], "-p");
        assert_eq!(args[1], "hello");
        assert!(args.contains(&"--output-format".to_string()));
        assert!(args.contains(&"stream-json".to_string()));
        assert!(args.contains(&"--permission-mode".to_string()));
        assert!(args.contains(&"bypassPermissions".to_string()));
        assert!(!args.contains(&"--resume".into()));
        assert!(!args.contains(&"--model".into()));
    }

    #[test]
    fn build_args_with_resume_and_model() {
        let args = build_claude_args("hi", Some("sess-123"), Some("glm-5.2"));
        assert!(args.contains(&"--resume".into()));
        assert!(args.contains(&"sess-123".into()));
        assert!(args.contains(&"--model".into()));
        assert!(args.contains(&"glm-5.2".into()));
    }

    #[test]
    fn system_init_records_session_id_and_broadcasts_thread_started() {
        let state = test_state(None);
        let config = test_config();
        let events = build_events(
            &state,
            &config,
            &Some("t1".into()),
            ClaudeStreamMessage::SystemInit {
                session_id: "abc".into(),
                model: Some("glm-5.2".into()),
                cwd: Some("/tmp".into()),
                tools: vec![],
            },
        );
        // SystemInit 带 session_id 和 model 时广播两个事件：
        // ThreadStarted（对齐前端契约）+ ModelChanged（让前端展示当前模型）。
        assert_eq!(events.len(), 2);
        assert!(matches!(
            &events[0],
            AgentStreamEvent::ThreadStarted { thread_id } if thread_id == "abc"
        ));
        assert!(matches!(
            &events[1],
            AgentStreamEvent::ModelChanged { model_id } if model_id == "glm-5.2"
        ));
        let guard = state.lock().unwrap();
        assert_eq!(guard.session_id.as_deref(), Some("abc"));
        assert_eq!(guard.current_model.as_deref(), Some("glm-5.2"));
        assert_eq!(guard.last_known_cwd.as_deref(), Some("/tmp"));
    }

    #[test]
    fn result_success_broadcasts_turn_completed() {
        let state = test_state(Some("abc".into()));
        let config = test_config();
        let events = build_events(
            &state,
            &config,
            &Some("t1".into()),
            ClaudeStreamMessage::Result {
                subtype: "success".into(),
                is_error: false,
                result_text: Some("OK".into()),
                session_id: Some("abc".into()),
                usage: None,
                errors: vec![],
                stop_reason: Some("end_turn".into()),
            },
        );
        assert!(events
            .iter()
            .any(|e| matches!(e, AgentStreamEvent::TurnCompleted { .. })));
        let guard = state.lock().unwrap();
        assert!(guard.turn_finalized);
    }

    #[test]
    fn result_error_broadcasts_turn_failed() {
        let state = test_state(Some("abc".into()));
        let config = test_config();
        let events = build_events(
            &state,
            &config,
            &Some("t1".into()),
            ClaudeStreamMessage::Result {
                subtype: "error_max_turns".into(),
                is_error: true,
                result_text: None,
                session_id: None,
                usage: None,
                errors: vec!["超过最大轮次".into()],
                stop_reason: None,
            },
        );
        assert!(events.iter().any(|e| matches!(
            e,
            AgentStreamEvent::TurnFailed { error, .. } if error == "超过最大轮次"
        )));
    }

    #[test]
    fn assistant_message_broadcasts_text_and_tool_use() {
        use super::super::message::AssistantBlock;
        let state = test_state(Some("abc".into()));
        let config = test_config();
        let events = build_events(
            &state,
            &config,
            &Some("t1".into()),
            ClaudeStreamMessage::Assistant {
                message: super::super::message::AssistantMessage {
                    blocks: vec![
                        AssistantBlock::Text {
                            text: "running ls".into(),
                        },
                        AssistantBlock::ToolUse {
                            id: "tool_1".into(),
                            name: "Bash".into(),
                            input: json!({ "command": "ls" }),
                        },
                    ],
                    usage: None,
                },
                session_id: None,
            },
        );
        assert!(events.iter().any(|e| matches!(
            e,
            AgentStreamEvent::Timeline {
                item: AgentTimelineItem::AssistantMessage { text, .. },
                ..
            } if text == "running ls"
        )));
        assert!(events.iter().any(|e| matches!(
            e,
            AgentStreamEvent::Timeline {
                item: AgentTimelineItem::ToolCall { name, .. },
                ..
            } if name == "shell"
        )));
    }

    #[test]
    fn thinking_delta_accumulates_and_flushes_full_text_on_block_stop() {
        use super::super::message::AnthropicStreamEvent;
        use std::time::Duration;

        let state = test_state(Some("abc".into()));
        let turn_id = Some("t1".into());

        // 首帧：ContentBlockStart::Thinking 累积起始文本（与 Text 一致，不立即 flush）。
        let events_start = handle_stream_event(
            &state,
            &turn_id,
            AnthropicStreamEvent::ContentBlockStart {
                index: 0,
                block: ContentBlock::Thinking {
                    thinking: "Hello".into(),
                },
            },
        );
        assert!(
            events_start.is_empty(),
            "ContentBlockStart 不应立即 flush（累积阶段），实际：{events_start:?}"
        );

        // 第二个 delta：累积更多文本。等待超过节流间隔后触发节流 flush。
        std::thread::sleep(Duration::from_millis(90));
        let events_delta = handle_stream_event(
            &state,
            &turn_id,
            AnthropicStreamEvent::ContentBlockDelta {
                index: 0,
                delta: ContentDelta::ThinkingDelta {
                    thinking: " world".into(),
                },
            },
        );
        // 节流 flush 应广播完整累积文本 "Hello world"，且不带 duration（块未结束）。
        let reasoning_after_delta = events_delta
            .iter()
            .filter_map(|e| match e {
                AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::Reasoning { text, duration_ms },
                    ..
                } => Some((text.clone(), *duration_ms)),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(
            reasoning_after_delta
                .iter()
                .any(|(t, _)| t == "Hello world"),
            "节流 flush 应广播完整累积文本，实际：{reasoning_after_delta:?}"
        );
        assert!(
            reasoning_after_delta.iter().all(|(_, d)| d.is_none()),
            "节流 flush 不应携带 duration，实际：{reasoning_after_delta:?}"
        );

        // 块结束：ContentBlockStop，force flush 带上 duration。
        let events_stop = handle_stream_event(
            &state,
            &turn_id,
            AnthropicStreamEvent::ContentBlockStop { index: 0 },
        );
        let reasoning_at_stop = events_stop
            .iter()
            .filter_map(|e| match e {
                AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::Reasoning { text, duration_ms },
                    ..
                } => Some((text.clone(), *duration_ms)),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(
            reasoning_at_stop.iter().any(|(t, _)| t == "Hello world"),
            "块结束应 flush 完整文本，实际：{reasoning_at_stop:?}"
        );
        assert!(
            reasoning_at_stop
                .iter()
                .all(|(_, d)| d.is_some_and(|ms| ms > 0)),
            "块结束 flush 应携带非零 duration，实际：{reasoning_at_stop:?}"
        );
    }

    fn test_state(session_id: Option<String>) -> Arc<Mutex<SessionState>> {
        Arc::new(Mutex::new(SessionState {
            session_id,
            current_turn_id: Some("t1".into()),
            current_model: None,
            text_buffer: HashMap::new(),
            text_last_flush_at: HashMap::new(),
            text_flushed_len: HashMap::new(),
            reasoning_buffer: HashMap::new(),
            reasoning_last_flush_at: HashMap::new(),
            reasoning_flushed_len: HashMap::new(),
            reasoning_started_at: HashMap::new(),
            tool_input_buffer: HashMap::new(),
            tool_index: HashMap::new(),
            turn_finalized: false,
            last_known_cwd: None,
        }))
    }

    fn test_config() -> ClaudeSessionConfig {
        ClaudeSessionConfig {
            project_id: 1,
            session_id: 1,
            binary: "claude".into(),
            cwd: "/tmp".into(),
            model: None,
            broadcaster: AgentEventBroadcaster::new(),
            resume_session_id: None,
        }
    }

    /// 真实 claude 进程端到端 smoke test。
    ///
    /// 需要本地安装 claude CLI，用 `cargo test --lib smoke_test_real_claude -- --ignored` 运行。
    /// 验证 transport spawn → message 解析 → event 映射 → AgentStreamEvent 全链路。
    #[test]
    #[ignore]
    fn smoke_test_real_claude_e2e() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc as StdArc;

        // 跳过条件：claude CLI 不存在时直接 pass（CI 环境兼容）。
        if std::process::Command::new("claude")
            .arg("--version")
            .output()
            .is_err()
        {
            eprintln!("跳过：claude CLI 不可用");
            return;
        }

        let args = build_claude_args("say only the word OK", None, None);
        let transport =
            ClaudeTransport::spawn("claude", &args, Some("/tmp")).expect("spawn claude");

        let captured: StdArc<Mutex<Vec<ClaudeStreamMessage>>> = StdArc::new(Mutex::new(Vec::new()));
        let events_captured: StdArc<Mutex<Vec<AgentStreamEvent>>> =
            StdArc::new(Mutex::new(Vec::new()));
        let captured_for_handler = StdArc::clone(&captured);
        let done = StdArc::new(AtomicBool::new(false));
        let done_for_handler = StdArc::clone(&done);

        // 构造一个最小 state 验证 build_events 能把真实消息映射为事件。
        let state = StdArc::new(Mutex::new(SessionState {
            session_id: None,
            current_turn_id: Some("t1".into()),
            current_model: None,
            text_buffer: HashMap::new(),
            text_last_flush_at: HashMap::new(),
            text_flushed_len: HashMap::new(),
            reasoning_buffer: HashMap::new(),
            reasoning_last_flush_at: HashMap::new(),
            reasoning_flushed_len: HashMap::new(),
            reasoning_started_at: HashMap::new(),
            tool_input_buffer: HashMap::new(),
            tool_index: HashMap::new(),
            turn_finalized: false,
            last_known_cwd: None,
        }));
        let config = test_config();
        let state_for_handler = StdArc::clone(&state);
        let config_for_handler = config.clone();
        let events_for_handler = StdArc::clone(&events_captured);
        transport.set_message_handler(Arc::new(move |value| {
            let parsed = crate::agent::claude_streaming::message::parse_message(value);
            let is_result = matches!(parsed, ClaudeStreamMessage::Result { .. });
            let turn_id = Some("t1".to_string());
            let built = build_events(
                &state_for_handler,
                &config_for_handler,
                &turn_id,
                parsed.clone(),
            );
            events_for_handler.lock().unwrap().extend(built);
            captured_for_handler.lock().unwrap().push(parsed);
            if is_result {
                done_for_handler.store(true, Ordering::SeqCst);
            }
        }));

        // 等待 result 到达（最多 60 秒）。
        let rx = transport.subscribe_eof();
        for _ in 0..600 {
            if done.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        // 给一点时间让剩余消息到达。
        std::thread::sleep(std::time::Duration::from_millis(200));
        transport.shutdown();
        let _ = rx.try_recv();

        let messages = captured.lock().unwrap();
        let events = events_captured.lock().unwrap();
        assert!(!messages.is_empty(), "应至少收到一条消息，实际收到 0 条");
        assert!(
            messages.iter().any(|m| matches!(
                m,
                ClaudeStreamMessage::Result {
                    is_error: false,
                    ..
                }
            )),
            "应收到成功的 result 消息，实际消息类型：{:?}",
            messages
                .iter()
                .map(|m| std::mem::discriminant(m))
                .collect::<Vec<_>>()
        );
        // 验证事件流包含 ThreadStarted（来自 system/init）和 TurnCompleted（来自 result）。
        assert!(
            events
                .iter()
                .any(|e| matches!(e, AgentStreamEvent::ThreadStarted { .. })),
            "事件流应包含 ThreadStarted，实际事件：{:?}",
            events
                .iter()
                .map(std::mem::discriminant)
                .collect::<Vec<_>>()
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, AgentStreamEvent::TurnCompleted { .. })),
            "事件流应包含 TurnCompleted，实际事件：{:?}",
            events
                .iter()
                .map(std::mem::discriminant)
                .collect::<Vec<_>>()
        );
        // 验证拿到 session_id（resume 续接的前提）。
        let session_id = state.lock().unwrap().session_id.clone();
        assert!(
            session_id.as_ref().is_some_and(|id| !id.is_empty()),
            "应从 system/init 拿到 session_id，实际：{session_id:?}"
        );
        eprintln!(
            "✓ 端到端验证通过：{} 条消息 → {} 个事件，session_id={:?}",
            messages.len(),
            events.len(),
            session_id
        );
    }
}
