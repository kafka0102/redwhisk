use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::types::issue::{IssueRecord, IssueStatus};

const ISSUE_SELECT_COLUMNS: &str = "SELECT
    issues.id,
    issues.project_id,
    issues.title,
    issues.description,
    issues.status,
    (
        SELECT agent_sessions.id
        FROM agent_sessions
        WHERE agent_sessions.issue_id = issues.id
        LIMIT 1
    ) AS linked_session_id,
    (
        SELECT agent_sessions.status
        FROM agent_sessions
        WHERE agent_sessions.issue_id = issues.id
        LIMIT 1
    ) AS linked_session_status,
    issues.created_at,
    issues.updated_at
 FROM issues";

pub struct IssueRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> IssueRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn connection(&self) -> &'connection Connection {
        self.connection
    }

    pub fn list_by_project_id(&self, project_id: i64) -> rusqlite::Result<Vec<IssueRecord>> {
        let mut statement = self.connection.prepare(&format!(
            "{ISSUE_SELECT_COLUMNS}
             WHERE issues.project_id = ?1
             ORDER BY issues.updated_at DESC, issues.created_at DESC, issues.id DESC"
        ))?;

        let issues = statement
            .query_map(params![project_id], issue_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(issues)
    }

    pub fn find_by_id(&self, id: i64) -> rusqlite::Result<Option<IssueRecord>> {
        self.connection
            .query_row(
                &format!("{ISSUE_SELECT_COLUMNS} WHERE issues.id = ?1"),
                params![id],
                issue_from_row,
            )
            .optional()
    }

    pub fn insert(
        &self,
        project_id: i64,
        title: &str,
        description: &str,
    ) -> rusqlite::Result<IssueRecord> {
        self.connection.execute(
            "INSERT INTO issues (project_id, title, description, status, created_at, updated_at)
             VALUES (
               ?1,
               ?2,
               ?3,
               'backlog',
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
             )",
            params![project_id, title, description],
        )?;

        let id = self.connection.last_insert_rowid();
        self.find_by_id(id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn insert_in_transaction(
        transaction: &Transaction<'_>,
        project_id: i64,
        title: &str,
        description: &str,
    ) -> rusqlite::Result<IssueRecord> {
        transaction.execute(
            "INSERT INTO issues (project_id, title, description, status, created_at, updated_at)
             VALUES (
               ?1,
               ?2,
               ?3,
               'backlog',
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
             )",
            params![project_id, title, description],
        )?;

        let id = transaction.last_insert_rowid();
        find_by_id_on_connection(transaction, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn update_title_and_description(
        &self,
        project_id: i64,
        issue_id: i64,
        title: &str,
        description: &str,
    ) -> rusqlite::Result<Option<IssueRecord>> {
        let changed = self.connection.execute(
            "UPDATE issues
             SET title = ?1,
                 description = ?2,
                 updated_at = MAX(
                   updated_at + 1,
                   CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
                 )
             WHERE id = ?3 AND project_id = ?4",
            params![title, description, issue_id, project_id],
        )?;

        if changed == 0 {
            return Ok(None);
        }

        self.find_by_id(issue_id)
    }

    pub fn update_status_in_transaction(
        transaction: &Transaction<'_>,
        project_id: i64,
        issue_id: i64,
        status: IssueStatus,
    ) -> rusqlite::Result<Option<IssueRecord>> {
        let changed = transaction.execute(
            "UPDATE issues
             SET status = ?1,
                 updated_at = MAX(
                   updated_at + 1,
                   CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
                 )
             WHERE id = ?2 AND project_id = ?3",
            params![issue_status_to_str(&status), issue_id, project_id],
        )?;

        if changed == 0 {
            return Ok(None);
        }

        find_by_id_on_connection(transaction, issue_id)
    }
}

fn find_by_id_on_connection(
    connection: &Connection,
    id: i64,
) -> rusqlite::Result<Option<IssueRecord>> {
    connection
        .query_row(
            &format!("{ISSUE_SELECT_COLUMNS} WHERE issues.id = ?1"),
            params![id],
            issue_from_row,
        )
        .optional()
}

fn issue_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<IssueRecord> {
    Ok(IssueRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        status: issue_status_from_str(&row.get::<_, String>(4)?)?,
        linked_session_id: row.get(5)?,
        linked_session_status: row
            .get::<_, Option<String>>(6)?
            .map(|value| agent_session_status_from_str(&value))
            .transpose()?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn agent_session_status_from_str(
    value: &str,
) -> rusqlite::Result<crate::types::agent_session::AgentSessionStatus> {
    match value {
        "running" => Ok(crate::types::agent_session::AgentSessionStatus::Running),
        "closed" => Ok(crate::types::agent_session::AgentSessionStatus::Closed),
        "crashed" => Ok(crate::types::agent_session::AgentSessionStatus::Crashed),
        "stopped" => Ok(crate::types::agent_session::AgentSessionStatus::Stopped),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn issue_status_from_str(value: &str) -> rusqlite::Result<IssueStatus> {
    match value {
        "backlog" => Ok(IssueStatus::Backlog),
        "running" => Ok(IssueStatus::Running),
        "review" => Ok(IssueStatus::Review),
        "completed" => Ok(IssueStatus::Completed),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn issue_status_to_str(value: &IssueStatus) -> &'static str {
    match value {
        IssueStatus::Backlog => "backlog",
        IssueStatus::Running => "running",
        IssueStatus::Review => "review",
        IssueStatus::Completed => "completed",
    }
}
