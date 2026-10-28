//! 完成选择已经弹出后，本次改动作不能回写项目里保存的完成后动作。

use std::fs;
use std::path::Path;
use std::process::Command;

use rusqlite::{params, Connection};
use tempfile::tempdir;

use crate::agent::pty_session_manager::PtySessionManager;
use crate::agent::session_registry::AgentSessionRegistry;
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::features::issue::service::IssueService;
use crate::types::issue_completion::{
    CloseoutAction, CompleteIssueFlowAction, CompleteIssueFlowInput,
};
use crate::types::project::ProjectCompletionAction;

#[test]
fn prompted_closeout_merge_choice_keeps_saved_open_pull_request() {
    let temp_dir = tempdir().expect("create temp dir");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);

    let connection = setup_database(&repo_dir);
    connection
        .execute(
            "UPDATE projects
             SET completion_action = 'open_pull_request',
                 confirm_completion_action = 1,
                 pr_target = 'repo_default',
                 pr_draft = 0
             WHERE id = 1",
            [],
        )
        .expect("save open pull request");
    connection
        .execute(
            "INSERT INTO issue_completion_flows (
               issue_id, session_id, phase, ignore_dirty, updated_at
             ) VALUES (16, 30, 'prompting_closeout_action', 0, 1)",
            [],
        )
        .expect("persist prompted closeout");

    let service = IssueService::new(
        IssueRepository::new(&connection),
        ProjectRepository::new(&connection),
    );
    let result = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id: 1,
                issue_id: 16,
                ignore_dirty: None,
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
                closeout_action: Some(CloseoutAction::MergeToBase),
                closeout_base: Some("main".to_string()),
                closeout_draft: Some(false),
            },
            temp_dir.path().join("data"),
            &PtySessionManager::new(),
            &AgentSessionRegistry::new(),
        )
        .expect("apply closeout choice");

    assert_ne!(
        result.action,
        CompleteIssueFlowAction::PromptCloseoutAction,
        "closeout choice must leave the prompt"
    );
    let project = ProjectRepository::new(&connection)
        .find_by_id(1)
        .expect("read project summary")
        .expect("project row");
    assert_eq!(
        project.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );
    let saved_action: String = connection
        .query_row(
            "SELECT completion_action FROM projects WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .expect("read project row");
    assert_eq!(saved_action, "open_pull_request");
}

fn setup_database(repo_dir: &Path) -> Connection {
    let connection = Connection::open_in_memory().expect("open database");
    MigrationRunner::default()
        .run(&connection)
        .expect("run migrations");
    connection
        .execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (1, 'RedWhisk', ?1, 1, 1)",
            params![repo_dir.to_string_lossy().to_string()],
        )
        .expect("insert project");
    connection
        .execute(
            "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
             VALUES (101, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1, '', '', 0)",
            [],
        )
        .expect("insert profile");
    connection
        .execute(
            "INSERT INTO issues (id, project_id, number, title, description, status, label_ids, created_at, updated_at, del)
             VALUES (16, 1, 4, 'Issue 16', '', 'review', '[]', 1, 1, 0)",
            [],
        )
        .expect("insert issue");
    connection
        .execute(
            "INSERT INTO agent_sessions (
               id, project_id, number, issue_id, title, agent_profile_id, provider_session_id,
               status, attention, working_dir, command_snapshot, prompt_snapshot,
               workspace_mode, target_branch, workspace_branch, workspace_path,
               origin_branch, worktree_owner, log_path,
               list_inserted_at, last_active_at, started_at, closed_at, del
             ) VALUES (
               30, 1, 7, 16, NULL, 101, 'thread-16',
               'stopped', 'none', ?1, 'codex', '',
               'current_branch', NULL, NULL, NULL,
               NULL, 'external', ?2,
               1, 2, 1, 2, 0
             )",
            params![
                repo_dir.to_string_lossy().to_string(),
                repo_dir.join("session.log").to_string_lossy().to_string(),
            ],
        )
        .expect("insert session");
    connection
}

fn create_git_repo(repo_dir: &Path) {
    fs::create_dir_all(repo_dir).expect("create repo dir");
    git(repo_dir, &["init"]);
    git(repo_dir, &["config", "user.email", "redwhisk@example.test"]);
    git(repo_dir, &["config", "user.name", "RedWhisk Test"]);
    fs::write(repo_dir.join("base.txt"), "base\n").expect("write base file");
    git(repo_dir, &["add", "base.txt"]);
    git(repo_dir, &["commit", "-m", "initial"]);
}

fn git(repo_dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_dir)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
}
