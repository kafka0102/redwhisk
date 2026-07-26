use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::process::Command;

use thiserror::Error;

use crate::git::command::{self, GitCommandError};
use crate::types::session_workspace::CodeWorkspaceRoot;

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
    #[error("{role} worktree has uncommitted changes at {path}: {files}")]
    DirtyWorktree {
        role: GitWorktreeDirtyRole,
        path: String,
        files: String,
    },
    #[error("worktree root path could not be prepared: {0}")]
    WorktreeRootInvalid(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitWorktreeDirtyRole {
    Target,
    Workspace,
}

impl std::fmt::Display for GitWorktreeDirtyRole {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Target => formatter.write_str("target"),
            Self::Workspace => formatter.write_str("workspace"),
        }
    }
}

impl From<GitCommandError> for GitWorktreeError {
    fn from(error: GitCommandError) -> Self {
        match error {
            GitCommandError::Failed { command, message } => Self::GitCommandFailed { command, message },
            GitCommandError::OutputInvalid { command, message } => {
                Self::GitOutputInvalid { command, message }
            }
        }
    }
}

pub fn list_local_branches(repo_path: impl AsRef<Path>) -> Result<GitBranchInfo, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let current_branch = run_git(&repo_path, &["branch", "--show-current"])?;
    let worktree_branches = list_worktree_branches(&repo_path, &current_branch)?;
    let output = run_git(
        &repo_path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )?;
    let mut local_branches = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !worktree_branches.contains(*line))
        .filter(|line| !is_issue_worktree_branch(line))
        .map(str::to_string)
        .collect::<Vec<_>>();
    local_branches.sort();

    Ok(GitBranchInfo {
        current_branch,
        local_branches,
    })
}

pub fn list_code_workspaces(repo_path: impl AsRef<Path>) -> Result<Vec<CodeWorkspaceRoot>, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let project_root = repo_path.canonicalize().map_err(|error| {
        GitWorktreeError::InvalidRepoPath(format!("{}: {error}", repo_path.to_string_lossy()))
    })?;
    let output = run_git(&repo_path, &["worktree", "list", "--porcelain"])?;
    let mut roots = Vec::new();
    let mut workspace_path: Option<String> = None;
    let mut branch: Option<String> = None;

    let append_workspace = |roots: &mut Vec<CodeWorkspaceRoot>, workspace_path: &mut Option<String>, branch: &mut Option<String>| {
        let Some(path) = workspace_path.take() else { return; };
        let is_project_root = Path::new(&path).canonicalize().is_ok_and(|candidate| candidate == project_root);
        roots.push(CodeWorkspaceRoot {
            branch: branch.take().unwrap_or_else(|| "HEAD".to_string()),
            path,
            is_project_root,
        });
    };
    for line in output.lines().chain(std::iter::once("")) {
        if let Some(path) = line.strip_prefix("worktree ") { workspace_path = Some(path.to_string()); }
        else if let Some(value) = line.strip_prefix("branch refs/heads/") { branch = Some(value.to_string()); }
        else if line.is_empty() { append_workspace(&mut roots, &mut workspace_path, &mut branch); }
    }
    roots.sort_by(|left, right| right.is_project_root.cmp(&left.is_project_root).then_with(|| left.branch.cmp(&right.branch)));
    Ok(roots)
}

pub fn create_worktree_for_issue(
    repo_path: impl AsRef<Path>,
    worktree_root_path: impl AsRef<Path>,
    issue_number: i64,
    target_branch: &str,
) -> Result<CreatedWorktree, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let worktree_root_path = prepare_worktree_root(worktree_root_path.as_ref())?;
    let workspace_branch = crate::git::worktree_name::issue_worktree_base_name(issue_number, &repo_path);
    let workspace_path = unique_worktree_path(&worktree_root_path, &workspace_branch);

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

pub fn current_branch(repo_path: impl AsRef<Path>) -> Result<String, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    run_git(&repo_path, &["branch", "--show-current"])
}

pub fn is_additional_worktree(repo_path: impl AsRef<Path>) -> Result<bool, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let git_dir = run_git(
        &repo_path,
        &["rev-parse", "--path-format=absolute", "--git-dir"],
    )?;
    let git_common_dir = run_git(
        &repo_path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;

    Ok(git_dir != git_common_dir)
}

