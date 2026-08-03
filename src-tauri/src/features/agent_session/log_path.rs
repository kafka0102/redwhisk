use std::fs;
use std::path::Path;
use std::path::PathBuf;

use crate::agent::pty_session_manager::read_terminal_snapshot;
use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope,
};
use crate::types::errors::CommandError;

use super::service::{agent_session_start_error, strip_terminal_control_sequences};
use super::terminal_archive_clean::{
    extract_tui_archive_conclusion_text, latest_output_from_archive_text,
};
use super::terminal_archive_render::render_terminal_snapshot_text;
use super::timeline::{
    latest_output_from_timeline_item, read_timeline_from_log_path, should_archive_timeline_item,
};

const TUI_ARCHIVE_SNAPSHOT_MAX_BYTES: usize = 262_144;

const SESSION_LOG_DIR_NAME: &str = "session-logs";
const SESSION_RUNTIME_LOG_DIR_NAME: &str = "runtime";
const SESSION_ARCHIVE_LOG_DIR_NAME: &str = "archive";

pub(crate) struct IssueSessionArchive {
    pub archive_path: String,
    pub runtime_path: String,
    pub latest_output: Option<String>,
}


pub(super) fn build_log_path(
    data_dir: &Path,
    project_id: i64,
    session_name: &str,
    agent_profile_id: i64,
    started_at: i64,
) -> Result<String, CommandError> {
    let logs_dir = runtime_session_log_project_dir(data_dir, project_id)?;

    let path = logs_dir.join(format!(
        "{session_name}-profile-{agent_profile_id}-{started_at}.log"
    ));
    Ok(path.to_string_lossy().to_string())
}


fn session_log_root_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(SESSION_LOG_DIR_NAME)
}


fn runtime_session_log_project_dir(
    data_dir: &Path,
    project_id: i64,
) -> Result<PathBuf, CommandError> {
    let logs_dir = session_log_root_dir(data_dir)
        .join(SESSION_RUNTIME_LOG_DIR_NAME)
        .join(format!("project-{project_id}"));
    fs::create_dir_all(&logs_dir).map_err(agent_session_start_error)?;
    Ok(logs_dir)
}


fn archive_session_log_project_dir(
    data_dir: &Path,
    project_id: i64,
) -> Result<PathBuf, CommandError> {
    let logs_dir = session_log_root_dir(data_dir)
        .join(SESSION_ARCHIVE_LOG_DIR_NAME)
        .join(format!("project-{project_id}"));
    fs::create_dir_all(&logs_dir).map_err(agent_session_start_error)?;
    Ok(logs_dir)
}


pub(super) fn build_pending_structured_log_path(
    data_dir: &Path,
    project_id: i64,
    started_at: i64,
) -> Result<String, CommandError> {
    let logs_dir = runtime_session_log_project_dir(data_dir, project_id)?;
    let path = logs_dir.join(format!("pending-session-{started_at}.jsonl"));
    Ok(path.to_string_lossy().to_string())
}


pub(super) fn build_issue_runtime_structured_log_path(
    data_dir: &Path,
    project_id: i64,
    issue_number: i64,
    session_number: i64,
) -> Result<String, CommandError> {
    let logs_dir = runtime_session_log_project_dir(data_dir, project_id)?;
    let path = logs_dir.join(format!(
        "project-{project_id}-issue-{issue_number}-session-{session_number}.jsonl"
    ));
    Ok(path.to_string_lossy().to_string())
}




pub(crate) fn build_issue_archive_log_path(
    data_dir: &Path,
    project_id: i64,
    issue_number: i64,
    session_number: i64,
) -> Result<String, CommandError> {
    let logs_dir = archive_session_log_project_dir(data_dir, project_id)?;
    let path = logs_dir.join(format!(
        "archive-project-{project_id}-issue-{issue_number}-session-{session_number}.log"
    ));
    Ok(path.to_string_lossy().to_string())
}


pub(crate) fn is_archived_issue_log_path(data_dir: &Path, log_path: &str) -> bool {
    let archive_root = session_log_root_dir(data_dir).join(SESSION_ARCHIVE_LOG_DIR_NAME);
    Path::new(log_path).starts_with(&archive_root)
}


pub(crate) fn build_issue_session_archive(
    data_dir: &Path,
    project_id: i64,
    issue_number: i64,
    session_number: i64,
    session_id: i64,
    runtime_log_path: &str,
    display_mode: &str,
) -> Result<IssueSessionArchive, CommandError> {
    if display_mode == "tui" {
        return build_tui_issue_session_archive(
            data_dir,
            project_id,
            issue_number,
            session_number,
            runtime_log_path,
        );
    }

    build_json_issue_session_archive(
        data_dir,
        project_id,
        issue_number,
        session_number,
        session_id,
        runtime_log_path,
    )
}

