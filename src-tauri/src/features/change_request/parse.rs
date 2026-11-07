use crate::features::issue::{ForgeIssueError, RemoteChangeRequest};

pub(crate) fn parse_github_pull_request_list(
    stdout: &str,
) -> Result<Vec<RemoteChangeRequest>, ForgeIssueError> {
    parse_list(stdout, parse_github_pull_request)
}

pub(crate) fn parse_gitlab_merge_request_list(
    stdout: &str,
) -> Result<Vec<RemoteChangeRequest>, ForgeIssueError> {
    parse_list(stdout, parse_gitlab_merge_request)
}

fn parse_list(
    stdout: &str,
    parse_item: fn(&serde_json::Value) -> Result<RemoteChangeRequest, ForgeIssueError>,
) -> Result<Vec<RemoteChangeRequest>, ForgeIssueError> {
    let value: serde_json::Value =
        serde_json::from_str(stdout.trim()).map_err(|_| ForgeIssueError::Unparseable)?;
    let items = value.as_array().ok_or(ForgeIssueError::Unparseable)?;
    items.iter().map(parse_item).collect()
}

fn parse_github_pull_request(
    value: &serde_json::Value,
) -> Result<RemoteChangeRequest, ForgeIssueError> {
    Ok(RemoteChangeRequest {
        external_id: external_id(value)?,
        number: number_field(value, "number")?,
        title: text(value, "title"),
        body: text(value, "body"),
        state: github_state(value),
        url: text(value, "url"),
        author_login: value
            .pointer("/author/login")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        source_branch: text(value, "headRefName"),
        target_branch: text(value, "baseRefName"),
        updated_at: updated_at(value.get("updatedAt")),
    })
}

fn parse_gitlab_merge_request(
    value: &serde_json::Value,
) -> Result<RemoteChangeRequest, ForgeIssueError> {
    Ok(RemoteChangeRequest {
        external_id: external_id(value)?,
        number: number_field(value, "iid")?,
        title: text(value, "title"),
        body: text(value, "description"),
        state: gitlab_state(value),
        url: text(value, "web_url"),
        author_login: value
            .pointer("/author/username")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        source_branch: text(value, "source_branch"),
        target_branch: text(value, "target_branch"),
        updated_at: updated_at(value.get("updated_at")),
    })
}

fn github_state(value: &serde_json::Value) -> String {
    let state = raw_state(value);
    if state == "merged" || has_timestamp(value, "mergedAt") {
        return "merged".to_string();
    }
    if state == "closed" {
        return "closed".to_string();
    }
    if value
        .get("isDraft")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        return "draft".to_string();
    }
    "open".to_string()
}

fn gitlab_state(value: &serde_json::Value) -> String {
    let state = raw_state(value);
    if state == "merged" || has_timestamp(value, "merged_at") {
        return "merged".to_string();
    }
    if state == "closed" {
        return "closed".to_string();
    }
    if value
        .get("draft")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        return "draft".to_string();
    }
    "open".to_string()
}

fn raw_state(value: &serde_json::Value) -> String {
    value
        .get("state")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn has_timestamp(value: &serde_json::Value, field: &str) -> bool {
    value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .is_some_and(|text| !text.is_empty())
}

fn external_id(value: &serde_json::Value) -> Result<String, ForgeIssueError> {
    match value.get("id") {
        Some(serde_json::Value::String(id)) if !id.is_empty() => Ok(id.clone()),
        Some(serde_json::Value::Number(id)) => Ok(id.to_string()),
        _ => Err(ForgeIssueError::Unparseable),
    }
}

fn number_field(value: &serde_json::Value, field: &str) -> Result<i64, ForgeIssueError> {
    value
        .get(field)
        .and_then(serde_json::Value::as_i64)
        .ok_or(ForgeIssueError::Unparseable)
}

fn text(value: &serde_json::Value, field: &str) -> String {
    value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn updated_at(value: Option<&serde_json::Value>) -> i64 {
    match value {
        Some(serde_json::Value::Number(number)) => number.as_i64().unwrap_or(0),
        Some(serde_json::Value::String(text)) => chrono::DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|parsed| parsed.timestamp_millis())
            .unwrap_or(0),
        _ => 0,
    }
}
