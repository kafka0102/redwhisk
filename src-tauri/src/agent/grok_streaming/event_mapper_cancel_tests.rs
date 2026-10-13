//! 用户取消是终态：迟到的工具 / 正文不得把同一 turn 重新打开。
//!
//! 现场日志：`turn_canceled` 之后仍有 `tool_call` running、`write` completed、
//! 以及同一 turnId 的 `turn_completed`。续写重开只适用于 prompt 正常返回。

use super::*;
use serde_json::json;

#[test]
fn user_cancel_stays_closed_when_late_tool_and_message_arrive() {
    let mut mapper = GrokStreamMapper::new();
    mapper.begin_turn("local-1".into());
    mapper.on_notification(
        "session/update",
        &json!({"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"working"}},"_meta":{"promptId":"b29f82d5"}}),
    );
    assert!(mapper.is_turn_active());

    let canceled = mapper.on_cancel();
    assert!(matches!(
        canceled,
        AgentStreamEvent::TurnCanceled { reason, .. } if reason == "user_canceled"
    ));
    assert!(!mapper.is_turn_active());

    let late_tool = mapper.on_notification(
        "session/update",
        &json!({"update":{"sessionUpdate":"tool_call","toolCallId":"call-1","title":"read","kind":"read","status":"in_progress","rawInput":{"path":"a.rs"}}}),
    );
    assert!(
        late_tool.is_empty(),
        "取消后的工具调用不得重新打开 turn，实际 {late_tool:?}"
    );
    assert!(
        !mapper.is_turn_active(),
        "取消后 is_turn_active 必须保持 false"
    );

    let late_message = mapper.on_notification(
        "session/update",
        &json!({"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":" still going"}}}),
    );
    assert!(
        late_message.is_empty(),
        "取消后的正文不得重新打开 turn，实际 {late_message:?}"
    );

    let late_done = mapper.on_notification(
        "_x.ai/session_notification",
        &json!({"update":{"sessionUpdate":"turn_completed","prompt_id":"b29f82d5"}}),
    );
    assert!(
        late_done
            .iter()
            .all(|event| !matches!(event, AgentStreamEvent::TurnCompleted { .. })),
        "取消后不得再发 turn_completed，实际 {late_done:?}"
    );
    assert!(!mapper.is_turn_active());
}
