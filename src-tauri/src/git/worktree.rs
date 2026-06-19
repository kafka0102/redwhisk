use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitBranchInfo {
    pub current_branch: String,
    pub local_branches: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedWorktree {
    pub target_branch: String,
    pub workspace_branch: String,
    pub workspace_path: String,
    pub worktree_root_path: String,
}

#[derive(Debug, Error)]
pub enum GitWorktreeError {
    #[error("repo path is not an accessible directory: {0}")]
    InvalidRepoPath(String),
    #[error("git command failed for {command}: {message}")]
    GitCommandFailed { command: String, message: String },
    #[error("git command output for {command} was not utf8: {message}")]
    GitOutputInvalid { command: String, message: String },
    #[error("worktree root path could not be prepared: {0}")]
    WorktreeRootInvalid(String),
}

pub fn list_local_branches(repo_path: impl AsRef<Path>) -> Result<GitBranchInfo, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let current_branch = run_git(&repo_path, &["branch", "--show-current"])?;
    let output = run_git(
        &repo_path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )?;
    let mut local_branches = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    local_branches.sort();

    Ok(GitBranchInfo {
        current_branch,
        local_branches,
    })
}

pub fn create_worktree_for_issue(
    repo_path: impl AsRef<Path>,
    worktree_root_path: impl AsRef<Path>,
    issue_id: i64,
    target_branch: &str,
) -> Result<CreatedWorktree, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let worktree_root_path = prepare_worktree_root(worktree_root_path.as_ref())?;
    let workspace_branch = format!("issue-{}", issue_id);
    let workspace_path = unique_worktree_path(&worktree_root_path, issue_id);

    run_git(
        &repo_path,
        &[
            "worktree",
            "add",
            "-B",
            &workspace_branch,
            workspace_path.to_string_lossy().as_ref(),
            target_branch,
        ],
    )?;

    Ok(CreatedWorktree {
        target_branch: target_branch.to_string(),
        workspace_branch,
        workspace_path: workspace_path.to_string_lossy().to_string(),
        worktree_root_path: worktree_root_path.to_string_lossy().to_string(),
    })
}

pub fn is_branch_merged(
    repo_path: impl AsRef<Path>,
    base_branch: &str,
    merged_branch: &str,
) -> Result<bool, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let output = Command::new("git")
        .args(["merge-base", "--is-ancestor", merged_branch, base_branch])
        .current_dir(&repo_path)
        .output()
        .map_err(|error| GitWorktreeError::GitCommandFailed {
            command: "git merge-base --is-ancestor".to_string(),
            message: error.to_string(),
        })?;

    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(GitWorktreeError::GitCommandFailed {
            command: "git merge-base --is-ancestor".to_string(),
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        }),
    }
}

pub fn merge_branch_into_target(
    repo_path: impl AsRef<Path>,
    target_branch: &str,
    source_branch: &str,
) -> Result<String, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let original_branch = run_git(&repo_path, &["branch", "--show-current"])?;
    run_git(&repo_path, &["checkout", target_branch])?;
    let merge_result = run_git(
        &repo_path,
        &["merge", "--no-ff", "--no-edit", source_branch],
    );
    let checkout_back = run_git(&repo_path, &["checkout", &original_branch]);

    if let Err(error) = checkout_back {
        return Err(error);
    }

    merge_result.map(|_| original_branch)
}

pub fn cleanup_worktree(
    repo_path: impl AsRef<Path>,
    workspace_path: &str,
    workspace_branch: &str,
) -> Result<(), GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    run_git(
        &repo_path,
        &["worktree", "remove", "--force", workspace_path],
    )?;
    run_git(&repo_path, &["branch", "-D", workspace_branch])?;
    run_git(&repo_path, &["worktree", "prune"])?;
    Ok(())
}

fn ensure_repo_dir(repo_path: &Path) -> Result<PathBuf, GitWorktreeError> {
    if !repo_path.is_dir() {
        return Err(GitWorktreeError::InvalidRepoPath(
            repo_path.to_string_lossy().to_string(),
        ));
    }

    Ok(repo_path.to_path_buf())
}

fn prepare_worktree_root(path: &Path) -> Result<PathBuf, GitWorktreeError> {
    if path.exists() && !path.is_dir() {
        return Err(GitWorktreeError::WorktreeRootInvalid(
            path.to_string_lossy().to_string(),
        ));
    }
    fs::create_dir_all(path)
        .map_err(|_| GitWorktreeError::WorktreeRootInvalid(path.to_string_lossy().to_string()))?;
    Ok(path.to_path_buf())
}

fn unique_worktree_path(root: &Path, issue_id: i64) -> PathBuf {
    let primary = root.join(format!("issue-{issue_id}"));
    if !primary.exists() {
        return primary;
    }

    for suffix in 1..1000 {
        let candidate = root.join(format!("issue-{issue_id}-{suffix}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    root.join(format!("issue-{issue_id}-overflow"))
}

fn run_git(repo_path: &Path, args: &[&str]) -> Result<String, GitWorktreeError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|error| GitWorktreeError::GitCommandFailed {
            command: format_git_command(args),
            message: error.to_string(),
        })?;

    if !output.status.success() {
        return Err(GitWorktreeError::GitCommandFailed {
            command: format_git_command(args),
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    String::from_utf8(output.stdout)
        .map(|value| value.trim().to_string())
        .map_err(|error| GitWorktreeError::GitOutputInvalid {
            command: format_git_command(args),
            message: error.to_string(),
        })
}

fn format_git_command(args: &[&str]) -> String {
    format!("git {}", args.join(" "))
}
