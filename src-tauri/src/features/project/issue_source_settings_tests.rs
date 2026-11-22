use std::fs;
use std::process::Command;

use serde_json::{json, Value};
use tempfile::TempDir;

use crate::db::connection::DATABASE_FILE_NAME;
use crate::db::issue_repository::IssueRepository;
use crate::features::issue::{create_in_data_dir_with_forge, open_issue, FixedForge, IssueService};
use crate::features::project::issue_source::{
    get_project_issue_source_settings_in_data_dir, update_project_issue_source_settings_in_data_dir,
};
use crate::features::project::issue_source::{
    inspect_project_issue_connection_with_sample, CliAuthOutcome, CliAuthSample,
};
use crate::features::project::ProjectService;
use crate::types::errors::CommandErrorCode;
use crate::types::issue::CreateIssueInput;
use crate::types::project::{
    CreateProjectInput, CreateProjectIssueSourceInput, ProjectCompletionAction, ProjectPrTarget,
    ProjectWorktreeLocation,
};
use crate::types::project_issue_source::{
    ForgeAuthStatus, ForgeProvider, IssueSourceMode, UpdateProjectIssueSourceSettingsInput,
};

const TOKEN_LINE: &str = "token: ghp_secretvalue";

pub(super) fn git_repo(root: &TempDir, name: &str, origin: &str) -> String {
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

pub(super) fn create_project(data_dir: &std::path::Path, repo_path: String) -> i64 {
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
            issue_source: CreateProjectIssueSourceInput::default(),
        },
    )
    .expect("create project")
    .id
}

pub(super) fn input_from(value: Value) -> UpdateProjectIssueSourceSettingsInput {
    serde_json::from_value(value).expect("settings input")
}

fn sample(installed: bool, outcome: CliAuthOutcome) -> CliAuthSample {
    CliAuthSample { installed, outcome }
}

fn finished(success: bool, output: &str) -> CliAuthOutcome {
    CliAuthOutcome::Finished {
        success,
        output: output.to_string(),
    }
}

#[cfg(test)]
#[path = "issue_source_settings_read_tests.rs"]
mod read_tests;

#[test]
fn update_project_issue_source_settings_keeps_omitted_sync_flag() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(&repos, "app", "git@github.com:acme/redwhisk.git");
    let project_id = create_project(data_dir.path(), repo);
    update_project_issue_source_settings_in_data_dir(
        data_dir.path(),
        input_from(json!({
            "projectId": project_id,
            "issueSyncEnabled": false
        })),
    )
    .expect("disable sync");

    let kept = update_project_issue_source_settings_in_data_dir(
        data_dir.path(),
        input_from(json!({
            "projectId": project_id,
            "issueSyncIntervalSeconds": 60
        })),
    )
    .expect("omit enabled");
    assert!(!kept.issue_sync_enabled);
    assert_eq!(kept.issue_sync_interval_seconds, 60);

    let disabled = update_project_issue_source_settings_in_data_dir(
        data_dir.path(),
        input_from(json!({
            "projectId": project_id,
            "issueSyncEnabled": false
        })),
    )
    .expect("explicit false");
    assert!(!disabled.issue_sync_enabled);
}

#[test]
fn update_project_issue_source_settings_rejects_invalid_values_without_writing() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(&repos, "app", "git@github.com:acme/redwhisk.git");
    let project_id = create_project(data_dir.path(), repo);
    let before =
        get_project_issue_source_settings_in_data_dir(data_dir.path(), project_id).expect("before");

    for (payload, reason) in [
        (
            json!({"projectId": project_id, "issueSourceMode": "nope"}),
            "issueSourceModeInvalid",
        ),
        (
            json!({"projectId": project_id, "issueSyncScope": "mine"}),
            "issueSyncScopeInvalid",
        ),
        (
            json!({"projectId": project_id, "issueSyncIntervalSeconds": 59}),
            "issueSyncIntervalInvalid",
        ),
        (
            json!({"projectId": project_id, "issueSyncScope": "label", "issueSyncLabel": "   "}),
            "issueSyncLabelRequired",
        ),
        (
            json!({"projectId": project_id, "issueSyncEnabled": "no"}),
            "issueSourceSettingsInvalid",
        ),
    ] {
        let error =
            update_project_issue_source_settings_in_data_dir(data_dir.path(), input_from(payload))
                .expect_err(reason);
        assert_eq!(error.code, CommandErrorCode::ProjectValidationFailed);
        assert_eq!(error.reason.as_deref(), Some(reason));
    }

    let missing = update_project_issue_source_settings_in_data_dir(
        data_dir.path(),
        input_from(json!({"projectId": 404, "issueSourceMode": "remote"})),
    )
    .expect_err("missing project");
    assert_eq!(missing.code, CommandErrorCode::ProjectNotFound);
    let after =
        get_project_issue_source_settings_in_data_dir(data_dir.path(), project_id).expect("after");
    assert_eq!(after, before);
}

