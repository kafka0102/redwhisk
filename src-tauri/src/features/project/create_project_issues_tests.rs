use std::fs;
use std::process::Command;

use tempfile::TempDir;

use crate::features::project::issue_source::{
    get_project_issue_source_settings_in_data_dir, CliAuthOutcome, CliAuthSample,
};
use crate::features::project::ProjectService;
use crate::types::errors::CommandErrorCode;
use crate::types::project::{
    CreateProjectInput, CreateProjectIssueSourceInput, ProjectCompletionAction, ProjectPrTarget,
    ProjectWorktreeLocation,
};
use crate::types::project_issue_source::{IssueSourceMode, IssueSyncScope};

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
        .expect("git remote");
    assert!(status.success(), "git remote failed");
    path
}

fn open_database(data_dir: &std::path::Path) -> rusqlite::Connection {
    fn walk(dir: &std::path::Path, found: &mut Vec<std::path::PathBuf>) {
        for entry in fs::read_dir(dir).expect("read data dir") {
            let path = entry.expect("entry").path();
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
    assert_eq!(found.len(), 1, "expected one database, found {found:?}");
    rusqlite::Connection::open(&found[0]).expect("open database")
}

fn count_rows(connection: &rusqlite::Connection, sql: &str) -> i64 {
    connection
        .query_row(sql, [], |row| row.get(0))
        .expect("count")
}

fn input(repo_path: String, issue_source: CreateProjectIssueSourceInput) -> CreateProjectInput {
    CreateProjectInput {
        name: "App".to_string(),
        repo_path,
        worktree_location: ProjectWorktreeLocation::RepoSibling,
        worktree_setup_command: "pnpm install".to_string(),
        completion_action: Some(ProjectCompletionAction::OpenPullRequest),
        pr_target: Some(ProjectPrTarget::RepoDefault),
        pr_draft: Some(false),
        confirm_completion_action: Some(true),
        issue_source,
    }
}

fn remote_bug_source() -> CreateProjectIssueSourceInput {
    CreateProjectIssueSourceInput {
        issue_source_mode: Some(IssueSourceMode::Remote),
        issue_sync_scope: Some(IssueSyncScope::Label),
        issue_sync_label: Some("  bug  ".to_string()),
        issue_sync_enabled: Some(true),
        issue_sync_interval_seconds: Some(90),
        issue_writeback_close_on_complete: Some(true),
        issue_writeback_close_on_pr_merge: Some(false),
        issue_writeback_comment: Some(true),
    }
}

#[test]
fn creating_a_new_git_repo_stores_the_form_and_lists_it() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo_path = git_repo_with_origin(&repos, "app", "https://github.com/acme/app.git");
    let created = ProjectService::create_project_in_data_dir(
        data_dir.path(),
        input(repo_path.clone(), remote_bug_source()),
    )
    .expect("create");

    assert_eq!(created.name, "App");
    assert_eq!(
        created.repo_path,
        std::fs::canonicalize(&repo_path)
            .expect("canonical repo")
            .to_string_lossy()
    );
    assert_eq!(
        created.worktree_location,
        ProjectWorktreeLocation::RepoSibling
    );
    assert_eq!(created.worktree_setup_command, "pnpm install");
    assert_eq!(
        created.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );
    assert_eq!(created.pr_target, ProjectPrTarget::RepoDefault);
    assert!(!created.pr_draft);
    assert!(created.confirm_completion_action);

    let settings = get_project_issue_source_settings_in_data_dir(data_dir.path(), created.id)
        .expect("settings");
    assert_eq!(settings.issue_source_mode, IssueSourceMode::Remote);
    assert_eq!(settings.issue_sync_scope, IssueSyncScope::Label);
    assert_eq!(settings.issue_sync_label.as_deref(), Some("bug"));
    assert!(settings.issue_sync_enabled);
    assert_eq!(settings.issue_sync_interval_seconds, 90);
    assert!(settings.issue_writeback_close_on_complete);
    assert!(!settings.issue_writeback_close_on_pr_merge);
    assert!(settings.issue_writeback_comment);
    assert_eq!(settings.issue_create_source.as_str(), "remote");

    let listed = ProjectService::list_projects_in_data_dir(data_dir.path()).expect("list");
    assert_eq!(listed.projects.len(), 1);
    assert_eq!(listed.projects[0].id, created.id);
}

#[test]
fn blank_label_and_short_interval_do_not_insert_a_project() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo_path = git_repo(&repos, "app");
    let blank = CreateProjectIssueSourceInput {
        issue_source_mode: Some(IssueSourceMode::Remote),
        issue_sync_scope: Some(IssueSyncScope::Label),
        issue_sync_label: Some("   ".to_string()),
        ..CreateProjectIssueSourceInput::default()
    };
    let label_error = ProjectService::create_project_in_data_dir(
        data_dir.path(),
        input(repo_path.clone(), blank),
    )
    .expect_err("blank label");
    assert_eq!(label_error.code, CommandErrorCode::ProjectValidationFailed);
    assert_eq!(
        label_error.reason.as_deref(),
        Some("issueSyncLabelRequired")
    );

    let interval = CreateProjectIssueSourceInput {
        issue_sync_interval_seconds: Some(59),
        ..CreateProjectIssueSourceInput::default()
    };
    let interval_error =
        ProjectService::create_project_in_data_dir(data_dir.path(), input(repo_path, interval))
            .expect_err("short interval");
    assert_eq!(
        interval_error.reason.as_deref(),
        Some("issueSyncIntervalInvalid")
    );

    let connection = open_database(data_dir.path());
    assert_eq!(count_rows(&connection, "SELECT COUNT(*) FROM projects"), 0);
}

