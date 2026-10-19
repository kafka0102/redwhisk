use serde::{Deserialize, Serialize};

use crate::types::agent_session_stream::{AgentPermissionRequest, AgentTimelineItem};

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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAgentTimelineInput {
    pub project_id: i64,
    pub session_id: i64,
    /// 已覆盖到的会话日志字节。不传则回放整个打开窗口。
    #[serde(default)]
    pub since_log_offset: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAgentTimelineResult {
    pub items: Vec<TimelineHistoryItem>,
    pub effort: Option<String>,
    pub model: Option<String>,
    /// 打开窗口内最后一条快照的起始字节。没有条目时缺省。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_end_offset: Option<u64>,
    /// 游标落在行中间或超出文件，调用方应整份替换而不是按游标拼接。
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub reset_required: bool,
    /// 打开窗口内仍待用户审批的请求（已被解决的不会出现）。没有时缺省。
    ///
    /// 会话重建、切回已缓存会话时用它恢复审批卡片：这类事件只走实时流，重放
    /// 时间轴不会带回，离开期间挂起的审批会因此从界面上消失。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pending_permissions: Vec<AgentPermissionRequest>,
}

/// 按会话日志行的起始字节回读这一行。
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTimelineItemAtOffsetInput {
    pub project_id: i64,
    pub session_id: i64,
    pub log_offset: u64,
}
