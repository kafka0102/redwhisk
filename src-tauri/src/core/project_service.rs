use std::path::{Path, PathBuf};

use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::git::repository::is_git_repository;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project::{CreateProjectInput, ProjectSummary};

pub struct ProjectService<'connection> {
    repository: ProjectRepository<'connection>,
}

impl<'connection> ProjectService<'connection> {
    pub fn new(repository: ProjectRepository<'connection>) -> Self {
        Self { repository }
    }

    pub fn create_project(
        &self,
        input: CreateProjectInput,
    ) -> Result<ProjectSummary, CommandError> {
        let repo_path = normalize_repo_path(&input.repo_path)?;

        if !is_git_repository(&repo_path) {
            return Err(CommandError::new(
                CommandErrorCode::ProjectRepoNotGitRepository,
                "所选目录不是 Git Repository。",
            )
            .with_detail(
                ErrorDetail::new("RepoPath")
                    .with_value("path", repo_path.to_string_lossy().to_string()),
            ));
        }

        let name = repo_path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::ProjectRepoPathInvalid,
                    "Project 路径无效。",
                )
                .with_detail(
                    ErrorDetail::new("RepoPath")
                        .with_value("path", repo_path.to_string_lossy().to_string()),
                )
            })?;

        self.repository
            .insert_or_get_existing_generated_id(name, &repo_path)
            .map_err(project_database_error)
    }

    pub fn create_project_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: CreateProjectInput,
    ) -> Result<ProjectSummary, CommandError> {
        let database = DatabaseConfig::new(data_dir)
            .open()
            .map_err(CommandError::from)?;
        MigrationRunner::default()
            .run(&database.connection)
            .map_err(|error| {
                CommandError::new(
                    CommandErrorCode::ProjectPersistenceFailed,
                    "Project 保存失败。",
                )
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            })?;

        let repository = ProjectRepository::new(&database.connection);
        ProjectService::new(repository).create_project(input)
    }
}

fn normalize_repo_path(path: &str) -> Result<PathBuf, CommandError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::ProjectRepoPathInvalid,
            "Project 路径无效。",
        ));
    }

    let repo_path = Path::new(trimmed).canonicalize().map_err(|error| {
        CommandError::new(
            CommandErrorCode::ProjectRepoPathInvalid,
            "Project 路径无效。",
        )
        .with_detail(ErrorDetail::new("RepoPath").with_value("path", trimmed.to_string()))
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    if !repo_path.is_dir() {
        return Err(CommandError::new(
            CommandErrorCode::ProjectRepoPathInvalid,
            "Project 路径无效。",
        )
        .with_detail(
            ErrorDetail::new("RepoPath")
                .with_value("path", repo_path.to_string_lossy().to_string()),
        ));
    }

    Ok(repo_path)
}

fn project_database_error(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectPersistenceFailed,
        "Project 保存失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
