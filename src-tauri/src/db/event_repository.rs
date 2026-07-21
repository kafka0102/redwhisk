use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::types::issue_action::{IssueActionActor, IssueActionRecord, IssueActionType};
use crate::types::session_event::{SessionEventRecord, SessionEventType};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssueTimelineActionRow {
    pub action_type: String,
    pub actor_kind: String,
    pub agent_name_snapshot: Option<String>,
    pub agent_type: Option<String>,
    pub user_name: Option<String>,
    pub user_avatar_path: Option<String>,
    pub created_at: i64,
    pub comment_body: Option<String>,
}

pub struct EventRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> EventRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn insert_issue_action_in_transaction(
        transaction: &Transaction<'_>,
        issue_id: i64,
        action_type: IssueActionType,
        payload_json: &str,
        created_at: i64,
        actor: IssueActionActor,
    ) -> rusqlite::Result<IssueActionRecord> {
        match actor {
            IssueActionActor::User { profile_id } => {
                transaction.execute(
                    "INSERT INTO issue_actions (
                        issue_id, action_type, payload_json, created_at, actor_kind, actor_user_profile_id
                     ) VALUES (?1, ?2, ?3, ?4, 'user', ?5)",
                    params![issue_id, action_type.as_str(), payload_json, created_at, profile_id],
                )?;
            }
            IssueActionActor::Agent {
                profile_id,
                name_snapshot,
            } => {
                transaction.execute(
                    "INSERT INTO issue_actions (
                        issue_id, action_type, payload_json, created_at, actor_kind,
                        actor_agent_profile_id, actor_agent_name_snapshot
                     ) VALUES (?1, ?2, ?3, ?4, 'agent', ?5, ?6)",
                    params![
                        issue_id,
                        action_type.as_str(),
                        payload_json,
                        created_at,
                        profile_id,
                        name_snapshot,
                    ],
                )?;
            }
        }

        let id = transaction.last_insert_rowid();
        Self::find_by_id_on_connection(transaction, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn list_issue_actions(&self, issue_id: i64) -> rusqlite::Result<Vec<IssueActionRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, issue_id, action_type, payload_json, created_at
             FROM issue_actions
             WHERE issue_id = ?1
             ORDER BY created_at DESC, id DESC",
        )?;

        let issue_actions = statement
            .query_map(params![issue_id], issue_action_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(issue_actions)
    }

    /// Issue 时间轴查询行：动作 + actor 展示字段 + 评论正文（若为评论动作）。
    pub fn list_issue_timeline_rows(
        &self,
        issue_id: i64,
    ) -> rusqlite::Result<Vec<IssueTimelineActionRow>> {
        let mut statement = self.connection.prepare(
            "SELECT
                issue_actions.action_type,
                issue_actions.actor_kind,
                issue_actions.actor_agent_name_snapshot,
                agent_profiles.agent_type,
                user_profiles.name,
                user_profiles.avatar_path,
                issue_actions.created_at,
                issue_comments.body
             FROM issue_actions
             LEFT JOIN user_profiles
                ON user_profiles.id = issue_actions.actor_user_profile_id
             LEFT JOIN agent_profiles
                ON agent_profiles.id = issue_actions.actor_agent_profile_id
             LEFT JOIN issue_comments
                ON issue_comments.id = json_extract(issue_actions.payload_json, '$.commentId')
             WHERE issue_actions.issue_id = ?1
             ORDER BY issue_actions.created_at ASC, issue_actions.id ASC",
        )?;

        let rows = statement
            .query_map(params![issue_id], |row| {
                Ok(IssueTimelineActionRow {
                    action_type: row.get(0)?,
                    actor_kind: row.get(1)?,
                    agent_name_snapshot: row.get(2)?,
                    agent_type: row.get(3)?,
                    user_name: row.get(4)?,
                    user_avatar_path: row.get(5)?,
                    created_at: row.get(6)?,
                    comment_body: row.get(7)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(rows)
    }

    pub fn insert_session_event_in_transaction(
        transaction: &Transaction<'_>,
        session_id: i64,
        event_type: SessionEventType,
        payload_json: &str,
        created_at: i64,
    ) -> rusqlite::Result<SessionEventRecord> {
        transaction.execute(
            "INSERT INTO session_events (session_id, event_type, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![session_id, event_type.as_str(), payload_json, created_at],
        )?;

        let id = transaction.last_insert_rowid();
        Self::find_session_event_by_id_on_connection(transaction, id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn list_session_events(
        &self,
        session_id: i64,
    ) -> rusqlite::Result<Vec<SessionEventRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, session_id, event_type, payload_json, created_at
             FROM session_events
             WHERE session_id = ?1
             ORDER BY created_at DESC, id DESC",
        )?;

        let session_events = statement
            .query_map(params![session_id], session_event_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(session_events)
    }

    fn find_by_id_on_connection(
        connection: &Connection,
        id: i64,
    ) -> rusqlite::Result<Option<IssueActionRecord>> {
        connection
            .query_row(
                "SELECT id, issue_id, action_type, payload_json, created_at
                 FROM issue_actions
                 WHERE id = ?1",
                params![id],
                issue_action_from_row,
            )
            .optional()
    }

    fn find_session_event_by_id_on_connection(
        connection: &Connection,
        id: i64,
    ) -> rusqlite::Result<Option<SessionEventRecord>> {
        connection
            .query_row(
                "SELECT id, session_id, event_type, payload_json, created_at
                 FROM session_events
                 WHERE id = ?1",
                params![id],
                session_event_from_row,
            )
            .optional()
    }
}

fn issue_action_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<IssueActionRecord> {
    Ok(IssueActionRecord {
        id: row.get(0)?,
        issue_id: row.get(1)?,
        action_type: issue_action_type_from_str(&row.get::<_, String>(2)?)?,
        payload_json: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn issue_action_type_from_str(value: &str) -> rusqlite::Result<IssueActionType> {
    match value {
        "issue_created" => Ok(IssueActionType::IssueCreated),
        "agent_session_started" => Ok(IssueActionType::AgentSessionStarted),
        "issue_review_marked" => Ok(IssueActionType::IssueReviewMarked),
        "issue_status_changed" => Ok(IssueActionType::IssueStatusChanged),
        "issue_completed" => Ok(IssueActionType::IssueCompleted),
        "issue_deleted" => Ok(IssueActionType::IssueDeleted),
        "issue_comment_added" => Ok(IssueActionType::IssueCommentAdded),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn session_event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionEventRecord> {
    Ok(SessionEventRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        event_type: session_event_type_from_str(&row.get::<_, String>(2)?)?,
        payload_json: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn session_event_type_from_str(value: &str) -> rusqlite::Result<SessionEventType> {
    match value {
        "session_started" => Ok(SessionEventType::SessionStarted),
        "session_exited" => Ok(SessionEventType::SessionExited),
        "session_closed" => Ok(SessionEventType::SessionClosed),
        "session_prompt_injected" => Ok(SessionEventType::SessionPromptInjected),
        "session_attention_requested" => Ok(SessionEventType::SessionAttentionRequested),
        "session_attention_cleared" => Ok(SessionEventType::SessionAttentionCleared),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}
