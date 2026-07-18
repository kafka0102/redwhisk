use std::fs;
use std::path::Path;
use std::path::PathBuf;

use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope,
};
use crate::types::errors::CommandError;




use super::timeline::{latest_output_from_timeline_item, read_timeline_from_log_path, should_archive_timeline_item};
use super::service::agent_session_start_error;

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


pub(super) fn build_standalone_runtime_structured_log_path(
    data_dir: &Path,
    project_id: i64,
    session_number: i64,
) -> Result<String, CommandError> {
    let logs_dir = runtime_session_log_project_dir(data_dir, project_id)?;
    let path = logs_dir.join(format!(
        "project-{project_id}-standalone-session-{session_number}.jsonl"
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
