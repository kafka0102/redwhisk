//! grok 结构化会话的 ACP 反向请求处理（权限审批）。
//!
//! grok 需要审批时发的是**阻塞式**反向请求 `session/request_permission`：客户端不写回
//! 结果，grok 就停在这一步不再输出任何东西（真机现场：`permission_requested` 之后整轮
//! 永久挂住）。因此反向请求一律必须回复：
//! - `--always-approve` 会话（`should_always_approve`，即 dangerous / full-access）
//!   直接回 `allow_once`，与启动参数语义一致，也不再弹卡；
//! - 其余模式弹既有权限卡，等用户在卡片上决策后写回；
//! - 其它反向请求（`x.ai/ask_user_question`、MCP elicitation 等）回 JSON-RPC error，
//!   让 grok 立刻失败并告知模型，而不是静默丢弃让它永久等待。

use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::Mutex;

use serde_json::Value;

use crate::agent::acp_permission::{
    auto_allow_outcome, build_permission_request, decision_resolution, is_permission_request,
    outcome_for_decision, parse_options, permission_request_id, AcpPermissionOption,
};
use crate::agent::grok_streaming::argv::should_always_approve;
use crate::agent::grok_streaming::session::GrokSessionConfig;
use crate::agent::grok_streaming::transport::GrokStreamingError;
use crate::types::agent_session::AgentPermissionDecision;
use crate::types::agent_session_stream::AgentStreamEvent;

/// 已挂起、等用户决策的权限请求。
struct PendingPermission {
    sender: mpsc::Sender<Value>,
    options: Vec<AcpPermissionOption>,
}

/// 反向请求挂起表。
///
/// 独立于 `SessionState`：等用户决策时会**阻塞**当前线程（传输层读线程），
/// 不能占着会话状态锁。
#[derive(Default)]
pub(super) struct PermissionLedger {
    pending: Mutex<HashMap<String, PendingPermission>>,
}

impl PermissionLedger {
    pub(super) fn new() -> Self {
        Self::default()
    }

    /// 处理权限请求，返回写回 grok 的 JSON-RPC `result`。
    ///
    /// 需要用户决策时阻塞到 `resolve` 写回为止——与 DeepSeek ACP 同一形态：
    /// 请求挂起期间 grok 本就不会再发别的消息。
    fn handle_request(
        &self,
        config: &GrokSessionConfig,
        rpc_id: &Value,
        params: &Value,
    ) -> Result<Value, GrokStreamingError> {
        let options = parse_options(params);
        if should_always_approve(config.mode_id.as_deref(), config.dangerous) {
            return auto_allow_outcome(&options).map_err(GrokStreamingError::from);
        }
        let request = build_permission_request(permission_request_id(rpc_id), None, params);
        let (sender, receiver) = mpsc::channel();
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| GrokStreamingError::Protocol("permission 锁中毒".into()))?;
            pending.insert(request.id.clone(), PendingPermission { sender, options });
        }
        emit(config, AgentStreamEvent::PermissionRequested { request });
        receiver
            .recv()
            .map_err(|_| GrokStreamingError::Closed("permission decision channel closed".into()))
    }

    /// 用户决策 → 写回被阻塞的 handler，并广播卡片消失。
    pub(super) fn resolve(
        &self,
        config: &GrokSessionConfig,
        request_id: &str,
        decision: AgentPermissionDecision,
    ) -> Result<(), GrokStreamingError> {
        let (sender, outcome) = {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| GrokStreamingError::Protocol("permission 锁中毒".into()))?;
            let entry = pending.remove(request_id).ok_or_else(|| {
                GrokStreamingError::Protocol(format!("no pending permission request: {request_id}"))
            })?;
            match outcome_for_decision(decision, &entry.options) {
                Ok(outcome) => (entry.sender, outcome),
                Err(error) => {
                    pending.insert(request_id.to_string(), entry);
                    return Err(GrokStreamingError::from(error));
                }
            }
        };
        sender
            .send(outcome)
            .map_err(|_| GrokStreamingError::Closed("permission decision channel closed".into()))?;
        emit(
            config,
            AgentStreamEvent::PermissionResolved {
                request_id: request_id.to_string(),
                resolution: decision_resolution(decision).to_string(),
            },
        );
        Ok(())
    }
}

/// 处理 agent→client 反向请求，返回写回 grok 的 JSON-RPC `result`。
pub(super) fn handle_server_request(
    config: &GrokSessionConfig,
    ledger: &PermissionLedger,
    rpc_id: &Value,
    method: &str,
    params: &Value,
) -> Result<Value, GrokStreamingError> {
    if !is_permission_request(method) {
        return Err(GrokStreamingError::Protocol(format!(
            "unhandled ACP request: {method}"
        )));
    }
    ledger.handle_request(config, rpc_id, params)
}

/// 广播权限事件；测试期额外记入 `config.event_log`（无 AppHandle 时
/// broadcaster 按设计丢弃事件，行为断言只能用这个 seam）。
fn emit(config: &GrokSessionConfig, event: AgentStreamEvent) {
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
