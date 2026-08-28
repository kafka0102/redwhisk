use std::ffi::OsString;
use std::path::Path;
use std::process::{Command, Output};
use std::sync::OnceLock;

use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum GitCommandError {
    #[error("git command failed for {command}: {message}")]
    Failed { command: String, message: String },
    #[error("git command output for {command} was not utf8: {message}")]
    OutputInvalid { command: String, message: String },
}

pub fn format_git_command(args: &[&str]) -> String {
    format!("git {}", args.join(" "))
}

pub fn run_git_raw(repo_path: &Path, args: &[&str]) -> Result<Output, GitCommandError> {
    build_git_command(repo_path, args)
        .output()
        .map_err(|error| GitCommandError::Failed {
            command: format_git_command(args),
            message: error.to_string(),
        })
}

pub fn run_git_bytes(repo_path: &Path, args: &[&str]) -> Result<Vec<u8>, GitCommandError> {
    let output = run_git_raw(repo_path, args)?;

    if !output.status.success() {
        return Err(GitCommandError::Failed {
            command: format_git_command(args),
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    Ok(output.stdout)
}

pub fn run_git(repo_path: &Path, args: &[&str]) -> Result<String, GitCommandError> {
    let output = run_git_bytes(repo_path, args)?;

    String::from_utf8(output)
        .map(|value| value.trim_end_matches(['\r', '\n']).to_string())
        .map_err(|error| GitCommandError::OutputInvalid {
            command: format_git_command(args),
            message: error.to_string(),
        })
}

fn build_git_command(repo_path: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command.args(args).current_dir(repo_path);
    if let Some(path) = interactive_shell_path() {
        command.env("PATH", path);
    }
    command
}

/// GUI（Dock/Finder）启动时进程 PATH 来自 launchd，不含用户在 `.zshrc` 写入的
/// nvm/fnm 等目录。`git push` / `commit` 触发的 hook 会因此找不到 `pnpm`。
/// 注入与 PTY 相同的 login+interactive PATH；解析失败则继承当前进程 PATH。
fn interactive_shell_path() -> Option<OsString> {
    #[cfg(test)]
    if let Some(overridden) = test_interactive_path() {
        return overridden;
    }

    cached_interactive_shell_path()
}

fn cached_interactive_shell_path() -> Option<OsString> {
    static CACHED: OnceLock<Option<OsString>> = OnceLock::new();
    CACHED
        .get_or_init(crate::agent::command_detector::resolve_interactive_shell_path)
        .clone()
}

#[cfg(test)]
thread_local! {
    static TEST_INTERACTIVE_PATH: std::cell::RefCell<Option<Option<OsString>>> =
        std::cell::RefCell::new(None);
}

#[cfg(test)]
fn test_interactive_path() -> Option<Option<OsString>> {
    TEST_INTERACTIVE_PATH.with(|slot| slot.borrow().clone())
}

#[cfg(test)]
struct InteractivePathGuard {
    previous: Option<Option<OsString>>,
}

#[cfg(test)]
impl Drop for InteractivePathGuard {
    fn drop(&mut self) {
        TEST_INTERACTIVE_PATH.with(|slot| {
            *slot.borrow_mut() = self.previous.take();
        });
    }
}

#[cfg(test)]
fn with_interactive_path<T>(path: Option<OsString>, f: impl FnOnce() -> T) -> T {
    let _guard = TEST_INTERACTIVE_PATH.with(|slot| {
        let previous = slot.replace(Some(path));
        InteractivePathGuard { previous }
    });
    f()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};

    use tempfile::tempdir;

    const HOOK_PROBE: &str = "redwhisk-git-hook-probe";

    #[test]
    fn run_git_hook_finds_binary_from_injected_interactive_path() {
        let env = HookTestEnv::new();
        env.write_probe();

        with_interactive_path(Some(env.path_with_probe()), || {
            env.stage_file();
            run_git(&env.repo, &["commit", "-m", "hooked"]).expect("commit with hook");
        });

        assert_eq!(
            fs::read_to_string(&env.sentinel).expect("probe sentinel"),
            "ok"
        );
    }

    #[test]
    fn run_git_hook_reports_command_not_found_when_path_is_gui_like() {
        let env = HookTestEnv::new();

        let error = with_interactive_path(Some(OsString::from("/usr/bin:/bin")), || {
            env.stage_file();
            run_git(&env.repo, &["commit", "-m", "hooked"])
                .expect_err("gui-like PATH must fail hook")
        });

        match error {
            GitCommandError::Failed { message, .. } => {
                assert!(
                    message.contains("command not found"),
                    "expected command not found, got {message}"
                );
                assert!(
                    message.contains(HOOK_PROBE),
                    "expected missing probe name, got {message}"
                );
            }
            other => panic!("expected Failed, got {other:?}"),
        }
        assert!(!env.sentinel.exists(), "probe must not run");
    }

    struct HookTestEnv {
        _temp: tempfile::TempDir,
        repo: PathBuf,
        bin_dir: PathBuf,
        sentinel: PathBuf,
    }

    impl HookTestEnv {
        fn new() -> Self {
            let temp = tempdir().expect("temp dir");
            let repo = temp.path().join("repo");
            let bin_dir = temp.path().join("bin");
            let sentinel = temp.path().join("probe-ran");
            fs::create_dir_all(&repo).expect("repo dir");
            fs::create_dir_all(&bin_dir).expect("bin dir");

            run_plain_git(&repo, &["init"]);
            run_plain_git(&repo, &["config", "user.email", "redwhisk@example.test"]);
            run_plain_git(&repo, &["config", "user.name", "RedWhisk Test"]);
            run_plain_git(&repo, &["checkout", "-b", "main"]);

            let hook_path = repo.join(".git/hooks/pre-commit");
            fs::write(&hook_path, format!("#!/bin/sh\n{HOOK_PROBE}\n")).expect("write hook");
            fs::set_permissions(&hook_path, fs::Permissions::from_mode(0o755)).expect("chmod hook");

            Self {
                _temp: temp,
                repo,
                bin_dir,
                sentinel,
            }
        }

        fn write_probe(&self) {
            let probe = self.bin_dir.join(HOOK_PROBE);
            fs::write(
                &probe,
                format!("#!/bin/sh\nprintf ok > '{}'\n", self.sentinel.display()),
            )
            .expect("write probe");
            fs::set_permissions(&probe, fs::Permissions::from_mode(0o755)).expect("chmod probe");
        }

        fn path_with_probe(&self) -> OsString {
            let entries = [
                self.bin_dir.clone(),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
            ];
            std::env::join_paths(entries).expect("join PATH")
        }

        fn stage_file(&self) {
            fs::write(self.repo.join("file.txt"), "x\n").expect("write file");
            run_plain_git(&self.repo, &["add", "file.txt"]);
        }
    }

    fn run_plain_git(repo_dir: &Path, args: &[&str]) {
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
