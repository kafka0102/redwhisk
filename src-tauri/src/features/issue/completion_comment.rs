//! Issue 交付摘要（completion turn → `<issue-comment>` 自动评论）深 module。
//!
//! ADR-0003 触发语义不变：仅 `TurnCompleted` 且 turn 来源为 `completion` 时提取。
//! 本 module 拥有提取、幂等写入与时间轴刷新广播；`agent` 横切只发信号，不感知
//! issue schema / IssueService。

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

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct IssueTimelineChangedPayload {
    issue_id: Option<i64>,
    session_id: i64,
}

/// Broadcaster 注入的 TurnCompleted 反应入口：独立开库、提取交付摘要并发表评论。
///
/// 失败仅打印日志，不影响 session 运行与既有的提交检测。
pub fn handle_turn_completed(app_handle: &AppHandle, session_id: i64, turn_id: String) {
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
    match try_publish_completion_comment(&issue_service, session_id, &turn_id) {
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
                "[completion-comment-extraction] session {session_id} turn {turn_id} failed: {error:?}"
            );
        }
    }
}

/// completion turn 完成后尝试自动发表 Issue 评论（端到端编排）。
///
/// 步骤：
/// 1. 读取 session 的 `current_turn_source` 与 `current_turn_id`，校验 source 为
///    `completion` 且 turn_id 与入参一致（被新 turn 抢占则返回 `Ok(false)`）。
/// 2. 找到 session 关联的未删除 Issue（无关联返回 `Ok(false)`）。
/// 3. 取 Agent 配置名快照（查不到用空串兜底，仍归属 Agent）。
/// 4. 按 turn_id 从 session log 读取该 turn 最后一条助手答复，正则提取首个
///    `<issue-comment>` 标签内容（提取不到静默返回 `Ok(false)`）。
/// 5. 调用 `add_issue_comment` 写入（UNIQUE 保证幂等）；返回是否真正发表了评论。
///
/// 失败（DB 错误等）向上抛 `CommandError`，由调用方独立 catch，不影响 session 运行。
pub(crate) fn try_publish_completion_comment(
    service: &IssueService<'_>,
    session_id: i64,
    turn_id: &str,
) -> Result<bool, CommandError> {
    let connection = service.issue_repository.connection();
    try_publish_completion_comment_with_connection(service, connection, session_id, turn_id)
}

