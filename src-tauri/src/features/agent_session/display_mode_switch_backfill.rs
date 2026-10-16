//! 切到 json 时，把本机会话记录里已完成的轮次写成结构化 JSONL。

use std::fs;
use std::path::Path;

use serde_json::json;

use crate::types::agent_profile::AgentType;
use crate::types::agent_session::AgentSessionRecord;
use crate::types::agent_session_stream::{AgentStreamEvent, AgentTimelineItem, SnapshotText};
use crate::types::errors::CommandError;

use super::claude_tui_archive::claude_session_turns;
use super::codex_session_log::read_codex_session_summary;
use super::display_mode_switch::NativeSessionHomes;
use super::grok_tui_archive::{grok_session_turns, TuiArchiveSource};
use super::opencode_tui_archive::opencode_session_turns;
use super::service::agent_session_start_error;

pub(super) struct CompletedTurn {
    pub(super) user_text: String,
    pub(super) assistant_text: Option<String>,
}

pub(super) fn completed_turns(
    session: &AgentSessionRecord,
    agent_type: &AgentType,
    homes: NativeSessionHomes<'_>,
    provider_session_id: &str,
) -> Vec<CompletedTurn> {
    let codex_home = homes
        .codex_home
        .map(Path::to_path_buf)
        .or_else(default_codex_home);
    let archive = TuiArchiveSource::new(
        Some(agent_type.clone()),
        session,
        codex_home,
        homes.user_home,
        None,
    );
    let source = archive.as_log_source();
    match agent_type {
        AgentType::Codex => read_codex_session_summary(
            source.codex_home.unwrap_or(Path::new("")),
            provider_session_id,
        )
        .map(|summary| {
            summary
                .turns
                .into_iter()
                .map(|turn| CompletedTurn {
                    user_text: turn.user_text,
                    assistant_text: turn.final_assistant_text,
                })
                .collect()
        })
        .unwrap_or_default(),
        AgentType::Claude => claude_session_turns(source)
            .unwrap_or_default()
            .into_iter()
            .map(|turn| CompletedTurn {
                user_text: turn.user_text,
                assistant_text: turn.conclusion,
            })
            .collect(),
        AgentType::OpenCode => opencode_session_turns(source)
            .unwrap_or_default()
            .into_iter()
            .map(|turn| CompletedTurn {
                user_text: turn.user_text,
                assistant_text: turn.conclusion,
            })
            .collect(),
        AgentType::Grok => grok_session_turns(source)
            .unwrap_or_default()
            .into_iter()
            .map(|turn| CompletedTurn {
                user_text: turn.user_text,
                assistant_text: turn.conclusion,
            })
            .collect(),
        AgentType::DeepSeek => Vec::new(),
    }
}

pub(super) fn write_backfill_jsonl(
    path: &str,
    turns: &[CompletedTurn],
    project_id: i64,
    session_id: i64,
) -> Result<(), CommandError> {
    if let Some(parent) = Path::new(path).parent() {
        fs::create_dir_all(parent).map_err(agent_session_start_error)?;
    }
    let mut lines = Vec::new();
    let mut seq = 1_u64;
    for turn in turns {
        let assistant = turn.assistant_text.as_deref().unwrap_or("").trim();
        if turn.user_text.trim().is_empty() && assistant.is_empty() {
            continue;
        }
        if !turn.user_text.trim().is_empty() {
            lines.push(timeline_line(
                project_id,
                session_id,
                seq,
                AgentTimelineItem::UserMessage {
                    text: turn.user_text.clone(),
                    message_id: None,
                },
            ));
            seq += 1;
        }
        if let Some(text) = turn
            .assistant_text
            .as_deref()
            .filter(|text| !text.trim().is_empty())
        {
            lines.push(timeline_line(
                project_id,
                session_id,
                seq,
                AgentTimelineItem::AssistantMessage {
                    text: SnapshotText::from(text.to_string()),
                    message_id: None,
                    subagent_id: None,
                },
            ));
            seq += 1;
        }
    }
    let body = if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    };
    fs::write(path, body).map_err(agent_session_start_error)?;
    Ok(())
}

fn default_codex_home() -> Option<std::path::PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join(".codex"))
        })
}

fn timeline_line(project_id: i64, session_id: i64, seq: u64, item: AgentTimelineItem) -> String {
    json!({
        "projectId": project_id,
        "sessionId": session_id,
        "seq": seq,
        "epoch": "display-mode-switch",
        "event": AgentStreamEvent::Timeline {
            item,
            turn_id: None,
            seq,
            timestamp: seq as i64,
        },
    })
    .to_string()
}
