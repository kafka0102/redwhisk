//! 重试撞上 `index.lock` 的 git 命令。
//!
//! 完成 Issue 时，编辑器或变更面板可能同时对同一 worktree 跑 `git status`。
//! `checkout` 会在 fast-forward 之前失败，提交留在工作分支，Issue 停在 blocked。

#[cfg(test)]
use std::cell::{Cell, RefCell};
use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use super::command::{self, GitCommandError};

const RETRY_ATTEMPTS: u32 = 25;
const RETRY_DELAY: Duration = Duration::from_millis(120);

pub(crate) fn run_git(repo_path: &Path, args: &[&str]) -> Result<String, GitCommandError> {
    let attempts = retry_attempts();
    let delay = retry_delay();
    let mut attempt = 0u32;
    loop {
        match command::run_git(repo_path, args) {
            Ok(output) => return Ok(output),
            Err(error) if is_index_lock_contention(&error) && attempt + 1 < attempts => {
                attempt += 1;
                #[cfg(test)]
                release_contended_lock_for_test();
                if !delay.is_zero() {
                    thread::sleep(delay);
                }
            }
            Err(error) => return Err(error),
        }
    }
}

fn retry_attempts() -> u32 {
    #[cfg(test)]
    if let Some(attempts) = RETRY_ATTEMPTS_OVERRIDE.with(Cell::get) {
        return attempts.max(1);
    }
    RETRY_ATTEMPTS
}

fn retry_delay() -> Duration {
    #[cfg(test)]
    if let Some(delay) = RETRY_DELAY_OVERRIDE.with(Cell::get) {
        return delay;
    }
    RETRY_DELAY
}

#[cfg(test)]
fn release_contended_lock_for_test() {
    LOCK_TO_CLEAR.with(|slot| {
        if let Some(path) = slot.borrow().as_ref() {
            let _ = std::fs::remove_file(path);
        }
    });
}

pub(crate) fn is_index_lock_contention(error: &GitCommandError) -> bool {
    match error {
        GitCommandError::Failed { message, .. } => {
            message.contains("index.lock") && message.contains("File exists")
        }
        GitCommandError::OutputInvalid { .. } => false,
    }
}

#[cfg(test)]
thread_local! {
    static LOCK_TO_CLEAR: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
    static RETRY_ATTEMPTS_OVERRIDE: Cell<Option<u32>> = const { Cell::new(None) };
    static RETRY_DELAY_OVERRIDE: Cell<Option<Duration>> = const { Cell::new(None) };
}

#[cfg(test)]
pub(super) struct IndexLockRetryGuard {
    attempts: Option<u32>,
    delay: Option<Duration>,
    lock_to_clear: Option<PathBuf>,
}

#[cfg(test)]
impl Drop for IndexLockRetryGuard {
    fn drop(&mut self) {
        RETRY_ATTEMPTS_OVERRIDE.with(|slot| slot.set(self.attempts.take()));
        RETRY_DELAY_OVERRIDE.with(|slot| slot.set(self.delay.take()));
        LOCK_TO_CLEAR.with(|slot| *slot.borrow_mut() = self.lock_to_clear.take());
    }
}

#[cfg(test)]
pub(super) fn override_index_lock_retry_for_test(
    attempts: u32,
    delay: Duration,
    lock_to_clear: Option<&Path>,
) -> IndexLockRetryGuard {
    IndexLockRetryGuard {
        attempts: RETRY_ATTEMPTS_OVERRIDE.with(|slot| slot.replace(Some(attempts))),
        delay: RETRY_DELAY_OVERRIDE.with(|slot| slot.replace(Some(delay))),
        lock_to_clear: LOCK_TO_CLEAR
            .with(|slot| slot.replace(lock_to_clear.map(|path| path.to_path_buf()))),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::Duration;

    use tempfile::tempdir;

    use super::is_index_lock_contention;
    use crate::git::command::GitCommandError;
    use crate::git::worktree::{fast_forward_branch, rebase_branch_onto};

    #[test]
    fn index_lock_message_matches_checkout_failure() {
        let error = GitCommandError::Failed {
            command: "git checkout issue-119".to_string(),
            message:
                "fatal: Unable to create '/repo/.git/worktrees/issue-119/index.lock': File exists."
                    .to_string(),
        };
        assert!(is_index_lock_contention(&error));
    }

    #[test]
    fn rebase_onto_retries_cleared_index_lock_and_fast_forward_lands_commit() {
        let fixture = WorktreeFixture::new("issue-119");
        let lock = fixture.worktree_index_lock();
        fs::write(&lock, "").expect("plant index.lock");
        // 第一次 checkout 撞锁后清掉，模拟并发 git status 结束。
        let _guard = super::override_index_lock_retry_for_test(4, Duration::ZERO, Some(&lock));

        rebase_branch_onto(&fixture.worktree, "issue-119", "main")
            .expect("rebase after lock clears");
        fast_forward_branch(&fixture.repo, "main", "issue-119").expect("fast-forward");

        assert_eq!(
            fs::read_to_string(fixture.repo.join("feature.txt")).expect("merged file"),
            "feature\n"
        );
    }

    #[test]
    fn rebase_onto_leaves_target_unchanged_when_index_lock_stays() {
        let fixture = WorktreeFixture::new("issue-119");
        let lock = fixture.worktree_index_lock();
        fs::write(&lock, "").expect("plant index.lock");
        let _guard = super::override_index_lock_retry_for_test(2, Duration::ZERO, None);

        let error = rebase_branch_onto(&fixture.worktree, "issue-119", "main")
            .expect_err("persistent lock must fail");
        let message = error.to_string();
        assert!(
            message.contains("git checkout issue-119"),
            "unexpected error: {message}"
        );
        assert!(
            message.contains("index.lock"),
            "unexpected error: {message}"
        );
        assert!(
            !fixture.repo.join("feature.txt").exists(),
            "target branch must not receive the commit"
        );
    }

    struct WorktreeFixture {
        _temp: tempfile::TempDir,
        repo: PathBuf,
        worktree: PathBuf,
    }

    impl WorktreeFixture {
        fn new(branch: &str) -> Self {
            let temp_dir = tempdir().expect("temp dir");
            let repo = temp_dir.path().join("repo");
            let worktree = temp_dir.path().join("worktrees").join(branch);
            fs::create_dir_all(&repo).expect("repo dir");
            git(&repo, &["init"]);
            git(&repo, &["config", "user.email", "redwhisk@example.test"]);
            git(&repo, &["config", "user.name", "RedWhisk Test"]);
            git(&repo, &["checkout", "-b", "main"]);
            fs::write(repo.join("base.txt"), "base\n").expect("base");
            git(&repo, &["add", "base.txt"]);
            git(&repo, &["commit", "-m", "initial"]);
            git(
                &repo,
                &[
                    "worktree",
                    "add",
                    "-b",
                    branch,
                    worktree.to_str().expect("utf8 worktree"),
                    "main",
                ],
            );
            fs::write(worktree.join("feature.txt"), "feature\n").expect("feature");
            git(&worktree, &["add", "feature.txt"]);
            git(&worktree, &["commit", "-m", "feature"]);
            Self {
                _temp: temp_dir,
                repo,
                worktree,
            }
        }

        fn worktree_index_lock(&self) -> PathBuf {
            let git_dir = git_stdout(
                &self.worktree,
                &["rev-parse", "--path-format=absolute", "--git-dir"],
            );
            PathBuf::from(git_dir.trim()).join("index.lock")
        }
    }

    fn git(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_stdout(repo: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).expect("utf8")
    }
}
