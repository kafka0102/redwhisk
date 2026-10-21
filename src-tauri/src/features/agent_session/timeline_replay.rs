//! 打开回放：按最近的工具调用开窗，流式折叠，不把快照帧留在内存里。

use std::collections::HashSet;
use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::path::Path;

use crate::types::agent_session::TimelineHistoryItem;
use crate::types::agent_session_stream::{AgentStreamEvent, AgentTimelineItem, SnapshotText};
use crate::types::errors::CommandError;

use super::super::service::agent_session_start_error;
use super::super::session_log_assistant::assistant_snapshot_meta;
use super::super::session_log_line::read_session_log_line_at;
use super::super::session_log_tail::{
    for_each_session_log_line_in_tool_call_window, OPEN_REPLAY_TOOL_CALL_LIMIT,
};
use super::{
    finalize_pending_reasoning_duration, push_compacted_timeline_item,
    structured_events_from_log_line, StructuredTimelineHistory,
};

pub(super) fn read_structured_timeline_log(
    path: &Path,
    since_log_offset: Option<u64>,
) -> Result<Option<StructuredTimelineHistory>, CommandError> {
    let mut replay = OpenReplay::default();
    let mut window_start = None;
    match for_each_session_log_line_in_tool_call_window(
        path,
        OPEN_REPLAY_TOOL_CALL_LIMIT,
        |offset, line| {
            if window_start.is_none() {
                window_start = Some(offset);
            }
            replay.apply_line(offset, line)
        },
    ) {
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
    // 打开窗口只留最近的工具调用。更早结束的子智能体不在窗口里；
    // 切回时游标也已经越过那条 ended。两条都丢的话，缓存里的 running 会一直按住提交按钮。
    let mut latest_roster = latest_roster_before_window(path, window_start.unwrap_or(0))
        .map_err(agent_session_start_error)?;
    for entry in &replay.history.items {
        if roster_id(&entry.item).is_some() {
            upsert_latest_roster(&mut latest_roster, entry.item.clone());
        }
    }
    if let Some(cursor) = since_log_offset {
        replay
            .history
            .items
            .retain(|entry| entry.log_offset.is_none_or(|offset| offset > cursor));
    }
    prepend_missing_roster(&mut replay.history.items, latest_roster);
    Ok(Some(replay.history))
}

const SUBAGENT_ROSTER_MARK: &[u8] = b"\"type\":\"subagent_roster\"";

fn latest_roster_before_window(
    path: &Path,
    window_start: u64,
) -> io::Result<Vec<AgentTimelineItem>> {
    if window_start == 0 {
        return Ok(Vec::new());
    }
    let mut reader = BufReader::new(File::open(path)?);
    let mut line = Vec::new();
    let mut offset = 0u64;
    let mut latest = Vec::new();
    loop {
        if offset >= window_start {
            break;
        }
        line.clear();
        let read = reader.read_until(b'\n', &mut line)?;
        if read == 0 {
            break;
        }
        let line_start = offset;
        offset += read as u64;
        if line_start >= window_start {
            break;
        }
        if line
            .windows(SUBAGENT_ROSTER_MARK.len())
            .all(|window| window != SUBAGENT_ROSTER_MARK)
        {
            continue;
        }
        if line.last() == Some(&b'\n') {
            line.pop();
        }
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        let Ok(text) = std::str::from_utf8(&line) else {
            continue;
        };
        let Some(events) = structured_events_from_log_line(text.trim()) else {
            continue;
        };
        for event in events {
            let AgentStreamEvent::Timeline { item, .. } = event else {
                continue;
            };
            upsert_latest_roster(&mut latest, item);
        }
    }
    Ok(latest)
}

fn roster_id(item: &AgentTimelineItem) -> Option<&str> {
    match item {
        AgentTimelineItem::SubagentRoster { subagent_id, .. } => Some(subagent_id.as_str()),
        _ => None,
    }
}

fn upsert_latest_roster(latest: &mut Vec<AgentTimelineItem>, item: AgentTimelineItem) {
    let Some(id) = roster_id(&item) else {
        return;
    };
    if let Some(existing) = latest.iter_mut().find(|entry| roster_id(entry) == Some(id)) {
        *existing = item;
    } else {
        latest.push(item);
    }
}

fn prepend_missing_roster(items: &mut Vec<TimelineHistoryItem>, latest: Vec<AgentTimelineItem>) {
    let delivered = items
        .iter()
        .filter_map(|entry| roster_id(&entry.item).map(str::to_string))
        .collect::<HashSet<_>>();
    let missing = latest
        .into_iter()
        .filter(|item| roster_id(item).is_some_and(|id| !delivered.contains(id)))
        .map(|item| TimelineHistoryItem {
            item,
            log_offset: None,
            turn_id: None,
        })
        .collect::<Vec<_>>();
    if missing.is_empty() {
        return;
    }
    let mut merged = missing;
    merged.append(items);
    *items = merged;
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
            // 审批事件只走实时流，重放时间轴拿不到；这里顺带算出窗口内仍待审批的
            // 请求，供会话重建 / 切回时恢复审批卡片。
            AgentStreamEvent::PermissionRequested { request } => {
                if !self
                    .history
                    .pending_permissions
                    .iter()
                    .any(|pending| pending.id == request.id)
                {
                    self.history.pending_permissions.push(request);
                }
            }
            AgentStreamEvent::PermissionResolved { request_id, .. } => {
                self.history
                    .pending_permissions
                    .retain(|pending| pending.id != request_id);
            }
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
