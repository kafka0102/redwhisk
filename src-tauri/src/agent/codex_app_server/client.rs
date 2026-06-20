//! codex app-server 高层 RPC 客户端。
//!
//! 封装 `CodexTransport`，提供具名方法：
//! - `initialize` / `notify_initialized`：握手
//! - `turn_start`：发起一轮对话
//! - `thread_read` / `thread_resume`：历史回放与续接
//! - `model_list`：列出可用模型
//! - `respond_permission`：回复 server→client 审批请求
//!
//! 客户端只做协议层封装，不持有业务状态；状态由 `CodexSession` 管理。

use serde_json::{json, Value};

use super::transport::{CodexAppServerError, CodexTransport};

/// codex app-server 客户端。
#[derive(Clone)]
pub struct CodexAppServerClient {
    transport: CodexTransport,
}

/// 初始化握手参数。
#[derive(Debug, Clone)]
pub struct InitializeParams {
    pub client_name: String,
    pub client_title: String,
    pub client_version: String,
}

impl Default for InitializeParams {
    fn default() -> Self {
        // 与 paseo 一致：使用非 originating 的 client identity，避免在
        // provider usage log 里把请求标成 redwhisk 发起。
        Self {
            client_name: "redwhisk_codex_app_server".into(),
            client_title: "RedWhisk Codex App Server".into(),
            client_version: "0.0.0".into(),
        }
    }
}

/// turn/start 参数。
#[derive(Debug, Clone)]
pub struct TurnStartParams {
    pub thread_id: String,
    pub input: TurnInput,
    pub model: Option<String>,
    /// reasoning effort（codex `effort` 字段）：low / medium / high。
    pub effort: Option<String>,
    pub approval_policy: String,
    pub sandbox_policy: SandboxPolicy,
    pub cwd: Option<String>,
    pub developer_instructions: Option<String>,
}

/// turn/start 的输入内容。
#[derive(Debug, Clone)]
pub enum TurnInput {
    /// 纯文本输入。
    Text(String),
    /// 结构化输入块（skill / text / image 等），保留原始 JSON 形态。
    Blocks(Vec<Value>),
}

impl TurnInput {
    pub fn to_json(&self) -> Value {
        match self {
            TurnInput::Text(text) => Value::Array(vec![text_user_input(text)]),
            TurnInput::Blocks(blocks) => Value::Array(blocks.clone()),
        }
    }
}

pub fn text_user_input(text: &str) -> Value {
    json!({
        "type": "text",
        "text": text,
        "text_elements": [],
    })
}

/// codex sandbox 策略。对应 paseo `toSandboxPolicy` 的三种 type。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxPolicy {
    ReadOnly,
    WorkspaceWrite { network_access: bool },
    DangerFullAccess,
}

impl SandboxPolicy {
    pub fn to_json(self) -> Value {
        match self {
            SandboxPolicy::ReadOnly => json!({ "type": "readOnly" }),
            SandboxPolicy::WorkspaceWrite { network_access } => {
                json!({ "type": "workspaceWrite", "networkAccess": network_access })
            }
            SandboxPolicy::DangerFullAccess => json!({ "type": "dangerFullAccess" }),
        }
    }
}

/// turn/start 响应。
#[derive(Debug, Clone)]
pub struct TurnStartResponse {
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
}

/// thread/read 响应（简化版，保留 turns 原始结构供 timeline 映射）。
#[derive(Debug, Clone)]
pub struct ThreadReadResponse {
    pub raw: Value,
}

/// model/list 响应里的单个模型。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexModelEntry {
    pub id: String,
    pub display_name: Option<String>,
    pub is_default: Option<bool>,
    pub default_reasoning_effort: Option<String>,
    pub supported_reasoning_efforts: Vec<String>,
}

/// 权限决策（server→client request 的回复）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionDecision {
    Accept,
    Decline,
    Cancel,
}

impl PermissionDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            PermissionDecision::Accept => "accept",
            PermissionDecision::Decline => "decline",
            PermissionDecision::Cancel => "cancel",
        }
    }
}

impl CodexAppServerClient {
    pub fn new(transport: CodexTransport) -> Self {
        Self { transport }
    }

    pub fn transport(&self) -> &CodexTransport {
        &self.transport
    }

