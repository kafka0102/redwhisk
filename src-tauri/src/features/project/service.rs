use std::path::{Path, PathBuf};

use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::git::repository::is_git_repository;
use crate::git::worktree::list_code_workspaces;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::project::{
    CreateProjectInput, OpenProjectInput, ProjectListItem, ProjectListResponse, ProjectPathStatus,
    ProjectSummary, ProjectWorktreeLocation, UpdateProjectSettingsInput,
    ValidateProjectRepoPathResponse,
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
        let validated_repo = validate_repo_path(&input.repo_path)?;
        let name = normalize_project_name(&input.name, &validated_repo.repo_path)?;
        validate_worktree_location(&validated_repo.repo_path, input.worktree_location)?;
        let repo_path = validated_repo.repo_path.to_string_lossy().to_string();
        let setup_command = input.worktree_setup_command.trim();

        if let Some(existing) = self
            .repository
            .find_by_repo_path_including_removed(&repo_path)
            .map_err(project_database_error)?
        {
            if existing.removed_at.is_some() {
                let project = self
                    .repository
                    .restore_removed_with_settings(
                        existing.id,
                        &name,
                        &repo_path,
                        input.worktree_location,
                        setup_command,
                    )
                    .map_err(project_database_error)?;
                return Ok(populate_code_workspaces(project));
            }
            return Ok(populate_code_workspaces(existing));
        }

        let project = self
            .repository
            .insert_or_get_existing_with_settings(
                &name,
                &repo_path,
                input.worktree_location,
                setup_command,
            )
            .map_err(project_database_error)?;
        Ok(populate_code_workspaces(project))
    }

    pub fn remove_project_from_list(&self, project_id: i64) -> Result<(), CommandError> {
        self.project_by_id(project_id)?;
        self.repository
            .mark_removed(project_id)
            .map_err(project_database_error)?;
        Ok(())
    }

    pub fn delete_project(&self, project_id: i64) -> Result<(), CommandError> {
        self.project_by_id(project_id)?;
        self.repository
            .delete_project(project_id)
            .map_err(project_database_error)?;
        Ok(())
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
        self.project_available_for_open(input.project_id)?;

        let project = self.repository
            .update_last_opened_at(input.project_id)
            .map_err(project_database_error)?;
        Ok(populate_code_workspaces(project))
    }

    pub fn open_project_for_window(
        &self,
        input: OpenProjectInput,
    ) -> Result<ProjectSummary, CommandError> {
        Ok(populate_code_workspaces(self.project_available_for_open(input.project_id)?))
    }

    pub fn update_project_settings(
        &self,
        input: UpdateProjectSettingsInput,
    ) -> Result<ProjectSummary, CommandError> {
        let validated_repo = validate_repo_path(&input.repo_path)?;
        let project_name = normalize_project_name(&input.name, &validated_repo.repo_path)?;
        validate_worktree_location(&validated_repo.repo_path, input.worktree_location)?;

        self.project_by_id(input.project_id)?;

        let project = self.repository
            .update_settings(
                input.project_id,
                &project_name,
                &validated_repo.repo_path.to_string_lossy(),
                input.worktree_location,
                input.worktree_setup_command.trim(),
            )
            .map_err(project_database_error)?;
        Ok(populate_code_workspaces(project))
    }

    pub fn validate_project_repo_path(
        repo_path: &str,
    ) -> Result<ValidateProjectRepoPathResponse, CommandError> {
        let validated_repo = validate_repo_path(repo_path)?;

        Ok(ValidateProjectRepoPathResponse {
            repo_path: validated_repo.repo_path.to_string_lossy().to_string(),
            suggested_name: validated_repo.suggested_name,
        })
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
                ).with_reason("saveFailed")
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            })?;

        let repository = ProjectRepository::new(&database.connection);
        ProjectService::new(repository).create_project(input)
    }

    pub fn list_projects_in_data_dir(
        data_dir: impl AsRef<Path>,
    ) -> Result<ProjectListResponse, CommandError> {
        let database = open_project_database(data_dir.as_ref())?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectService::new(repository).list_projects()
    }

    pub fn remove_project_from_list_in_data_dir(
        data_dir: impl AsRef<Path>,
        project_id: i64,
    ) -> Result<(), CommandError> {
        let database = open_project_database(data_dir.as_ref())?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectService::new(repository).remove_project_from_list(project_id)
    }

    pub fn delete_project_in_data_dir(
        data_dir: impl AsRef<Path>,
        project_id: i64,
    ) -> Result<(), CommandError> {
        let database = open_project_database(data_dir.as_ref())?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectService::new(repository).delete_project(project_id)
    }

    /// 打开项目热路径：路径校验、更新 last_opened、探测 code workspaces。
    /// 终端恢复由 command 层异步触发，避免阻塞工作台首屏。
    pub fn open_project_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: OpenProjectInput,
    ) -> Result<ProjectSummary, CommandError> {
        let database = open_project_database(data_dir.as_ref())?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectService::new(repository).open_project(input)
    }

    pub fn open_project_for_window_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: OpenProjectInput,
    ) -> Result<ProjectSummary, CommandError> {
        let database = open_project_database(data_dir.as_ref())?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectService::new(repository).open_project_for_window(input)
    }

    /// 轻量打开：仅校验项目可打开并返回记录（供 `open_project_window` 取标题用），
    /// 不做恢复终端 / worktree 探测 / 更新 last_opened —— 这些由新窗口启动后的 `open_project` 完成。
    pub fn project_for_window_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: OpenProjectInput,
    ) -> Result<ProjectSummary, CommandError> {
        let database = open_project_database(data_dir.as_ref())?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectService::new(repository).project_available_for_open(input.project_id)
    }

    pub fn update_project_settings_in_data_dir(
        data_dir: impl AsRef<Path>,
        input: UpdateProjectSettingsInput,
    ) -> Result<ProjectSummary, CommandError> {
        let database = open_project_database(data_dir)?;
        let repository = ProjectRepository::new(&database.connection);
        ProjectService::new(repository).update_project_settings(input)
    }

    fn project_by_id(&self, project_id: i64) -> Result<ProjectSummary, CommandError> {
        self.repository
            .find_by_id(project_id)
            .map_err(project_database_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            })
    }

    fn project_available_for_open(&self, project_id: i64) -> Result<ProjectSummary, CommandError> {
        let project = self.project_by_id(project_id)?;
        ensure_project_path_available(&project)?;
        Ok(project)
    }
}

