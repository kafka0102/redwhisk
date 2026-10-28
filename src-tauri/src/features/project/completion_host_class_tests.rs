use std::fs;
use std::process::Command;

use tempfile::TempDir;

use crate::db::connection::DATABASE_FILE_NAME;
use crate::db::migrations::MigrationRunner;
use crate::features::project::ProjectService;
use crate::types::project::{
    CreateProjectInput, ProjectCompletionAction, ProjectPrTarget, ProjectWorktreeLocation,
    UpdateProjectSettingsInput,
};

fn git_repo(root: &TempDir, name: &str) -> String {
    let path = root.path().join(name);
    fs::create_dir_all(&path).expect("repo dir");
    let status = Command::new("git")
        .args(["init", path.to_str().expect("repo path")])
        .status()
        .expect("git init");
    assert!(status.success(), "git init failed");
    path.to_string_lossy().to_string()
}

fn git_repo_with_origin(root: &TempDir, name: &str, origin: &str) -> String {
    let path = git_repo(root, name);
    let status = Command::new("git")
        .args(["-C", &path, "remote", "add", "origin", origin])
        .status()
        .expect("git remote add");
    assert!(status.success(), "git remote add failed");
    path
}

fn open_app_database(data_dir: &std::path::Path) -> rusqlite::Connection {
    rusqlite::Connection::open(data_dir.join(DATABASE_FILE_NAME)).expect("open app database")
}

fn forge_host_of(data_dir: &std::path::Path, name: &str) -> String {
    open_app_database(data_dir)
        .query_row(
            "SELECT forge_host FROM projects WHERE name = ?1",
            [name],
            |row| row.get(0),
        )
        .expect("read forge host")
}

fn set_project_times(data_dir: &std::path::Path, name: &str, created_at: i64, last_opened_at: i64) {
    let updated = open_app_database(data_dir)
        .execute(
            "UPDATE projects SET created_at = ?1, last_opened_at = ?2 WHERE name = ?3",
            rusqlite::params![created_at, last_opened_at, name],
        )
        .expect("update project times");
    assert_eq!(updated, 1, "project {name} was not updated");
}

fn create_named_project(
    data_dir: &std::path::Path,
    name: &str,
    repo_path: String,
    completion_action: ProjectCompletionAction,
    confirm_completion_action: bool,
) -> i64 {
    ProjectService::create_project_in_data_dir(
        data_dir,
        CreateProjectInput {
            name: name.to_string(),
            repo_path,
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: String::new(),
            completion_action: Some(completion_action),
            pr_target: Some(ProjectPrTarget::RepoDefault),
            pr_draft: Some(true),
            confirm_completion_action: Some(confirm_completion_action),
        },
    )
    .expect("create named project")
    .id
}

#[test]
fn suggests_saved_host_class_instead_of_live_git_remote() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repo root");
    let recent = git_repo_with_origin(&repos, "recent", "https://github.com/org/recent.git");
    let older = git_repo_with_origin(&repos, "older", "https://github.com/org/older.git");
    let candidate = git_repo_with_origin(&repos, "candidate", "https://github.com/org/new.git");

    create_named_project(
        data_dir.path(),
        "recent",
        recent,
        ProjectCompletionAction::MergeToBase,
        false,
    );
    create_named_project(
        data_dir.path(),
        "older",
        older,
        ProjectCompletionAction::OpenPullRequest,
        true,
    );
    set_project_times(data_dir.path(), "recent", 100, 300);
    set_project_times(data_dir.path(), "older", 100, 100);
    assert_eq!(forge_host_of(data_dir.path(), "recent"), "github");
    assert_eq!(forge_host_of(data_dir.path(), "older"), "github");

    // 两条 remote 仍是 GitHub。若校验再对每个项目跑 git，会选最近打开的 recent。
    let overwritten = open_app_database(data_dir.path())
        .execute(
            "UPDATE projects SET forge_host = 'other' WHERE name = 'recent'",
            [],
        )
        .expect("overwrite saved class");
    assert_eq!(overwritten, 1);

    let suggestion =
        ProjectService::validate_project_repo_path_in_data_dir(data_dir.path(), &candidate)
            .expect("suggest from saved class");
    assert_eq!(suggestion.host, "github");
    assert_eq!(
        suggestion.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );
    assert!(suggestion.confirm_completion_action);
}

#[test]
fn updating_repo_path_rewrites_saved_host_class() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repo root");
    let local = git_repo(&repos, "local");
    let github = git_repo_with_origin(&repos, "github-app", "https://github.com/org/app.git");
    let candidate = git_repo_with_origin(&repos, "candidate", "https://github.com/org/new.git");
    let project_id = create_named_project(
        data_dir.path(),
        "local",
        local,
        ProjectCompletionAction::OpenPullRequest,
        true,
    );
    assert_eq!(forge_host_of(data_dir.path(), "local"), "other");

    let before =
        ProjectService::validate_project_repo_path_in_data_dir(data_dir.path(), &candidate)
            .expect("no same class yet");
    assert_eq!(
        before.completion_action,
        ProjectCompletionAction::MergeToBase
    );
    assert!(!before.confirm_completion_action);

    ProjectService::update_project_settings_in_data_dir(
        data_dir.path(),
        UpdateProjectSettingsInput {
            project_id,
            name: "local".to_string(),
            repo_path: github,
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: String::new(),
            completion_action: Some(ProjectCompletionAction::OpenPullRequest),
            pr_target: Some(ProjectPrTarget::RepoDefault),
            pr_draft: Some(true),
            confirm_completion_action: Some(true),
        },
    )
    .expect("update repo path");
    assert_eq!(forge_host_of(data_dir.path(), "local"), "github");

    let after = ProjectService::validate_project_repo_path_in_data_dir(data_dir.path(), &candidate)
        .expect("saved github class");
    assert_eq!(
        after.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );
    assert!(after.confirm_completion_action);
}

#[test]
fn migration_backfills_missing_host_class_as_other() {
    let connection = rusqlite::Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("foreign keys");
    MigrationRunner::runner_skipping(&["0059_project_forge_host"])
        .run(&connection)
        .expect("migrations before forge host");
    connection
        .execute(
            "INSERT INTO projects (
                name, repo_path, created_at, last_opened_at, worktree_location,
                worktree_setup_command, completion_action, pr_target, pr_draft,
                confirm_completion_action
             ) VALUES (
                'legacy', 'https://github.com/org/legacy.git', 1, 9, 'repo_sibling', '',
                'open_pull_request', 'repo_default', 0, 1
             )",
            [],
        )
        .expect("insert legacy project");

    MigrationRunner::default()
        .run(&connection)
        .expect("apply forge host migration");
    let forge_host: String = connection
        .query_row(
            "SELECT forge_host FROM projects WHERE name = 'legacy'",
            [],
            |row| row.get(0),
        )
        .expect("read backfill");
    assert_eq!(forge_host, "other");
}
