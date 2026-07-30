use super::{
    extract_issue_comment_from_assistant_text, is_eligible_turn_source, is_trivial_comment_body,
    resolve_completion_comment_body, strip_fenced_code_blocks, try_publish_completion_comment,
};
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::features::issue::service::IssueService;
use crate::types::issue::{GetIssueTimelineInput, IssueTimelineActionType};
use rusqlite::{params, Connection};
use std::fs;
use std::path::Path as FsPath;
use tempfile::tempdir;

fn assistant_line(turn_id: &str, text: &str) -> String {
    // 对 JSON 字符串转义必要字符
    let escaped = text
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    format!(
        "{{\"projectId\":1,\"sessionId\":30,\"seq\":1,\"epoch\":\"e\",\"event\":{{\"type\":\"timeline\",\"item\":{{\"type\":\"assistant_message\",\"text\":\"{escaped}\"}},\"turnId\":\"{turn_id}\",\"seq\":1,\"timestamp\":1}}}}"
    )
}

fn seed_session(connection: &Connection, log_path: &FsPath, db_turn_source: &str, db_turn_id: &str) {
    MigrationRunner::default()
        .run(connection)
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
               ?2, ?3
             )",
            params![
                log_path.to_string_lossy().to_string(),
                db_turn_source,
                db_turn_id
            ],
        )
        .expect("insert agent session");
}

fn comment_bodies(service: &IssueService<'_>) -> Vec<String> {
    service
        .get_issue_timeline(GetIssueTimelineInput {
            project_id: 1,
            issue_id: 16,
        })
        .expect("timeline")
        .entries
        .into_iter()
        .filter(|e| e.action_type == IssueTimelineActionType::IssueCommentAdded)
        .filter_map(|e| e.comment_body)
        .collect()
}

#[test]
fn extract_issue_comment_from_assistant_text_cases() {
    assert_eq!(
        extract_issue_comment_from_assistant_text(
            "提交完成 <issue-comment>交付了 X，验证通过</issue-comment>"
        ),
        Some("交付了 X，验证通过".to_string())
    );
    assert_eq!(
        extract_issue_comment_from_assistant_text(
            "<issue-comment>first</issue-comment> 后续 <issue-comment>second</issue-comment>"
        ),
        Some("first".to_string())
    );
    assert_eq!(extract_issue_comment_from_assistant_text("无标签答复"), None);
    assert_eq!(
        extract_issue_comment_from_assistant_text(
            "```\n<issue-comment>in code block</issue-comment>\n```"
        ),
        None
    );
}

#[test]
fn resolve_body_prefers_tag_from_later_message_scanning_backward() {
    let texts = vec![
        "中间消息 <issue-comment>中间标签</issue-comment>".to_string(),
        "最后一条无标签，只是说明".to_string(),
    ];
    assert_eq!(
        resolve_completion_comment_body(&texts),
        "中间标签",
        "应从后往前找到中间消息的标签"
    );

    let prefer_last_tag = vec![
        "<issue-comment>较早</issue-comment>".to_string(),
        "其他".to_string(),
        "<issue-comment>较晚</issue-comment>".to_string(),
    ];
    assert_eq!(resolve_completion_comment_body(&prefer_last_tag), "较晚");
}

#[test]
fn resolve_body_fallback_strips_fence_truncates_and_handles_trivial() {
    let with_fence = vec!["说明如下：\n```rust\nfn main() {}\n```\n验证通过".to_string()];
    let body = resolve_completion_comment_body(&with_fence);
    assert!(!body.contains("fn main"), "应去掉 fence 内代码");
    assert!(body.contains("说明如下"), "保留块外文本");
    assert!(body.contains("验证通过"));

    let long = "字".repeat(850);
    let truncated = resolve_completion_comment_body(&[long]);
    assert_eq!(truncated.chars().count(), 801, "800 字 + 省略号");
    assert!(truncated.ends_with('…'));

    assert_eq!(
        resolve_completion_comment_body(&["Done!".to_string()]),
        "Agent 已完成本轮任务。"
    );
    assert_eq!(
        resolve_completion_comment_body(&["完成。".to_string()]),
        "Agent 已完成本轮任务。"
    );
    assert_eq!(
        resolve_completion_comment_body(&[]),
        "Agent 已完成本轮任务。",
        "无助手消息也应发固定句"
    );
    assert_eq!(
        resolve_completion_comment_body(&[String::new(), "   ".to_string()]),
        "Agent 已完成本轮任务。"
    );
}

#[test]
fn is_eligible_turn_source_only_initial_and_completion() {
    assert!(is_eligible_turn_source("initial"));
    assert!(is_eligible_turn_source("completion"));
    assert!(!is_eligible_turn_source("follow_up"));
    assert!(!is_eligible_turn_source(""));
    assert!(!is_eligible_turn_source("other"));
}

#[test]
fn strip_and_trivial_helpers() {
    assert_eq!(
        strip_fenced_code_blocks("a\n```\ncode\n```\nb"),
        "a\nb"
    );
    assert!(is_trivial_comment_body("ok"));
    assert!(is_trivial_comment_body("  好的！ "));
    assert!(!is_trivial_comment_body("完成了登录模块并验证通过"));
}

