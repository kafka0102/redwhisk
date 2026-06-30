//! 单个 Codex agent session 的会话编排。
//!
//! 持有 `CodexAppServerClient`，负责：
//! - 启动 / 续接 thread（initialize 握手 + thread/start 或 thread/resume）
//! - 注册 notification handler，把 `CodexNotification` 归一化为
//!   `AgentStreamEvent` 并经 `AgentEventBroadcaster` 广播
//! - 注册 server→client request handler（commandExecution / fileChange
//!   审批），转成 `PermissionRequested` 事件并挂起，等待前端
//!   `respond_permission` 回调
//! - 累积 agent_message / reasoning 增量，避免每个 delta 都广播一条
//!   timeline 事件（首版采用简单 append）
//!
//! 本模块只做会话级编排，不做持久化（timeline 持久化在任务 3 的
//! service 层处理）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use super::client::{
    text_user_input, CodexAppServerClient, InitializeParams, PermissionDecision, SandboxPolicy,
    TurnInput, TurnStartParams,
};
use super::notification::{parse_notification, CodexNotification};
use super::thread_item::{extract_usage, map_thread_item};
use super::transport::{CodexAppServerError, CodexTransport, RequestHandler};
use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::types::agent_session::{AgentMessageAttachment, AgentPermissionDecision};
use crate::types::agent_session_stream::{
    AgentMode, AgentModel, AgentPermissionAction, AgentPermissionRequest, AgentStreamEvent,
    AgentTimelineItem, AgentUsage, PermissionBehavior, PermissionKind, ToolCallStatus,
};

const DELTA_FLUSH_INTERVAL: Duration = Duration::from_millis(80);

/// codex mode 预设（approvalPolicy + sandbox）。
///
/// codex mode 预设：auto（默认）/ full-access / read-only。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexMode {
    Auto,
    FullAccess,
    ReadOnly,
}

impl CodexMode {
    pub fn id(self) -> &'static str {
        match self {
            CodexMode::Auto => "auto",
            CodexMode::FullAccess => "full-access",
            CodexMode::ReadOnly => "read-only",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "auto" => Some(CodexMode::Auto),
            "full-access" => Some(CodexMode::FullAccess),
            "read-only" => Some(CodexMode::ReadOnly),
            _ => None,
        }
    }

    pub fn approval_policy(self) -> &'static str {
        match self {
            CodexMode::Auto | CodexMode::ReadOnly => "on-request",
            CodexMode::FullAccess => "never",
        }
    }

    pub fn sandbox_policy(self) -> SandboxPolicy {
        match self {
            CodexMode::ReadOnly => SandboxPolicy::ReadOnly,
            CodexMode::Auto => SandboxPolicy::WorkspaceWrite {
                network_access: false,
            },
            CodexMode::FullAccess => SandboxPolicy::DangerFullAccess,
        }
    }

    pub fn available_modes() -> Vec<AgentMode> {
        vec![
            AgentMode {
                mode_id: "auto".into(),
                name: Some("Default Permissions".into()),
            },
            AgentMode {
                mode_id: "full-access".into(),
                name: Some("Full Access".into()),
            },
            AgentMode {
                mode_id: "read-only".into(),
                name: Some("Read Only".into()),
            },
        ]
    }
}

/// session 启动配置。
#[derive(Clone)]
pub struct CodexSessionConfig {
    pub project_id: i64,
    pub session_id: i64,
    /// codex 可执行路径（通常 `codex`）。
    pub binary: String,
    pub cwd: String,
    pub mode: CodexMode,
    pub broadcaster: AgentEventBroadcaster,
    /// 续接已存在的 codex threadId；为 None 时新建 thread。
    pub resume_thread_id: Option<String>,
    /// 初始模型（None 时由 codex 选默认）。
    pub model: Option<String>,
    /// 初始 reasoning effort，由模型能力声明。
    pub effort: Option<String>,
}

/// 会话级共享状态（Arc + Mutex，供 notification handler 线程访问）。
struct SessionState {
    thread_id: Option<String>,
    current_turn_id: Option<String>,
    current_mode: CodexMode,
    model: Option<String>,
    effort: Option<String>,
    /// 增量累积的 assistant 文本：item_id → 已累积文本。
    agent_message_buffer: HashMap<String, String>,
    /// assistant 文本上次广播时间：item_id → flush 时间。
    agent_message_last_flush_at: HashMap<String, Instant>,
    /// assistant 文本上次广播字节长度：item_id → 已广播长度。
    agent_message_flushed_len: HashMap<String, usize>,
    /// 增量累积的 reasoning 文本：item_id → 已累积文本。
    reasoning_buffer: HashMap<String, String>,
    /// reasoning 文本上次广播时间：item_id → flush 时间。
    reasoning_last_flush_at: HashMap<String, Instant>,
    /// reasoning 文本上次广播字节长度：item_id → 已广播长度。
    reasoning_flushed_len: HashMap<String, usize>,
    /// 挂起的权限请求：request_id → 决策 oneshot sender。
    pending_permissions: HashMap<String, PendingPermission>,
    /// 最新一次 token 用量，供前端 context meter 复用。
    latest_usage: Option<AgentUsage>,
}

struct PendingPermission {
    /// 通过此 sender 把用户决策送回 server→client request handler。
    sender: std::sync::mpsc::Sender<PermissionDecision>,
}

/// Codex session 句柄。
///
/// 持有 client 与共享状态。`shutdown` 关闭底层传输。
pub struct CodexSessionHandle {
    client: CodexAppServerClient,
    state: Arc<Mutex<SessionState>>,
    config: CodexSessionConfig,
}

