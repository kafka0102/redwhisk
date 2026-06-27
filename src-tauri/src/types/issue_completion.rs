use serde::{Deserialize, Serialize};

use crate::types::issue::IssueRecord;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueCompletionPhase {
    CheckingDirty,
    WaitingAgentCommit,
    ManualDirtyBlocked,
    CheckingBranch,
    ConfirmingExternalWorktree,
    Rebasing,
    AgentMergeBlocked,
    Completed,
}

impl IssueCompletionPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CheckingDirty => "checking_dirty",
            Self::WaitingAgentCommit => "waiting_agent_commit",
            Self::ManualDirtyBlocked => "manual_dirty_blocked",
            Self::CheckingBranch => "checking_branch",
            Self::ConfirmingExternalWorktree => "confirming_external_worktree",
            Self::Rebasing => "rebasing",
            Self::AgentMergeBlocked => "agent_merge_blocked",
            Self::Completed => "completed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueCompletionExternalWorktreeDecision {
    MergeAndDelete,
    Skip,
    Cancel,
}

impl IssueCompletionExternalWorktreeDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MergeAndDelete => "merge_and_delete",
            Self::Skip => "skip",
            Self::Cancel => "cancel",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueCompletionFlowRecord {
    pub id: i64,
    pub issue_id: i64,
    pub session_id: Option<i64>,
    pub phase: IssueCompletionPhase,
    pub ignore_dirty: bool,
    pub external_worktree_decision: Option<IssueCompletionExternalWorktreeDecision>,
    pub base_branch: Option<String>,
    pub workspace_branch: Option<String>,
    pub workspace_path: Option<String>,
    pub failure_reason: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteIssueFlowInput {
    pub project_id: i64,
    pub issue_id: i64,
    pub ignore_dirty: Option<bool>,
    pub external_worktree_decision: Option<IssueCompletionExternalWorktreeDecision>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompleteIssueFlowAction {
    Completed,
    ManualDirtyPrompt,
    WaitingAgentCommit,
    ConfirmExternalWorktree,
    AgentMergeBlocked,
    NoCommitDetected,
    GitOperationBlocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteIssueFlowResult {
    pub action: CompleteIssueFlowAction,
    pub issue: IssueRecord,
    pub flow: Option<IssueCompletionFlowRecord>,
    pub message: String,
    pub target_branch: Option<String>,
    pub workspace_branch: Option<String>,
    pub workspace_path: Option<String>,
    pub session_id: Option<i64>,
}
