use std::path::PathBuf;

use chrono::TimeZone;

use super::forge_process::capture_forge_stdout;
use super::port::{
    ChangeRequestWriteError, ForgeIssueDraft, ForgeIssueError, ForgeIssueListQuery, ForgeIssuePort,
    RemoteIssue, RemoteIssueState,
};

pub struct GitlabCliForge {
    pub repo_dir: PathBuf,
}

impl ForgeIssuePort for GitlabCliForge {
    fn list_issues(
        &self,
        query: &ForgeIssueListQuery,
    ) -> Result<Vec<RemoteIssue>, ForgeIssueError> {
        let stdout = capture_forge_stdout("glab", &gitlab_issue_list_args(query), &self.repo_dir)?;
        let issues = parse_gitlab_issue_list(&stdout)?;
        Ok(retain_issues_since(
            issues,
            query.updated_after,
            query.limit,
        ))
    }

    fn list_change_requests(
        &self,
    ) -> Result<Vec<super::port::RemoteChangeRequest>, ForgeIssueError> {
        let stdout =
            capture_forge_stdout("glab", &gitlab_merge_request_list_args(), &self.repo_dir)?;
        crate::features::change_request::parse_gitlab_merge_request_list(&stdout)
    }

    fn create_issue(&self, draft: &ForgeIssueDraft) -> Result<RemoteIssue, ForgeIssueError> {
        super::create_cli::create_then_view(
            "glab",
            &super::create_cli::gitlab_issue_create_args(draft),
            &self.repo_dir,
            super::create_cli::gitlab_issue_view_args,
            super::create_cli::parse_gitlab_issue_view,
        )
    }

    fn get_change_request_details(
        &self,
        number: i64,
    ) -> Result<super::port::RemoteChangeRequestDetails, ForgeIssueError> {
        crate::features::change_request::fetch_gitlab_change_request_details(&self.repo_dir, number)
    }

    fn mark_change_request_ready(
        &self,
        number: i64,
    ) -> Result<super::port::RemoteChangeRequestDetails, ChangeRequestWriteError> {
        crate::features::change_request::mark_ready("glab", &self.repo_dir, number)
            .map_err(ChangeRequestWriteError::Failed)
    }

    fn supports_change_request_ready(&self) -> bool {
        true
    }

    fn request_change_request_review(
        &self,
        number: i64,
        reviewer: &str,
    ) -> Result<super::port::RemoteChangeRequestDetails, ChangeRequestWriteError> {
        crate::features::change_request::request_review("glab", &self.repo_dir, number, reviewer)
            .map_err(ChangeRequestWriteError::Failed)
    }

    fn supports_change_request_review(&self) -> bool {
        true
    }

    fn close_change_request(
        &self,
        number: i64,
    ) -> Result<super::port::RemoteChangeRequestDetails, ChangeRequestWriteError> {
        crate::features::change_request::close_request("glab", &self.repo_dir, number)
            .map_err(ChangeRequestWriteError::Failed)
    }
}

pub(crate) fn retain_issues_since(
    issues: Vec<RemoteIssue>,
    updated_after: Option<i64>,
    limit: i64,
) -> Vec<RemoteIssue> {
    let cutoff = updated_after.unwrap_or(i64::MIN);
    let limit = usize::try_from(limit).unwrap_or(0);
    issues
        .into_iter()
        .filter(|issue| issue.updated_at >= cutoff)
        .take(limit)
        .collect()
}

pub fn gitlab_issue_list_args(query: &ForgeIssueListQuery) -> Vec<String> {
    let mut args = vec![
        "issue".to_string(),
        "list".to_string(),
        "--output".to_string(),
        "json".to_string(),
    ];
    if query.states.contains(&RemoteIssueState::Closed) {
        args.push("--all".to_string());
    }
    if let Some(assignee) = &query.assignee {
        args.extend(["--assignee".to_string(), assignee.clone()]);
    }
    if let Some(label) = &query.label {
        args.extend(["--label".to_string(), label.clone()]);
    }
    args.extend(["--per-page".to_string(), query.limit.to_string()]);
    if let Some(updated_after) = query.updated_after {
        args.extend([
            "--updated-after".to_string(),
            millis_to_utc_timestamp(updated_after),
        ]);
    }
    args.extend([
        "--order".to_string(),
        "updated_at".to_string(),
        "--sort".to_string(),
        "desc".to_string(),
    ]);
    args
}

