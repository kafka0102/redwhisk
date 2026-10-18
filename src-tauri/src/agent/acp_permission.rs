//! ACP `session/request_permission` 反向请求归一（DeepSeek / Grok 等 ACP provider 共用）。
//!
//! ACP 的审批请求是**阻塞式反向请求**：agent 发出 `session/request_permission` 后
//! 一直等客户端写回结果，客户端不回复这一轮就永久挂死。本模块只做纯函数归一：
//! 参数 → 既有权限卡（`AgentPermissionRequest`），以及 `decision` → 写回结果。
//!
//! 选项按 `kind` 选（`allow_once` / `reject_once`），不依赖 provider 的 optionId
//! 字面量：DeepSeek 用 `allow_once`，Grok 用 `allow-once`。

use serde_json::{json, Value};

use crate::types::agent_session::AgentPermissionDecision;
use crate::types::agent_session_stream::{
    AgentPermissionAction, AgentPermissionRequest, PermissionBehavior, PermissionKind,
};

const REQUEST_PERMISSION_METHOD: &str = "session/request_permission";
const ALLOW_ONCE: &str = "allow_once";
const REJECT_ONCE: &str = "reject_once";

/// 权限归一失败。各 provider 自行包装成自己的传输错误类型。
#[derive(Debug, thiserror::Error)]
pub enum AcpPermissionError {
    #[error("ACP permission request is missing one-time option {0}")]
    MissingOption(String),
}

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
) -> Result<Value, AcpPermissionError> {
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

pub fn auto_allow_outcome(options: &[AcpPermissionOption]) -> Result<Value, AcpPermissionError> {
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
) -> Result<Value, AcpPermissionError> {
    let option_id = options
        .iter()
        .find(|option| option.kind == kind)
        .map(|option| option.option_id.clone())
        .ok_or_else(|| AcpPermissionError::MissingOption(kind.to_string()))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn options(ids: &[(&str, &str)]) -> Vec<AcpPermissionOption> {
        ids.iter()
            .map(|(option_id, kind)| AcpPermissionOption {
                option_id: (*option_id).to_string(),
                kind: (*kind).to_string(),
            })
            .collect()
    }

    #[test]
    fn selects_one_time_option_by_kind_not_by_literal_id() {
        let grok = options(&[
            ("always-allow", "allow_always"),
            ("allow-once", "allow_once"),
            ("reject-once", "reject_once"),
        ]);
        assert_eq!(
            outcome_for_decision(AgentPermissionDecision::Accept, &grok).expect("allow"),
            json!({"outcome": {"outcome": "selected", "optionId": "allow-once"}})
        );
        assert_eq!(
            outcome_for_decision(AgentPermissionDecision::Decline, &grok).expect("deny"),
            json!({"outcome": {"outcome": "selected", "optionId": "reject-once"}})
        );

        let deepseek = options(&[
            ("opt-allow-once", "allow_once"),
            ("opt-reject-once", "reject_once"),
        ]);
        assert_eq!(
            outcome_for_decision(AgentPermissionDecision::Accept, &deepseek).expect("allow"),
            json!({"outcome": {"outcome": "selected", "optionId": "opt-allow-once"}})
        );
    }

    #[test]
    fn cancel_does_not_need_a_one_time_option() {
        assert_eq!(
            outcome_for_decision(AgentPermissionDecision::Cancel, &[]).expect("cancel"),
            json!({"outcome": {"outcome": "cancelled"}})
        );
    }

    #[test]
    fn missing_one_time_option_is_a_protocol_error() {
        let error = auto_allow_outcome(&options(&[("always-allow", "allow_always")]))
            .expect_err("missing allow_once");
        assert!(error.to_string().contains("allow_once"), "{error}");
    }

    #[test]
    fn parses_options_and_skips_incomplete_entries() {
        let parsed = parse_options(&json!({
            "options": [
                {"optionId": "allow-once", "kind": "allow_once", "name": "Yes"},
                {"kind": "allow_always"},
                {"optionId": ""},
                {"optionId": "reject-once", "kind": "reject_once"}
            ]
        }));
        assert_eq!(
            parsed,
            options(&[("allow-once", "allow_once"), ("reject-once", "reject_once")])
        );
    }

    #[test]
    fn request_id_accepts_number_and_string_ids() {
        assert_eq!(permission_request_id(&json!(0)), "0");
        assert_eq!(permission_request_id(&json!("42")), "42");
    }
}
