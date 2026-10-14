//! 子会话与父会话共用一条 stdio。子会话正文 / 工具进时间线并挂上
//! `subagent_id`，花名册记录启动与结束。这些更新不写进父助手缓冲。

use std::collections::{HashMap, HashSet};

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

    pub(super) fn append_assistant_text(
        &mut self,
        subagent_id: Option<&str>,
        delta: &str,
    ) -> String {
        match subagent_id {
            Some(child_session_id) => {
                Self::append_child_text(&mut self.child_assistant_text, child_session_id, delta)
            }
            None => {
                self.assistant_text.push_str(delta);
                self.assistant_text.clone()
            }
        }
    }

    pub(super) fn append_reasoning_text(
        &mut self,
        subagent_id: Option<&str>,
        delta: &str,
    ) -> String {
        match subagent_id {
            Some(child_session_id) => {
                Self::append_child_text(&mut self.child_reasoning_text, child_session_id, delta)
            }
            None => {
                self.reasoning_text.push_str(delta);
                self.reasoning_text.clone()
            }
        }
    }

    pub(super) fn append_child_text(
        buffer: &mut HashMap<String, String>,
        child_session_id: &str,
        delta: &str,
    ) -> String {
        let text = buffer.entry(child_session_id.to_string()).or_default();
        text.push_str(delta);
        text.clone()
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
}

pub(super) fn new_child_ids() -> HashSet<String> {
    HashSet::new()
}
