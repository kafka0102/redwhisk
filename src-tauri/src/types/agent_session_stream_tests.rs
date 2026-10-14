use super::*;
use serde_json::json;

#[test]
fn serializes_assistant_message_timeline_with_snake_case_type() {
    let event = AgentStreamEvent::Timeline {
        item: AgentTimelineItem::AssistantMessage {
            text: "hello".into(),
            message_id: Some("m1".into()),
            subagent_id: None,
        },
        turn_id: None,
        seq: 3,
        timestamp: 1_700_000_000_000,
    };

    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["type"], "timeline");
    assert_eq!(value["item"]["type"], "assistant_message");
    assert_eq!(value["item"]["text"], "hello");
    assert_eq!(value["item"]["messageId"], "m1");
    assert_eq!(value["seq"], 3);
}

#[test]
fn serializes_tool_call_with_detail_tag() {
    let event = AgentStreamEvent::Timeline {
        item: AgentTimelineItem::ToolCall {
            call_id: "c1".into(),
            name: "shell".into(),
            detail: ToolCallDetail::Shell {
                command: "ls".into(),
                output: Some("a\nb".into()),
                exit_code: Some(0),
            },
            status: ToolCallStatus::Completed,
            error: None,
            subagent_id: None,
        },
        turn_id: Some("t1".into()),
        seq: 1,
        timestamp: 1_700_000_000_000,
    };

    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["item"]["detail"]["type"], "shell");
    assert_eq!(value["item"]["detail"]["command"], "ls");
    assert_eq!(value["item"]["detail"]["exitCode"], 0);
    assert_eq!(value["item"]["status"], "completed");
}

#[test]
fn serializes_usage_updated_with_camel_case_fields() {
    let event = AgentStreamEvent::UsageUpdated {
        usage: AgentUsage {
            input_tokens: Some(10),
            output_tokens: None,
            context_window_max_tokens: Some(200_000),
            context_window_used_tokens: Some(1_801),
            session_token_input: None,
            session_token_output: None,
            session_token_cache: None,
            session_token_merge: SessionTokenMerge::Overwrite,
        },
    };

    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["type"], "usage_updated");
    assert_eq!(value["usage"]["inputTokens"], 10);
    assert!(value["usage"].get("outputTokens").is_none());
    assert_eq!(value["usage"]["contextWindowMaxTokens"], 200_000);
    assert_eq!(value["usage"]["contextWindowUsedTokens"], 1_801);
}

#[test]
fn serializes_envelope_with_camel_case_top_level() {
    let envelope = AgentStreamEventEnvelope {
        project_id: 1,
        session_id: 2,
        seq: 5,
        epoch: "epoch-1".into(),
        event: AgentStreamEvent::ThreadStarted {
            thread_id: "thr_1".into(),
        },
        log_offset: None,
    };

    let value = serde_json::to_value(&envelope).unwrap();
    assert_eq!(value["projectId"], 1);
    assert_eq!(value["sessionId"], 2);
    assert_eq!(value["seq"], 5);
    assert_eq!(value["epoch"], "epoch-1");
    assert_eq!(value["event"]["type"], "thread_started");
    assert_eq!(value["event"]["threadId"], "thr_1");
    assert!(value.get("logOffset").is_none());
}

#[test]
fn permission_request_serializes_actions() {
    let request = AgentPermissionRequest {
        id: "req_1".into(),
        turn_id: Some("t1".into()),
        kind: PermissionKind::Tool,
        title: Some("Run command".into()),
        description: None,
        actions: vec![AgentPermissionAction {
            id: "accept".into(),
            label: "Allow".into(),
            behavior: PermissionBehavior::Allow,
        }],
    };

    let value = serde_json::to_value(&request).unwrap();
    assert_eq!(value["kind"], "tool");
    assert_eq!(value["actions"][0]["behavior"], "allow");
    assert!(value.get("description").is_none());
}

#[test]
fn agent_model_serializes_efforts() {
    let model = AgentModel {
        model_id: "gpt-5".into(),
        wire_model: None,
        display_name: Some("GPT-5".into()),
        is_default: Some(true),
        default_reasoning_effort: Some("medium".into()),
        supported_reasoning_efforts: vec![
            "low".into(),
            "medium".into(),
            "high".into(),
            "xhigh".into(),
        ],
    };

    let value = serde_json::to_value(&model).unwrap();
    assert_eq!(value["modelId"], "gpt-5");
    assert_eq!(
        value["supportedReasoningEfforts"],
        json!(["low", "medium", "high", "xhigh"])
    );
}

#[test]
fn effort_changed_serializes_with_nullable_effort() {
    let event = AgentStreamEvent::EffortChanged {
        effort: Some("high".into()),
    };

    let value = serde_json::to_value(&event).unwrap();

    assert_eq!(value, json!({ "type": "effort_changed", "effort": "high" }));
}
