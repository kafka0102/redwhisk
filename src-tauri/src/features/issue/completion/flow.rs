use std::path::Path;

use crate::agent::session_registry::AgentSessionRegistry;
use crate::features::issue::completion::git_reconcile::{
    read_current_branch, redwhisk_missing_worktree_is_closed_out,
};
use crate::features::issue::completion::state_machine::{
    CompletionEvent, CompletionState, CompletionWorld,
};
use crate::git::status::GitSnapshot;
use crate::git::worktree::inspect_execution_path;
use crate::types::agent_session::{
    AgentSessionRecord, AgentSessionStatus, WorkspaceMode, WorktreeOwner,
};
use crate::types::completion_attempt::CompletionAttemptOption;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::IssueRecord;
use crate::types::issue_completion::{
    CompleteIssueFlowAction, CompleteIssueFlowInput, DirtyWorkspaceOption,
    IssueCompletionFlowRecord, IssueCompletionPhase,
};

pub(crate) fn legacy_completion_flow_action_error(
    action: CompleteIssueFlowAction,
    flow_message: &str,
) -> CommandError {
    let (default_message, reason) = match action {
        CompleteIssueFlowAction::PromptDirtyDecision => (
            "当前仓库存在未提交改动，不能直接完成。",
            "dirtyRepoCannotComplete",
        ),
        CompleteIssueFlowAction::Blocked => (
            "当前 Git 正在进行中的操作阻止直接完成。请先在终端手动处理 Git 状态（如冲突合并、rebase --continue / --abort）后再重试。",
            "gitOperationBlocking",
        ),
        _ => (
            "Issue 完成必须通过 complete_issue_flow 继续处理。",
            "mustUseCompletionFlow",
        ),
    };
    // flow 结果已带详细说明时优先透传，避免丢失 operation 类型与工作目录。
    let message = if !flow_message.trim().is_empty()
        && matches!(
            action,
            CompleteIssueFlowAction::Blocked | CompleteIssueFlowAction::PromptDirtyDecision
        ) {
        flow_message
    } else {
        default_message
    };
    CommandError::new(CommandErrorCode::IssueValidationFailed, message)
        .with_reason(reason)
        .with_detail(ErrorDetail::new("CompletionFlow").with_value("action", format!("{action:?}")))
}

pub(crate) fn completion_state_from_record(record: &IssueCompletionFlowRecord) -> CompletionState {
    CompletionState {
        phase: record.phase,
        dirty_decision: record.dirty_decision,
        ignore_dirty: record.ignore_dirty,
        worktree_cleanup_decision: record.worktree_cleanup_decision,
        continue_after_commit: record.continue_after_commit,
        actual_path: record.actual_path.clone(),
        failure_reason: record.failure_reason.clone(),
    }
}

pub(crate) fn gather_completion_world(
    repo_path: &str,
    issue: &IssueRecord,
    session: &AgentSessionRecord,
    actual: &ActualExecutionPath,
    snapshot: GitSnapshot,
    forced_option: Option<CompletionAttemptOption>,
) -> CompletionWorld {
    let workspace_missing = session.workspace_mode == WorkspaceMode::Worktree
        && session
            .workspace_path
            .as_deref()
            .is_some_and(|workspace_path| !Path::new(workspace_path).exists());
    let owner = if actual.drifted {
        WorktreeOwner::External
    } else {
        session.worktree_owner
    };
    let target_branch = session
        .origin_branch
        .clone()
        .or_else(|| session.target_branch.clone());
    let current_branch = if workspace_missing {
        target_branch.clone().unwrap_or_default()
    } else {
        read_current_branch(&session.working_dir)
            .unwrap_or_else(|_| target_branch.clone().unwrap_or_default())
    };
    let branch_mismatch = target_branch.as_deref() != Some(current_branch.as_str());
    let missing_worktree_error = if workspace_missing && owner == WorktreeOwner::Redwhisk {
        redwhisk_missing_worktree_is_closed_out(repo_path, session).err()
    } else {
        None
    };
    CompletionWorld {
        issue_status: issue.status,
        workspace_mode: session.workspace_mode,
        workspace_missing,
        owner,
        target_branch,
        current_branch: Some(current_branch),
        branch_mismatch,
        actual_path: actual.path.clone(),
        drifted: actual.drifted,
        session_closed_out: is_session_closed_out(session),
        missing_worktree_error,
        snapshot,
        attempt_option: forced_option.unwrap_or(CompletionAttemptOption::CompleteManual),
    }
}

pub(crate) fn derive_completion_event(
    input: &CompleteIssueFlowInput,
    state: &CompletionState,
) -> CompletionEvent {
    if state.phase == IssueCompletionPhase::ConfirmingContinueAfterCommit
        && input.continue_after_commit.is_some()
    {
        return CompletionEvent::ContinueConfirmed {
            proceed: input.continue_after_commit.unwrap(),
        };
    }
    if state.phase == IssueCompletionPhase::ConfirmingWorktreeCleanup
        && input.worktree_cleanup_decision.is_some()
    {
        return CompletionEvent::CleanupDecided {
            cleanup: input.worktree_cleanup_decision.unwrap(),
        };
    }
    if input.dirty_decision == Some(DirtyWorkspaceOption::Cancel) {
        return CompletionEvent::DirtyDecided(DirtyWorkspaceOption::Cancel);
    }
    if matches!(
        state.phase,
        IssueCompletionPhase::DetectingWorkspace | IssueCompletionPhase::PromptingDirtyDecision
    ) && input.dirty_decision.is_some()
    {
        return CompletionEvent::DirtyDecided(input.dirty_decision.unwrap());
    }
    CompletionEvent::Begin
}

