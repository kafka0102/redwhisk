//! 变更 Activity 合并分支：候选列表与把引用合入当前分支。
//! 与签出并列，仅允许项目主 checkout。

use crate::git::merge_branch::{
    MERGE_ABORTED_DUE_TO_CONFLICT, MERGE_REQUIRES_CLEAN_WORKTREE, MERGE_REQUIRES_CURRENT_BRANCH,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::session_workspace::{
    CheckoutBranchItem, ProjectCheckoutBranchesResponse, ProjectMergeBranchInput,
    ProjectMergeBranchResponse, ProjectWorkspaceInput,
};

use super::workspace::{map_git_command_error, SessionWorkspaceService};

impl SessionWorkspaceService<'_> {
    /// 列出主 checkout 可合并的本地/远程分支（不 fetch，不过滤占用中分支）。
    pub fn list_merge_branches(
        &self,
        input: ProjectWorkspaceInput,
    ) -> Result<ProjectCheckoutBranchesResponse, CommandError> {
        let root = self.require_project_root_for_remote_ops(&input)?;
        let list = crate::git::merge_branches::list_merge_branches(&root)
            .map_err(map_git_command_error)?;
        Ok(ProjectCheckoutBranchesResponse {
            current_branch: list.current_branch,
            has_uncommitted_changes: list.has_uncommitted_changes,
            local_branches: list
                .local_branches
                .into_iter()
                .map(map_merge_branch_item)
                .collect(),
            remote_branches: list
                .remote_branches
                .into_iter()
                .map(map_merge_branch_item)
                .collect(),
        })
    }

    /// 主 checkout 将指定引用合入当前分支（允许快进；不 force）。
    pub fn merge_branch(
        &self,
        input: ProjectMergeBranchInput,
    ) -> Result<ProjectMergeBranchResponse, CommandError> {
        let root = self.require_project_root_for_remote_ops(&ProjectWorkspaceInput {
            project_id: input.project_id,
            session_id: input.session_id,
            workspace_path: input.workspace_path.clone(),
            limit: None,
            offset: None,
        })?;
        let result = crate::git::merge_branch::merge_ref_into_current_branch(&root, &input.name)
            .map_err(map_merge_error)?;
        Ok(ProjectMergeBranchResponse {
            branch: result.branch,
            already_up_to_date: result.already_up_to_date,
        })
    }
}