impl CodexSessionHandle {
    /// 启动并初始化 session。
    ///
    /// 流程：spawn codex → initialize 握手 → thread/start 或 thread/resume
    /// → 注册 notification / request handler。返回可操作的句柄。
    pub fn start(config: CodexSessionConfig) -> Result<Self, CodexAppServerError> {
        let transport = CodexTransport::spawn(&config.binary, Some(&config.cwd))?;
        let client = CodexAppServerClient::new(transport);

        // 握手
        client.initialize(&InitializeParams::default())?;

        // thread 创建 / 续接
        let thread_id = if let Some(existing) = &config.resume_thread_id {
            // 已存在的 thread：先确认是否在 codex 已加载列表，否则 resume。
            let loaded = client.thread_loaded_list().unwrap_or_default();
            if !loaded.iter().any(|id| id == existing) {
                client.thread_resume(existing)?;
            }
            existing.clone()
        } else {
            let preset_mode = config.mode;
            client.thread_start(
                config.model.as_deref(),
                Some(&config.cwd),
                preset_mode.approval_policy(),
                preset_mode.sandbox_policy_label(),
            )?
        };

        let state = Arc::new(Mutex::new(SessionState {
            thread_id: Some(thread_id.clone()),
            current_turn_id: None,
            current_mode: config.mode,
            model: config.model.clone(),
            effort: config.effort.clone(),
            agent_message_buffer: HashMap::new(),
            agent_message_last_flush_at: HashMap::new(),
            agent_message_flushed_len: HashMap::new(),
            reasoning_buffer: HashMap::new(),
            reasoning_last_flush_at: HashMap::new(),
            reasoning_flushed_len: HashMap::new(),
            pending_permissions: HashMap::new(),
            latest_usage: None,
        }));

        // 注册 notification handler
        let notification_state = Arc::clone(&state);
        let notification_config = config.clone();
        client
            .transport()
            .set_notification_handler(Arc::new(move |method, params| {
                handle_notification(&notification_state, &notification_config, method, params);
            }));

        // 注册审批 request handler
        register_approval_handlers(&client, Arc::clone(&state), config.clone());

        // 广播 thread_started
        config.broadcaster.emit_stream_event(
            config.project_id,
            config.session_id,
            AgentStreamEvent::ThreadStarted { thread_id },
        );
        if config.effort.is_some() {
            config.broadcaster.emit_stream_event(
                config.project_id,
                config.session_id,
                AgentStreamEvent::EffortChanged {
                    effort: config.effort.clone(),
                },
            );
        }

        Ok(Self {
            client,
            state,
            config,
        })
    }

    /// 发送用户消息（发起一轮 turn）。
    ///
    /// `attachments` 非空时切换为 `TurnInput::Blocks`，把附件编码为文本路径
    /// 引用块追加在用户文本之后；为空时保持 `TurnInput::Text` 向后兼容。
    pub fn send_message(
        &self,
        text: String,
        attachments: Vec<AgentMessageAttachment>,
    ) -> Result<(), CodexAppServerError> {
        let (thread_id, model, effort, mode) = {
            let state = self
                .state
                .lock()
                .map_err(|_| CodexAppServerError::Protocol("session 锁中毒".into()))?;
            (
                state.thread_id.clone(),
                state.model.clone(),
                state.effort.clone(),
                state.current_mode,
            )
        };

        let thread_id = thread_id
            .ok_or_else(|| CodexAppServerError::Protocol("session 尚未拿到 threadId".into()))?;

        let params = TurnStartParams {
            thread_id,
            input: build_turn_input(text, &attachments),
            model,
            effort,
            approval_policy: mode.approval_policy().to_string(),
            sandbox_policy: mode.sandbox_policy(),
            cwd: Some(self.config.cwd.clone()),
            developer_instructions: None,
        };
        self.client.turn_start(&params)?;
        Ok(())
    }

    /// 中断当前 turn。无 turn 运行时直接返回 `Ok(())`。
    ///
    /// 通过 codex `turn/interrupt` 请求实现；codex 随后会广播
    /// `turn/completed`（status 通常为 `canceled`）。
    pub fn cancel_turn(&self) -> Result<(), CodexAppServerError> {
        let (thread_id, turn_id) = {
            let state = self
                .state
                .lock()
                .map_err(|_| CodexAppServerError::Protocol("session 锁中毒".into()))?;
            (state.thread_id.clone(), state.current_turn_id.clone())
        };
        let Some(turn_id) = turn_id else {
            return Ok(());
        };
        let thread_id = thread_id
            .ok_or_else(|| CodexAppServerError::Protocol("session 尚未拿到 threadId".into()))?;
        self.client.turn_interrupt(&thread_id, &turn_id)?;
        Ok(())
    }

