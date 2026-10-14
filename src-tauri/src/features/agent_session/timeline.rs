use serde_json::Value;
use std::path::Path;

use crate::agent::pty_session_manager::read_terminal_snapshot;
use crate::types::agent_session::TimelineHistoryItem;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem,
};
use crate::types::errors::CommandError;

use super::service::{agent_session_start_error, strip_terminal_control_sequences};
use super::session_log_tail::{read_session_log_turn_window_located, OPEN_REPLAY_TURN_LIMIT};

#[path = "timeline_tool_merge.rs"]
mod timeline_tool_merge;

use timeline_tool_merge::merge_tool_call_timeline_item;

const TIMELINE_LOG_SNAPSHOT_MAX_BYTES: usize = 262_144;
const LATEST_OUTPUT_MAX_CHARS: usize = 500;

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct StructuredTimelineHistory {
    pub(crate) items: Vec<TimelineHistoryItem>,
    pub(crate) effort: Option<String>,
    pub(crate) model: Option<String>,
}

pub(crate) fn read_timeline_from_log_path(
    log_path: &str,
) -> Result<StructuredTimelineHistory, CommandError> {
    if log_path.trim().is_empty() {
        return Ok(StructuredTimelineHistory::default());
    }

    let path = Path::new(log_path);
    if let Some(history) = read_structured_timeline_log(path)? {
        return Ok(history);
    }

    let items = read_terminal_timeline_log(path)?
        .into_iter()
        .map(|item| TimelineHistoryItem {
            item,
            log_offset: None,
            turn_id: None,
        })
        .collect();
    Ok(StructuredTimelineHistory {
        items,
        effort: None,
        model: None,
    })
}

fn read_structured_timeline_log(
    path: &Path,
) -> Result<Option<StructuredTimelineHistory>, CommandError> {
    let lines = match read_session_log_turn_window_located(path, OPEN_REPLAY_TURN_LIMIT) {
        Ok(lines) => lines,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Some(StructuredTimelineHistory::default()));
        }
        Err(error) => return Err(agent_session_start_error(error)),
    };
    let mut saw_structured_line = false;
    let mut history = StructuredTimelineHistory::default();
    let mut pending_reasoning_started_at: Option<i64> = None;
    let mut current_turn_id: Option<String> = None;

    for line in lines {
        let trimmed = line.text.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Some(events) = structured_events_from_log_line(trimmed) else {
            if saw_structured_line {
                continue;
            }
            return Ok(None);
        };
        saw_structured_line = true;
        for event in events {
            match event {
                AgentStreamEvent::TurnStarted { turn_id } => {
                    current_turn_id = turn_id.or(current_turn_id);
                }
                AgentStreamEvent::Timeline {
                    item,
                    turn_id,
                    timestamp,
                    ..
                } => {
                    if turn_id.is_some() {
                        current_turn_id = turn_id;
                    }
                    if !matches!(item, AgentTimelineItem::Reasoning { .. }) {
                        finalize_pending_reasoning_duration(
                            &mut history.items,
                            pending_reasoning_started_at.take(),
                            timestamp,
                        );
                    }

                    let starts_reasoning_without_duration = matches!(
                        &item,
                        AgentTimelineItem::Reasoning {
                            duration_ms: None,
                            ..
                        }
                    );
                    let has_explicit_reasoning_duration = matches!(
                        &item,
                        AgentTimelineItem::Reasoning {
                            duration_ms: Some(_),
                            ..
                        }
                    );

                    push_compacted_timeline_item(
                        &mut history.items,
                        TimelineHistoryItem {
                            item,
                            log_offset: Some(line.offset),
                            turn_id: current_turn_id.clone(),
                        },
                    );

                    if has_explicit_reasoning_duration {
                        pending_reasoning_started_at = None;
                    } else if starts_reasoning_without_duration
                        && pending_reasoning_started_at.is_none()
                        && timestamp > 0
                    {
                        pending_reasoning_started_at = Some(timestamp);
                    }
                }
                AgentStreamEvent::EffortChanged { effort } => history.effort = effort,
                AgentStreamEvent::ModelChanged { model_id } => history.model = Some(model_id),
                _ => {}
            }
        }
    }

    if saw_structured_line {
        Ok(Some(history))
    } else {
        Ok(None)
    }
}

pub(super) fn structured_events_from_log_line(line: &str) -> Option<Vec<AgentStreamEvent>> {
    let stream = serde_json::Deserializer::from_str(line).into_iter::<Value>();
    let mut saw_value = false;
    let mut events = Vec::new();

    for value in stream {
        saw_value = true;
        let value = value.ok()?;
        events.push(stream_event_from_log_value(value)?);
    }

    saw_value.then_some(events)
}

