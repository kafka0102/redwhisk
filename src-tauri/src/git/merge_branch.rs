//! 把指定引用合入当前分支（允许快进；冲突/失败则 abort）。
//! 不复用完成流程的 `merge_branch_into_target`（强制 --no-ff 且会切分支）。

use std::path::Path;

use super::command::{self, GitCommandError};

/// 工作区有未提交改动，拒绝合并。
pub const MERGE_REQUIRES_CLEAN_WORKTREE: &str = "mergeRequiresCleanWorktree";
/// 合并冲突或失败后已 abort，工作区保持干净。
pub const MERGE_ABORTED_DUE_TO_CONFLICT: &str = "mergeAbortedDueToConflict";
/// detached HEAD 等无当前分支时拒绝合并。
pub const MERGE_REQUIRES_CURRENT_BRANCH: &str = "mergeRequiresCurrentBranch";

/// 将 `name`（本地分支或 remote-tracking 引用）合入当前分支。
///
/// 可快进则快进，否则创建 merge commit。脏工作区 / detached HEAD 直接拒绝。
/// 冲突或 Git 失败则 `git merge --abort`，保证工作区干净后返回错误。
/// 合并不改变当前分支名。
pub fn merge_ref_into_current_branch(
    repo_path: impl AsRef<Path>,
    name: &str,
) -> Result<String, GitCommandError> {
    let repo_path = repo_path.as_ref();
    let name = name.trim();
    if name.is_empty() {
        return Err(GitCommandError::Failed {
            command: "git merge".to_string(),
            message: "branch name is required".to_string(),
        });
    }

    let current = current_branch_name(repo_path)?;
    if current.is_empty() {
        return Err(GitCommandError::Failed {
            command: "git merge".to_string(),
            message: MERGE_REQUIRES_CURRENT_BRANCH.to_string(),
        });
    }

    if has_uncommitted_changes(repo_path)? {
        return Err(GitCommandError::Failed {
            command: "git merge".to_string(),
            message: MERGE_REQUIRES_CLEAN_WORKTREE.to_string(),
        });
    }

    if let Err(error) = command::run_git(repo_path, &["merge", "--no-edit", name]) {
        let started_merge = merge_in_progress(repo_path)?;
        abort_merge_if_in_progress(repo_path)?;
        if started_merge {
            return Err(GitCommandError::Failed {
                command: "git merge".to_string(),
                message: MERGE_ABORTED_DUE_TO_CONFLICT.to_string(),
            });
        }
        return Err(error);
    }

    Ok(current)
}

fn current_branch_name(repo_path: &Path) -> Result<String, GitCommandError> {
    command::run_git(repo_path, &["branch", "--show-current"])
}

fn has_uncommitted_changes(repo_path: &Path) -> Result<bool, GitCommandError> {
    let status = command::run_git(repo_path, &["status", "--porcelain=v1"])?;
    Ok(!status.trim().is_empty())
}

fn merge_in_progress(repo_path: &Path) -> Result<bool, GitCommandError> {
    let output = command::run_git_raw(repo_path, &["rev-parse", "-q", "--verify", "MERGE_HEAD"])?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(GitCommandError::Failed {
            command: "git rev-parse -q --verify MERGE_HEAD".to_string(),
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        }),
    }
}

