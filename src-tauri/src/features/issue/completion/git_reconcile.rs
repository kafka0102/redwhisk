use std::path::Path;

use crate::git::operation_state::GitOperationState;
use crate::git::status::GitSnapshot;
use crate::git::worktree::{
    assess_missing_worktree, classify_merge_block, current_branch, discard_worktree_changes,
    reconcile_worktree, GitWorktreeError, MergeBlockClassification, MissingWorktreeAssessment,
    WorktreeReconcileRequest,
};
use crate::types::agent_session::AgentSessionRecord;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};


pub(crate) fn discard_session_workspace_changes(
    session: &AgentSessionRecord,
) -> Result<(), GitWorktreeError> {
    let Some(workspace_path) = session.workspace_path.as_deref() else {
        return Ok(());
    };
    discard_worktree_changes(Path::new(workspace_path))
}

pub(crate) fn reconcile_session_worktree(
    repo_path: &str,
    session: &AgentSessionRecord,
) -> Result<(), GitWorktreeError> {
    let Some(target_branch) = session
        .origin_branch
        .as_deref()
        .or(session.target_branch.as_deref())
    else {
        return Ok(());
    };
    let Some(workspace_branch) = session.workspace_branch.as_deref() else {
        return Ok(());
    };
    let Some(workspace_path) = session.workspace_path.as_deref() else {
        return Ok(());
    };

    reconcile_worktree(WorktreeReconcileRequest {
        repo_path: Path::new(repo_path),
        workspace_path: Path::new(workspace_path),
        workspace_branch,
        target_branch,
    })
}

pub(crate) struct WorktreeMergeBlockDescription {
    pub(crate) reason: String,
    pub(crate) message: String,
}

pub(crate) fn merge_block_from_worktree_error(
    error: &GitWorktreeError,
) -> WorktreeMergeBlockDescription {
    let classification = classify_merge_block(error);
    WorktreeMergeBlockDescription {
        reason: classification.reason().to_string(),
        message: merge_block_message(&classification, error),
    }
}

fn merge_block_message(
    classification: &MergeBlockClassification,
    error: &GitWorktreeError,
) -> String {
    match classification {
        MergeBlockClassification::TargetDirty { path, files } => format!(
            "目标分支工作区存在未提交改动，无法合入 Agent worktree。请先在目标分支工作区提交、暂存或丢弃这些改动：{files}。工作区：{path}"
        ),
        MergeBlockClassification::WorkspaceDirty { path, files } => format!(
            "Agent worktree 存在未提交改动，无法自动合入目标分支。请先提交或处理这些改动：{files}。工作区：{path}"
        ),
        MergeBlockClassification::MergeConflict => {
            "Agent worktree 合并发生冲突，请手动处理冲突。".to_string()
        }
        MergeBlockClassification::GitCommandFailed => {
            format!("Agent worktree 合入失败：{error}")
        }
    }
}

pub(crate) fn redwhisk_missing_worktree_is_closed_out(
    repo_path: &str,
    session: &AgentSessionRecord,
) -> Result<(), String> {
    let target_branch = session
        .origin_branch
        .as_deref()
        .or(session.target_branch.as_deref())
        .ok_or_else(|| "缺失 RedWhisk worktree 的目标分支元数据。".to_string())?;
    let workspace_branch = session
        .workspace_branch
        .as_deref()
        .ok_or_else(|| "缺失 RedWhisk worktree 的工作分支元数据。".to_string())?;

    match assess_missing_worktree(repo_path, target_branch, workspace_branch) {
        Ok(MissingWorktreeAssessment::ClosedOut) => Ok(()),
        Ok(MissingWorktreeAssessment::NotMerged {
            workspace_branch,
            target_branch,
        }) => Err(format!(
            "RedWhisk worktree 路径缺失，但工作分支 {workspace_branch} 尚未合入 {target_branch}。"
        )),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn read_current_branch(repo_path: &str) -> Result<String, CommandError> {
    current_branch(repo_path).map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "当前 Project 的 Git 状态不可用。",
        )
        .with_reason("gitStatusUnavailable")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })
}

pub(crate) fn closed_session_completion_snapshot() -> GitSnapshot {
    GitSnapshot {
        head: String::new(),
        status_porcelain: String::new(),
        changed_files: Vec::new(),
        operation_state: GitOperationState::None,
        is_clean: true,
    }
}
