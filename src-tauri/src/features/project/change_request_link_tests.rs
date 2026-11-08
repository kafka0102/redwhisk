use std::fs;
use std::path::Path;
use std::process::Command;

use rusqlite::{params, Connection};
use tempfile::TempDir;

use super::{create_change_request_blocking, CreateChangeRequestInput};
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::features::change_request::list_project_change_requests;
use crate::git::command::with_interactive_path;
use crate::types::change_request::ChangeRequestLinkedIssue;

const CREATED_URL: &str = "https://github.com/acme/redwhisk/pull/128";

#[test]
fn change_page_remote_issue_closes_that_number() {
    let fixture = LinkFixture::open();
    let created = fixture.create("Ship the flow", "remote", Some(128), Some(128));
    assert_eq!(created.url, CREATED_URL);
    assert!(
        fixture.body().contains("Closes #128"),
        "body was {}",
        fixture.body()
    );
    let links = fixture.links_for(128);
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].issue_id, 128);
    assert_eq!(links[0].link_kind, "closing");
}

#[test]
fn change_page_local_issue_is_manual_without_closing_keyword() {
    let fixture = LinkFixture::open();
    fixture.create("Ship the flow", "local", Some(12), None);
    let body = fixture.body();
    assert!(!body.contains("Closes #12"), "body was {body}");
    let links = fixture.links_for(12);
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].link_kind, "manual");
}

#[test]
fn change_page_without_link_adds_no_manual_association() {
    let fixture = LinkFixture::open();
    fixture.create("Ship the flow", "none", None, None);
    let links = fixture.all_links();
    assert!(
        links.iter().all(|link| link.link_kind != "manual"),
        "unexpected manual links: {links:?}"
    );
}

#[test]
fn create_change_request_rejects_unknown_host() {
    let temp = TempDir::new().expect("temp");
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).expect("repo");
    git(&repo, &["init", "-b", "feature"]);
    git(&repo, &["config", "user.email", "redwhisk@example.test"]);
    git(&repo, &["config", "user.name", "RedWhisk Test"]);
    fs::write(repo.join("base.txt"), "base\n").expect("file");
    git(&repo, &["add", "base.txt"]);
    git(&repo, &["commit", "-m", "initial"]);
    git(
        &repo,
        &[
            "remote",
            "add",
            "origin",
            "https://example.com/acme/redwhisk.git",
        ],
    );
    let data_dir = temp.path().join("data");
    seed_project(&data_dir, &repo, &[]);
    let error = create_change_request_blocking(
        data_dir,
        CreateChangeRequestInput {
            project_id: 1,
            workspace_path: repo.to_string_lossy().to_string(),
            base: "main".to_string(),
            title: "Ship".to_string(),
            body: "Ship the flow".to_string(),
            draft: false,
            link_mode: None,
            link_issue_id: None,
            remote_number: None,
        },
    )
    .expect_err("create_change_request");
    assert_eq!(error.reason.as_deref(), Some("forgeUnknown"));
}

struct LinkFixture {
    _temp: TempDir,
    data_dir: std::path::PathBuf,
    repo_path: String,
    command_path: std::ffi::OsString,
    body_path: std::path::PathBuf,
}

