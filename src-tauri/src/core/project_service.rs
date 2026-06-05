use std::path::{Path, PathBuf};

use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::git::repository::is_git_repository;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project::{
    CreateProjectInput, OpenProjectInput, ProjectListItem, ProjectListResponse, ProjectPathStatus,
    ProjectSummary,
};

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

    pub fn list_projects(&self) -> Result<ProjectListResponse, CommandError> {
        let projects = self
            .repository
            .list_recent()
            .map_err(project_database_error)?
            .into_iter()
            .map(project_list_item)
            .collect();

        Ok(ProjectListResponse { projects })
    }

    pub fn open_project(&self, input: OpenProjectInput) -> Result<ProjectSummary, CommandError> {
        self.project_available_for_open(&input.project_id)?;

        self.repository
            .update_last_opened_at(&input.project_id)
            .map_err(project_database_error)
    }

    pub fn open_project_for_window(
        &self,
        input: OpenProjectInput,
    ) -> Result<ProjectSummary, CommandError> {
        self.project_available_for_open(&input.project_id)
    }

    pub fn record_project_opened(&self, project_id: &str) -> Result<ProjectSummary, CommandError> {
        self.repository
            .update_last_opened_at(project_id)
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

    pub fn list_projects_in_data_dir(
        data_dir: impl AsRef<Path>,
    ) -> Result<ProjectListResponse, CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectService::new(repository).list_projects()
    }

    pub fn open_project_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: OpenProjectInput,
    ) -> Result<ProjectSummary, CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectService::new(repository).open_project(input)
    }

    pub fn open_project_for_window_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: OpenProjectInput,
    ) -> Result<ProjectSummary, CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectService::new(repository).open_project_for_window(input)
    }

    pub fn record_project_opened_in_data_dir(
        data_dir: impl AsRef<Path>,
        project_id: &str,
    ) -> Result<ProjectSummary, CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectService::new(repository).record_project_opened(project_id)
    }

    fn project_by_id(&self, project_id: &str) -> Result<ProjectSummary, CommandError> {
        self.repository
            .find_by_id(project_id)
            .map_err(project_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            })
    }

    fn project_available_for_open(&self, project_id: &str) -> Result<ProjectSummary, CommandError> {
        let project = self.project_by_id(project_id)?;
        ensure_project_path_available(&project)?;
        Ok(project)
    }
}

fn open_project_database(
    data_dir: impl AsRef<Path>,
) -> Result<crate::db::connection::Database, CommandError> {
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

    Ok(database)
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

fn project_list_item(project: ProjectSummary) -> ProjectListItem {
    let path_status = if project_path_is_available(&project.repo_path) {
        ProjectPathStatus::Available
    } else {
        ProjectPathStatus::Missing
    };

    ProjectListItem {
        id: project.id,
        name: project.name,
        repo_path: project.repo_path,
        created_at: project.created_at,
        last_opened_at: project.last_opened_at,
        path_status,
    }
}

fn ensure_project_path_available(project: &ProjectSummary) -> Result<(), CommandError> {
    if project_path_is_available(&project.repo_path) {
        return Ok(());
    }

    Err(CommandError::new(
        CommandErrorCode::ProjectRepoPathUnavailable,
        "Project 路径不存在或不可访问。",
    )
    .with_detail(ErrorDetail::new("Project").with_value("projectId", project.id.clone()))
    .with_detail(ErrorDetail::new("RepoPath").with_value("path", project.repo_path.clone())))
}

fn project_path_is_available(path: &str) -> bool {
    Path::new(path).is_dir()
}

fn project_database_error(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectPersistenceFailed,
        "Project 保存失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
