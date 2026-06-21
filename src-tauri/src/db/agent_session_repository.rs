use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::types::agent_profile::AgentType;
use crate::types::agent_session::{
    AgentSessionAttention, AgentSessionRecord, AgentSessionStatus, WorkspaceMode,
};
use crate::types::issue::IssueStatus;
use crate::types::project::ProjectCompletionPolicy;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSessionListRow {
    pub session_id: i64,
    pub issue_id: Option<i64>,
    pub issue_title: Option<String>,
    pub issue_status: Option<IssueStatus>,
    pub agent_profile_id: i64,
    pub title: Option<String>,
    pub agent_type: AgentType,
    pub status: AgentSessionStatus,
    pub attention: AgentSessionAttention,
    pub workspace_mode: WorkspaceMode,
    pub log_path: String,
    pub latest_output: Option<String>,
    pub list_inserted_at: i64,
    pub last_active_at: i64,
    pub started_at: i64,
    pub closed_at: Option<i64>,
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
                "SELECT id, project_id, issue_id, title, agent_profile_id, codex_session_id, status, attention, working_dir, command_snapshot, prompt_snapshot, workspace_mode, target_branch, workspace_branch, workspace_path, completion_policy, worktree_root_path, worktree_setup_command, log_path, latest_output, last_active_at, started_at, closed_at
                 FROM agent_sessions
                 WHERE id = ?1 AND del = 0",
                params![id],
                agent_session_from_row,
            )
            .optional()
    }

    pub fn find_by_issue_id(&self, issue_id: i64) -> rusqlite::Result<Option<AgentSessionRecord>> {
        self.connection
            .query_row(
                "SELECT id, project_id, issue_id, title, agent_profile_id, codex_session_id, status, attention, working_dir, command_snapshot, prompt_snapshot, workspace_mode, target_branch, workspace_branch, workspace_path, completion_policy, worktree_root_path, worktree_setup_command, log_path, latest_output, last_active_at, started_at, closed_at
                 FROM agent_sessions
                 WHERE issue_id = ?1 AND del = 0",
                params![issue_id],
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
                agent_sessions.issue_id,
                issues.title,
                issues.status,
                agent_sessions.agent_profile_id,
                agent_sessions.title,
                agent_profiles.agent_type,
                agent_sessions.status,
                agent_sessions.attention,
                agent_sessions.workspace_mode,
                agent_sessions.log_path,
                agent_sessions.latest_output,
                COALESCE(agent_sessions.list_inserted_at, agent_sessions.started_at),
                agent_sessions.last_active_at,
                agent_sessions.started_at,
                agent_sessions.closed_at
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

    pub fn list_running_by_project_id(
        &self,
        project_id: i64,
    ) -> rusqlite::Result<Vec<AgentSessionRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, issue_id, title, agent_profile_id, codex_session_id, status, attention, working_dir, command_snapshot, prompt_snapshot, workspace_mode, target_branch, workspace_branch, workspace_path, completion_policy, worktree_root_path, worktree_setup_command, log_path, latest_output, last_active_at, started_at, closed_at
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
        working_dir: &str,
        command_snapshot: &str,
        prompt_snapshot: &str,
        workspace_mode: &WorkspaceMode,
        target_branch: Option<&str>,
        workspace_branch: Option<&str>,
        workspace_path: Option<&str>,
        completion_policy: Option<ProjectCompletionPolicy>,
        worktree_root_path: Option<&str>,
        worktree_setup_command: Option<&str>,
        log_path: &str,
        started_at: i64,
    ) -> rusqlite::Result<AgentSessionRecord> {
        transaction.execute(
            "INSERT INTO agent_sessions (
               project_id,
               issue_id,
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
               completion_policy,
               worktree_root_path,
               worktree_setup_command,
               log_path,
               list_inserted_at,
               last_active_at,
               started_at
             ) VALUES (?1, ?2, ?3, 'running', 'none', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16)",
            params![
                project_id,
                issue_id,
                agent_profile_id,
                working_dir,
                command_snapshot,
                prompt_snapshot,
                workspace_mode_to_str(workspace_mode),
                target_branch,
                workspace_branch,
                workspace_path,
                completion_policy.map(|value| project_completion_policy_to_str(&value)),
                worktree_root_path,
                worktree_setup_command,
                log_path,
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
        completion_policy: Option<ProjectCompletionPolicy>,
        worktree_root_path: Option<&str>,
        worktree_setup_command: Option<&str>,
        log_path: &str,
        started_at: i64,
    ) -> rusqlite::Result<AgentSessionRecord> {
        transaction.execute(
            "INSERT INTO agent_sessions (
               project_id,
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
              completion_policy,
              worktree_root_path,
              worktree_setup_command,
              log_path,
               list_inserted_at,
               last_active_at,
               started_at
             ) VALUES (?1, NULL, ?2, ?3, 'running', 'none', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16)",
            params![
                project_id,
                title,
                agent_profile_id,
                working_dir,
                command_snapshot,
                prompt_snapshot,
                workspace_mode_to_str(workspace_mode),
                target_branch,
                workspace_branch,
                workspace_path,
                completion_policy.map(|value| project_completion_policy_to_str(&value)),
                worktree_root_path,
                worktree_setup_command,
                log_path,
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
            "SELECT id, project_id, issue_id, title, agent_profile_id, codex_session_id, status, attention, working_dir, command_snapshot, prompt_snapshot, workspace_mode, target_branch, workspace_branch, workspace_path, completion_policy, worktree_root_path, worktree_setup_command, log_path, latest_output, last_active_at, started_at, closed_at
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
        codex_session_id: row.get(5)?,
        status: agent_session_status_from_str(&row.get::<_, String>(6)?)?,
        attention: agent_session_attention_from_str(&row.get::<_, String>(7)?)?,
        working_dir: row.get(8)?,
        command_snapshot: row.get(9)?,
        prompt_snapshot: row.get(10)?,
        workspace_mode: workspace_mode_from_str(&row.get::<_, String>(11)?)?,
        target_branch: row.get(12)?,
        workspace_branch: row.get(13)?,
        workspace_path: row.get(14)?,
        completion_policy: row
            .get::<_, Option<String>>(15)?
            .map(|value| project_completion_policy_from_str(&value))
            .transpose()?,
        worktree_root_path: row.get(16)?,
        worktree_setup_command: row.get(17)?,
        log_path: row.get(18)?,
        latest_output: row.get(19)?,
        last_active_at: row.get(20)?,
        started_at: row.get(21)?,
        closed_at: row.get(22)?,
    })
}

fn agent_session_list_row_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AgentSessionListRow> {
    Ok(AgentSessionListRow {
        session_id: row.get(0)?,
        issue_id: row.get(1)?,
        issue_title: row.get(2)?,
        issue_status: row
            .get::<_, Option<String>>(3)?
            .map(|value| issue_status_from_str(&value))
            .transpose()?,
        agent_profile_id: row.get(4)?,
        title: row.get(5)?,
        agent_type: agent_type_from_str(&row.get::<_, String>(6)?)?,
        status: agent_session_status_from_str(&row.get::<_, String>(7)?)?,
        attention: agent_session_attention_from_str(&row.get::<_, String>(8)?)?,
        workspace_mode: workspace_mode_from_str(&row.get::<_, String>(9)?)?,
        log_path: row.get(10)?,
        latest_output: row.get(11)?,
        list_inserted_at: row.get(12)?,
        last_active_at: row.get(13)?,
        started_at: row.get(14)?,
        closed_at: row.get(15)?,
    })
}

fn agent_type_from_str(value: &str) -> rusqlite::Result<AgentType> {
    match value {
        "codex" => Ok(AgentType::Codex),
        "claude" => Ok(AgentType::Claude),
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

fn workspace_mode_to_str(value: &WorkspaceMode) -> &'static str {
    match value {
        WorkspaceMode::CurrentBranch => "current_branch",
        WorkspaceMode::Worktree => "worktree",
    }
}

fn project_completion_policy_from_str(value: &str) -> rusqlite::Result<ProjectCompletionPolicy> {
    match value {
        "manual" => Ok(ProjectCompletionPolicy::Manual),
        "agent_auto_commit" => Ok(ProjectCompletionPolicy::AgentAutoCommit),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn project_completion_policy_to_str(value: &ProjectCompletionPolicy) -> &'static str {
    match value {
        ProjectCompletionPolicy::Manual => "manual",
        ProjectCompletionPolicy::AgentAutoCommit => "agent_auto_commit",
    }
}
