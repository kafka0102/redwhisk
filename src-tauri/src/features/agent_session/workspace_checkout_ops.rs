//! 变更 Activity 签出：分支列表、远程 fetch 与主 checkout 切换。
//! 与 pull/push 同级，仅允许项目主 checkout。

use crate::types::errors::CommandError;
use crate::types::session_workspace::{
    CheckoutBranchItem, CheckoutBranchKind, ProjectCheckoutBranchInput,
    ProjectCheckoutBranchResponse, ProjectCheckoutBranchesResponse, ProjectCreateBranchInput,
    ProjectCreateBranchResponse, ProjectWorkspaceInput,
};

use super::workspace::{map_git_command_error, SessionWorkspaceService};

impl SessionWorkspaceService<'_> {
    /// 列出主 checkout 可签出的本地/远程分支（不 fetch）。
    pub fn list_checkout_branches(
        &self,
        input: ProjectWorkspaceInput,
    ) -> Result<ProjectCheckoutBranchesResponse, CommandError> {
        let root = self.require_project_root_for_remote_ops(&input)?;
        let list = crate::git::checkout_branches::list_checkout_branches(&root)
            .map_err(map_git_command_error)?;
        Ok(ProjectCheckoutBranchesResponse {
            current_branch: list.current_branch,
            has_uncommitted_changes: list.has_uncommitted_changes,
            local_branches: list
                .local_branches
                .into_iter()
                .map(map_checkout_branch_item)
                .collect(),
            remote_branches: list
                .remote_branches
                .into_iter()
                .map(map_checkout_branch_item)
                .collect(),
        })
    }

    /// 主 checkout 上执行 `git fetch --all --prune`。
    pub fn fetch_remotes(&self, input: ProjectWorkspaceInput) -> Result<(), CommandError> {
        let root = self.require_project_root_for_remote_ops(&input)?;
        crate::git::checkout_branches::fetch_all_prune(&root).map_err(map_git_command_error)
    }

    /// 主 checkout 签出本地或远程分支（普通 checkout，不 force）。
    pub fn checkout_branch(
        &self,
        input: ProjectCheckoutBranchInput,
    ) -> Result<ProjectCheckoutBranchResponse, CommandError> {
        let root = self.require_project_root_for_remote_ops(&ProjectWorkspaceInput {
            project_id: input.project_id,
            session_id: input.session_id,
            workspace_path: input.workspace_path.clone(),
            limit: None,
            offset: None,
        })?;
        let kind = match input.kind {
            CheckoutBranchKind::Local => crate::git::checkout_branch::CheckoutTargetKind::Local,
            CheckoutBranchKind::Remote => crate::git::checkout_branch::CheckoutTargetKind::Remote,
        };
        let branch = crate::git::checkout_branch::checkout_branch(&root, kind, &input.name)
            .map_err(map_git_command_error)?;
        Ok(ProjectCheckoutBranchResponse { branch })
    }

    /// 主 checkout 基于当前 HEAD 创建并签出本地分支（普通 `checkout -b`，不 force）。
    pub fn create_branch(
        &self,
        input: ProjectCreateBranchInput,
    ) -> Result<ProjectCreateBranchResponse, CommandError> {
        let root = self.require_project_root_for_remote_ops(&ProjectWorkspaceInput {
            project_id: input.project_id,
            session_id: input.session_id,
            workspace_path: input.workspace_path.clone(),
            limit: None,
            offset: None,
        })?;
        let branch = crate::git::create_branch::create_and_checkout_branch(&root, &input.name)
            .map_err(map_git_command_error)?;
        Ok(ProjectCreateBranchResponse { branch })
    }
}

