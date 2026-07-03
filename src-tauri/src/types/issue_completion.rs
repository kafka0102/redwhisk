use serde::{Deserialize, Serialize};

use crate::types::issue::IssueRecord;

/// Issue 完成流程的统一阶段（取代旧 manual / agent_auto_commit policy 二分）。
///
/// 完成时统一检测实际执行路径与未提交改动，由用户在弹框中选择
/// 「自动提交 / 不提交 / 取消」，再走 worktree 对账与清理。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueCompletionPhase {
    /// 解析实际执行路径 + 检测未提交改动。
    DetectingWorkspace,
    /// 等待用户在 dirty 三选项对话框上的选择。
    PromptingDirtyDecision,
    /// 已向 session 发送 commit 指令，等待检测到新 commit。
    AutoCommitting,
    /// 提交完成后的「确定继续标记完成吗」确认。
    ConfirmingContinueAfterCommit,
    /// worktree 路径比对 / rebase 合并 / 失败消息 / 新建 session。
    ReconcilingWorktree,
    /// External worktree（含运行中漂移 worktree）的删除确认。
    ConfirmingWorktreeCleanup,
    /// 终态：全部成功。
    Completed,
    /// 终态：用户取消。
    Cancelled,
    /// 终态：rebase 失败等阻塞，可恢复。
    Blocked,
}

impl IssueCompletionPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DetectingWorkspace => "detecting_workspace",
            Self::PromptingDirtyDecision => "prompting_dirty_decision",
            Self::AutoCommitting => "auto_committing",
            Self::ConfirmingContinueAfterCommit => "confirming_continue_after_commit",
            Self::ReconcilingWorktree => "reconciling_worktree",
            Self::ConfirmingWorktreeCleanup => "confirming_worktree_cleanup",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Blocked => "blocked",
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled)
    }
}

/// dirty 工作区三选项。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirtyWorkspaceOption {
    /// 向 session 发送 commit 指令自动提交。
    AutoCommit,
    /// 忽略未提交改动，继续后续 worktree 对账。
    Skip,
    /// 取消完成流程。
    Cancel,
}

impl DirtyWorkspaceOption {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AutoCommit => "auto_commit",
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
    pub dirty_decision: Option<DirtyWorkspaceOption>,
    pub continue_after_commit: Option<bool>,
    pub worktree_cleanup_decision: Option<bool>,
    pub base_branch: Option<String>,
    pub workspace_branch: Option<String>,
    pub workspace_path: Option<String>,
    /// 完成时解析出的实际执行路径（结构化 session 取 codex 最近 cwd；否则取启动快照；用户可覆盖）。
    pub actual_path: Option<String>,
    pub failure_reason: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteIssueFlowInput {
    pub project_id: i64,
    pub issue_id: i64,
    /// dirty 三选项；仅在与 `PromptingDirtyDecision` 继续时使用。
    pub dirty_decision: Option<DirtyWorkspaceOption>,
    /// 用户选了「不提交（忽略未提交改动）」。
    pub ignore_dirty: Option<bool>,
    /// 用户在弹框中确认/修正的分支名（情况三/session 关闭时手填兜底）。
    pub branch_name: Option<String>,
    /// 用户在弹框中确认/修正的实际执行路径（兜底用）。
    pub actual_path: Option<String>,
    /// 「确定继续标记完成吗」确认；仅在 `ConfirmingContinueAfterCommit` 继续时使用。
    pub continue_after_commit: Option<bool>,
    /// External worktree 删除确认；仅在 `ConfirmingWorktreeCleanup` 继续时使用。
    pub worktree_cleanup_decision: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompleteIssueFlowAction {
    /// 全部完成，issue 已标记 completed。
    Completed,
    /// 检测到未提交改动，需要用户在三选项对话框中选择。
    PromptDirtyDecision,
    /// 已发送 commit 指令，等待 session 提交。
    WaitingAutoCommit,
    /// 检测到新 commit，需用户确认是否继续标记完成。
    ConfirmContinueAfterCommit,
    /// 处于 External worktree，需用户确认是否删除。
    ConfirmWorktreeCleanup,
    /// rebase/合并失败等阻塞（已向 session 发消息或新建 session）。
    Blocked,
    /// 用户取消完成流程。
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteIssueFlowResult {
    pub action: CompleteIssueFlowAction,
    pub issue: IssueRecord,
    pub flow: Option<IssueCompletionFlowRecord>,
    pub message: String,
    pub merge_block_reason: Option<String>,
    /// 弹框预填的基线分支（origin / workspace 分支）。
    pub target_branch: Option<String>,
    pub workspace_branch: Option<String>,
    pub workspace_path: Option<String>,
    /// 完成时解析出的实际执行路径。
    pub actual_path: Option<String>,
    /// 实际路径与启动快照不同（运行中漂移到新 worktree）。
    pub drifted: bool,
    pub session_id: Option<i64>,
}
