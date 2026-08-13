//! 签出候选分支列表与远程 fetch。
//! 供变更 Activity「签出」弹窗使用：本地/远程 refs 元数据 + 可选 fetch --all --prune。

use std::collections::HashSet;
use std::path::Path;

use super::command::{self, GitCommandError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckoutBranchEntry {
    pub name: String,
    pub author_name: String,
    pub short_hash: String,
    pub message: String,
    /// 提交时间，Unix 秒。
    pub committed_at_seconds: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckoutBranchList {
    pub current_branch: String,
    pub has_uncommitted_changes: bool,
    pub local_branches: Vec<CheckoutBranchEntry>,
    pub remote_branches: Vec<CheckoutBranchEntry>,
}

/// 列出主 checkout 可签出的本地/远程分支（不 fetch）。
/// 本地排除其他 worktree 占用分支，以及已删除 worktree 残留的 issue 工作分支；
/// 远程排除 `*/HEAD` 符号 ref。
/// 各段按 committed_at 降序。
pub fn list_checkout_branches(
    repo_path: impl AsRef<Path>,
) -> Result<CheckoutBranchList, GitCommandError> {
    let repo_path = repo_path.as_ref();
    let current_branch = current_branch_name(repo_path)?;
    let occupied = other_worktree_branches(repo_path, &current_branch)?;
    let has_uncommitted_changes = has_uncommitted_changes(repo_path)?;

    let local_branches = list_ref_entries(repo_path, "refs/heads/")?
        .into_iter()
        .filter(|entry| !occupied.contains(&entry.name))
        .filter(|entry| !crate::git::worktree_name::is_issue_worktree_branch(&entry.name))
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

/// 显式刷新远程：`git fetch --all --prune`。
pub fn fetch_all_prune(repo_path: impl AsRef<Path>) -> Result<(), GitCommandError> {
    command::run_git(repo_path.as_ref(), &["fetch", "--all", "--prune"]).map(|_| ())
}

fn current_branch_name(repo_path: &Path) -> Result<String, GitCommandError> {
    let name = command::run_git(repo_path, &["branch", "--show-current"])?;
    Ok(name)
}

fn has_uncommitted_changes(repo_path: &Path) -> Result<bool, GitCommandError> {
    let status = command::run_git(repo_path, &["status", "--porcelain=v1"])?;
    Ok(!status.trim().is_empty())
}

fn other_worktree_branches(
    repo_path: &Path,
    current_branch: &str,
) -> Result<HashSet<String>, GitCommandError> {
    let output = command::run_git(repo_path, &["worktree", "list", "--porcelain"])?;
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

fn list_ref_entries(
    repo_path: &Path,
    pattern: &str,
) -> Result<Vec<CheckoutBranchEntry>, GitCommandError> {
    let output = command::run_git(
        repo_path,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)%00%(authorname)%00%(objectname:short)%00%(subject)%00%(committerdate:unix)",
            pattern,
        ],
    )?;

    let mut entries = Vec::new();
    for line in output.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split('\0');
        let name = parts.next().unwrap_or_default().to_string();
        if name.is_empty() {
            continue;
        }
        let author_name = parts.next().unwrap_or_default().to_string();
        let short_hash = parts.next().unwrap_or_default().to_string();
        let message = parts.next().unwrap_or_default().to_string();
        let committed_at_seconds = parts.next().unwrap_or_default().parse::<i64>().unwrap_or(0);
        entries.push(CheckoutBranchEntry {
            name,
            author_name,
            short_hash,
            message,
            committed_at_seconds,
        });
    }
    Ok(entries)
}

fn is_remote_head_ref(name: &str) -> bool {
    // 排除 origin/HEAD、裸 HEAD，以及 for-each-ref 对符号 ref 给出的无斜杠名（如 origin）。
    name == "HEAD" || name.ends_with("/HEAD") || !name.contains('/')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use std::thread;
    use std::time::Duration;

    use tempfile::tempdir;

    #[test]
    fn list_orders_by_committed_at_desc_and_includes_metadata() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "base commit");
        git(&repo, &["branch", "-M", "main"]);

        // 稍旧的 feature-old
        git(&repo, &["checkout", "-b", "feature-old"]);
        write_commit(&repo, "old.txt", "old\n", "old feature");
        // 确保时间差
        thread::sleep(Duration::from_millis(1100));
        git(&repo, &["checkout", "main"]);
        git(&repo, &["checkout", "-b", "feature-new"]);
        write_commit(&repo, "new.txt", "new\n", "new feature");
        git(&repo, &["checkout", "main"]);

        let list = list_checkout_branches(&repo).expect("list");
        assert_eq!(list.current_branch, "main");
        assert!(!list.has_uncommitted_changes);

        let names: Vec<&str> = list
            .local_branches
            .iter()
            .map(|b| b.name.as_str())
            .collect();
        assert_eq!(names, vec!["feature-new", "feature-old", "main"]);

        let newest = &list.local_branches[0];
        assert_eq!(newest.name, "feature-new");
        assert_eq!(newest.author_name, "RedWhisk Test");
        assert!(!newest.short_hash.is_empty());
        assert_eq!(newest.message, "new feature");
        assert!(newest.committed_at_seconds > 0);
        assert!(
            list.local_branches[0].committed_at_seconds
                >= list.local_branches[1].committed_at_seconds
        );
    }

    #[test]
    fn list_hides_leftover_issue_worktree_branches() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "base");
        git(&repo, &["branch", "-M", "main"]);
        git(&repo, &["branch", "feature-keep"]);
        git(&repo, &["branch", "issue-1"]);
        git(&repo, &["branch", "issue-9"]);
        git(&repo, &["branch", "issue-58-redwhisk"]);

        let list = list_checkout_branches(&repo).expect("list");
        let names: Vec<&str> = list
            .local_branches
            .iter()
            .map(|b| b.name.as_str())
            .collect();
        assert!(names.contains(&"main"), "{names:?}");
        assert!(names.contains(&"feature-keep"), "{names:?}");
        assert!(
            !names.iter().any(|name| name.starts_with("issue-")),
            "leftover issue worktree branches must be hidden: {names:?}"
        );
    }

    #[test]
    fn list_hides_branches_checked_out_in_other_worktrees() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        let worktree = temp.path().join("wt-feature");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "base");
        git(&repo, &["branch", "-M", "main"]);
        git(&repo, &["branch", "feature-occupied"]);
        git(
            &repo,
            &[
                "worktree",
                "add",
                worktree.to_string_lossy().as_ref(),
                "feature-occupied",
            ],
        );

        let list = list_checkout_branches(&repo).expect("list");
        let names: Vec<&str> = list
            .local_branches
            .iter()
            .map(|b| b.name.as_str())
            .collect();
        assert!(names.contains(&"main"));
        assert!(
            !names.contains(&"feature-occupied"),
            "occupied branch must be hidden: {names:?}"
        );
    }

    #[test]
    fn list_includes_remote_tracking_and_excludes_remote_head() {
        let env = setup_clone_with_remote();
        // 在本地 clone 上从 origin 拉到的 remote-tracking 应出现；再推一个远端分支后 fetch。
        git(&env.local, &["checkout", "-b", "remote-only"]);
        write_commit(&env.local, "r.txt", "r\n", "remote only");
        git(&env.local, &["push", "-u", "origin", "remote-only"]);
        git(&env.local, &["checkout", "main"]);
        // 删除本地 remote-only，只保留 remote-tracking
        git(&env.local, &["branch", "-D", "remote-only"]);
        git(&env.local, &["fetch", "--all", "--prune"]);

        let list = list_checkout_branches(&env.local).expect("list");
        let remote_names: Vec<&str> = list
            .remote_branches
            .iter()
            .map(|b| b.name.as_str())
            .collect();
        assert!(
            remote_names.iter().any(|n| *n == "origin/remote-only"),
            "expected origin/remote-only in {remote_names:?}"
        );
        assert!(
            remote_names
                .iter()
                .all(|n| !n.ends_with("/HEAD") && *n != "HEAD"),
            "remote HEAD must be excluded: {remote_names:?}"
        );
        assert!(
            remote_names.iter().all(|n| n.contains('/')),
            "remote names should be full remote-tracking names: {remote_names:?}"
        );
        // 远程 tip 元数据齐全
        let remote_only = list
            .remote_branches
            .iter()
            .find(|b| b.name == "origin/remote-only")
            .expect("remote-only entry");
        assert_eq!(remote_only.message, "remote only");
        assert!(!remote_only.short_hash.is_empty());
    }

    #[test]
    fn list_reports_uncommitted_changes() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "base");
        fs::write(repo.join("base.txt"), "dirty\n").expect("dirty");

        let list = list_checkout_branches(&repo).expect("list");
        assert!(list.has_uncommitted_changes);
    }

    #[test]
    fn fetch_all_prune_updates_remote_tracking() {
        let env = setup_clone_with_remote();
        git(&env.seed, &["checkout", "-b", "after-fetch"]);
        write_commit(&env.seed, "af.txt", "af\n", "after fetch");
        git(
            &env.seed,
            &[
                "remote",
                "add",
                "origin",
                env.bare.to_string_lossy().as_ref(),
            ],
        );
        git(&env.seed, &["push", "origin", "after-fetch"]);

        // before fetch, local clone should not see after-fetch
        let before = list_checkout_branches(&env.local).expect("list before");
        assert!(before
            .remote_branches
            .iter()
            .all(|b| b.name != "origin/after-fetch"));

        fetch_all_prune(&env.local).expect("fetch");
        let after = list_checkout_branches(&env.local).expect("list after");
        assert!(after
            .remote_branches
            .iter()
            .any(|b| b.name == "origin/after-fetch"));
    }

    struct RemoteEnv {
        bare: std::path::PathBuf,
        local: std::path::PathBuf,
        seed: std::path::PathBuf,
        _temp: tempfile::TempDir,
    }

    fn setup_clone_with_remote() -> RemoteEnv {
        let temp = tempdir().expect("temp");
        let seed = temp.path().join("seed");
        let bare = temp.path().join("remote.git");
        let local = temp.path().join("local");

        create_repo(&seed);
        write_commit(&seed, "base.txt", "base\n", "initial");
        git(&seed, &["branch", "-M", "main"]);

        git(
            temp.path(),
            &[
                "clone",
                "--bare",
                seed.to_string_lossy().as_ref(),
                bare.to_string_lossy().as_ref(),
            ],
        );
        git(
            temp.path(),
            &[
                "clone",
                bare.to_string_lossy().as_ref(),
                local.to_string_lossy().as_ref(),
            ],
        );
        git(&local, &["config", "user.email", "redwhisk@example.test"]);
        git(&local, &["config", "user.name", "RedWhisk Test"]);

        RemoteEnv {
            bare,
            local,
            seed,
            _temp: temp,
        }
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
