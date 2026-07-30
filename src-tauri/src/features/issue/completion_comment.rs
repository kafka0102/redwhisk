//! Issue 交付摘要（eligible turn → 自动 Issue 评论）深 module。
//!
//! 发表规则：
//! 1. 任意成功 turn 若可提取 `<issue-comment>` 标签，一律发表（标签=显式交付意图，不限 turn_source）。
//! 2. 无标签时：仅 `initial` | `completion` 走 Multica 式兜底整理；`follow_up` 不发表，避免追问污染时间轴。
//! Broadcaster 在 TurnCompleted 时快照 `turn_source` + `turn_id` 注入本入口，避免事后读库竞态。

use rusqlite::Connection;
use tauri::{AppHandle, Emitter};

use crate::db::agent_profile_repository::AgentProfileRepository;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::connection::DatabaseConfig;
use crate::db::issue_comment_repository::IssueCommentRepository;
use crate::db::issue_repository::IssueRepository;
use crate::db::project_repository::ProjectRepository;
use crate::local_data_path::redwhisk_data_dir;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue_action::IssueActionActor;

use super::service::IssueService;
use super::validation::issue_database_error;

/// Issue 时间轴有新条目（如 Agent 自动发表评论）时广播，前端按 issueId 刷新对应时间轴。
pub const ISSUE_TIMELINE_CHANGED_EVENT: &str = "issue-timeline-changed";

const FALLBACK_BODY_MAX_CHARS: usize = 800;
const FIXED_COMPLETION_COMMENT: &str = "Agent 已完成本轮任务。";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct IssueTimelineChangedPayload {
    issue_id: Option<i64>,
    session_id: i64,
}

/// Broadcaster 注入的 TurnCompleted 反应入口：独立开库、提取交付摘要并发表评论。
///
/// `turn_source` / `turn_id` 为 TurnCompleted 时刻快照，不以事后库字段判定 eligible。
/// 失败仅打印日志，不影响 session 运行与既有的提交检测。
pub fn handle_turn_completed(
    app_handle: &AppHandle,
    session_id: i64,
    turn_source: String,
    turn_id: String,
) {
    let Ok(data_dir) = redwhisk_data_dir(app_handle) else {
        return;
    };
    let Ok(database) = DatabaseConfig::new(&data_dir).open() else {
        return;
    };
    let issue_service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    match try_publish_completion_comment(&issue_service, session_id, &turn_source, &turn_id) {
        Ok(true) => {
            let issue_id = AgentSessionRepository::new(&database.connection)
                .find_active_issue_id_by_session_id(session_id)
                .ok()
                .flatten();
            let _ = app_handle.emit(
                ISSUE_TIMELINE_CHANGED_EVENT,
                IssueTimelineChangedPayload {
                    issue_id,
                    session_id,
                },
            );
        }
        Ok(false) => {}
        Err(error) => {
            eprintln!(
                "[completion-comment-extraction] session {session_id} turn {turn_id} source {turn_source} failed: {error:?}"
            );
        }
    }
}

/// turn 完成后尝试自动发表 Issue 评论（端到端编排）。
///
/// 步骤：
/// 1. 找到 session 关联的未删除 Issue（无关联返回 `Ok(false)`）。
/// 2. 取 Agent 配置名快照（查不到用空串兜底，仍归属 Agent）。
/// 3. 读取该 turn 全部助手消息：从后往前提取 `<issue-comment>`。
/// 4. 有标签 → 发表（任意 turn_source）；无标签 → 仅 `initial` | `completion` 走 Multica 兜底。
/// 5. 调用 `add_issue_comment` 写入（UNIQUE 保证幂等）；返回是否真正发表了评论。
pub(crate) fn try_publish_completion_comment(
    service: &IssueService<'_>,
    session_id: i64,
    turn_source: &str,
    turn_id: &str,
) -> Result<bool, CommandError> {
    let connection = service.issue_repository.connection();
    try_publish_completion_comment_with_connection(
        service,
        connection,
        session_id,
        turn_source,
        turn_id,
    )
}

