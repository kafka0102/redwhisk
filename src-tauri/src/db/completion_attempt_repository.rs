use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::json;

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
        commit_hash: Option<&str>,
        failure_reason: Option<&str>,
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
               commit_hash,
               failure_reason,
               changed_files_json,
               result,
               created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                issue_id,
                session_id,
                option.as_str(),
                head_before,
                head_after,
                commit_hash,
                failure_reason,
                changed_files_json,
                result.as_str(),
                created_at
            ],
        )?;

        let id = transaction.last_insert_rowid();
        find_by_id_on_connection(transaction, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn update_result_in_transaction(
        transaction: &Transaction<'_>,
        id: i64,
        head_after: &str,
        commit_hash: Option<&str>,
        failure_reason: Option<&str>,
        result: CompletionAttemptResult,
    ) -> rusqlite::Result<Option<CompletionAttemptRecord>> {
        let changed = transaction.execute(
            "UPDATE completion_attempts
             SET head_after = ?1,
                 commit_hash = ?2,
                 failure_reason = ?3,
                 result = ?4
             WHERE id = ?5",
            params![head_after, commit_hash, failure_reason, result.as_str(), id],
        )?;

        if changed == 0 {
            return Ok(None);
        }

        find_by_id_on_connection(transaction, id)
    }

    /// 记录一次因 Git 操作进行中而被阻止的完成尝试。
    ///
    /// `operation_state_str` 由调用方经 `format_git_operation_state` 格式化后传入，
    /// 避免 db 层反向依赖 git 模块；同时用作 `changed_files_json` 的 `state` 字段。
    /// `failure_reason` 与 `operation_state_str` 在当前调用点同源，保留独立参数以
    /// 维持语义边界。`created_at` 由调用方提供，遵循 `insert_in_transaction` 既有契约。
    pub fn record_blocked_in_transaction(
        transaction: &Transaction<'_>,
        issue_id: i64,
        session_id: i64,
        option: CompletionAttemptOption,
        head: &str,
        failure_reason: &str,
        operation_state_str: &str,
        message: &str,
        created_at: i64,
    ) -> rusqlite::Result<CompletionAttemptRecord> {
        let changed_files_json = json!({
            "blockedBy": "git_operation",
            "state": operation_state_str,
            "message": message,
        })
        .to_string();

        Self::insert_in_transaction(
            transaction,
            issue_id,
            session_id,
            option,
            head,
            head,
            None,
            Some(failure_reason),
            &changed_files_json,
            CompletionAttemptResult::GitOperationBlocked,
            created_at,
        )
    }

    pub fn list_by_issue_id(
        &self,
        issue_id: i64,
    ) -> rusqlite::Result<Vec<CompletionAttemptRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, issue_id, session_id, option, head_before, head_after, commit_hash, failure_reason, changed_files_json, result, created_at
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
            "SELECT id, issue_id, session_id, option, head_before, head_after, commit_hash, failure_reason, changed_files_json, result, created_at
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
        commit_hash: row.get(6)?,
        failure_reason: row.get(7)?,
        changed_files_json: row.get(8)?,
        result: completion_attempt_result_from_str(&row.get::<_, String>(9)?)?,
        created_at: row.get(10)?,
    })
}

fn completion_attempt_option_from_str(value: &str) -> rusqlite::Result<CompletionAttemptOption> {
    match value {
        "complete_manual" => Ok(CompletionAttemptOption::CompleteManual),
        "complete_clean" => Ok(CompletionAttemptOption::CompleteClean),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn completion_attempt_result_from_str(value: &str) -> rusqlite::Result<CompletionAttemptResult> {
    match value {
        "completed" => Ok(CompletionAttemptResult::Completed),
        "prompt_sent" => Ok(CompletionAttemptResult::PromptSent),
        "no_commit_detected" => Ok(CompletionAttemptResult::NoCommitDetected),
        "git_operation_blocked" => Ok(CompletionAttemptResult::GitOperationBlocked),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}
