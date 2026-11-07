use rusqlite::{params, Connection, OptionalExtension};

use crate::types::change_request::IssuePullRequestRef;
use crate::types::errors::CommandError;

struct ParsedChangeRequestUrl {
    provider: &'static str,
    host: String,
    repo: String,
    number: i64,
}

pub(super) fn upgrade_pull_request_urls(
    connection: &Connection,
    project_id: i64,
) -> Result<Vec<IssuePullRequestRef>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT pull.issue_id, pull.url
             FROM issue_pull_requests AS pull
             JOIN issues ON issues.id = pull.issue_id
             WHERE issues.project_id = ?1
             ORDER BY pull.url",
        )
        .map_err(super::list::query_failed)?;
    let rows = statement
        .query_map(params![project_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(super::list::query_failed)?;
    let stored = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(super::list::query_failed)?;
    for (issue_id, url) in &stored {
        let Some(parsed) = parse_change_request_url(url) else {
            continue;
        };
        let matched: Option<i64> = connection
            .query_row(
                "SELECT id FROM change_requests
                 WHERE project_id = ?1 AND provider = ?2 AND host = ?3 AND repo = ?4 AND number = ?5",
                params![
                    project_id,
                    parsed.provider,
                    parsed.host,
                    parsed.repo,
                    parsed.number
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(super::list::query_failed)?;
        let Some(change_request_id) = matched else {
            continue;
        };
        connection
            .execute(
                "UPDATE issue_pull_requests SET change_request_id = ?1 WHERE issue_id = ?2",
                params![change_request_id, issue_id],
            )
            .map_err(super::list::query_failed)?;
    }

    let mut statement = connection
        .prepare(
            "SELECT pull.url, pull.change_request_id
             FROM issue_pull_requests AS pull
             JOIN issues ON issues.id = pull.issue_id
             WHERE issues.project_id = ?1
             ORDER BY pull.url",
        )
        .map_err(super::list::query_failed)?;
    let rows = statement
        .query_map(params![project_id], |row| {
            Ok(IssuePullRequestRef {
                url: row.get(0)?,
                change_request_id: row.get(1)?,
            })
        })
        .map_err(super::list::query_failed)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(super::list::query_failed)
}

fn parse_change_request_url(url: &str) -> Option<ParsedChangeRequestUrl> {
    let (host, parts) = https_parts(url)?;
    if let Some(number) = github_number(&parts) {
        return Some(parsed("github", host, &parts, number));
    }
    let number = gitlab_number(&parts)?;
    Some(parsed("gitlab", host, &parts, number))
}

fn https_parts(url: &str) -> Option<(String, Vec<String>)> {
    let rest = url.trim().strip_prefix("https://")?;
    let (host, path) = rest.split_once('/')?;
    if host.is_empty() || path.is_empty() {
        return None;
    }
    Some((
        host.to_ascii_lowercase(),
        path.split('/').map(str::to_string).collect(),
    ))
}

fn github_number(parts: &[String]) -> Option<i64> {
    if parts.len() != 4 || parts[2] != "pull" {
        return None;
    }
    parts[3].parse().ok()
}

fn gitlab_number(parts: &[String]) -> Option<i64> {
    if parts.len() != 5 || parts[2] != "-" || parts[3] != "merge_requests" {
        return None;
    }
    parts[4].parse().ok()
}

fn parsed(
    provider: &'static str,
    host: String,
    parts: &[String],
    number: i64,
) -> ParsedChangeRequestUrl {
    ParsedChangeRequestUrl {
        provider,
        host,
        repo: format!("{}/{}", parts[0], parts[1]),
        number,
    }
}
