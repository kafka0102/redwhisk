use std::path::Path;

use super::forge_process::capture_forge_stdout;
use super::gitlab::parse_gitlab_issue;
use super::parse::parse_github_issue;
use super::port::{ForgeIssueDraft, ForgeIssueError, RemoteIssue};

pub(super) fn github_issue_create_args(draft: &ForgeIssueDraft) -> Vec<String> {
    vec![
        "issue".to_string(),
        "create".to_string(),
        "--title".to_string(),
        draft.title.clone(),
        "--body".to_string(),
        draft.body.clone(),
    ]
}

pub(super) fn github_issue_view_args(number: i64) -> Vec<String> {
    vec![
        "issue".to_string(),
        "view".to_string(),
        number.to_string(),
        "--json".to_string(),
        "id,number,title,body,state,url,author,assignees,labels".to_string(),
    ]
}

pub(super) fn gitlab_issue_create_args(draft: &ForgeIssueDraft) -> Vec<String> {
    vec![
        "issue".to_string(),
        "create".to_string(),
        "--title".to_string(),
        draft.title.clone(),
        "--description".to_string(),
        draft.body.clone(),
        "--no-editor".to_string(),
        "--yes".to_string(),
    ]
}

pub(super) fn gitlab_issue_view_args(number: i64) -> Vec<String> {
    vec![
        "issue".to_string(),
        "view".to_string(),
        number.to_string(),
        "--output".to_string(),
        "json".to_string(),
    ]
}

pub(super) fn create_then_view(
    program: &str,
    create_args: &[String],
    repo_dir: &Path,
    view_args: impl Fn(i64) -> Vec<String>,
    parse_view: impl Fn(&str) -> Result<RemoteIssue, ForgeIssueError>,
) -> Result<RemoteIssue, ForgeIssueError> {
    let stdout = capture_forge_stdout(program, create_args, repo_dir)?;
    let url = first_http_url(&stdout).ok_or(ForgeIssueError::Unparseable)?;
    let number = issue_number_from_url(&url).ok_or(ForgeIssueError::Unparseable)?;
    let viewed = capture_forge_stdout(program, &view_args(number), repo_dir)?;
    let mut issue = parse_view(&viewed)?;
    if issue.url.trim().is_empty() {
        issue.url = url;
    }
    if issue.number <= 0 {
        issue.number = number;
    }
    if issue.url.trim().is_empty() || issue.number <= 0 || issue.external_id.trim().is_empty() {
        return Err(ForgeIssueError::Unparseable);
    }
    Ok(issue)
}

pub(super) fn parse_github_issue_view(stdout: &str) -> Result<RemoteIssue, ForgeIssueError> {
    let value: serde_json::Value =
        serde_json::from_str(stdout.trim()).map_err(|_| ForgeIssueError::Unparseable)?;
    parse_github_issue(&value)
}

pub(super) fn parse_gitlab_issue_view(stdout: &str) -> Result<RemoteIssue, ForgeIssueError> {
    let value: serde_json::Value =
        serde_json::from_str(stdout.trim()).map_err(|_| ForgeIssueError::Unparseable)?;
    parse_gitlab_issue(&value).ok_or(ForgeIssueError::Unparseable)
}

fn first_http_url(stdout: &str) -> Option<String> {
    stdout.split_whitespace().find_map(|part| {
        let trimmed = part.trim_matches(|character: char| {
            character == '"' || character == '\'' || character == '<' || character == '>'
        });
        if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
            Some(trimmed.to_string())
        } else {
            None
        }
    })
}

fn issue_number_from_url(url: &str) -> Option<i64> {
    let tail = url.trim_end_matches('/').rsplit('/').next()?;
    let number = tail.parse::<i64>().ok()?;
    if number > 0 {
        Some(number)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{
        first_http_url, issue_number_from_url, parse_github_issue_view, parse_gitlab_issue_view,
    };
    use crate::features::issue::github_issue_mirror::port::{ForgeIssueError, RemoteIssueState};

    #[test]
    fn parses_created_url_and_viewed_github_issue() {
        let url = first_http_url("https://github.com/acme/redwhisk/issues/128\n").expect("url");
        assert_eq!(issue_number_from_url(&url), Some(128));
        let issue = parse_github_issue_view(
            r#"{"id":"ISSUE_128","number":128,"title":"Mirror","body":"body","state":"OPEN","url":"https://github.com/acme/redwhisk/issues/128","author":{"login":"lin"},"assignees":[{"login":"yujianjia"}],"labels":[{"name":"sync"}]}"#,
        )
        .expect("view");
        assert_eq!(issue.number, 128);
        assert_eq!(issue.url, "https://github.com/acme/redwhisk/issues/128");
        assert_eq!(issue.author_login.as_deref(), Some("lin"));
        assert_eq!(issue.labels, vec!["sync".to_string()]);
        assert_eq!(issue.assignees, vec!["yujianjia".to_string()]);
        assert_eq!(issue.state, RemoteIssueState::Open);
    }

    #[test]
    fn rejects_unreadable_create_output_and_gitlab_view() {
        assert_eq!(first_http_url("created nothing"), None);
        assert_eq!(
            issue_number_from_url("https://github.com/acme/redwhisk/issues/abc"),
            None
        );
        let issue = parse_gitlab_issue_view(
            r#"{"id":9,"iid":128,"title":"Mirror","description":"body","state":"opened","web_url":"https://gitlab.example.com/acme/redwhisk/-/issues/128","author":{"username":"lin"},"assignees":[{"username":"yujianjia"}],"labels":["sync"]}"#,
        )
        .expect("gitlab");
        assert_eq!(issue.number, 128);
        assert_eq!(issue.author_login.as_deref(), Some("lin"));
        assert_eq!(issue.labels, vec!["sync".to_string()]);
        assert!(parse_github_issue_view("not-json").is_err());
        assert_eq!(
            parse_github_issue_view("not-json").expect_err("invalid"),
            ForgeIssueError::Unparseable
        );
    }
}