    /// 回复一个挂起的权限请求。
    pub fn respond_permission(
        &self,
        request_id: &str,
        decision: PermissionDecision,
    ) -> Result<(), CodexAppServerError> {
        let pending = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| CodexAppServerError::Protocol("session 锁中毒".into()))?;
            state.pending_permissions.remove(request_id)
        };
        let pending = pending.ok_or_else(|| {
            CodexAppServerError::Protocol(format!("未找到挂起的权限请求: {request_id}"))
        })?;
        pending
            .sender
            .send(decision)
            .map_err(|_| CodexAppServerError::Protocol("权限决策通道已关闭".into()))?;

        // 广播 permission_resolved
        self.config.broadcaster.emit_stream_event(
            self.config.project_id,
            self.config.session_id,
            AgentStreamEvent::PermissionResolved {
                request_id: request_id.to_string(),
                resolution: decision.as_str().to_string(),
            },
        );
        Ok(())
    }

    /// 切换模型。下一次 turn/start 会带上新 model。
    pub fn set_model(&self, model_id: String) -> Result<(), CodexAppServerError> {
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| CodexAppServerError::Protocol("session 锁中毒".into()))?;
            state.model = Some(model_id.clone());
        }
        self.config.broadcaster.emit_stream_event(
            self.config.project_id,
            self.config.session_id,
            AgentStreamEvent::ModelChanged { model_id },
        );
        Ok(())
    }

    /// 切换 reasoning effort（Think 模式）。
    pub fn set_effort(&self, effort: Option<String>) -> Result<(), CodexAppServerError> {
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| CodexAppServerError::Protocol("session 锁中毒".into()))?;
            state.effort = effort.clone();
        }
        self.config.broadcaster.emit_stream_event(
            self.config.project_id,
            self.config.session_id,
            AgentStreamEvent::EffortChanged { effort },
        );
        Ok(())
    }

    /// 切换协作模式。
    pub fn set_mode(&self, mode: CodexMode) -> Result<(), CodexAppServerError> {
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| CodexAppServerError::Protocol("session 锁中毒".into()))?;
            state.current_mode = mode;
        }
        self.config.broadcaster.emit_stream_event(
            self.config.project_id,
            self.config.session_id,
            AgentStreamEvent::ModeChanged {
                current_mode_id: mode.id().to_string(),
                available_modes: CodexMode::available_modes(),
            },
        );
        Ok(())
    }

    /// 列出可用模型。
    pub fn list_models(&self) -> Result<Vec<AgentModel>, CodexAppServerError> {
        Ok(default_codex_models())
    }

    /// 列出可用模式。
    pub fn list_modes(&self) -> Vec<AgentMode> {
        CodexMode::available_modes()
    }

    /// 读取 thread 历史并映射为 timeline items。
    ///
    /// 供前端首次进入 session 时回放历史。返回的 timeline 顺序与 codex
    /// thread 一致；user_message 默认包含。
    pub fn read_timeline(&self) -> Result<Vec<AgentTimelineItem>, CodexAppServerError> {
        let thread_id = {
            let state = self
                .state
                .lock()
                .map_err(|_| CodexAppServerError::Protocol("session 锁中毒".into()))?;
            state.thread_id.clone()
        };
        let thread_id = thread_id
            .ok_or_else(|| CodexAppServerError::Protocol("session 尚未拿到 threadId".into()))?;

        let response = self.client.thread_read(&thread_id)?;
        let mut timeline = Vec::new();
        if let Some(turns) = response
            .raw
            .get("thread")
            .and_then(|thread| thread.get("turns"))
            .and_then(Value::as_array)
        {
            for turn in turns {
                if let Some(items) = turn.get("items").and_then(Value::as_array) {
                    for item in items {
                        if let Some(timeline_item) = map_thread_item(item, true) {
                            timeline.push(timeline_item);
                        }
                    }
                }
            }
        }
        Ok(timeline)
    }

    /// 关闭 session：关闭传输、注销游标。
    pub fn shutdown(&self) {
        self.client.transport().shutdown();
        self.config
            .broadcaster
            .unregister_session(self.config.session_id);
    }

    pub fn thread_id(&self) -> Option<String> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.thread_id.clone())
    }
}

pub fn default_codex_models() -> Vec<AgentModel> {
    vec![AgentModel {
        model_id: "gpt-5".into(),
        display_name: Some("GPT-5".into()),
        is_default: Some(true),
        default_reasoning_effort: Some("medium".into()),
        supported_reasoning_efforts: vec![
            "low".into(),
            "medium".into(),
            "high".into(),
            "xhigh".into(),
        ],
    }]
}

pub fn list_models_with_command(
    binary: &str,
    cwd: Option<&str>,
) -> Result<Vec<AgentModel>, CodexAppServerError> {
    let transport = CodexTransport::spawn(binary, cwd)?;
    let client = CodexAppServerClient::new(transport.clone());
    let result = (|| {
        client.initialize(&InitializeParams::default())?;
        Ok(map_model_entries(client.model_list()?))
    })();
    transport.shutdown();
    result
}

fn map_model_entries(entries: Vec<super::client::CodexModelEntry>) -> Vec<AgentModel> {
    entries
        .into_iter()
        .map(|entry| AgentModel {
            model_id: entry.id,
            display_name: entry.display_name,
            is_default: entry.is_default,
            default_reasoning_effort: entry.default_reasoning_effort,
            supported_reasoning_efforts: entry.supported_reasoning_efforts,
        })
        .collect()
}

/// 将协议无关的 `AgentPermissionDecision` 转为 codex 内部的 `PermissionDecision`。
///
/// 两者都是 accept/decline/cancel 三态，仅类型归属不同；转换零成本。
fn to_codex_decision(decision: AgentPermissionDecision) -> PermissionDecision {
    match decision {
        AgentPermissionDecision::Accept => PermissionDecision::Accept,
        AgentPermissionDecision::Decline => PermissionDecision::Decline,
        AgentPermissionDecision::Cancel => PermissionDecision::Cancel,
    }
}

/// 把用户文本与附件编码为 `turn/start` 的 `input`。
///
/// - 附件为空：`TurnInput::Text(text)`，保持向后兼容（codex 原生文本路径）。
/// - 附件非空：`TurnInput::Blocks`，首个块为用户文本，其后每个附件追加一个
///   text 块，内容为 `[附件] {display_name}: {path}`。
///
/// 首版统一用文本路径引用而非 image/file block：codex app-server 的 image
/// 输入块 schema 在本仓库未类型化（仅 text 块被测试证实），文本路径引用
/// 零协议风险、立即可用；image block 接入留作后续独立任务。
fn build_turn_input(text: String, attachments: &[AgentMessageAttachment]) -> TurnInput {
    if attachments.is_empty() {
        return TurnInput::Text(text);
    }
    let mut blocks = vec![text_user_input(&text)];
    for attachment in attachments {
        blocks.push(text_user_input(&format!(
            "[附件] {}: {}",
            attachment.display_name, attachment.path
        )));
    }
    TurnInput::Blocks(blocks)
}

