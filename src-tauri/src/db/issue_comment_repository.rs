use rusqlite::{params, Connection, Transaction};

pub struct IssueCommentRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> IssueCommentRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    /// 插入评论；`UNIQUE(linked_session_id, linked_turn_id)` 冲突时返回 `None`（幂等）。
    pub fn insert_if_absent_in_transaction(
        transaction: &Transaction<'_>,
        issue_id: i64,
        body: &str,
        linked_session_id: Option<i64>,
        linked_turn_id: Option<&str>,
        created_at: i64,
    ) -> rusqlite::Result<Option<i64>> {
        let inserted = transaction.execute(
            "INSERT INTO issue_comments (issue_id, body, linked_session_id, linked_turn_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(linked_session_id, linked_turn_id) DO NOTHING",
            params![issue_id, body, linked_session_id, linked_turn_id, created_at],
        )?;
        if inserted == 0 {
            return Ok(None);
        }
        Ok(Some(transaction.last_insert_rowid()))
    }

    pub fn exists_by_session_and_turn(
        &self,
        session_id: i64,
        turn_id: &str,
    ) -> rusqlite::Result<bool> {
        self.connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM issue_comments
                    WHERE linked_session_id = ?1 AND linked_turn_id = ?2
                 )",
                params![session_id, turn_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value != 0)
    }
}
