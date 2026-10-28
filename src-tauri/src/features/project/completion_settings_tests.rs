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
    fn walk(dir: &std::path::Path, found: &mut Vec<std::path::PathBuf>) {
        let entries = fs::read_dir(dir).expect("read data dir");
        for entry in entries {
            let path = entry.expect("data dir entry").path();
            if path.is_dir() {
                walk(&path, found);
                continue;
            }
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if name.ends_with(".db") || name.ends_with(".sqlite") || name.ends_with(".sqlite3") {
                found.push(path);
            }
        }
    }

    let mut found = Vec::new();
    walk(data_dir, &mut found);
    assert_eq!(found.len(), 1, "expected one app database, found {found:?}");
    rusqlite::Connection::open(&found[0]).expect("open app database")
}

fn set_project_times(data_dir: &std::path::Path, name: &str, created_at: i64, last_opened_at: i64) {
    let connection = open_app_database(data_dir);
    let updated = connection
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

#[test]
fn suggests_latest_opened_same_host_completion_defaults() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repo root");
    let github_a = git_repo_with_origin(&repos, "github-a", "https://github.com/org/a.git");
    let github_b = git_repo_with_origin(&repos, "github-b", "https://github.com/org/b.git");
    let gitlab_c = git_repo_with_origin(&repos, "gitlab-c", "https://gitlab.com/org/c.git");
    let removed_github = git_repo_with_origin(
        &repos,
        "github-removed",
        "https://github.com/org/removed.git",
    );
    let new_github = git_repo_with_origin(&repos, "github-new", "https://github.com/org/new.git");

    create_named_project(
        data_dir.path(),
        "alpha",
        github_a,
        ProjectCompletionAction::MergeToBase,
        false,
    );
    create_named_project(
        data_dir.path(),
        "beta",
        github_b,
        ProjectCompletionAction::OpenPullRequest,
        true,
    );
    create_named_project(
        data_dir.path(),
        "gamma",
        gitlab_c,
        ProjectCompletionAction::MergeToBase,
        false,
    );
    let removed_id = create_named_project(
        data_dir.path(),
        "removed",
        removed_github,
        ProjectCompletionAction::MergeToBase,
        false,
    );
    ProjectService::remove_project_from_list_in_data_dir(data_dir.path(), removed_id)
        .expect("remove later github project");

    set_project_times(data_dir.path(), "alpha", 100, 200);
    set_project_times(data_dir.path(), "beta", 150, 200);
    set_project_times(data_dir.path(), "gamma", 100, 300);
    set_project_times(data_dir.path(), "removed", 400, 400);

    let suggestion =
        ProjectService::validate_project_repo_path_in_data_dir(data_dir.path(), &new_github)
            .expect("suggest github defaults");
    assert_eq!(suggestion.host, "github");
    assert_eq!(
        suggestion.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );
    assert!(suggestion.confirm_completion_action);

    let created = ProjectService::create_project_in_data_dir(
        data_dir.path(),
        CreateProjectInput {
            name: "created".to_string(),
            repo_path: new_github,
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: String::new(),
            completion_action: Some(suggestion.completion_action),
            pr_target: Some(ProjectPrTarget::IssueBase),
            pr_draft: Some(false),
            confirm_completion_action: Some(suggestion.confirm_completion_action),
        },
    )
    .expect("create from suggestion");
    assert_eq!(created.pr_target, ProjectPrTarget::IssueBase);
    assert!(!created.pr_draft);
    assert_eq!(
        created.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );
    assert!(created.confirm_completion_action);
}

#[test]
fn suggests_alphabetically_first_name_when_times_match() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repo root");
    let repo_b = git_repo_with_origin(&repos, "repo-b", "https://github.com/org/b.git");
    let repo_a = git_repo_with_origin(&repos, "repo-a", "https://github.com/org/a.git");
    let new_github = git_repo_with_origin(&repos, "repo-new", "https://github.com/org/new.git");

    create_named_project(
        data_dir.path(),
        "b",
        repo_b,
        ProjectCompletionAction::MergeToBase,
        false,
    );
    create_named_project(
        data_dir.path(),
        "a",
        repo_a,
        ProjectCompletionAction::OpenPullRequest,
        true,
    );
    set_project_times(data_dir.path(), "b", 100, 200);
    set_project_times(data_dir.path(), "a", 100, 200);

    let suggestion =
        ProjectService::validate_project_repo_path_in_data_dir(data_dir.path(), &new_github)
            .expect("suggest");
    assert_eq!(
        suggestion.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );
    assert!(suggestion.confirm_completion_action);
}

