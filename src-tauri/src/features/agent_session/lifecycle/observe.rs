//! 按 Session 展示形式快照观察 timeline（json=structured；tui 不猜终端 log 格式）。

use std::sync::Arc;

use crate::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use crate::features::agent_session::lifecycle::display_mode::{
    runtime_transport_from_raw, RuntimeTransport,
};
use crate::features::agent_session::service::agent_session_error_to_command_error;
use crate::features::agent_session::timeline::{
    is_empty_standalone_thread_timeline_error, latest_effort_from_session_log,
    read_timeline_from_log_path,
};
use crate::types::agent_session::{AgentSessionRecord, ReadAgentTimelineResult};
use crate::types::errors::CommandError;

pub(crate) fn read_timeline_for_session(
    session: &AgentSessionRecord,
    handle: Option<Arc<dyn AgentSessionHandle>>,
) -> Result<ReadAgentTimelineResult, CommandError> {
    match runtime_transport_from_raw(&session.display_mode)? {
        RuntimeTransport::InteractiveTui => Ok(ReadAgentTimelineResult {
            items: Vec::new(),
            effort: None,
        }),
        RuntimeTransport::StructuredJson => read_json_timeline(session, handle),
    }
}

fn read_json_timeline(
    session: &AgentSessionRecord,
    handle: Option<Arc<dyn AgentSessionHandle>>,
) -> Result<ReadAgentTimelineResult, CommandError> {
    let history = read_timeline_from_log_path(&session.log_path)?;
    if !history.items.is_empty() || history.effort.is_some() {
        return Ok(ReadAgentTimelineResult {
            items: history.items,
            effort: history.effort,
        });
    }

    if let Some(handle) = handle {
        match handle.read_timeline() {
            Ok(items) => {
                return Ok(ReadAgentTimelineResult {
                    items,
                    effort: latest_effort_from_session_log(session),
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
                });
            }
            Err(error) => return Err(agent_session_error_to_command_error(error)),
        }
    }

    Ok(ReadAgentTimelineResult {
        items: history.items,
        effort: history.effort,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::agent_session::{
        AgentSessionAttention, AgentSessionStatus, WorkspaceMode, WorktreeOwner,
    };
    use crate::types::agent_session_stream::{
        AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem,
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
            codex_session_id: None,
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
        let result = read_timeline_for_session(&session, None).unwrap();
        assert!(result.items.is_empty());
        assert!(result.effort.is_none());
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
                    text: "本地历史".to_string(),
                    message_id: Some("msg-local".to_string()),
                },
                turn_id: None,
                seq: 0,
                timestamp: 1,
            },
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
        let result = read_timeline_for_session(&session, None).unwrap();
        assert_eq!(
            result.items,
            vec![AgentTimelineItem::AssistantMessage {
                text: "本地历史".to_string(),
                message_id: Some("msg-local".to_string()),
            }]
        );
        assert!(result.effort.is_none());
    }

    #[test]
    fn invalid_display_mode_is_validation_error() {
        let session = sample_session("pty", "");
        let err = read_timeline_for_session(&session, None).unwrap_err();
        assert_eq!(err.reason.as_deref(), Some("invalidDisplayMode"));
    }
}
