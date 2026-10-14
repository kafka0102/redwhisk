//! 打开回放窗口上的定点读取：交付评论正文，以及按字节偏移回读一行。

use std::path::Path;

use crate::types::agent_session_stream::{AgentStreamEvent, AgentTimelineItem};
use crate::types::errors::CommandError;

use super::service::agent_session_start_error;
use super::session_log_line::read_session_log_line_at;
use super::session_log_tail::{read_session_log_turn_window_located, OPEN_REPLAY_TURN_LIMIT};
use super::timeline::structured_events_from_log_line;

/// 按 `turn_id` 从最近 50 个 Turn 的打开回放窗口读取助手答复正文。
/// 同一 `messageId` 只留最后一次完整正文。窗口内找不到该 Turn 时返回空 Vec。
pub(crate) fn read_assistant_texts_for_turn(log_path: &str, turn_id: &str) -> Vec<String> {
    if log_path.trim().is_empty() {
        return Vec::new();
    }
    let Ok(lines) =
        read_session_log_turn_window_located(Path::new(log_path), OPEN_REPLAY_TURN_LIMIT)
    else {
        return Vec::new();
    };
    let mut latest_by_message: Vec<(Option<String>, Option<String>, String)> = Vec::new();
    for line in &lines {
        let Some(events) = structured_events_from_log_line(&line.text) else {
            continue;
        };
        for event in events {
            remember_assistant_text(&mut latest_by_message, event, turn_id);
        }
    }
    latest_by_message
        .into_iter()
        .map(|(_, _, text)| text)
        .collect()
}

fn remember_assistant_text(
    latest_by_message: &mut Vec<(Option<String>, Option<String>, String)>,
    event: AgentStreamEvent,
    turn_id: &str,
) {
    let AgentStreamEvent::Timeline {
        item,
        turn_id: Some(event_turn_id),
        ..
    } = event
    else {
        return;
    };
    if event_turn_id != turn_id {
        return;
    }
    let AgentTimelineItem::AssistantMessage {
        text,
        message_id,
        subagent_id,
    } = item
    else {
        return;
    };
    if let Some(message_id) = message_id.as_ref() {
        if let Some(existing) = latest_by_message.iter_mut().rev().find(|(id, source, _)| {
            id.as_deref() == Some(message_id.as_str()) && source == &subagent_id
        }) {
            existing.2 = text.to_string();
            return;
        }
    }
    latest_by_message.push((message_id, subagent_id, text.to_string()));
}

/// 折叠项回读：按会话日志行的起始字节只读这一行，解析成时间轴项。
pub(crate) fn read_timeline_item_at_log_offset(
    log_path: &str,
    offset: u64,
) -> Result<AgentTimelineItem, CommandError> {
    let line =
        read_session_log_line_at(Path::new(log_path), offset).map_err(agent_session_start_error)?;
    timeline_item_from_line(line.trim()).ok_or_else(|| {
        agent_session_start_error(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "session log line is not a timeline item",
        ))
    })
}

fn timeline_item_from_line(line: &str) -> Option<AgentTimelineItem> {
    structured_events_from_log_line(line).and_then(|events| {
        events.into_iter().find_map(|event| match event {
            AgentStreamEvent::Timeline { item, .. } => Some(item),
            _ => None,
        })
    })
}