#[test]
fn inspect_project_issue_connection_returns_not_found() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(&repos, "app", "git@github.com:acme/redwhisk.git");
    let _project_id = create_project(data_dir.path(), repo);

    let missing = inspect_project_issue_connection_with_sample(
        data_dir.path(),
        404,
        sample(false, finished(false, "missing")),
    )
    .expect_err("missing project");

    assert_eq!(missing.code, CommandErrorCode::ProjectNotFound);
    let connection =
        rusqlite::Connection::open(data_dir.path().join(DATABASE_FILE_NAME)).expect("open db");
    let rows: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM project_forge_connections",
            [],
            |row| row.get(0),
        )
        .expect("connection rows");
    assert_eq!(rows, 0);
}

#[test]
fn inspect_project_issue_connection_classifies_cli_and_repo_samples() {
    let cases = [
        (
            "git@github.com:acme/redwhisk.git",
            sample(false, finished(false, "missing")),
            ForgeAuthStatus::CliMissing,
            Some(ForgeProvider::Github),
            Some("https://github.com"),
            Some("acme/redwhisk"),
            None,
        ),
        (
            "git@github.com:acme/redwhisk.git",
            sample(true, finished(false, "You are not logged in")),
            ForgeAuthStatus::Unauthenticated,
            Some(ForgeProvider::Github),
            Some("https://github.com"),
            Some("acme/redwhisk"),
            None,
        ),
        (
            "git@github.com:acme/redwhisk.git",
            sample(true, finished(false, "refresh token Expired")),
            ForgeAuthStatus::Expired,
            Some(ForgeProvider::Github),
            Some("https://github.com"),
            Some("acme/redwhisk"),
            None,
        ),
        (
            "https://bitbucket.org/acme/redwhisk.git",
            sample(
                true,
                finished(true, "Logged in to github.com account yujianjia (keyring)"),
            ),
            ForgeAuthStatus::NotForge,
            None,
            None,
            None,
            None,
        ),
        (
            "git@github.com:acme/redwhisk.git",
            sample(
                true,
                finished(
                    true,
                    "Logged in to github.com account yujianjia (keyring)\ntoken: ghp_secretvalue",
                ),
            ),
            ForgeAuthStatus::Ready,
            Some(ForgeProvider::Github),
            Some("https://github.com"),
            Some("acme/redwhisk"),
            Some("yujianjia"),
        ),
    ];

    for (index, (origin, probe, status, provider, host_url, repo_path, login)) in
        cases.into_iter().enumerate()
    {
        let data_dir = TempDir::new().expect("data dir");
        let repos = TempDir::new().expect("repos");
        let repo = git_repo(&repos, &format!("app-{index}"), origin);
        let project_id = create_project(data_dir.path(), repo);
        let settings =
            inspect_project_issue_connection_with_sample(data_dir.path(), project_id, probe)
                .expect("inspect");
        assert_eq!(settings.connection.auth_status, status, "{origin}");
        assert_eq!(settings.connection.provider, provider);
        assert_eq!(settings.connection.host_url.as_deref(), host_url);
        assert_eq!(settings.connection.repo_path.as_deref(), repo_path);
        assert_eq!(settings.connection.login.as_deref(), login);
        let rendered = serde_json::to_string(&settings).expect("json");
        assert!(!rendered.contains("ghp_secretvalue"), "{rendered}");

        let loaded = get_project_issue_source_settings_in_data_dir(data_dir.path(), project_id)
            .expect("get snapshot");
        assert_eq!(loaded.connection, settings.connection);
    }
}

#[test]
fn inspect_project_issue_connection_reads_gitlab_subgroup_login() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(
        &repos,
        "app",
        "https://gitlab.example.com/group/sub/repo.git",
    );
    let project_id = create_project(data_dir.path(), repo);
    let settings = inspect_project_issue_connection_with_sample(
        data_dir.path(),
        project_id,
        sample(
            true,
            finished(
                true,
                "Logged in to gitlab.com as yujianjia\ntoken: ghp_secretvalue",
            ),
        ),
    )
    .expect("inspect gitlab");
    assert_eq!(settings.connection.auth_status, ForgeAuthStatus::Ready);
    assert_eq!(settings.connection.provider, Some(ForgeProvider::Gitlab));
    assert_eq!(
        settings.connection.host_url.as_deref(),
        Some("https://gitlab.example.com")
    );
    assert_eq!(
        settings.connection.repo_path.as_deref(),
        Some("group/sub/repo")
    );
    assert_eq!(settings.connection.login.as_deref(), Some("yujianjia"));
    assert!(!serde_json::to_string(&settings)
        .expect("json")
        .contains(TOKEN_LINE));
}

