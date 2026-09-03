use std::path::{Path, PathBuf};

use serde::Serialize;
use thiserror::Error;

use crate::git::command::{self, GitCommandError};
use crate::git::operation_state::{detect_operation_state, GitOperationState};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSnapshot {
    pub head: String,
    pub status_porcelain: String,
    pub changed_files: Vec<GitChangedFile>,
    pub operation_state: GitOperationState,
    pub is_clean: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub status: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitCommitDetectionResult {
    NewCommit { commit_hash: String },
    NoCommitDetected,
    HeadMovedWithoutNewCommit { head: String },
    OperationInProgress { operation_state: GitOperationState },
}

#[derive(Debug, Error)]
pub enum GitStatusError {
    #[error("repo path is not an accessible directory: {0}")]
    InvalidRepoPath(String),
    #[error("git command failed for {command}: {message}")]
    GitCommandFailed { command: String, message: String },
    #[error("git command output for {command} was not utf8: {message}")]
    GitOutputInvalid { command: String, message: String },
    #[error("git status porcelain output was invalid: {0}")]
    GitStatusParseFailed(String),
}

impl From<GitCommandError> for GitStatusError {
    fn from(error: GitCommandError) -> Self {
        match error {
            GitCommandError::Failed { command, message } => {
                Self::GitCommandFailed { command, message }
            }
            GitCommandError::OutputInvalid { command, message } => {
                Self::GitOutputInvalid { command, message }
            }
        }
    }
}

pub fn read_git_snapshot(repo_path: impl AsRef<Path>) -> Result<GitSnapshot, GitStatusError> {
    let repo_path = repo_path.as_ref();
    if !repo_path.is_dir() {
        return Err(GitStatusError::InvalidRepoPath(
            repo_path.to_string_lossy().to_string(),
        ));
    }

    let head = run_git(repo_path, &["rev-parse", "HEAD"])?;
    let git_dir = resolve_git_dir(repo_path)?;
    let status_porcelain = run_git(repo_path, &["status", "--porcelain=v1"])?;
    let status_porcelain_z = run_git_bytes(repo_path, &["status", "--porcelain=v1", "-z"])?;
    let changed_files = parse_changed_files_z(&status_porcelain_z)?;
    let mut operation_state = detect_operation_state(git_dir);
    if operation_state == GitOperationState::None
        && changed_files
            .iter()
            .any(|file| is_unmerged_status(&file.status))
    {
        operation_state = GitOperationState::Unmerged;
    }
    let is_clean = status_porcelain_z.is_empty();

    Ok(GitSnapshot {
        head,
        status_porcelain,
        changed_files,
        operation_state,
        is_clean,
    })
}

pub fn detect_commit_result(
    repo_path: impl AsRef<Path>,
    before: &GitSnapshot,
    after: &GitSnapshot,
) -> Result<GitCommitDetectionResult, GitStatusError> {
    if before.operation_state != GitOperationState::None {
        return Ok(GitCommitDetectionResult::OperationInProgress {
            operation_state: before.operation_state,
        });
    }

    if after.operation_state != GitOperationState::None {
        return Ok(GitCommitDetectionResult::OperationInProgress {
            operation_state: after.operation_state,
        });
    }

    if before.head == after.head {
        return Ok(GitCommitDetectionResult::NoCommitDetected);
    }

    if is_ancestor(repo_path.as_ref(), &before.head, &after.head)? {
        return Ok(GitCommitDetectionResult::NewCommit {
            commit_hash: after.head.clone(),
        });
    }

    Ok(GitCommitDetectionResult::HeadMovedWithoutNewCommit {
        head: after.head.clone(),
    })
}

fn resolve_git_dir(repo_path: &Path) -> Result<PathBuf, GitStatusError> {
    let git_dir = run_git(repo_path, &["rev-parse", "--git-dir"])?;
    let git_dir_path = Path::new(&git_dir);

    if git_dir_path.is_absolute() {
        return Ok(git_dir_path.to_path_buf());
    }

    Ok(repo_path.join(git_dir_path))
}

fn parse_changed_files_z(status_porcelain_z: &[u8]) -> Result<Vec<GitChangedFile>, GitStatusError> {
    let mut files = Vec::new();
    let mut records = status_porcelain_z
        .split(|byte| *byte == b'\0')
        .filter(|record| !record.is_empty());

    while let Some(record) = records.next() {
        if record.len() < 4 || record[2] != b' ' {
            return Err(GitStatusError::GitStatusParseFailed(
                "expected porcelain v1 entry in '<xy> <path>' form".to_string(),
            ));
        }

        let status = String::from_utf8(record[..2].to_vec()).map_err(|error| {
            GitStatusError::GitStatusParseFailed(format!("status code was not utf8: {error}"))
        })?;
        let path = path_bytes_to_string(&record[3..]);
        let old_path = if is_rename_or_copy_status(&status) {
            let old_path = records.next().ok_or_else(|| {
                GitStatusError::GitStatusParseFailed(
                    "rename/copy entry was missing the source path".to_string(),
                )
            })?;
            Some(path_bytes_to_string(old_path))
        } else {
            None
        };

        files.push(GitChangedFile {
            status,
            path,
            old_path,
        });
    }

    Ok(files)
}

fn is_rename_or_copy_status(status: &str) -> bool {
    status
        .as_bytes()
        .iter()
        .any(|byte| matches!(byte, b'R' | b'C'))
}

fn is_unmerged_status(status: &str) -> bool {
    matches!(status, "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU")
}

fn path_bytes_to_string(path: &[u8]) -> String {
    String::from_utf8_lossy(path).to_string()
}

fn run_git(repo_path: &Path, args: &[&str]) -> Result<String, GitStatusError> {
    command::run_git(repo_path, args).map_err(GitStatusError::from)
}

fn run_git_bytes(repo_path: &Path, args: &[&str]) -> Result<Vec<u8>, GitStatusError> {
    command::run_git_bytes(repo_path, args).map_err(GitStatusError::from)
}

fn is_ancestor(repo_path: &Path, ancestor: &str, descendant: &str) -> Result<bool, GitStatusError> {
    let output = command::run_git_raw(
        repo_path,
        &["merge-base", "--is-ancestor", ancestor, descendant],
    )
    .map_err(map_ancestor_command_error)?;

    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(GitStatusError::GitCommandFailed {
            command: "git merge-base --is-ancestor".to_string(),
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        }),
    }
}

