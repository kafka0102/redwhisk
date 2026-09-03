use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use crate::agent::pty_session_manager::read_terminal_snapshot;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem, ToolCallDetail,
};
use crate::types::errors::CommandError;

use super::service::{agent_session_start_error, strip_terminal_control_sequences};

const TIMELINE_LOG_SNAPSHOT_MAX_BYTES: usize = 262_144;
const LATEST_OUTPUT_MAX_CHARS: usize = 500;

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct StructuredTimelineHistory {
    pub(crate) items: Vec<AgentTimelineItem>,
    pub(crate) effort: Option<String>,
}

pub(super) fn should_archive_timeline_item(item: &AgentTimelineItem) -> bool {
    matches!(
        item,
        AgentTimelineItem::UserMessage { .. }
            | AgentTimelineItem::AssistantMessage { .. }
            | AgentTimelineItem::Error { .. }
    )
}

/// 按 `turn_id` 从 session log 读取该 turn 全部助手答复正文（按日志顺序）。
/// log 每行是 `AgentStreamEventEnvelope` JSON；匹配 `Timeline { item: AssistantMessage, turn_id }`。
/// log 路径空或文件不可读返回空 Vec。供交付评论：标签扫描与兜底正文。
pub(crate) fn read_assistant_texts_for_turn(log_path: &str, turn_id: &str) -> Vec<String> {
    if log_path.trim().is_empty() {
        return Vec::new();
    }
    let Ok(file) = File::open(log_path) else {
        return Vec::new();
    };
    BufReader::new(file)
        .lines()
        .filter_map(|line| line.ok())
        .filter_map(|line| structured_events_from_log_line(&line))
        .flatten()
        .filter_map(|event| match event {
            AgentStreamEvent::Timeline {
                item,
                turn_id: Some(t),
                ..
            } if t == turn_id => match item {
                AgentTimelineItem::AssistantMessage { text, .. } => Some(text),
                _ => None,
            },
            _ => None,
        })
        .collect()
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

    let items = read_terminal_timeline_log(path)?;
    Ok(StructuredTimelineHistory {
        items,
        effort: None,
    })
}

fn read_structured_timeline_log(
    path: &Path,
) -> Result<Option<StructuredTimelineHistory>, CommandError> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Some(StructuredTimelineHistory::default()));
        }
        Err(error) => return Err(agent_session_start_error(error)),
    };
    let reader = BufReader::new(file);
    let mut saw_structured_line = false;
    let mut history = StructuredTimelineHistory::default();
    let mut pending_reasoning_started_at: Option<i64> = None;

    for line in reader.lines() {
        let line = line.map_err(agent_session_start_error)?;
        let trimmed = line.trim();
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
                AgentStreamEvent::Timeline {
                    item, timestamp, ..
                } => {
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

                    push_compacted_timeline_item(&mut history.items, item);

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

fn structured_events_from_log_line(line: &str) -> Option<Vec<AgentStreamEvent>> {
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
    items: &mut [AgentTimelineItem],
    started_at: Option<i64>,
    end_timestamp: i64,
) {
    let Some(started_at) = started_at else {
        return;
    };
    if end_timestamp <= started_at {
        return;
    }
    let Some(AgentTimelineItem::Reasoning { duration_ms, .. }) = items.last_mut() else {
        return;
    };
    if duration_ms.is_none() {
        *duration_ms = Some((end_timestamp - started_at) as u64);
    }
}

fn push_compacted_timeline_item(items: &mut Vec<AgentTimelineItem>, item: AgentTimelineItem) {
    match &item {
        AgentTimelineItem::AssistantMessage {
            message_id: Some(message_id),
            ..
        } => {
            if let Some(index) = items.iter().rposition(|existing| {
                matches!(
                    existing,
                    AgentTimelineItem::AssistantMessage {
                        message_id: Some(existing_id),
                        ..
                    } if existing_id == message_id
                )
            }) {
                items[index] = item;
                return;
            }
        }
        AgentTimelineItem::UserMessage {
            message_id: Some(message_id),
            ..
        } => {
            if let Some(index) = items.iter().rposition(|existing| {
                matches!(
                    existing,
                    AgentTimelineItem::UserMessage {
                        message_id: Some(existing_id),
                        ..
                    } if existing_id == message_id
                )
            }) {
                items[index] = item;
                return;
            }
        }
        AgentTimelineItem::Reasoning { .. } => {
            if matches!(items.last(), Some(AgentTimelineItem::Reasoning { .. })) {
                if let Some(last) = items.last_mut() {
                    let previous = last.clone();
                    *last = merge_reasoning_timeline_item(previous, item);
                    return;
                }
            }
        }
        AgentTimelineItem::ToolCall { call_id, .. } => {
            if let Some(index) = items.iter().rposition(|existing| {
                matches!(
                    existing,
                    AgentTimelineItem::ToolCall {
                        call_id: existing_id,
                        ..
                    } if existing_id == call_id
                )
            }) {
                let previous = items[index].clone();
                items[index] = merge_tool_call_timeline_item(previous, item);
                return;
            }
        }
        AgentTimelineItem::Todo { .. } => {
            if matches!(items.last(), Some(AgentTimelineItem::Todo { .. })) {
                if let Some(last) = items.last_mut() {
                    *last = item;
                    return;
                }
            }
        }
        _ => {}
    }

    items.push(item);
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
            },
            AgentTimelineItem::Reasoning {
                text,
                duration_ms: None,
            },
        ) if previous_duration_ms.is_some() && previous_text == text => {
            AgentTimelineItem::Reasoning {
                text,
                duration_ms: previous_duration_ms,
            }
        }
        (_, incoming) => incoming,
    }
}