fn build_tui_issue_session_archive(
    data_dir: &Path,
    project_id: i64,
    issue_number: i64,
    session_number: i64,
    runtime_log_path: &str,
) -> Result<IssueSessionArchive, CommandError> {
    let archive_path =
        build_issue_archive_log_path(data_dir, project_id, issue_number, session_number)?;
    let snapshot = read_terminal_snapshot_for_archive(runtime_log_path)?;
    let cleaned = extract_tui_archive_text_from_snapshot(&snapshot);
    let file_content = if cleaned.is_empty() {
        String::new()
    } else {
        format!("{cleaned}\n")
    };
    fs::write(&archive_path, file_content).map_err(agent_session_start_error)?;

    Ok(IssueSessionArchive {
        archive_path,
        runtime_path: runtime_log_path.to_string(),
        latest_output: latest_output_from_archive_text(&cleaned),
    })
}

/// TUI 归档正文提取：
/// 1) 先对剥壳文本做结论向提取（Codex/Claude 行式输出）
/// 2) 若为空或明显是全屏粘连噪声，再做 VT 屏缓冲回放后重提
fn extract_tui_archive_text_from_snapshot(snapshot: &str) -> String {
    if snapshot.is_empty() {
        return String::new();
    }
    let stripped = strip_terminal_control_sequences(snapshot).replace('\r', "\n");
    let primary = extract_tui_archive_conclusion_text(&stripped);
    if archive_text_looks_usable(&primary) {
        return primary;
    }
    let rendered = render_terminal_snapshot_text(snapshot);
    let secondary = extract_tui_archive_conclusion_text(&rendered);
    if archive_text_looks_usable(&secondary) {
        return secondary;
    }
    // 仍无结构化结论时，优先回放文本的轻清理结果，避免空归档 / 整包粘连噪声。
    if !rendered.trim().is_empty() {
        return extract_tui_archive_conclusion_text(&rendered);
    }
    primary
}

fn archive_text_looks_usable(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    // 单行超长且无换行：全屏 TUI 剥壳粘连，不可用
    if !trimmed.contains('\n') && trimmed.chars().count() > 400 {
        return false;
    }
    // 大量 box-drawing / spinner 粘连也视为不可用
    let noise = trimmed
        .chars()
        .filter(|c| matches!(*c, '┃' | '◆' | '│' | '─' | '\u{2800}'..='\u{28ff}'))
        .count();
    if noise > 40 && noise * 3 > trimmed.chars().count() {
        return false;
    }
    true
}

fn build_json_issue_session_archive(
    data_dir: &Path,
    project_id: i64,
    issue_number: i64,
    session_number: i64,
    session_id: i64,
    runtime_log_path: &str,
) -> Result<IssueSessionArchive, CommandError> {
    let history = read_timeline_from_log_path(runtime_log_path)?;
    let items = history
        .items
        .into_iter()
        .filter(should_archive_timeline_item)
        .collect::<Vec<_>>();
    let archive_path =
        build_issue_archive_log_path(data_dir, project_id, issue_number, session_number)?;
    let payload = items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            serde_json::to_string(&AgentStreamEventEnvelope {
                project_id,
                session_id,
                seq: (index + 1) as u64,
                epoch: "archive".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: item.clone(),
                    turn_id: None,
                    seq: (index + 1) as u64,
                    timestamp: 0,
                },
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| agent_session_start_error(std::io::Error::other(error.to_string())))?
        .join("\n");
    let file_content = if payload.is_empty() {
        String::new()
    } else {
        format!("{payload}\n")
    };
    fs::write(&archive_path, file_content).map_err(agent_session_start_error)?;

    Ok(IssueSessionArchive {
        archive_path,
        runtime_path: runtime_log_path.to_string(),
        latest_output: items
            .iter()
            .rev()
            .find_map(latest_output_from_timeline_item),
    })
}

fn read_terminal_snapshot_for_archive(runtime_log_path: &str) -> Result<String, CommandError> {
    if runtime_log_path.trim().is_empty() {
        return Ok(String::new());
    }
    let path = Path::new(runtime_log_path);
    match read_terminal_snapshot(path, TUI_ARCHIVE_SNAPSHOT_MAX_BYTES) {
        Ok(snapshot) => Ok(snapshot),
        Err(error) if error.contains("No such file") || error.contains("not found") => {
            Ok(String::new())
        }
        Err(error) => Err(agent_session_start_error(error)),
    }
}


/// 删除 session 日志文件（运行态结构化日志或 issue 归档日志）。
/// 路径为空或文件不存在时静默跳过；删除失败不向上抛错，避免阻塞 session 软删流程。
pub(crate) fn remove_session_log_file(log_path: Option<&str>) {
    let Some(log_path) = log_path else {
        return;
    };
    let path = Path::new(log_path);
    if !path.exists() {
        return;
    }
    let _ = fs::remove_file(path);
}


#[cfg(test)]
mod tests {
    use super::build_issue_session_archive;
    use crate::types::agent_session_stream::{
        AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem, ToolCallDetail,
        ToolCallStatus,
    };
    use std::fs;

