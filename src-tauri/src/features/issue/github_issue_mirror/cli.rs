use super::forge_process::capture_forge_stdout;
use super::gitlab::GitlabCliForge;
use super::parse::parse_github_issue_list;
use super::port::{
    ForgeIssueError, ForgeIssueListQuery, ForgeIssuePort, RemoteIssue, RemoteIssueState,
};
use crate::types::project_issue_source::ForgeProvider;
use chrono::TimeZone;

pub struct GithubCliForge {
    pub repo_dir: std::path::PathBuf,
}

pub(crate) enum ProjectIssueForge {
    Github(GithubCliForge),
    Gitlab(GitlabCliForge),
}

impl ProjectIssueForge {
    pub(crate) fn new(provider: Option<ForgeProvider>, repo_dir: std::path::PathBuf) -> Self {
        match provider {
            Some(ForgeProvider::Gitlab) => Self::Gitlab(GitlabCliForge { repo_dir }),
            _ => Self::Github(GithubCliForge { repo_dir }),
        }
    }

    #[cfg(test)]
    pub(crate) fn program(&self) -> &'static str {
        match self {
            Self::Github(_) => "gh",
            Self::Gitlab(_) => "glab",
        }
    }
}

impl ForgeIssuePort for ProjectIssueForge {
    fn list_issues(
        &self,
        query: &ForgeIssueListQuery,
    ) -> Result<Vec<RemoteIssue>, ForgeIssueError> {
        match self {
            Self::Github(forge) => forge.list_issues(query),
            Self::Gitlab(forge) => forge.list_issues(query),
        }
    }
}

impl ForgeIssuePort for GithubCliForge {
    fn list_issues(
        &self,
        query: &ForgeIssueListQuery,
    ) -> Result<Vec<RemoteIssue>, ForgeIssueError> {
        let stdout = capture_forge_stdout("gh", &github_issue_list_args(query), &self.repo_dir)?;
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