#[test]
fn list_issues_hides_local_rows_in_remote_mode_without_deleting_them() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(&repos, "app", "git@github.com:acme/redwhisk.git");
    let project_id = create_project(data_dir.path(), repo);
    let created = IssueService::create_issue_in_data_dir(
        data_dir.path(),
        CreateIssueInput {
            project_id,
            title: "keep-title".to_string(),
            description: "body".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
        },
    )
    .expect("create issue");

    update_project_issue_source_settings_in_data_dir(
        data_dir.path(),
        input_from(json!({"projectId": project_id, "issueSourceMode": "remote"})),
    )
    .expect("remote mode");
    let listed = IssueService::list_issues_in_data_dir(data_dir.path(), project_id).expect("list");
    assert!(listed.issues.is_empty());
    let page = IssueService::list_issues_page_in_data_dir(
        data_dir.path(),
        project_id,
        None,
        Some(20),
        Some(0),
    )
    .expect("page");
    assert!(page.issues.is_empty());
    let per_status =
        IssueService::list_issues_per_status_in_data_dir(data_dir.path(), project_id, 20)
            .expect("per status");
    assert!(per_status.issues.is_empty());
    let totals = per_status.status_totals.expect("totals");
    assert_eq!(
        (
            totals.backlog,
            totals.running,
            totals.review,
            totals.completed
        ),
        (0, 0, 0, 0)
    );
    let connection =
        rusqlite::Connection::open(data_dir.path().join(DATABASE_FILE_NAME)).expect("open db");
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM issues", [], |row| row.get(0))
        .expect("count");
    assert_eq!(count, 1);
    let found = IssueRepository::new(&connection)
        .find_by_id(created.id)
        .expect("find")
        .expect("issue remains readable");
    assert_eq!(found.title, "keep-title");

    for mode in ["local", "mixed"] {
        update_project_issue_source_settings_in_data_dir(
            data_dir.path(),
            input_from(json!({"projectId": project_id, "issueSourceMode": mode})),
        )
        .expect(mode);
        let visible =
            IssueService::list_issues_in_data_dir(data_dir.path(), project_id).expect("visible");
        assert_eq!(visible.issues.len(), 1, "{mode}");
    }
}

#[test]
fn create_issue_rejects_remote_create_source_until_mode_returns_local() {
    let data_dir = TempDir::new().expect("data dir");
    let repos = TempDir::new().expect("repos");
    let repo = git_repo(&repos, "app", "git@github.com:acme/redwhisk.git");
    let project_id = create_project(data_dir.path(), repo);
    update_project_issue_source_settings_in_data_dir(
        data_dir.path(),
        input_from(json!({"projectId": project_id, "issueSourceMode": "remote"})),
    )
    .expect("remote mode");

    let error = IssueService::create_issue_in_data_dir(
        data_dir.path(),
        CreateIssueInput {
            project_id,
            title: "remote draft".to_string(),
            description: String::new(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
        },
    )
    .expect_err("remote create");
    assert_eq!(error.code, CommandErrorCode::ForgeUnavailable);
    assert_eq!(error.reason.as_deref(), Some("remoteCreateUnavailable"));
    let connection =
        rusqlite::Connection::open(data_dir.path().join(DATABASE_FILE_NAME)).expect("open db");
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM issues", [], |row| row.get(0))
        .expect("count");
    assert_eq!(count, 0);
    drop(connection);

    let connection =
        rusqlite::Connection::open(data_dir.path().join(DATABASE_FILE_NAME)).expect("ready db");
    connection
        .execute(
            "INSERT INTO project_forge_connections (
                project_id, provider, host_url, repo_path, login, auth_status,
                cli_installed, cli_authenticated, checked_at
             ) VALUES (?1, 'github', 'https://github.com/', 'acme/redwhisk', 'lin', 'ready', 1, 1, 1)",
            rusqlite::params![project_id],
        )
        .expect("ready connection");
    drop(connection);
    let forge = FixedForge::new(Vec::new()).with_created(open_issue(128, "remote draft"));
    let created = create_in_data_dir_with_forge(
        data_dir.path(),
        CreateIssueInput {
            project_id,
            title: "remote draft".to_string(),
            description: String::new(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
        },
        &forge,
    )
    .expect("ready remote create");
    let connection =
        rusqlite::Connection::open(data_dir.path().join(DATABASE_FILE_NAME)).expect("after remote");
    let remote_source: String = connection
        .query_row(
            "SELECT source FROM issues WHERE id = ?1",
            rusqlite::params![created.id],
            |row| row.get(0),
        )
        .expect("remote source");
    assert_eq!(remote_source, "remote");
}