fn try_publish_completion_comment_with_connection(
    service: &IssueService<'_>,
    connection: &Connection,
    session_id: i64,
    turn_source: &str,
    turn_id: &str,
) -> Result<bool, CommandError> {
    let session_repository = AgentSessionRepository::new(connection);
    let session = session_repository
        .find_by_id(session_id)
        .map_err(issue_database_error)?
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::IssuePersistenceFailed,
                "Agent Session 不存在或已删除。",
            )
            .with_reason("agentSessionNotFound")
            .with_detail(ErrorDetail::new("AgentSession").with_value("sessionId", session_id))
        })?;

    let Some(issue_id) = session_repository
        .find_active_issue_id_by_session_id(session_id)
        .map_err(issue_database_error)?
    else {
        return Ok(false);
    };

    let name_snapshot = AgentProfileRepository::new(connection)
        .find_profile_by_id(session.agent_profile_id)
        .map_err(issue_database_error)?
        .map(|profile| profile.name)
        .unwrap_or_default();

    let assistant_texts = crate::features::agent_session::read_assistant_texts_for_turn(
        &session.log_path,
        turn_id,
    );

    // 标签=显式交付意图：任意 turn_source 均可发表。
    // 无标签时仅 initial/completion 走 Multica 兜底，follow_up 跳过以免追问刷屏。
    let body = match extract_tagged_comment_body(&assistant_texts) {
        Some(tagged) => tagged,
        None if is_eligible_turn_source(turn_source) => {
            resolve_completion_comment_body(&assistant_texts)
        }
        None => return Ok(false),
    };

    let already_exists = IssueCommentRepository::new(connection)
        .exists_by_session_and_turn(session_id, turn_id)
        .map_err(issue_database_error)?;
    if already_exists {
        return Ok(false);
    }

    service.add_issue_comment(
        issue_id,
        &body,
        IssueActionActor::Agent {
            profile_id: session.agent_profile_id,
            name_snapshot,
        },
        Some(session_id),
        Some(turn_id),
    )?;
    Ok(true)
}

/// 从后往前扫描助手消息，取首个可提取的 `<issue-comment>` 正文。
pub(crate) fn extract_tagged_comment_body(assistant_texts: &[String]) -> Option<String> {
    for text in assistant_texts.iter().rev() {
        if let Some(body) = extract_issue_comment_from_assistant_text(text) {
            return Some(body);
        }
    }
    None
}

pub(crate) fn is_eligible_turn_source(source: &str) -> bool {
    matches!(source, "initial" | "completion")
}

/// 标签优先（从后往前）+ Multica 兜底（去 fence / 800 字 / trivial → 固定句）。
/// 仅用于 eligible 源的无标签路径；有标签时应走 `extract_tagged_comment_body`。
pub(crate) fn resolve_completion_comment_body(assistant_texts: &[String]) -> String {
    if let Some(body) = extract_tagged_comment_body(assistant_texts) {
        return body;
    }

    let last_non_empty = assistant_texts
        .iter()
        .rev()
        .map(|text| text.as_str())
        .find(|text| !text.trim().is_empty());

    match last_non_empty {
        Some(text) => normalize_fallback_assistant_text(text),
        None => FIXED_COMPLETION_COMMENT.to_string(),
    }
}

fn normalize_fallback_assistant_text(text: &str) -> String {
    let stripped = strip_fenced_code_blocks(text);
    let trimmed = stripped.trim();
    if trimmed.is_empty() || is_trivial_comment_body(trimmed) {
        return FIXED_COMPLETION_COMMENT.to_string();
    }
    truncate_comment_body(trimmed)
}