impl AgentSessionHandle for CodexSessionHandle {
    fn send_message(
        &self,
        text: String,
        attachments: Vec<AgentMessageAttachment>,
    ) -> Result<(), AgentSessionError> {
        CodexSessionHandle::send_message(self, text, attachments).map_err(AgentSessionError::from)
    }

    fn cancel_turn(&self) -> Result<(), AgentSessionError> {
        CodexSessionHandle::cancel_turn(self).map_err(AgentSessionError::from)
    }

    fn respond_permission(
        &self,
        request_id: &str,
        decision: AgentPermissionDecision,
    ) -> Result<(), AgentSessionError> {
        CodexSessionHandle::respond_permission(self, request_id, to_codex_decision(decision))
            .map_err(AgentSessionError::from)
    }

    fn set_model(&self, model_id: String) -> Result<(), AgentSessionError> {
        CodexSessionHandle::set_model(self, model_id).map_err(AgentSessionError::from)
    }

    fn set_effort(&self, effort: Option<String>) -> Result<(), AgentSessionError> {
        CodexSessionHandle::set_effort(self, effort).map_err(AgentSessionError::from)
    }

    fn set_mode(&self, mode_id: &str) -> Result<(), AgentSessionError> {
        let mode = CodexMode::from_id(mode_id)
            .ok_or_else(|| AgentSessionError::UnsupportedMode(mode_id.to_string()))?;
        CodexSessionHandle::set_mode(self, mode).map_err(AgentSessionError::from)
    }

    fn list_models(&self) -> Result<Vec<AgentModel>, AgentSessionError> {
        CodexSessionHandle::list_models(self).map_err(AgentSessionError::from)
    }

    fn list_modes(&self) -> Vec<AgentMode> {
        CodexSessionHandle::list_modes(self)
    }

    fn read_timeline(&self) -> Result<Vec<AgentTimelineItem>, AgentSessionError> {
        CodexSessionHandle::read_timeline(self).map_err(AgentSessionError::from)
    }

    fn shutdown(&self) {
        CodexSessionHandle::shutdown(self)
    }

    fn thread_id(&self) -> Option<String> {
        CodexSessionHandle::thread_id(self)
    }
}

impl CodexMode {
    /// codex `thread/start` 的 sandbox 字符串值。
    ///
    /// 注意：thread/start 用字符串 sandbox（`workspace-write`），而
    /// turn/start 用结构化 sandboxPolicy（`{type: "workspaceWrite"}`）。
    fn sandbox_policy_label(self) -> &'static str {
        match self {
            CodexMode::ReadOnly => "read-only",
            CodexMode::Auto => "workspace-write",
            CodexMode::FullAccess => "danger-full-access",
        }
    }
}

fn handle_notification(
    state: &Arc<Mutex<SessionState>>,
    config: &CodexSessionConfig,
    method: &str,
    params: &Value,
) {
    let notification = parse_notification(method, params);
    let events = build_events(state, notification);
    for event in events {
        config
            .broadcaster
            .emit_stream_event(config.project_id, config.session_id, event);
    }
}

/// 把一条 `CodexNotification` 转成 0..N 条 `AgentStreamEvent`。
fn build_events(
    state: &Arc<Mutex<SessionState>>,
    notification: CodexNotification,
) -> Vec<AgentStreamEvent> {
    match notification {
        CodexNotification::ThreadStarted { thread_id } => {
            if let Ok(mut state) = state.lock() {
                state.thread_id = Some(thread_id.clone());
            }
            vec![AgentStreamEvent::ThreadStarted { thread_id }]
        }
        CodexNotification::TurnStarted {
            turn_id,
            thread_id: _,
        } => {
            if let Ok(mut state) = state.lock() {
                state.current_turn_id = Some(turn_id.clone());
            }
            vec![AgentStreamEvent::TurnStarted {
                turn_id: Some(turn_id),
            }]
        }
        CodexNotification::TurnCompleted {
            turn_id,
            thread_id: _,
            status,
            error_message,
        } => {
            let mut events = flush_all_pending_deltas(state);
            let usage = state.lock().ok().and_then(|mut state| {
                state.current_turn_id = None;
                state.latest_usage.clone()
            });
            if status == "failed" || status == "aborted" {
                events.push(AgentStreamEvent::TurnFailed {
                    turn_id,
                    error: error_message.unwrap_or_else(|| status.clone()),
                    code: Some(status),
                });
            } else {
                events.push(AgentStreamEvent::TurnCompleted { turn_id, usage });
            }
            events
        }
        CodexNotification::TokenUsageUpdated { token_usage } => {
            let usage = extract_usage(&token_usage);
            if let Some(usage) = usage.clone() {
                if let Ok(mut state) = state.lock() {
                    state.latest_usage = Some(usage.clone());
                }
                vec![AgentStreamEvent::UsageUpdated { usage }]
            } else {
                Vec::new()
            }
        }
        CodexNotification::ContextCompacted {
            thread_id: _,
            turn_id: _,
        } => {
            vec![AgentStreamEvent::Timeline {
                item: AgentTimelineItem::Compaction {
                    status: crate::types::agent_session_stream::CompactionStatus::Completed,
                },
                turn_id: None,
                seq: next_seq(),
                timestamp: now_ms(),
            }]
        }
        CodexNotification::AgentMessageDelta {
            item_id,
            delta,
            thread_id: _,
        } => {
            {
                let mut state = match state.lock() {
                    Ok(state) => state,
                    Err(_) => return Vec::new(),
                };
                let buffer = state
                    .agent_message_buffer
                    .entry(item_id.clone())
                    .or_default();
                buffer.push_str(&delta);
            }
            flush_agent_message_delta(state, &item_id, false)
        }
        CodexNotification::ReasoningDelta {
            item_id,
            delta,
            thread_id: _,
        } => {
            {
                let mut state = match state.lock() {
                    Ok(state) => state,
                    Err(_) => return Vec::new(),
                };
                let buffer = state.reasoning_buffer.entry(item_id.clone()).or_default();
                buffer.push_str(&delta);
            }
            flush_reasoning_delta(state, &item_id, false)
        }
        CodexNotification::ItemStarted { item, thread_id: _ } => {
            build_item_event(state, &item, true)
        }
        CodexNotification::ItemCompleted { item, thread_id: _ } => {
            build_item_event(state, &item, false)
        }
        CodexNotification::TerminalInteraction {
            item_id: _,
            process_id: _,
            stdin: _,
        } => {
            // 首版不单独广播 terminal interaction；commandExecution 已覆盖。
            Vec::new()
        }
        CodexNotification::FileChangeOutputDelta {
            item_id: _,
            delta: _,
        } => Vec::new(),
        CodexNotification::PlanUpdated { plan: _ } => Vec::new(),
        CodexNotification::DiffUpdated { diff: _ } => Vec::new(),
        CodexNotification::Unknown {
            method: _,
            params: _,
        } => Vec::new(),
    }
}