fn map_ancestor_command_error(error: GitCommandError) -> GitStatusError {
    match error {
        GitCommandError::Failed { message, .. } => GitStatusError::GitCommandFailed {
            command: "git merge-base --is-ancestor".to_string(),
            message,
        },
        other => other.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_changed_files_z, GitStatusError};

    #[test]
    fn parses_copy_entries_from_porcelain_z() {
        let files = parse_changed_files_z(b"C  copied file.txt\0original file.txt\0")
            .expect("parse copy entry");

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "C ");
        assert_eq!(files[0].path, "copied file.txt");
        assert_eq!(files[0].old_path.as_deref(), Some("original file.txt"));
    }

    #[test]
    fn parses_rename_entries_with_tabs_and_quotes_from_porcelain_z() {
        let files = parse_changed_files_z(b"R  renamed file\t\"quoted\".txt\0tracked.txt\0")
            .expect("parse rename entry");

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "R ");
        assert_eq!(files[0].path, "renamed file\t\"quoted\".txt");
        assert_eq!(files[0].old_path.as_deref(), Some("tracked.txt"));
    }

    #[test]
    fn rejects_malformed_porcelain_z_entries() {
        let error = parse_changed_files_z(b"M\0").expect_err("parse should fail");

        assert!(matches!(error, GitStatusError::GitStatusParseFailed(_)));
    }
}