fn finalize_pending_reasoning_duration(
    items: &mut [TimelineHistoryItem],
    started_at: Option<i64>,
    end_timestamp: i64,
) {
    let Some(started_at) = started_at else {
        return;
    };
    if end_timestamp <= started_at {
        return;
    }
    let Some(AgentTimelineItem::Reasoning { duration_ms, .. }) =
        items.last_mut().map(|entry| &mut entry.item)
    else {
        return;
    };
    if duration_ms.is_none() {
        *duration_ms = Some((end_timestamp - started_at) as u64);
    }
}

fn push_compacted_timeline_item(
    items: &mut Vec<TimelineHistoryItem>,
    incoming: TimelineHistoryItem,
) {
    let item = &incoming.item;
    match item {
        AgentTimelineItem::AssistantMessage {
            message_id: Some(message_id),
            subagent_id,
            ..
        } => {
            if let Some(index) = items.iter().rposition(|existing| {
                matches!(
                    &existing.item,
                    AgentTimelineItem::AssistantMessage {
                        message_id: Some(existing_id),
                        subagent_id: existing_source,
                        ..
                    } if existing_id == message_id && existing_source == subagent_id
                )
            }) {
                // Grok 整轮共用一个 messageId，工具和 reasoning 会插在同一条正文中间。
                // 原地覆盖会把后写的结论留在这些条目前面；重新打开会话时末条又变成
                // 已完成的 tool_call，turn_completed(end_turn) 会被误判成异常中断。
                // 与前端 reducer 一致：仍是尾项时原地替换，中间已有别的条目则挪到尾部。
                if index + 1 == items.len() {
                    items[index] = incoming;
                } else {
                    items.remove(index);
                    items.push(incoming);
                }
                return;
            }
        }
        AgentTimelineItem::UserMessage {
            message_id: Some(message_id),
            ..
        } => {
            if let Some(index) = items.iter().rposition(|existing| {
                matches!(
                    &existing.item,
                    AgentTimelineItem::UserMessage {
                        message_id: Some(existing_id),
                        ..
                    } if existing_id == message_id
                )
            }) {
                items[index] = incoming;
                return;
            }
        }
        AgentTimelineItem::Reasoning { subagent_id, .. } => {
            let same_source = matches!(
                items.last().map(|entry| &entry.item),
                Some(AgentTimelineItem::Reasoning {
                    subagent_id: existing_source,
                    ..
                }) if existing_source == subagent_id
            );
            if same_source {
                if let Some(last) = items.last_mut() {
                    let previous = last.item.clone();
                    last.item = merge_reasoning_timeline_item(previous, incoming.item);
                    last.log_offset = incoming.log_offset.or(last.log_offset);
                    last.turn_id = incoming.turn_id.or(last.turn_id.clone());
                    return;
                }
            }
        }
        AgentTimelineItem::ToolCall {
            call_id,
            subagent_id,
            ..
        } => {
            if let Some(index) = items.iter().rposition(|existing| {
                matches!(
                    &existing.item,
                    AgentTimelineItem::ToolCall {
                        call_id: existing_id,
                        subagent_id: existing_source,
                        ..
                    } if existing_id == call_id && existing_source == subagent_id
                )
            }) {
                let previous = items[index].item.clone();
                items[index].item = merge_tool_call_timeline_item(previous, incoming.item);
                items[index].log_offset = incoming.log_offset.or(items[index].log_offset);
                items[index].turn_id = incoming.turn_id.or(items[index].turn_id.clone());
                return;
            }
        }
        AgentTimelineItem::Todo { .. } => {
            if matches!(
                items.last().map(|entry| &entry.item),
                Some(AgentTimelineItem::Todo { .. })
            ) {
                if let Some(last) = items.last_mut() {
                    last.item = incoming.item;
                    last.log_offset = incoming.log_offset.or(last.log_offset);
                    last.turn_id = incoming.turn_id.or(last.turn_id.clone());
                    return;
                }
            }
        }
        _ => {}
    }

    items.push(incoming);
}

fn merge_reasoning_timeline_item(
    previous: AgentTimelineItem,
    incoming: AgentTimelineItem,
) -> AgentTimelineItem {
    match (previous, incoming) {
        (
            AgentTimelineItem::Reasoning {
                text: previous_text,
                duration_ms: previous_duration_ms,
                subagent_id,
            },
            AgentTimelineItem::Reasoning {
                text,
                duration_ms: None,
                ..
            },
        ) if previous_duration_ms.is_some() && previous_text == text => {
            AgentTimelineItem::Reasoning {
                text,
                duration_ms: previous_duration_ms,
                subagent_id,
            }
        }
        (_, incoming) => incoming,
    }
}

