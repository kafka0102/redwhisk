use chrono::TimeZone;
use std::process::Command;

use crate::git::command::apply_interactive_path;

use super::parse::parse_github_issue_list;
use super::port::{
    ForgeIssueError, ForgeIssueListQuery, ForgeIssuePort, RemoteIssue, RemoteIssueState,
};

pub struct GithubCliForge {
    pub repo_dir: std::path::PathBuf,
}

impl ForgeIssuePort for GithubCliForge {
    fn list_issues(
        &self,
        query: &ForgeIssueListQuery,
    ) -> Result<Vec<RemoteIssue>, ForgeIssueError> {
        let mut command = Command::new("gh");
        command.args(github_issue_list_args(query));
        command.current_dir(&self.repo_dir);
        apply_interactive_path(&mut command);
        let output = command
            .output()
            .map_err(|_| ForgeIssueError::CommandFailed)?;
        if !output.status.success() {
            return Err(ForgeIssueError::CommandFailed);
        }
        let stdout = String::from_utf8(output.stdout).map_err(|_| ForgeIssueError::Unparseable)?;
        parse_github_issue_list(&stdout)
    }
}

pub fn github_issue_list_args(query: &ForgeIssueListQuery) -> Vec<String> {
    let mut args = vec!["issue".to_string(), "list".to_string()];
    let state = if query.states.contains(&RemoteIssueState::Closed) {
        "all"
    } else {
        "open"
    };
    args.extend(["--state".to_string(), state.to_string()]);
    if let Some(assignee) = &query.assignee {
        args.extend(["--assignee".to_string(), assignee.clone()]);
    }
    if let Some(label) = &query.label {
        args.extend(["--label".to_string(), label.clone()]);
    }
    args.extend(["--limit".to_string(), query.limit.to_string()]);
    if let Some(updated_after) = query.updated_after {
        args.extend([
            "--search".to_string(),
            format!("updated:>={}", millis_to_utc_timestamp(updated_after)),
        ]);
    }
    args.extend([
        "--json".to_string(),
        "id,number,title,body,state,updatedAt,url,author,assignees,labels".to_string(),
    ]);
    args
}

fn millis_to_utc_timestamp(millis: i64) -> String {
    chrono::Utc
        .timestamp_millis_opt(millis)
        .single()
        .unwrap_or_else(|| chrono::Utc.timestamp_millis_opt(0).unwrap())
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}
