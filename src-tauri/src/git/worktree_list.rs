//! 合并同一仓库上并发的 `git worktree list`。
//!
//! 窗口重新聚焦时，文件 stat、工作区 roots、每个已展开目录的文件树和变更徽标会同时
//! 解析工作区根，而每次解析都会再起一次 `git worktree list`。进程文件描述符接近上限时，
//! 其中一次 spawn 会以 `Too many open files (os error 24)` 失败。这里让同一规范路径上
//! 正在进行的列举只跑一次；结束后的下一次调用仍重新执行，避免挡住刚创建的 worktree。
//! 失败不共享给稍后的调用，下一轮可以重试。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, OnceLock};

use crate::types::session_workspace::CodeWorkspaceRoot;

use super::worktree::{ensure_repo_dir, run_git, GitWorktreeError};

struct Flight {
    slot: Mutex<Option<Result<Vec<CodeWorkspaceRoot>, GitWorktreeError>>>,
    done: Condvar,
}

struct CoalesceState {
    inflight: HashMap<PathBuf, Arc<Flight>>,
}

impl CoalesceState {
    fn new() -> Self {
        Self {
            inflight: HashMap::new(),
        }
    }
}

fn global_state() -> &'static Mutex<CoalesceState> {
    static STATE: OnceLock<Mutex<CoalesceState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(CoalesceState::new()))
}

pub fn list_code_workspaces(
    repo_path: impl AsRef<Path>,
) -> Result<Vec<CodeWorkspaceRoot>, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let project_root = repo_path.canonicalize().map_err(|error| {
        GitWorktreeError::InvalidRepoPath(format!("{}: {error}", repo_path.to_string_lossy()))
    })?;
    load_coalesced(global_state(), project_root.clone(), || {
        list_uncached(&repo_path, &project_root)
    })
}

fn list_uncached(
    repo_path: &Path,
    project_root: &Path,
) -> Result<Vec<CodeWorkspaceRoot>, GitWorktreeError> {
    let output = run_git(repo_path, &["worktree", "list", "--porcelain"])?;
    let mut roots = Vec::new();
    let mut workspace_path: Option<String> = None;
    let mut branch: Option<String> = None;

    let append_workspace = |roots: &mut Vec<CodeWorkspaceRoot>,
                            workspace_path: &mut Option<String>,
                            branch: &mut Option<String>| {
        let Some(path) = workspace_path.take() else {
            return;
        };
        let is_project_root = Path::new(&path)
            .canonicalize()
            .is_ok_and(|candidate| candidate == project_root);
        roots.push(CodeWorkspaceRoot {
            branch: branch.take().unwrap_or_else(|| "HEAD".to_string()),
            path,
            is_project_root,
        });
    };
    for line in output.lines().chain(std::iter::once("")) {
        if let Some(path) = line.strip_prefix("worktree ") {
            workspace_path = Some(path.to_string());
        } else if let Some(value) = line.strip_prefix("branch refs/heads/") {
            branch = Some(value.to_string());
        } else if line.is_empty() {
            append_workspace(&mut roots, &mut workspace_path, &mut branch);
        }
    }
    roots.sort_by(|left, right| {
        right
            .is_project_root
            .cmp(&left.is_project_root)
            .then_with(|| left.branch.cmp(&right.branch))
    });
    Ok(roots)
}

fn load_coalesced(
    state: &Mutex<CoalesceState>,
    key: PathBuf,
    load: impl FnOnce() -> Result<Vec<CodeWorkspaceRoot>, GitWorktreeError>,
) -> Result<Vec<CodeWorkspaceRoot>, GitWorktreeError> {
    enum Claim {
        Leader(Arc<Flight>),
        Waiter(Arc<Flight>),
    }

    let claim = {
        let mut guard = lock(state);
        if let Some(flight) = guard.inflight.get(&key) {
            Claim::Waiter(Arc::clone(flight))
        } else {
            let flight = Arc::new(Flight {
                slot: Mutex::new(None),
                done: Condvar::new(),
            });
            guard.inflight.insert(key.clone(), Arc::clone(&flight));
            Claim::Leader(flight)
        }
    };

    match claim {
        Claim::Waiter(flight) => wait_for(&flight),
        Claim::Leader(flight) => lead(state, &key, &flight, load),
    }
}