#[test]
fn classifies_repo_host_and_defaults_when_no_same_host_project() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repo root");
    let gitlab = git_repo_with_origin(&repos, "gitlab-only", "https://gitlab.com/org/only.git");
    create_named_project(
        data_dir.path(),
        "gitlab-only",
        gitlab,
        ProjectCompletionAction::OpenPullRequest,
        true,
    );

    let github = git_repo_with_origin(&repos, "github-app", "https://github.com/acme/app.git");
    let gitlab_host =
        git_repo_with_origin(&repos, "gitlab-app", "git@gitlab.example.com:acme/app.git");
    let enterprise = git_repo_with_origin(
        &repos,
        "enterprise-app",
        "https://github.example.com/acme/app.git",
    );
    let no_remote = git_repo(&repos, "local-app");

    let github_suggestion =
        ProjectService::validate_project_repo_path_in_data_dir(data_dir.path(), &github)
            .expect("github");
    assert_eq!(github_suggestion.host, "github");
    assert_eq!(
        github_suggestion.completion_action,
        ProjectCompletionAction::MergeToBase
    );
    assert!(!github_suggestion.confirm_completion_action);

    let gitlab_suggestion =
        ProjectService::validate_project_repo_path_in_data_dir(data_dir.path(), &gitlab_host)
            .expect("gitlab");
    assert_eq!(gitlab_suggestion.host, "gitlab");
    assert_eq!(
        gitlab_suggestion.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );
    assert!(gitlab_suggestion.confirm_completion_action);

    let enterprise_suggestion =
        ProjectService::validate_project_repo_path_in_data_dir(data_dir.path(), &enterprise)
            .expect("enterprise");
    assert_eq!(enterprise_suggestion.host, "none");
    assert_eq!(
        enterprise_suggestion.completion_action,
        ProjectCompletionAction::MergeToBase
    );
    assert!(!enterprise_suggestion.confirm_completion_action);

    let local_suggestion =
        ProjectService::validate_project_repo_path_in_data_dir(data_dir.path(), &no_remote)
            .expect("no remote");
    assert_eq!(local_suggestion.host, "none");
    assert_eq!(
        local_suggestion.completion_action,
        ProjectCompletionAction::MergeToBase
    );
    assert!(!local_suggestion.confirm_completion_action);
}

#[test]
fn ignores_the_path_being_filled_when_suggesting_completion_defaults() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repo root");
    let current = git_repo_with_origin(&repos, "current", "https://github.com/org/current.git");
    let older = git_repo_with_origin(&repos, "older", "https://github.com/org/older.git");
    create_named_project(
        data_dir.path(),
        "current",
        current.clone(),
        ProjectCompletionAction::OpenPullRequest,
        true,
    );
    create_named_project(
        data_dir.path(),
        "older",
        older,
        ProjectCompletionAction::MergeToBase,
        false,
    );
    set_project_times(data_dir.path(), "current", 300, 500);
    set_project_times(data_dir.path(), "older", 100, 100);

    let suggestion =
        ProjectService::validate_project_repo_path_in_data_dir(data_dir.path(), &current)
            .expect("suggest without self");
    assert_eq!(
        suggestion.completion_action,
        ProjectCompletionAction::MergeToBase
    );
    assert!(!suggestion.confirm_completion_action);
}

#[test]
fn recreating_an_active_project_keeps_completion_settings() {
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
            pr_draft: Some(true),
            confirm_completion_action: Some(true),
        },
    )
    .expect("create");

    let again = ProjectService::create_project_in_data_dir(
        data_dir.path(),
        CreateProjectInput {
            name: "App Renamed".to_string(),
            repo_path,
            worktree_location: ProjectWorktreeLocation::UserHome,
            worktree_setup_command: "pnpm install".to_string(),
            completion_action: Some(ProjectCompletionAction::MergeToBase),
            pr_target: Some(ProjectPrTarget::IssueBase),
            pr_draft: Some(false),
            confirm_completion_action: Some(false),
        },
    )
    .expect("create again");

    assert_eq!(again.id, created.id);
    assert_eq!(again.name, "App");
    assert_eq!(
        again.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );
    assert_eq!(again.pr_target, ProjectPrTarget::RepoDefault);
    assert!(again.pr_draft);
    assert!(again.confirm_completion_action);
    assert_eq!(
        again.worktree_location,
        ProjectWorktreeLocation::RepoSibling
    );
    assert_eq!(again.worktree_setup_command, "");
}