    /// `initialize` → `initialized` 握手。
    pub fn initialize(&self, params: &InitializeParams) -> Result<Value, CodexAppServerError> {
        let payload = json!({
            "clientInfo": {
                "name": params.client_name,
                "title": params.client_title,
                "version": params.client_version,
            },
            "capabilities": { "experimentalApi": true },
        });
        let result = self.transport.request("initialize", payload)?;
        self.transport.notify("initialized", json!({}))?;
        Ok(result)
    }

    /// `turn/start`：发起一轮对话。
    ///
    /// 返回 thread/turn id。turn_id 由后续 `turn/started` 通知提供，
    /// 此处仅尝试从响应中读取 codex 直接返回的 id（部分版本不返回）。
    pub fn turn_start(
        &self,
        params: &TurnStartParams,
    ) -> Result<TurnStartResponse, CodexAppServerError> {
        let mut payload = json!({
            "threadId": params.thread_id,
            "input": params.input.to_json(),
            "approvalPolicy": params.approval_policy,
            "sandboxPolicy": params.sandbox_policy.to_json(),
        });
        if let Some(model) = &params.model {
            payload["model"] = Value::String(model.clone());
        }
        if let Some(effort) = &params.effort {
            payload["effort"] = Value::String(effort.clone());
        }
        if let Some(cwd) = &params.cwd {
            payload["cwd"] = Value::String(cwd.clone());
        }
        if let Some(instructions) = &params.developer_instructions {
            payload["developerInstructions"] = Value::String(instructions.clone());
        }

        let result = self.transport.request("turn/start", payload)?;
        let thread_id = result
            .get("thread")
            .and_then(|thread| thread.get("id"))
            .and_then(Value::as_str)
            .map(String::from);
        Ok(TurnStartResponse {
            thread_id,
            turn_id: None,
        })
    }

    /// `thread/start`：创建新 thread（无 input）。
    ///
    /// 用于首次创建会话；返回新 threadId。
    pub fn thread_start(
        &self,
        model: Option<&str>,
        cwd: Option<&str>,
        approval_policy: &str,
        sandbox: &str,
    ) -> Result<String, CodexAppServerError> {
        let payload = build_thread_start_payload(model, cwd, approval_policy, sandbox);
        let result = self.transport.request("thread/start", payload)?;
        let thread_id = result
            .get("thread")
            .and_then(|thread| thread.get("id"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                CodexAppServerError::Protocol("thread/start 响应缺少 thread.id".to_string())
            })?;
        Ok(thread_id.to_string())
    }

    /// `turn/interrupt`：中断指定 turn。
    ///
    /// codex 收到后会让当前 turn 尽快结束（通常触发 `turn/completed`
    /// 通知，status 为 `canceled` / `aborted`）。
    pub fn turn_interrupt(&self, turn_id: &str) -> Result<(), CodexAppServerError> {
        let payload = json!({ "turnId": turn_id });
        self.transport.request("turn/interrupt", payload)?;
        Ok(())
    }

    /// `thread/read`：读取 thread 历史。
    pub fn thread_read(&self, thread_id: &str) -> Result<ThreadReadResponse, CodexAppServerError> {
        let payload = json!({
            "threadId": thread_id,
            "includeTurns": true,
        });
        let raw = self.transport.request("thread/read", payload)?;
        Ok(ThreadReadResponse { raw })
    }

    /// `thread/resume`：续接已存在的 thread。
    pub fn thread_resume(&self, thread_id: &str) -> Result<(), CodexAppServerError> {
        let payload = json!({ "threadId": thread_id });
        self.transport.request("thread/resume", payload)?;
        Ok(())
    }

