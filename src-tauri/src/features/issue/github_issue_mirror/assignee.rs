use serde_json::Value;

use crate::types::issue_mirror::IssueBoardAssignee;

use super::port::RemoteIssue;

pub(super) fn parse_assignees(
    value: Option<&Value>,
    login_field: &str,
) -> (Vec<String>, Option<IssueBoardAssignee>) {
    let Some(Value::Array(items)) = value else {
        return (Vec::new(), None);
    };
    let mut logins = Vec::new();
    let mut first = None;
    for item in items {
        let Some(assignee) = assignee_from_value(item, login_field) else {
            continue;
        };
        logins.push(assignee.login.clone());
        if first.is_none() {
            first = Some(assignee);
        }
    }
    (logins, first)
}

fn assignee_from_value(item: &Value, login_field: &str) -> Option<IssueBoardAssignee> {
    match item {
        Value::String(login) => assignee_from_login(login),
        Value::Object(_) => {
            let login = item
                .get(login_field)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|login| !login.is_empty())?;
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or(login);
            Some(IssueBoardAssignee {
                login: login.to_string(),
                name: name.to_string(),
                avatar_url: avatar_url(item),
            })
        }
        _ => None,
    }
}

fn assignee_from_login(login: &str) -> Option<IssueBoardAssignee> {
    let login = login.trim();
    if login.is_empty() {
        return None;
    }
    Some(IssueBoardAssignee {
        login: login.to_string(),
        name: login.to_string(),
        avatar_url: None,
    })
}

fn avatar_url(item: &Value) -> Option<String> {
    item.get("avatar_url")
        .or_else(|| item.get("avatarUrl"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_string)
}

pub(super) fn assignees_json(remote: &RemoteIssue) -> String {
    let Some(first) = remote.remote_assignee.as_ref() else {
        return serde_json::to_string(&remote.assignees).unwrap_or_else(|_| "[]".to_string());
    };
    let mut logins = remote.assignees.clone();
    if logins.is_empty() {
        logins.push(first.login.clone());
    }
    let values: Vec<Value> = logins
        .iter()
        .enumerate()
        .map(|(index, login)| {
            if index == 0 {
                let name = if login == &first.login {
                    first.name.clone()
                } else {
                    login.clone()
                };
                let avatar = if login == &first.login {
                    first.avatar_url.clone()
                } else {
                    None
                };
                serde_json::json!({
                    "login": login,
                    "name": name,
                    "avatarUrl": avatar,
                })
            } else {
                Value::String(login.clone())
            }
        })
        .collect();
    serde_json::to_string(&values).unwrap_or_else(|_| "[]".to_string())
}

pub(crate) fn assignee_logins(value: &str) -> Vec<String> {
    let Ok(Value::Array(items)) = serde_json::from_str(value) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| match item {
            Value::String(login) => nonempty(login),
            Value::Object(_) => item
                .get("login")
                .and_then(Value::as_str)
                .or_else(|| item.get("username").and_then(Value::as_str))
                .and_then(nonempty),
            _ => None,
        })
        .collect()
}

pub(super) fn first_board_assignee(value: &str) -> Option<IssueBoardAssignee> {
    let Ok(Value::Array(items)) = serde_json::from_str(value) else {
        return None;
    };
    match items.first()? {
        Value::String(login) => assignee_from_login(login),
        Value::Object(item) => {
            let login = item
                .get("login")
                .and_then(Value::as_str)
                .or_else(|| item.get("username").and_then(Value::as_str))
                .and_then(nonempty)?;
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .and_then(nonempty)
                .unwrap_or_else(|| login.clone());
            Some(IssueBoardAssignee {
                login,
                name,
                avatar_url: avatar_url(&Value::Object(item.clone())),
            })
        }
        _ => None,
    }
}

fn nonempty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
