//! 打开回放：按 Turn 窗口流式折叠，不把快照帧留在内存里。

use std::io;
use std::path::Path;

use crate::types::agent_session::TimelineHistoryItem;
use crate::types::agent_session_stream::{AgentStreamEvent, AgentTimelineItem, SnapshotText};
use crate::types::errors::CommandError;

use super::super::service::agent_session_start_error;
use super::super::session_log_assistant::assistant_snapshot_meta;
use super::super::session_log_line::read_session_log_line_at;
use super::super::session_log_tail::{
    for_each_session_log_line_in_turn_window, OPEN_REPLAY_TURN_LIMIT,
};
use super::{
    finalize_pending_reasoning_duration, push_compacted_timeline_item,
    structured_events_from_log_line, StructuredTimelineHistory,
};

pub(super) fn read_structured_timeline_log(
    path: &Path,
) -> Result<Option<StructuredTimelineHistory>, CommandError> {
    let mut replay = OpenReplay::default();
    match for_each_session_log_line_in_turn_window(path, OPEN_REPLAY_TURN_LIMIT, |offset, line| {
        replay.apply_line(offset, line)
    }) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Some(StructuredTimelineHistory::default()));
        }
        Err(error) => return Err(agent_session_start_error(error)),
    }
    if replay.not_structured || !replay.saw_structured_line {
        return Ok(None);
    }
    hydrate_assistant_snapshots(path, &mut replay.history.items)
        .map_err(agent_session_start_error)?;
    Ok(Some(replay.history))
}

#[derive(Default)]
struct OpenReplay {
    saw_structured_line: bool,
    not_structured: bool,
    history: StructuredTimelineHistory,
    pending_reasoning_started_at: Option<i64>,
    current_turn_id: Option<String>,
}

impl OpenReplay {
    fn apply_line(&mut self, offset: u64, line: &[u8]) -> io::Result<()> {
        if self.not_structured || line.iter().all(u8::is_ascii_whitespace) {
            return Ok(());
        }
        if let Some(meta) = assistant_snapshot_meta(line) {
            self.saw_structured_line = true;
            self.apply_event(
                offset,
                AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::AssistantMessage {
                        text: SnapshotText::default(),
                        message_id: Some(meta.message_id),
                        subagent_id: meta.subagent_id,
                    },
                    turn_id: meta.turn_id,
                    seq: 0,
                    timestamp: meta.timestamp,
                },
            );
            return Ok(());
        }
        let text = std::str::from_utf8(line)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let Some(events) = structured_events_from_log_line(text.trim()) else {
            if self.saw_structured_line {
                return Ok(());
            }
            self.not_structured = true;
            return Ok(());
        };
        self.saw_structured_line = true;
        for event in events {
            self.apply_event(offset, event);
        }
        Ok(())
    }

    fn apply_event(&mut self, offset: u64, event: AgentStreamEvent) {
        match event {
            AgentStreamEvent::TurnStarted { turn_id } => {
                self.current_turn_id = turn_id.or(self.current_turn_id.take());
            }
            AgentStreamEvent::Timeline {
                item,
                turn_id,
                timestamp,
                ..
            } => {
                if turn_id.is_some() {
                    self.current_turn_id = turn_id;
                }
                if !matches!(item, AgentTimelineItem::Reasoning { .. }) {
                    finalize_pending_reasoning_duration(
                        &mut self.history.items,
                        self.pending_reasoning_started_at.take(),
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
                    &mut self.history.items,
                    TimelineHistoryItem {
                        item,
                        log_offset: Some(offset),
                        turn_id: self.current_turn_id.clone(),
                    },
                );
                if has_explicit_reasoning_duration {
                    self.pending_reasoning_started_at = None;
                } else if starts_reasoning_without_duration
                    && self.pending_reasoning_started_at.is_none()
                    && timestamp > 0
                {
                    self.pending_reasoning_started_at = Some(timestamp);
                }
            }
            AgentStreamEvent::EffortChanged { effort } => self.history.effort = effort,
            AgentStreamEvent::ModelChanged { model_id } => self.history.model = Some(model_id),
            _ => {}
        }
    }
}

fn hydrate_assistant_snapshots(path: &Path, items: &mut [TimelineHistoryItem]) -> io::Result<()> {
    for entry in items {
        let AgentTimelineItem::AssistantMessage { text, .. } = &entry.item else {
            continue;
        };
        if !text.is_empty() {
            continue;
        }
        let Some(offset) = entry.log_offset else {
            continue;
        };
        let line = read_session_log_line_at(path, offset)?;
        let Some(events) = structured_events_from_log_line(line.trim()) else {
            continue;
        };
        let Some(AgentStreamEvent::Timeline {
            item: AgentTimelineItem::AssistantMessage { text: full, .. },
            ..
        }) = events.into_iter().find(|event| {
            matches!(
                event,
                AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::AssistantMessage { .. },
                    ..
                }
            )
        })
        else {
            continue;
        };
        let AgentTimelineItem::AssistantMessage { text, .. } = &mut entry.item else {
            continue;
        };
        *text = full;
    }
    Ok(())
}