fn try_publish_completion_comment_with_connection(
    service: &IssueService<'_>,
    connection: &Connection,
    session_id: i64,
    turn_id: &str,
) -> Result<bool, CommandError> {
    let session_repository = AgentSessionRepository::new(connection);

    // current_turn_* 未映射进 AgentSessionRecord，经 repository 读取。
    let (current_turn_source, current_turn_id) = session_repository
        .find_current_turn(session_id)
        .map_err(issue_database_error)?;

    if current_turn_source.as_deref() != Some("completion") {
        return Ok(false);
    }
    if current_turn_id.as_deref() != Some(turn_id) {
        // 被新 turn 抢占。
        return Ok(false);
    }

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

    // Agent 名称快照：查不到用空串兜底。
    let name_snapshot = AgentProfileRepository::new(connection)
        .find_profile_by_id(session.agent_profile_id)
        .map_err(issue_database_error)?
        .map(|profile| profile.name)
        .unwrap_or_default();

    let Some(assistant_text) = crate::features::agent_session::read_last_assistant_text_for_turn(
        &session.log_path,
        turn_id,
    ) else {
        return Ok(false);
    };
    let Some(body) = extract_issue_comment_from_assistant_text(&assistant_text) else {
        return Ok(false);
    };

    // 幂等：命中 UNIQUE 时 add_issue_comment 静默忽略并整体不写动作；这里通过
    // 先查是否已存在评论来决定返回值（并发触发由 UNIQUE 兜底，最多多算一次）。
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

/// 从 Agent 助手答复正文提取首个 `<issue-comment>` 标签内容；无匹配返回 None。
///
/// 不做容错：标签出现在 fenced code block（``` / ~~~）内或被反斜杠转义时不识别，
/// 缺闭合标签不识别，空内容不识别。依赖 `build_agent_commit_completion_prompt`
/// 约束 Agent 把标签写在答复正文顶层。
pub(crate) fn extract_issue_comment_from_assistant_text(text: &str) -> Option<String> {
    const START_TAG: &str = "<issue-comment>";
    const END_TAG: &str = "</issue-comment>";

    let bytes = text.as_bytes();
    let mut cursor = 0usize;

    loop {
        let rel = text[cursor..].find(START_TAG)?;
        let start_idx = cursor + rel;

        // 跳过位于 fenced code block 内的标签：扫描标签前缀统计 fence 切换次数。
        if is_inside_code_fence(&text[..start_idx]) {
            cursor = start_idx + START_TAG.len();
            continue;
        }
        // 跳过被反斜杠转义的标签（`\<issue-comment>`）。
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
        if let Some(rest) = trimmed.strip_prefix("```").or_else(|| trimmed.strip_prefix("~~~")) {
            let _ = rest; // fence 后缀（语言标注或空）不影响切换
            let marker = &trimmed[..3];
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
mod tests {
    use super::{extract_issue_comment_from_assistant_text, try_publish_completion_comment};
    use crate::db::issue_repository::IssueRepository;
    use crate::db::migrations::MigrationRunner;
    use crate::db::project_repository::ProjectRepository;
    use crate::features::issue::service::IssueService;
    use crate::types::issue::{GetIssueTimelineInput, IssueTimelineActionType};
    use rusqlite::{params, Connection};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn extract_issue_comment_from_assistant_text_cases() {
        assert_eq!(
            extract_issue_comment_from_assistant_text(
                "提交完成 <issue-comment>交付了 X，验证通过</issue-comment>"
            ),
            Some("交付了 X，验证通过".to_string())
        );
        // 多个标签取首个
        assert_eq!(
            extract_issue_comment_from_assistant_text(
                "<issue-comment>first</issue-comment> 后续 <issue-comment>second</issue-comment>"
            ),
            Some("first".to_string())
        );
        assert_eq!(extract_issue_comment_from_assistant_text("无标签答复"), None);
        // 代码块内的标签不识别
        assert_eq!(
            extract_issue_comment_from_assistant_text(
                "```\n<issue-comment>in code block</issue-comment>\n```"
            ),
            None
        );
    }

    #[test]
    fn try_publish_completion_comment_publishes_only_for_matched_completion_turn() {
        let temp = tempdir().expect("temp dir");
        let log = temp.path().join("session.log");
        let line = |turn_id: &str, text: &str| -> String {
            format!(
                "{{\"projectId\":1,\"sessionId\":30,\"seq\":1,\"epoch\":\"e\",\"event\":{{\"type\":\"timeline\",\"item\":{{\"type\":\"assistant_message\",\"text\":\"{text}\"}},\"turnId\":\"{turn_id}\",\"seq\":1,\"timestamp\":1}}}}"
            )
        };
        fs::write(
            &log,
            line("t1", "done <issue-comment>交付摘要正文</issue-comment>"),
        )
        .expect("write log");

        let connection = Connection::open_in_memory().expect("open database");
        MigrationRunner::default()
            .run(&connection)
            .expect("run migrations");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'P', '', 1, 1)",
                [],
            )
            .expect("insert project");
        connection
            .execute(
                "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
                 VALUES (101, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1, '', '', 0)",
                [],
            )
            .expect("insert agent profile");
        connection
            .execute(
                "INSERT INTO issues (id, project_id, title, description, status, label_ids, created_at, updated_at, del)
                 VALUES (16, 1, 'I16', '', 'running', '[]', 1, 1, 0)",
                [],
            )
            .expect("insert issue");
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, issue_id, title, agent_profile_id, codex_session_id,
                   status, attention, working_dir, command_snapshot, prompt_snapshot,
                   workspace_mode, target_branch, workspace_branch, workspace_path,
                   origin_branch, worktree_owner, log_path,
                   list_inserted_at, last_active_at, started_at, closed_at, del,
                   current_turn_source, current_turn_id
                 ) VALUES (
                   30, 1, 16, NULL, 101, NULL,
                   'running', 'none', '', 'codex', '',
                   'current_branch', NULL, NULL, NULL,
                   NULL, 'external', ?1,
                   1, 2, 1, NULL, 0,
                   'completion', 't1'
                 )",
                params![log.to_string_lossy().to_string()],
            )
            .expect("insert agent session");

        let service = IssueService::new(
            IssueRepository::new(&connection),
            ProjectRepository::new(&connection),
        );

        // completion + turn_id 匹配 → 发表评论
        assert!(
            try_publish_completion_comment(&service, 30, "t1").expect("publish"),
            "completion turn 应发表评论"
        );
        let timeline = service
            .get_issue_timeline(GetIssueTimelineInput {
                project_id: 1,
                issue_id: 16,
            })
            .expect("timeline");
        let comment = timeline
            .entries
            .iter()
            .find(|e| e.action_type == IssueTimelineActionType::IssueCommentAdded)
            .expect("应有评论动作");
        assert_eq!(comment.actor.actor_kind, "agent");
        assert_eq!(comment.actor.name, "Codex");
        assert_eq!(comment.comment_body.as_deref(), Some("交付摘要正文"));

        // 幂等：重复触发不再新增评论
        let count_after_replay = {
            let _ = try_publish_completion_comment(&service, 30, "t1").expect("replay");
            service
                .get_issue_timeline(GetIssueTimelineInput {
                    project_id: 1,
                    issue_id: 16,
                })
                .expect("timeline")
                .entries
                .iter()
                .filter(|e| e.action_type == IssueTimelineActionType::IssueCommentAdded)
                .count()
        };
        assert_eq!(count_after_replay, 1, "幂等：仍只有一条评论");

        // turn_id 不匹配（被抢占）→ 不发表
        assert!(
            !try_publish_completion_comment(&service, 30, "t_other").expect("mismatch"),
            "turn_id 不匹配不应发表"
        );

        // follow_up 来源 → 不发表
        connection
            .execute(
                "UPDATE agent_sessions SET current_turn_source='follow_up' WHERE id=30",
                [],
            )
            .expect("set follow_up");
        assert!(
            !try_publish_completion_comment(&service, 30, "t1").expect("follow_up"),
            "follow_up turn 不应发表"
        );
    }
}
