use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::types::issue_completion::{
    IssueCompletionExternalWorktreeDecision, IssueCompletionFlowRecord, IssueCompletionPhase,
};

pub struct IssueCompletionFlowRepository<'connection> {
    connection: &'connection Connection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IssueCompletionFlowRecordInput<'value> {
    pub issue_id: i64,
    pub session_id: Option<i64>,
    pub phase: IssueCompletionPhase,
    pub ignore_dirty: bool,
    pub external_worktree_decision: Option<IssueCompletionExternalWorktreeDecision>,
    pub base_branch: Option<&'value str>,
    pub workspace_branch: Option<&'value str>,
    pub workspace_path: Option<&'value str>,
    pub failure_reason: Option<&'value str>,
    pub updated_at: i64,
}

impl<'connection> IssueCompletionFlowRepository<'connection> {
    pub fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub fn find_by_issue_id(
        &self,
        issue_id: i64,
    ) -> rusqlite::Result<Option<IssueCompletionFlowRecord>> {
        find_by_issue_id_on_connection(self.connection, issue_id)
    }

    pub fn upsert_in_transaction(
        transaction: &Transaction<'_>,
        record_input: IssueCompletionFlowRecordInput<'_>,
    ) -> rusqlite::Result<IssueCompletionFlowRecord> {
        transaction.execute(
            "INSERT INTO issue_completion_flows (
               issue_id,
               session_id,
               phase,
               ignore_dirty,
               external_worktree_decision,
               base_branch,
               workspace_branch,
               workspace_path,
               failure_reason,
               updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(issue_id) DO UPDATE SET
               session_id = excluded.session_id,
               phase = excluded.phase,
               ignore_dirty = excluded.ignore_dirty,
               external_worktree_decision = excluded.external_worktree_decision,
               base_branch = excluded.base_branch,
               workspace_branch = excluded.workspace_branch,
               workspace_path = excluded.workspace_path,
               failure_reason = excluded.failure_reason,
               updated_at = excluded.updated_at",
            params![
                record_input.issue_id,
                record_input.session_id,
                record_input.phase.as_str(),
                bool_to_int(record_input.ignore_dirty),
                record_input
                    .external_worktree_decision
                    .map(|value| value.as_str()),
                record_input.base_branch,
                record_input.workspace_branch,
                record_input.workspace_path,
                record_input.failure_reason,
                record_input.updated_at
            ],
        )?;

        Self::find_by_issue_id_in_transaction(transaction, record_input.issue_id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn find_by_issue_id_in_transaction(
        transaction: &Transaction<'_>,
        issue_id: i64,
    ) -> rusqlite::Result<Option<IssueCompletionFlowRecord>> {
        find_by_issue_id_on_connection(transaction, issue_id)
    }

    pub fn clear_in_transaction(
        transaction: &Transaction<'_>,
        issue_id: i64,
    ) -> rusqlite::Result<()> {
        transaction.execute(
            "DELETE FROM issue_completion_flows WHERE issue_id = ?1",
            params![issue_id],
        )?;
        Ok(())
    }
}

fn find_by_issue_id_on_connection(
    connection: &Connection,
    issue_id: i64,
) -> rusqlite::Result<Option<IssueCompletionFlowRecord>> {
    connection
        .query_row(
            "SELECT id, issue_id, session_id, phase, ignore_dirty, external_worktree_decision, base_branch, workspace_branch, workspace_path, failure_reason, updated_at
             FROM issue_completion_flows
             WHERE issue_id = ?1",
            params![issue_id],
            issue_completion_flow_from_row,
        )
        .optional()
}

fn issue_completion_flow_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<IssueCompletionFlowRecord> {
    Ok(IssueCompletionFlowRecord {
        id: row.get(0)?,
        issue_id: row.get(1)?,
        session_id: row.get(2)?,
        phase: issue_completion_phase_from_str(&row.get::<_, String>(3)?)?,
        ignore_dirty: int_to_bool(row.get(4)?)?,
        external_worktree_decision: row
            .get::<_, Option<String>>(5)?
            .map(|value| issue_completion_external_worktree_decision_from_str(&value))
            .transpose()?,
        base_branch: row.get(6)?,
        workspace_branch: row.get(7)?,
        workspace_path: row.get(8)?,
        failure_reason: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn issue_completion_phase_from_str(value: &str) -> rusqlite::Result<IssueCompletionPhase> {
    match value {
        "checking_dirty" => Ok(IssueCompletionPhase::CheckingDirty),
        "waiting_agent_commit" => Ok(IssueCompletionPhase::WaitingAgentCommit),
        "manual_dirty_blocked" => Ok(IssueCompletionPhase::ManualDirtyBlocked),
        "checking_branch" => Ok(IssueCompletionPhase::CheckingBranch),
        "confirming_external_worktree" => Ok(IssueCompletionPhase::ConfirmingExternalWorktree),
        "rebasing" => Ok(IssueCompletionPhase::Rebasing),
        "agent_merge_blocked" => Ok(IssueCompletionPhase::AgentMergeBlocked),
        "completed" => Ok(IssueCompletionPhase::Completed),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn issue_completion_external_worktree_decision_from_str(
    value: &str,
) -> rusqlite::Result<IssueCompletionExternalWorktreeDecision> {
    match value {
        "merge_and_delete" => Ok(IssueCompletionExternalWorktreeDecision::MergeAndDelete),
        "skip" => Ok(IssueCompletionExternalWorktreeDecision::Skip),
        "cancel" => Ok(IssueCompletionExternalWorktreeDecision::Cancel),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn int_to_bool(value: i64) -> rusqlite::Result<bool> {
    match value {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}