pub fn is_branch_merged(
    repo_path: impl AsRef<Path>,
    base_branch: &str,
    merged_branch: &str,
) -> Result<bool, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let output = command::run_git_raw(
        &repo_path,
        &["merge-base", "--is-ancestor", merged_branch, base_branch],
    )
    .map_err(map_ancestor_command_error)?;

    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(GitWorktreeError::GitCommandFailed {
            command: "git merge-base --is-ancestor".to_string(),
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        }),
    }
}

pub fn rebase_branch_onto(
    repo_path: impl AsRef<Path>,
    branch: &str,
    base_branch: &str,
) -> Result<(), GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    run_git(&repo_path, &["checkout", branch])?;
    if let Err(error) = run_git(&repo_path, &["rebase", base_branch]) {
        // 冲突/失败后必须 abort，避免 worktree 残留冲突文件与 rebase-in-progress。
        let _ = run_git(&repo_path, &["rebase", "--abort"]);
        return Err(error);
    }
    Ok(())
}

pub fn fast_forward_branch(
    repo_path: impl AsRef<Path>,
    target_branch: &str,
    source_branch: &str,
) -> Result<(), GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let original_branch = run_git(&repo_path, &["branch", "--show-current"])?;
    run_git(&repo_path, &["checkout", target_branch])?;
    let result = run_git(&repo_path, &["merge", "--ff-only", source_branch]);
    let _ = run_git(&repo_path, &["checkout", &original_branch]);
    result.map(|_| ())
}

pub fn rebase_and_fast_forward(
    repo_path: impl AsRef<Path>,
    worktree_path: impl AsRef<Path>,
    target_branch: &str,
    workspace_branch: &str,
) -> Result<(), GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let worktree_path = ensure_repo_dir(worktree_path.as_ref())?;
    ensure_clean_worktree(&repo_path, GitWorktreeDirtyRole::Target)?;
    ensure_clean_worktree(&worktree_path, GitWorktreeDirtyRole::Workspace)?;
    rebase_branch_onto(&worktree_path, workspace_branch, target_branch)?;
    ensure_clean_worktree(&repo_path, GitWorktreeDirtyRole::Target)?;
    fast_forward_branch(&repo_path, target_branch, workspace_branch)
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

    if let Err(error) = merge_result {
        let _ = run_git(&repo_path, &["checkout", &original_branch]);
        return Err(error);
    }

    run_git(&repo_path, &["checkout", &original_branch])?;
    Ok(original_branch)
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


/// 丢弃 worktree 工作区内未提交改动（tracked + untracked；不加 `-x`）。
///
/// 路径不存在时 no-op，与 `reconcile_worktree` 一致。
pub fn discard_worktree_changes(worktree_path: impl AsRef<Path>) -> Result<(), GitWorktreeError> {
    let worktree_path = worktree_path.as_ref();
    if !worktree_path.exists() {
        return Ok(());
    }
    let worktree_path = ensure_repo_dir(worktree_path)?;
    run_git(&worktree_path, &["reset", "--hard"])?;
    run_git(&worktree_path, &["clean", "-fd"])?;
    Ok(())
}

pub fn restore_worktree_for_branch(
    repo_path: impl AsRef<Path>,
    workspace_path: impl AsRef<Path>,
    workspace_branch: &str,
) -> Result<(), GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let workspace_path = workspace_path.as_ref();
    if workspace_path.is_dir() {
        return Ok(());
    }
    if workspace_path.exists() {
        return Err(GitWorktreeError::WorktreeRootInvalid(
            workspace_path.to_string_lossy().to_string(),
        ));
    }
    if let Some(parent) = workspace_path.parent() {
        prepare_worktree_root(parent)?;
    }

    run_git(&repo_path, &["worktree", "prune"])?;
    run_git(
        &repo_path,
        &[
            "worktree",
            "add",
            workspace_path.to_string_lossy().as_ref(),
            workspace_branch,
        ],
    )?;
    Ok(())
}


/// Narrow inputs for Worktree 对账（不含 owner 策略）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeReconcileRequest<'a> {
    pub repo_path: &'a Path,
    pub workspace_path: &'a Path,
    pub workspace_branch: &'a str,
    pub target_branch: &'a str,
}

