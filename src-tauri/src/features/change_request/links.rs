use rusqlite::{params, Connection, OptionalExtension};

use crate::features::issue::RemoteChangeRequest;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

pub(crate) fn link_detected_issues(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    change_request_id: i64,
    request: &RemoteChangeRequest,
    now_ms: i64,
) -> Result<(), CommandError> {
    for number in closing_numbers(&request.body) {
        if let Some(issue_id) = remote_issue_id(connection, project_id, provider, number)? {
            insert_link(connection, change_request_id, issue_id, "closing", now_ms)?;
        }
    }
    if let Some(number) = branch_issue_number(&request.source_branch) {
        if let Some(issue_id) = local_issue_id(connection, project_id, number)? {
            insert_link(connection, change_request_id, issue_id, "branch", now_ms)?;
        }
    }
    Ok(())
}

pub(crate) fn link_change_request_issue(
    connection: &Connection,
    project_id: i64,
    change_request_id: i64,
    issue_id: i64,
    now_ms: i64,
) -> Result<(), CommandError> {
    ensure_project(connection, project_id)?;
    insert_link(connection, change_request_id, issue_id, "manual", now_ms)
}

fn ensure_project(connection: &Connection, project_id: i64) -> Result<(), CommandError> {
    let found: Option<i64> = connection
        .query_row(
            "SELECT id FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(persistence)?;
    if found.is_none() {
        return Err(
            CommandError::new(CommandErrorCode::ProjectNotFound, "Project not found.")
                .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id)),
        );
    }
    Ok(())
}

fn insert_link(
    connection: &Connection,
    change_request_id: i64,
    issue_id: i64,
    link_kind: &str,
    now_ms: i64,
) -> Result<(), CommandError> {
    connection
        .execute(
            "INSERT INTO change_request_issue_links (
                change_request_id, issue_id, link_kind, created_at
             ) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(change_request_id, issue_id) DO NOTHING",
            params![change_request_id, issue_id, link_kind, now_ms],
        )
        .map_err(persistence)?;
    Ok(())
}

fn remote_issue_id(
    connection: &Connection,
    project_id: i64,
    provider: &str,
    external_number: i64,
) -> Result<Option<i64>, CommandError> {
    connection
        .query_row(
            "SELECT issues.id
             FROM issues
             JOIN issue_external_refs AS refs ON refs.issue_id = issues.id
             WHERE issues.project_id = ?1 AND issues.del = 0
               AND refs.provider = ?2 AND refs.external_number = ?3",
            params![project_id, provider, external_number],
            |row| row.get(0),
        )
        .optional()
        .map_err(persistence)
}

fn local_issue_id(
    connection: &Connection,
    project_id: i64,
    number: i64,
) -> Result<Option<i64>, CommandError> {
    connection
        .query_row(
            "SELECT id FROM issues
             WHERE project_id = ?1 AND number = ?2 AND source = 'local' AND del = 0",
            params![project_id, number],
            |row| row.get(0),
        )
        .optional()
        .map_err(persistence)
}

fn closing_numbers(body: &str) -> Vec<i64> {
    let chars: Vec<char> = body.to_ascii_lowercase().chars().collect();
    let keywords = ["closes", "fixes", "resolves"];
    let mut numbers = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let mut matched_keyword = false;
        for keyword in keywords {
            let key: Vec<char> = keyword.chars().collect();
            if !chars[index..].starts_with(&key) {
                continue;
            }
            let before_ok = index == 0 || !chars[index - 1].is_ascii_alphanumeric();
            let mut cursor = index + key.len();
            if before_ok {
                if cursor < chars.len() && chars[cursor] == ':' {
                    cursor += 1;
                }
                while cursor < chars.len() && chars[cursor].is_whitespace() {
                    cursor += 1;
                }
                if cursor < chars.len() && chars[cursor] == '#' {
                    cursor += 1;
                    let start = cursor;
                    while cursor < chars.len() && chars[cursor].is_ascii_digit() {
                        cursor += 1;
                    }
                    if cursor > start {
                        let number: String = chars[start..cursor].iter().collect();
                        if let Ok(parsed) = number.parse::<i64>() {
                            numbers.push(parsed);
                        }
                    }
                }
            }
            index = cursor.max(index + key.len());
            matched_keyword = true;
            break;
        }
        if !matched_keyword {
            index += 1;
        }
    }
    numbers
}

fn branch_issue_number(branch: &str) -> Option<i64> {
    let rest = branch.strip_prefix("issue-")?;
    let (digits, _tail) = rest.split_once('-')?;
    if digits.is_empty() || !digits.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

fn persistence(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::IssuePersistenceFailed,
        "Failed to link change request.",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}