#[test]
fn try_publish_uses_snapshot_source_not_db_and_is_idempotent() {
    let temp = tempdir().expect("temp dir");
    let log = temp.path().join("session.log");
    fs::write(
        &log,
        assistant_line("t1", "done <issue-comment>交付摘要正文</issue-comment>"),
    )
    .expect("write log");

    let connection = Connection::open_in_memory().expect("open database");
    // DB 已被 follow_up 覆盖，快照仍是 completion → 应发表
    seed_session(&connection, &log, "follow_up", "t_new");
    let service = IssueService::new(
        IssueRepository::new(&connection),
        ProjectRepository::new(&connection),
    );

    assert!(
        try_publish_completion_comment(&service, 30, "completion", "t1").expect("publish"),
        "快照 completion 不受库中 follow_up 误杀"
    );
    let bodies = comment_bodies(&service);
    assert_eq!(bodies, vec!["交付摘要正文".to_string()]);

    assert!(
        !try_publish_completion_comment(&service, 30, "completion", "t1").expect("replay"),
        "幂等：重复不新增"
    );
    assert_eq!(comment_bodies(&service).len(), 1);

    assert!(
        !try_publish_completion_comment(&service, 30, "follow_up", "t1").expect("follow_up"),
        "同 turn 幂等：follow_up 快照也不重复发表"
    );
}

#[test]
fn try_publish_follow_up_with_tag_publishes() {
    let temp = tempdir().expect("temp dir");
    let log = temp.path().join("session.log");
    fs::write(
        &log,
        assistant_line(
            "t-follow",
            "本轮实现完成 <issue-comment>完成运维同步：limit + 无变化跳过</issue-comment>",
        ),
    )
    .expect("write log");

    let connection = Connection::open_in_memory().expect("open database");
    seed_session(&connection, &log, "follow_up", "t-follow");
    let service = IssueService::new(
        IssueRepository::new(&connection),
        ProjectRepository::new(&connection),
    );

    assert!(
        try_publish_completion_comment(&service, 30, "follow_up", "t-follow").expect("publish"),
        "follow_up 但含 <issue-comment> 应发表（标签=显式意图）"
    );
    assert_eq!(
        comment_bodies(&service),
        vec!["完成运维同步：limit + 无变化跳过".to_string()]
    );
}

#[test]
fn try_publish_follow_up_without_tag_skips() {
    let temp = tempdir().expect("temp dir");
    let log = temp.path().join("session.log");
    fs::write(
        &log,
        assistant_line("t-q", "「最新 n 条」按什么取？\n1. miggoItemId\n2. 视图顺序"),
    )
    .expect("write log");

    let connection = Connection::open_in_memory().expect("open database");
    seed_session(&connection, &log, "follow_up", "t-q");
    let service = IssueService::new(
        IssueRepository::new(&connection),
        ProjectRepository::new(&connection),
    );

    assert!(
        !try_publish_completion_comment(&service, 30, "follow_up", "t-q").expect("skip"),
        "follow_up 无标签不走 Multica 兜底，避免追问刷屏"
    );
    assert!(comment_bodies(&service).is_empty());
}

#[test]
fn try_publish_accepts_initial_and_fallback_without_tag() {
    let temp = tempdir().expect("temp dir");
    let log = temp.path().join("session.log");
    fs::write(
        &log,
        format!(
            "{}\n{}\n",
            assistant_line("t-init", "首轮做了 X"),
            assistant_line("t-init", "最终：修复了登录并跑通测试"),
        ),
    )
    .expect("write log");

    let connection = Connection::open_in_memory().expect("open database");
    seed_session(&connection, &log, "initial", "t-init");
    let service = IssueService::new(
        IssueRepository::new(&connection),
        ProjectRepository::new(&connection),
    );

    assert!(
        try_publish_completion_comment(&service, 30, "initial", "t-init").expect("publish"),
        "initial 应 eligible"
    );
    assert_eq!(
        comment_bodies(&service),
        vec!["最终：修复了登录并跑通测试".to_string()]
    );
}

#[test]
fn try_publish_scans_all_messages_for_tag_not_only_last() {
    let temp = tempdir().expect("temp dir");
    let log = temp.path().join("session.log");
    fs::write(
        &log,
        format!(
            "{}\n{}\n",
            assistant_line("t1", "先写摘要 <issue-comment>多消息标签</issue-comment>"),
            assistant_line("t1", "最后一条没有标签"),
        ),
    )
    .expect("write log");

    let connection = Connection::open_in_memory().expect("open database");
    seed_session(&connection, &log, "completion", "t1");
    let service = IssueService::new(
        IssueRepository::new(&connection),
        ProjectRepository::new(&connection),
    );

    assert!(try_publish_completion_comment(&service, 30, "completion", "t1").expect("publish"));
    assert_eq!(comment_bodies(&service), vec!["多消息标签".to_string()]);
}

#[test]
fn try_publish_trivial_output_uses_fixed_sentence() {
    let temp = tempdir().expect("temp dir");
    let log = temp.path().join("session.log");
    fs::write(&log, assistant_line("t1", "Done.")).expect("write log");

    let connection = Connection::open_in_memory().expect("open database");
    seed_session(&connection, &log, "completion", "t1");
    let service = IssueService::new(
        IssueRepository::new(&connection),
        ProjectRepository::new(&connection),
    );

    assert!(try_publish_completion_comment(&service, 30, "completion", "t1").expect("publish"));
    assert_eq!(
        comment_bodies(&service),
        vec!["Agent 已完成本轮任务。".to_string()]
    );
}
