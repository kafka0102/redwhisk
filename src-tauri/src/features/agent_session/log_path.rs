use std::fs;
use std::path::Path;
use std::path::PathBuf;

use crate::agent::pty_session_manager::read_terminal_snapshot;
use crate::types::agent_session_stream::{AgentStreamEvent, AgentStreamEventEnvelope};
use crate::types::errors::CommandError;

use super::codex_tui_archive::{codex_session_archive_text, TuiSessionLogSource};
use super::grok_tui_archive::grok_session_archive_text;
use super::service::{agent_session_start_error, strip_terminal_control_sequences};
use super::session_log_archive::read_json_archive_items;
use super::terminal_archive_clean::{
    extract_tui_archive_conclusion_text, latest_output_from_archive_text,
};
use super::terminal_archive_render::render_terminal_snapshot_text;
use super::timeline::latest_output_from_timeline_item;

const TUI_ARCHIVE_SNAPSHOT_MAX_BYTES: usize = 262_144;

const SESSION_LOG_DIR_NAME: &str = "session-logs";
const SESSION_RUNTIME_LOG_DIR_NAME: &str = "runtime";
const SESSION_ARCHIVE_LOG_DIR_NAME: &str = "archive";

pub(crate) struct IssueSessionArchive {
    pub archive_path: String,
    pub runtime_path: String,
    pub latest_output: Option<String>,
}

pub(crate) fn build_log_path(
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
    source: TuiSessionLogSource<'_>,
) -> Result<IssueSessionArchive, CommandError> {
    if display_mode == "tui" {
        return build_tui_issue_session_archive(
            data_dir,
            project_id,
            issue_number,
            session_number,
            runtime_log_path,
            source,
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
    source: TuiSessionLogSource<'_>,
) -> Result<IssueSessionArchive, CommandError> {
    let archive_path =
        build_issue_archive_log_path(data_dir, project_id, issue_number, session_number)?;
    // Codex 优先 session log；Grok 优先本机会话存储。都解析不到再回退终端提取。
    let body =
        match codex_session_archive_text(source).or_else(|| grok_session_archive_text(source)) {
            Some(text) => text,
            None => {
                let snapshot = read_terminal_snapshot_for_archive(runtime_log_path)?;
                extract_tui_archive_text_from_snapshot(&snapshot)
            }
        };
    let file_content = if body.is_empty() {
        String::new()
    } else {
        format!("{body}\n")
    };
    fs::write(&archive_path, file_content).map_err(agent_session_start_error)?;

    Ok(IssueSessionArchive {
        archive_path,
        runtime_path: runtime_log_path.to_string(),
        latest_output: latest_output_from_archive_text(&body),
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
    let items = read_json_archive_items(runtime_log_path)?;
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
                log_offset: None,
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
#[path = "log_path_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "log_path_subagent_archive_tests.rs"]
mod subagent_archive_tests;

#[cfg(test)]
#[path = "session_log_archive_tests.rs"]
mod archive_tests;

#[cfg(test)]
#[path = "log_path_grok_archive_tests.rs"]
mod grok_archive_tests;
