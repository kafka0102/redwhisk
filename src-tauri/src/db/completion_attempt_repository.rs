use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::types::completion_attempt::{
    CompletionAttemptOption, CompletionAttemptRecord, CompletionAttemptResult,
};

pub struct CompletionAttemptRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> CompletionAttemptRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn insert_in_transaction(
        transaction: &Transaction<'_>,
        issue_id: i64,
        session_id: i64,
        option: CompletionAttemptOption,
        head_before: &str,
        head_after: &str,
        changed_files_json: &str,
        result: CompletionAttemptResult,
        created_at: i64,
    ) -> rusqlite::Result<CompletionAttemptRecord> {
        transaction.execute(
            "INSERT INTO completion_attempts (
               issue_id,
               session_id,
               option,
               head_before,
               head_after,
               changed_files_json,
               result,
               created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                issue_id,
                session_id,
                option.as_str(),
                head_before,
                head_after,
                changed_files_json,
                result.as_str(),
                created_at
            ],
        )?;

        let id = transaction.last_insert_rowid();
        find_by_id_on_connection(transaction, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn list_by_issue_id(
        &self,
        issue_id: i64,
    ) -> rusqlite::Result<Vec<CompletionAttemptRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, issue_id, session_id, option, head_before, head_after, changed_files_json, result, created_at
             FROM completion_attempts
             WHERE issue_id = ?1
             ORDER BY created_at DESC, id DESC",
        )?;

        let records = statement
            .query_map(params![issue_id], completion_attempt_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(records)
    }
}

fn find_by_id_on_connection(
    connection: &Connection,
    id: i64,
) -> rusqlite::Result<Option<CompletionAttemptRecord>> {
    connection
        .query_row(
            "SELECT id, issue_id, session_id, option, head_before, head_after, changed_files_json, result, created_at
             FROM completion_attempts
             WHERE id = ?1",
            params![id],
            completion_attempt_from_row,
        )
        .optional()
}

fn completion_attempt_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<CompletionAttemptRecord> {
    Ok(CompletionAttemptRecord {
        id: row.get(0)?,
        issue_id: row.get(1)?,
        session_id: row.get(2)?,
        option: completion_attempt_option_from_str(&row.get::<_, String>(3)?)?,
        head_before: row.get(4)?,
        head_after: row.get(5)?,
        changed_files_json: row.get(6)?,
        result: completion_attempt_result_from_str(&row.get::<_, String>(7)?)?,
        created_at: row.get(8)?,
    })
}

fn completion_attempt_option_from_str(value: &str) -> rusqlite::Result<CompletionAttemptOption> {
    match value {
        "complete_manual" => Ok(CompletionAttemptOption::CompleteManual),
        "complete_clean" => Ok(CompletionAttemptOption::CompleteClean),
        "agent_auto_commit" => Ok(CompletionAttemptOption::AgentAutoCommit),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn completion_attempt_result_from_str(value: &str) -> rusqlite::Result<CompletionAttemptResult> {
    match value {
        "completed" => Ok(CompletionAttemptResult::Completed),
        "prompt_sent" => Ok(CompletionAttemptResult::PromptSent),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}
