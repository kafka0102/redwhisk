//! 进程已经不在时，把花名册里仍标着 running 的子智能体收成 ended。
//!
//! 应用退出不会等到子线程的 completed。重启后的 turn_canceled
//! （no_interruptible_turn）又不进入 timeline 回放，停止按钮会一直被
//! 这条 running 按住。这里把收口写回运行日志，下次打开不再显示可停止。

use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem, SubagentRosterStatus,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

use super::structured_events_from_log_line;

const LINE_FEED: u8 = 10;
const CARRIAGE_RETURN: u8 = 13;

pub(crate) fn close_running_subagents_in_log(
    log_path: &str,
    session_thread_id: Option<&str>,
    project_id: i64,
    session_id: i64,
) -> Result<Vec<String>, CommandError> {
    if log_path.trim().is_empty() {
        return Ok(Vec::new());
    }
    let path = Path::new(log_path);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let session_thread_id = session_thread_id.map(str::trim).filter(|id| !id.is_empty());
    let mut latest: Vec<(String, SubagentRosterStatus)> = Vec::new();
    let file = std::fs::File::open(path).map_err(session_log_write_error)?;
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    loop {
        line.clear();
        let read = reader
            .read_until(LINE_FEED, &mut line)
            .map_err(session_log_write_error)?;
        if read == 0 {
            break;
        }
        if line.last() == Some(&LINE_FEED) {
            line.pop();
        }
        if line.last() == Some(&CARRIAGE_RETURN) {
            line.pop();
        }
        let Ok(text) = std::str::from_utf8(&line) else {
            continue;
        };
        let Some(events) = structured_events_from_log_line(text.trim()) else {
            continue;
        };
        for event in events {
            let AgentStreamEvent::Timeline {
                item:
                    AgentTimelineItem::SubagentRoster {
                        subagent_id,
                        status,
                    },
                ..
            } = event
            else {
                continue;
            };
            if session_thread_id.is_some_and(|parent| parent == subagent_id) {
                continue;
            }
            if let Some(existing) = latest.iter_mut().find(|(id, _)| id == &subagent_id) {
                existing.1 = status;
            } else {
                latest.push((subagent_id, status));
            }
        }
    }
    let running = latest
        .into_iter()
        .filter(|(_, status)| *status == SubagentRosterStatus::Running)
        .map(|(id, _)| id)
        .collect::<Vec<_>>();
    if running.is_empty() {
        return Ok(running);
    }
    let mut output = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(session_log_write_error)?;
    for (index, subagent_id) in running.iter().enumerate() {
        let envelope = AgentStreamEventEnvelope {
            project_id,
            session_id,
            seq: index as u64,
            epoch: "epoch-restart".to_string(),
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::SubagentRoster {
                    subagent_id: subagent_id.clone(),
                    status: SubagentRosterStatus::Ended,
                },
                turn_id: None,
                seq: 0,
                timestamp: 0,
            },
            log_offset: None,
        };
        let line = serde_json::to_string(&envelope).map_err(session_log_write_error)?;
        writeln!(output, "{line}").map_err(session_log_write_error)?;
    }
    Ok(running)
}

fn session_log_write_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionPersistenceFailed,
        "Agent Session 日志写入失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