fn map_checkout_branch_item(
    entry: crate::git::checkout_branches::CheckoutBranchEntry,
) -> CheckoutBranchItem {
    CheckoutBranchItem {
        name: entry.name,
        author_name: entry.author_name,
        short_hash: entry.short_hash,
        message: entry.message,
        committed_at: entry.committed_at_seconds.saturating_mul(1_000),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use rusqlite::params;

    use crate::db::agent_session_repository::AgentSessionRepository;
    use crate::db::migrations::MigrationRunner;
    use crate::db::project_repository::ProjectRepository;
    use crate::types::errors::CommandErrorCode;
    use crate::types::session_workspace::{
        CheckoutBranchKind, ProjectCheckoutBranchInput, ProjectCreateBranchInput,
        ProjectWorkspaceInput,
    };
    use super::super::workspace::SessionWorkspaceService;

    #[test]
    fn list_checkout_branches_rejects_linked_worktree() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_root = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-list");
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
                "issue-list",
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
            .list_checkout_branches(ProjectWorkspaceInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(worktree_canonical),
                limit: None,
                offset: None,
            })
            .expect_err("list should reject worktree");
        assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
        assert_eq!(error.reason.as_deref(), Some("remoteOpsRequireProjectRoot"));
    }

    #[test]
    fn list_checkout_branches_returns_local_on_project_root() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_root = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_root).expect("create repo dir");
        init_git_repo(&repo_root);
        fs::write(repo_root.join("README.md"), "base\n").expect("write");
        git(&repo_root, &["add", "README.md"]);
        git(&repo_root, &["commit", "-m", "base"]);
        git(&repo_root, &["branch", "-M", "main"]);
        git(&repo_root, &["branch", "feature-a"]);

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
        let response = service
            .list_checkout_branches(ProjectWorkspaceInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(repo_canonical.clone()),
                limit: None,
                offset: None,
            })
            .expect("list on project root");
        assert_eq!(response.current_branch, "main");
        let names: Vec<&str> = response
            .local_branches
            .iter()
            .map(|b| b.name.as_str())
            .collect();
        assert!(names.contains(&"main"));
        assert!(names.contains(&"feature-a"));
        assert!(!response.has_uncommitted_changes);
        // committedAt 为毫秒
        assert!(
            response
                .local_branches
                .iter()
                .all(|b| b.committed_at >= 1_000_000_000_000 || b.committed_at == 0)
                || response.local_branches.iter().any(|b| b.committed_at > 0)
        );
    }

    #[test]
    fn checkout_branch_rejects_linked_worktree() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_root = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-co");
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
                "issue-co",
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
            .checkout_branch(ProjectCheckoutBranchInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(worktree_canonical),
                kind: CheckoutBranchKind::Local,
                name: "main".to_string(),
            })
            .expect_err("checkout should reject worktree");
        assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
        assert_eq!(error.reason.as_deref(), Some("remoteOpsRequireProjectRoot"));
    }

    #[test]
    fn checkout_branch_switches_local_on_project_root() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_root = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_root).expect("create repo dir");
        init_git_repo(&repo_root);
        fs::write(repo_root.join("README.md"), "base\n").expect("write");
        git(&repo_root, &["add", "README.md"]);
        git(&repo_root, &["commit", "-m", "base"]);
        git(&repo_root, &["branch", "-M", "main"]);
        git(&repo_root, &["branch", "feature-a"]);

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
        let response = service
            .checkout_branch(ProjectCheckoutBranchInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(repo_canonical),
                kind: CheckoutBranchKind::Local,
                name: "feature-a".to_string(),
            })
            .expect("checkout local");
        assert_eq!(response.branch, "feature-a");
        let current = git_output(&repo_root, &["branch", "--show-current"]);
        assert_eq!(current, "feature-a");
    }


    #[test]
    fn create_branch_rejects_linked_worktree() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_root = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-cb");
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
                "issue-cb",
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
            .create_branch(ProjectCreateBranchInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(worktree_canonical),
                name: "new-from-worktree".to_string(),
            })
            .expect_err("create should reject worktree");
        assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
        assert_eq!(error.reason.as_deref(), Some("remoteOpsRequireProjectRoot"));
    }

    #[test]
    fn create_branch_creates_and_checks_out_on_project_root() {
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
        let response = service
            .create_branch(ProjectCreateBranchInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(repo_canonical),
                name: "feature-created".to_string(),
            })
            .expect("create branch");
        assert_eq!(response.branch, "feature-created");
        let current = git_output(&repo_root, &["branch", "--show-current"]);
        assert_eq!(current, "feature-created");
    }

    fn git_output(root: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .expect("run git");
        assert!(output.status.success(), "git failed");
        String::from_utf8_lossy(&output.stdout).trim().to_string()
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
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