/// 将 worktree 工作分支合入目标分支并清理 worktree（中性对账，不解读所有权）。
///
/// 当 workspace 路径不存在时视为 no-op（与历史完成流自由函数一致）。
pub fn reconcile_worktree(request: WorktreeReconcileRequest<'_>) -> Result<(), GitWorktreeError> {
    // 路径不存在时 no-op，与历史完成流自由函数一致；分支名为空则继续走 git（失败由调用方 block），不做静默成功。
    if !request.workspace_path.exists() {
        return Ok(());
    }

    rebase_and_fast_forward(
        request.repo_path,
        request.workspace_path,
        request.target_branch,
        request.workspace_branch,
    )?;
    cleanup_worktree(
        request.repo_path,
        request.workspace_path.to_string_lossy().as_ref(),
        request.workspace_branch,
    )?;
    Ok(())
}

/// 路径缺失时的 closed-out 评估结果（不含用户可见文案）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MissingWorktreeAssessment {
    /// 工作分支不存在，或已合入目标分支。
    ClosedOut,
    /// 工作分支仍在且尚未合入目标分支。
    NotMerged {
        workspace_branch: String,
        target_branch: String,
    },
}

/// 在 worktree 路径缺失场景下，评估工作分支是否可视为 closed-out（不存在或已合入目标分支）。
pub fn assess_missing_worktree(
    repo_path: impl AsRef<Path>,
    target_branch: &str,
    workspace_branch: &str,
) -> Result<MissingWorktreeAssessment, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    if !branch_exists(&repo_path, workspace_branch)? {
        return Ok(MissingWorktreeAssessment::ClosedOut);
    }
    if is_branch_merged(&repo_path, target_branch, workspace_branch)? {
        return Ok(MissingWorktreeAssessment::ClosedOut);
    }
    Ok(MissingWorktreeAssessment::NotMerged {
        workspace_branch: workspace_branch.to_string(),
        target_branch: target_branch.to_string(),
    })
}

/// merge / 对账失败的结构化分类（稳定 reason，无中文 message）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeBlockClassification {
    TargetDirty { path: String, files: String },
    WorkspaceDirty { path: String, files: String },
    MergeConflict,
    GitCommandFailed,
}

impl MergeBlockClassification {
    pub fn reason(&self) -> &'static str {
        match self {
            Self::TargetDirty { .. } => "target_worktree_dirty",
            Self::WorkspaceDirty { .. } => "workspace_worktree_dirty",
            Self::MergeConflict => "merge_conflict",
            Self::GitCommandFailed => "git_command_failed",
        }
    }
}

/// 将 [`GitWorktreeError`] 分类为稳定 merge-block reason + 结构字段。
pub fn classify_merge_block(error: &GitWorktreeError) -> MergeBlockClassification {
    match error {
        GitWorktreeError::DirtyWorktree { role, path, files } => match role {
            GitWorktreeDirtyRole::Target => MergeBlockClassification::TargetDirty {
                path: path.clone(),
                files: files.clone(),
            },
            GitWorktreeDirtyRole::Workspace => MergeBlockClassification::WorkspaceDirty {
                path: path.clone(),
                files: files.clone(),
            },
        },
        GitWorktreeError::GitCommandFailed { command, message }
            if is_likely_merge_conflict(command, message) =>
        {
            MergeBlockClassification::MergeConflict
        }
        _ => MergeBlockClassification::GitCommandFailed,
    }
}

fn is_likely_merge_conflict(command: &str, message: &str) -> bool {
    (command.contains(" rebase ") || command.contains(" merge "))
        && (message.contains("CONFLICT")
            || message.contains("could not apply")
            || message.contains("Automatic merge failed")
            || message.contains("fix conflicts"))
}

/// 实际路径上的 worktree / 漂移事实（不含路径来源优先级）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionPathFacts {
    pub in_worktree: bool,
    pub worktree_branch: Option<String>,
    pub drifted: bool,
}

/// 基于实际路径与启动快照计算 worktree/漂移事实。
pub fn inspect_execution_path(
    actual_path: &str,
    startup_path: &str,
) -> ExecutionPathFacts {
    if actual_path.trim().is_empty() {
        return ExecutionPathFacts {
            in_worktree: false,
            worktree_branch: None,
            drifted: false,
        };
    }

    let in_worktree = is_additional_worktree(actual_path).unwrap_or(false);
    let worktree_branch = if in_worktree {
        current_branch(actual_path).ok()
    } else {
        None
    };
    let drifted = in_worktree && actual_path != startup_path;

    ExecutionPathFacts {
        in_worktree,
        worktree_branch,
        drifted,
    }
}

