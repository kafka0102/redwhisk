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
        assignees: string_names(value.get("assignees"), "login"),
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

fn string_names(value: Option<&serde_json::Value>, field: &str) -> Vec<String> {
    let Some(serde_json::Value::Array(items)) = value else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| item.get(field).and_then(serde_json::Value::as_str))
        .map(str::to_string)
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
    use super::parse_github_issue_list;

    #[test]
    fn rejects_unparseable_github_output() {
        assert!(parse_github_issue_list("not-json").is_err());
    }
}