fn build_item_event(
    state: &Arc<Mutex<SessionState>>,
    item: &Value,
    is_started: bool,
) -> Vec<AgentStreamEvent> {
    // item/started 与 item/completed 都映射为同一条 timeline 项；status 由
    // map_thread_item 根据 item 自身字段决定。对于 started 且无 status 的
    // commandExecution，强制标记 running。
    let mut timeline_item = match map_thread_item(item, true) {
        Some(item) => item,
        None => return Vec::new(),
    };

    if is_started {
        if let AgentTimelineItem::ToolCall { status, .. } = &mut timeline_item {
            // started 事件若无显式 status，标记 running。
            if *status == ToolCallStatus::Completed {
                *status = ToolCallStatus::Running;
            }
        }
    } else {
        let mut events = Vec::new();
        // item/completed 后清掉对应增量缓冲（如果存在）。
        if let Some(item_id) = item.get("id").and_then(Value::as_str) {
            events.extend(flush_agent_message_delta(state, item_id, true));
            events.extend(flush_reasoning_delta(state, item_id, true));
            if let Ok(mut state) = state.lock() {
                state.agent_message_buffer.remove(item_id);
                state.agent_message_last_flush_at.remove(item_id);
                state.agent_message_flushed_len.remove(item_id);
                state.reasoning_buffer.remove(item_id);
                state.reasoning_last_flush_at.remove(item_id);
                state.reasoning_flushed_len.remove(item_id);
            }
        }
        let turn_id = state
            .lock()
            .ok()
            .and_then(|state| state.current_turn_id.clone());
        events.push(AgentStreamEvent::Timeline {
            item: timeline_item,
            turn_id,
            seq: next_seq(),
            timestamp: now_ms(),
        });
        return events;
    }

    let turn_id = state
        .lock()
        .ok()
        .and_then(|state| state.current_turn_id.clone());

    vec![AgentStreamEvent::Timeline {
        item: timeline_item,
        turn_id,
        seq: next_seq(),
        timestamp: now_ms(),
    }]
}

fn flush_agent_message_delta(
    state: &Arc<Mutex<SessionState>>,
    item_id: &str,
    force: bool,
) -> Vec<AgentStreamEvent> {
    let now = Instant::now();
    let (text, turn_id) = {
        let mut state = match state.lock() {
            Ok(state) => state,
            Err(_) => return Vec::new(),
        };
        let Some(text) = state.agent_message_buffer.get(item_id).cloned() else {
            return Vec::new();
        };
        if text.is_empty() {
            return Vec::new();
        }
        let flushed_len = state
            .agent_message_flushed_len
            .get(item_id)
            .copied()
            .unwrap_or(0);
        if text.len() == flushed_len {
            return Vec::new();
        }
        let should_flush = force
            || match state.agent_message_last_flush_at.get(item_id) {
                Some(last_flush) => now.duration_since(*last_flush) >= DELTA_FLUSH_INTERVAL,
                None => true,
            };
        if !should_flush {
            return Vec::new();
        }
        state
            .agent_message_last_flush_at
            .insert(item_id.to_string(), now);
        state
            .agent_message_flushed_len
            .insert(item_id.to_string(), text.len());
        (text, state.current_turn_id.clone())
    };
    vec![AgentStreamEvent::Timeline {
        item: AgentTimelineItem::AssistantMessage {
            text,
            message_id: Some(item_id.to_string()),
        },
        turn_id,
        seq: next_seq(),
        timestamp: now_ms(),
    }]
}

fn flush_reasoning_delta(
    state: &Arc<Mutex<SessionState>>,
    item_id: &str,
    force: bool,
) -> Vec<AgentStreamEvent> {
    let now = Instant::now();
    let (text, turn_id) = {
        let mut state = match state.lock() {
            Ok(state) => state,
            Err(_) => return Vec::new(),
        };
        let Some(text) = state.reasoning_buffer.get(item_id).cloned() else {
            return Vec::new();
        };
        if text.is_empty() {
            return Vec::new();
        }
        let flushed_len = state
            .reasoning_flushed_len
            .get(item_id)
            .copied()
            .unwrap_or(0);
        if text.len() == flushed_len {
            return Vec::new();
        }
        let should_flush = force
            || match state.reasoning_last_flush_at.get(item_id) {
                Some(last_flush) => now.duration_since(*last_flush) >= DELTA_FLUSH_INTERVAL,
                None => true,
            };
        if !should_flush {
            return Vec::new();
        }
        state
            .reasoning_last_flush_at
            .insert(item_id.to_string(), now);
        state
            .reasoning_flushed_len
            .insert(item_id.to_string(), text.len());
        (text, state.current_turn_id.clone())
    };
    vec![AgentStreamEvent::Timeline {
        item: AgentTimelineItem::Reasoning { text },
        turn_id,
        seq: next_seq(),
        timestamp: now_ms(),
    }]
}

