use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::types::agent_profile::AgentType;
use crate::types::agent_session::{
    AgentSessionAttention, AgentSessionRecord, AgentSessionStatus, WorkspaceMode, WorktreeOwner,
    workspace_mode_to_str,
};
use crate::types::issue::IssueStatus;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSessionListRow {
    pub session_id: i64,
    pub number: i64,
    pub project_id: i64,
    pub issue_id: Option<i64>,
    pub issue_number: Option<i64>,
    pub issue_title: Option<String>,
    pub issue_status: Option<IssueStatus>,
    pub agent_profile_id: i64,
    pub agent_profile_name: String,
    pub title: Option<String>,
    pub agent_type: AgentType,
    pub display_mode: String,
    pub status: AgentSessionStatus,
    pub attention: AgentSessionAttention,
    pub is_turn_running: bool,
    pub workspace_mode: WorkspaceMode,
    pub working_dir: String,
    pub workspace_path: Option<String>,
    pub origin_branch: Option<String>,
    pub workspace_branch: Option<String>,
    pub worktree_owner: WorktreeOwner,
    pub log_path: String,
    pub latest_output: Option<String>,
    pub workflow_skill_name: Option<String>,
    pub list_inserted_at: i64,
    pub last_active_at: i64,
    pub started_at: i64,
    pub closed_at: Option<i64>,
    pub turn_ended_at: Option<i64>,
    pub turn_started_at: Option<i64>,
    pub processing_ms: i64,
    pub last_output_at: Option<i64>,
}

