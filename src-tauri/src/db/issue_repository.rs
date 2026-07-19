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
    issues.updated_at,
    issues.number,
    issues.status_changed_at
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
             ORDER BY issues.status_changed_at DESC, issues.created_at DESC, issues.id DESC"
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

        sql.push_str(
            " ORDER BY issues.status_changed_at DESC, issues.created_at DESC, issues.id DESC",
        );

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
        let number: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(number), 0) + 1 FROM issues WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )?;
        self.connection.execute(
            "INSERT INTO issues (project_id, number, title, description, label_ids, status, created_at, updated_at, status_changed_at)
             VALUES (
               ?1,
               ?2,
               ?3,
               ?4,
               ?5,
               'backlog',
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
             )",
            params![project_id, number, title, description, label_ids_json],
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
        let number: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(number), 0) + 1 FROM issues WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT INTO issues (project_id, number, title, description, label_ids, status, created_at, updated_at, status_changed_at)
             VALUES (
               ?1,
               ?2,
               ?3,
               ?4,
               ?5,
               'backlog',
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
               CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
             )",
            params![project_id, number, title, description, label_ids_json],
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
                 ),
                 status_changed_at = MAX(
                   status_changed_at + 1,
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
                 ),
                 status_changed_at = MAX(
                   status_changed_at + 1,
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
                 ),
                 status_changed_at = MAX(
                   status_changed_at + 1,
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
        number: row.get(13)?,
        status_changed_at: row.get(14)?,
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
        AGENT_SESSIONS_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_VERSION,
        ISSUES_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_SQL,
        ISSUES_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_VERSION, ISSUES_STATUS_CHANGED_AT_MIGRATION_SQL,
        ISSUES_STATUS_CHANGED_AT_MIGRATION_VERSION, MigrationRunner,
        PROJECT_SCOPED_ISSUE_SESSION_NUMBERS_MIGRATION_SQL,
        PROJECT_SCOPED_ISSUE_SESSION_NUMBERS_MIGRATION_VERSION,
    };

    // 跑到 0035（跳过 0036 与依赖它的 0037/0038），用于验证 0036 的回填增量语义：先插入无
    // number 列的旧数据，再单独执行 0036 SQL，断言回填结果。0037/0038 依赖 number 列，必须一并跳过。
    fn connection_before_project_scoped_numbers() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        MigrationRunner::runner_skipping(&[
            PROJECT_SCOPED_ISSUE_SESSION_NUMBERS_MIGRATION_VERSION,
            ISSUES_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_VERSION,
            AGENT_SESSIONS_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_VERSION,
        ])
        .run(&connection)
        .expect("run migrations up to 0035");
        connection
    }

    // 跑到 0036（跳过 0037），用于验证 0037 的回填增量语义：number 列已存在且历史行已由
    // 0036 回填为正编号；再插入过渡期 number=0 行，单独执行 0037 SQL，断言回填与唯一索引。
    fn connection_before_issues_unique_index() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        MigrationRunner::runner_skipping(&[ISSUES_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_VERSION])
            .run(&connection)
            .expect("run migrations up to 0036");
        connection
    }

    // 跑到 0045（跳过 0046），用于验证 0046 的回填增量语义：先插入无 status_changed_at 列的
    // 旧数据 + 对应 issue_actions 动作，再单独执行 0046 SQL，断言回填为最大状态动作 created_at。
    fn connection_before_status_changed_at() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        MigrationRunner::runner_skipping(&[ISSUES_STATUS_CHANGED_AT_MIGRATION_VERSION])
            .run(&connection)
            .expect("run migrations up to 0045");
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

    fn run_issues_unique_migration(connection: &Connection) {
        connection
            .execute_batch(ISSUES_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_SQL)
            .expect("run 0037 migration sql");
    }

    fn run_status_changed_at_migration(connection: &Connection) {
        connection
            .execute_batch(ISSUES_STATUS_CHANGED_AT_MIGRATION_SQL)
            .expect("run 0046 migration sql");
    }

    // 插入一条带显式 status_changed_at 的 issue（status_changed_at 列存在时使用）。
    fn insert_issue_with_status_changed_at(
        connection: &Connection,
        project_id: i64,
        number: i64,
        title: &str,
        created_at: i64,
        status_changed_at: i64,
    ) -> i64 {
        connection
            .execute(
                "INSERT INTO issues (
                   project_id, number, title, description, status,
                   created_at, updated_at, status_changed_at
                 )
                 VALUES (?1, ?2, ?3, '', 'backlog', ?4, ?4, ?5)",
                params![project_id, number, title, created_at, status_changed_at],
            )
            .expect("insert issue with status_changed_at");
        connection.last_insert_rowid()
    }

    // 插入一条 issue_actions 行（仅原始 0005 四列；0041/0043 后续列走默认值或 NULL）。
    fn insert_issue_action(
        connection: &Connection,
        issue_id: i64,
        action_type: &str,
        created_at: i64,
    ) {
        connection
            .execute(
                "INSERT INTO issue_actions (issue_id, action_type, payload_json, created_at)
                 VALUES (?1, ?2, '{}', ?3)",
                params![issue_id, action_type, created_at],
            )
            .expect("insert issue action");
    }

    fn status_changed_at_of(connection: &Connection, issue_id: i64) -> i64 {
        connection
            .query_row(
                "SELECT status_changed_at FROM issues WHERE id = ?1",
                params![issue_id],
                |row| row.get(0),
            )
            .expect("read status_changed_at")
    }

    // 插入一条显式指定 number 的 issue，用于构造 0036 已回填的历史行（number > 0）。
    fn insert_issue_with_number(
        connection: &Connection,
        project_id: i64,
        number: i64,
        title: &str,
        created_at: i64,
    ) -> i64 {
        connection
            .execute(
                "INSERT INTO issues (project_id, number, title, description, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, '', 'backlog', ?4, ?4)",
                params![project_id, number, title, created_at],
            )
            .expect("insert issue with number");
        connection.last_insert_rowid()
    }

    // 插入一条过渡期 number=0 的 issue（模拟 0036 之后、0037 之前走旧路径的新建行）。
    fn insert_issue_unassigned(
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
            .expect("insert unassigned issue");
        connection.last_insert_rowid()
    }

    fn soft_delete_issue(connection: &Connection, issue_id: i64, deleted_at: i64) {
        connection
            .execute(
                "UPDATE issues SET del = 1, updated_at = ?2 WHERE id = ?1 AND del = 0",
                params![issue_id, deleted_at],
            )
            .expect("soft delete issue");
    }

    fn unique_index_exists(connection: &Connection, table: &str, index: &str) -> bool {
        connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'index' AND tbl_name = ?1 AND name = ?2",
                params![table, index],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count > 0)
            .expect("query index existence")
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

    #[test]
    fn insert_assigns_project_scoped_sequential_numbers() {
        let connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        let repo = IssueRepository::new(&connection);

        let first = repo.insert(1, "a", "", "[]").expect("insert first");
        let second = repo.insert(1, "b", "", "[]").expect("insert second");
        let third = repo.insert(1, "c", "", "[]").expect("insert third");

        assert_eq!(first.number, 1);
        assert_eq!(second.number, 2);
        assert_eq!(third.number, 3);
        // 返回的 IssueRecord 透传真实 number（非 0 占位）。
        assert_eq!(issue_number(&connection, first.id), 1);
        assert_eq!(issue_number(&connection, second.id), 2);
        assert_eq!(issue_number(&connection, third.id), 3);
    }

    #[test]
    fn insert_in_transaction_assigns_project_scoped_number() {
        let mut connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        // 预置一个已分配 number=1 的行，验证事务内分配从 MAX+1 开始。
        insert_issue_with_number(&connection, 1, 1, "seed", 100);

        let tx_issue = connection
            .transaction()
            .and_then(|transaction| {
                let issue = IssueRepository::insert_in_transaction(
                    &transaction,
                    1,
                    "via-tx",
                    "",
                    "[]",
                )?;
                transaction.commit()?;
                Ok(issue)
            })
            .expect("insert in transaction");

        assert_eq!(tx_issue.number, 2);
        assert_eq!(issue_number(&connection, tx_issue.id), 2);
    }

    #[test]
    fn insert_isolates_numbering_per_project() {
        let connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        insert_project(&connection, 2, "p2");
        let repo = IssueRepository::new(&connection);

        let p1_first = repo.insert(1, "p1-a", "", "[]").expect("p1 first");
        let p2_first = repo.insert(2, "p2-a", "", "[]").expect("p2 first");
        let p1_second = repo.insert(1, "p1-b", "", "[]").expect("p1 second");

        assert_eq!(p1_first.number, 1);
        assert_eq!(p2_first.number, 1);
        assert_eq!(p1_second.number, 2);
    }

    #[test]
    fn insert_does_not_reuse_number_after_soft_delete() {
        // 分配 SQL 不过滤 del：软删除行保留 number 且计入 MAX，新建不复用已删除编号。
        let connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        let repo = IssueRepository::new(&connection);

        let first = repo.insert(1, "a", "", "[]").expect("insert first");
        let second = repo.insert(1, "b", "", "[]").expect("insert second");
        soft_delete_issue(&connection, second.id, second.updated_at);

        let third = repo.insert(1, "c", "", "[]").expect("insert after delete");

        assert_eq!(first.number, 1);
        assert_eq!(second.number, 2);
        assert_eq!(third.number, 3);
        // 软删除行仍持有原 number（del=1 但 number 不变）。
        assert_eq!(issue_number(&connection, second.id), 2);
    }

    #[test]
    fn migration_0037_backfills_zero_numbered_rows_without_changing_existing() {
        let connection = connection_before_issues_unique_index();
        insert_project(&connection, 1, "p1");
        // 历史行：0036 已回填为正编号 1..3。
        let h1 = insert_issue_with_number(&connection, 1, 1, "hist-1", 100);
        let h2 = insert_issue_with_number(&connection, 1, 2, "hist-2", 200);
        let h3 = insert_issue_with_number(&connection, 1, 3, "hist-3", 300);
        // 过渡期 number=0 行（0036 之后、0037 之前新建，走旧路径默认 0）。
        let t1 = insert_issue_unassigned(&connection, 1, "trans-1", 400);
        let t2 = insert_issue_unassigned(&connection, 1, "trans-2", 500);

        run_issues_unique_migration(&connection);

        // 已分配(>0)的 number 不变。
        assert_eq!(issue_number(&connection, h1), 1);
        assert_eq!(issue_number(&connection, h2), 2);
        assert_eq!(issue_number(&connection, h3), 3);
        // 过渡期行按 (created_at, id) 接续到 4、5。
        assert_eq!(issue_number(&connection, t1), 4);
        assert_eq!(issue_number(&connection, t2), 5);

        // 项目内无重复 number。
        let duplicate_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM (
                   SELECT project_id, number, COUNT(*) AS c
                   FROM issues WHERE project_id = 1
                   GROUP BY project_id, number HAVING c > 1
                 )",
                [],
                |row| row.get(0),
            )
            .expect("duplicate count");
        assert_eq!(duplicate_count, 0);

        assert!(unique_index_exists(
            &connection,
            "issues",
            "uidx_issues_project_id_number"
        ));
    }

    #[test]
    fn migration_0037_tiebreaks_zero_rows_by_created_at_then_id() {
        // 同 created_at 的过渡期行按 id 升序接续；验证回填与扫描顺序无关。
        let connection = connection_before_issues_unique_index();
        insert_project(&connection, 1, "p1");
        insert_issue_with_number(&connection, 1, 1, "hist", 100);
        let t_earlier = insert_issue_unassigned(&connection, 1, "earlier", 500);
        let t_later = insert_issue_unassigned(&connection, 1, "later", 500);

        run_issues_unique_migration(&connection);

        assert_eq!(issue_number(&connection, t_earlier), 2);
        assert_eq!(issue_number(&connection, t_later), 3);
    }

    #[test]
    fn migration_0037_isolates_backfill_per_project() {
        let connection = connection_before_issues_unique_index();
        insert_project(&connection, 1, "p1");
        insert_project(&connection, 2, "p2");
        insert_issue_with_number(&connection, 1, 1, "p1-hist", 100);
        insert_issue_with_number(&connection, 2, 1, "p2-hist", 100);
        let p1_trans = insert_issue_unassigned(&connection, 1, "p1-trans", 200);
        let p2_trans = insert_issue_unassigned(&connection, 2, "p2-trans", 200);

        run_issues_unique_migration(&connection);

        assert_eq!(issue_number(&connection, p1_trans), 2);
        assert_eq!(issue_number(&connection, p2_trans), 2);
    }

    #[test]
    fn migration_0037_is_noop_when_no_zero_numbered_rows() {
        let connection = connection_before_issues_unique_index();
        insert_project(&connection, 1, "p1");
        let only = insert_issue_with_number(&connection, 1, 1, "only", 100);

        run_issues_unique_migration(&connection);

        assert_eq!(issue_number(&connection, only), 1);
        assert!(unique_index_exists(
            &connection,
            "issues",
            "uidx_issues_project_id_number"
        ));
    }

    #[test]
    fn list_by_status_orders_by_status_changed_at_desc_with_created_at_id_tiebreakers() {
        let connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        // 同状态 (backlog)，status_changed_at 单调不同：100 / 300 / 200 → 期望 300, 200, 100。
        insert_issue_with_status_changed_at(&connection, 1, 1, "early", 1_000, 100);
        insert_issue_with_status_changed_at(&connection, 1, 2, "latest", 1_200, 300);
        insert_issue_with_status_changed_at(&connection, 1, 3, "middle", 1_100, 200);
        // status_changed_at 相同（=500），按 created_at DESC：later(1_500) 先于 earlier(1_400)。
        insert_issue_with_status_changed_at(&connection, 1, 4, "tie-earlier", 1_400, 500);
        insert_issue_with_status_changed_at(&connection, 1, 5, "tie-later", 1_500, 500);

        let repo = IssueRepository::new(&connection);
        let issues = repo
            .list_by_project_id_paged(1, Some(IssueStatus::Backlog), None, None)
            .expect("list backlog paged");

        let titles: Vec<&str> = issues.iter().map(|i| i.title.as_str()).collect();
        assert_eq!(
            titles,
            vec!["tie-later", "tie-earlier", "latest", "middle", "early"]
        );
    }

    #[test]
    fn migration_0046_backfills_status_changed_at_from_latest_status_action() {
        let connection = connection_before_status_changed_at();
        insert_project(&connection, 1, "p1");
        // 历史 issue：created_at = updated_at = 100；列尚不存在，不能写 status_changed_at。
        let with_actions = insert_issue_with_number(&connection, 1, 1, "with-actions", 100);
        let no_actions = insert_issue_with_number(&connection, 1, 2, "no-actions", 200);

        // 状态相关动作：created_at 100 / 500 / 800；最大值 800 为期望回填值。
        insert_issue_action(&connection, with_actions, "agent_session_started", 500);
        insert_issue_action(&connection, with_actions, "issue_status_changed", 800);
        // issue_created 不在状态相关动作集合内，不影响回填。
        insert_issue_action(&connection, with_actions, "issue_created", 100);
        // issue_comment_added 同理不计入。
        insert_issue_action(&connection, with_actions, "issue_comment_added", 900);

        run_status_changed_at_migration(&connection);

        // 取状态相关动作的最大 created_at（800），忽略 issue_created / issue_comment_added。
        assert_eq!(status_changed_at_of(&connection, with_actions), 800);
        // 无任何相关动作 → 退回 updated_at（= 200）。
        assert_eq!(status_changed_at_of(&connection, no_actions), 200);
    }

    #[test]
    fn update_status_advances_status_changed_at_but_title_edit_does_not() {
        let mut connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        let repo = IssueRepository::new(&connection);
        let issue = repo.insert(1, "title", "desc", "[]").expect("insert issue");
        let initial_status_changed_at = issue.status_changed_at;

        // 标题/描述更新不推进 status_changed_at（与 updated_at 职责分离）。
        let edited = repo
            .update_title_and_description(1, issue.id, "new-title", "new-desc", "[]")
            .expect("update title")
            .expect("issue present");
        assert_eq!(
            edited.status_changed_at, initial_status_changed_at,
            "title edit must not advance status_changed_at"
        );

        // 状态迁移推进 status_changed_at；MAX(status_changed_at + 1, now) 保证至少 +1。
        let advanced_status_changed_at = connection
            .transaction()
            .and_then(|transaction| {
                let updated = IssueRepository::update_status_in_transaction(
                    &transaction,
                    1,
                    issue.id,
                    IssueStatus::Running,
                )
                .expect("advance status")
                .expect("issue present");
                transaction.commit()?;
                Ok(updated.status_changed_at)
            })
            .expect("transaction");
        assert!(
            advanced_status_changed_at > initial_status_changed_at,
            "status migration must advance status_changed_at"
        );

        // 透传：返回的 IssueRecord 字段非默认值（与 DB 真实值一致）。
        assert_eq!(
            status_changed_at_of(&connection, issue.id),
            advanced_status_changed_at
        );
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
