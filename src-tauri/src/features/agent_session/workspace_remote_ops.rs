//! 变更 Activity 工作区远端操作：pull / push / delete worktree。
//! 从 `workspace.rs` 拆出，避免继续胀大白名单主文件。

use std::path::{Path, PathBuf};

use crate::git::worktree::cleanup_worktree;
use crate::types::agent_session::AgentSessionStatus;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::session_workspace::ProjectWorkspaceInput;

use super::workspace::{
    canonical_workspace_root, list_code_workspace_roots, map_git_command_error,
    workspace_persistence_error, SessionWorkspaceService,
};

impl<'connection> SessionWorkspaceService<'connection> {
    /// 仅允许项目主 checkout 拉取。
    pub fn pull(&self, input: ProjectWorkspaceInput) -> Result<(), CommandError> {
        let root = self.require_project_root_for_remote_ops(&input)?;
        crate::git::remote::pull(&root).map_err(map_git_command_error)
    }

    /// 仅允许项目主 checkout 推送。
    pub fn push(&self, input: ProjectWorkspaceInput) -> Result<(), CommandError> {
        let root = self.require_project_root_for_remote_ops(&input)?;
        crate::git::remote::push(&root).map_err(map_git_command_error)
    }

    /// 删除 linked worktree（禁止主 checkout；running turn 拒绝）。
    pub fn delete_worktree(&self, input: ProjectWorkspaceInput) -> Result<(), CommandError> {
        let workspace_path = input.workspace_path.as_deref().ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Deleting a worktree requires a workspace path.",
            )
            .with_reason("worktreePathRequired")
        })?;

        let project = self
            .project_repository
            .find_by_id(input.project_id)
            .map_err(workspace_persistence_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(
                        ErrorDetail::new("Project").with_value("projectId", input.project_id),
                    )
            })?;

        let roots = list_code_workspace_roots(Path::new(&project.repo_path))?.roots;
        let target = roots.iter().find(|root| root.path == workspace_path).ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Code workspace not found.",
            )
            .with_reason("codeWorkspaceNotFound")
            .with_detail(
                ErrorDetail::new("WorkspaceRoot").with_value("path", workspace_path.to_string()),
            )
        })?;

        if target.is_project_root {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Cannot delete the project main checkout.",
            )
            .with_reason("cannotDeleteProjectRoot")
            .with_detail(
                ErrorDetail::new("WorkspaceRoot").with_value("path", workspace_path.to_string()),
            ));
        }

        let sessions = self
            .agent_session_repository
            .list_by_project_id(input.project_id)
            .map_err(workspace_persistence_error)?;
        let has_running_turn = sessions.iter().any(|session| {
            session.workspace_path.as_deref() == Some(workspace_path)
                && session.status == AgentSessionStatus::Running
                && session.is_turn_running
        });
        if has_running_turn {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "This workspace still has a running agent turn and cannot be deleted.",
            )
            .with_reason("worktreeHasRunningTurn")
            .with_detail(
                ErrorDetail::new("WorkspaceRoot").with_value("path", workspace_path.to_string()),
            ));
        }

        cleanup_worktree(&project.repo_path, workspace_path, &target.branch).map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Failed to delete worktree.",
            )
            .with_reason("worktreeDeleteFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

        Ok(())
    }


    pub(super) fn require_project_root_for_remote_ops(
        &self,
        input: &ProjectWorkspaceInput,
    ) -> Result<PathBuf, CommandError> {
        let project = self
            .project_repository
            .find_by_id(input.project_id)
            .map_err(workspace_persistence_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(
                        ErrorDetail::new("Project").with_value("projectId", input.project_id),
                    )
            })?;

        let roots = list_code_workspace_roots(Path::new(&project.repo_path))?.roots;
        let target = if let Some(workspace_path) = input.workspace_path.as_deref() {
            roots.iter().find(|root| root.path == workspace_path)
        } else {
            roots.iter().find(|root| root.is_project_root)
        }
        .ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Code workspace not found.",
            )
            .with_reason("codeWorkspaceNotFound")
            .with_detail(ErrorDetail::new("WorkspaceRoot").with_value(
                "path",
                input
                    .workspace_path
                    .clone()
                    .unwrap_or_else(|| project.repo_path.clone()),
            ))
        })?;

        if !target.is_project_root {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Pull and push are only allowed on the project main checkout.",
            )
            .with_reason("remoteOpsRequireProjectRoot")
            .with_detail(
                ErrorDetail::new("WorkspaceRoot").with_value("path", target.path.clone()),
            ));
        }

        canonical_workspace_root(&target.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::process::Command;

    use rusqlite::params;

    use crate::db::agent_session_repository::AgentSessionRepository;
    use crate::db::migrations::MigrationRunner;
    use crate::db::project_repository::ProjectRepository;

    #[test]
    fn delete_worktree_removes_directory_and_branch() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_root = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-del");
        fs::create_dir_all(&repo_root).expect("create repo dir");
        init_git_repo(&repo_root);
        fs::write(repo_root.join("README.md"), "base\n").expect("write");
        git(&repo_root, &["add", "README.md"]);
        git(&repo_root, &["commit", "-m", "base"]);
        git(&repo_root, &["branch", "-M", "main"]);
        git(
            &repo_root,
            &[
                "worktree",
                "add",
                "-b",
                "issue-del",
                worktree_path.to_string_lossy().as_ref(),
                "main",
            ],
        );

        let worktree_canonical = worktree_path
            .canonicalize()
            .expect("canonicalize worktree")
            .to_string_lossy()
            .to_string();
        let repo_canonical = repo_root
            .canonicalize()
            .expect("canonicalize repo")
            .to_string_lossy()
            .to_string();

        let connection = rusqlite::Connection::open_in_memory().expect("open db");
        MigrationRunner::default()
            .run(&connection)
            .expect("migrate");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'p1', ?1, 0, 0)",
                params![&repo_canonical],
            )
            .expect("insert project");

        let service = SessionWorkspaceService::new(
            ProjectRepository::new(&connection),
            AgentSessionRepository::new(&connection),
        );
        service
            .delete_worktree(ProjectWorkspaceInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(worktree_canonical.clone()),
                            limit: None,
                offset: None,
            })
            .expect("delete worktree");

        assert!(!Path::new(&worktree_canonical).exists());
        let branches = Command::new("git")
            .args(["branch", "--list", "issue-del"])
            .current_dir(&repo_root)
            .output()
            .expect("list branch");
        assert!(String::from_utf8_lossy(&branches.stdout).trim().is_empty());
    }

    #[test]
    fn delete_worktree_rejects_project_root() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_root = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_root).expect("create repo dir");
        init_git_repo(&repo_root);
        fs::write(repo_root.join("README.md"), "base\n").expect("write");
        git(&repo_root, &["add", "README.md"]);
        git(&repo_root, &["commit", "-m", "base"]);
        git(&repo_root, &["branch", "-M", "main"]);

        let repo_canonical = repo_root
            .canonicalize()
            .expect("canonicalize repo")
            .to_string_lossy()
            .to_string();

        let connection = rusqlite::Connection::open_in_memory().expect("open db");
        MigrationRunner::default()
            .run(&connection)
            .expect("migrate");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'p1', ?1, 0, 0)",
                params![&repo_canonical],
            )
            .expect("insert project");

        let service = SessionWorkspaceService::new(
            ProjectRepository::new(&connection),
            AgentSessionRepository::new(&connection),
        );
        let error = service
            .delete_worktree(ProjectWorkspaceInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(repo_canonical.clone()),
                            limit: None,
                offset: None,
            })
            .expect_err("should reject project root");
        assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
        assert_eq!(error.reason.as_deref(), Some("cannotDeleteProjectRoot"));
    }

    #[test]
    fn delete_worktree_rejects_running_turn() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_root = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-run");
        fs::create_dir_all(&repo_root).expect("create repo dir");
        init_git_repo(&repo_root);
        fs::write(repo_root.join("README.md"), "base\n").expect("write");
        git(&repo_root, &["add", "README.md"]);
        git(&repo_root, &["commit", "-m", "base"]);
        git(&repo_root, &["branch", "-M", "main"]);
        git(
            &repo_root,
            &[
                "worktree",
                "add",
                "-b",
                "issue-run",
                worktree_path.to_string_lossy().as_ref(),
                "main",
            ],
        );

        let worktree_canonical = worktree_path
            .canonicalize()
            .expect("canonicalize worktree")
            .to_string_lossy()
            .to_string();
        let repo_canonical = repo_root
            .canonicalize()
            .expect("canonicalize repo")
            .to_string_lossy()
            .to_string();

        let connection = rusqlite::Connection::open_in_memory().expect("open db");
        MigrationRunner::default()
            .run(&connection)
            .expect("migrate");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'p1', ?1, 0, 0)",
                params![&repo_canonical],
            )
            .expect("insert project");
        connection
            .execute(
                "INSERT INTO agent_profiles (
                   id, name, agent_type, command, scope, project_id, mode, dangerous,
                   default_skill, prompt_template, del
                 ) VALUES (
                   100, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1,
                   '', '', 0
                 )",
                [],
            )
            .expect("insert profile");
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, number, agent_profile_id, status, attention,
                   working_dir, command_snapshot, prompt_snapshot, log_path,
                   last_active_at, started_at, workspace_path, workspace_branch,
                   is_turn_running, del
                 ) VALUES (
                   1, 1, 1, 100, 'running', 'none',
                   ?1, 'codex', '', '/tmp/s.log',
                   1000, 1000, ?1, 'issue-run',
                   1, 0
                 )",
                params![&worktree_canonical],
            )
            .expect("insert running session");

        let service = SessionWorkspaceService::new(
            ProjectRepository::new(&connection),
            AgentSessionRepository::new(&connection),
        );
        let error = service
            .delete_worktree(ProjectWorkspaceInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(worktree_canonical.clone()),
                            limit: None,
                offset: None,
            })
            .expect_err("should reject running turn");
        assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
        assert_eq!(error.reason.as_deref(), Some("worktreeHasRunningTurn"));
        assert!(Path::new(&worktree_canonical).exists());
    }

    #[test]
    fn pull_rejects_linked_worktree() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_root = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-pull");
        fs::create_dir_all(&repo_root).expect("create repo dir");
        init_git_repo(&repo_root);
        fs::write(repo_root.join("README.md"), "base\n").expect("write");
        git(&repo_root, &["add", "README.md"]);
        git(&repo_root, &["commit", "-m", "base"]);
        git(&repo_root, &["branch", "-M", "main"]);
        git(
            &repo_root,
            &[
                "worktree",
                "add",
                "-b",
                "issue-pull",
                worktree_path.to_string_lossy().as_ref(),
                "main",
            ],
        );

        let worktree_canonical = worktree_path
            .canonicalize()
            .expect("canonicalize worktree")
            .to_string_lossy()
            .to_string();
        let repo_canonical = repo_root
            .canonicalize()
            .expect("canonicalize repo")
            .to_string_lossy()
            .to_string();

        let connection = rusqlite::Connection::open_in_memory().expect("open db");
        MigrationRunner::default()
            .run(&connection)
            .expect("migrate");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'p1', ?1, 0, 0)",
                params![&repo_canonical],
            )
            .expect("insert project");

        let service = SessionWorkspaceService::new(
            ProjectRepository::new(&connection),
            AgentSessionRepository::new(&connection),
        );
        let error = service
            .pull(ProjectWorkspaceInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(worktree_canonical),
                            limit: None,
                offset: None,
            })
            .expect_err("pull should reject worktree");
        assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
        assert_eq!(error.reason.as_deref(), Some("remoteOpsRequireProjectRoot"));
    }

    fn init_git_repo(root: &Path) {
        git(root, &["init"]);
        git(root, &["config", "user.email", "test@example.com"]);
        git(root, &["config", "user.name", "Test User"]);
    }

    fn git(root: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