fn abort_merge_if_in_progress(repo_path: &Path) -> Result<(), GitCommandError> {
    if merge_in_progress(repo_path)? {
        command::run_git(repo_path, &["merge", "--abort"])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use tempfile::tempdir;

    #[test]
    fn merge_rejects_dirty_worktree_without_starting_merge() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "base");
        git(&repo, &["branch", "-M", "main"]);
        git(&repo, &["branch", "feature"]);
        fs::write(repo.join("dirty.txt"), "dirty\n").expect("write dirty");

        let err = merge_ref_into_current_branch(&repo, "feature").expect_err("dirty");
        match err {
            GitCommandError::Failed { message, .. } => {
                assert_eq!(message, MERGE_REQUIRES_CLEAN_WORKTREE);
            }
            other => panic!("expected Failed, got {other:?}"),
        }
        assert_eq!(current_branch(&repo), "main");
        assert_eq!(
            fs::read_to_string(repo.join("dirty.txt")).expect("read"),
            "dirty\n"
        );
        assert!(!is_merge_in_progress(&repo));
        let status = git_stdout(&repo, &["status", "--porcelain"]);
        assert!(
            status.contains("dirty.txt"),
            "dirty file should remain: {status}"
        );
    }

    #[test]
    fn merge_fast_forwards_when_possible_and_keeps_current_branch() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "base");
        git(&repo, &["branch", "-M", "main"]);
        git(&repo, &["checkout", "-b", "feature"]);
        write_commit(&repo, "feat.txt", "feat\n", "feature tip");
        git(&repo, &["checkout", "main"]);
        let feature_tip = rev_parse(&repo, "feature");

        let branch = merge_ref_into_current_branch(&repo, "feature").expect("ff merge");

        assert_eq!(branch, "main");
        assert_eq!(current_branch(&repo), "main");
        assert_eq!(rev_parse(&repo, "HEAD"), feature_tip);
        assert!(!is_merge_commit(&repo, "HEAD"));
        assert!(!is_merge_in_progress(&repo));
        assert_eq!(git_stdout(&repo, &["status", "--porcelain"]).trim(), "");
    }

    #[test]
    fn merge_creates_merge_commit_when_histories_diverged() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "base");
        git(&repo, &["branch", "-M", "main"]);
        git(&repo, &["checkout", "-b", "feature"]);
        write_commit(&repo, "feat.txt", "feat\n", "feature tip");
        git(&repo, &["checkout", "main"]);
        write_commit(&repo, "main.txt", "main\n", "main tip");
        let main_before = rev_parse(&repo, "HEAD");
        let feature_tip = rev_parse(&repo, "feature");

        let branch = merge_ref_into_current_branch(&repo, "feature").expect("merge commit");

        assert_eq!(branch, "main");
        assert_eq!(current_branch(&repo), "main");
        assert!(is_merge_commit(&repo, "HEAD"));
        assert_eq!(rev_parse(&repo, "HEAD^1"), main_before);
        assert_eq!(rev_parse(&repo, "HEAD^2"), feature_tip);
        assert!(!is_merge_in_progress(&repo));
        assert_eq!(git_stdout(&repo, &["status", "--porcelain"]).trim(), "");
    }

    #[test]
    fn merge_aborts_conflict_and_keeps_worktree_clean() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "conflict.txt", "base\n", "base");
        git(&repo, &["branch", "-M", "main"]);
        git(&repo, &["checkout", "-b", "feature"]);
        write_commit(&repo, "conflict.txt", "feature\n", "feature change");
        git(&repo, &["checkout", "main"]);
        write_commit(&repo, "conflict.txt", "main\n", "main change");
        let main_before = rev_parse(&repo, "HEAD");

        let err = merge_ref_into_current_branch(&repo, "feature").expect_err("conflict");
        match err {
            GitCommandError::Failed { message, .. } => {
                assert_eq!(message, MERGE_ABORTED_DUE_TO_CONFLICT);
            }
            other => panic!("expected Failed, got {other:?}"),
        }
        assert_eq!(current_branch(&repo), "main");
        assert_eq!(rev_parse(&repo, "HEAD"), main_before);
        assert!(!is_merge_in_progress(&repo));
        assert_eq!(git_stdout(&repo, &["status", "--porcelain"]).trim(), "");
        assert_eq!(
            fs::read_to_string(repo.join("conflict.txt")).expect("read"),
            "main\n"
        );
    }

    #[test]
    fn merge_rejects_detached_head() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "base");
        git(&repo, &["branch", "-M", "main"]);
        git(&repo, &["branch", "feature"]);
        git(&repo, &["checkout", "--detach", "HEAD"]);

        let err = merge_ref_into_current_branch(&repo, "feature").expect_err("detached");
        match err {
            GitCommandError::Failed { message, .. } => {
                assert_eq!(message, MERGE_REQUIRES_CURRENT_BRANCH);
            }
            other => panic!("expected Failed, got {other:?}"),
        }
        assert_eq!(current_branch(&repo), "");
        assert!(!is_merge_in_progress(&repo));
    }

    fn create_repo(repo_dir: &Path) {
        fs::create_dir_all(repo_dir).expect("create");
        git(repo_dir, &["init"]);
        git(repo_dir, &["config", "user.email", "redwhisk@example.test"]);
        git(repo_dir, &["config", "user.name", "RedWhisk Test"]);
    }

    fn write_commit(repo_dir: &Path, path: &str, contents: &str, message: &str) {
        fs::write(repo_dir.join(path), contents).expect("write");
        git(repo_dir, &["add", path]);
        git(repo_dir, &["commit", "-m", message]);
    }

    fn git(repo_dir: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_dir)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_stdout(repo_dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_dir)
            .output()
            .expect("run git");
        assert!(output.status.success());
        String::from_utf8_lossy(&output.stdout).to_string()
    }

    fn current_branch(repo_dir: &Path) -> String {
        git_stdout(repo_dir, &["branch", "--show-current"])
            .trim()
            .to_string()
    }

    fn rev_parse(repo_dir: &Path, rev: &str) -> String {
        git_stdout(repo_dir, &["rev-parse", rev]).trim().to_string()
    }

    fn is_merge_commit(repo_dir: &Path, rev: &str) -> bool {
        let output = Command::new("git")
            .args(["rev-parse", "-q", "--verify", &format!("{rev}^2")])
            .current_dir(repo_dir)
            .output()
            .expect("run git");
        output.status.success()
    }

    fn is_merge_in_progress(repo_dir: &Path) -> bool {
        let output = Command::new("git")
            .args(["rev-parse", "-q", "--verify", "MERGE_HEAD"])
            .current_dir(repo_dir)
            .output()
            .expect("run git");
        output.status.success()
    }
}
