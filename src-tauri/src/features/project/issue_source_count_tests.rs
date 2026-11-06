use std::fs;
use std::process::Command;

use rusqlite::params;
use tempfile::TempDir;

use crate::db::connection::DATABASE_FILE_NAME;
use crate::features::issue::IssueService;
use crate::features::project::issue_source::get_project_issue_source_settings_in_data_dir;
use crate::features::project::ProjectService;
use crate::types::issue::CreateIssueInput;
use crate::types::project::{
    CreateProjectInput, ProjectCompletionAction, ProjectPrTarget, ProjectWorktreeLocation,
};

#[test]
fn issue_source_counts_ignore_deleted_rows_and_the_current_mode() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(&repos, "app", "git@github.com:acme/redwhisk.git");
    let project_id = create_project(data_dir.path(), repo);
    let connection =
        rusqlite::Connection::open(data_dir.path().join(DATABASE_FILE_NAME)).expect("open db");
    connection
        .execute(
            "UPDATE projects SET issue_source_mode = 'remote' WHERE id = ?1",
            params![project_id],
        )
        .expect("remote mode");

    let empty =
        get_project_issue_source_settings_in_data_dir(data_dir.path(), project_id).expect("empty");
    assert_eq!(empty.local_issue_count, 0);
    assert_eq!(empty.remote_issue_count, 0);

    for number in 1..=6 {
        IssueService::create_issue_in_data_dir(
            data_dir.path(),
            CreateIssueInput {
                project_id,
                title: format!("issue {number}"),
                description: String::new(),
                attachments: Vec::new(),
                label_ids: Vec::new(),
            },
        )
        .expect("issue");
    }
    connection
        .execute(
            "UPDATE issues SET source = 'remote'
             WHERE project_id = ?1 AND id IN (
                SELECT id FROM issues WHERE project_id = ?1 ORDER BY id LIMIT 3
             )",
            params![project_id],
        )
        .expect("remote rows");
    connection
        .execute(
            "UPDATE issues SET del = 1
             WHERE project_id = ?1 AND id = (
                SELECT id FROM issues
                WHERE project_id = ?1 AND source = 'local'
                ORDER BY id LIMIT 1
             )",
            params![project_id],
        )
        .expect("deleted local");

    let settings =
        get_project_issue_source_settings_in_data_dir(data_dir.path(), project_id).expect("counts");
    assert_eq!(settings.issue_source_mode.as_str(), "remote");
    assert_eq!(settings.local_issue_count, 2);
    assert_eq!(settings.remote_issue_count, 3);
}

fn git_repo(root: &TempDir, name: &str, origin: &str) -> String {
    let path = root.path().join(name);
    fs::create_dir_all(&path).expect("repo dir");
    assert!(Command::new("git")
        .arg("init")
        .arg(&path)
        .status()
        .expect("git init")
        .success());
    assert!(Command::new("git")
        .args([
            "-C",
            path.to_str().expect("path"),
            "remote",
            "add",
            "origin",
            origin
        ])
        .status()
        .expect("git remote")
        .success());
    path.to_string_lossy().to_string()
}

fn create_project(data_dir: &std::path::Path, repo_path: String) -> i64 {
    ProjectService::create_project_in_data_dir(
        data_dir,
        CreateProjectInput {
            name: "App".to_string(),
            repo_path,
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: String::new(),
            completion_action: Some(ProjectCompletionAction::MergeToBase),
            pr_target: Some(ProjectPrTarget::RepoDefault),
            pr_draft: Some(true),
            confirm_completion_action: Some(false),
        },
    )
    .expect("create project")
    .id
}