    #[test]
    fn build_issue_session_archive_writes_plain_text_for_tui() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let runtime_log_path = temp_dir.path().join("runtime-tui.log");
        let runtime = "$ ls\r\nfile.txt\r\n\r\n\u{280b} Working(on it...)\r\n\u{2819}\r\n\r\nDone with archive.\r\n";
        fs::write(&runtime_log_path, runtime).expect("write runtime log");

        let archive = build_issue_session_archive(
            temp_dir.path(),
            2,
            14,
            23,
            99,
            runtime_log_path.to_string_lossy().as_ref(),
            "tui",
        )
        .expect("build tui archive");

        let content = fs::read_to_string(&archive.archive_path).expect("read archive");
        assert!(
            !content.trim_start().starts_with('{'),
            "tui archive must be plain text, got: {content:?}"
        );
        assert!(!content.contains("projectId"), "must not wrap JSON envelope");
        assert!(!content.contains("assistant_message"));
        assert!(!content.contains("Working("));
        assert!(content.contains("$ ls"));
        assert!(content.contains("Done with archive."));
        assert_eq!(archive.latest_output.as_deref(), Some("Done with archive."));
        assert_eq!(
            archive.runtime_path,
            runtime_log_path.to_string_lossy().to_string()
        );
    }

    #[test]
    fn build_issue_session_archive_filters_out_tool_calls_and_reasoning_for_json() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let runtime_log_path = temp_dir.path().join("runtime.jsonl");
        let events = [
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 30,
                seq: 1,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::UserMessage {
                        text: "请总结".to_string(),
                        message_id: Some("u1".to_string()),
                    },
                    turn_id: None,
                    seq: 1,
                    timestamp: 1,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 30,
                seq: 2,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::Reasoning {
                        text: "分析中".to_string(),
                        duration_ms: Some(10),
                    },
                    turn_id: None,
                    seq: 2,
                    timestamp: 2,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 30,
                seq: 3,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::ToolCall {
                        call_id: "call-1".to_string(),
                        name: "shell".to_string(),
                        detail: ToolCallDetail::Unknown {
                            raw_input: Some("ls".to_string()),
                            raw_output: Some("file.txt".to_string()),
                        },
                        status: ToolCallStatus::Completed,
                        error: None,
                    },
                    turn_id: None,
                    seq: 3,
                    timestamp: 3,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 30,
                seq: 4,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::AssistantMessage {
                        text: "已完成归纳".to_string(),
                        message_id: Some("a1".to_string()),
                    },
                    turn_id: None,
                    seq: 4,
                    timestamp: 4,
                },
            },
            AgentStreamEventEnvelope {
                project_id: 1,
                session_id: 30,
                seq: 5,
                epoch: "epoch-test".to_string(),
                event: AgentStreamEvent::Timeline {
                    item: AgentTimelineItem::Error {
                        message: "收尾失败".to_string(),
                    },
                    turn_id: None,
                    seq: 5,
                    timestamp: 5,
                },
            },
        ];
        let lines = events
            .iter()
            .map(|event| serde_json::to_string(event).expect("serialize event"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&runtime_log_path, format!("{lines}\n")).expect("write runtime log");

        let archive = build_issue_session_archive(
            temp_dir.path(),
            1,
            16,
            7,
            30,
            runtime_log_path.to_string_lossy().as_ref(),
            "json",
        )
        .expect("build archive");

        assert_eq!(
            archive.runtime_path,
            runtime_log_path.to_string_lossy().to_string()
        );
        assert_eq!(archive.latest_output.as_deref(), Some("收尾失败"));

        let archived_lines = fs::read_to_string(&archive.archive_path).expect("read archive log");
        assert!(!archived_lines.contains("tool_call"));
        assert!(!archived_lines.contains("reasoning"));
        assert!(archived_lines.contains("user_message"));
        assert!(archived_lines.contains("assistant_message"));
        assert!(archived_lines.contains("error"));
    }
    #[test]
    fn build_tui_archive_uses_render_for_fullscreen_paint() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let runtime = temp_dir.path().join("runtime.log");
        // 全屏 CUP 重绘：简单剥壳无换行；回放后应得到分行正文
        let raw = "\u{1b}[1;1H\u{1b}[2J\u{1b}[1;1H❯ fix remote detect\u{1b}[2;1Hdone: added 60s fetch";
        std::fs::write(&runtime, raw).expect("write runtime");
        let archive = build_issue_session_archive(
            temp_dir.path(),
            1,
            212,
            259,
            374,
            runtime.to_string_lossy().as_ref(),
            "tui",
        )
        .expect("archive");
        let content = std::fs::read_to_string(&archive.archive_path).expect("read archive");
        assert!(
            content.contains("fix remote detect") || content.contains("done: added 60s fetch"),
            "archive should extract core text, got={content:?}"
        );
        assert!(!content.trim().is_empty(), "archive must not be empty");
    }
}
