//! 合并候选分支列表。
//! 与签出列表共用条目形态，但不隐藏其他 worktree 占用的本地分支。

use super::checkout_branches::{
    current_branch_name, has_uncommitted_changes, is_remote_head_ref, list_ref_entries,
    CheckoutBranchList,
};
use super::command::GitCommandError;
use std::path::Path;

/// 列出可合入当前分支的本地/远程分支（不 fetch）。
/// 本地去掉当前分支，保留其他 worktree 占用分支；远程去掉 `*/HEAD`。
pub fn list_merge_branches(
    repo_path: impl AsRef<Path>,
) -> Result<CheckoutBranchList, GitCommandError> {
    let repo_path = repo_path.as_ref();
    let current_branch = current_branch_name(repo_path)?;
    let has_uncommitted_changes = has_uncommitted_changes(repo_path)?;

    let local_branches = list_ref_entries(repo_path, "refs/heads/")?
        .into_iter()
        .filter(|entry| entry.name != current_branch)
        .collect::<Vec<_>>();

    let remote_branches = list_ref_entries(repo_path, "refs/remotes/")?
        .into_iter()
        .filter(|entry| !is_remote_head_ref(&entry.name))
        .collect::<Vec<_>>();

    Ok(CheckoutBranchList {
        current_branch,
        has_uncommitted_changes,
        local_branches,
        remote_branches,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use tempfile::tempdir;

    #[test]
    fn list_excludes_current_local_and_includes_occupied_worktree_branch() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        let worktree = temp.path().join("wt-feature");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "base");
        git(&repo, &["branch", "-M", "main"]);
        git(&repo, &["branch", "feature-occupied"]);
        git(&repo, &["branch", "feature-free"]);
        git(
            &repo,
            &[
                "worktree",
                "add",
                worktree.to_string_lossy().as_ref(),
                "feature-occupied",
            ],
        );

        let list = list_merge_branches(&repo).expect("list");
        let names: Vec<&str> = list
            .local_branches
            .iter()
            .map(|branch| branch.name.as_str())
            .collect();
        assert_eq!(list.current_branch, "main");
        assert!(
            !names.contains(&"main"),
            "current branch must be hidden: {names:?}"
        );
        assert!(
            names.contains(&"feature-occupied"),
            "occupied branch must remain: {names:?}"
        );
        assert!(names.contains(&"feature-free"), "{names:?}");
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
}
