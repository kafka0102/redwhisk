use rusqlite::{params, Connection};

use crate::db::event_repository::EventRepository;
use crate::types::errors::{CommandError, CommandErrorCode};
use crate::types::issue::{
    IssueTimelineActionType, IssueTimelineActor, IssueTimelineEntry, IssueTimelineResponse,
    IssueTimelineSource,
};

use super::service::IssueService;
use super::validation::issue_database_error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteCommentWrite {
    pub provider: String,
    pub remote_comment_id: String,
    pub author_login: String,
    pub body: String,
    pub remote_created_at: i64,
}

pub fn upsert_remote_comments(
    service: &IssueService<'_>,
    issue_id: i64,
    comments: &[RemoteCommentWrite],
) -> Result<(), CommandError> {
    let connection = service.issue_repository.connection();
    for comment in comments {
        reject_unknown_provider(&comment.provider)?;
        connection
            .execute(
                "INSERT INTO issue_remote_comments (
                    issue_id, provider, remote_comment_id, author_login, body,
                    remote_created_at, remote_updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                 ON CONFLICT(issue_id, remote_comment_id) DO NOTHING",
                params![
                    issue_id,
                    comment.provider,
                    comment.remote_comment_id,
                    comment.author_login,
                    comment.body,
                    comment.remote_created_at,
                ],
            )
            .map_err(issue_database_error)?;
    }
    Ok(())
}

fn reject_unknown_provider(provider: &str) -> Result<(), CommandError> {
    if provider == "github" || provider == "gitlab" {
        return Ok(());
    }
    Err(CommandError::new(
        CommandErrorCode::IssueValidationFailed,
        "invalid remote provider",
    )
    .with_reason("invalidRemoteProvider"))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteEventWrite {
    pub provider: String,
    pub remote_event_id: String,
    pub event_type: String,
    pub actor_login: Option<String>,
    pub remote_created_at: i64,
}

pub fn upsert_remote_events(
    service: &IssueService<'_>,
    issue_id: i64,
    events: &[RemoteEventWrite],
) -> Result<(), CommandError> {
    let connection = service.issue_repository.connection();
    for event in events {
        connection
            .execute(
                "INSERT INTO issue_remote_events (
                    issue_id, provider, remote_event_id, event_type, actor_login,
                    remote_created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(issue_id, remote_event_id) DO NOTHING",
                params![
                    issue_id,
                    event.provider,
                    event.remote_event_id,
                    event.event_type,
                    event.actor_login,
                    event.remote_created_at,
                ],
            )
            .map_err(issue_database_error)?;
    }
    Ok(())
}

pub(crate) fn load_issue_timeline(
    connection: &Connection,
    issue_id: i64,
) -> Result<IssueTimelineResponse, CommandError> {
    let mut entries = local_entries(connection, issue_id)?;
    entries.extend(remote_comment_entries(connection, issue_id)?);
    entries.extend(remote_event_entries(connection, issue_id)?);
    entries.sort_by_key(|entry| entry.created_at);
    Ok(IssueTimelineResponse { entries })
}

fn local_entries(
    connection: &Connection,
    issue_id: i64,
) -> Result<Vec<IssueTimelineEntry>, CommandError> {
    let rows = EventRepository::new(connection)
        .list_issue_timeline_rows(issue_id)
        .map_err(issue_database_error)?;
    let mut entries = Vec::new();
    for row in rows {
        let Some(action_type) = IssueTimelineActionType::from_action_str(&row.action_type) else {
            continue;
        };
        let (name, avatar_path, agent_type) = if row.actor_kind == "agent" {
            (
                row.agent_name_snapshot.unwrap_or_default(),
                None,
                row.agent_type,
            )
        } else {
            (
                row.user_name.unwrap_or_default(),
                row.user_avatar_path,
                None,
            )
        };
        let comment_body = if action_type == IssueTimelineActionType::IssueCommentAdded {
            row.comment_body
        } else {
            None
        };
        entries.push(IssueTimelineEntry {
            action_type,
            actor: IssueTimelineActor {
                name,
                avatar_path,
                actor_kind: row.actor_kind,
                agent_type,
            },
            created_at: row.created_at,
            comment_body,
            source: IssueTimelineSource::Local,
        });
    }
    Ok(entries)
}

fn remote_comment_entries(
    connection: &Connection,
    issue_id: i64,
) -> Result<Vec<IssueTimelineEntry>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT author_login, body, remote_created_at
             FROM issue_remote_comments
             WHERE issue_id = ?1
             ORDER BY remote_created_at ASC, id ASC",
        )
        .map_err(issue_database_error)?;
    let rows = statement
        .query_map(params![issue_id], |row| {
            Ok(IssueTimelineEntry {
                action_type: IssueTimelineActionType::RemoteComment,
                actor: IssueTimelineActor {
                    name: row.get(0)?,
                    avatar_path: None,
                    actor_kind: "remote".to_string(),
                    agent_type: None,
                },
                created_at: row.get(2)?,
                comment_body: Some(row.get(1)?),
                source: IssueTimelineSource::Remote,
            })
        })
        .map_err(issue_database_error)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(issue_database_error)
}

fn remote_event_entries(
    connection: &Connection,
    issue_id: i64,
) -> Result<Vec<IssueTimelineEntry>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT actor_login, remote_created_at, event_type, payload_json
             FROM issue_remote_events
             WHERE issue_id = ?1
             ORDER BY remote_created_at ASC, id ASC",
        )
        .map_err(issue_database_error)?;
    let rows = statement
        .query_map(params![issue_id], |row| {
            let actor_login: Option<String> = row.get(0)?;
            let event_type: String = row.get(2)?;
            let payload_json: String = row.get(3)?;
            let origin_url = if event_type == "remote_origin" {
                origin_url_from_payload(&payload_json)
            } else {
                None
            };
            Ok(IssueTimelineEntry {
                action_type: if origin_url.is_some() {
                    IssueTimelineActionType::RemoteOrigin
                } else {
                    IssueTimelineActionType::RemoteEvent
                },
                actor: IssueTimelineActor {
                    name: actor_login.unwrap_or_default(),
                    avatar_path: None,
                    actor_kind: "remote".to_string(),
                    agent_type: None,
                },
                created_at: row.get(1)?,
                comment_body: origin_url,
                source: IssueTimelineSource::Remote,
            })
        })
        .map_err(issue_database_error)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(issue_database_error)
}

#[cfg(test)]
#[path = "remote_timeline_test.rs"]
mod tests;

fn origin_url_from_payload(payload_json: &str) -> Option<String> {
    let payload: serde_json::Value = serde_json::from_str(payload_json).ok()?;
    payload
        .get("externalUrl")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}
