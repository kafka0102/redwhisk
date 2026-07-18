use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;

use crate::agent::session_registry::AgentSessionRegistry;
use crate::db::completion_attempt_repository::CompletionAttemptRepository;
use crate::db::event_repository::EventRepository;
use crate::features::issue::completion::state_machine::{
    CompletionEvent, CompletionState, CompletionWorld,
};
use crate::features::issue::validation::issue_database_error;
use crate::git::operation_state::GitOperationState;
use crate::git::status::GitSnapshot;
use crate::git::worktree::{
    assess_missing_worktree, classify_merge_block, current_branch, inspect_execution_path,
    reconcile_worktree, GitWorktreeError, MergeBlockClassification, MissingWorktreeAssessment,
    WorktreeReconcileRequest,
};
use crate::types::agent_session::{
    AgentSessionRecord, AgentSessionStatus, WorkspaceMode, WorktreeOwner,
};
use crate::types::completion_attempt::{
    CompletionAttemptOption, CompletionAttemptRecord, CompletionAttemptResult,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::issue::{IssueRecord, IssueStatus, IssueSummaryCompletionInfo};
use crate::types::issue_action::IssueActionType;
use crate::types::issue_completion::{
    CompleteIssueFlowAction, CompleteIssueFlowInput, DirtyWorkspaceOption,
    IssueCompletionFlowRecord, IssueCompletionPhase,
};

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

fn redwhisk_missing_worktree_is_closed_out(
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

fn read_current_branch(repo_path: &str) -> Result<String, CommandError> {
    current_branch(repo_path).map_err(|error| {
        CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "当前 Project 的 Git 状态不可用。",
        )
        .with_reason("gitStatusUnavailable")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })
}

pub(crate) fn completion_session_close_reason(option: CompletionAttemptOption) -> &'static str {
    match option {
        CompletionAttemptOption::CompleteManual => "manual_completion",
        CompletionAttemptOption::CompleteClean => "clean_completion",
    }
}