#[test]
fn a_non_git_path_does_not_insert_a_project() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let path = repos.path().join("plain");
    fs::create_dir_all(&path).expect("plain dir");
    let error = ProjectService::create_project_in_data_dir(
        data_dir.path(),
        input(
            path.to_string_lossy().to_string(),
            CreateProjectIssueSourceInput::default(),
        ),
    )
    .expect_err("not git");
    assert_eq!(error.code, CommandErrorCode::ProjectRepoNotGitRepository);
    let connection = open_database(data_dir.path());
    assert_eq!(count_rows(&connection, "SELECT COUNT(*) FROM projects"), 0);
}

#[test]
fn creating_the_same_listed_repo_keeps_the_saved_project() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo_path = git_repo(&repos, "app");
    let created = ProjectService::create_project_in_data_dir(
        data_dir.path(),
        input(repo_path.clone(), remote_bug_source()),
    )
    .expect("create");
    let mut again = input(
        repo_path,
        CreateProjectIssueSourceInput {
            issue_source_mode: Some(IssueSourceMode::Local),
            ..CreateProjectIssueSourceInput::default()
        },
    );
    again.name = "Renamed".to_string();
    again.worktree_location = ProjectWorktreeLocation::UserHome;
    again.completion_action = Some(ProjectCompletionAction::MergeToBase);
    again.confirm_completion_action = Some(false);
    let returned =
        ProjectService::create_project_in_data_dir(data_dir.path(), again).expect("again");
    assert_eq!(returned.id, created.id);
    assert_eq!(returned.name, "App");
    assert_eq!(
        returned.worktree_location,
        ProjectWorktreeLocation::RepoSibling
    );
    assert_eq!(
        returned.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );
    assert!(returned.confirm_completion_action);
    let settings = get_project_issue_source_settings_in_data_dir(data_dir.path(), created.id)
        .expect("settings");
    assert_eq!(settings.issue_source_mode, IssueSourceMode::Remote);
    assert_eq!(settings.issue_sync_label.as_deref(), Some("bug"));
}

