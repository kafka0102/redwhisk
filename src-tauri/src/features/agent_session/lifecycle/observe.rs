//! 按 Session 展示形式快照观察 timeline（json=structured；tui 不猜终端 log 格式）。

use std::sync::Arc;

use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::features::agent_session::lifecycle::display_mode::{
    runtime_transport_from_raw, RuntimeTransport,
};
use crate::features::agent_session::service::agent_session_error_to_command_error;
use crate::features::agent_session::timeline::{
    is_empty_standalone_thread_timeline_error, latest_effort_from_session_log,
    latest_model_from_session_log,
};
use crate::types::agent_session::{
    AgentSessionRecord, AgentSessionStatus, ReadAgentTimelineResult, TimelineHistoryItem,
};
use crate::types::agent_session_stream::AgentTimelineItem;
use crate::types::errors::CommandError;

pub(crate) fn read_timeline_for_session(
    session: &AgentSessionRecord,
    handle: Option<Arc<dyn AgentSessionHandle>>,
    since_log_offset: Option<u64>,
) -> Result<ReadAgentTimelineResult, CommandError> {
    match runtime_transport_from_raw(&session.display_mode)? {
        RuntimeTransport::InteractiveTui => Ok(ReadAgentTimelineResult {
            items: Vec::new(),
            effort: None,
            model: None,
            window_end_offset: None,
            reset_required: false,
            pending_permissions: Vec::new(),
        }),
        RuntimeTransport::StructuredJson => read_json_timeline(session, handle, since_log_offset),
    }
}

fn read_json_timeline(
    session: &AgentSessionRecord,
    handle: Option<Arc<dyn AgentSessionHandle>>,
    since_log_offset: Option<u64>,
) -> Result<ReadAgentTimelineResult, CommandError> {
    if session.status != AgentSessionStatus::Running {
        crate::features::agent_session::timeline::close_running_subagents_in_log(
            &session.log_path,
            session.provider_session_id.as_deref(),
            session.project_id,
            session.id,
        )?;
    }
    let (mut history, reset_required) =
        crate::features::agent_session::timeline::read_timeline_from_log_path_since(
            &session.log_path,
            since_log_offset,
        )?;
    history.items =
        without_session_thread_roster(history.items, session.provider_session_id.as_deref());
    if reset_required {
        return Ok(timeline_result(history, true));
    }
    if !history.items.is_empty() || history.effort.is_some() || history.model.is_some() {
        return Ok(timeline_result(history, false));
    }

    if let Some(handle) = handle {
        match handle.read_timeline() {
            Ok(items) => {
                let items = without_session_thread_roster(
                    items
                        .into_iter()
                        .map(|item| TimelineHistoryItem {
                            item,
                            log_offset: None,
                            turn_id: None,
                        })
                        .collect(),
                    session.provider_session_id.as_deref(),
                );
                return Ok(ReadAgentTimelineResult {
                    items,
                    effort: latest_effort_from_session_log(session),
                    model: latest_model_from_session_log(session),
                    window_end_offset: None,
                    reset_required: false,
                    pending_permissions: Vec::new(),
                });
            }
            Err(AgentSessionError::NotRunning(_)) => {}
            Err(AgentSessionError::Protocol(message))
                if session.issue_id.is_none()
                    && is_empty_standalone_thread_timeline_error(&message) =>
            {
                return Ok(ReadAgentTimelineResult {
                    items: Vec::new(),
                    effort: latest_effort_from_session_log(session),
                    model: latest_model_from_session_log(session),
                    window_end_offset: None,
                    reset_required: false,
                    pending_permissions: Vec::new(),
                });
            }
            Err(error) => return Err(agent_session_error_to_command_error(error)),
        }
    }

    Ok(timeline_result(history, false))
}

/// 已经写进日志的父 thread 花名册不再回放。
///
/// 子线程 `interacted` 曾把本会话 thread 记成 running，且不会 ended。
/// 重开后提交按钮会一直显示运行中。真子智能体的 id 与 `provider_session_id` 不同，仍保留。
fn without_session_thread_roster(
    mut items: Vec<TimelineHistoryItem>,
    provider_session_id: Option<&str>,
) -> Vec<TimelineHistoryItem> {
    let Some(session_thread_id) = provider_session_id
        .map(str::trim)
        .filter(|id| !id.is_empty())
    else {
        return items;
    };
    items.retain(|entry| match &entry.item {
        AgentTimelineItem::SubagentRoster { subagent_id, .. } => subagent_id != session_thread_id,
        _ => true,
    });
    items
}

