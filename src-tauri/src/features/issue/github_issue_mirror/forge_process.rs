use std::path::Path;
use std::process::Command;

use crate::agent::command_detector::resolve_interactive_shell_path;

use super::port::ForgeIssueError;

pub(crate) fn capture_forge_stdout(
    program: &str,
    args: &[String],
    repo_dir: &Path,
) -> Result<String, ForgeIssueError> {
    #[cfg(test)]
    if let Some(result) = simulated_forge_result(program, args, repo_dir) {
        return result;
    }
    let mut command = forge_command(program, args, repo_dir);
    let output = match command.output() {
        Ok(output) => output,
        Err(error) => return Err(classify_spawn_error(&error)),
    };
    if !output.status.success() {
        return Err(classify_stderr(&String::from_utf8_lossy(&output.stderr)));
    }
    String::from_utf8(output.stdout).map_err(|_| ForgeIssueError::Unparseable)
}

pub(super) fn forge_command(program: &str, args: &[String], repo_dir: &Path) -> Command {
    let mut command = Command::new(program);
    command.args(args);
    command.current_dir(repo_dir);
    // Forge calls are background network work, so the first call may wait for the
    // login+interactive PATH probe. Git hot paths continue to read only the warm cache.
    if let Some(path) = resolve_interactive_shell_path() {
        command.env("PATH", path);
    }
    command
}

pub(super) fn classify_spawn_error(error: &std::io::Error) -> ForgeIssueError {
    if error.kind() == std::io::ErrorKind::NotFound {
        ForgeIssueError::CliMissing
    } else {
        ForgeIssueError::CommandFailed
    }
}

pub(super) fn classify_stderr(stderr: &str) -> ForgeIssueError {
    let text = stderr.to_ascii_lowercase();
    if text.contains("rate limit") || text.contains("too many requests") || text.contains("429") {
        return ForgeIssueError::RateLimited;
    }
    if text.contains("command not found") || text.contains("executable file not found") {
        return ForgeIssueError::CliMissing;
    }
    if text.contains("could not resolve")
        || text.contains("name resolution")
        || text.contains("network is unreachable")
        || text.contains("connection refused")
        || text.contains("connection reset")
        || text.contains("timed out")
        || text.contains("offline")
        || text.contains("no such host")
    {
        return ForgeIssueError::Offline;
    }
    if text.contains("401")
        || text.contains("unauthorized")
        || text.contains("authentication")
        || text.contains("bad credentials")
        || text.contains("auth login")
        || text.contains("not logged")
    {
        return ForgeIssueError::Unauthenticated;
    }
    if text.contains("403")
        || text.contains("forbidden")
        || text.contains("permission denied")
        || text.contains("you do not have")
        || text.contains("resource not accessible")
    {
        return ForgeIssueError::Forbidden;
    }
    if text.contains("410") || text.contains("is gone") {
        return ForgeIssueError::Gone;
    }
    if text.contains("404")
        || text.contains("could not find")
        || (text.contains("not found") && text.contains("issue"))
    {
        return ForgeIssueError::NotFound;
    }
    ForgeIssueError::CommandFailed
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ForgeInvocation {
    pub program: String,
    pub args: Vec<String>,
    pub dir: std::path::PathBuf,
}

#[cfg(test)]
struct ForgeSimulation {
    invocations: Vec<ForgeInvocation>,
    failure: Option<ForgeIssueError>,
    outputs: Vec<Result<String, ForgeIssueError>>,
}

#[cfg(test)]
thread_local! {
    static FORGE_SIMULATION: std::cell::RefCell<Option<ForgeSimulation>> =
        std::cell::RefCell::new(None);
}

#[cfg(test)]
fn simulated_forge_result(
    program: &str,
    args: &[String],
    repo_dir: &Path,
) -> Option<Result<String, ForgeIssueError>> {
    FORGE_SIMULATION.with(|slot| {
        let mut guard = slot.borrow_mut();
        let Some(simulation) = guard.as_mut() else {
            return None;
        };
        simulation.invocations.push(ForgeInvocation {
            program: program.to_string(),
            args: args.to_vec(),
            dir: repo_dir.to_path_buf(),
        });
        if !simulation.outputs.is_empty() {
            return Some(simulation.outputs.remove(0));
        }
        if let Some(failure) = simulation.failure.clone() {
            return Some(Err(failure));
        }
        // 目录不存在时，真实 spawn 是 ErrorKind::NotFound，会被收成 CliMissing。
        Some(if repo_dir.is_dir() {
            Ok(String::new())
        } else {
            Err(ForgeIssueError::CliMissing)
        })
    })
}

#[cfg(test)]
fn with_simulation<T>(
    failure: Option<ForgeIssueError>,
    f: impl FnOnce() -> T,
) -> (T, Vec<ForgeInvocation>) {
    with_simulation_outputs(failure, Vec::new(), f)
}

#[cfg(test)]
fn with_simulation_outputs<T>(
    failure: Option<ForgeIssueError>,
    outputs: Vec<Result<String, ForgeIssueError>>,
    f: impl FnOnce() -> T,
) -> (T, Vec<ForgeInvocation>) {
    struct Guard {
        previous: Option<ForgeSimulation>,
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            FORGE_SIMULATION.with(|slot| {
                *slot.borrow_mut() = self.previous.take();
            });
        }
    }

    let previous = FORGE_SIMULATION.with(|slot| {
        slot.replace(Some(ForgeSimulation {
            invocations: Vec::new(),
            failure,
            outputs,
        }))
    });
    let _guard = Guard { previous };
    let result = f();
    let invocations = FORGE_SIMULATION.with(|slot| {
        slot.borrow()
            .as_ref()
            .map(|simulation| simulation.invocations.clone())
            .unwrap_or_default()
    });
    (result, invocations)
}