#[test]
fn restoring_a_removed_project_overwrites_saved_issue_settings() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo_path = git_repo(&repos, "app");
    let created = ProjectService::create_project_in_data_dir(
        data_dir.path(),
        input(repo_path.clone(), remote_bug_source()),
    )
    .expect("create");
    ProjectService::remove_project_from_list_in_data_dir(data_dir.path(), created.id)
        .expect("remove");
    let validated =
        ProjectService::validate_project_repo_path_in_data_dir(data_dir.path(), &repo_path)
            .expect("validate");
    let matched = validated.existing_project.expect("matched removed project");
    assert!(matched.removed);
    assert_eq!(matched.issue_source_mode, IssueSourceMode::Remote);
    assert_eq!(matched.issue_sync_label.as_deref(), Some("bug"));
    assert_eq!(
        matched.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );

    let mut restored_input = input(
        repo_path,
        CreateProjectIssueSourceInput {
            issue_source_mode: Some(IssueSourceMode::Mixed),
            issue_sync_scope: Some(IssueSyncScope::AssignedToMe),
            issue_sync_enabled: Some(false),
            issue_sync_interval_seconds: Some(300),
            issue_writeback_close_on_complete: Some(false),
            issue_writeback_close_on_pr_merge: Some(true),
            issue_writeback_comment: Some(false),
            ..CreateProjectIssueSourceInput::default()
        },
    );
    restored_input.completion_action = Some(ProjectCompletionAction::MergeToBase);
    restored_input.confirm_completion_action = Some(false);
    restored_input.pr_draft = Some(true);
    let restored = ProjectService::create_project_in_data_dir(data_dir.path(), restored_input)
        .expect("restore");
    assert_eq!(restored.id, created.id);
    assert!(restored.removed_at.is_none());
    assert_eq!(
        restored.completion_action,
        ProjectCompletionAction::MergeToBase
    );
    assert!(!restored.confirm_completion_action);
    assert!(restored.pr_draft);
    let settings = get_project_issue_source_settings_in_data_dir(data_dir.path(), created.id)
        .expect("settings");
    assert_eq!(settings.issue_source_mode, IssueSourceMode::Mixed);
    assert_eq!(settings.issue_create_source.as_str(), "remote");
    assert_eq!(settings.issue_sync_scope, IssueSyncScope::AssignedToMe);
    assert!(!settings.issue_sync_enabled);
    assert_eq!(settings.issue_sync_interval_seconds, 300);
    assert!(!settings.issue_writeback_close_on_complete);
    assert!(settings.issue_writeback_close_on_pr_merge);
    assert!(!settings.issue_writeback_comment);
    let listed = ProjectService::list_projects_in_data_dir(data_dir.path()).expect("list");
    assert_eq!(listed.projects.len(), 1);
}

#[test]
fn a_blank_label_leaves_a_removed_project_removed() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo_path = git_repo(&repos, "app");
    let created = ProjectService::create_project_in_data_dir(
        data_dir.path(),
        input(repo_path.clone(), remote_bug_source()),
    )
    .expect("create");
    ProjectService::remove_project_from_list_in_data_dir(data_dir.path(), created.id)
        .expect("remove");
    let error = ProjectService::create_project_in_data_dir(
        data_dir.path(),
        input(
            repo_path,
            CreateProjectIssueSourceInput {
                issue_source_mode: Some(IssueSourceMode::Local),
                issue_sync_scope: Some(IssueSyncScope::Label),
                issue_sync_label: Some("   ".to_string()),
                ..CreateProjectIssueSourceInput::default()
            },
        ),
    )
    .expect_err("blank label");
    assert_eq!(error.reason.as_deref(), Some("issueSyncLabelRequired"));
    let connection = open_database(data_dir.path());
    let removed_at: Option<i64> = connection
        .query_row(
            "SELECT removed_at FROM projects WHERE id = ?1",
            [created.id],
            |row| row.get(0),
        )
        .expect("removed_at");
    assert!(removed_at.is_some());
    let settings = get_project_issue_source_settings_in_data_dir(data_dir.path(), created.id)
        .expect("settings");
    assert_eq!(settings.issue_source_mode, IssueSourceMode::Remote);
    let completion: String = connection
        .query_row(
            "SELECT completion_action FROM projects WHERE id = ?1",
            [created.id],
            |row| row.get(0),
        )
        .expect("completion");
    assert_eq!(completion, "open_pull_request");
    let listed = ProjectService::list_projects_in_data_dir(data_dir.path()).expect("list");
    assert!(listed.projects.is_empty());
}

#[test]
fn probing_a_connection_before_create_does_not_write_a_project_or_connection() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo_path = git_repo_with_origin(&repos, "app", "https://github.com/acme/app.git");
    let sample = CliAuthSample {
        installed: true,
        outcome: CliAuthOutcome::Finished {
            success: true,
            output: "Logged in to github.com account yujianjia (keyring)".to_string(),
        },
    };
    let validated = ProjectService::validate_project_repo_path_in_data_dir_with_probe(
        data_dir.path(),
        &repo_path,
        true,
        Some(sample),
    )
    .expect("probe");
    assert!(validated.existing_project.is_none());
    let connection = validated.connection.expect("probed connection");
    assert_eq!(connection.login.as_deref(), Some("yujianjia"));
    let database = open_database(data_dir.path());
    assert_eq!(count_rows(&database, "SELECT COUNT(*) FROM projects"), 0);
    assert_eq!(
        count_rows(&database, "SELECT COUNT(*) FROM project_forge_connections"),
        0
    );
}
