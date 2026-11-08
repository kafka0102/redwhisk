use rusqlite::params;

use crate::types::issue::IssueStatus;

use super::super::board::list_board_issues;
use super::super::port::RemoteIssueState;
use super::support::{
    action_count, issue_status, ready_github_project, remote_issue, seed_remote_issue, sync_with,
};

#[test]
fn closing_backlog_or_review_completes_and_writes_one_remote_action() {
    let harness = ready_github_project("all", None);
    let backlog = seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "backlog",
        "issue-1",
        1,
        "open",
        false,
    );
    let review = seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "review",
        "issue-2",
        2,
        "open",
        false,
    );
    sync_with(
        &harness,
        vec![
            remote_issue(1, RemoteIssueState::Closed, "Backlog"),
            remote_issue(2, RemoteIssueState::Closed, "Review"),
        ],
    );
    assert_eq!(issue_status(&harness.connection, backlog), "completed");
    assert_eq!(issue_status(&harness.connection, review), "completed");
    assert_eq!(action_count(&harness.connection, backlog), 1);
    assert_eq!(action_count(&harness.connection, review), 1);
}

#[test]
fn closing_running_keeps_running_and_marks_remote_closed() {
    let harness = ready_github_project("all", None);
    let running = seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "running",
        "issue-5",
        5,
        "open",
        false,
    );
    let before = action_count(&harness.connection, running);
    sync_with(
        &harness,
        vec![remote_issue(5, RemoteIssueState::Closed, "Running")],
    );
    assert_eq!(issue_status(&harness.connection, running), "running");
    assert_eq!(action_count(&harness.connection, running), before);
    let listed = list_board_issues(&harness.connection, harness.project_id).expect("list");
    assert!(listed[0].remote_closed_while_running);
    assert!(!listed[0].remote_reopened);
}

#[test]
fn already_open_remote_keeps_completed_without_a_session() {
    let harness = ready_github_project("all", None);
    let completed = seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "completed",
        "issue-7b",
        17,
        "open",
        false,
    );
    sync_with(
        &harness,
        vec![remote_issue(17, RemoteIssueState::Open, "Still open")],
    );
    assert_eq!(issue_status(&harness.connection, completed), "completed");
}

#[test]
fn closing_completed_does_not_add_another_status_action() {
    let harness = ready_github_project("all", None);
    let completed = seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "completed",
        "issue-6",
        6,
        "closed",
        false,
    );
    harness
        .connection
        .execute(
            "INSERT INTO issue_actions (issue_id, action_type, payload_json, created_at, actor_kind)
             VALUES (?1, 'issue_status_changed', '{}', 1, 'remote')",
            params![completed],
        )
        .expect("existing action");
    sync_with(
        &harness,
        vec![remote_issue(6, RemoteIssueState::Closed, "Done")],
    );
    assert_eq!(issue_status(&harness.connection, completed), "completed");
    assert_eq!(action_count(&harness.connection, completed), 1);
}

#[test]
fn reopening_completed_without_a_session_returns_to_backlog() {
    let harness = ready_github_project("all", None);
    let completed = seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "completed",
        "issue-7",
        7,
        "closed",
        false,
    );
    sync_with(
        &harness,
        vec![remote_issue(7, RemoteIssueState::Open, "Again")],
    );
    assert_eq!(issue_status(&harness.connection, completed), "backlog");
    assert_eq!(action_count(&harness.connection, completed), 1);
    let listed = list_board_issues(&harness.connection, harness.project_id).expect("list");
    assert_eq!(listed[0].status, IssueStatus::Backlog);
    assert!(!listed[0].remote_reopened);
}

#[test]
fn reopening_completed_with_a_session_stays_completed() {
    let harness = ready_github_project("all", None);
    let completed = seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "completed",
        "issue-8",
        8,
        "closed",
        false,
    );
    harness
        .connection
        .execute(
            "INSERT INTO agent_profiles (
                id, name, agent_type, command, scope, project_id, mode, dangerous,
                default_skill, prompt_template, del
             ) VALUES (100, 'Codex', 'codex', 'codex', 'project', ?1, 'full-auto', 1, '', '', 0)",
            params![harness.project_id],
        )
        .expect("profile");
    harness
        .connection
        .execute(
            "INSERT INTO agent_sessions (
                id, project_id, issue_id, number, agent_profile_id, status, attention,
                working_dir, command_snapshot, prompt_snapshot, log_path,
                last_active_at, started_at, del
             ) VALUES (
                50, ?1, ?2, 1, 100, 'closed', 'none',
                '/tmp/app', 'codex', '', '/tmp/s.log', 13, 13, 0
             )",
            params![harness.project_id, completed],
        )
        .expect("session");
    let before = action_count(&harness.connection, completed);
    sync_with(
        &harness,
        vec![remote_issue(8, RemoteIssueState::Open, "Still done")],
    );
    assert_eq!(issue_status(&harness.connection, completed), "completed");
    assert_eq!(action_count(&harness.connection, completed), before);
    let listed = list_board_issues(&harness.connection, harness.project_id).expect("list");
    assert!(listed[0].remote_reopened);
}

#[test]
fn open_remote_does_not_change_backlog_running_or_review() {
    let harness = ready_github_project("all_open", None);
    let backlog = seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "backlog",
        "issue-1",
        1,
        "open",
        false,
    );
    let running = seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "running",
        "issue-2",
        2,
        "closed",
        false,
    );
    let review = seed_remote_issue(
        &harness.connection,
        harness.project_id,
        "review",
        "issue-3",
        3,
        "open",
        false,
    );
    sync_with(
        &harness,
        vec![
            remote_issue(1, RemoteIssueState::Open, "Backlog"),
            remote_issue(2, RemoteIssueState::Open, "Running"),
            remote_issue(3, RemoteIssueState::Open, "Review"),
        ],
    );
    assert_eq!(issue_status(&harness.connection, backlog), "backlog");
    assert_eq!(issue_status(&harness.connection, running), "running");
    assert_eq!(issue_status(&harness.connection, review), "review");
    assert_eq!(action_count(&harness.connection, backlog), 0);
    assert_eq!(action_count(&harness.connection, running), 0);
    assert_eq!(action_count(&harness.connection, review), 0);
}
