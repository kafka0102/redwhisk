//! ACP `session/request_permission` 与既有权限卡之间的一次性允许/拒绝。

use serde_json::{json, Value};

use crate::agent::deepseek_streaming::transport::DeepSeekStreamingError;
use crate::types::agent_session::AgentPermissionDecision;
use crate::types::agent_session_stream::{
    AgentPermissionAction, AgentPermissionRequest, PermissionBehavior, PermissionKind,
};

const REQUEST_PERMISSION_METHOD: &str = "session/request_permission";
const ALLOW_ONCE: &str = "allow_once";
const REJECT_ONCE: &str = "reject_once";

/// ACP 权限选项。只保留写回所需的 id 和 kind。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcpPermissionOption {
    pub option_id: String,
    pub kind: String,
}

pub fn is_permission_request(method: &str) -> bool {
    method == REQUEST_PERMISSION_METHOD
}

pub fn permission_request_id(rpc_id: &Value) -> String {
    match rpc_id {
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        _ => "permission".to_string(),
    }
}

pub fn parse_options(params: &Value) -> Vec<AcpPermissionOption> {
    params
        .get("options")
        .and_then(Value::as_array)
        .map(|options| options.iter().filter_map(parse_option).collect())
        .unwrap_or_default()
}

pub fn build_permission_request(
    request_id: String,
    turn_id: Option<String>,
    params: &Value,
) -> AgentPermissionRequest {
    let title = params
        .get("toolCall")
        .and_then(|tool_call| tool_call.get("title"))
        .and_then(Value::as_str)
        .filter(|title| !title.is_empty())
        .map(str::to_string);
    AgentPermissionRequest {
        id: request_id,
        turn_id,
        kind: PermissionKind::Tool,
        title,
        description: None,
        actions: existing_permission_actions(),
    }
}

pub fn outcome_for_decision(
    decision: AgentPermissionDecision,
    options: &[AcpPermissionOption],
) -> Result<Value, DeepSeekStreamingError> {
    match decision {
        AgentPermissionDecision::Accept => selected_outcome(options, ALLOW_ONCE),
        AgentPermissionDecision::Decline => selected_outcome(options, REJECT_ONCE),
        AgentPermissionDecision::Cancel => Ok(json!({
            "outcome": { "outcome": "cancelled" }
        })),
    }
}

pub fn auto_allows(dangerous: bool, mode_id: Option<&str>) -> bool {
    dangerous || mode_id == Some("full-access")
}

pub fn auto_allow_outcome(
    options: &[AcpPermissionOption],
) -> Result<Value, DeepSeekStreamingError> {
    selected_outcome(options, ALLOW_ONCE)
}

pub fn decision_resolution(decision: AgentPermissionDecision) -> &'static str {
    match decision {
        AgentPermissionDecision::Accept => "accept",
        AgentPermissionDecision::Decline => "decline",
        AgentPermissionDecision::Cancel => "cancel",
    }
}

fn parse_option(value: &Value) -> Option<AcpPermissionOption> {
    let option_id = value.get("optionId")?.as_str()?.to_string();
    let kind = value.get("kind")?.as_str()?.to_string();
    if option_id.is_empty() || kind.is_empty() {
        return None;
    }
    Some(AcpPermissionOption { option_id, kind })
}

fn selected_outcome(
    options: &[AcpPermissionOption],
    kind: &str,
) -> Result<Value, DeepSeekStreamingError> {
    let option_id = options
        .iter()
        .find(|option| option.kind == kind)
        .map(|option| option.option_id.clone())
        .ok_or_else(|| {
            DeepSeekStreamingError::Protocol(format!(
                "ACP permission request is missing one-time option {kind}"
            ))
        })?;
    Ok(json!({
        "outcome": { "outcome": "selected", "optionId": option_id }
    }))
}

fn existing_permission_actions() -> Vec<AgentPermissionAction> {
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