pub fn gitlab_merge_request_list_args() -> Vec<String> {
    vec![
        "mr".to_string(),
        "list".to_string(),
        "--all".to_string(),
        "--output".to_string(),
        "json".to_string(),
        "--per-page".to_string(),
        "100".to_string(),
    ]
}

pub fn parse_gitlab_issue_list(stdout: &str) -> Result<Vec<RemoteIssue>, ForgeIssueError> {
    let value: serde_json::Value =
        serde_json::from_str(stdout.trim()).map_err(|_| ForgeIssueError::Unparseable)?;
    let items = value.as_array().ok_or(ForgeIssueError::Unparseable)?;
    Ok(items.iter().filter_map(parse_gitlab_issue).collect())
}

pub(super) fn parse_gitlab_issue(value: &serde_json::Value) -> Option<RemoteIssue> {
    let external_id = match value.get("id")? {
        serde_json::Value::String(id) if !id.is_empty() => id.clone(),
        serde_json::Value::Number(id) => id.to_string(),
        _ => return None,
    };
    let number = value.get("iid")?.as_i64()?;
    let title = value.get("title")?.as_str()?.trim();
    if title.is_empty() {
        return None;
    }
    let state = match value.get("state").and_then(serde_json::Value::as_str) {
        Some(state) => parse_state(state)?,
        None => RemoteIssueState::Open,
    };
    Some(RemoteIssue {
        external_id,
        number,
        title: title.to_string(),
        body: value
            .get("description")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string(),
        state,
        is_pull_request: false,
        url: value
            .get("web_url")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string(),
        author_login: value
            .pointer("/author/username")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        assignees: usernames(value.get("assignees")),
        labels: label_names(value.get("labels")),
        updated_at: parse_updated_at(value.get("updated_at")).unwrap_or(0),
    })
}

fn parse_state(value: &str) -> Option<RemoteIssueState> {
    match value.to_ascii_lowercase().as_str() {
        "opened" | "open" => Some(RemoteIssueState::Open),
        "closed" => Some(RemoteIssueState::Closed),
        _ => None,
    }
}

fn usernames(value: Option<&serde_json::Value>) -> Vec<String> {
    let Some(serde_json::Value::Array(items)) = value else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            item.get("username")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .collect()
}

fn label_names(value: Option<&serde_json::Value>) -> Vec<String> {
    let Some(serde_json::Value::Array(items)) = value else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| match item {
            serde_json::Value::String(name) => Some(name.clone()),
            serde_json::Value::Object(_) => item
                .get("title")
                .and_then(serde_json::Value::as_str)
                .or_else(|| item.get("name").and_then(serde_json::Value::as_str))
                .map(str::to_string),
            _ => None,
        })
        .collect()
}

fn parse_updated_at(value: Option<&serde_json::Value>) -> Option<i64> {
    match value? {
        serde_json::Value::Number(number) => number.as_i64(),
        serde_json::Value::String(text) => chrono::DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|parsed| parsed.timestamp_millis()),
        _ => None,
    }
}

