use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::params;

use super::host_attachment_body::{forget_host_upload, remember_host_upload};
use super::service::IssueService;
use crate::db::connection::Database;
use crate::db::issue_repository::IssueRepository;
use crate::db::project_repository::ProjectRepository;
use crate::types::issue::IssueAttachmentInput;

pub struct GithubProject {
    pub temp: tempfile::TempDir,
    pub database: Database,
    pub project_id: i64,
}

impl GithubProject {
    pub fn service(&self) -> IssueService<'_> {
        IssueService::new(
            IssueRepository::new(&self.database.connection),
            ProjectRepository::new(&self.database.connection),
        )
    }

    pub fn count(&self, table: &str) -> i64 {
        self.database
            .connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect(table)
    }
}

pub fn github_project(remote: bool, auth: &str) -> GithubProject {
    let temp = tempfile::tempdir().expect("temp");
    let database = super::archive::open_issue_database(temp.path()).expect("db");
    database
        .connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at)
             VALUES ('App', '/tmp/app', 1, 1)",
            [],
        )
        .expect("project");
    let project_id = database.connection.last_insert_rowid();
    database
        .connection
        .execute(
            "UPDATE projects
             SET issue_source_mode = 'mixed', issue_create_source = ?1
             WHERE id = ?2",
            params![if remote { "remote" } else { "local" }, project_id],
        )
        .expect("source");
    database
        .connection
        .execute(
            "INSERT INTO project_forge_connections (
                project_id, provider, host_url, repo_path, login, auth_status,
                cli_installed, cli_authenticated, checked_at
             ) VALUES (?1, 'github', 'https://github.com/', 'acme/redwhisk', 'octocat', ?2, 1, 1, 1)",
            params![project_id, auth],
        )
        .expect("connection");
    GithubProject {
        temp,
        database,
        project_id,
    }
}

pub fn lock_uploads() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|error| error.into_inner())
}

pub struct RememberedUpload {
    project_id: i64,
    token: String,
}

impl Drop for RememberedUpload {
    fn drop(&mut self) {
        forget_host_upload(self.project_id, &self.token);
    }
}

pub fn remember(project_id: i64, token: &str, markdown: &str) -> RememberedUpload {
    remember_host_upload(project_id, token, markdown);
    RememberedUpload {
        project_id,
        token: token.to_string(),
    }
}

pub fn bytes_file(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, bytes).expect("write");
    path
}

pub fn len_file(dir: &Path, name: &str, len: u64) -> PathBuf {
    let path = dir.join(name);
    let file = File::create(&path).expect("file");
    file.set_len(len).expect("len");
    path
}

pub fn attachment(path: &Path, token: &str, name: &str) -> IssueAttachmentInput {
    IssueAttachmentInput {
        attachment_id: None,
        temp_token: Some(token.to_string()),
        source_path: Some(path.to_string_lossy().to_string()),
        display_name: name.to_string(),
        mime_type: None,
    }
}