fn timeline_result(
    history: crate::features::agent_session::timeline::StructuredTimelineHistory,
    reset_required: bool,
) -> ReadAgentTimelineResult {
    let window_end_offset = history
        .items
        .iter()
        .filter_map(|entry| entry.log_offset)
        .max();
    ReadAgentTimelineResult {
        items: history.items,
        effort: history.effort,
        model: history.model,
        window_end_offset,
        reset_required,
        pending_permissions: history.pending_permissions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::agent_session::{
        AgentSessionAttention, AgentSessionStatus, WorkspaceMode, WorktreeOwner,
    };
    use crate::types::agent_session_stream::{
        AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem, SubagentRosterStatus,
    };
    use std::fs;

    fn sample_session(display_mode: &str, log_path: &str) -> AgentSessionRecord {
        AgentSessionRecord {
            id: 7,
            number: 0,
            project_id: 1,
            issue_id: None,
            title: Some("test".to_string()),
            agent_profile_id: 0,
            workflow_skill_name: None,
            provider_session_id: None,
            status: AgentSessionStatus::Stopped,
            attention: AgentSessionAttention::None,
            working_dir: "/tmp/redwhisk".to_string(),
            command_snapshot: String::new(),
            prompt_snapshot: String::new(),
            display_mode: display_mode.to_string(),
            workspace_mode: WorkspaceMode::CurrentBranch,
            target_branch: None,
            workspace_branch: None,
            workspace_path: None,
            origin_branch: None,
            worktree_owner: WorktreeOwner::External,
            worktree_root_path: None,
            worktree_setup_command: None,
            log_path: log_path.to_string(),
            runtime_log_path: None,
            latest_output: None,
            last_active_at: 1,
            started_at: 1,
            closed_at: Some(2),
        }
    }

    #[test]
    fn tui_snapshot_does_not_parse_terminal_log_as_timeline() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("tui.log");
        fs::write(&log, b"\x1b[32mhello\x1b[0m\nnot-json\n").unwrap();
        let session = sample_session("tui", log.to_string_lossy().as_ref());
        let result = read_timeline_for_session(&session, None, None).unwrap();
        assert!(result.items.is_empty());
        assert!(result.effort.is_none());
        assert!(result.model.is_none());
    }

    #[test]
    fn json_snapshot_reads_structured_log() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("structured.jsonl");
        let event = AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 7,
            seq: 1,
            epoch: "epoch-test".to_string(),
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::AssistantMessage {
                    text: ("本地历史".to_string()).into(),
                    message_id: Some("msg-local".to_string()),
                    subagent_id: None,
                },
                turn_id: None,
                seq: 0,
                timestamp: 1,
            },
            log_offset: None,
        };
        fs::write(
            &log,
            format!(
                "{}\n",
                serde_json::to_string(&event).expect("serialize event")
            ),
        )
        .expect("write structured log");

        let session = sample_session("json", log.to_string_lossy().as_ref());
        let result = read_timeline_for_session(&session, None, None).unwrap();
        assert_eq!(
            result
                .items
                .into_iter()
                .map(|entry| entry.item)
                .collect::<Vec<_>>(),
            vec![AgentTimelineItem::AssistantMessage {
                text: ("本地历史".to_string()).into(),
                message_id: Some("msg-local".to_string()),
                subagent_id: None,
            }]
        );
        assert!(result.effort.is_none());
        assert!(result.model.is_none());
    }

    #[test]
    fn json_snapshot_reads_session_model_from_log() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("structured.jsonl");
        let events = [
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 1,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::ModelChanged {
                    model_id: "gpt-5.2".to_string(),
                },
                log_offset: None,
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 2,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::ModelChanged {
                    model_id: "gpt-5.5".to_string(),
                },
                log_offset: None,
            },
        ];
        let lines = events
            .iter()
            .map(|event| serde_json::to_string(event).expect("serialize event"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&log, format!("{lines}\n")).expect("write structured log");

        let session = sample_session("json", log.to_string_lossy().as_ref());
        let result = read_timeline_for_session(&session, None, None).unwrap();
        assert!(result.items.is_empty());
        assert_eq!(result.model.as_deref(), Some("gpt-5.5"));
    }

    #[test]
    fn invalid_display_mode_is_validation_error() {
        let session = sample_session("pty", "");
        let err = read_timeline_for_session(&session, None, None).unwrap_err();
        assert_eq!(err.reason.as_deref(), Some("invalidDisplayMode"));
    }

    #[test]
    fn json_snapshot_drops_roster_entry_for_the_session_thread() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("structured.jsonl");
        let events = [
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 1,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::SubagentRoster {
                        subagent_id: "thr_parent".to_string(),
                        status: crate::types::agent_session_stream::SubagentRosterStatus::Running,
                    },
                    turn_id: None,
                    seq: 0,
                    timestamp: 1,
                },
                log_offset: None,
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 2,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::SubagentRoster {
                        subagent_id: "thr_child".to_string(),
                        status: crate::types::agent_session_stream::SubagentRosterStatus::Ended,
                    },
                    turn_id: None,
                    seq: 0,
                    timestamp: 2,
                },
                log_offset: None,
            },
        ];
        let lines = events
            .iter()
            .map(|event| serde_json::to_string(event).expect("serialize event"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&log, format!("{lines}\n")).expect("write structured log");

        let mut session = sample_session("json", log.to_string_lossy().as_ref());
        session.provider_session_id = Some("thr_parent".to_string());
        let result = read_timeline_for_session(&session, None, None).unwrap();
        assert_eq!(
            result
                .items
                .into_iter()
                .map(|entry| entry.item)
                .collect::<Vec<_>>(),
            vec![AgentTimelineItem::SubagentRoster {
                subagent_id: "thr_child".to_string(),
                status: crate::types::agent_session_stream::SubagentRosterStatus::Ended,
            }]
        );
    }

    #[test]
    fn stopped_json_session_reopen_ends_subagent_left_running_when_the_app_died() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("structured.jsonl");
        let events = [
            roster_envelope("thr_done", SubagentRosterStatus::Running, 1),
            roster_envelope("thr_done", SubagentRosterStatus::Ended, 2),
            roster_envelope("thr_live", SubagentRosterStatus::Running, 3),
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 7,
                seq: 4,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::TurnCanceled {
                    turn_id: None,
                    reason: "no_interruptible_turn".to_string(),
                },
                log_offset: None,
            },
        ];
        let lines = events
            .iter()
            .map(|event| serde_json::to_string(event).expect("serialize event"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&log, format!("{lines}\n")).expect("write structured log");

        let mut session = sample_session("json", log.to_string_lossy().as_ref());
        session.status = AgentSessionStatus::Stopped;
        session.provider_session_id = Some("thr_parent".to_string());
        let result = read_timeline_for_session(&session, None, None).unwrap();
        let live = result
            .items
            .iter()
            .rev()
            .find_map(|entry| match &entry.item {
                AgentTimelineItem::SubagentRoster {
                    subagent_id,
                    status,
                } if subagent_id == "thr_live" => Some(*status),
                _ => None,
            });
        assert_eq!(live, Some(SubagentRosterStatus::Ended));
        let persisted = fs::read_to_string(&log).expect("read log");
        let ended_live = persisted
            .lines()
            .filter(|line| {
                line.contains("\"subagentId\":\"thr_live\"")
                    && line.contains("\"status\":\"ended\"")
            })
            .count();
        assert_eq!(ended_live, 1, "重启收口应把仍在跑的子智能体写回日志");
    }

    #[test]
    fn running_json_session_keeps_live_subagent_roster() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("structured.jsonl");
        let events = [roster_envelope(
            "thr_live",
            SubagentRosterStatus::Running,
            1,
        )];
        let lines = events
            .iter()
            .map(|event| serde_json::to_string(event).expect("serialize event"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&log, format!("{lines}\n")).expect("write structured log");

        let mut session = sample_session("json", log.to_string_lossy().as_ref());
        session.status = AgentSessionStatus::Running;
        let before = fs::read_to_string(&log).expect("read log");
        let result = read_timeline_for_session(&session, None, None).unwrap();
        let live = result.items.iter().find_map(|entry| match &entry.item {
            AgentTimelineItem::SubagentRoster {
                subagent_id,
                status,
            } if subagent_id == "thr_live" => Some(*status),
            _ => None,
        });
        assert_eq!(live, Some(SubagentRosterStatus::Running));
        assert_eq!(fs::read_to_string(&log).expect("read log"), before);
    }

    fn roster_envelope(
        subagent_id: &str,
        status: SubagentRosterStatus,
        seq: u64,
    ) -> AgentStreamEventEnvelope {
        AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 7,
            seq,
            epoch: "epoch-test".to_string(),
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::SubagentRoster {
                    subagent_id: subagent_id.to_string(),
                    status,
                },
                turn_id: None,
                seq: 0,
                timestamp: seq as i64,
            },
            log_offset: None,
        }
    }
}
