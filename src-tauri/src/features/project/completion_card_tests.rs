use std::fs;
use std::process::Command;

use tempfile::TempDir;

use crate::db::connection::DATABASE_FILE_NAME;
use crate::features::project::ProjectService;
use crate::types::errors::CommandErrorCode;
use crate::types::project::{
    CreateProjectInput, CreateProjectIssueSourceInput, ProjectCompletionAction, ProjectPrTarget,
    ProjectWorktreeLocation,
};

fn git_repo(root: &TempDir, name: &str) -> String {
    let path = root.path().join(name);
    fs::create_dir_all(&path).expect("repo dir");
    assert!(Command::new("git")
        .arg("init")
        .arg(&path)
        .status()
        .expect("git init")
        .success());
    path.to_string_lossy().to_string()
}

fn add_origin(repo: &str, origin: &str) {
    assert!(Command::new("git")
        .args(["-C", repo, "remote", "add", "origin", origin])
        .status()
        .expect("git remote add")
        .success());
}

fn point_origin_head(repo: &str, branch: &str) {
    let target = format!("refs/remotes/origin/{branch}");
    assert!(Command::new("git")
        .args([
            "-C",
            repo,
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            &target
        ])
        .status()
        .expect("symbolic-ref")
        .success());
}

fn create_project(
    data_dir: &std::path::Path,
    repo_path: String,
    action: ProjectCompletionAction,
    target: ProjectPrTarget,
    draft: bool,
    confirm: bool,
) -> i64 {
    ProjectService::create_project_in_data_dir(
        data_dir,
        CreateProjectInput {
            name: "App".to_string(),
            repo_path,
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: String::new(),
            completion_action: Some(action),
            pr_target: Some(target),
            pr_draft: Some(draft),
            confirm_completion_action: Some(confirm),
            issue_source: CreateProjectIssueSourceInput::default(),
        },
    )
    .expect("create project")
    .id
}

fn forge_host(data_dir: &std::path::Path, project_id: i64) -> String {
    let connection =
        rusqlite::Connection::open(data_dir.join(DATABASE_FILE_NAME)).expect("open database");
    connection
        .query_row(
            "SELECT forge_host FROM projects WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .expect("read forge host")
}

#[test]
fn get_project_completion_card_reads_gitlab_remote_without_cli_fields() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(&repos, "app");
    add_origin(&repo, "git@gitlab.com:group/repo.git");
    point_origin_head(&repo, "main");
    let project_id = create_project(
        data_dir.path(),
        repo,
        ProjectCompletionAction::OpenPullRequest,
        ProjectPrTarget::RepoDefault,
        false,
        true,
    );
    let host_before = forge_host(data_dir.path(), project_id);

    let card = ProjectService::get_project_completion_card_in_data_dir(data_dir.path(), project_id)
        .expect("completion card");

    assert_eq!(card.host, "gitlab");
    assert_eq!(card.repo_default_branch.as_deref(), Some("main"));
    assert_eq!(
        card.completion_action,
        ProjectCompletionAction::OpenPullRequest
    );
    assert_eq!(card.pr_target, ProjectPrTarget::RepoDefault);
    assert!(!card.pr_draft);
    assert!(card.confirm_completion_action);
    let json = serde_json::to_value(&card).expect("card json");
    let object = json.as_object().expect("card object");
    assert!(object.get("cliInstalled").is_none());
    assert!(object.get("cliAuthenticated").is_none());
    assert_eq!(forge_host(data_dir.path(), project_id), host_before);
}

#[test]
fn get_project_completion_card_returns_saved_action_when_remote_is_missing() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(&repos, "app");
    let project_id = create_project(
        data_dir.path(),
        repo,
        ProjectCompletionAction::MergeToBase,
        ProjectPrTarget::IssueBase,
        true,
        false,
    );
    let host_before = forge_host(data_dir.path(), project_id);

    let card = ProjectService::get_project_completion_card_in_data_dir(data_dir.path(), project_id)
        .expect("completion card");

    assert_eq!(card.host, "none");
    assert_eq!(card.repo_default_branch, None);
    assert_eq!(card.completion_action, ProjectCompletionAction::MergeToBase);
    assert_eq!(forge_host(data_dir.path(), project_id), host_before);
}

#[test]
fn get_project_completion_card_returns_project_not_found() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(&repos, "app");
    let _project_id = create_project(
        data_dir.path(),
        repo,
        ProjectCompletionAction::MergeToBase,
        ProjectPrTarget::IssueBase,
        true,
        false,
    );

    let missing = ProjectService::get_project_completion_card_in_data_dir(data_dir.path(), 404)
        .expect_err("missing project");

    assert_eq!(missing.code, CommandErrorCode::ProjectNotFound);
}
