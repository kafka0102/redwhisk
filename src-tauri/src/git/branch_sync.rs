//! 读取当前 HEAD 相对 upstream 的本地同步状态（ahead/behind）。
//! 只读本地 git 元数据，**禁止**隐式 `git fetch`。

use std::path::Path;

use crate::git::command;
use crate::types::session_workspace::BranchSyncStatus;

/// 读取相对 `@{upstream}` 的本地同步状态。
///
/// - 有 upstream 且 `rev-list --left-right --count HEAD...@{upstream}` 成功 → Some
/// - 无 upstream / detached HEAD / 解析失败 → None（明确不可同步）
///
/// 不执行 fetch；behind 仅相对本地已缓存的 upstream ref。
pub fn read_branch_sync_status(repo_path: impl AsRef<Path>) -> Option<BranchSyncStatus> {
    let repo_path = repo_path.as_ref();

    let upstream = match command::run_git(repo_path, &["rev-parse", "--abbrev-ref", "@{upstream}"])
    {
        Ok(value) => {
            let value = value.trim();
            if value.is_empty() || value == "@{upstream}" || value.starts_with("HEAD") {
                return None;
            }
            value.to_string()
        }
        Err(_) => return None,
    };

    // left = commits reachable from HEAD but not upstream (ahead)
    // right = commits reachable from upstream but not HEAD (behind)
    let counts = match command::run_git(
        repo_path,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    ) {
        Ok(value) => value,
        Err(_) => return None,
    };

    let parts: Vec<&str> = counts.split_whitespace().collect();
    if parts.len() != 2 {
        return None;
    }
    let ahead = parts[0].parse::<u64>().ok()?;
    let behind = parts[1].parse::<u64>().ok()?;

    Some(BranchSyncStatus {
        upstream,
        ahead,
        behind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use tempfile::tempdir;

    struct RemoteTestEnv {
        local: PathBuf,
        other_clone: PathBuf,
        _temp_dir: tempfile::TempDir,
    }

    fn setup_clone_with_upstream() -> RemoteTestEnv {
        let temp_dir = tempdir().expect("temp dir");
        let seed = temp_dir.path().join("seed");
        let bare = temp_dir.path().join("bare.git");
        let local = temp_dir.path().join("local");
        let other_clone = temp_dir.path().join("other");

        create_repo(&seed);
        write_file(&seed, "base.txt", "base\n");
        git(&seed, &["add", "base.txt"]);
        git(&seed, &["commit", "-m", "initial"]);

        git(
            temp_dir.path(),
            &[
                "clone",
                "--bare",
                seed.to_string_lossy().as_ref(),
                bare.to_string_lossy().as_ref(),
            ],
        );
        git(
            temp_dir.path(),
            &[
                "clone",
                bare.to_string_lossy().as_ref(),
                local.to_string_lossy().as_ref(),
            ],
        );
        git(
            temp_dir.path(),
            &[
                "clone",
                bare.to_string_lossy().as_ref(),
                other_clone.to_string_lossy().as_ref(),
            ],
        );

        git(&local, &["config", "user.email", "redwhisk@example.test"]);
        git(&local, &["config", "user.name", "RedWhisk Test"]);
        git(
            &other_clone,
            &["config", "user.email", "redwhisk@example.test"],
        );
        git(&other_clone, &["config", "user.name", "RedWhisk Test"]);

        RemoteTestEnv {
            local,
            other_clone,
            _temp_dir: temp_dir,
        }
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

    #[test]
    fn returns_none_when_branch_has_no_upstream() {
        let temp_dir = tempdir().expect("temp dir");
        let repo = temp_dir.path().join("repo");
        create_repo(&repo);
        write_file(&repo, "base.txt", "base\n");
        git(&repo, &["add", "base.txt"]);
        git(&repo, &["commit", "-m", "initial"]);

        assert_eq!(read_branch_sync_status(&repo), None);
    }

    #[test]
    fn returns_none_when_detached_head() {
        let env = setup_clone_with_upstream();
        let head = {
            let output = Command::new("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(&env.local)
                .output()
                .expect("rev-parse");
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };
        git(&env.local, &["checkout", "--detach", &head]);

        assert_eq!(read_branch_sync_status(&env.local), None);
    }

    #[test]
    fn reports_ahead_only_relative_to_upstream() {
        let env = setup_clone_with_upstream();
        write_file(&env.local, "local.txt", "local\n");
        git(&env.local, &["add", "local.txt"]);
        git(&env.local, &["commit", "-m", "local ahead"]);

        let status = read_branch_sync_status(&env.local).expect("sync status");
        assert_eq!(status.upstream, "origin/main");
        assert_eq!(status.ahead, 1);
        assert_eq!(status.behind, 0);
    }

    #[test]
    fn reports_behind_only_relative_to_local_upstream_ref() {
        let env = setup_clone_with_upstream();
        write_file(&env.other_clone, "remote.txt", "remote\n");
        git(&env.other_clone, &["add", "remote.txt"]);
        git(&env.other_clone, &["commit", "-m", "remote ahead"]);
        git(&env.other_clone, &["push"]);

        // 更新 local 的 origin/main 缓存，但不 merge，保持仅 behind。
        // 禁止被测函数内部 fetch；此处测试准备可显式 fetch。
        git(&env.local, &["fetch", "origin"]);

        let status = read_branch_sync_status(&env.local).expect("sync status");
        assert_eq!(status.upstream, "origin/main");
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 1);
    }

    #[test]
    fn reports_diverged_ahead_and_behind() {
        let env = setup_clone_with_upstream();
        write_file(&env.local, "local.txt", "local\n");
        git(&env.local, &["add", "local.txt"]);
        git(&env.local, &["commit", "-m", "local ahead"]);

        write_file(&env.other_clone, "remote.txt", "remote\n");
        git(&env.other_clone, &["add", "remote.txt"]);
        git(&env.other_clone, &["commit", "-m", "remote ahead"]);
        git(&env.other_clone, &["push"]);
        git(&env.local, &["fetch", "origin"]);

        let status = read_branch_sync_status(&env.local).expect("sync status");
        assert_eq!(status.upstream, "origin/main");
        assert_eq!(status.ahead, 1);
        assert_eq!(status.behind, 1);
    }

    #[test]
    fn reports_zero_ahead_behind_when_in_sync() {
        let env = setup_clone_with_upstream();
        let status = read_branch_sync_status(&env.local).expect("sync status");
        assert_eq!(status.upstream, "origin/main");
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
    }
}
