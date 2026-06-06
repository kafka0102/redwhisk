use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::types::issue_action::{IssueActionRecord, IssueActionType};

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
    ) -> rusqlite::Result<IssueActionRecord> {
        transaction.execute(
            "INSERT INTO issue_actions (issue_id, action_type, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![issue_id, action_type.as_str(), payload_json, created_at],
        )?;

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
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}
