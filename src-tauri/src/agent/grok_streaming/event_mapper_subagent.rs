//! 子会话与父会话共用一条 stdio。子会话正文 / 工具进时间线并挂上
//! `subagent_id`，花名册记录启动与结束。这些更新不写进父助手缓冲。

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde_json::Value;

use super::{
    string_field, AgentStreamEvent, AgentTimelineItem, GrokStreamMapper,
    METHOD_SESSION_NOTIFICATION, METHOD_SESSION_UPDATE,
};
use crate::types::agent_session_stream::SubagentRosterStatus;

impl GrokStreamMapper {
    pub(super) fn map_child_notification(
        &mut self,
        method: &str,
        params: &Value,
        child_session_id: Option<String>,
    ) -> Vec<AgentStreamEvent> {
        let mut events = Vec::new();
        match method {
            METHOD_SESSION_UPDATE => self.map_session_update(params, &mut events, child_session_id),
            METHOD_SESSION_NOTIFICATION | "_x.ai/session/update" => {
                self.map_session_notification(params, &mut events)
            }
            _ => {}
        }
        events
    }

    pub(super) fn note_subagent_spawned(&mut self, params: &Value) {
        let Some(update) = params.get("update") else {
            return;
        };
        if string_field(update, "sessionUpdate").as_deref() != Some("subagent_spawned") {
            return;
        }
        let Some(child_session_id) = string_field(update, "child_session_id")
            .or_else(|| string_field(update, "subagent_id"))
        else {
            return;
        };
        self.child_session_ids.insert(child_session_id);
    }

    pub(super) fn subagent_lifecycle_event(&self, params: &Value) -> Option<AgentStreamEvent> {
        let update = params.get("update")?;
        let child_session_id = string_field(update, "child_session_id")
            .or_else(|| string_field(update, "subagent_id"))?;
        match string_field(update, "sessionUpdate").as_deref() {
            Some("subagent_spawned") => {
                Some(self.subagent_roster_event(child_session_id, SubagentRosterStatus::Running))
            }
            Some("subagent_finished") => {
                Some(self.subagent_roster_event(child_session_id, SubagentRosterStatus::Ended))
            }
            _ => None,
        }
    }

    pub(super) fn child_session_id(&self, params: &Value) -> Option<String> {
        string_field(params, "sessionId")
            .filter(|session_id| self.child_session_ids.contains(session_id))
    }

    /// 缓冲与事件共享当前完整正文。下一帧追加时才复制，上一份不再由映射器持有。
    pub(super) fn append_assistant_text(
        &mut self,
        subagent_id: Option<&str>,
        delta: &str,
    ) -> Arc<str> {
        match subagent_id {
            Some(child_session_id) => {
                Self::append_child_text(&mut self.child_assistant_text, child_session_id, delta)
            }
            None => append_shared_text(&mut self.assistant_text, delta),
        }
    }

    /// 推理与助手正文同一规则。
    pub(super) fn append_reasoning_text(
        &mut self,
        subagent_id: Option<&str>,
        delta: &str,
    ) -> Arc<str> {
        match subagent_id {
            Some(child_session_id) => {
                Self::append_child_text(&mut self.child_reasoning_text, child_session_id, delta)
            }
            None => append_shared_text(&mut self.reasoning_text, delta),
        }
    }

    pub(super) fn append_child_text(
        buffer: &mut HashMap<String, Arc<str>>,
        child_session_id: &str,
        delta: &str,
    ) -> Arc<str> {
        let text = buffer.entry(child_session_id.to_string()).or_default();
        append_shared_text(text, delta)
    }

    fn subagent_roster_event(
        &self,
        subagent_id: String,
        status: SubagentRosterStatus,
    ) -> AgentStreamEvent {
        AgentStreamEvent::Timeline {
            item: AgentTimelineItem::SubagentRoster {
                subagent_id,
                status,
            },
            turn_id: self.turn_id.clone(),
            seq: 0,
            timestamp: 0,
        }
    }

    #[cfg(test)]
    pub(super) fn child_text_is(
        &self,
        child_session_id: &str,
        assistant: &str,
        reasoning: &str,
    ) -> bool {
        self.child_assistant_text
            .get(child_session_id)
            .map(|text| text.as_ref())
            == Some(assistant)
            && self
                .child_reasoning_text
                .get(child_session_id)
                .map(|text| text.as_ref())
                == Some(reasoning)
    }
}

pub(super) fn new_child_ids() -> HashSet<String> {
    HashSet::new()
}

/// 把 delta 接到当前快照后面。缓冲与返回值指向同一份 `Arc`；
/// 事件仍持有上一份时，这里复制出的是下一帧，映射器不再留旧正文。
fn append_shared_text(current: &mut Arc<str>, delta: &str) -> Arc<str> {
    let mut next = String::with_capacity(current.len() + delta.len());
    next.push_str(current);
    next.push_str(delta);
    let shared: Arc<str> = Arc::from(next);
    *current = Arc::clone(&shared);
    shared
}

#[cfg(test)]
mod snapshot_tests {
    use super::GrokStreamMapper;
    use serde_json::json;

    #[test]
    fn child_text_buffer_releases_previous_snapshot() {
        let mut mapper = GrokStreamMapper::new();
        mapper.begin_turn("t".into());
        let child = "child-1";
        mapper.on_notification(
            "_x.ai/session/update",
            &json!({
                "update": {
                    "sessionUpdate": "subagent_spawned",
                    "child_session_id": child
                }
            }),
        );
        mapper.on_notification(
            "session/update",
            &json!({
                "sessionId": child,
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": "先写"}
                }
            }),
        );
        mapper.on_notification(
            "session/update",
            &json!({
                "sessionId": child,
                "update": {
                    "sessionUpdate": "agent_thought_chunk",
                    "content": {"type": "text", "text": "看规格"}
                }
            }),
        );
        assert!(mapper.child_text_is(child, "先写", "看规格"));
    }
}