pub(crate) fn phase_to_completion_action(phase: IssueCompletionPhase) -> CompleteIssueFlowAction {
    match phase {
        IssueCompletionPhase::Completed => CompleteIssueFlowAction::Completed,
        IssueCompletionPhase::Cancelled => CompleteIssueFlowAction::Cancelled,
        IssueCompletionPhase::Blocked => CompleteIssueFlowAction::Blocked,
        IssueCompletionPhase::PromptingDirtyDecision => {
            CompleteIssueFlowAction::PromptDirtyDecision
        }
        IssueCompletionPhase::AutoCommitting => CompleteIssueFlowAction::WaitingAutoCommit,
        IssueCompletionPhase::ConfirmingWorktreeCleanup => {
            CompleteIssueFlowAction::ConfirmWorktreeCleanup
        }
        IssueCompletionPhase::ConfirmingContinueAfterCommit => {
            CompleteIssueFlowAction::ConfirmContinueAfterCommit
        }
        // 瞬态：单次 command 内穿越，不应作为终态出现；保守映射为 Completed。
        IssueCompletionPhase::DetectingWorkspace | IssueCompletionPhase::ReconcilingWorktree => {
            CompleteIssueFlowAction::Completed
        }
    }
}

pub(crate) fn completion_detection_repo_path(
    project_repo_path: &str,
    session: &AgentSessionRecord,
) -> String {
    if session.workspace_mode == WorkspaceMode::Worktree
        && session
            .workspace_path
            .as_deref()
            .is_some_and(|workspace_path| !Path::new(workspace_path).exists())
    {
        return project_repo_path.to_string();
    }

    session.working_dir.clone()
}

/// 完成时解析出的实际执行路径来源。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActualPathSource {
    /// 结构化 codex session 最近一条 shell 命令的 cwd（best-effort）。
    CodexCwd,
    /// session 启动记录的 `workspace_path`/`working_dir` 快照（PTY 或 cwd 不可得时）。
    StartupSnapshot,
    /// 用户在弹框中手填覆盖。
    UserProvided,
}

/// 完成时解析出的 session 实际执行路径。
///
/// 用于：①未提交改动检测与漂移判定的路径基准；②前端弹框预填分支名；
/// ③识别「current branch 启动但运行中漂移到新 worktree」的第三种情况。
///
/// `source`/`in_worktree`/`worktree_branch` 当前由单测与 Impl-D（合并基准）/前端
/// （弹框预填）消费，非 test 构建仅写不读，故允许 dead_code。
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) struct ActualExecutionPath {
    /// 解析出的实际路径（已去空白）。
    pub path: String,
    pub source: ActualPathSource,
    /// 该路径是否位于附加 worktree（`--git-dir` 与 `--git-common-dir` 不同）。
    pub in_worktree: bool,
    /// 该 worktree 的 checkout 分支（非 worktree 时为 `None`）。
    pub worktree_branch: Option<String>,
    /// 实际路径与启动快照不同且位于 worktree -> 运行中漂移到新 worktree。
    pub drifted: bool,
}

/// 解析 session 完成时的实际执行路径（分层回退）。
///
/// 优先级：用户弹框手填 `input.actual_path` > 活跃结构化 session 的 `last_known_cwd`
/// > 启动记录 `workspace_path`/`working_dir`。PTY session 与关闭的 session 取不到
/// live cwd，回退启动快照。拿到路径后再判断是否在 worktree、是否相对启动路径漂移。
pub(crate) fn resolve_actual_execution_path(
    input: &CompleteIssueFlowInput,
    session: &AgentSessionRecord,
    agent_registry: &AgentSessionRegistry,
) -> ActualExecutionPath {
    let startup_path = session
        .workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .or_else(|| {
            let working_dir = session.working_dir.trim();
            (!working_dir.is_empty()).then_some(working_dir)
        })
        .unwrap_or_default()
        .to_string();

    let (path, source) = if let Some(user_path) = input
        .actual_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        (user_path.to_string(), ActualPathSource::UserProvided)
    } else if let Some(cwd) = agent_registry
        .get(session.id)
        .and_then(|handle| handle.last_known_cwd())
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        (cwd.to_string(), ActualPathSource::CodexCwd)
    } else {
        (startup_path.clone(), ActualPathSource::StartupSnapshot)
    };

    if path.is_empty() {
        return ActualExecutionPath {
            path,
            source,
            in_worktree: false,
            worktree_branch: None,
            drifted: false,
        };
    }

    let facts = inspect_execution_path(&path, &startup_path);

    ActualExecutionPath {
        path,
        source,
        in_worktree: facts.in_worktree,
        worktree_branch: facts.worktree_branch,
        drifted: facts.drifted,
    }
}

pub(crate) fn is_session_closed_out(session: &AgentSessionRecord) -> bool {
    session.status != AgentSessionStatus::Running || session.closed_at.is_some()
}
