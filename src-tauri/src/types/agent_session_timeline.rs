use serde::Serialize;

use crate::types::agent_session_stream::AgentTimelineItem;

/// 打开回放里的一条时间轴项，带上所属 Turn 和最新一次快照的回读位置。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineHistoryItem {
    pub item: AgentTimelineItem,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_offset: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAgentTimelineResult {
    pub items: Vec<TimelineHistoryItem>,
    pub effort: Option<String>,
    pub model: Option<String>,
}

/// 按会话日志行的起始字节回读这一行。
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTimelineItemAtOffsetInput {
    pub project_id: i64,
    pub session_id: i64,
    pub log_offset: u64,
}
