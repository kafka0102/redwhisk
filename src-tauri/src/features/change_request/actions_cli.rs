use std::path::Path;

use crate::features::issue::{capture_forge_stdout, ForgeIssueError, RemoteChangeRequestDetails};

use super::detail_cli::{fetch_github_change_request_details, fetch_gitlab_change_request_details};

pub(crate) fn mark_ready(
    program: &str,
    repo_dir: &Path,
    number: i64,
) -> Result<RemoteChangeRequestDetails, ForgeIssueError> {
    let number_text = number.to_string();
    let args = if program == "glab" {
        vec![
            "mr".to_string(),
            "update".to_string(),
            number_text,
            "--ready".to_string(),
            "--yes".to_string(),
        ]
    } else {
        vec!["pr".to_string(), "ready".to_string(), number_text]
    };
    capture_forge_stdout(program, &args, repo_dir)?;
    refresh(program, repo_dir, number)
}

pub(crate) fn request_review(
    program: &str,
    repo_dir: &Path,
    number: i64,
    reviewer: &str,
) -> Result<RemoteChangeRequestDetails, ForgeIssueError> {
    let number_text = number.to_string();
    let args = if program == "glab" {
        vec![
            "mr".to_string(),
            "update".to_string(),
            number_text,
            "--reviewer".to_string(),
            format!("+{reviewer}"),
            "--yes".to_string(),
        ]
    } else {
        vec![
            "pr".to_string(),
            "edit".to_string(),
            number_text,
            "--add-reviewer".to_string(),
            reviewer.to_string(),
        ]
    };
    capture_forge_stdout(program, &args, repo_dir)?;
    refresh(program, repo_dir, number)
}

pub(crate) fn close_request(
    program: &str,
    repo_dir: &Path,
    number: i64,
) -> Result<RemoteChangeRequestDetails, ForgeIssueError> {
    let number_text = number.to_string();
    let args = if program == "glab" {
        vec![
            "mr".to_string(),
            "close".to_string(),
            number_text,
            "--yes".to_string(),
        ]
    } else {
        vec!["pr".to_string(), "close".to_string(), number_text]
    };
    capture_forge_stdout(program, &args, repo_dir)?;
    refresh(program, repo_dir, number)
}

fn refresh(
    program: &str,
    repo_dir: &Path,
    number: i64,
) -> Result<RemoteChangeRequestDetails, ForgeIssueError> {
    if program == "glab" {
        fetch_gitlab_change_request_details(repo_dir, number)
    } else {
        fetch_github_change_request_details(repo_dir, number)
    }
}
