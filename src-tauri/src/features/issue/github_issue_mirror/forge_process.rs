use std::path::Path;
use std::process::Command;

use crate::git::command::apply_interactive_path;

use super::port::ForgeIssueError;

pub(super) fn capture_forge_stdout(
    program: &str,
    args: &[String],
    repo_dir: &Path,
) -> Result<String, ForgeIssueError> {
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
    apply_interactive_path(&mut command);
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
mod tests {
    use std::path::PathBuf;

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
        let resolved = crate::agent::command_detector::resolved_interactive_shell_path();
        let path_env = command
            .get_envs()
            .find(|(key, _)| *key == "PATH")
            .map(|(_, value)| value.map(std::ffi::OsStr::to_os_string));
        match resolved {
            Some(path) => assert_eq!(path_env, Some(Some(path))),
            None => assert!(path_env.is_none()),
        }
    }
}