fn flush_all_pending_deltas(state: &Arc<Mutex<SessionState>>) -> Vec<AgentStreamEvent> {
    let (agent_message_ids, reasoning_ids) = match state.lock() {
        Ok(state) => (
            state
                .agent_message_buffer
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            state.reasoning_buffer.keys().cloned().collect::<Vec<_>>(),
        ),
        Err(_) => return Vec::new(),
    };
    let mut events = Vec::new();
    for item_id in agent_message_ids {
        events.extend(flush_agent_message_delta(state, &item_id, true));
    }
    for item_id in reasoning_ids {
        events.extend(flush_reasoning_delta(state, &item_id, true));
    }
    events
}

/// 注册 codex server→client 审批 request handler。
///
/// codex 通过 `item/commandExecution/requestApproval` /
/// `item/fileChange/requestApproval` / `item/tool/requestUserInput` 请求
/// 用户审批。handler 把请求转成 `PermissionRequested` 事件广播，并挂起
/// 等待前端 `respond_permission` 回调。
fn register_approval_handlers(
    client: &CodexAppServerClient,
    state: Arc<Mutex<SessionState>>,
    config: CodexSessionConfig,
) {
    register_one_approval_handler(
        client,
        "item/commandExecution/requestApproval",
        PermissionKind::Tool,
        state.clone(),
        config.clone(),
        extract_command_approval,
    );
    register_one_approval_handler(
        client,
        "item/fileChange/requestApproval",
        PermissionKind::Tool,
        state.clone(),
        config.clone(),
        extract_file_change_approval,
    );
    register_one_approval_handler(
        client,
        "item/tool/requestUserInput",
        PermissionKind::Question,
        state.clone(),
        config.clone(),
        extract_question_approval,
    );
    // 兼容旧版 codex 方法名。
    register_one_approval_handler(
        client,
        "tool/requestUserInput",
        PermissionKind::Question,
        state,
        config,
        extract_question_approval,
    );
}

fn register_one_approval_handler<F>(
    client: &CodexAppServerClient,
    method: &'static str,
    kind: PermissionKind,
    state: Arc<Mutex<SessionState>>,
    config: CodexSessionConfig,
    extractor: F,
) where
    F: Fn(&Value, PermissionKind) -> Option<(AgentPermissionRequest, ApprovalResponseSink)>
        + Send
        + Sync
        + 'static,
{
    let handler: RequestHandler = Arc::new(move |params| {
        let Some((request, response_sink)) = extractor(&params, kind) else {
            return Ok(Value::Null);
        };

        // 注册 pending permission
        {
            let mut state = state
                .lock()
                .map_err(|_| CodexAppServerError::Protocol("session 锁中毒".into()))?;
            state.pending_permissions.insert(
                request.id.clone(),
                PendingPermission {
                    sender: response_sink.sender.clone(),
                },
            );
        }

        // 广播 PermissionRequested
        config.broadcaster.emit_stream_event(
            config.project_id,
            config.session_id,
            AgentStreamEvent::PermissionRequested {
                request: request.clone(),
            },
        );

        // 阻塞等待用户决策
        let decision = response_sink
            .receiver
            .recv()
            .map_err(|_| CodexAppServerError::Closed("权限决策通道关闭".into()))?;

        // 构造 codex 期望的 response payload
        Ok(permission_response_payload(decision))
    });
    client.transport().set_request_handler(method, handler);
}

/// 审批请求的响应通道。
struct ApprovalResponseSink {
    sender: std::sync::mpsc::Sender<PermissionDecision>,
    receiver: std::sync::mpsc::Receiver<PermissionDecision>,
}

impl ApprovalResponseSink {
    fn new() -> Self {
        let (sender, receiver) = std::sync::mpsc::channel();
        Self { sender, receiver }
    }
}

fn extract_command_approval(
    params: &Value,
    kind: PermissionKind,
) -> Option<(AgentPermissionRequest, ApprovalResponseSink)> {
    let item_id = str_field(params, "itemId")?;
    let request_id = format!("permission-{item_id}");
    let command = str_field(params, "command");
    let title = command
        .as_deref()
        .map(|command| format!("Run command: {command}"))
        .unwrap_or_else(|| "Run command".to_string());
    let description = str_field(params, "reason");
    let sink = ApprovalResponseSink::new();
    let request = AgentPermissionRequest {
        id: request_id,
        turn_id: str_field(params, "turnId"),
        kind,
        title: Some(title),
        description,
        actions: default_permission_actions(),
    };
    Some((request, sink))
}

fn extract_file_change_approval(
    params: &Value,
    kind: PermissionKind,
) -> Option<(AgentPermissionRequest, ApprovalResponseSink)> {
    let item_id = str_field(params, "itemId")?;
    let request_id = format!("permission-{item_id}");
    let description = str_field(params, "reason");
    let sink = ApprovalResponseSink::new();
    let request = AgentPermissionRequest {
        id: request_id,
        turn_id: str_field(params, "turnId"),
        kind,
        title: Some("Apply file changes".into()),
        description,
        actions: default_permission_actions(),
    };
    Some((request, sink))
}