#[cfg(test)]
pub(crate) fn with_captured_forge_dirs<T>(f: impl FnOnce() -> T) -> (T, Vec<std::path::PathBuf>) {
    let (result, invocations) = with_simulation(None, f);
    let dirs = invocations
        .into_iter()
        .map(|invocation| invocation.dir)
        .collect();
    (result, dirs)
}

#[cfg(test)]
pub(crate) fn with_captured_forge_invocations<T>(
    f: impl FnOnce() -> T,
) -> (T, Vec<ForgeInvocation>) {
    with_simulation(None, f)
}

#[cfg(test)]
pub(crate) fn with_simulated_forge_failure<T>(
    failure: ForgeIssueError,
    f: impl FnOnce() -> T,
) -> (T, Vec<ForgeInvocation>) {
    with_simulation(Some(failure), f)
}

#[cfg(test)]
pub(crate) fn with_scripted_forge_output<T>(
    outputs: Vec<Result<String, ForgeIssueError>>,
    f: impl FnOnce() -> T,
) -> (T, Vec<ForgeInvocation>) {
    with_simulation_outputs(None, outputs, f)
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::PathBuf;

    use crate::agent::command_detector::pin_test_interactive_shell_path;
    use crate::types::project_issue_source::ForgeProvider;

    use super::super::cli::ProjectIssueForge;
    use super::super::gitlab::gitlab_issue_list_args;
    use super::super::port::{ForgeIssueError, ForgeIssueListQuery, RemoteIssueState};
    use super::{classify_spawn_error, classify_stderr, forge_command};

    #[test]
    fn classifies_spawn_and_stderr_without_treating_other_failures_as_expired() {
        let missing = std::io::Error::new(std::io::ErrorKind::NotFound, "no glab");
        assert_eq!(classify_spawn_error(&missing), ForgeIssueError::CliMissing);
        let denied = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
        assert_eq!(
            classify_spawn_error(&denied),
            ForgeIssueError::CommandFailed
        );
        assert_eq!(
            classify_stderr("HTTP 429: rate limit exceeded"),
            ForgeIssueError::RateLimited
        );
        assert_eq!(
            classify_stderr("Could not resolve host gitlab.example.com"),
            ForgeIssueError::Offline
        );
        assert_eq!(
            classify_stderr("glab: command not found"),
            ForgeIssueError::CliMissing
        );
        assert_eq!(
            classify_stderr("write failed"),
            ForgeIssueError::CommandFailed
        );
        assert_eq!(
            classify_stderr("HTTP 401 unauthorized"),
            ForgeIssueError::Unauthenticated
        );
        assert_eq!(
            classify_stderr("HTTP 403 forbidden"),
            ForgeIssueError::Forbidden
        );
    }

    #[test]
    fn gitlab_provider_uses_glab_and_other_providers_use_gh() {
        let repo = PathBuf::from("/tmp/redwhisk");
        assert_eq!(
            ProjectIssueForge::new(Some(ForgeProvider::Gitlab), repo.clone()).program(),
            "glab"
        );
        assert_eq!(
            ProjectIssueForge::new(Some(ForgeProvider::Github), repo.clone()).program(),
            "gh"
        );
        assert_eq!(ProjectIssueForge::new(None, repo).program(), "gh");
    }

    #[test]
    fn glab_list_command_uses_the_repo_and_interactive_path() {
        let repo = std::env::temp_dir();
        let pinned_path = OsString::from("/usr/bin:/bin");
        let _pin = pin_test_interactive_shell_path(Some(pinned_path.clone()));
        let query = ForgeIssueListQuery {
            assignee: None,
            states: vec![RemoteIssueState::Open],
            label: None,
            limit: 500,
            updated_after: None,
        };
        let command = forge_command("glab", &gitlab_issue_list_args(&query), &repo);
        assert_eq!(command.get_program().to_string_lossy(), "glab");
        assert_eq!(command.get_current_dir(), Some(repo.as_path()));
        let rendered: Vec<String> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(rendered
            .windows(2)
            .any(|pair| pair[0] == "--output" && pair[1] == "json"));
        assert!(!rendered.windows(2).any(|pair| pair[0] == "-F"));
        assert!(!rendered
            .iter()
            .any(|arg| arg.to_ascii_lowercase().contains("token")));
        assert!(!rendered.iter().any(|arg| arg.contains("gitlab.com")));
        let path_env = command
            .get_envs()
            .find(|(key, _)| *key == "PATH")
            .map(|(_, value)| value.map(std::ffi::OsStr::to_os_string));
        assert_eq!(path_env, Some(Some(pinned_path)));
    }

    #[test]
    fn missing_forge_spawn_still_classifies_cli_missing() {
        let repo = std::env::temp_dir();
        let _pin = pin_test_interactive_shell_path(Some(OsString::from("/usr/bin:/bin")));

        let error =
            super::capture_forge_stdout("redwhisk-forge-cli-that-does-not-exist", &[], &repo)
                .expect_err("missing forge");

        assert_eq!(error, ForgeIssueError::CliMissing);
    }
}