fn lead(
    state: &Mutex<CoalesceState>,
    key: &Path,
    flight: &Flight,
    load: impl FnOnce() -> Result<Vec<CodeWorkspaceRoot>, GitWorktreeError>,
) -> Result<Vec<CodeWorkspaceRoot>, GitWorktreeError> {
    let mut abort = AbortOnPanic {
        state,
        key,
        flight,
        armed: true,
    };
    let result = load();
    abort.armed = false;
    publish(state, key, flight, result)
}

fn publish(
    state: &Mutex<CoalesceState>,
    key: &Path,
    flight: &Flight,
    result: Result<Vec<CodeWorkspaceRoot>, GitWorktreeError>,
) -> Result<Vec<CodeWorkspaceRoot>, GitWorktreeError> {
    lock(state).inflight.remove(key);
    let mut slot = lock(&flight.slot);
    *slot = Some(result.clone());
    flight.done.notify_all();
    result
}

fn wait_for(flight: &Flight) -> Result<Vec<CodeWorkspaceRoot>, GitWorktreeError> {
    let mut slot = lock(&flight.slot);
    while slot.is_none() {
        slot = flight
            .done
            .wait(slot)
            .unwrap_or_else(|error| error.into_inner());
    }
    slot.clone()
        .expect("flight result is published before waiters resume")
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

struct AbortOnPanic<'a> {
    state: &'a Mutex<CoalesceState>,
    key: &'a Path,
    flight: &'a Flight,
    armed: bool,
}

impl Drop for AbortOnPanic<'_> {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let _ = publish(
            self.state,
            self.key,
            self.flight,
            Err(GitWorktreeError::GitCommandFailed {
                command: "git worktree list --porcelain".to_string(),
                message: "worktree list interrupted".to_string(),
            }),
        );
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier, Mutex};
    use std::thread;
    use std::time::Duration;

    use super::{load_coalesced, CoalesceState};
    use crate::git::worktree::GitWorktreeError;

    fn key() -> std::path::PathBuf {
        std::path::PathBuf::from("/tmp/redwhisk-worktree-list")
    }

    #[test]
    fn concurrent_callers_share_one_worktree_list() {
        let state = Arc::new(Mutex::new(CoalesceState::new()));
        let calls = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(Barrier::new(8));
        let mut handles = Vec::new();

        for _ in 0..8 {
            let calls = Arc::clone(&calls);
            let barrier = Arc::clone(&barrier);
            let state = Arc::clone(&state);
            handles.push(thread::spawn(move || {
                barrier.wait();
                load_coalesced(&state, key(), || {
                    calls.fetch_add(1, Ordering::SeqCst);
                    thread::sleep(Duration::from_millis(40));
                    Ok(Vec::new())
                })
                .expect("shared list")
            }));
        }

        for handle in handles {
            handle.join().expect("worker");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn failed_worktree_list_is_not_reused() {
        let state = Mutex::new(CoalesceState::new());
        let calls = AtomicUsize::new(0);

        assert!(load_coalesced(&state, key(), || {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(GitWorktreeError::InvalidRepoPath("busy".to_string()))
        })
        .is_err());
        assert!(load_coalesced(&state, key(), || {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(GitWorktreeError::InvalidRepoPath("busy".to_string()))
        })
        .is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn completed_worktree_list_does_not_hide_a_later_call() {
        let state = Mutex::new(CoalesceState::new());
        let calls = AtomicUsize::new(0);

        load_coalesced(&state, key(), || {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(Vec::new())
        })
        .expect("first");
        load_coalesced(&state, key(), || {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(Vec::new())
        })
        .expect("second");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
}