    /// `thread/loaded/list`：查询当前已加载的 thread id 列表。
    pub fn thread_loaded_list(&self) -> Result<Vec<String>, CodexAppServerError> {
        let result = self.transport.request("thread/loaded/list", json!({}))?;
        let ids = result
            .get("data")
            .and_then(Value::as_array)
            .map(|array| {
                array
                    .iter()
                    .filter_map(Value::as_str)
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default();
        Ok(ids)
    }

    /// `model/list`：列出可用模型。
    pub fn model_list(&self) -> Result<Vec<CodexModelEntry>, CodexAppServerError> {
        let result = self.transport.request("model/list", json!({}))?;
        let data = result
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let models = data
            .into_iter()
            .filter_map(|entry| {
                let id = entry.get("id").and_then(Value::as_str)?.to_string();
                let display_name = entry
                    .get("displayName")
                    .and_then(Value::as_str)
                    .map(String::from);
                let is_default = entry.get("isDefault").and_then(Value::as_bool);
                let default_reasoning_effort = entry
                    .get("defaultReasoningEffort")
                    .and_then(Value::as_str)
                    .map(String::from);
                let supported_reasoning_efforts = entry
                    .get("supportedReasoningEfforts")
                    .and_then(Value::as_array)
                    .map(|array| {
                        array
                            .iter()
                            .filter_map(|item| {
                                item.get("reasoningEffort")
                                    .and_then(Value::as_str)
                                    .map(String::from)
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Some(CodexModelEntry {
                    id,
                    display_name,
                    is_default,
                    default_reasoning_effort,
                    supported_reasoning_efforts,
                })
            })
            .collect();
        Ok(models)
    }

    /// 回复一个 server→client 审批请求。
    ///
    /// `decision` 为 accept/decline/cancel；`updated_input` 用于 question
    /// 类审批回传答案（透传原始 JSON）。
    pub fn respond_permission(
        &self,
        request_id: i64,
        decision: PermissionDecision,
        updated_input: Option<Value>,
    ) -> Result<Value, CodexAppServerError> {
        // 注意：审批回复是 JSON-RPC response，不是 request。但 transport
        // 已通过 set_request_handler 注册的 handler 直接返回结果，这里
        // 实际上不会被调用——respond_permission 留作日志/未来扩展入口。
        let _ = (request_id, decision, updated_input);
        Err(CodexAppServerError::Protocol(
            "审批回复应通过 set_request_handler 返回，无需调用 respond_permission".to_string(),
        ))
    }
}

fn build_thread_start_payload(
    model: Option<&str>,
    cwd: Option<&str>,
    approval_policy: &str,
    sandbox: &str,
) -> Value {
    let mut payload = json!({
        "approvalPolicy": approval_policy,
        "sandbox": sandbox,
    });
    if let Some(model) = model {
        payload["model"] = Value::String(model.to_string());
    }
    if let Some(cwd) = cwd {
        payload["cwd"] = Value::String(cwd.to_string());
    }
    payload
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sandbox_policy_serializes_workspace_write() {
        let json = SandboxPolicy::WorkspaceWrite {
            network_access: true,
        }
        .to_json();
        assert_eq!(json["type"], "workspaceWrite");
        assert_eq!(json["networkAccess"], true);
    }

    #[test]
    fn sandbox_policy_serializes_read_only() {
        let json = SandboxPolicy::ReadOnly.to_json();
        assert_eq!(json["type"], "readOnly");
    }

    #[test]
    fn turn_input_text_to_json_is_user_input_array() {
        let json = TurnInput::Text("hello".into()).to_json();
        assert_eq!(
            json,
            json!([{ "type": "text", "text": "hello", "text_elements": [] }])
        );
    }

    #[test]
    fn turn_input_blocks_to_json_is_array() {
        let json = TurnInput::Blocks(vec![json!({ "type": "text", "text": "hi" })]).to_json();
        assert!(json.is_array());
    }

    #[test]
    fn permission_decision_as_str() {
        assert_eq!(PermissionDecision::Accept.as_str(), "accept");
        assert_eq!(PermissionDecision::Decline.as_str(), "decline");
        assert_eq!(PermissionDecision::Cancel.as_str(), "cancel");
    }

    #[test]
    fn thread_start_payload_omits_model_when_not_specified() {
        let payload =
            build_thread_start_payload(None, Some("/tmp/project"), "on-request", "workspace-write");

        assert!(payload.get("model").is_none());
        assert_eq!(payload["cwd"], "/tmp/project");
        assert_eq!(payload["approvalPolicy"], "on-request");
        assert_eq!(payload["sandbox"], "workspace-write");
    }

    #[test]
    fn thread_start_payload_includes_explicit_model() {
        let payload =
            build_thread_start_payload(Some("openai/gpt-5"), None, "never", "danger-full-access");

        assert_eq!(payload["model"], "openai/gpt-5");
        assert!(payload.get("cwd").is_none());
    }
}
