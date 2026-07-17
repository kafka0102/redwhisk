use std::path::Path;
use std::process::{Command, Output};

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
    Command::new("git")
        .args(args)
        .current_dir(repo_path)
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