/// 本地分支 `refs/heads/{branch}` 是否存在。
pub fn branch_exists(
    repo_path: impl AsRef<Path>,
    branch: &str,
) -> Result<bool, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let branch_ref = format!("refs/heads/{branch}");
    let output = command::run_git_raw(
        &repo_path,
        &["show-ref", "--verify", "--quiet", branch_ref.as_str()],
    )
    .map_err(GitWorktreeError::from)?;

    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(GitWorktreeError::GitCommandFailed {
            command: format!("git show-ref --verify --quiet {branch_ref}"),
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        }),
    }
}

fn list_worktree_branches(
    repo_path: &Path,
    current_branch: &str,
) -> Result<HashSet<String>, GitWorktreeError> {
    let output = run_git(repo_path, &["worktree", "list", "--porcelain"])?;
    let mut branches = HashSet::new();

    for line in output.lines().map(str::trim) {
        let Some(branch) = line.strip_prefix("branch refs/heads/") else {
            continue;
        };

        if branch != current_branch {
            branches.insert(branch.to_string());
        }
    }

    Ok(branches)
}

fn is_issue_worktree_branch(branch: &str) -> bool {
    branch
        .strip_prefix("issue-")
        .and_then(|suffix| suffix.chars().next())
        .is_some_and(|first| first.is_ascii_digit())
        || branch
            .strip_prefix("issue/")
            .and_then(|suffix| suffix.chars().next())
            .is_some_and(|first| first.is_ascii_digit())
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

fn ensure_clean_worktree(
    repo_path: &Path,
    role: GitWorktreeDirtyRole,
) -> Result<(), GitWorktreeError> {
    let output = run_git(repo_path, &["status", "--porcelain"])?;
    let files = output
        .lines()
        .map(format_status_line_path)
        .filter(|path| !path.is_empty())
        .take(10)
        .collect::<Vec<_>>();

    if files.is_empty() {
        return Ok(());
    }

    Err(GitWorktreeError::DirtyWorktree {
        role,
        path: repo_path.to_string_lossy().to_string(),
        files: files.join(", "),
    })
}

fn format_status_line_path(line: &str) -> String {
    line.get(3..).unwrap_or(line).trim().to_string()
}

fn unique_worktree_path(root: &Path, base_name: &str) -> PathBuf {
    let primary = root.join(base_name);
    if !primary.exists() {
        return primary;
    }

    for suffix in 1..1000 {
        let candidate = root.join(format!("{base_name}-{suffix}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    root.join(format!("{base_name}-overflow"))
}

fn run_git(repo_path: &Path, args: &[&str]) -> Result<String, GitWorktreeError> {
    command::run_git(repo_path, args)
        .map(|value| value.trim().to_string())
        .map_err(GitWorktreeError::from)
}

fn map_ancestor_command_error(error: GitCommandError) -> GitWorktreeError {
    match error {
        GitCommandError::Failed { message, .. } => GitWorktreeError::GitCommandFailed {
            command: "git merge-base --is-ancestor".to_string(),
            message,
        },
        other => other.into(),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn rebases_additional_worktree_and_fast_forwards_target_branch() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-1");

        create_repo(&repo_dir);
        write_file(&repo_dir, "base.txt", "base\n");
        git(&repo_dir, &["add", "base.txt"]);
        git(&repo_dir, &["commit", "-m", "initial"]);

        git(
            &repo_dir,
            &[
                "worktree",
                "add",
                "-b",
                "issue-1",
                worktree_path.to_string_lossy().as_ref(),
                "main",
            ],
        );
        write_file(&worktree_path, "feature.txt", "feature\n");
        git(&worktree_path, &["add", "feature.txt"]);
        git(&worktree_path, &["commit", "-m", "feature"]);

        write_file(&repo_dir, "main.txt", "main\n");
        git(&repo_dir, &["add", "main.txt"]);
        git(&repo_dir, &["commit", "-m", "main update"]);

        assert!(is_additional_worktree(&worktree_path).expect("detect worktree"));
        assert_eq!(
            current_branch(&worktree_path).expect("current branch"),
            "issue-1"
        );

        rebase_and_fast_forward(&repo_dir, &worktree_path, "main", "issue-1")
            .expect("rebase and ff");

        assert!(is_branch_merged(&repo_dir, "main", "issue-1").expect("merged"));
        assert_eq!(current_branch(&repo_dir).expect("repo branch"), "main");
    }

    #[test]
    fn rebase_conflict_returns_git_error_and_keeps_worktree_path() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-1");

        create_repo(&repo_dir);
        write_file(&repo_dir, "shared.txt", "base\n");
        git(&repo_dir, &["add", "shared.txt"]);
        git(&repo_dir, &["commit", "-m", "initial"]);

        git(
            &repo_dir,
            &[
                "worktree",
                "add",
                "-b",
                "issue-1",
                worktree_path.to_string_lossy().as_ref(),
                "main",
            ],
        );
        write_file(&worktree_path, "shared.txt", "issue\n");
        git(&worktree_path, &["add", "shared.txt"]);
        git(&worktree_path, &["commit", "-m", "issue change"]);
        let pre_rebase_head = git_output(&worktree_path, &["rev-parse", "HEAD"]);

        write_file(&repo_dir, "shared.txt", "main\n");
        git(&repo_dir, &["add", "shared.txt"]);
        git(&repo_dir, &["commit", "-m", "main change"]);

        let result = rebase_and_fast_forward(&repo_dir, &worktree_path, "main", "issue-1");

        assert!(matches!(
            result,
            Err(GitWorktreeError::GitCommandFailed { .. })
        ));
        assert!(worktree_path.exists());
        // rebase 冲突后必须 abort 还原，不能留下冲突态/进行中 rebase。
        assert_eq!(
            current_branch(&worktree_path).expect("current branch"),
            "issue-1"
        );
        assert_eq!(
            git_output(&worktree_path, &["rev-parse", "HEAD"]),
            pre_rebase_head,
            "HEAD 应回到 rebase 前的提交"
        );
        assert_eq!(
            git_output(&worktree_path, &["status", "--porcelain"]),
            "",
            "工作区应干净，无冲突文件"
        );
        assert_eq!(
            fs::read_to_string(worktree_path.join("shared.txt")).expect("read shared"),
            "issue\n",
            "文件内容应还原为 worktree 分支原内容"
        );
        assert!(
            !worktree_git_dir(&worktree_path).join("rebase-merge").exists()
                && !worktree_git_dir(&worktree_path).join("rebase-apply").exists(),
            "不得残留 rebase 进行中状态"
        );
        // 主仓库不应被改动，也不得残留冲突。
        assert_eq!(current_branch(&repo_dir).expect("repo branch"), "main");
        assert_eq!(git_output(&repo_dir, &["status", "--porcelain"]), "");
        assert_eq!(
            fs::read_to_string(repo_dir.join("shared.txt")).expect("read main shared"),
            "main\n"
        );
    }

    #[test]
    fn create_worktree_for_issue_names_branch_and_dir_after_issue_number_and_repo_slug() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("redwhisk");
        let worktree_root = temp_dir.path().join("worktrees");

        create_repo(&repo_dir);
        write_file(&repo_dir, "base.txt", "base\n");
        git(&repo_dir, &["add", "base.txt"]);
        git(&repo_dir, &["commit", "-m", "initial"]);

        // issue_number 与全局 id 无关：这里传 3 只代表项目内编号；主名含仓库 basename slug。
        let created = create_worktree_for_issue(&repo_dir, &worktree_root, 3, "main")
            .expect("create worktree for issue");

        assert_eq!(created.workspace_branch, "issue-3-redwhisk");
        assert!(
            created.workspace_path.replace('\\', "/").ends_with("issue-3-redwhisk"),
            "workspace path should end with issue-3-redwhisk, got: {}",
            created.workspace_path
        );
        assert_eq!(
            current_branch(&created.workspace_path).unwrap(),
            "issue-3-redwhisk"
        );
    }

    #[test]
    fn lists_project_root_and_additional_worktrees_with_their_branches() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-3");
        create_repo(&repo_dir);
        write_file(&repo_dir, "base.txt", "base\n");
        git(&repo_dir, &["add", "base.txt"]);
        git(&repo_dir, &["commit", "-m", "initial"]);
        git(&repo_dir, &["worktree", "add", "-b", "issue-3", worktree_path.to_string_lossy().as_ref(), "main"]);

        let roots = list_code_workspaces(&repo_dir).expect("list code workspaces");

        assert_eq!(roots.len(), 2);
        assert_eq!(roots[0].branch, "main");
        assert!(roots[0].is_project_root);
        assert_eq!(roots[1].branch, "issue-3");
        assert!(!roots[1].is_project_root);
    }

    #[test]
    fn restores_missing_worktree_from_existing_branch() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-16");

        create_repo(&repo_dir);
        write_file(&repo_dir, "base.txt", "base\n");
        git(&repo_dir, &["add", "base.txt"]);
        git(&repo_dir, &["commit", "-m", "initial"]);
        git(&repo_dir, &["branch", "issue-16"]);

        restore_worktree_for_branch(&repo_dir, &worktree_path, "issue-16")
            .expect("restore worktree");

        assert!(worktree_path.is_dir());
        assert_eq!(
            current_branch(&worktree_path).expect("current branch"),
            "issue-16"
        );
    }


    #[test]
    fn classify_merge_block_maps_dirty_roles_and_conflict() {
        let target = GitWorktreeError::DirtyWorktree {
            role: GitWorktreeDirtyRole::Target,
            path: "/repo".into(),
            files: "a.txt".into(),
        };
        let workspace = GitWorktreeError::DirtyWorktree {
            role: GitWorktreeDirtyRole::Workspace,
            path: "/wt".into(),
            files: "b.txt".into(),
        };
        let conflict = GitWorktreeError::GitCommandFailed {
            command: "git rebase main".into(),
            message: "CONFLICT (content): merge conflict in file".into(),
        };
        let other = GitWorktreeError::GitCommandFailed {
            command: "git status".into(),
            message: "boom".into(),
        };

        assert_eq!(
            classify_merge_block(&target),
            MergeBlockClassification::TargetDirty {
                path: "/repo".into(),
                files: "a.txt".into(),
            }
        );
        assert_eq!(classify_merge_block(&target).reason(), "target_worktree_dirty");
        assert_eq!(
            classify_merge_block(&workspace),
            MergeBlockClassification::WorkspaceDirty {
                path: "/wt".into(),
                files: "b.txt".into(),
            }
        );
        assert_eq!(
            classify_merge_block(&workspace).reason(),
            "workspace_worktree_dirty"
        );
        assert_eq!(
            classify_merge_block(&conflict),
            MergeBlockClassification::MergeConflict
        );
        assert_eq!(classify_merge_block(&conflict).reason(), "merge_conflict");
        assert_eq!(
            classify_merge_block(&other),
            MergeBlockClassification::GitCommandFailed
        );
        assert_eq!(classify_merge_block(&other).reason(), "git_command_failed");
    }

    #[test]
    fn assess_missing_worktree_closed_out_when_branch_absent_or_merged() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_repo(&repo_dir);
        write_file(&repo_dir, "base.txt", "base\n");
        git(&repo_dir, &["add", "base.txt"]);
        git(&repo_dir, &["commit", "-m", "initial"]);

        assert_eq!(
            assess_missing_worktree(&repo_dir, "main", "issue-99").expect("assess"),
            MissingWorktreeAssessment::ClosedOut
        );

        git(&repo_dir, &["checkout", "-b", "issue-7"]);
        write_file(&repo_dir, "feat.txt", "feat\n");
        git(&repo_dir, &["add", "feat.txt"]);
        git(&repo_dir, &["commit", "-m", "feat"]);
        git(&repo_dir, &["checkout", "main"]);
        git(&repo_dir, &["merge", "--ff-only", "issue-7"]);

        assert_eq!(
            assess_missing_worktree(&repo_dir, "main", "issue-7").expect("assess merged"),
            MissingWorktreeAssessment::ClosedOut
        );
    }

    #[test]
    fn assess_missing_worktree_not_merged_when_branch_diverges() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_repo(&repo_dir);
        write_file(&repo_dir, "base.txt", "base\n");
        git(&repo_dir, &["add", "base.txt"]);
        git(&repo_dir, &["commit", "-m", "initial"]);
        git(&repo_dir, &["checkout", "-b", "issue-8"]);
        write_file(&repo_dir, "feat.txt", "feat\n");
        git(&repo_dir, &["add", "feat.txt"]);
        git(&repo_dir, &["commit", "-m", "feat"]);
        git(&repo_dir, &["checkout", "main"]);

        assert_eq!(
            assess_missing_worktree(&repo_dir, "main", "issue-8").expect("assess"),
            MissingWorktreeAssessment::NotMerged {
                workspace_branch: "issue-8".into(),
                target_branch: "main".into(),
            }
        );
    }

    #[test]
    fn inspect_execution_path_detects_drift_into_additional_worktree() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-9");
        create_repo(&repo_dir);
        write_file(&repo_dir, "base.txt", "base\n");
        git(&repo_dir, &["add", "base.txt"]);
        git(&repo_dir, &["commit", "-m", "initial"]);
        git(
            &repo_dir,
            &[
                "worktree",
                "add",
                "-b",
                "issue-9",
                worktree_path.to_string_lossy().as_ref(),
                "main",
            ],
        );

        let startup = repo_dir.to_string_lossy().to_string();
        let actual = worktree_path.to_string_lossy().to_string();
        let facts = inspect_execution_path(&actual, &startup);
        assert!(facts.in_worktree);
        assert_eq!(facts.worktree_branch.as_deref(), Some("issue-9"));
        assert!(facts.drifted);

        let same = inspect_execution_path(&startup, &startup);
        assert!(!same.in_worktree);
        assert!(!same.drifted);
    }

    #[test]
    fn reconcile_worktree_fast_forwards_and_removes_workspace() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-10");
        create_repo(&repo_dir);
        write_file(&repo_dir, "base.txt", "base\n");
        git(&repo_dir, &["add", "base.txt"]);
        git(&repo_dir, &["commit", "-m", "initial"]);
        git(
            &repo_dir,
            &[
                "worktree",
                "add",
                "-b",
                "issue-10",
                worktree_path.to_string_lossy().as_ref(),
                "main",
            ],
        );
        write_file(&worktree_path, "feature.txt", "feature\n");
        git(&worktree_path, &["add", "feature.txt"]);
        git(&worktree_path, &["commit", "-m", "feature"]);

        reconcile_worktree(WorktreeReconcileRequest {
            repo_path: &repo_dir,
            workspace_path: &worktree_path,
            workspace_branch: "issue-10",
            target_branch: "main",
        })
        .expect("reconcile");

        assert!(!worktree_path.exists());
        assert!(!branch_exists(&repo_dir, "issue-10").expect("branch gone"));
        assert_eq!(current_branch(&repo_dir).expect("branch"), "main");
        assert!(repo_dir.join("feature.txt").is_file());
    }


    #[test]
    fn discard_worktree_changes_resets_tracked_and_removes_untracked() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_repo(&repo_dir);
        write_file(&repo_dir, "tracked.txt", "clean\n");
        git(&repo_dir, &["add", "tracked.txt"]);
        git(&repo_dir, &["commit", "-m", "initial"]);

        write_file(&repo_dir, "tracked.txt", "dirty\n");
        write_file(&repo_dir, "scratch.txt", "untracked\n");

        discard_worktree_changes(&repo_dir).expect("discard");

        assert_eq!(
            fs::read_to_string(repo_dir.join("tracked.txt")).expect("tracked"),
            "clean\n"
        );
        assert!(!repo_dir.join("scratch.txt").exists());
        let status = git_output(&repo_dir, &["status", "--porcelain"]);
        assert!(status.is_empty(), "worktree should be clean, got {status}");
    }

    #[test]
    fn discard_worktree_changes_is_noop_when_path_missing() {
        let temp_dir = tempdir().expect("temp dir");
        let missing = temp_dir.path().join("missing-worktree");
        discard_worktree_changes(&missing).expect("missing path is noop");
        assert!(!missing.exists());
    }

    fn create_repo(repo_dir: &Path) {
        fs::create_dir_all(repo_dir).expect("create repo dir");
        git(repo_dir, &["init"]);
        git(repo_dir, &["config", "user.email", "redwhisk@example.test"]);
        git(repo_dir, &["config", "user.name", "RedWhisk Test"]);
        git(repo_dir, &["checkout", "-b", "main"]);
    }

    fn write_file(repo_dir: &Path, relative_path: &str, contents: &str) {
        fs::write(repo_dir.join(relative_path), contents).expect("write file");
    }

    fn git(repo_dir: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_dir)
            .output()
            .expect("run git");

        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_output(repo_dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_dir)
            .output()
            .expect("run git");

        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn worktree_git_dir(worktree_path: &Path) -> PathBuf {
        let output = git_output(
            worktree_path,
            &["rev-parse", "--path-format=absolute", "--git-dir"],
        );
        PathBuf::from(output)
    }
}