fn stream_event_from_log_value(value: Value) -> Option<AgentStreamEvent> {
    if let Ok(envelope) = serde_json::from_value::<AgentStreamEventEnvelope>(value.clone()) {
        return Some(envelope.event);
    }

    let event = value.get("event")?;
    if let Ok(event) = serde_json::from_value::<AgentStreamEvent>(event.clone()) {
        return Some(event);
    }

    match event.get("type").and_then(Value::as_str)? {
        "timeline" => {
            let item =
                serde_json::from_value::<AgentTimelineItem>(event.get("item")?.clone()).ok()?;
            Some(AgentStreamEvent::Timeline {
                item,
                turn_id: event
                    .get("turnId")
                    .and_then(Value::as_str)
                    .map(String::from),
                seq: 0,
                timestamp: 0,
            })
        }
        "effort_changed" => Some(AgentStreamEvent::EffortChanged {
            effort: event
                .get("effort")
                .and_then(Value::as_str)
                .map(String::from),
        }),
        "model_changed" => Some(AgentStreamEvent::ModelChanged {
            model_id: event.get("modelId").and_then(Value::as_str)?.to_string(),
        }),
        _ => None,
    }
}

pub(crate) fn latest_effort_from_session_log(
    session: &crate::types::agent_session::AgentSessionRecord,
) -> Option<String> {
    latest_history_from_session_log(session).and_then(|history| history.effort)
}

pub(crate) fn latest_model_from_session_log(
    session: &crate::types::agent_session::AgentSessionRecord,
) -> Option<String> {
    latest_history_from_session_log(session).and_then(|history| history.model)
}

fn latest_history_from_session_log(
    session: &crate::types::agent_session::AgentSessionRecord,
) -> Option<StructuredTimelineHistory> {
    let path = Path::new(&session.log_path);
    read_structured_timeline_log(path).ok().flatten()
}

pub(crate) fn is_empty_standalone_thread_timeline_error(message: &str) -> bool {
    message.contains("includeTurns is unavailable before first user message")
        || message.contains("is not materialized yet")
}

fn read_terminal_timeline_log(path: &Path) -> Result<Vec<AgentTimelineItem>, CommandError> {
    let snapshot = match read_terminal_snapshot(path, TIMELINE_LOG_SNAPSHOT_MAX_BYTES) {
        Ok(snapshot) => snapshot,
        Err(error) if error.contains("No such file") || error.contains("not found") => {
            return Ok(Vec::new());
        }
        Err(error) => return Err(agent_session_start_error(error)),
    };
    let text = strip_terminal_control_sequences(&snapshot)
        .replace('\r', "\n")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    if text.is_empty() {
        return Ok(Vec::new());
    }

    Ok(vec![AgentTimelineItem::AssistantMessage {
        text: text.into(),
        message_id: Some("session-log".to_string()),
        subagent_id: None,
    }])
}

pub(super) fn latest_output_from_session_log(log_path: &str) -> Option<String> {
    if log_path.trim().is_empty() {
        return None;
    }

    let path = Path::new(log_path);
    if let Ok(Some(history)) = read_structured_timeline_log(path) {
        for item in history.items.iter().rev() {
            if let Some(output) = latest_output_from_timeline_item(&item.item) {
                return Some(output);
            }
        }
        return None;
    }

    let snapshot = read_terminal_snapshot(path, TIMELINE_LOG_SNAPSHOT_MAX_BYTES).ok()?;
    latest_output_from_text(&strip_terminal_control_sequences(&snapshot).replace('\r', "\n"))
}

pub(super) fn latest_output_from_timeline_item(item: &AgentTimelineItem) -> Option<String> {
    use crate::types::agent_session_stream::ToolCallDetail;

    let text = match item {
        AgentTimelineItem::AssistantMessage { text, .. }
        | AgentTimelineItem::Reasoning { text, .. } => text.as_str(),
        AgentTimelineItem::UserMessage { text, .. } => text.as_str(),
        AgentTimelineItem::ToolCall { name, detail, .. } => match detail {
            ToolCallDetail::Shell { command, .. } => command.as_str(),
            ToolCallDetail::Read { path, .. }
            | ToolCallDetail::Edit { path, .. }
            | ToolCallDetail::Write { path, .. } => path.as_str(),
            ToolCallDetail::Search { query, .. } => query.as_str(),
            ToolCallDetail::Plan { text } => text.as_str(),
            ToolCallDetail::SubAgent { .. }
            | ToolCallDetail::Unknown { .. }
            | ToolCallDetail::CollabAgent { .. } => name.as_str(),
        },
        AgentTimelineItem::Todo { .. } => "Plan updated",
        AgentTimelineItem::Error { message } => message.as_str(),
        AgentTimelineItem::Compaction { .. } => "Context compacted",
        AgentTimelineItem::SubagentRoster { .. } => return None,
    };

    latest_output_from_text(text)
}

fn latest_output_from_text(text: &str) -> Option<String> {
    let latest_line = text
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    Some(latest_line.chars().take(LATEST_OUTPUT_MAX_CHARS).collect())
}
