//! 打开回放窗口上的定点读取：交付评论正文，以及按字节偏移回读一行。

use std::path::Path;

use crate::types::agent_session_stream::{AgentStreamEvent, AgentTimelineItem};
use crate::types::errors::CommandError;

use super::service::agent_session_start_error;
use super::session_log_assistant::assistant_snapshot_meta;
use super::session_log_line::read_session_log_line_at;
use super::session_log_tail::{for_each_session_log_line_in_turn_window, OPEN_REPLAY_TURN_LIMIT};
use super::timeline::structured_events_from_log_line;

/// 按 `turn_id` 从最近 50 个 Turn 的打开回放窗口读取助手答复正文。
/// 同一 `messageId` 只留最后一次完整正文。窗口内找不到该 Turn 时返回空 Vec。
struct AssistantTextSlot {
    message_id: Option<String>,
    subagent_id: Option<String>,
    offset: u64,
    text: Option<String>,
}

pub(crate) fn read_assistant_texts_for_turn(log_path: &str, turn_id: &str) -> Vec<String> {
    if log_path.trim().is_empty() {
        return Vec::new();
    }
    let mut slots = Vec::new();
    let streamed = for_each_session_log_line_in_turn_window(
        Path::new(log_path),
        OPEN_REPLAY_TURN_LIMIT,
        |offset, line| {
            if let Some(meta) = assistant_snapshot_meta(line) {
                if meta.turn_id.as_deref() == Some(turn_id) {
                    remember_assistant_slot(
                        &mut slots,
                        Some(meta.message_id),
                        meta.subagent_id,
                        offset,
                        None,
                    );
                }
                return Ok(());
            }
            let Ok(text) = std::str::from_utf8(line) else {
                return Ok(());
            };
            let Some(events) = structured_events_from_log_line(text) else {
                return Ok(());
            };
            for event in events {
                remember_parsed_assistant(&mut slots, event, turn_id, offset);
            }
            Ok(())
        },
    );
    if streamed.is_err() {
        return Vec::new();
    }
    let mut texts = Vec::with_capacity(slots.len());
    for slot in slots {
        if let Some(text) = slot.text {
            texts.push(text);
            continue;
        }
        let Ok(line) = read_session_log_line_at(Path::new(log_path), slot.offset) else {
            return Vec::new();
        };
        texts.push(assistant_text_from_line(line.trim()).unwrap_or_default());
    }
    texts
}

fn remember_assistant_slot(
    slots: &mut Vec<AssistantTextSlot>,
    message_id: Option<String>,
    subagent_id: Option<String>,
    offset: u64,
    text: Option<String>,
) {
    if let Some(message_id) = message_id.as_ref() {
        if let Some(existing) = slots.iter_mut().rev().find(|slot| {
            slot.message_id.as_deref() == Some(message_id.as_str())
                && slot.subagent_id == subagent_id
        }) {
            existing.offset = offset;
            existing.text = text;
            return;
        }
    }
    slots.push(AssistantTextSlot {
        message_id,
        subagent_id,
        offset,
        text,
    });
}

fn remember_parsed_assistant(
    slots: &mut Vec<AssistantTextSlot>,
    event: AgentStreamEvent,
    turn_id: &str,
    offset: u64,
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
    remember_assistant_slot(
        slots,
        message_id,
        subagent_id,
        offset,
        Some(text.to_string()),
    );
}

fn assistant_text_from_line(line: &str) -> Option<String> {
    structured_events_from_log_line(line).and_then(|events| {
        events.into_iter().find_map(|event| match event {
            AgentStreamEvent::Timeline {
                item: AgentTimelineItem::AssistantMessage { text, .. },
                ..
            } => Some(text.to_string()),
            _ => None,
        })
    })
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