pub struct AgentSessionRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> AgentSessionRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn find_by_id(&self, id: i64) -> rusqlite::Result<Option<AgentSessionRecord>> {
        self.connection
            .query_row(
                "SELECT id, project_id, issue_id, title, agent_profile_id, workflow_skill_name, codex_session_id, status, attention, working_dir, command_snapshot, prompt_snapshot, workspace_mode, target_branch, workspace_branch, workspace_path, origin_branch, worktree_owner, worktree_root_path, worktree_setup_command, log_path, latest_output, last_active_at, started_at, closed_at, number, display_mode
                 FROM agent_sessions
                 WHERE id = ?1 AND del = 0",
                params![id],
                agent_session_from_row,
            )
            .optional()
    }

    /// 读取 session 当前 turn 上下文；session 不存在时返回 `QueryReturnedNoRows`。
    pub fn find_current_turn(
        &self,
        session_id: i64,
    ) -> rusqlite::Result<(Option<String>, Option<String>)> {
        self.connection.query_row(
            "SELECT current_turn_source, current_turn_id FROM agent_sessions
             WHERE id = ?1 AND del = 0",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }

    /// 取 session 关联且未删除的 Issue id。
    pub fn find_active_issue_id_by_session_id(
        &self,
        session_id: i64,
    ) -> rusqlite::Result<Option<i64>> {
        self.connection
            .query_row(
                "SELECT issues.id FROM issues
                 JOIN agent_sessions ON agent_sessions.issue_id = issues.id
                 WHERE agent_sessions.id = ?1 AND issues.del = 0",
                params![session_id],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn find_by_issue_id(&self, issue_id: i64) -> rusqlite::Result<Option<AgentSessionRecord>> {
        self.connection
            .query_row(
                "SELECT id, project_id, issue_id, title, agent_profile_id, workflow_skill_name, codex_session_id, status, attention, working_dir, command_snapshot, prompt_snapshot, workspace_mode, target_branch, workspace_branch, workspace_path, origin_branch, worktree_owner, worktree_root_path, worktree_setup_command, log_path, latest_output, last_active_at, started_at, closed_at, number, display_mode
                 FROM agent_sessions
                 WHERE issue_id = ?1 AND del = 0",
                params![issue_id],
                agent_session_from_row,
            )
            .optional()
    }

    pub fn find_latest_session_by_issue_id(
        &self,
        issue_id: i64,
    ) -> rusqlite::Result<Option<AgentSessionRecord>> {
        self.connection
            .query_row(
                "SELECT id, project_id, issue_id, title, agent_profile_id, workflow_skill_name, codex_session_id, status, attention, working_dir, command_snapshot, prompt_snapshot, workspace_mode, target_branch, workspace_branch, workspace_path, origin_branch, worktree_owner, worktree_root_path, worktree_setup_command, log_path, latest_output, last_active_at, started_at, closed_at, number, display_mode
                 FROM agent_sessions
                 WHERE issue_id = ?1
                 ORDER BY id DESC
                 LIMIT 1",
                params![issue_id],
                agent_session_from_row,
            )
            .optional()
    }

    /// 查找 issue 最近一次 worktree 模式 session，忽略软删标记。
    ///
    /// 退回 Backlog 后旧 session 被软删（`del = 1`），但其 `workspace_path` /
    /// `workspace_branch` 仍指向残留的 worktree 目录与分支。再次运行前需要据此
    /// 判断是否存在同名 worktree 占用，运行时也需要据此兜底拦截。
    pub fn find_latest_worktree_session_by_issue_id(
        &self,
        issue_id: i64,
    ) -> rusqlite::Result<Option<AgentSessionRecord>> {
        self.connection
            .query_row(
                "SELECT id, project_id, issue_id, title, agent_profile_id, workflow_skill_name, codex_session_id, status, attention, working_dir, command_snapshot, prompt_snapshot, workspace_mode, target_branch, workspace_branch, workspace_path, origin_branch, worktree_owner, worktree_root_path, worktree_setup_command, log_path, latest_output, last_active_at, started_at, closed_at, number, display_mode
                 FROM agent_sessions
                 WHERE issue_id = ?1 AND workspace_mode = 'worktree'
                 ORDER BY id DESC
                 LIMIT 1",
                params![issue_id],
                agent_session_from_row,
            )
            .optional()
    }

    /// 按 `(project_id, workspace_path)` 反查最新一条未软删 session。
    ///
    /// 用于 `session_id=None` 但 `workspace_path=Some` 的场景（code 变更页直接按
    /// worktree 路径请求 commit history）：取该 worktree 最近一次 session 记录的
    /// `target_branch` 作为分叉基。同一 worktree 可能被多次 session 复用，取最新
    /// 一条（按 `started_at DESC, id DESC`）。无匹配返回 None，由调用方回退到
    /// 启发式 `find_branch_base`。
    pub fn find_latest_by_workspace_path(
        &self,
        project_id: i64,
        workspace_path: &str,
    ) -> rusqlite::Result<Option<AgentSessionRecord>> {
        self.connection
            .query_row(
                "SELECT id, project_id, issue_id, title, agent_profile_id, workflow_skill_name, codex_session_id, status, attention, working_dir, command_snapshot, prompt_snapshot, workspace_mode, target_branch, workspace_branch, workspace_path, origin_branch, worktree_owner, worktree_root_path, worktree_setup_command, log_path, latest_output, last_active_at, started_at, closed_at, number, display_mode
                 FROM agent_sessions
                 WHERE project_id = ?1 AND workspace_path = ?2 AND del = 0
                 ORDER BY started_at DESC, id DESC
                 LIMIT 1",
                params![project_id, workspace_path],
                agent_session_from_row,
            )
            .optional()
    }

    pub fn list_by_project_id(
        &self,
        project_id: i64,
    ) -> rusqlite::Result<Vec<AgentSessionListRow>> {
        let mut statement = self.connection.prepare(
            "SELECT
                agent_sessions.id,
                agent_sessions.number,
                agent_sessions.project_id,
                agent_sessions.issue_id,
                issues.number AS issue_number,
                issues.title,
                issues.status,
                agent_sessions.agent_profile_id,
                agent_profiles.name,
                agent_sessions.title,
                agent_profiles.agent_type,
                agent_sessions.status,
                agent_sessions.attention,
                agent_sessions.is_turn_running,
                agent_sessions.workspace_mode,
                agent_sessions.working_dir,
                agent_sessions.workspace_path,
                agent_sessions.origin_branch,
                agent_sessions.workspace_branch,
                agent_sessions.worktree_owner,
                agent_sessions.log_path,
                agent_sessions.latest_output,
                agent_sessions.workflow_skill_name,
                COALESCE(agent_sessions.list_inserted_at, agent_sessions.started_at),
                agent_sessions.last_active_at,
                agent_sessions.started_at,
                agent_sessions.closed_at,
                agent_sessions.turn_ended_at,
                agent_sessions.turn_started_at,
                agent_sessions.processing_ms,
                agent_sessions.last_output_at,
                agent_sessions.display_mode
             FROM agent_sessions
             LEFT JOIN issues
               ON issues.id = agent_sessions.issue_id
              AND issues.project_id = agent_sessions.project_id
              AND issues.del = 0
             INNER JOIN agent_profiles ON agent_profiles.id = agent_sessions.agent_profile_id
             WHERE agent_sessions.project_id = ?1
               AND agent_sessions.del = 0",
        )?;

        let sessions = statement
            .query_map(params![project_id], agent_session_list_row_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(sessions)
    }

    pub fn prune_completed_over_limit(
        &self,
        project_id: i64,
        keep_completed_count: usize,
        deleted_at: i64,
    ) -> rusqlite::Result<usize> {
        self.connection.execute(
            "UPDATE agent_sessions
             SET del = 1,
                 last_active_at = MAX(last_active_at + 1, ?3)
             WHERE id IN (
               SELECT agent_sessions.id
               FROM agent_sessions
               LEFT JOIN issues
                 ON issues.id = agent_sessions.issue_id
                AND issues.project_id = agent_sessions.project_id
                AND issues.del = 0
               WHERE agent_sessions.project_id = ?1
                 AND agent_sessions.del = 0
                 AND (
                   issues.status = 'completed'
                   OR (
                     agent_sessions.issue_id IS NULL
                     AND agent_sessions.status IN ('closed', 'crashed', 'stopped')
                   )
                 )
               ORDER BY COALESCE(agent_sessions.list_inserted_at, agent_sessions.started_at) DESC,
                        agent_sessions.id DESC
               LIMIT -1 OFFSET ?2
             )",
            params![project_id, keep_completed_count as i64, deleted_at],
        )
    }

    pub fn prune_broken_structured_standalone_sessions(
        &self,
        project_id: i64,
        deleted_at: i64,
    ) -> rusqlite::Result<usize> {
        self.connection.execute(
            "UPDATE agent_sessions
             SET del = 1,
                 last_active_at = MAX(last_active_at + 1, ?2)
             WHERE project_id = ?1
               AND issue_id IS NULL
               AND del = 0
               AND status IN ('stopped', 'crashed', 'closed')
               AND log_path LIKE '%structured-project-%'
               AND COALESCE(TRIM(codex_session_id), '') = ''",
            params![project_id, deleted_at],
        )
    }

    pub fn list_runtime_cleanup_candidates(
        &self,
        project_id: i64,
        session_ids: &[i64],
    ) -> rusqlite::Result<Vec<i64>> {
        let mut cleanup_ids = Vec::new();
        let mut statement = self
            .connection
            .prepare("SELECT project_id, status, del FROM agent_sessions WHERE id = ?1")?;

        for session_id in session_ids {
            let row = statement
                .query_row(params![session_id], |row| {
                    let row_project_id: i64 = row.get(0)?;
                    let status: String = row.get(1)?;
                    let del: i64 = row.get(2)?;
                    Ok((row_project_id, status, del))
                })
                .optional()?;

            match row {
                Some((row_project_id, status, del))
                    if row_project_id == project_id
                        && (del != 0
                            || status
                                != agent_session_status_to_str(&AgentSessionStatus::Running)) =>
                {
                    cleanup_ids.push(*session_id);
                }
                None => cleanup_ids.push(*session_id),
                _ => {}
            }
        }

        Ok(cleanup_ids)
    }

    pub fn list_running_by_project_id(
        &self,
        project_id: i64,
    ) -> rusqlite::Result<Vec<AgentSessionRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, issue_id, title, agent_profile_id, workflow_skill_name, codex_session_id, status, attention, working_dir, command_snapshot, prompt_snapshot, workspace_mode, target_branch, workspace_branch, workspace_path, origin_branch, worktree_owner, worktree_root_path, worktree_setup_command, log_path, latest_output, last_active_at, started_at, closed_at, number, display_mode
             FROM agent_sessions
             WHERE project_id = ?1 AND status = 'running' AND del = 0
             ORDER BY last_active_at DESC, started_at DESC, id DESC",
        )?;

        let sessions = statement
            .query_map(params![project_id], agent_session_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(sessions)
    }

    pub fn find_by_id_in_transaction(
        transaction: &Transaction<'_>,
        id: i64,
    ) -> rusqlite::Result<Option<AgentSessionRecord>> {
        find_by_id_on_connection(transaction, id)
    }

    pub fn insert_in_transaction(
        transaction: &Transaction<'_>,
        project_id: i64,
        issue_id: i64,
        agent_profile_id: i64,
        workflow_skill_name: Option<&str>,
        working_dir: &str,
        command_snapshot: &str,
        prompt_snapshot: &str,
        workspace_mode: &WorkspaceMode,
        target_branch: Option<&str>,
        workspace_branch: Option<&str>,
        workspace_path: Option<&str>,
        origin_branch: Option<&str>,
        worktree_owner: WorktreeOwner,
        worktree_root_path: Option<&str>,
        worktree_setup_command: Option<&str>,
        log_path: &str,
        display_mode: &str,
        started_at: i64,
    ) -> rusqlite::Result<AgentSessionRecord> {
        let number: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(number), 0) + 1 FROM agent_sessions WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT INTO agent_sessions (
               project_id,
               number,
               issue_id,
               agent_profile_id,
               workflow_skill_name,
               status,
               attention,
               working_dir,
               command_snapshot,
               prompt_snapshot,
               workspace_mode,
               target_branch,
               workspace_branch,
               workspace_path,
               origin_branch,
               worktree_owner,
               worktree_root_path,
               worktree_setup_command,
               log_path,
               display_mode,
               list_inserted_at,
               last_active_at,
               started_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'running', 'none', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?20)",
            params![
                project_id,
                number,
                issue_id,
                agent_profile_id,
                workflow_skill_name,
                working_dir,
                command_snapshot,
                prompt_snapshot,
                workspace_mode_to_str(workspace_mode),
                target_branch,
                workspace_branch,
                workspace_path,
                origin_branch,
                worktree_owner.as_str(),
                worktree_root_path,
                worktree_setup_command,
                log_path,
                display_mode,
                started_at,
                started_at
            ],
        )?;

        let id = transaction.last_insert_rowid();
        find_by_id_on_connection(transaction, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn insert_standalone_in_transaction(
        transaction: &Transaction<'_>,
        project_id: i64,
        title: &str,
        agent_profile_id: i64,
        working_dir: &str,
        command_snapshot: &str,
        prompt_snapshot: &str,
        workspace_mode: &WorkspaceMode,
        target_branch: Option<&str>,
        workspace_branch: Option<&str>,
        workspace_path: Option<&str>,
        worktree_root_path: Option<&str>,
        worktree_setup_command: Option<&str>,
        log_path: &str,
        display_mode: &str,
        started_at: i64,
    ) -> rusqlite::Result<AgentSessionRecord> {
        let origin_branch = target_branch;
        let worktree_owner = inferred_worktree_owner(workspace_mode);
        let number: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(number), 0) + 1 FROM agent_sessions WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT INTO agent_sessions (
               project_id,
               number,
               issue_id,
               title,
               agent_profile_id,
               status,
               attention,
               working_dir,
               command_snapshot,
               prompt_snapshot,
               workspace_mode,
               target_branch,
               workspace_branch,
               workspace_path,
               origin_branch,
               worktree_owner,
               worktree_root_path,
               worktree_setup_command,
               log_path,
               display_mode,
               list_inserted_at,
               last_active_at,
               started_at
             ) VALUES (?1, ?2, NULL, ?3, ?4, 'running', 'none', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19)",
            params![
                project_id,
                number,
                title,
                agent_profile_id,
                working_dir,
                command_snapshot,
                prompt_snapshot,
                workspace_mode_to_str(workspace_mode),
                target_branch,
                workspace_branch,
                workspace_path,
                origin_branch,
                worktree_owner.as_str(),
                worktree_root_path,
                worktree_setup_command,
                log_path,
                display_mode,
                started_at,
                started_at
            ],
        )?;

        let id = transaction.last_insert_rowid();
        find_by_id_on_connection(transaction, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn mark_terminated_in_transaction(
        transaction: &Transaction<'_>,
        session_id: i64,
        status: AgentSessionStatus,
        terminated_at: i64,
    ) -> rusqlite::Result<Option<AgentSessionRecord>> {
        let changed = transaction.execute(
            "UPDATE agent_sessions
            SET status = ?1,
                is_turn_running = 0,
                turn_ended_at = NULL,
                turn_started_at = NULL,
                last_active_at = MAX(last_active_at + 1, ?2),
                 closed_at = COALESCE(closed_at, ?2)
             WHERE id = ?3 AND closed_at IS NULL AND del = 0",
            params![
                agent_session_status_to_str(&status),
                terminated_at,
                session_id
            ],
        )?;

        if changed == 0 {
            return Ok(None);
        }

        find_by_id_on_connection(transaction, session_id)
    }

    pub fn mark_terminated_without_fetch_in_transaction(
        transaction: &Transaction<'_>,
        session_id: i64,
        status: AgentSessionStatus,
        terminated_at: i64,
    ) -> rusqlite::Result<bool> {
        let changed = transaction.execute(
            "UPDATE agent_sessions
            SET status = ?1,
                is_turn_running = 0,
                turn_ended_at = NULL,
                turn_started_at = NULL,
                last_active_at = MAX(last_active_at + 1, ?2),
                 closed_at = COALESCE(closed_at, ?2)
             WHERE id = ?3 AND closed_at IS NULL AND del = 0",
            params![
                agent_session_status_to_str(&status),
                terminated_at,
                session_id
            ],
        )?;

        Ok(changed > 0)
    }

    pub fn mark_running_in_transaction(
        transaction: &Transaction<'_>,
        session_id: i64,
        resumed_at: i64,
    ) -> rusqlite::Result<Option<AgentSessionRecord>> {
        let changed = transaction.execute(
            "UPDATE agent_sessions
            SET status = 'running',
                attention = 'none',
                 last_active_at = MAX(last_active_at + 1, ?2),
                 closed_at = NULL
             WHERE id = ?1 AND del = 0",
            params![session_id, resumed_at],
        )?;

        if changed == 0 {
            return Ok(None);
        }

        find_by_id_on_connection(transaction, session_id)
    }

    pub fn update_codex_session_id(
        &self,
        session_id: i64,
        codex_session_id: &str,
    ) -> rusqlite::Result<Option<AgentSessionRecord>> {
        let changed = self.connection.execute(
            "UPDATE agent_sessions
             SET codex_session_id = ?1
             WHERE id = ?2 AND codex_session_id IS NULL AND del = 0",
            params![codex_session_id, session_id],
        )?;

        if changed == 0 {
            return self.find_by_id(session_id);
        }

        self.find_by_id(session_id)
    }

    pub fn update_attention(
        &self,
        session_id: i64,
        attention: AgentSessionAttention,
        updated_at: i64,
    ) -> rusqlite::Result<Option<AgentSessionRecord>> {
        let changed = self.connection.execute(
            "UPDATE agent_sessions
             SET attention = ?1,
                 last_active_at = MAX(last_active_at + 1, ?2)
             WHERE id = ?3 AND status = 'running' AND del = 0",
            params![
                agent_session_attention_to_str(&attention),
                updated_at,
                session_id
            ],
        )?;

        if changed == 0 {
            return self.find_by_id(session_id);
        }

        self.find_by_id(session_id)
    }

    pub fn update_title(
        &self,
        session_id: i64,
        title: &str,
        updated_at: i64,
    ) -> rusqlite::Result<Option<AgentSessionRecord>> {
        let changed = self.connection.execute(
            "UPDATE agent_sessions
             SET title = ?1, last_active_at = MAX(last_active_at + 1, ?2)
             WHERE id = ?3 AND del = 0",
            params![title, updated_at, session_id],
        )?;

        if changed == 0 {
            return self.find_by_id(session_id);
        }

        self.find_by_id(session_id)
    }

    pub fn update_log_path_in_transaction(
        transaction: &Transaction<'_>,
        session_id: i64,
        log_path: &str,
    ) -> rusqlite::Result<Option<AgentSessionRecord>> {
        let changed = transaction.execute(
            "UPDATE agent_sessions
             SET log_path = ?1
             WHERE id = ?2 AND del = 0",
            params![log_path, session_id],
        )?;

        if changed == 0 {
            return Ok(None);
        }

        find_by_id_on_connection(transaction, session_id)
    }

    pub fn update_log_path_and_latest_output_in_transaction(
        transaction: &Transaction<'_>,
        session_id: i64,
        log_path: &str,
        latest_output: Option<&str>,
        updated_at: i64,
    ) -> rusqlite::Result<Option<AgentSessionRecord>> {
        let changed = transaction.execute(
            "UPDATE agent_sessions
             SET log_path = ?1,
                 latest_output = ?2,
                 last_active_at = MAX(last_active_at + 1, ?3)
             WHERE id = ?4 AND del = 0",
            params![log_path, latest_output, updated_at, session_id],
        )?;

        if changed == 0 {
            return Ok(None);
        }

        find_by_id_on_connection(transaction, session_id)
    }

    pub fn update_latest_output(
        &self,
        session_id: i64,
        latest_output: &str,
        updated_at: i64,
    ) -> rusqlite::Result<usize> {
        self.connection.execute(
            "UPDATE agent_sessions
             SET latest_output = ?1,
                 last_active_at = MAX(last_active_at + 1, ?2)
             WHERE id = ?3 AND status = 'running' AND del = 0",
            params![latest_output, updated_at, session_id],
        )
    }

    pub fn update_turn_running(
        &self,
        session_id: i64,
        is_turn_running: bool,
        updated_at: i64,
    ) -> rusqlite::Result<usize> {
        self.connection.execute(
            "UPDATE agent_sessions
             SET is_turn_running = ?1,
                 last_active_at = MAX(last_active_at + 1, ?2)
             WHERE id = ?3 AND status = 'running' AND del = 0",
            params![if is_turn_running { 1 } else { 0 }, updated_at, session_id],
        )
    }

    /// 收到「有产出」的 timeline 事件（reasoning / assistant_message / tool_call）
    /// 时，若 turn 已被 spurious `turn_completed` 落到 idle 或仍在 grace 窗口内，
    /// 恢复运行态。WHERE 守卫 `is_turn_running = 0 OR turn_ended_at IS NOT NULL`
    /// 保证正常活动 turn 内（is_turn_running=1 且 turn_ended_at=NULL）为 0 行 no-op，
    /// 不给每条 reasoning 加写。返回是否实际翻转（据此决定是否广播 list 刷新）。
    pub fn ensure_turn_running(&self, session_id: i64, now: i64) -> rusqlite::Result<bool> {
        let changed = self.connection.execute(
            "UPDATE agent_sessions
             SET is_turn_running = 1,
                 turn_ended_at = NULL,
                 last_active_at = MAX(last_active_at + 1, ?2)
             WHERE id = ?1
               AND status = 'running'
               AND del = 0
               AND (is_turn_running = 0 OR turn_ended_at IS NOT NULL)",
            params![session_id, now],
        )?;
        Ok(changed > 0)
    }

    pub fn update_turn_ended_at(&self, session_id: i64, now: i64) -> rusqlite::Result<usize> {
        self.connection.execute(
            "UPDATE agent_sessions
             SET turn_ended_at = ?1,
                 last_active_at = MAX(last_active_at + 1, ?2)
             WHERE id = ?3 AND status = 'running' AND del = 0",
            params![now, now, session_id],
        )
    }

    pub fn clear_turn_ended_at(&self, session_id: i64) -> rusqlite::Result<usize> {
        self.connection.execute(
            "UPDATE agent_sessions
             SET turn_ended_at = NULL
             WHERE id = ?1",
            params![session_id],
        )
    }

    /// turn 开始：记录 turn_started_at，供 turn 正常结束时累加处理时长。
    pub fn update_turn_started_at(&self, session_id: i64, now: i64) -> rusqlite::Result<usize> {
        self.connection.execute(
            "UPDATE agent_sessions
             SET turn_started_at = ?1,
                 last_active_at = MAX(last_active_at + 1, ?2)
             WHERE id = ?3 AND status = 'running' AND del = 0",
            params![now, now, session_id],
        )
    }

    /// 写入当前 turn 的来源（initial / follow_up / completion），同时清空
    /// `current_turn_id`：新 turn 上下文开始，旧 turn_id 失效，待 `TurnStarted`
    /// 回流时由 `update_current_turn_id` 重新写入。写 source 必须与清 turn_id
    /// 在同一 UPDATE 内原子完成，避免提取任务读到新 source 配旧 turn_id 的中间态。
    pub fn update_current_turn_source(&self, session_id: i64, source: &str) -> rusqlite::Result<usize> {
        self.connection.execute(
            "UPDATE agent_sessions
             SET current_turn_source = ?1,
                 current_turn_id = NULL
             WHERE id = ?2 AND status = 'running' AND del = 0",
            params![source, session_id],
        )
    }

    /// 写入当前 turn 的标识（来自 `TurnStarted` 事件的 turn_id）。仅当 session 仍
    /// 在运行时写入；被新 turn 抢占（source 已被覆盖并清空 turn_id）时本次写入
    /// 会被新一轮 `update_current_turn_source` 覆盖。
    pub fn update_current_turn_id(&self, session_id: i64, turn_id: &str) -> rusqlite::Result<usize> {
        self.connection.execute(
            "UPDATE agent_sessions
             SET current_turn_id = ?1
             WHERE id = ?2 AND status = 'running' AND del = 0",
            params![turn_id, session_id],
        )
    }

    /// turn 正常完成：写结束时间与最后输出时间，并按 turn_started_at 原子累加
    /// processing_ms。漏记 turn_started_at 时本次不计（COALESCE 兜底为 0 增量），
    /// 避免负值或异常值污染累计处理时长。
    pub fn record_turn_completed(&self, session_id: i64, now: i64) -> rusqlite::Result<usize> {
        self.connection.execute(
            "UPDATE agent_sessions
             SET turn_ended_at = ?1,
                 last_output_at = ?1,
                 processing_ms = processing_ms + MAX(0, ?1 - COALESCE(turn_started_at, ?1)),
                 last_active_at = MAX(last_active_at + 1, ?1)
             WHERE id = ?2 AND status = 'running' AND del = 0",
            params![now, session_id],
        )
    }

    /// grace 收尾：仅在 turn 仍是预期结束态时，原子置 `is_turn_running=0`
    /// 并清 `turn_ended_at`，使终态与 `EndedImmediately` 一致。CAS 守卫
    /// `turn_ended_at = expected` 保证被新 turn 抢占、sub-turn 刷新、取消、
    /// 删除或停止时不误改。返回是否实际收尾（据此决定是否广播 list 刷新）。
    pub fn finalize_turn_after_grace(
        &self,
        session_id: i64,
        expected_turn_ended_at: i64,
    ) -> rusqlite::Result<bool> {
        let changed = self.connection.execute(
            "UPDATE agent_sessions
             SET is_turn_running = 0, turn_ended_at = NULL
             WHERE id = ?1 AND status = 'running' AND del = 0
               AND is_turn_running = 1 AND turn_ended_at = ?2",
            params![session_id, expected_turn_ended_at],
        )?;
        Ok(changed > 0)
    }

    pub fn soft_delete_in_transaction(
        transaction: &Transaction<'_>,
        session_id: i64,
        deleted_at: i64,
    ) -> rusqlite::Result<bool> {
        let changed = transaction.execute(
            "UPDATE agent_sessions
             SET del = 1,
                 last_active_at = MAX(last_active_at + 1, ?1)
             WHERE id = ?2 AND del = 0",
            params![deleted_at, session_id],
        )?;

        Ok(changed > 0)
    }
}

fn find_by_id_on_connection(
    connection: &Connection,
    id: i64,
) -> rusqlite::Result<Option<AgentSessionRecord>> {
    connection
        .query_row(
            "SELECT id, project_id, issue_id, title, agent_profile_id, workflow_skill_name, codex_session_id, status, attention, working_dir, command_snapshot, prompt_snapshot, workspace_mode, target_branch, workspace_branch, workspace_path, origin_branch, worktree_owner, worktree_root_path, worktree_setup_command, log_path, latest_output, last_active_at, started_at, closed_at, number, display_mode
             FROM agent_sessions
             WHERE id = ?1 AND del = 0",
            params![id],
            agent_session_from_row,
        )
        .optional()
}

fn agent_session_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentSessionRecord> {
    Ok(AgentSessionRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        issue_id: row.get(2)?,
        title: row.get(3)?,
        agent_profile_id: row.get(4)?,
        workflow_skill_name: row.get(5)?,
        codex_session_id: row.get(6)?,
        status: agent_session_status_from_str(&row.get::<_, String>(7)?)?,
        attention: agent_session_attention_from_str(&row.get::<_, String>(8)?)?,
        working_dir: row.get(9)?,
        command_snapshot: row.get(10)?,
        prompt_snapshot: row.get(11)?,
        display_mode: row.get(26)?,
        workspace_mode: workspace_mode_from_str(&row.get::<_, String>(12)?)?,
        target_branch: row.get(13)?,
        workspace_branch: row.get(14)?,
        workspace_path: row.get(15)?,
        origin_branch: row.get(16)?,
        worktree_owner: worktree_owner_from_str(&row.get::<_, String>(17)?)?,
        worktree_root_path: row.get(18)?,
        worktree_setup_command: row.get(19)?,
        log_path: row.get(20)?,
        latest_output: row.get(21)?,
        last_active_at: row.get(22)?,
        started_at: row.get(23)?,
        closed_at: row.get(24)?,
        number: row.get(25)?,
    })
}

fn agent_session_list_row_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AgentSessionListRow> {
    Ok(AgentSessionListRow {
        session_id: row.get(0)?,
        number: row.get(1)?,
        project_id: row.get(2)?,
        issue_id: row.get(3)?,
        issue_number: row.get(4)?,
        issue_title: row.get(5)?,
        issue_status: row
            .get::<_, Option<String>>(6)?
            .map(|value| issue_status_from_str(&value))
            .transpose()?,
        agent_profile_id: row.get(7)?,
        agent_profile_name: row.get(8)?,
        title: row.get(9)?,
        agent_type: agent_type_from_str(&row.get::<_, String>(10)?)?,
        display_mode: row.get(31)?,
        status: agent_session_status_from_str(&row.get::<_, String>(11)?)?,
        attention: agent_session_attention_from_str(&row.get::<_, String>(12)?)?,
        is_turn_running: row.get::<_, i64>(13)? != 0,
        workspace_mode: workspace_mode_from_str(&row.get::<_, String>(14)?)?,
        working_dir: row.get(15)?,
        workspace_path: row.get(16)?,
        origin_branch: row.get(17)?,
        workspace_branch: row.get(18)?,
        worktree_owner: worktree_owner_from_str(&row.get::<_, String>(19)?)?,
        log_path: row.get(20)?,
        latest_output: row.get(21)?,
        workflow_skill_name: row.get(22)?,
        list_inserted_at: row.get(23)?,
        last_active_at: row.get(24)?,
        started_at: row.get(25)?,
        closed_at: row.get(26)?,
        turn_ended_at: row.get::<_, Option<i64>>(27)?,
        turn_started_at: row.get::<_, Option<i64>>(28)?,
        processing_ms: row.get(29)?,
        last_output_at: row.get::<_, Option<i64>>(30)?,
    })
}

fn agent_type_from_str(value: &str) -> rusqlite::Result<AgentType> {
    match value {
        "codex" => Ok(AgentType::Codex),
        "claude" => Ok(AgentType::Claude),
        "opencode" => Ok(AgentType::OpenCode),
        "grok" => Ok(AgentType::Grok),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
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

fn issue_status_from_str(value: &str) -> rusqlite::Result<IssueStatus> {
    match value {
        "backlog" => Ok(IssueStatus::Backlog),
        "running" => Ok(IssueStatus::Running),
        "review" => Ok(IssueStatus::Review),
        "completed" => Ok(IssueStatus::Completed),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn agent_session_status_to_str(value: &AgentSessionStatus) -> &'static str {
    match value {
        AgentSessionStatus::Running => "running",
        AgentSessionStatus::Closed => "closed",
        AgentSessionStatus::Crashed => "crashed",
        AgentSessionStatus::Stopped => "stopped",
    }
}

fn agent_session_attention_from_str(value: &str) -> rusqlite::Result<AgentSessionAttention> {
    match value {
        "none" => Ok(AgentSessionAttention::None),
        "requested" => Ok(AgentSessionAttention::Requested),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn agent_session_attention_to_str(value: &AgentSessionAttention) -> &'static str {
    match value {
        AgentSessionAttention::None => "none",
        AgentSessionAttention::Requested => "requested",
    }
}

fn workspace_mode_from_str(value: &str) -> rusqlite::Result<WorkspaceMode> {
    match value {
        "current_branch" => Ok(WorkspaceMode::CurrentBranch),
        "worktree" => Ok(WorkspaceMode::Worktree),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn worktree_owner_from_str(value: &str) -> rusqlite::Result<WorktreeOwner> {
    match value {
        "redwhisk" => Ok(WorktreeOwner::Redwhisk),
        "external" => Ok(WorktreeOwner::External),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn inferred_worktree_owner(workspace_mode: &WorkspaceMode) -> WorktreeOwner {
    match workspace_mode {
        WorkspaceMode::CurrentBranch => WorktreeOwner::External,
        WorkspaceMode::Worktree => WorktreeOwner::Redwhisk,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{
        AGENT_SESSIONS_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_SQL,
        AGENT_SESSIONS_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_VERSION, MigrationRunner,
    };
    use crate::db::issue_repository::IssueRepository;

    // 全量 migration（含 0038），用于校验 repository 编号分配与 schema 产物。
    fn connection_with_all_migrations() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        MigrationRunner::default()
            .run(&connection)
            .expect("run all migrations");
        connection
    }

    // 跑到 0037（跳过 0038），用于验证 0038 的回填增量语义：number 列已存在且历史行已由
    // 0036 回填为正编号；再插入过渡期 number=0 行，单独执行 0038 SQL，断言回填与唯一索引。
    fn connection_before_sessions_unique_index() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        MigrationRunner::runner_skipping(&[AGENT_SESSIONS_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_VERSION])
            .run(&connection)
            .expect("run migrations up to 0037");
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

    fn session_number(connection: &Connection, session_id: i64) -> i64 {
        connection
            .query_row(
                "SELECT number FROM agent_sessions WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .expect("read session number")
    }

    fn run_sessions_unique_migration(connection: &Connection) {
        connection
            .execute_batch(AGENT_SESSIONS_PROJECT_SCOPED_NUMBER_UNIQUE_MIGRATION_SQL)
            .expect("run 0038 migration sql");
    }

    // 插入一条显式指定 number 的 session，用于构造 0036 已回填的历史行（number > 0）。
    fn insert_session_with_number(
        connection: &Connection,
        id: i64,
        project_id: i64,
        number: i64,
        started_at: i64,
    ) {
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, number, agent_profile_id, status, attention,
                   working_dir, command_snapshot, prompt_snapshot, log_path,
                   last_active_at, started_at, del
                 ) VALUES (
                   ?1, ?2, ?3, 100, 'closed', 'none',
                   '/tmp/repo', 'codex', '', '/tmp/s.log',
                   ?4, ?4, 0
                 )",
                params![id, project_id, number, started_at],
            )
            .expect("insert session with number");
    }

    // 插入一条过渡期 number=0 的 session（模拟 0036 之后、0038 之前走旧路径的新建行）。
    fn insert_session_unassigned(
        connection: &Connection,
        id: i64,
        project_id: i64,
        started_at: i64,
    ) {
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
            .expect("insert unassigned session");
    }

    fn soft_delete_session(connection: &Connection, session_id: i64) {
        connection
            .execute(
                "UPDATE agent_sessions SET del = 1 WHERE id = ?1 AND del = 0",
                params![session_id],
            )
            .expect("soft delete session");
    }

    // 插入一条 worktree 模式 session（带 workspace_path + target_branch），用于
    // find_latest_by_workspace_path 的命中 / 多条取最新 / 软删过滤 / 跨 project 隔离测试。
    fn insert_worktree_session(
        connection: &Connection,
        id: i64,
        project_id: i64,
        number: i64,
        workspace_path: &str,
        target_branch: &str,
        started_at: i64,
        del: i64,
    ) {
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, number, agent_profile_id, status, attention,
                   working_dir, command_snapshot, prompt_snapshot, log_path,
                   last_active_at, started_at, workspace_path, target_branch, del
                 ) VALUES (
                   ?1, ?2, ?3, 100, 'closed', 'none',
                   '/tmp/repo', 'codex', '', '/tmp/s.log',
                   ?4, ?4, ?5, ?6, ?7
                 )",
                params![id, project_id, number, started_at, workspace_path, target_branch, del],
            )
            .expect("insert worktree session");
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
    fn insert_in_transaction_assigns_project_scoped_number() {
        let mut connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        insert_agent_profile(&connection, 100);
        // 两个不同 issue，避免 0026 的 active-issue 唯一索引冲突。
        let issue_a = IssueRepository::new(&connection)
            .insert(1, "issue-a", "", "[]")
            .expect("insert issue a");
        let issue_b = IssueRepository::new(&connection)
            .insert(1, "issue-b", "", "[]")
            .expect("insert issue b");

        let s1 = connection
            .transaction()
            .and_then(|transaction| {
                let session = AgentSessionRepository::insert_in_transaction(
                    &transaction,
                    1,
                    issue_a.id,
                    100,
                    None,
                    "/tmp/repo",
                    "codex",
                    "",
                    &WorkspaceMode::CurrentBranch,
                    None,
                    None,
                    None,
                    None,
                    WorktreeOwner::External,
                    None,
                    None,
                    "/tmp/s1.log",
                    "json",
                                        1_000,
            )?;
                transaction.commit()?;
                Ok(session)
            })
            .expect("insert first session");

        let s2 = connection
            .transaction()
            .and_then(|transaction| {
                let session = AgentSessionRepository::insert_in_transaction(
                    &transaction,
                    1,
                    issue_b.id,
                    100,
                    None,
                    "/tmp/repo",
                    "codex",
                    "",
                    &WorkspaceMode::CurrentBranch,
                    None,
                    None,
                    None,
                    None,
                    WorktreeOwner::External,
                    None,
                    None,
                    "/tmp/s2.log",
                    "json",
                                        2_000,
            )?;
                transaction.commit()?;
                Ok(session)
            })
            .expect("insert second session");

        assert_eq!(s1.number, 1);
        assert_eq!(s2.number, 2);
        assert_eq!(session_number(&connection, s1.id), 1);
        assert_eq!(session_number(&connection, s2.id), 2);
    }

    #[test]
    fn insert_standalone_in_transaction_assigns_project_scoped_number() {
        let mut connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        insert_agent_profile(&connection, 100);

        let s1 = connection
            .transaction()
            .and_then(|transaction| {
                let session = AgentSessionRepository::insert_standalone_in_transaction(
                    &transaction,
                    1,
                    "standalone-1",
                    100,
                    "/tmp/repo",
                    "codex",
                    "",
                    &WorkspaceMode::CurrentBranch,
                    None,
                    None,
                    None,
                    None,
                    None,
                    "/tmp/sa1.log",
                    "json",
                                        1_000,
            )?;
                transaction.commit()?;
                Ok(session)
            })
            .expect("insert first standalone session");

        let s2 = connection
            .transaction()
            .and_then(|transaction| {
                let session = AgentSessionRepository::insert_standalone_in_transaction(
                    &transaction,
                    1,
                    "standalone-2",
                    100,
                    "/tmp/repo",
                    "codex",
                    "",
                    &WorkspaceMode::CurrentBranch,
                    None,
                    None,
                    None,
                    None,
                    None,
                    "/tmp/sa2.log",
                    "json",
                                        2_000,
            )?;
                transaction.commit()?;
                Ok(session)
            })
            .expect("insert second standalone session");

        assert_eq!(s1.number, 1);
        assert_eq!(s2.number, 2);
    }

    #[test]
    fn insert_isolates_numbering_per_project() {
        let mut connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        insert_project(&connection, 2, "p2");
        insert_agent_profile(&connection, 100);

        let tx = |connection: &mut Connection, project_id: i64, log: &str| {
            connection
                .transaction()
                .and_then(|transaction| {
                    let session = AgentSessionRepository::insert_standalone_in_transaction(
                        &transaction,
                        project_id,
                        "title",
                        100,
                        "/tmp/repo",
                        "codex",
                        "",
                        &WorkspaceMode::CurrentBranch,
                        None,
                        None,
                        None,
                        None,
                        None,
                        log,
                        "json",
                                                1_000,
            )?;
                    transaction.commit()?;
                    Ok(session)
                })
                .expect("insert session")
        };

        let p1_first = tx(&mut connection, 1, "/tmp/p1-1.log");
        let p2_first = tx(&mut connection, 2, "/tmp/p2-1.log");
        let p1_second = tx(&mut connection, 1, "/tmp/p1-2.log");

        assert_eq!(p1_first.number, 1);
        assert_eq!(p2_first.number, 1);
        assert_eq!(p1_second.number, 2);
    }

    #[test]
    fn insert_does_not_reuse_number_after_soft_delete() {
        // 分配 SQL 不过滤 del：软删除行保留 number 且计入 MAX，新建不复用已删除编号。
        let mut connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        insert_agent_profile(&connection, 100);

        let s1 = connection
            .transaction()
            .and_then(|transaction| {
                let session = AgentSessionRepository::insert_standalone_in_transaction(
                    &transaction,
                    1,
                    "first",
                    100,
                    "/tmp/repo",
                    "codex",
                    "",
                    &WorkspaceMode::CurrentBranch,
                    None,
                    None,
                    None,
                    None,
                    None,
                    "/tmp/s1.log",
                    "json",
                                        1_000,
            )?;
                transaction.commit()?;
                Ok(session)
            })
            .expect("insert first");

        let s2 = connection
            .transaction()
            .and_then(|transaction| {
                let session = AgentSessionRepository::insert_standalone_in_transaction(
                    &transaction,
                    1,
                    "second",
                    100,
                    "/tmp/repo",
                    "codex",
                    "",
                    &WorkspaceMode::CurrentBranch,
                    None,
                    None,
                    None,
                    None,
                    None,
                    "/tmp/s2.log",
                    "json",
                                        2_000,
            )?;
                transaction.commit()?;
                Ok(session)
            })
            .expect("insert second");

        soft_delete_session(&connection, s2.id);

        let s3 = connection
            .transaction()
            .and_then(|transaction| {
                let session = AgentSessionRepository::insert_standalone_in_transaction(
                    &transaction,
                    1,
                    "third",
                    100,
                    "/tmp/repo",
                    "codex",
                    "",
                    &WorkspaceMode::CurrentBranch,
                    None,
                    None,
                    None,
                    None,
                    None,
                    "/tmp/s3.log",
                    "json",
                                        3_000,
            )?;
                transaction.commit()?;
                Ok(session)
            })
            .expect("insert after delete");

        assert_eq!(s1.number, 1);
        assert_eq!(s2.number, 2);
        assert_eq!(s3.number, 3);
        assert_eq!(session_number(&connection, s2.id), 2);
    }

    #[test]
    fn list_by_project_id_carries_session_number_and_issue_number() {
        let mut connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        insert_agent_profile(&connection, 100);

        // 通过 IssueRepository 创建 issue，使其获得 number=1。
        let issue = IssueRepository::new(&connection)
            .insert(1, "linked-issue", "", "[]")
            .expect("insert issue");
        assert_eq!(issue.number, 1);

        // 创建关联该 issue 的 session。
        let session = connection
            .transaction()
            .and_then(|transaction| {
                let session = AgentSessionRepository::insert_in_transaction(
                    &transaction,
                    1,
                    issue.id,
                    100,
                    None,
                    "/tmp/repo",
                    "codex",
                    "",
                    &WorkspaceMode::CurrentBranch,
                    None,
                    None,
                    None,
                    None,
                    WorktreeOwner::External,
                    None,
                    None,
                    "/tmp/s.log",
                    "json",
                                        1_000,
            )?;
                transaction.commit()?;
                Ok(session)
            })
            .expect("insert linked session");
        assert_eq!(session.number, 1);

        let repo = AgentSessionRepository::new(&connection);
        let rows = repo.list_by_project_id(1).expect("list sessions");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].session_id, session.id);
        assert_eq!(rows[0].number, 1);
        assert_eq!(rows[0].issue_number, Some(1));
    }

    #[test]
    fn find_latest_by_workspace_path_returns_latest_active_session_for_worktree() {
        // code 变更页无 sessionId，按 workspace_path 反查 session 的 target_branch 作
        // 分叉基。同一 worktree 可能被多次 session 复用，取 started_at 最新（次按 id）。
        // 软删行过滤、不同 project 不串、无匹配返回 None。
        let connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        insert_project(&connection, 2, "p2");
        insert_agent_profile(&connection, 100);
        let worktree = "/tmp/repo/worktrees/issue-1";
        insert_worktree_session(&connection, 10, 1, 1, worktree, "main", 1_000, 0);
        insert_worktree_session(&connection, 11, 1, 2, worktree, "main", 3_000, 0);
        insert_worktree_session(&connection, 12, 1, 3, worktree, "main", 2_000, 0);

        let latest = AgentSessionRepository::new(&connection)
            .find_latest_by_workspace_path(1, worktree)
            .expect("query latest by workspace path")
            .expect("expected a matching session");
        assert_eq!(latest.id, 11);
        assert_eq!(latest.target_branch.as_deref(), Some("main"));
        assert_eq!(latest.workspace_path.as_deref(), Some(worktree));

        // 不同 project 不串。
        assert!(
            AgentSessionRepository::new(&connection)
                .find_latest_by_workspace_path(2, worktree)
                .expect("query cross project")
                .is_none(),
            "workspace_path 不应跨 project 命中"
        );

        // 软删的最新行被过滤，回落到下一条存活行。
        insert_worktree_session(&connection, 13, 1, 4, worktree, "develop", 9_000, 1);
        let after_soft_delete = AgentSessionRepository::new(&connection)
            .find_latest_by_workspace_path(1, worktree)
            .expect("query after soft delete")
            .expect("软删行过滤后仍应命中存活行");
        assert_eq!(after_soft_delete.id, 11);

        // 无匹配返回 None。
        assert!(
            AgentSessionRepository::new(&connection)
                .find_latest_by_workspace_path(1, "/tmp/repo/worktrees/issue-999")
                .expect("query missing")
                .is_none()
        );
    }

    #[test]
    fn migration_0038_backfills_zero_numbered_rows_without_changing_existing() {
        let connection = connection_before_sessions_unique_index();
        insert_project(&connection, 1, "p1");
        // 历史行：0036 已回填为正编号 1..3。
        insert_session_with_number(&connection, 10, 1, 1, 1_000);
        insert_session_with_number(&connection, 20, 1, 2, 2_000);
        insert_session_with_number(&connection, 30, 1, 3, 3_000);
        // 过渡期 number=0 行（0036 之后、0038 之前新建，走旧路径默认 0）。
        insert_session_unassigned(&connection, 40, 1, 4_000);
        insert_session_unassigned(&connection, 50, 1, 5_000);

        run_sessions_unique_migration(&connection);

        // 已分配(>0)的 number 不变。
        assert_eq!(session_number(&connection, 10), 1);
        assert_eq!(session_number(&connection, 20), 2);
        assert_eq!(session_number(&connection, 30), 3);
        // 过渡期行按 (started_at, id) 接续到 4、5。
        assert_eq!(session_number(&connection, 40), 4);
        assert_eq!(session_number(&connection, 50), 5);

        // 项目内无重复 number。
        let duplicate_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM (
                   SELECT project_id, number, COUNT(*) AS c
                   FROM agent_sessions WHERE project_id = 1
                   GROUP BY project_id, number HAVING c > 1
                 )",
                [],
                |row| row.get(0),
            )
            .expect("duplicate count");
        assert_eq!(duplicate_count, 0);

        assert!(unique_index_exists(
            &connection,
            "agent_sessions",
            "uidx_agent_sessions_project_id_number"
        ));
    }

    #[test]
    fn migration_0038_tiebreaks_zero_rows_by_started_at_then_id() {
        // 同 started_at 的过渡期行按 id 升序接续；验证回填与扫描顺序无关。
        let connection = connection_before_sessions_unique_index();
        insert_project(&connection, 1, "p1");
        insert_session_with_number(&connection, 10, 1, 1, 1_000);
        let t_earlier = 20;
        let t_later = 30;
        insert_session_unassigned(&connection, t_earlier, 1, 5_000);
        insert_session_unassigned(&connection, t_later, 1, 5_000);

        run_sessions_unique_migration(&connection);

        assert_eq!(session_number(&connection, t_earlier), 2);
        assert_eq!(session_number(&connection, t_later), 3);
    }

    #[test]
    fn migration_0038_isolates_backfill_per_project() {
        let connection = connection_before_sessions_unique_index();
        insert_project(&connection, 1, "p1");
        insert_project(&connection, 2, "p2");
        insert_session_with_number(&connection, 10, 1, 1, 1_000);
        insert_session_with_number(&connection, 20, 2, 1, 1_000);
        let p1_trans = 30;
        let p2_trans = 40;
        insert_session_unassigned(&connection, p1_trans, 1, 2_000);
        insert_session_unassigned(&connection, p2_trans, 2, 2_000);

        run_sessions_unique_migration(&connection);

        assert_eq!(session_number(&connection, p1_trans), 2);
        assert_eq!(session_number(&connection, p2_trans), 2);
    }

    #[test]
    fn migration_0038_is_noop_when_no_zero_numbered_rows() {
        let connection = connection_before_sessions_unique_index();
        insert_project(&connection, 1, "p1");
        insert_session_with_number(&connection, 10, 1, 1, 1_000);

        run_sessions_unique_migration(&connection);

        assert_eq!(session_number(&connection, 10), 1);
        assert!(unique_index_exists(
            &connection,
            "agent_sessions",
            "uidx_agent_sessions_project_id_number"
        ));
    }

    // 插入一条 status='running' 的 session，带最小必需列；is_turn_running /
    // turn_ended_at 用默认值，由调用方 UPDATE 成所需初始态。
    fn insert_running_session_for_turn_state(connection: &Connection, id: i64, number: i64) {
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, number, agent_profile_id, status, attention,
                   working_dir, command_snapshot, prompt_snapshot, log_path,
                   last_active_at, started_at, del
                 ) VALUES (
                   ?1, 1, ?2, 100, 'running', 'none',
                   '/tmp/repo', 'codex', '', '/tmp/s.log',
                   10, 10, 0
                 )",
                params![id, number],
            )
            .expect("insert running session");
    }

    fn read_turn_state(connection: &Connection, id: i64) -> (i64, Option<i64>) {
        connection
            .query_row(
                "SELECT is_turn_running, turn_ended_at FROM agent_sessions WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read turn state")
    }

    #[test]
    fn ensure_turn_running_restores_idle_and_clears_grace() {
        let connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        insert_agent_profile(&connection, 100);
        insert_running_session_for_turn_state(&connection, 701, 1);
        insert_running_session_for_turn_state(&connection, 702, 2);
        insert_running_session_for_turn_state(&connection, 703, 3);
        // 701: grace 已收尾的 idle（is_turn_running=0, turn_ended_at=NULL）
        connection
            .execute(
                "UPDATE agent_sessions SET is_turn_running = 0, turn_ended_at = NULL WHERE id = 701",
                [],
            )
            .expect("set 701 idle");
        // 702: grace pending（is_turn_running=1, turn_ended_at 已写）
        connection
            .execute(
                "UPDATE agent_sessions SET is_turn_running = 1, turn_ended_at = 5000 WHERE id = 702",
                [],
            )
            .expect("set 702 grace");
        // 703: 正常活动 turn（is_turn_running=1, turn_ended_at=NULL）
        connection
            .execute(
                "UPDATE agent_sessions SET is_turn_running = 1, turn_ended_at = NULL WHERE id = 703",
                [],
            )
            .expect("set 703 active");

        let repository = AgentSessionRepository::new(&connection);

        // idle → 恢复 running 并清 turn_ended_at，返回 true。
        assert!(repository
            .ensure_turn_running(701, 6_000)
            .expect("ensure 701"));
        let (running, ended) = read_turn_state(&connection, 701);
        assert_eq!(running, 1);
        assert_eq!(ended, None);

        // grace pending → 清 turn_ended_at 并保持 running，返回 true。
        assert!(repository
            .ensure_turn_running(702, 6_000)
            .expect("ensure 702"));
        let (running, ended) = read_turn_state(&connection, 702);
        assert_eq!(running, 1);
        assert_eq!(ended, None);

        // 正常活动 turn → no-op，返回 false（不给每条 reasoning 加写）。
        assert!(!repository
            .ensure_turn_running(703, 6_000)
            .expect("ensure 703"));
    }

    #[test]
    fn list_by_project_id_accepts_opencode_and_grok_agent_types() {
        let connection = connection_with_all_migrations();
        insert_project(&connection, 1, "p1");
        connection
            .execute(
                "INSERT INTO agent_profiles (
                   id, name, agent_type, command, scope, project_id, mode, dangerous,
                   default_skill, prompt_template, del, display_mode, enabled
                 ) VALUES
                   (101, 'OpenCode', 'opencode', 'opencode', 'global', NULL, 'full-access', 1, '', '', 0, 'tui', 1),
                   (102, 'Grok', 'grok', 'grok', 'global', NULL, 'full-access', 1, '', '', 0, 'tui', 1)",
                [],
            )
            .expect("insert opencode/grok profiles");
        for (id, number, profile_id) in [(801, 1, 101), (802, 2, 102)] {
            connection
                .execute(
                    "INSERT INTO agent_sessions (
                       id, project_id, number, agent_profile_id, status, attention,
                       working_dir, command_snapshot, prompt_snapshot, log_path,
                       last_active_at, started_at, del, display_mode
                     ) VALUES (
                       ?1, 1, ?2, ?3, 'running', 'none',
                       '/tmp/repo', 'cmd', '', '/tmp/s.log',
                       10, 10, 0, 'tui'
                     )",
                    params![id, number, profile_id],
                )
                .expect("insert session");
        }

        let rows = AgentSessionRepository::new(&connection)
            .list_by_project_id(1)
            .expect("list sessions with opencode/grok");
        let types: Vec<_> = rows.iter().map(|row| row.agent_type.clone()).collect();
        assert!(types.contains(&AgentType::OpenCode), "opencode missing: {types:?}");
        assert!(types.contains(&AgentType::Grok), "grok missing: {types:?}");
    }
}