fn extract_question_approval(
    params: &Value,
    kind: PermissionKind,
) -> Option<(AgentPermissionRequest, ApprovalResponseSink)> {
    let item_id = str_field(params, "itemId")
        .or_else(|| str_field(params, "callId"))
        .unwrap_or_else(|| "question".to_string());
    let request_id = format!("permission-{item_id}");
    let header = str_field(params, "header").unwrap_or_else(|| "Question".to_string());
    let question = str_field(params, "question").unwrap_or_default();
    let sink = ApprovalResponseSink::new();
    let request = AgentPermissionRequest {
        id: request_id,
        turn_id: str_field(params, "turnId"),
        kind,
        title: Some(header),
        description: Some(question),
        actions: default_permission_actions(),
    };
    Some((request, sink))
}

fn default_permission_actions() -> Vec<AgentPermissionAction> {
    vec![
        AgentPermissionAction {
            id: "accept".into(),
            label: "Allow".into(),
            behavior: PermissionBehavior::Allow,
        },
        AgentPermissionAction {
            id: "decline".into(),
            label: "Deny".into(),
            behavior: PermissionBehavior::Deny,
        },
    ]
}

fn permission_response_payload(decision: PermissionDecision) -> Value {
    match decision {
        PermissionDecision::Accept => json!({ "decision": "accept" }),
        PermissionDecision::Decline => json!({ "decision": "decline" }),
        PermissionDecision::Cancel => json!({ "decision": "cancel" }),
    }
}

