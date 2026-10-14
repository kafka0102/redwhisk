//! json 归档：逐行扫描整份会话日志，只累积用户消息、助手消息和错误。

use std::fs::File;
use std::io::{BufRead, BufReader};

use serde_json::Value;

use crate::types::agent_session_stream::AgentTimelineItem;
use crate::types::errors::CommandError;

use super::service::agent_session_start_error;

pub(super) fn read_json_archive_items(
    runtime_log_path: &str,
) -> Result<Vec<AgentTimelineItem>, CommandError> {
    if runtime_log_path.trim().is_empty() {
        return Ok(Vec::new());
    }
    let file = match File::open(runtime_log_path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(agent_session_start_error(error)),
    };
    let mut items: Vec<AgentTimelineItem> = Vec::new();
    for line in BufReader::new(file).lines() {
        let line = line.map_err(agent_session_start_error)?;
        let Some(item) = archive_item_from_log_line(&line) else {
            continue;
        };
        remember_archive_item(&mut items, item);
    }
    Ok(items)
}

/// 只反序列化要归档的时间轴项。工具调用等行在类型字符串上就被丢掉，不解析正文。
fn archive_item_from_log_line(line: &str) -> Option<AgentTimelineItem> {
    let trimmed = line.trim();
    if trimmed.is_empty() || !line_is_archivable_timeline(trimmed) {
        return None;
    }
    let value: Value = serde_json::from_str(trimmed).ok()?;
    let event = value.get("event").unwrap_or(&value);
    let item = event.get("item")?;
    serde_json::from_value(item.clone()).ok()
}

fn line_is_archivable_timeline(line: &str) -> bool {
    let Some(item_type) = item_type_in_log_line(line) else {
        return false;
    };
    matches!(item_type, "user_message" | "assistant_message" | "error")
}

fn item_type_in_log_line(line: &str) -> Option<&str> {
    let marker = "\"type\":\"";
    let mut rest = line;
    while let Some(index) = rest.find(marker) {
        let after = &rest[index + marker.len()..];
        let end = after.find('"')?;
        let kind = &after[..end];
        if kind == "timeline" {
            rest = &after[end + 1..];
            continue;
        }
        return Some(kind);
    }
    None
}

fn remember_archive_item(items: &mut Vec<AgentTimelineItem>, item: AgentTimelineItem) {
    let AgentTimelineItem::AssistantMessage {
        message_id: Some(message_id),
        subagent_id,
        ..
    } = &item
    else {
        items.push(item);
        return;
    };
    if let Some(index) = items.iter().rposition(|existing| {
        matches!(
            existing,
            AgentTimelineItem::AssistantMessage {
                message_id: Some(existing_id),
                subagent_id: existing_source,
                ..
            } if existing_id == message_id && existing_source == subagent_id
        )
    }) {
        items[index] = item;
        return;
    }
    items.push(item);
}