fn millis_to_utc_timestamp(millis: i64) -> String {
    chrono::Utc
        .timestamp_millis_opt(millis)
        .single()
        .unwrap_or_else(|| chrono::Utc.timestamp_millis_opt(0).unwrap())
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{gitlab_issue_list_args, parse_gitlab_issue_list};
    use crate::features::issue::github_issue_mirror::port::{
        ForgeIssueListQuery, RemoteIssueState,
    };

    const FIXTURE: &str = r##"[
      {
        "id": 81,
        "iid": 8,
        "title": "Pipeline stuck",
        "description": "rerun the job",
        "state": "opened",
        "web_url": "https://gitlab.example.com/acme/redwhisk/-/issues/8",
        "updated_at": "2026-11-05T12:00:00Z",
        "author": { "username": "octocat" },
        "assignees": [{ "username": "ada" }],
        "labels": ["bug", { "title": "ui" }, { "name": "api" }, { "color": "#fff" }, 4]
      },
      {
        "id": "gid-9",
        "iid": 9,
        "title": "No metadata",
        "state": "closed",
        "web_url": "https://gitlab.example.com/acme/redwhisk/-/issues/9",
        "updated_at": "2026-11-05T13:00:00Z"
      },
      { "iid": 10, "title": "missing id" }
    ]"##;

    #[test]
    fn parses_optional_fields_and_skips_an_incomplete_element() {
        let issues = parse_gitlab_issue_list(FIXTURE).expect("fixture");
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].external_id, "81");
        assert_eq!(issues[0].number, 8);
        assert_eq!(issues[0].title, "Pipeline stuck");
        assert_eq!(issues[0].body, "rerun the job");
        assert_eq!(issues[0].state, RemoteIssueState::Open);
        assert_eq!(
            issues[0].url,
            "https://gitlab.example.com/acme/redwhisk/-/issues/8"
        );
        assert_eq!(issues[0].author_login.as_deref(), Some("octocat"));
        assert_eq!(issues[0].assignees, vec!["ada".to_string()]);
        assert_eq!(
            issues[0].labels,
            vec!["bug".to_string(), "ui".to_string(), "api".to_string()]
        );
        assert_eq!(issues[0].updated_at, utc_millis("2026-11-05T12:00:00Z"));
        assert!(issues[1].author_login.is_none());
        assert!(issues[1].assignees.is_empty());
        assert!(issues[1].labels.is_empty());
        assert_eq!(issues[1].state, RemoteIssueState::Closed);
        assert_eq!(issues[1].body, "");
        assert_eq!(issues[1].external_id, "gid-9");
    }

    #[test]
    fn rejects_output_that_is_not_a_json_array() {
        assert!(parse_gitlab_issue_list("not-json").is_err());
        assert!(parse_gitlab_issue_list(r#"{"id":81}"#).is_err());
    }

    #[test]
    fn list_args_use_output_json_and_saved_scope() {
        let open =
            gitlab_issue_list_args(&query(None, vec![RemoteIssueState::Open], None, 500, None));
        assert_eq!(
            open,
            vec![
                "issue",
                "list",
                "--output",
                "json",
                "--per-page",
                "500",
                "--order",
                "updated_at",
                "--sort",
                "desc",
            ]
        );
        assert!(!open
            .iter()
            .any(|arg| arg == "--all" || arg == "--closed" || arg == "-F"));

        let closed = gitlab_issue_list_args(&query(
            Some("@me"),
            vec![RemoteIssueState::Open, RemoteIssueState::Closed],
            Some("bug"),
            200,
            Some(utc_millis("2026-11-05T12:00:00Z")),
        ));
        assert_eq!(
            closed,
            vec![
                "issue",
                "list",
                "--output",
                "json",
                "--all",
                "--assignee",
                "@me",
                "--label",
                "bug",
                "--per-page",
                "200",
                "--updated-after",
                "2026-11-05T12:00:00Z",
                "--order",
                "updated_at",
                "--sort",
                "desc",
            ]
        );
        assert!(!closed
            .iter()
            .any(|arg| arg.contains("gitlab.com") || arg.to_ascii_lowercase().contains("token")));
    }

    fn query(
        assignee: Option<&str>,
        states: Vec<RemoteIssueState>,
        label: Option<&str>,
        limit: i64,
        updated_after: Option<i64>,
    ) -> ForgeIssueListQuery {
        ForgeIssueListQuery {
            assignee: assignee.map(str::to_string),
            states,
            label: label.map(str::to_string),
            limit,
            updated_after,
        }
    }

    fn utc_millis(value: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(value)
            .expect("rfc3339")
            .timestamp_millis()
    }
}
