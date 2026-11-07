use super::forge_process::capture_forge_stdout;
use super::gitlab::GitlabCliForge;
use super::parse::parse_github_issue_list;
use super::port::{
    ForgeIssueDraft, ForgeIssueError, ForgeIssueListQuery, ForgeIssuePort, RemoteIssue,
    RemoteIssueState,
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

pub(crate) fn close_remote_issue(
    provider: &str,
    repo_dir: &std::path::Path,
    number: i64,
) -> Result<(), ForgeIssueError> {
    let (program, args) = if provider == "gitlab" {
        (
            "glab",
            vec!["issue".to_string(), "close".to_string(), number.to_string()],
        )
    } else {
        (
            "gh",
            vec![
                "issue".to_string(),
                "close".to_string(),
                number.to_string(),
                "--reason".to_string(),
                "completed".to_string(),
            ],
        )
    };
    super::forge_process::capture_forge_stdout(program, &args, repo_dir).map(|_| ())
}

pub(crate) fn comment_remote_issue(
    provider: &str,
    repo_dir: &std::path::Path,
    number: i64,
    body: &str,
) -> Result<(), ForgeIssueError> {
    let (program, args) = if provider == "gitlab" {
        (
            "glab",
            vec![
                "issue".to_string(),
                "note".to_string(),
                number.to_string(),
                "-m".to_string(),
                body.to_string(),
            ],
        )
    } else {
        (
            "gh",
            vec![
                "issue".to_string(),
                "comment".to_string(),
                number.to_string(),
                "--body".to_string(),
                body.to_string(),
            ],
        )
    };
    super::forge_process::capture_forge_stdout(program, &args, repo_dir).map(|_| ())
}

pub(crate) fn view_remote_issue(
    provider: &str,
    repo_dir: &std::path::Path,
    number: i64,
) -> Result<(), ForgeIssueError> {
    let (program, args) = if provider == "gitlab" {
        ("glab", super::create_cli::gitlab_issue_view_args(number))
    } else {
        ("gh", super::create_cli::github_issue_view_args(number))
    };
    super::forge_process::capture_forge_stdout(program, &args, repo_dir).map(|_| ())
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

    fn list_change_requests(
        &self,
    ) -> Result<Vec<super::port::RemoteChangeRequest>, ForgeIssueError> {
        match self {
            Self::Github(forge) => forge.list_change_requests(),
            Self::Gitlab(forge) => forge.list_change_requests(),
        }
    }

    fn create_issue(&self, draft: &ForgeIssueDraft) -> Result<RemoteIssue, ForgeIssueError> {
        match self {
            Self::Github(forge) => forge.create_issue(draft),
            Self::Gitlab(forge) => forge.create_issue(draft),
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

    fn list_change_requests(
        &self,
    ) -> Result<Vec<super::port::RemoteChangeRequest>, ForgeIssueError> {
        let stdout = capture_forge_stdout("gh", &github_pull_request_list_args(), &self.repo_dir)?;
        crate::features::change_request::parse_github_pull_request_list(&stdout)
    }

    fn create_issue(&self, draft: &ForgeIssueDraft) -> Result<RemoteIssue, ForgeIssueError> {
        super::create_cli::create_then_view(
            "gh",
            &super::create_cli::github_issue_create_args(draft),
            &self.repo_dir,
            super::create_cli::github_issue_view_args,
            super::create_cli::parse_github_issue_view,
        )
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

pub fn github_pull_request_list_args() -> Vec<String> {
    vec![
        "pr".to_string(),
        "list".to_string(),
        "--state".to_string(),
        "all".to_string(),
        "--limit".to_string(),
        "200".to_string(),
        "--json".to_string(),
        "id,number,title,body,state,isDraft,mergedAt,updatedAt,url,author,headRefName,baseRefName"
            .to_string(),
    ]
}

fn millis_to_utc_timestamp(millis: i64) -> String {
    chrono::Utc
        .timestamp_millis_opt(millis)
        .single()
        .unwrap_or_else(|| chrono::Utc.timestamp_millis_opt(0).unwrap())
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}