fn merge_tool_call_timeline_item(
    previous: AgentTimelineItem,
    incoming: AgentTimelineItem,
) -> AgentTimelineItem {
    match (previous, incoming) {
        (
            AgentTimelineItem::ToolCall {
                call_id,
                name: previous_name,
                detail: previous_detail,
                status: _,
                error: _,
            },
            AgentTimelineItem::ToolCall {
                name,
                detail,
                status,
                error,
                ..
            },
        ) => AgentTimelineItem::ToolCall {
            call_id,
            name: if should_preserve_existing_tool_name(&previous_name, &name) {
                previous_name
            } else {
                name
            },
            detail: merge_tool_call_detail(previous_detail, detail),
            status,
            error,
        },
        (_, incoming) => incoming,
    }
}

fn should_preserve_existing_tool_name(previous: &str, incoming: &str) -> bool {
    !is_generic_tool_name(previous)
        && (incoming.trim().is_empty() || is_generic_tool_name(incoming))
}

fn is_generic_tool_name(name: &str) -> bool {
    name.trim().eq_ignore_ascii_case("tool")
}

fn merge_tool_call_detail(previous: ToolCallDetail, incoming: ToolCallDetail) -> ToolCallDetail {
    if std::mem::discriminant(&previous) != std::mem::discriminant(&incoming) {
        return incoming;
    }

    match (previous, incoming) {
        (
            ToolCallDetail::Shell {
                command: previous_command,
                output: previous_output,
                exit_code: previous_exit_code,
            },
            ToolCallDetail::Shell {
                command,
                output,
                exit_code,
            },
        ) => ToolCallDetail::Shell {
            command: if command.is_empty() {
                previous_command
            } else {
                command
            },
            output: output.or(previous_output),
            exit_code: exit_code.or(previous_exit_code),
        },
        (
            ToolCallDetail::Read {
                path: previous_path,
                content: previous_content,
            },
            ToolCallDetail::Read { path, content },
        ) => ToolCallDetail::Read {
            path: if path.is_empty() { previous_path } else { path },
            content: content.or(previous_content),
        },
        (
            ToolCallDetail::Edit {
                path: previous_path,
                diff: previous_diff,
            },
            ToolCallDetail::Edit { path, diff },
        ) => ToolCallDetail::Edit {
            path: if path.is_empty() { previous_path } else { path },
            diff: diff.or(previous_diff),
        },
        (
            ToolCallDetail::Write {
                path: previous_path,
                content: previous_content,
            },
            ToolCallDetail::Write { path, content },
        ) => ToolCallDetail::Write {
            path: if path.is_empty() { previous_path } else { path },
            content: content.or(previous_content),
        },
        (
            ToolCallDetail::Search {
                query: previous_query,
                mode: _previous_mode,
                matches: previous_matches,
            },
            ToolCallDetail::Search {
                query,
                mode,
                matches,
            },
        ) => ToolCallDetail::Search {
            query: if query.is_empty() {
                previous_query
            } else {
                query
            },
            mode,
            matches: if matches.is_empty() {
                previous_matches
            } else {
                matches
            },
        },
        (
            ToolCallDetail::SubAgent {
                child_session_id: previous_child_session_id,
            },
            ToolCallDetail::SubAgent { child_session_id },
        ) => ToolCallDetail::SubAgent {
            child_session_id: child_session_id.or(previous_child_session_id),
        },
        (
            ToolCallDetail::Plan {
                text: previous_text,
            },
            ToolCallDetail::Plan { text },
        ) => ToolCallDetail::Plan {
            text: if text.is_empty() { previous_text } else { text },
        },
        (
            ToolCallDetail::Unknown {
                raw_input: previous_raw_input,
                raw_output: previous_raw_output,
            },
            ToolCallDetail::Unknown {
                raw_input,
                raw_output,
            },
        ) => ToolCallDetail::Unknown {
            raw_input: raw_input.or(previous_raw_input),
            raw_output: raw_output.or(previous_raw_output),
        },
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
        _ => None,
    }
}

pub(crate) fn latest_effort_from_session_log(
    session: &crate::types::agent_session::AgentSessionRecord,
) -> Option<String> {
    let path = Path::new(&session.log_path);
    read_structured_timeline_log(path)
        .ok()
        .flatten()
        .and_then(|history| history.effort)
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
        text,
        message_id: Some("session-log".to_string()),
    }])
}

pub(super) fn latest_output_from_session_log(log_path: &str) -> Option<String> {
    if log_path.trim().is_empty() {
        return None;
    }

    let path = Path::new(log_path);
    if let Ok(Some(history)) = read_structured_timeline_log(path) {
        for item in history.items.iter().rev() {
            if let Some(output) = latest_output_from_timeline_item(item) {
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
        | AgentTimelineItem::UserMessage { text, .. }
        | AgentTimelineItem::Reasoning { text, .. } => text.as_str(),
        AgentTimelineItem::ToolCall { name, detail, .. } => match detail {
            ToolCallDetail::Shell { command, .. } => command.as_str(),
            ToolCallDetail::Read { path, .. }
            | ToolCallDetail::Edit { path, .. }
            | ToolCallDetail::Write { path, .. } => path.as_str(),
            ToolCallDetail::Search { query, .. } => query.as_str(),
            ToolCallDetail::Plan { text } => text.as_str(),
            ToolCallDetail::SubAgent { .. } | ToolCallDetail::Unknown { .. } => name.as_str(),
        },
        AgentTimelineItem::Todo { .. } => "Plan updated",
        AgentTimelineItem::Error { message } => message.as_str(),
        AgentTimelineItem::Compaction { .. } => "Context compacted",
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