pub(crate) fn legacy_completion_flow_action_error(action: CompleteIssueFlowAction) -> CommandError {
    let (message, reason) = match action {
        CompleteIssueFlowAction::PromptDirtyDecision => ("当前仓库存在未提交改动，不能直接完成。", "dirtyRepoCannotComplete"),
        CompleteIssueFlowAction::Blocked => ("当前 Git 正在进行中的操作阻止直接完成。", "gitOperationBlocking"),
        _ => ("Issue 完成必须通过 complete_issue_flow 继续处理。", "mustUseCompletionFlow"),
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
        IssueCompletionPhase::PromptingDirtyDecision => CompleteIssueFlowAction::PromptDirtyDecision,
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

pub(crate) fn completion_message(
    phase: IssueCompletionPhase,
    merge_block: Option<&WorktreeMergeBlockDescription>,
) -> String {
    match phase {
        IssueCompletionPhase::Completed => "Issue 已完成。".to_string(),
        IssueCompletionPhase::Cancelled => "完成已取消，Issue 保持待验收。".to_string(),
        IssueCompletionPhase::Blocked => match merge_block {
            Some(block) => block.message.clone(),
            None => "Agent worktree 缺失且无法确认分支已合入，请手动处理。".to_string(),
        },
        IssueCompletionPhase::PromptingDirtyDecision => {
            "当前工作区存在未提交改动，请选择自动提交 / 不提交 / 取消。".to_string()
        }
        IssueCompletionPhase::AutoCommitting => {
            "已请求 Agent 自动提交，请在 session 中完成提交后再次确认。".to_string()
        }
        IssueCompletionPhase::ConfirmingWorktreeCleanup => {
            "当前使用外部 worktree，请确认是否合并并删除该 worktree。".to_string()
        }
        IssueCompletionPhase::ConfirmingContinueAfterCommit => {
            "代码已提交成功。确定继续标记完成吗？".to_string()
        }
        IssueCompletionPhase::DetectingWorkspace | IssueCompletionPhase::ReconcilingWorktree => {
            "Issue 已完成。".to_string()
        }
    }
}

pub(crate) fn completion_detection_repo_path(project_repo_path: &str, session: &AgentSessionRecord) -> String {
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
    /// 实际路径与启动快照不同且位于 worktree → 运行中漂移到新 worktree。
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

pub(crate) fn closed_session_completion_snapshot() -> GitSnapshot {
    GitSnapshot {
        head: String::new(),
        status_porcelain: String::new(),
        changed_files: Vec::new(),
        operation_state: GitOperationState::None,
        is_clean: true,
    }
}

pub(crate) fn issue_status_to_str(status: &IssueStatus) -> &'static str {
    match status {
        IssueStatus::Backlog => "backlog",
        IssueStatus::Running => "running",
        IssueStatus::Review => "review",
        IssueStatus::Completed => "completed",
    }
}

pub(crate) fn workspace_mode_to_str(mode: &WorkspaceMode) -> &'static str {
    match mode {
        WorkspaceMode::CurrentBranch => "current_branch",
        WorkspaceMode::Worktree => "worktree",
    }
}

pub(crate) fn build_agent_commit_completion_prompt(issue_title: &str, head: &str) -> String {
    format!(
        "请获取本次修改相关的代码，检查当前 Issue 涉及的文件变更；只暂存并提交与本次 Issue 直接相关的文件，不要提交无关改动。\n\
Issue: {issue_title}\n\
当前 HEAD: {head}\n\
要求：\n\
- 只包含当前 Issue 直接相关文件\n\
- 不要提交无关改动\n\
- 先自检再提交\n\
- 使用中文 Conventional Commit\n\
- 完成后请回复 commit hash、提交结果与验证命令\n\
- 完成后在答复正文顶层用 <issue-comment>精简中文交付摘要</issue-comment> 输出本次交付内容（做了什么 / 结果 / 验证命令），该标签会被系统提取为 Issue 评论；不要把标签放进代码块或对其转义\n"
    )
}

pub(crate) fn record_blocked_completion_attempt(
    transaction: &rusqlite::Transaction<'_>,
    issue_id: i64,
    session_id: i64,
    option: CompletionAttemptOption,
    head: &str,
    failure_reason: &str,
    operation_state: GitOperationState,
    message: &str,
) -> rusqlite::Result<CompletionAttemptRecord> {
    let changed_files_json = json!({
        "blockedBy": "git_operation",
        "state": format_git_operation_state(operation_state),
        "message": message,
    })
    .to_string();

    CompletionAttemptRepository::insert_in_transaction(
        transaction,
        issue_id,
        session_id,
        option,
        head,
        head,
        None,
        Some(failure_reason),
        &changed_files_json,
        CompletionAttemptResult::GitOperationBlocked,
        current_epoch_millis_for_db()?,
    )
}

fn summary_completion_from_attempt(attempt: CompletionAttemptRecord) -> IssueSummaryCompletionInfo {
    IssueSummaryCompletionInfo {
        option: attempt.option.as_str().to_string(),
        result: attempt.result.as_str().to_string(),
        commit_hash: attempt.commit_hash,
        failure_reason: attempt.failure_reason,
        head_before: Some(attempt.head_before),
        head_after: Some(attempt.head_after),
        changed_files_json: Some(attempt.changed_files_json),
        created_at: attempt.created_at,
        source: "completion_attempt".to_string(),
    }
}

fn latest_completion_from_issue_action(
    connection: &rusqlite::Connection,
    issue_id: i64,
) -> Result<Option<IssueSummaryCompletionInfo>, CommandError> {
    let issue_completed_action = EventRepository::new(connection)
        .list_issue_actions(issue_id)
        .map_err(issue_database_error)?
        .into_iter()
        .find(|action| action.action_type == IssueActionType::IssueCompleted);

    let Some(action) = issue_completed_action else {
        return Ok(None);
    };

    let payload =
        serde_json::from_str::<serde_json::Value>(&action.payload_json).map_err(|error| {
            CommandError::new(
                CommandErrorCode::IssuePersistenceFailed,
                "Issue Summary 解析失败。",
            ).with_reason("summaryParseFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
            .with_detail(ErrorDetail::new("IssueAction").with_value("issueId", issue_id))
        })?;

    let option = payload
        .get("option")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown")
        .to_string();

    Ok(Some(IssueSummaryCompletionInfo {
        option,
        result: "completed".to_string(),
        commit_hash: None,
        failure_reason: None,
        head_before: None,
        head_after: None,
        changed_files_json: None,
        created_at: action.created_at,
        source: "issue_action_fallback".to_string(),
    }))
}

pub(crate) fn resolve_issue_summary_completion(
    connection: &rusqlite::Connection,
    issue_id: i64,
    attempts: &[CompletionAttemptRecord],
    diagnostics: &mut Vec<String>,
) -> Result<Option<IssueSummaryCompletionInfo>, CommandError> {
    let completed_attempt = attempts
        .iter()
        .find(|attempt| attempt.result == CompletionAttemptResult::Completed)
        .cloned();

    if let Some(attempt) = completed_attempt {
        return Ok(Some(summary_completion_from_attempt(attempt)));
    }

    if attempts.is_empty() {
        diagnostics.push("缺少 CompletionAttempt 记录，已回退到 Issue 完成事件推断。".to_string());
    } else {
        diagnostics.push(
            "未找到可代表最终 completed 的 CompletionAttempt，已回退到 Issue 完成事件推断。"
                .to_string(),
        );
    }

    latest_completion_from_issue_action(connection, issue_id)
}

pub(crate) fn format_agent_session_status_for_summary(status: &AgentSessionStatus) -> &'static str {
    match status {
        AgentSessionStatus::Running => "running",
        AgentSessionStatus::Closed => "closed",
        AgentSessionStatus::Crashed => "crashed",
        AgentSessionStatus::Stopped => "stopped",
    }
}

pub(crate) fn current_epoch_millis_for_db() -> rusqlite::Result<i64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| rusqlite::Error::InvalidQuery)?;

    i64::try_from(duration.as_millis()).map_err(|_| rusqlite::Error::InvalidQuery)
}

pub(crate) fn format_git_operation_state(state: GitOperationState) -> &'static str {
    match state {
        GitOperationState::None => "none",
        GitOperationState::MergeInProgress => "merge_in_progress",
        GitOperationState::RebaseInProgress => "rebase_in_progress",
        GitOperationState::CherryPickInProgress => "cherry_pick_in_progress",
        GitOperationState::RevertInProgress => "revert_in_progress",
        GitOperationState::SequencerInProgress => "sequencer_in_progress",
        GitOperationState::Unmerged => "unmerged",
    }
}

pub(crate) fn current_epoch_millis() -> Result<i64, CommandError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。").with_reason("saveFailed")
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

    i64::try_from(duration.as_millis()).map_err(|error| {
        CommandError::new(CommandErrorCode::IssuePersistenceFailed, "Issue 保存失败。").with_reason("saveFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })
}