impl LinkFixture {
    fn open() -> Self {
        let temp = TempDir::new().expect("temp");
        let repo = temp.path().join("repo");
        fs::create_dir_all(&repo).expect("repo");
        git(&repo, &["init", "-b", "feature"]);
        git(&repo, &["config", "user.email", "redwhisk@example.test"]);
        git(&repo, &["config", "user.name", "RedWhisk Test"]);
        fs::write(repo.join("base.txt"), "base\n").expect("file");
        git(&repo, &["add", "base.txt"]);
        git(&repo, &["commit", "-m", "initial"]);
        git(
            &repo,
            &[
                "remote",
                "add",
                "origin",
                "https://github.com/acme/redwhisk.git",
            ],
        );
        let bin_dir = temp.path().join("bin");
        let body_path = temp.path().join("body.md");
        fs::create_dir_all(&bin_dir).expect("bin");
        write_executable(
            &bin_dir.join("git"),
            "#!/bin/sh\nif [ \"$1\" = \"push\" ]; then\n  exit 0\nfi\nexec /usr/bin/git \"$@\"\n",
        );
        let gh = format!(
            "#!/bin/sh\nprev=\nfor arg in \"$@\"; do\n  if [ \"$prev\" = \"--body-file\" ]; then\n    cp \"$arg\" '{body}'\n  fi\n  prev=\"$arg\"\ndone\nif [ \"$1\" = \"pr\" ] && [ \"$2\" = \"create\" ]; then\n  echo {url}\n  exit 0\nfi\nif [ \"$1\" = \"pr\" ] && [ \"$2\" = \"list\" ]; then\n  echo '[]'\n  exit 0\nfi\necho \"unexpected gh $*\" >&2\nexit 1\n",
            body = body_path.display(),
            url = CREATED_URL,
        );
        write_executable(&bin_dir.join("gh"), &gh);
        let data_dir = temp.path().join("data");
        seed_project(&data_dir, &repo, &[12, 128]);
        let mut dirs = vec![bin_dir];
        if let Some(path) = std::env::var_os("PATH") {
            dirs.extend(std::env::split_paths(&path));
        }
        Self {
            _temp: temp,
            data_dir,
            repo_path: repo.to_string_lossy().to_string(),
            command_path: std::env::join_paths(dirs).expect("path"),
            body_path,
        }
    }

    fn create(
        &self,
        body: &str,
        mode: &str,
        issue_id: Option<i64>,
        remote_number: Option<i64>,
    ) -> super::CreateChangeRequestResponse {
        let data_dir = self.data_dir.clone();
        let repo_path = self.repo_path.clone();
        let command_path = self.command_path.clone();
        let body = body.to_string();
        let mode = mode.to_string();
        with_interactive_path(Some(command_path), || {
            create_change_request_blocking(
                data_dir,
                CreateChangeRequestInput {
                    project_id: 1,
                    workspace_path: repo_path,
                    base: "main".to_string(),
                    title: "Ship".to_string(),
                    body,
                    draft: false,
                    link_mode: Some(mode),
                    link_issue_id: issue_id,
                    remote_number,
                },
            )
        })
        .expect("create_change_request")
    }

    fn body(&self) -> String {
        fs::read_to_string(&self.body_path).unwrap_or_default()
    }

    fn links_for(&self, issue_id: i64) -> Vec<ChangeRequestLinkedIssue> {
        self.all_links()
            .into_iter()
            .filter(|link| link.issue_id == issue_id)
            .collect()
    }

    fn all_links(&self) -> Vec<ChangeRequestLinkedIssue> {
        let connection = Connection::open(self.data_dir.join("redwhisk.sqlite3")).expect("db");
        let listed = list_project_change_requests(&connection, 1, "all_open", "").expect("list");
        listed
            .rows
            .into_iter()
            .filter(|row| row.url == CREATED_URL)
            .flat_map(|row| row.linked_issues)
            .collect()
    }
}

fn seed_project(data_dir: &Path, repo: &Path, issue_numbers: &[i64]) {
    let database = DatabaseConfig::new(data_dir).open().expect("open db");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrate");
    let repo_path = repo.to_string_lossy().to_string();
    database
        .connection
        .execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (1, 'RedWhisk', ?1, 1, 1)",
            params![repo_path],
        )
        .expect("project");
    for number in issue_numbers {
        let source = if *number == 12 { "local" } else { "remote" };
        database
            .connection
            .execute(
                "INSERT INTO issues (
                    id, project_id, number, title, description, status, source, created_at,
                    updated_at, status_changed_at, del
                 ) VALUES (?1, 1, ?1, 'Issue', 'body', 'backlog', ?2, 10, 20, 20, 0)",
                params![number, source],
            )
            .expect("issue");
    }
}

fn git(repo: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .expect("git");
    assert!(
        output.status.success(),
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn write_executable(path: &Path, body: &str) {
    fs::write(path, body).expect("write");
    let mut permissions = fs::metadata(path).expect("meta").permissions();
    use std::os::unix::fs::PermissionsExt;
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).expect("chmod");
}
