//! 主 checkout 分支切换（普通 checkout，不 force）。
//! 与列表/fetch 分离，避免单文件膨胀。

use std::path::Path;

use super::command::{self, GitCommandError};

fn current_branch_name(repo_path: &Path) -> Result<String, GitCommandError> {
    command::run_git(repo_path, &["branch", "--show-current"])
}

/// 签出目标类型（与跨边界 DTO `CheckoutBranchKind` 对齐）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckoutTargetKind {
    Local,
    Remote,
}

/// 在仓库主工作区执行普通 checkout（不 force、不 discard）。
///
/// - local：`git checkout <name>`；已是当前分支则成功 no-op。
/// - remote：本地已有同名分支则 checkout 本地；否则
///   `git checkout -b <short> --track <remote-name>`。
pub fn checkout_branch(
    repo_path: impl AsRef<Path>,
    kind: CheckoutTargetKind,
    name: &str,
) -> Result<String, GitCommandError> {
    let repo_path = repo_path.as_ref();
    let name = name.trim();
    if name.is_empty() {
        return Err(GitCommandError::Failed {
            command: "git checkout".to_string(),
            message: "branch name is required".to_string(),
        });
    }

    let target_local = match kind {
        CheckoutTargetKind::Local => name.to_string(),
        CheckoutTargetKind::Remote => {
            let short = remote_tracking_short_name(name)?;
            if local_branch_exists(repo_path, &short)? {
                short
            } else {
                // 创建本地跟踪分支并签出。
                command::run_git(
                    repo_path,
                    &["checkout", "-b", short.as_str(), "--track", name],
                )?;
                return Ok(short);
            }
        }
    };

    let current = current_branch_name(repo_path)?;
    if current == target_local {
        return Ok(target_local);
    }

    command::run_git(repo_path, &["checkout", target_local.as_str()])?;
    Ok(target_local)
}

/// 从 remote-tracking 名去掉 remote 前缀：`origin/feature/foo` → `feature/foo`。
fn remote_tracking_short_name(remote_name: &str) -> Result<String, GitCommandError> {
    match remote_name.split_once('/') {
        Some((remote, rest)) if !remote.is_empty() && !rest.is_empty() => Ok(rest.to_string()),
        _ => Err(GitCommandError::Failed {
            command: "git checkout".to_string(),
            message: format!("invalid remote-tracking branch name: {remote_name}"),
        }),
    }
}

fn local_branch_exists(repo_path: &Path, name: &str) -> Result<bool, GitCommandError> {
    let branch_ref = format!("refs/heads/{name}");
    let output = command::run_git_raw(
        repo_path,
        &["show-ref", "--verify", "--quiet", branch_ref.as_str()],
    )?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(GitCommandError::Failed {
            command: format!("git show-ref --verify --quiet {branch_ref}"),
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        }),
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use super::command::{self, GitCommandError};
    use std::fs;
    use std::process::Command;

    use tempfile::tempdir;

    #[test]
    fn checkout_local_switches_branch() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "base");
        git(&repo, &["branch", "-M", "main"]);
        git(&repo, &["branch", "feature-a"]);

        let branch = checkout_branch(&repo, CheckoutTargetKind::Local, "feature-a")
            .expect("checkout local");
        assert_eq!(branch, "feature-a");
        assert_eq!(current_branch(&repo), "feature-a");
    }

    #[test]
    fn checkout_current_local_is_noop_success() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "base");
        git(&repo, &["branch", "-M", "main"]);

        let branch = checkout_branch(&repo, CheckoutTargetKind::Local, "main").expect("noop");
        assert_eq!(branch, "main");
        assert_eq!(current_branch(&repo), "main");
    }

    #[test]
    fn checkout_remote_creates_tracking_when_no_local() {
        let env = setup_clone_with_remote();
        git(&env.seed, &["checkout", "-b", "remote-only"]);
        write_commit(&env.seed, "r.txt", "r\n", "remote only");
        git(
            &env.seed,
            &["push", env.bare.to_string_lossy().as_ref(), "remote-only"],
        );
        // local 侧 fetch 后才有 remote-tracking ref
        git(&env.local, &["fetch", "--all"]);

        assert!(!local_branch_exists(&env.local, "remote-only").expect("exists"));
        let branch = checkout_branch(
            &env.local,
            CheckoutTargetKind::Remote,
            "origin/remote-only",
        )
        .expect("checkout remote");
        assert_eq!(branch, "remote-only");
        assert_eq!(current_branch(&env.local), "remote-only");
        // 跟踪关系
        let upstream = command::run_git(
            &env.local,
            &["rev-parse", "--abbrev-ref", "@{upstream}"],
        )
        .expect("upstream");
        assert_eq!(upstream, "origin/remote-only");
    }

    #[test]
    fn checkout_remote_prefers_existing_same_name_local() {
        let env = setup_clone_with_remote();
        // origin/shared 与本地 shared 内容不同：本地有额外 commit
        git(&env.seed, &["checkout", "-b", "shared"]);
        write_commit(&env.seed, "shared-remote.txt", "remote\n", "remote shared");
        git(
            &env.seed,
            &["push", env.bare.to_string_lossy().as_ref(), "shared"],
        );
        git(&env.local, &["fetch", "--all"]);
        git(&env.local, &["checkout", "-b", "shared", "main"]);
        write_commit(&env.local, "shared-local.txt", "local\n", "local shared");
        let local_tip = command::run_git(&env.local, &["rev-parse", "HEAD"]).expect("local tip");
        git(&env.local, &["checkout", "main"]);

        let branch = checkout_branch(&env.local, CheckoutTargetKind::Remote, "origin/shared")
            .expect("prefer local");
        assert_eq!(branch, "shared");
        assert_eq!(current_branch(&env.local), "shared");
        let after = command::run_git(&env.local, &["rev-parse", "HEAD"]).expect("head after");
        // 应停在本地 tip，而不是远程 tip
        assert_eq!(local_tip, after);
        assert!(env.local.join("shared-local.txt").exists());
    }

    #[test]
    fn checkout_dirty_conflicting_fails_without_discard() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "shared.txt", "main\n", "main");
        git(&repo, &["branch", "-M", "main"]);
        git(&repo, &["checkout", "-b", "other"]);
        write_commit(&repo, "shared.txt", "other\n", "other change");
        git(&repo, &["checkout", "main"]);
        // 工作区脏：与 other 冲突
        fs::write(repo.join("shared.txt"), "dirty\n").expect("dirty");

        let err =
            checkout_branch(&repo, CheckoutTargetKind::Local, "other").expect_err("should fail");
        match err {
            GitCommandError::Failed { .. } => {}
            other => panic!("unexpected {other:?}"),
        }
        // 改动仍在
        assert_eq!(
            fs::read_to_string(repo.join("shared.txt")).expect("read"),
            "dirty\n"
        );
        assert_eq!(current_branch(&repo), "main");
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

    fn current_branch(repo_dir: &Path) -> String {
        let output = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(repo_dir)
            .output()
            .expect("run git");
        assert!(output.status.success());
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }
}