struct ValidatedRepoPath {
    repo_path: PathBuf,
    suggested_name: String,
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
            ).with_reason("saveFailed")
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
        ).with_reason("pathInvalid"));
    }

    let repo_path = Path::new(trimmed).canonicalize().map_err(|error| {
        CommandError::new(
            CommandErrorCode::ProjectRepoPathInvalid,
            "Project 路径无效。",
        ).with_reason("pathInvalid")
        .with_detail(ErrorDetail::new("RepoPath").with_value("path", trimmed.to_string()))
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    if !repo_path.is_dir() {
        return Err(CommandError::new(
            CommandErrorCode::ProjectRepoPathInvalid,
            "Project 路径无效。",
        ).with_reason("pathInvalid")
        .with_detail(
            ErrorDetail::new("RepoPath")
                .with_value("path", repo_path.to_string_lossy().to_string()),
        ));
    }

    Ok(repo_path)
}

fn validate_repo_path(path: &str) -> Result<ValidatedRepoPath, CommandError> {
    let repo_path = normalize_repo_path(path)?;

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

    let suggested_name = repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::ProjectRepoPathInvalid,
                "Project 路径无效。",
            ).with_reason("pathInvalid")
            .with_detail(
                ErrorDetail::new("RepoPath")
                    .with_value("path", repo_path.to_string_lossy().to_string()),
            )
        })?
        .to_string();

    Ok(ValidatedRepoPath {
        repo_path,
        suggested_name,
    })
}

fn normalize_project_name(name: &str, repo_path: &Path) -> Result<String, CommandError> {
    let project_name = name.trim();
    if project_name.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::ProjectRepoPathInvalid,
            "Project 名称不能为空。",
        ).with_reason("nameRequired")
        .with_detail(
            ErrorDetail::new("RepoPath")
                .with_value("path", repo_path.to_string_lossy().to_string()),
        ));
    }

    Ok(project_name.to_string())
}

fn validate_worktree_location(
    repo_path: &Path,
    worktree_location: ProjectWorktreeLocation,
) -> Result<(), CommandError> {
    if worktree_location != ProjectWorktreeLocation::RepoInternal {
        return Ok(());
    }

    let gitignore_path = repo_path.join(".gitignore");
    let gitignore = std::fs::read_to_string(&gitignore_path).map_err(|_| {
        CommandError::new(
            CommandErrorCode::ProjectRepoPathInvalid,
            "选择仓库内 .worktrees 目录时，仓库必须包含 .gitignore。",
        ).with_reason("worktreesRequiresGitignore")
        .with_detail(
            ErrorDetail::new("RepoPath")
                .with_value("path", repo_path.to_string_lossy().to_string()),
        )
    })?;

    if gitignore.lines().any(is_worktree_gitignore_entry) {
        return Ok(());
    }

    Err(CommandError::new(
        CommandErrorCode::ProjectRepoPathInvalid,
        "选择仓库内 .worktrees 目录时，.gitignore 必须忽略 .worktrees/。",
    ).with_reason("worktreesMustBeIgnored")
    .with_detail(
        ErrorDetail::new("RepoPath").with_value("path", repo_path.to_string_lossy().to_string()),
    ))
}

fn is_worktree_gitignore_entry(line: &str) -> bool {
    let entry = line.trim();
    matches!(
        entry,
        ".worktrees"
            | ".worktrees/"
            | "/.worktrees"
            | "/.worktrees/"
            | ".worktree"
            | ".worktree/"
            | "/.worktree"
            | "/.worktree/"
    )
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
        worktree_location: project.worktree_location,
        worktree_setup_command: project.worktree_setup_command,
        created_at: project.created_at,
        last_opened_at: project.last_opened_at,
        path_status,
    }
}

fn populate_code_workspaces(mut project: ProjectSummary) -> ProjectSummary {
    // 项目记录可能早于 Git 初始化完成，或仓库后来被移动；保留项目可打开的既有语义。
    project.code_workspaces = list_code_workspaces(&project.repo_path).unwrap_or_default();
    project
}

fn ensure_project_path_available(project: &ProjectSummary) -> Result<(), CommandError> {
    if project_path_is_available(&project.repo_path) {
        return Ok(());
    }

    Err(CommandError::new(
        CommandErrorCode::ProjectRepoPathUnavailable,
        "Project 路径不存在或不可访问。",
    )
    .with_detail(ErrorDetail::new("Project").with_value("projectId", project.id))
    .with_detail(ErrorDetail::new("RepoPath").with_value("path", project.repo_path.clone())))
}

fn project_path_is_available(path: &str) -> bool {
    Path::new(path).is_dir()
}

fn project_database_error(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::ProjectPersistenceFailed,
        "Project 保存失败。",
    ).with_reason("saveFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
