use rusqlite::{
    params, params_from_iter, types::Value, Connection, OptionalExtension, Transaction,
};

use crate::types::agent_session::{AgentSessionAttention, AgentSessionStatus};
use crate::types::issue::{IssueRecord, IssueStatus, IssueStatusTotals};

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
          AND agent_sessions.del = 0
        LIMIT 1
    ) AS linked_session_id,
    (
        SELECT agent_sessions.status
        FROM agent_sessions
        WHERE agent_sessions.issue_id = issues.id
          AND agent_sessions.del = 0
        LIMIT 1
    ) AS linked_session_status,
    (
        SELECT agent_sessions.attention
        FROM agent_sessions
        WHERE agent_sessions.issue_id = issues.id
          AND agent_sessions.del = 0
        LIMIT 1
    ) AS linked_session_attention,
    (
        SELECT agent_sessions.log_path
        FROM agent_sessions
        WHERE agent_sessions.issue_id = issues.id
          AND agent_sessions.del = 0
        LIMIT 1
    ) AS linked_session_log_path,
    (
        SELECT agent_sessions.latest_output
        FROM agent_sessions
        WHERE agent_sessions.issue_id = issues.id
          AND agent_sessions.del = 0
        LIMIT 1
    ) AS linked_session_latest_output,
    issues.label_ids,
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
               AND issues.del = 0
             ORDER BY issues.updated_at DESC, issues.created_at DESC, issues.id DESC"
        ))?;

        let issues = statement
            .query_map(params![project_id], issue_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(issues)
    }

    /// 按 status 过滤并应用 `LIMIT`/`OFFSET` 分页；`status`/`limit`/`offset` 均可选。
    /// 排序与 `list_by_project_id` 一致，保证分页游标稳定。
    pub fn list_by_project_id_paged(
        &self,
        project_id: i64,
        status: Option<IssueStatus>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> rusqlite::Result<Vec<IssueRecord>> {
        let mut sql = format!(
            "{ISSUE_SELECT_COLUMNS}
             WHERE issues.project_id = ?1
               AND issues.del = 0"
        );
        let mut bindings: Vec<Value> = vec![Value::Integer(project_id)];

        if let Some(status) = status {
            let idx = bindings.len() + 1;
            sql.push_str(&format!(" AND issues.status = ?{idx}"));
            bindings.push(Value::Text(issue_status_to_str(&status).to_string()));
        }

        sql.push_str(" ORDER BY issues.updated_at DESC, issues.created_at DESC, issues.id DESC");

        // SQLite 要求 OFFSET 必须配合 LIMIT，因此仅在提供 limit 时附加分页子句。
        if let Some(limit) = limit {
            let idx = bindings.len() + 1;
            sql.push_str(&format!(" LIMIT ?{idx}"));
            bindings.push(Value::Integer(limit));
            if let Some(offset) = offset {
                let offset_idx = bindings.len() + 1;
                sql.push_str(&format!(" OFFSET ?{offset_idx}"));
                bindings.push(Value::Integer(offset));
            }
        }

        let mut statement = self.connection.prepare(&sql)?;
        let issues = statement
            .query_map(params_from_iter(bindings.iter()), issue_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(issues)
    }

    /// 看板首屏：对四个状态各自取前 `per_status_limit` 条，单次返回扁平列表。
    /// 让前端用一次调用即可渲染每个甬道的前 N 条，后续滚动到甬道底部再用
    /// `list_by_project_id_paged` 按状态加载下一页。
    pub fn list_by_project_id_per_status(
        &self,
        project_id: i64,
        per_status_limit: i64,
    ) -> rusqlite::Result<Vec<IssueRecord>> {
        let statuses = [
            IssueStatus::Backlog,
            IssueStatus::Running,
            IssueStatus::Review,
            IssueStatus::Completed,
        ];
        let mut all = Vec::new();
        for status in statuses {
            let page = self.list_by_project_id_paged(
                project_id,
                Some(status),
                Some(per_status_limit),
                Some(0),
            )?;
            all.extend(page);
        }
        Ok(all)
    }

    /// 按状态分组统计项目下未删除 Issue 数量，用于看板甬道总数。
    /// 未出现的状态保持为 0，保证四个甬道都有确定计数。
    pub fn count_grouped_by_status(&self, project_id: i64) -> rusqlite::Result<IssueStatusTotals> {
        let mut statement = self.connection.prepare(
            "SELECT issues.status, COUNT(*) AS count
             FROM issues
             WHERE issues.project_id = ?1 AND issues.del = 0
             GROUP BY issues.status",
        )?;
        let counts = statement.query_map(params![project_id], |row| {
            let status: String = row.get(0)?;
            let count: i64 = row.get(1)?;
            Ok((status, count))
        })?;
        let mut totals = IssueStatusTotals::default();
        for result in counts {
            let (status, count) = result?;
            match issue_status_from_str(&status)? {
                IssueStatus::Backlog => totals.backlog = count,
                IssueStatus::Running => totals.running = count,
                IssueStatus::Review => totals.review = count,
                IssueStatus::Completed => totals.completed = count,
            }
        }
        Ok(totals)
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
        label_ids_json: &str,
    ) -> rusqlite::Result<IssueRecord> {
        self.connection.execute(
            "INSERT INTO issues (project_id, title, description, label_ids, status, created_at, updated_at)
             VALUES (
               ?1,
               ?2,
               ?3,
               ?4,
               'backlog',
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
             )",
            params![project_id, title, description, label_ids_json],
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
        label_ids_json: &str,
    ) -> rusqlite::Result<IssueRecord> {
        transaction.execute(
            "INSERT INTO issues (project_id, title, description, label_ids, status, created_at, updated_at)
             VALUES (
               ?1,
               ?2,
               ?3,
               ?4,
               'backlog',
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
             )",
            params![project_id, title, description, label_ids_json],
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
        label_ids_json: &str,
    ) -> rusqlite::Result<Option<IssueRecord>> {
        let changed = self.connection.execute(
            "UPDATE issues
             SET title = ?1,
                 description = ?2,
                 label_ids = ?3,
                 updated_at = MAX(
                   updated_at + 1,
                   CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
                 )
             WHERE id = ?4 AND project_id = ?5 AND del = 0",
            params![title, description, label_ids_json, issue_id, project_id],
        )?;

        if changed == 0 {
            return Ok(None);
        }

        self.find_by_id(issue_id)
    }

    pub fn find_running_linked_session_id(
        &self,
        project_id: i64,
        issue_id: i64,
    ) -> rusqlite::Result<Option<i64>> {
        self.connection
            .query_row(
                "SELECT agent_sessions.id
                 FROM agent_sessions
                 INNER JOIN issues ON issues.id = agent_sessions.issue_id
                 WHERE issues.id = ?1
                   AND issues.project_id = ?2
                   AND issues.del = 0
                   AND agent_sessions.project_id = ?2
                   AND agent_sessions.del = 0
                   AND agent_sessions.status = 'running'
                 LIMIT 1",
                params![issue_id, project_id],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn find_linked_session_id(
        &self,
        project_id: i64,
        issue_id: i64,
    ) -> rusqlite::Result<Option<i64>> {
        self.connection
            .query_row(
                "SELECT agent_sessions.id
                 FROM agent_sessions
                 INNER JOIN issues ON issues.id = agent_sessions.issue_id
                 WHERE issues.id = ?1
                   AND issues.project_id = ?2
                   AND issues.del = 0
                   AND agent_sessions.project_id = ?2
                   AND agent_sessions.del = 0
                 LIMIT 1",
                params![issue_id, project_id],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn find_by_id_in_transaction(
        transaction: &Transaction<'_>,
        id: i64,
    ) -> rusqlite::Result<Option<IssueRecord>> {
        find_by_id_on_connection(transaction, id)
    }

    pub fn find_linked_session_id_in_transaction(
        transaction: &Transaction<'_>,
        project_id: i64,
        issue_id: i64,
    ) -> rusqlite::Result<Option<i64>> {
        transaction
            .query_row(
                "SELECT agent_sessions.id
                 FROM agent_sessions
                 INNER JOIN issues ON issues.id = agent_sessions.issue_id
                 WHERE issues.id = ?1
                   AND issues.project_id = ?2
            AND issues.del = 0
            AND agent_sessions.project_id = ?2
            AND agent_sessions.del = 0
            LIMIT 1",
                params![issue_id, project_id],
                |row| row.get(0),
            )
            .optional()
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
             WHERE id = ?2 AND project_id = ?3 AND del = 0",
            params![issue_status_to_str(&status), issue_id, project_id],
        )?;

        if changed == 0 {
            return Ok(None);
        }

        find_by_id_on_connection(transaction, issue_id)
    }

    pub fn mark_running_issue_review_in_transaction(
        transaction: &Transaction<'_>,
        project_id: i64,
        issue_id: i64,
        linked_session_id: i64,
    ) -> rusqlite::Result<Option<IssueRecord>> {
        let changed = transaction.execute(
            "UPDATE issues
             SET status = 'review',
                 updated_at = MAX(
                   updated_at + 1,
                   CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
                 )
             WHERE id = ?1
               AND project_id = ?2
               AND del = 0
               AND status = 'running'
            AND EXISTS (
                SELECT 1
                FROM agent_sessions
                WHERE agent_sessions.id = ?3
                AND agent_sessions.issue_id = issues.id
                AND agent_sessions.project_id = ?2
                AND agent_sessions.del = 0
            )",
            params![issue_id, project_id, linked_session_id],
        )?;

        if changed == 0 {
            return Ok(None);
        }

        find_by_id_on_connection(transaction, issue_id)
    }

    pub fn complete_review_issue_manually_in_transaction(
        transaction: &Transaction<'_>,
        project_id: i64,
        issue_id: i64,
        linked_session_id: i64,
    ) -> rusqlite::Result<Option<IssueRecord>> {
        let changed = transaction.execute(
            "UPDATE issues
             SET status = 'completed',
                 updated_at = MAX(
                   updated_at + 1,
                   CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
                 )
             WHERE id = ?1
               AND project_id = ?2
               AND del = 0
               AND status = 'review'
            AND EXISTS (
                SELECT 1
                FROM agent_sessions
                WHERE agent_sessions.id = ?3
                AND agent_sessions.issue_id = issues.id
                AND agent_sessions.project_id = ?2
                AND agent_sessions.del = 0
            )",
            params![issue_id, project_id, linked_session_id],
        )?;

        if changed == 0 {
            return Ok(None);
        }

        find_by_id_on_connection(transaction, issue_id)
    }

    pub fn complete_review_issue_cleanly_in_transaction(
        transaction: &Transaction<'_>,
        project_id: i64,
        issue_id: i64,
        linked_session_id: i64,
    ) -> rusqlite::Result<Option<IssueRecord>> {
        Self::complete_review_issue_manually_in_transaction(
            transaction,
            project_id,
            issue_id,
            linked_session_id,
        )
    }

    pub fn soft_delete_in_transaction(
        transaction: &Transaction<'_>,
        project_id: i64,
        issue_id: i64,
        deleted_at: i64,
    ) -> rusqlite::Result<bool> {
        let changed = transaction.execute(
            "UPDATE issues
             SET del = 1,
                 updated_at = MAX(updated_at + 1, ?1)
             WHERE id = ?2 AND project_id = ?3 AND del = 0",
            params![deleted_at, issue_id, project_id],
        )?;

        Ok(changed > 0)
    }
}

fn find_by_id_on_connection(
    connection: &Connection,
    id: i64,
) -> rusqlite::Result<Option<IssueRecord>> {
    connection
        .query_row(
            &format!("{ISSUE_SELECT_COLUMNS} WHERE issues.id = ?1 AND issues.del = 0"),
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
        attachments: Vec::new(),
        labels: Vec::new(),
        label_ids: parse_label_ids_json(&row.get::<_, String>(10)?)?,
        status: issue_status_from_str(&row.get::<_, String>(4)?)?,
        linked_session_id: row.get(5)?,
        linked_session_status: row
            .get::<_, Option<String>>(6)?
            .map(|value| agent_session_status_from_str(&value))
            .transpose()?,
        linked_session_attention: row
            .get::<_, Option<String>>(7)?
            .map(|value| agent_session_attention_from_str(&value))
            .transpose()?,
        linked_session_log_path: row.get(8)?,
        linked_session_latest_output: row.get(9)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn parse_label_ids_json(value: &str) -> rusqlite::Result<Vec<i64>> {
    serde_json::from_str::<Vec<i64>>(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(10, rusqlite::types::Type::Text, Box::new(error))
    })
}

fn agent_session_status_from_str(value: &str) -> rusqlite::Result<AgentSessionStatus> {
    match value {
        "running" => Ok(AgentSessionStatus::Running),
        "closed" => Ok(AgentSessionStatus::Closed),
        "crashed" => Ok(AgentSessionStatus::Crashed),
        "stopped" => Ok(AgentSessionStatus::Stopped),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn agent_session_attention_from_str(value: &str) -> rusqlite::Result<AgentSessionAttention> {
    match value {
        "none" => Ok(AgentSessionAttention::None),
        "requested" => Ok(AgentSessionAttention::Requested),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{
        MigrationRunner, PROJECT_SCOPED_ISSUE_SESSION_NUMBERS_MIGRATION_SQL,
        PROJECT_SCOPED_ISSUE_SESSION_NUMBERS_MIGRATION_VERSION,
    };

    // 跑到 0035（跳过 0036），用于验证 0036 的回填增量语义：先插入无 number 列的旧数据，
    // 再单独执行 0036 SQL，断言回填结果。
    fn connection_before_project_scoped_numbers() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        MigrationRunner::runner_skipping(&[PROJECT_SCOPED_ISSUE_SESSION_NUMBERS_MIGRATION_VERSION])
            .run(&connection)
            .expect("run migrations up to 0035");
        connection
    }

    // 全量 migration（含 0036），用于校验 schema 产物（列与唯一索引）。
    fn connection_with_all_migrations() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        MigrationRunner::default()
            .run(&connection)
            .expect("run all migrations");
        connection
    }

    fn insert_project(connection: &Connection, id: i64, name: &str) {
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (?1, ?2, ?3, 0, 0)",
                params![id, name, format!("/tmp/{name}")],
            )
            .expect("insert project");
    }

    fn insert_agent_profile(connection: &Connection, id: i64) {
        connection
            .execute(
                "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
                 VALUES (?1, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1, '', '', 0)",
                params![id],
            )
            .expect("insert agent profile");
    }

    // 模拟 0036 之前的旧数据：显式不写 number（该列尚不存在）。
    fn insert_issue_raw(
        connection: &Connection,
        project_id: i64,
        title: &str,
        created_at: i64,
    ) -> i64 {
        connection
            .execute(
                "INSERT INTO issues (project_id, title, description, status, created_at, updated_at)
                 VALUES (?1, ?2, '', 'backlog', ?3, ?3)",
                params![project_id, title, created_at],
            )
            .expect("insert raw issue");
        connection.last_insert_rowid()
    }

    fn insert_session_raw(connection: &Connection, id: i64, project_id: i64, started_at: i64) {
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, agent_profile_id, status, attention,
                   working_dir, command_snapshot, prompt_snapshot, log_path,
                   last_active_at, started_at, del
                 ) VALUES (
                   ?1, ?2, 100, 'closed', 'none',
                   '/tmp/repo', 'codex', '', '/tmp/s.log',
                   ?3, ?3, 0
                 )",
                params![id, project_id, started_at],
            )
            .expect("insert raw agent session");
    }

    fn issue_number(connection: &Connection, issue_id: i64) -> i64 {
        connection
            .query_row(
                "SELECT number FROM issues WHERE id = ?1",
                params![issue_id],
                |row| row.get(0),
            )
            .expect("read issue number")
    }

    fn session_number(connection: &Connection, session_id: i64) -> i64 {
        connection
            .query_row(
                "SELECT number FROM agent_sessions WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .expect("read session number")
    }

    fn run_project_scoped_migration(connection: &Connection) {
        connection
            .execute_batch(PROJECT_SCOPED_ISSUE_SESSION_NUMBERS_MIGRATION_SQL)
            .expect("run 0036 migration sql");
    }

    #[test]
    fn backfill_issues_assigns_continuous_numbers_by_created_at() {
        let connection = connection_before_project_scoped_numbers();
        insert_project(&connection, 1, "p1");
        let first = insert_issue_raw(&connection, 1, "first", 100);
        let second = insert_issue_raw(&connection, 1, "second", 200);
        let third = insert_issue_raw(&connection, 1, "third", 300);

        run_project_scoped_migration(&connection);

        assert_eq!(issue_number(&connection, first), 1);
        assert_eq!(issue_number(&connection, second), 2);
        assert_eq!(issue_number(&connection, third), 3);
    }

    #[test]
    fn backfill_issues_tiebreaks_equal_created_at_by_id() {
        let connection = connection_before_project_scoped_numbers();
        insert_project(&connection, 1, "p1");
        // 同 created_at，id 由插入顺序决定（先插入者 id 更小）。
        let earlier_id = insert_issue_raw(&connection, 1, "earlier", 500);
        let later_id = insert_issue_raw(&connection, 1, "later", 500);

        run_project_scoped_migration(&connection);

        assert_eq!(issue_number(&connection, earlier_id), 1);
        assert_eq!(issue_number(&connection, later_id), 2);
    }

    #[test]
    fn backfill_issues_isolates_numbering_per_project() {
        let connection = connection_before_project_scoped_numbers();
        insert_project(&connection, 1, "p1");
        insert_project(&connection, 2, "p2");
        let p1_a = insert_issue_raw(&connection, 1, "p1-a", 100);
        let p2_a = insert_issue_raw(&connection, 2, "p2-a", 50);
        let p1_b = insert_issue_raw(&connection, 1, "p1-b", 200);
        let p2_b = insert_issue_raw(&connection, 2, "p2-b", 60);

        run_project_scoped_migration(&connection);

        assert_eq!(issue_number(&connection, p1_a), 1);
        assert_eq!(issue_number(&connection, p1_b), 2);
        assert_eq!(issue_number(&connection, p2_a), 1);
        assert_eq!(issue_number(&connection, p2_b), 2);
    }

    #[test]
    fn backfill_agent_sessions_assigns_continuous_numbers_by_started_at() {
        let connection = connection_before_project_scoped_numbers();
        insert_project(&connection, 1, "p1");
        insert_agent_profile(&connection, 100);
        insert_session_raw(&connection, 10, 1, 1_000);
        insert_session_raw(&connection, 20, 1, 2_000);
        insert_session_raw(&connection, 30, 1, 3_000);

        run_project_scoped_migration(&connection);

        assert_eq!(session_number(&connection, 10), 1);
        assert_eq!(session_number(&connection, 20), 2);
        assert_eq!(session_number(&connection, 30), 3);
    }

    #[test]
    fn migration_adds_project_scoped_number_columns() {
        let connection = connection_with_all_migrations();

        let issues_has_number = column_exists(&connection, "issues", "number");
        let sessions_has_number = column_exists(&connection, "agent_sessions", "number");

        assert!(issues_has_number, "issues.number column should exist");
        assert!(
            sessions_has_number,
            "agent_sessions.number column should exist"
        );

        // DEFAULT 0：不指定 number 插入应成功，值默认为 0。
        insert_project(&connection, 1, "p1");
        connection
            .execute(
                "INSERT INTO issues (project_id, title, description, status, created_at, updated_at)
                 VALUES (1, 'one', '', 'backlog', 1, 1)",
                [],
            )
            .expect("insert issue without number");
        let default_number: i64 = connection
            .query_row(
                "SELECT number FROM issues WHERE project_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read default number");
        assert_eq!(default_number, 0);
    }

    fn column_exists(connection: &Connection, table: &str, column: &str) -> bool {
        let pragma = format!("PRAGMA table_info({table})");
        let mut statement = connection.prepare(&pragma).expect("prepare pragma");
        let mut rows = statement.query([]).expect("query pragma");
        while let Some(row) = rows.next().expect("next row") {
            let name: String = row.get(1).expect("read column name");
            if name == column {
                return true;
            }
        }
        false
    }
}
