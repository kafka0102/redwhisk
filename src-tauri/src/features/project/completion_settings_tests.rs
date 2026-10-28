use std::fs;
use std::process::Command;

use tempfile::TempDir;

use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::features::project::ProjectService;
use crate::types::project::{
    CreateProjectInput, ProjectCompletionAction, ProjectPrTarget, ProjectWorktreeLocation,
    UpdateProjectSettingsInput,
};

fn git_repo(root: &TempDir, name: &str) -> String {
    let path = root.path().join(name);
    fs::create_dir_all(&path).expect("repo dir");
    let status = Command::new("git")
        .arg("init")
        .arg(&path)
        .status()
        .expect("git init");
    assert!(status.success(), "git init failed");
    path.to_string_lossy().to_string()
}

#[test]
fn create_restore_and_update_keep_completion_choices() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repo root");
    let repo_path = git_repo(&repos, "app");
    let created = ProjectService::create_project_in_data_dir(
        data_dir.path(),
        CreateProjectInput {
            name: "App".to_string(),
            repo_path: repo_path.clone(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: String::new(),
            completion_action: Some(ProjectCompletionAction::OpenPullRequest),
            pr_target: Some(ProjectPrTarget::RepoDefault),
            pr_draft: Some(false),
            confirm_completion_action: Some(true),
        },
    )
    .expect("create project");
    assert_eq!(
        created.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );
    assert_eq!(created.pr_target, ProjectPrTarget::RepoDefault);
    assert!(!created.pr_draft);
    assert!(created.confirm_completion_action);

    ProjectService::remove_project_from_list_in_data_dir(data_dir.path(), created.id)
        .expect("remove project");
    let restored = ProjectService::create_project_in_data_dir(
        data_dir.path(),
        CreateProjectInput {
            name: "App Restored".to_string(),
            repo_path,
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: String::new(),
            completion_action: Some(ProjectCompletionAction::MergeToBase),
            pr_target: Some(ProjectPrTarget::IssueBase),
            pr_draft: Some(true),
            confirm_completion_action: Some(false),
        },
    )
    .expect("restore project");
    assert_eq!(restored.id, created.id);
    assert_eq!(
        restored.completion_action,
        ProjectCompletionAction::MergeToBase
    );
    assert_eq!(restored.pr_target, ProjectPrTarget::IssueBase);
    assert!(restored.pr_draft);
    assert!(!restored.confirm_completion_action);

    let updated = ProjectService::update_project_settings_in_data_dir(
        data_dir.path(),
        UpdateProjectSettingsInput {
            project_id: restored.id,
            name: "App Restored".to_string(),
            repo_path: restored.repo_path.clone(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: String::new(),
            completion_action: None,
            pr_target: None,
            pr_draft: None,
            confirm_completion_action: Some(true),
        },
    )
    .expect("update confirm only");
    assert!(updated.confirm_completion_action);
    assert_eq!(
        updated.completion_action,
        ProjectCompletionAction::MergeToBase
    );
    assert_eq!(updated.pr_target, ProjectPrTarget::IssueBase);
    assert!(updated.pr_draft);

    let unchanged = ProjectService::update_project_settings_in_data_dir(
        data_dir.path(),
        UpdateProjectSettingsInput {
            project_id: restored.id,
            name: "App Renamed".to_string(),
            repo_path: restored.repo_path,
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: String::new(),
            completion_action: None,
            pr_target: None,
            pr_draft: None,
            confirm_completion_action: None,
        },
    )
    .expect("update without confirm");
    assert_eq!(unchanged.name, "App Renamed");
    assert!(unchanged.confirm_completion_action);
}

#[test]
fn historical_projects_default_confirm_to_no_and_keep_draft() {
    let connection = rusqlite::Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("foreign keys");
    MigrationRunner::runner_skipping(&["0058_project_confirm_completion_action"])
        .run(&connection)
        .expect("migrations before confirm column");
    connection
        .execute(
            "INSERT INTO projects (
                name, repo_path, created_at, last_opened_at, worktree_location,
                worktree_setup_command, completion_action, pr_target, pr_draft
             ) VALUES (
                'legacy', '/tmp/legacy', 1, 1, 'repo_sibling', '',
                'open_pull_request', 'repo_default', 0
             )",
            [],
        )
        .expect("set legacy draft off");
    let project_id: i64 = connection
        .query_row(
            "SELECT id FROM projects WHERE repo_path = '/tmp/legacy'",
            [],
            |row| row.get(0),
        )
        .expect("legacy id");

    MigrationRunner::default()
        .run(&connection)
        .expect("apply confirm migration");
    let loaded = ProjectRepository::new(&connection)
        .find_by_id(project_id)
        .expect("read project")
        .expect("project exists");
    assert!(!loaded.confirm_completion_action);
    assert!(!loaded.pr_draft);
    assert_eq!(
        loaded.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );
    assert_eq!(loaded.pr_target, ProjectPrTarget::RepoDefault);
}