fn next_seq() -> u64 {
    // seq 由 broadcaster 在 emit 时统一分配并写入 envelope；此处 timeline 项
    // 内嵌的 seq 仅作占位（前端以 envelope.seq 为准）。保留 0 表示未指定。
    0
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn str_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn codex_mode_round_trips_id() {
        assert_eq!(CodexMode::from_id("auto"), Some(CodexMode::Auto));
        assert_eq!(
            CodexMode::from_id("full-access"),
            Some(CodexMode::FullAccess)
        );
        assert_eq!(CodexMode::from_id("read-only"), Some(CodexMode::ReadOnly));
        assert_eq!(CodexMode::from_id("unknown"), None);
    }

    #[test]
    fn codex_mode_sandbox_policy_label() {
        assert_eq!(CodexMode::Auto.sandbox_policy_label(), "workspace-write");
        assert_eq!(
            CodexMode::FullAccess.sandbox_policy_label(),
            "danger-full-access"
        );
        assert_eq!(CodexMode::ReadOnly.sandbox_policy_label(), "read-only");
    }

    #[test]
    fn permission_response_payload_matches_codex_contract() {
        assert_eq!(
            permission_response_payload(PermissionDecision::Accept),
            json!({ "decision": "accept" })
        );
        assert_eq!(
            permission_response_payload(PermissionDecision::Decline),
            json!({ "decision": "decline" })
        );
        assert_eq!(
            permission_response_payload(PermissionDecision::Cancel),
            json!({ "decision": "cancel" })
        );
    }

    #[test]
    fn extract_command_approval_builds_request() {
        let (request, _sink) = extract_command_approval(
            &json!({
                "itemId": "i1",
                "threadId": "thr_1",
                "turnId": "t1",
                "command": "ls",
                "reason": "list files",
            }),
            PermissionKind::Tool,
        )
        .expect("应解析出审批请求");
        assert_eq!(request.id, "permission-i1");
        assert_eq!(request.title.as_deref(), Some("Run command: ls"));
        assert_eq!(request.description.as_deref(), Some("list files"));
        assert_eq!(request.kind, PermissionKind::Tool);
        assert_eq!(request.actions.len(), 2);
    }

    #[test]
    fn build_events_thread_started_updates_state() {
        let state = Arc::new(Mutex::new(empty_state()));
        let events = build_events(
            &state,
            CodexNotification::ThreadStarted {
                thread_id: "thr_1".into(),
            },
        );
        assert_eq!(events.len(), 1);
        assert_eq!(state.lock().unwrap().thread_id.as_deref(), Some("thr_1"));
    }

    #[test]
    fn build_events_token_usage_updates_latest() {
        let state = Arc::new(Mutex::new(empty_state()));
        let events = build_events(
            &state,
            CodexNotification::TokenUsageUpdated {
                token_usage: json!({
                    "model_context_window": 200_000,
                    "last": { "total_tokens": 500, "inputTokens": 400, "outputTokens": 100 },
                }),
            },
        );
        assert_eq!(events.len(), 1);
        let usage = state.lock().unwrap().latest_usage.clone().unwrap();
        assert_eq!(usage.context_window_max_tokens, Some(200_000));
        assert_eq!(usage.context_window_used_tokens, Some(500));
    }

    #[test]
    fn build_events_turn_completed_clears_current_turn_id() {
        let state = Arc::new(Mutex::new(empty_state()));
        state.lock().unwrap().current_turn_id = Some("t1".into());

        let events = build_events(
            &state,
            CodexNotification::TurnCompleted {
                turn_id: Some("t1".into()),
                thread_id: Some("thr_1".into()),
                status: "completed".into(),
                error_message: None,
            },
        );

        assert_eq!(events.len(), 1);
        assert_eq!(state.lock().unwrap().current_turn_id, None);
    }

    #[test]
    fn build_events_agent_message_delta_throttles_and_flushes_final_text() {
        let state = Arc::new(Mutex::new(empty_state()));
        let events1 = build_events(
            &state,
            CodexNotification::AgentMessageDelta {
                item_id: "i1".into(),
                delta: "hel".into(),
                thread_id: None,
            },
        );
        let events2 = build_events(
            &state,
            CodexNotification::AgentMessageDelta {
                item_id: "i1".into(),
                delta: "lo".into(),
                thread_id: None,
            },
        );
        assert_eq!(events1.len(), 1);
        assert_eq!(events2.len(), 0);

        let events3 = flush_agent_message_delta(&state, "i1", true);
        assert_eq!(events3.len(), 1);
        match &events3[0] {
            AgentStreamEvent::Timeline {
                item: AgentTimelineItem::AssistantMessage { text, .. },
                ..
            } => {
                assert_eq!(text, "hello");
            }
            other => panic!("期望 AssistantMessage timeline，实际 {other:?}"),
        }
    }

    #[test]
    fn build_events_turn_completed_flushes_pending_reasoning_before_completion() {
        let state = Arc::new(Mutex::new(empty_state()));
        let events1 = build_events(
            &state,
            CodexNotification::ReasoningDelta {
                item_id: "r1".into(),
                delta: "先分析".into(),
                thread_id: None,
            },
        );
        let events2 = build_events(
            &state,
            CodexNotification::ReasoningDelta {
                item_id: "r1".into(),
                delta: "再总结".into(),
                thread_id: None,
            },
        );
        assert_eq!(events1.len(), 1);
        assert_eq!(events2.len(), 0);

        let events3 = build_events(
            &state,
            CodexNotification::TurnCompleted {
                turn_id: Some("t1".into()),
                thread_id: Some("thr_1".into()),
                status: "completed".into(),
                error_message: None,
            },
        );

        assert_eq!(events3.len(), 2);
        match &events3[0] {
            AgentStreamEvent::Timeline {
                item: AgentTimelineItem::Reasoning { text },
                ..
            } => {
                assert_eq!(text, "先分析再总结");
            }
            other => panic!("期望 Reasoning timeline，实际 {other:?}"),
        }
        assert!(matches!(
            events3[1],
            AgentStreamEvent::TurnCompleted {
                turn_id: Some(_),
                ..
            }
        ));
    }

    fn empty_state() -> SessionState {
        SessionState {
            thread_id: None,
            current_turn_id: None,
            current_mode: CodexMode::Auto,
            model: None,
            effort: None,
            agent_message_buffer: HashMap::new(),
            agent_message_last_flush_at: HashMap::new(),
            agent_message_flushed_len: HashMap::new(),
            reasoning_buffer: HashMap::new(),
            reasoning_last_flush_at: HashMap::new(),
            reasoning_flushed_len: HashMap::new(),
            pending_permissions: HashMap::new(),
            latest_usage: None,
        }
    }

    #[test]
    fn build_turn_input_text_when_no_attachments() {
        let input = build_turn_input("hello".into(), &[]);
        match &input {
            TurnInput::Text(text) => assert_eq!(text, "hello"),
            other => panic!("期望 TurnInput::Text，实际 {other:?}"),
        }
        assert_eq!(
            input.to_json(),
            json!([{ "type": "text", "text": "hello", "text_elements": [] }])
        );
    }

    #[test]
    fn build_turn_input_blocks_with_attachment_paths() {
        use crate::types::agent_session::AgentAttachmentKind;
        let attachments = vec![
            AgentMessageAttachment {
                path: "/data/a.png".into(),
                display_name: "a.png".into(),
                kind: AgentAttachmentKind::Image,
            },
            AgentMessageAttachment {
                path: "/data/b.pdf".into(),
                display_name: "b.pdf".into(),
                kind: AgentAttachmentKind::Pdf,
            },
        ];
        let input = build_turn_input("请看附件".into(), &attachments);
        let blocks = match &input {
            TurnInput::Blocks(blocks) => blocks,
            other => panic!("期望 TurnInput::Blocks，实际 {other:?}"),
        };
        assert_eq!(blocks.len(), 3);
        assert_eq!(
            blocks[0],
            json!({ "type": "text", "text": "请看附件", "text_elements": [] })
        );
        assert_eq!(
            blocks[1],
            json!({ "type": "text", "text": "[附件] a.png: /data/a.png", "text_elements": [] })
        );
        assert_eq!(
            blocks[2],
            json!({ "type": "text", "text": "[附件] b.pdf: /data/b.pdf", "text_elements": [] })
        );
        assert_eq!(input.to_json(), Value::Array(blocks.to_vec()));
    }

    #[test]
    fn default_codex_models_returns_static_gpt5_capabilities() {
        assert_eq!(
            default_codex_models(),
            vec![AgentModel {
                model_id: "gpt-5".into(),
                display_name: Some("GPT-5".into()),
                is_default: Some(true),
                default_reasoning_effort: Some("medium".into()),
                supported_reasoning_efforts: vec![
                    "low".into(),
                    "medium".into(),
                    "high".into(),
                    "xhigh".into(),
                ],
            }]
        );
    }

    #[test]
    fn list_models_with_command_reads_models_without_session_handle() {
        let temp_dir = tempdir().expect("temp dir");
        let script_path = temp_dir.path().join("mock-codex.sh");
        fs::write(
            &script_path,
            r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id=$(printf '%s\n' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
      printf '{"id":%s,"result":{"serverInfo":{"name":"mock"}}}\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"model/list"'*)
      id=$(printf '%s\n' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
      printf '{"id":%s,"result":{"data":[{"id":"gpt-5","displayName":"GPT-5","isDefault":true,"supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"medium"},{"reasoningEffort":"high"},{"reasoningEffort":"xhigh"}]}]}}\n' "$id"
      ;;
  esac
done
"#,
        )
        .expect("write mock script");
        let mut permissions = fs::metadata(&script_path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions).expect("chmod");

        let models = list_models_with_command(
            script_path
                .to_str()
                .expect("script path should be valid utf-8"),
            None,
        )
        .expect("models");

        assert_eq!(
            models,
            vec![AgentModel {
                model_id: "gpt-5".into(),
                display_name: Some("GPT-5".into()),
                is_default: Some(true),
                default_reasoning_effort: None,
                supported_reasoning_efforts: vec![
                    "low".into(),
                    "medium".into(),
                    "high".into(),
                    "xhigh".into(),
                ],
            }]
        );
    }
}
