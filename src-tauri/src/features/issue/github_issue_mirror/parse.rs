use super::port::{ForgeIssueError, RemoteIssue, RemoteIssueState};

pub fn parse_github_issue_list(stdout: &str) -> Result<Vec<RemoteIssue>, ForgeIssueError> {
    let value: serde_json::Value =
        serde_json::from_str(stdout.trim()).map_err(|_| ForgeIssueError::Unparseable)?;
    let items = value.as_array().ok_or(ForgeIssueError::Unparseable)?;
    items.iter().map(parse_github_issue).collect()
}

pub(super) fn parse_github_issue(
    value: &serde_json::Value,
) -> Result<RemoteIssue, ForgeIssueError> {
    let number = value
        .get("number")
        .and_then(serde_json::Value::as_i64)
        .ok_or(ForgeIssueError::Unparseable)?;
    let title = value
        .get("title")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let body = value
        .get("body")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let state = parse_state(
        value
            .get("state")
            .and_then(serde_json::Value::as_str)
            .ok_or(ForgeIssueError::Unparseable)?,
    )?;
    let external_id = match value.get("id") {
        Some(serde_json::Value::String(id)) => id.clone(),
        Some(serde_json::Value::Number(id)) => id.to_string(),
        _ => return Err(ForgeIssueError::Unparseable),
    };
    let url = value
        .get("url")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let (assignees, remote_assignee) =
        super::assignee::parse_assignees(value.get("assignees"), "login");
    Ok(RemoteIssue {
        external_id,
        number,
        title,
        body,
        state,
        is_pull_request: is_pull_request(value),
        url,
        author_login: value
            .pointer("/author/login")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        assignees,
        remote_assignee,
        labels: label_names(value.get("labels")),
        updated_at: parse_updated_at(value.get("updatedAt")).unwrap_or(0),
    })
}

fn is_pull_request(value: &serde_json::Value) -> bool {
    if value
        .get("isPullRequest")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        return true;
    }
    match value.get("pull_request") {
        Some(serde_json::Value::Null) | None => false,
        Some(_) => true,
    }
}

fn parse_state(value: &str) -> Result<RemoteIssueState, ForgeIssueError> {
    match value.to_ascii_lowercase().as_str() {
        "open" => Ok(RemoteIssueState::Open),
        "closed" => Ok(RemoteIssueState::Closed),
        _ => Err(ForgeIssueError::Unparseable),
    }
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
                .get("name")
                .and_then(serde_json::Value::as_str)
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

#[cfg(test)]
mod tests {
    use super::super::gitlab::parse_gitlab_issue_list;
    use super::parse_github_issue_list;

    #[test]
    fn rejects_unparseable_github_output() {
        assert!(parse_github_issue_list("not-json").is_err());
    }

    #[test]
    fn preserves_assignee_name_and_avatar() {
        let github = r#"[
            {
                "id": 7,
                "number": 7,
                "title": "Avatar",
                "state": "open",
                "url": "https://github.com/acme/redwhisk/issues/7",
                "assignees": [
                    {
                        "login": "yujianjia",
                        "name": "\u4e8e\u5efa\u5bb6",
                        "avatar_url": "https://avatars.example/y.png"
                    },
                    {
                        "login": "other",
                        "name": "\u5176\u4ed6",
                        "avatar_url": "https://avatars.example/o.png"
                    }
                ]
            },
            {
                "id": 8,
                "number": 8,
                "title": "No name",
                "state": "open",
                "assignees": [{ "login": "ghost" }]
            },
            {
                "id": 9,
                "number": 9,
                "title": "Legacy",
                "state": "open",
                "assignees": ["legacy"]
            }
        ]"#;
        let issues = parse_github_issue_list(github).expect("github issue");
        assert_eq!(
            issues[0].assignees,
            vec!["yujianjia".to_string(), "other".to_string()]
        );
        let assignee = issues[0].remote_assignee.as_ref().expect("github assignee");
        assert_eq!(assignee.login, "yujianjia");
        assert_eq!(assignee.name, "\u{4e8e}\u{5efa}\u{5bb6}");
        assert_eq!(
            assignee.avatar_url.as_deref(),
            Some("https://avatars.example/y.png")
        );
        let nameless = issues[1].remote_assignee.as_ref().expect("nameless");
        assert_eq!(nameless.login, "ghost");
        assert_eq!(nameless.name, "ghost");
        assert!(nameless.avatar_url.is_none());
        assert_eq!(issues[2].assignees, vec!["legacy".to_string()]);
        let legacy = issues[2].remote_assignee.as_ref().expect("legacy");
        assert_eq!(legacy.login, "legacy");
        assert_eq!(legacy.name, "legacy");
        assert!(legacy.avatar_url.is_none());

        let gitlab = r#"[
            {
                "id": 9,
                "iid": 9,
                "title": "GitLab",
                "state": "opened",
                "assignees": [
                    {
                        "username": "yujianjia",
                        "name": "\u4e8e\u5efa\u5bb6",
                        "avatar_url": null
                    }
                ]
            },
            {
                "id": 10,
                "iid": 10,
                "title": "Photo",
                "state": "opened",
                "assignees": [
                    {
                        "username": "wsg",
                        "avatar_url": "https://gitlab.example/w.png"
                    }
                ]
            }
        ]"#;
        let issues = parse_gitlab_issue_list(gitlab).expect("gitlab issue");
        assert_eq!(issues[0].assignees, vec!["yujianjia".to_string()]);
        let assignee = issues[0].remote_assignee.as_ref().expect("gitlab assignee");
        assert_eq!(assignee.login, "yujianjia");
        assert_eq!(assignee.name, "\u{4e8e}\u{5efa}\u{5bb6}");
        assert!(assignee.avatar_url.is_none());
        let photo = issues[1].remote_assignee.as_ref().expect("gitlab photo");
        assert_eq!(issues[1].assignees, vec!["wsg".to_string()]);
        assert_eq!(photo.login, "wsg");
        assert_eq!(photo.name, "wsg");
        assert_eq!(
            photo.avatar_url.as_deref(),
            Some("https://gitlab.example/w.png")
        );
    }
}