fn map_merge_branch_item(
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

fn map_merge_error(error: crate::git::command::GitCommandError) -> CommandError {
    use crate::git::command::GitCommandError;

    if let GitCommandError::Failed { message, .. } = &error {
        if message == MERGE_REQUIRES_CLEAN_WORKTREE
            || message == MERGE_ABORTED_DUE_TO_CONFLICT
            || message == MERGE_REQUIRES_CURRENT_BRANCH
        {
            return CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                format!("Git command failed: {message}"),
            )
            .with_reason(message.clone())
            .with_detail(ErrorDetail::new("Cause").with_value("message", message.clone()));
        }
    }
    map_git_command_error(error)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use rusqlite::params;

    use super::super::workspace::SessionWorkspaceService;
    use crate::db::agent_session_repository::AgentSessionRepository;
    use crate::db::migrations::MigrationRunner;
    use crate::db::project_repository::ProjectRepository;
    use crate::types::errors::CommandErrorCode;
    use crate::types::session_workspace::{
        CheckoutBranchKind, ProjectMergeBranchInput, ProjectWorkspaceInput,
    };

    #[test]
    fn list_merge_branches_rejects_linked_worktree() {
        let env = setup_repo_with_worktree();
        let service = service_for_repo(&env.connection);
        let error = service
            .list_merge_branches(ProjectWorkspaceInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(env.worktree_canonical.clone()),
                limit: None,
                offset: None,
            })
            .expect_err("list should reject worktree");
        assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
        assert_eq!(error.reason.as_deref(), Some("remoteOpsRequireProjectRoot"));
    }

    #[test]
    fn list_merge_branches_includes_occupied_and_reserved_excludes_current() {
        let env = setup_repo_with_worktree();
        insert_open_redwhisk_session(&env.connection, &env.repo_canonical);
        let service = service_for_repo(&env.connection);
        let response = service
            .list_merge_branches(ProjectWorkspaceInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(env.repo_canonical.clone()),
                limit: None,
                offset: None,
            })
            .expect("list");
        let names: Vec<&str> = response
            .local_branches
            .iter()
            .map(|branch| branch.name.as_str())
            .collect();
        assert_eq!(response.current_branch, "main");
        assert!(
            !names.contains(&"main"),
            "current branch must be hidden: {names:?}"
        );
        assert!(
            names.contains(&"feature-occupied"),
            "occupied branch must remain: {names:?}"
        );
        assert!(
            names.contains(&"issue-1-redwhisk"),
            "reserved issue branch must remain: {names:?}"
        );
    }

    #[test]
    fn merge_branch_rejects_linked_worktree() {
        let env = setup_repo_with_worktree();
        let service = service_for_repo(&env.connection);
        let error = service
            .merge_branch(ProjectMergeBranchInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(env.worktree_canonical.clone()),
                kind: CheckoutBranchKind::Local,
                name: "feature-occupied".to_string(),
            })
            .expect_err("merge should reject worktree");
        assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
        assert_eq!(error.reason.as_deref(), Some("remoteOpsRequireProjectRoot"));
    }

    #[test]
    fn merge_branch_fast_forwards_on_project_root_without_switching() {
        let env = setup_repo_with_worktree();
        git(&env.repo_root, &["branch", "feature-ahead"]);
        git(&env.repo_root, &["checkout", "feature-ahead"]);
        write_commit(&env.repo_root, "ahead.txt", "ahead\n", "ahead tip");
        git(&env.repo_root, &["checkout", "main"]);
        let feature_tip = git_output(&env.repo_root, &["rev-parse", "feature-ahead"]);

        let service = service_for_repo(&env.connection);
        let response = service
            .merge_branch(ProjectMergeBranchInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(env.repo_canonical.clone()),
                kind: CheckoutBranchKind::Local,
                name: "feature-ahead".to_string(),
            })
            .expect("merge");
        assert_eq!(response.branch, "main");
        assert_eq!(
            git_output(&env.repo_root, &["branch", "--show-current"]),
            "main"
        );
        assert_eq!(
            git_output(&env.repo_root, &["rev-parse", "HEAD"]),
            feature_tip
        );
    }

    struct TestEnv {
        _temp_dir: tempfile::TempDir,
        repo_root: std::path::PathBuf,
        repo_canonical: String,
        worktree_canonical: String,
        connection: rusqlite::Connection,
    }

    fn setup_repo_with_worktree() -> TestEnv {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_root = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("feature-occupied");
        fs::create_dir_all(&repo_root).expect("create repo dir");
        init_git_repo(&repo_root);
        write_commit(&repo_root, "README.md", "base\n", "base");
        git(&repo_root, &["branch", "-M", "main"]);
        git(&repo_root, &["branch", "issue-1-redwhisk"]);
        git(
            &repo_root,
            &[
                "worktree",
                "add",
                "-b",
                "feature-occupied",
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
        TestEnv {
            _temp_dir: temp_dir,
            repo_root,
            repo_canonical,
            worktree_canonical,
            connection,
        }
    }

    fn insert_open_redwhisk_session(connection: &rusqlite::Connection, repo_canonical: &str) {
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
                "INSERT INTO issues (id, project_id, number, title, description, status, created_at, updated_at, del)
                 VALUES (1, 1, 1, 'open', '', 'running', 1, 1, 0)",
                [],
            )
            .expect("insert open issue");
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, number, issue_id, agent_profile_id, status, attention,
                   working_dir, command_snapshot, prompt_snapshot, workspace_mode,
                   workspace_branch, worktree_owner, log_path, last_active_at, started_at, del
                 ) VALUES (
                   1, 1, 1, 1, 100, 'running', 'none',
                   ?1, 'codex', '', 'worktree',
                   'issue-1-redwhisk', 'redwhisk', '/tmp/s1.log', 1, 1, 0
                 )",
                params![repo_canonical],
            )
            .expect("insert open session");
    }

    fn service_for_repo(connection: &rusqlite::Connection) -> SessionWorkspaceService<'_> {
        SessionWorkspaceService::new(
            ProjectRepository::new(connection),
            AgentSessionRepository::new(connection),
        )
    }

    fn write_commit(root: &Path, path: &str, contents: &str, message: &str) {
        fs::write(root.join(path), contents).expect("write");
        git(root, &["add", path]);
        git(root, &["commit", "-m", message]);
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