fn truncate_comment_body(body: &str) -> String {
    let count = body.chars().count();
    if count <= FALLBACK_BODY_MAX_CHARS {
        return body.to_string();
    }
    format!(
        "{}…",
        body.chars().take(FALLBACK_BODY_MAX_CHARS).collect::<String>()
    )
}

/// 去掉 fenced code block（``` / ~~~）内容与 fence 行，保留块外文本。
pub(crate) fn strip_fenced_code_blocks(text: &str) -> String {
    let mut out = String::new();
    let mut in_fence = false;
    let mut fence_marker = "";
    for line in text.lines() {
        let trimmed = line.trim_start();
        if let Some(_rest) = trimmed
            .strip_prefix("```")
            .or_else(|| trimmed.strip_prefix("~~~"))
        {
            let marker = &trimmed[..3.min(trimmed.len())];
            if !in_fence {
                in_fence = true;
                fence_marker = marker;
            } else if marker == fence_marker {
                in_fence = false;
                fence_marker = "";
            }
            continue;
        }
        if in_fence {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(line);
    }
    out
}

/// trivial / 空 → 走固定句。大小写与常见中英文标点不敏感。
pub(crate) fn is_trivial_comment_body(body: &str) -> bool {
    let stripped: String = body
        .chars()
        .filter(|ch| {
            !ch.is_ascii_punctuation()
                && !matches!(
                    *ch,
                    '。' | '！' | '？' | '，' | '、' | '…' | '；' | '：' | '“' | '”' | '‘' | '’'
                        | '（' | '）' | '【' | '】'
                )
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("")
        .to_lowercase();

    matches!(
        stripped.as_str(),
        "" | "完成"
            | "完成了"
            | "已完成"
            | "done"
            | "finished"
            | "ok"
            | "okay"
            | "好的"
            | "好"
            | "嗯"
            | "yes"
            | "yep"
            | "是的"
            | "收到"
    )
}

/// 从 Agent 助手答复正文提取首个 `<issue-comment>` 标签内容；无匹配返回 None。
///
/// 不做容错：标签出现在 fenced code block（``` / ~~~）内或被反斜杠转义时不识别，
/// 缺闭合标签不识别，空内容不识别。
pub(crate) fn extract_issue_comment_from_assistant_text(text: &str) -> Option<String> {
    const START_TAG: &str = "<issue-comment>";
    const END_TAG: &str = "</issue-comment>";

    let bytes = text.as_bytes();
    let mut cursor = 0usize;

    loop {
        let rel = text[cursor..].find(START_TAG)?;
        let start_idx = cursor + rel;

        if is_inside_code_fence(&text[..start_idx]) {
            cursor = start_idx + START_TAG.len();
            continue;
        }
        if start_idx > 0 && bytes[start_idx - 1] == b'\\' {
            cursor = start_idx + START_TAG.len();
            continue;
        }

        let after_start = start_idx + START_TAG.len();
        let end_rel = text[after_start..].find(END_TAG)?;
        let content = &text[after_start..after_start + end_rel];
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return None;
        }
        return Some(trimmed.to_string());
    }
}

/// 统计 `prefix` 文本中 fenced code block（``` / ~~~）的嵌套状态：返回 true 表示
/// 当前位置（紧接 prefix 之后）落在未闭合的代码块内。
fn is_inside_code_fence(prefix: &str) -> bool {
    let mut in_fence = false;
    let mut fence_marker: &str = "";
    for line in prefix.lines() {
        let trimmed = line.trim_start();
        if let Some(_rest) = trimmed
            .strip_prefix("```")
            .or_else(|| trimmed.strip_prefix("~~~"))
        {
            let marker = &trimmed[..3.min(trimmed.len())];
            if !in_fence {
                in_fence = true;
                fence_marker = marker;
            } else if marker == fence_marker {
                in_fence = false;
                fence_marker = "";
            }
        }
    }
    in_fence
}

#[cfg(test)]
#[path = "completion_comment_test.rs"]
mod tests;
