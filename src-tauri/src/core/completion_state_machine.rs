//! Issue 完成流程的纯状态机（候选 1 · step 1）。
//!
//! 把完成流程的「phase 迁移决策」从 `issue_service` 的巨型方法中抽出为纯函数
//! [`advance`]：`advance(state, world, event) -> Transition { new_state, effects }`。
//!
//! - machine 不持有 DB、不调 git、不产出展示文本；只决定下一 state 与要执行的 effect。
//! - [`CompletionWorld`] 是纯数据，由 service 侧的 gathering trait 取回后喂入
//!   （当前实现直接调既有 free 函数，候选 2 落地后替换为统一 git seam）。
//! - 副作用以 [`Effect`] 枚举表达，由 service 解释执行；结果性的 action / 文案在边界投影。
//!
//! phase 复用既有的 [`IssueCompletionPhase`]：其中 `DetectingWorkspace` 与
//! `ReconcilingWorktree` 是「单次 command 内穿越的瞬态逻辑态」（detecting = 尚无 flow；
//! reconciling = rebase/对账进行中），machine 会经过它们但 service 只持久化可持久化的子集。
//!
//! 本步为 step 1：零接线、不改任何现有行为；machine 的单测只验证内部一致性。
//! 完整接线与 wire 级 parity 校验在 step 3 完成（接线时以运行时行为为反馈补齐边界细节）。

use crate::git::operation_state::GitOperationState;
use crate::git::status::{GitChangedFile, GitSnapshot};
use crate::types::agent_session::{WorkspaceMode, WorktreeOwner};
use crate::types::completion_attempt::CompletionAttemptOption;
use crate::types::issue::IssueStatus;
use crate::types::issue_completion::{DirtyWorkspaceOption, IssueCompletionPhase};

/// machine 的 slim state：phase + 它读写的决策 / 载荷字段。
///
/// 不含 session 回显（base / workspace 分支、session_id）与时间戳——那些由 service
/// 在 `IssueCompletionFlowRecord` 上补。`dirty_already_skipped` 是派生量，按局部重算，
/// 不入 state。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletionState {
    pub phase: IssueCompletionPhase,
    pub dirty_decision: Option<DirtyWorkspaceOption>,
    pub ignore_dirty: bool,
    pub worktree_cleanup_decision: Option<bool>,
    pub continue_after_commit: Option<bool>,
    pub actual_path: Option<String>,
    pub failure_reason: Option<String>,
}

impl CompletionState {
    /// 尚无 flow 时的初始 detecting 态。
    pub fn detecting() -> Self {
        Self {
            phase: IssueCompletionPhase::DetectingWorkspace,
            dirty_decision: None,
            ignore_dirty: false,
            worktree_cleanup_decision: None,
            continue_after_commit: None,
            actual_path: None,
            failure_reason: None,
        }
    }

    /// `ignore_dirty || dirty_decision == Skip`：是否已跳过未提交改动。
    pub fn dirty_already_skipped(&self) -> bool {
        self.ignore_dirty || self.dirty_decision == Some(DirtyWorkspaceOption::Skip)
    }

    fn into_phase(mut self, phase: IssueCompletionPhase) -> Self {
        self.phase = phase;
        self
    }

    fn into_phase_with_reason(
        mut self,
        phase: IssueCompletionPhase,
        reason: impl Into<String>,
    ) -> Self {
        self.phase = phase;
        self.failure_reason = Some(reason.into());
        self
    }
}

/// machine 决策所依据的 world 事实（纯数据）。
///
/// `owner` 已是 effective（漂移到新 worktree → `External`），由 gathering 计算后喂入；
/// `branch_mismatch` 同理预计算（target_branch != current_branch）。
/// `snapshot` 始终为可用快照：读取失败时 gathering 负责回退到 closed 快照，
/// 因此 None 语义不进入 machine。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletionWorld {
    pub issue_status: IssueStatus,
    pub workspace_mode: WorkspaceMode,
    pub workspace_missing: bool,
    pub owner: WorktreeOwner,
    pub target_branch: Option<String>,
    pub current_branch: Option<String>,
    pub branch_mismatch: bool,
    pub actual_path: String,
    pub drifted: bool,
    pub session_closed_out: bool,
    /// RedWhisk worktree 缺失时，其分支是否尚未合入目标（`redwhisk_missing_worktree_is_closed_out` 为 Err）。
    /// 仅 workspace_missing + Redwhisk 时有意义；其余情况 gatherer 置 false。
    pub missing_worktree_not_closed_out: bool,
    pub snapshot: GitSnapshot,
    pub attempt_option: CompletionAttemptOption,
}

/// 驱动迁移的事件。由 service 侧适配层从 `CompleteIssueFlowInput` 翻译而来
/// （`CommitDetected` 由 `detect_agent_commit_completion` 轮询产生）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompletionEvent {
    /// 开始 / 恢复检测（input 无决策字段）。合法来自任意非终态 phase（含从 Blocked 恢复）。
    Begin,
    /// dirty 三选项。`Cancel` 合法来自任意非终态 phase（取消是全局动作）；
    /// `AutoCommit` / `Skip` 仅来自 detecting / prompting。
    DirtyDecided(DirtyWorkspaceOption),
    /// 轮询检测到新 commit（仅 `AutoCommitting`，由 adapter 门控）。
    CommitDetected { head: String, attempt_id: i64 },
    /// 自动提交后「确定继续标记完成吗」（仅 `ConfirmingContinueAfterCommit`）。
    ContinueConfirmed { proceed: bool },
    /// External worktree 删除确认（仅 `ConfirmingWorktreeCleanup`）。
    CleanupDecided { cleanup: bool },
}

/// 结果相关 effect 的失败策略：machine 声明「失败时怎么办」，执行由 service 完成。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FailurePolicy {
    /// 视为硬错误，向上抛出（如 `InjectCommitPrompt` / `CommitCompletion` 失败）。
    HardError,
    /// 转 `Blocked`（可恢复）；merge_block 原因由执行时从 git 错误计算，不进 machine。
    Block,
}

/// machine 产出的副作用。粗粒度：`CommitCompletion` 打包完成事务（改状态 + 关 session
/// + 归档 + 审计），不拆细。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// 向关联 session 注入 completion prompt（service 侧据 issue / head 构建 prompt 文本）。
    InjectCommitPrompt,
    /// 写 / 更新 CompletionAttempt。
    RecordCompletionAttempt {
        result: CompletionAttemptResultForEffect,
        head: String,
        changed_files: Vec<GitChangedFile>,
        /// `None` = 新插入；`Some(id)` = 更新既有 attempt。
        attempt_id: Option<i64>,
    },
    /// 在 RedWhisk 所有的 worktree 上执行 rebase + fast-forward + cleanup。
    /// 成功 → 继续执行同 Transition 其余 effect（抵达 Completed）；
    /// 失败 → 按 `on_failure` 处置（typically `Block`）。
    AttemptRebaseAndCleanup { on_failure: FailurePolicy },
    /// 完成事务（原子）：改 Issue 状态、关 session、归档日志、写审计、写 / 更新 attempt、清 flow。
    CommitCompletion {
        snapshot: GitSnapshot,
        option: CompletionAttemptOption,
    },
}

/// `Effect::RecordCompletionAttempt` 用的结果子集（仅 machine 会产出的两种）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompletionAttemptResultForEffect {
    PromptSent,
    Completed,
}

/// 一次迁移的结果：新 state（成功路径）+ 要按序执行的 effect。
///
/// `new_state` 是 effect 全部成功后的终态；执行期若某 effect 触发其 `on_failure = Block`，
/// service 把 `new_state.phase` 改写为 `Blocked` 并停执剩余 effect。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transition {
    pub new_state: CompletionState,
    pub effects: Vec<Effect>,
}

/// 非法 (phase, event) 组合：machine 是「哪些迁移合法」的唯一事实源。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidTransition {
    pub phase: IssueCompletionPhase,
    pub event: CompletionEvent,
}

/// 纯决策：给定当前 state、world 事实与一个事件，产出迁移。
///
/// 对合法输入恒返回 `Ok`；`Err` 仅表达结构性非法（adapter 应已门控，不应到达）。
pub fn advance(
    state: &CompletionState,
    world: &CompletionWorld,
    event: CompletionEvent,
) -> Result<Transition, InvalidTransition> {
    match (state.phase, event) {
        // Begin 可从任意非 Completed phase 触发（含从 Cancelled / Blocked 恢复再检测）；
        // 仅 Completed 是真正不可重入的终态。
        (phase, CompletionEvent::Begin) if phase != IssueCompletionPhase::Completed => {
            Ok(begin_detection(state, world))
        }
        (
            IssueCompletionPhase::DetectingWorkspace | IssueCompletionPhase::PromptingDirtyDecision,
            CompletionEvent::DirtyDecided(option),
        ) => Ok(decide_dirty(state, world, option)),
        // Cancel 是全局取消：从任意非 Completed phase 接受（对齐既有宽松取消语义）。
        (phase, CompletionEvent::DirtyDecided(DirtyWorkspaceOption::Cancel))
            if phase != IssueCompletionPhase::Completed =>
        {
            Ok(cancelled(state, world, "user_cancelled"))
        }
        (
            IssueCompletionPhase::AutoCommitting,
            CompletionEvent::CommitDetected { head, attempt_id },
        ) => Ok(detect_commit(state, world, head, attempt_id)),
        (
            IssueCompletionPhase::ConfirmingContinueAfterCommit,
            CompletionEvent::ContinueConfirmed { proceed },
        ) => Ok(confirm_continue(state, world, proceed)),
        (
            IssueCompletionPhase::ConfirmingWorktreeCleanup,
            CompletionEvent::CleanupDecided { cleanup },
        ) => Ok(decide_cleanup(state, world, cleanup)),
        (phase, event) => Err(InvalidTransition { phase, event }),
    }
}

// ---- 迁移分支 ----

fn begin_detection(state: &CompletionState, world: &CompletionWorld) -> Transition {
    // 已关闭 session + Review/Running + 非 worktree → 直接完成（跳过 dirty 提示）。
    if world.session_closed_out
        && matches!(
            world.issue_status,
            IssueStatus::Review | IssueStatus::Running
        )
        && world.workspace_mode != WorkspaceMode::Worktree
    {
        return complete(state, world);
    }
    // Git operation 进行中由 driver 作前置守卫拦截（记 blocked attempt、不持久化 flow），
    // 不作为 machine 迁移；调用方保证 world.snapshot.operation_state == None。
    if !world.snapshot.is_clean && !state.dirty_already_skipped() {
        return prompt_dirty(state, world);
    }
    reconcile(state, world)
}

fn decide_dirty(
    state: &CompletionState,
    world: &CompletionWorld,
    option: DirtyWorkspaceOption,
) -> Transition {
    match option {
        DirtyWorkspaceOption::Cancel => cancelled(state, world, "user_cancelled"),
        DirtyWorkspaceOption::AutoCommit => auto_committing(state, world),
        DirtyWorkspaceOption::Skip => {
            let mut next = state
                .clone()
                .into_phase(IssueCompletionPhase::ReconcilingWorktree);
            next.dirty_decision = Some(DirtyWorkspaceOption::Skip);
            next.actual_path = Some(world.actual_path.clone());
            reconcile(&next, world)
        }
    }
}

fn prompt_dirty(state: &CompletionState, world: &CompletionWorld) -> Transition {
    let mut next = state
        .clone()
        .into_phase(IssueCompletionPhase::PromptingDirtyDecision);
    next.actual_path = Some(world.actual_path.clone());
    Transition {
        new_state: next,
        effects: vec![],
    }
}

fn auto_committing(state: &CompletionState, world: &CompletionWorld) -> Transition {
    let mut next = state
        .clone()
        .into_phase(IssueCompletionPhase::AutoCommitting);
    next.dirty_decision = Some(DirtyWorkspaceOption::AutoCommit);
    next.actual_path = Some(world.actual_path.clone());
    Transition {
        new_state: next,
        effects: vec![
            Effect::InjectCommitPrompt,
            Effect::RecordCompletionAttempt {
                result: CompletionAttemptResultForEffect::PromptSent,
                head: world.snapshot.head.clone(),
                changed_files: world.snapshot.changed_files.clone(),
                attempt_id: None,
            },
        ],
    }
}

fn detect_commit(
    state: &CompletionState,
    world: &CompletionWorld,
    head: String,
    attempt_id: i64,
) -> Transition {
    let mut next = state
        .clone()
        .into_phase(IssueCompletionPhase::ConfirmingContinueAfterCommit);
    next.actual_path = Some(world.actual_path.clone());
    Transition {
        new_state: next,
        effects: vec![Effect::RecordCompletionAttempt {
            result: CompletionAttemptResultForEffect::Completed,
            head,
            changed_files: vec![],
            attempt_id: Some(attempt_id),
        }],
    }
}

fn confirm_continue(state: &CompletionState, world: &CompletionWorld, proceed: bool) -> Transition {
    if proceed {
        let mut next = state
            .clone()
            .into_phase(IssueCompletionPhase::ReconcilingWorktree);
        next.continue_after_commit = Some(true);
        reconcile(&next, world)
    } else {
        let mut next = cancelled(state, world, "user_cancelled_after_commit").new_state;
        next.continue_after_commit = Some(false);
        Transition {
            new_state: next,
            effects: vec![],
        }
    }
}

fn decide_cleanup(state: &CompletionState, world: &CompletionWorld, cleanup: bool) -> Transition {
    let mut next = state
        .clone()
        .into_phase(IssueCompletionPhase::ReconcilingWorktree);
    next.worktree_cleanup_decision = Some(cleanup);
    if cleanup {
        rebase_then_complete(&next, world)
    } else {
        complete(&next, world)
    }
}

/// worktree 对账：缺失 / 分支不一致 / External 删除确认 / 干净完成。
fn reconcile(state: &CompletionState, world: &CompletionWorld) -> Transition {
    // RedWhisk worktree 缺失且分支未合入 → 阻断。
    if world.workspace_missing
        && world.owner == WorktreeOwner::Redwhisk
        && world.missing_worktree_not_closed_out
    {
        return Transition {
            new_state: state.clone().into_phase_with_reason(
                IssueCompletionPhase::Blocked,
                "worktree_missing_not_closed_out",
            ),
            effects: vec![],
        };
    }
    // worktree 且分支不一致 → 按 owner 分流。
    if world.workspace_mode == WorkspaceMode::Worktree
        && !world.workspace_missing
        && world.branch_mismatch
    {
        match world.owner {
            WorktreeOwner::Redwhisk => return rebase_then_complete(state, world),
            WorktreeOwner::External => {
                // 尚无删除确认 → 等待用户决定。
                if state.worktree_cleanup_decision.is_none() {
                    let mut next = state
                        .clone()
                        .into_phase(IssueCompletionPhase::ConfirmingWorktreeCleanup);
                    next.actual_path = Some(world.actual_path.clone());
                    return Transition {
                        new_state: next,
                        effects: vec![],
                    };
                }
                // 已确认不清理 → 直接完成；确认清理由 decide_cleanup 走 rebase 路径。
                return complete(state, world);
            }
        }
    }
    complete(state, world)
}

fn rebase_then_complete(state: &CompletionState, world: &CompletionWorld) -> Transition {
    // 成功路径 provisional 终态 = Completed；rebase 失败时 service 按 on_failure 改写为 Blocked。
    Transition {
        new_state: state.clone().into_phase(IssueCompletionPhase::Completed),
        effects: vec![
            Effect::AttemptRebaseAndCleanup {
                on_failure: FailurePolicy::Block,
            },
            Effect::CommitCompletion {
                snapshot: world.snapshot.clone(),
                option: world.attempt_option,
            },
        ],
    }
}

fn complete(state: &CompletionState, world: &CompletionWorld) -> Transition {
    Transition {
        new_state: state.clone().into_phase(IssueCompletionPhase::Completed),
        effects: vec![Effect::CommitCompletion {
            snapshot: world.snapshot.clone(),
            option: world.attempt_option,
        }],
    }
}

fn cancelled(state: &CompletionState, _world: &CompletionWorld, reason: &str) -> Transition {
    Transition {
        new_state: state
            .clone()
            .into_phase_with_reason(IssueCompletionPhase::Cancelled, reason),
        effects: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean_snapshot() -> GitSnapshot {
        GitSnapshot {
            head: "deadbeef".to_string(),
            status_porcelain: String::new(),
            changed_files: vec![],
            operation_state: GitOperationState::None,
            is_clean: true,
        }
    }

    fn dirty_snapshot() -> GitSnapshot {
        GitSnapshot {
            head: "deadbeef".to_string(),
            status_porcelain: " M src/a.rs".to_string(),
            changed_files: vec![GitChangedFile {
                path: "src/a.rs".to_string(),
                status: "modified".to_string(),
                old_path: None,
            }],
            operation_state: GitOperationState::None,
            is_clean: false,
        }
    }

    fn world_base(snapshot: GitSnapshot) -> CompletionWorld {
        CompletionWorld {
            issue_status: IssueStatus::Review,
            workspace_mode: WorkspaceMode::CurrentBranch,
            workspace_missing: false,
            owner: WorktreeOwner::Redwhisk,
            target_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            branch_mismatch: false,
            actual_path: "/repo".to_string(),
            drifted: false,
            session_closed_out: false,
            missing_worktree_not_closed_out: false,
            snapshot,
            attempt_option: CompletionAttemptOption::CompleteManual,
        }
    }

    fn detecting() -> CompletionState {
        CompletionState::detecting()
    }

    fn assert_phase(transition: &Transition, phase: IssueCompletionPhase) {
        assert_eq!(
            transition.new_state.phase, phase,
            "expected phase {:?}",
            phase
        );
    }

    // ---- Begin / 检测 ----

    #[test]
    fn begin_clean_current_branch_completes() {
        let t = advance(
            &detecting(),
            &world_base(clean_snapshot()),
            CompletionEvent::Begin,
        )
        .unwrap();
        assert_phase(&t, IssueCompletionPhase::Completed);
        assert_eq!(t.effects.len(), 1);
        assert!(matches!(t.effects[0], Effect::CommitCompletion { .. }));
    }

    #[test]
    fn begin_dirty_prompts() {
        let t = advance(
            &detecting(),
            &world_base(dirty_snapshot()),
            CompletionEvent::Begin,
        )
        .unwrap();
        assert_phase(&t, IssueCompletionPhase::PromptingDirtyDecision);
        assert!(t.effects.is_empty());
    }

    #[test]
    fn begin_dirty_but_already_skipped_completes() {
        let mut state = detecting();
        state.ignore_dirty = true;
        let t = advance(
            &state,
            &world_base(dirty_snapshot()),
            CompletionEvent::Begin,
        )
        .unwrap();
        assert_phase(&t, IssueCompletionPhase::Completed);
    }

    #[test]
    fn begin_closed_session_review_current_branch_completes() {
        let mut w = world_base(clean_snapshot());
        w.session_closed_out = true;
        w.issue_status = IssueStatus::Review;
        let t = advance(&detecting(), &w, CompletionEvent::Begin).unwrap();
        assert_phase(&t, IssueCompletionPhase::Completed);
    }

    // ---- DirtyDecided ----

    #[test]
    fn dirty_cancel_cancels() {
        let t = advance(
            &detecting(),
            &world_base(dirty_snapshot()),
            CompletionEvent::DirtyDecided(DirtyWorkspaceOption::Cancel),
        )
        .unwrap();
        assert_phase(&t, IssueCompletionPhase::Cancelled);
    }

    #[test]
    fn dirty_cancel_is_global_from_cleanup_phase() {
        let mut state = detecting();
        state.phase = IssueCompletionPhase::ConfirmingWorktreeCleanup;
        let t = advance(
            &state,
            &world_base(dirty_snapshot()),
            CompletionEvent::DirtyDecided(DirtyWorkspaceOption::Cancel),
        )
        .unwrap();
        assert_phase(&t, IssueCompletionPhase::Cancelled);
    }

    #[test]
    fn dirty_auto_commit_injects_prompt_and_records_attempt() {
        let t = advance(
            &detecting(),
            &world_base(dirty_snapshot()),
            CompletionEvent::DirtyDecided(DirtyWorkspaceOption::AutoCommit),
        )
        .unwrap();
        assert_phase(&t, IssueCompletionPhase::AutoCommitting);
        assert!(matches!(t.effects[0], Effect::InjectCommitPrompt));
        assert!(matches!(
            t.effects[1],
            Effect::RecordCompletionAttempt {
                result: CompletionAttemptResultForEffect::PromptSent,
                attempt_id: None,
                ..
            }
        ));
    }

    #[test]
    fn dirty_skip_completes() {
        let t = advance(
            &detecting(),
            &world_base(dirty_snapshot()),
            CompletionEvent::DirtyDecided(DirtyWorkspaceOption::Skip),
        )
        .unwrap();
        assert_phase(&t, IssueCompletionPhase::Completed);
        assert_eq!(t.new_state.dirty_decision, Some(DirtyWorkspaceOption::Skip));
    }

    #[test]
    fn dirty_auto_commit_rejected_from_cleanup_phase() {
        let mut state = detecting();
        state.phase = IssueCompletionPhase::ConfirmingWorktreeCleanup;
        let res = advance(
            &state,
            &world_base(dirty_snapshot()),
            CompletionEvent::DirtyDecided(DirtyWorkspaceOption::AutoCommit),
        );
        assert!(res.is_err());
    }

    // ---- CommitDetected ----

    #[test]
    fn commit_detected_confirms_continue() {
        let mut state = detecting();
        state.phase = IssueCompletionPhase::AutoCommitting;
        let t = advance(
            &state,
            &world_base(clean_snapshot()),
            CompletionEvent::CommitDetected {
                head: "cafebabe".to_string(),
                attempt_id: 7,
            },
        )
        .unwrap();
        assert_phase(&t, IssueCompletionPhase::ConfirmingContinueAfterCommit);
        match &t.effects[0] {
            Effect::RecordCompletionAttempt {
                result: CompletionAttemptResultForEffect::Completed,
                attempt_id: Some(7),
                head,
                ..
            } => assert_eq!(head, "cafebabe"),
            other => panic!("expected completed attempt record, got {:?}", other),
        }
    }

    #[test]
    fn commit_detected_only_valid_from_auto_committing() {
        let res = advance(
            &detecting(),
            &world_base(clean_snapshot()),
            CompletionEvent::CommitDetected {
                head: "cafebabe".to_string(),
                attempt_id: 7,
            },
        );
        assert!(res.is_err());
    }

    // ---- ContinueConfirmed ----

    #[test]
    fn continue_confirmed_proceeds_to_complete() {
        let mut state = detecting();
        state.phase = IssueCompletionPhase::ConfirmingContinueAfterCommit;
        let t = advance(
            &state,
            &world_base(clean_snapshot()),
            CompletionEvent::ContinueConfirmed { proceed: true },
        )
        .unwrap();
        assert_phase(&t, IssueCompletionPhase::Completed);
    }

    #[test]
    fn continue_confirmed_false_cancels() {
        let mut state = detecting();
        state.phase = IssueCompletionPhase::ConfirmingContinueAfterCommit;
        let t = advance(
            &state,
            &world_base(clean_snapshot()),
            CompletionEvent::ContinueConfirmed { proceed: false },
        )
        .unwrap();
        assert_phase(&t, IssueCompletionPhase::Cancelled);
        assert_eq!(t.new_state.continue_after_commit, Some(false));
    }

    // ---- CleanupDecided ----

    fn worktree_world(owner: WorktreeOwner, mismatch: bool) -> CompletionWorld {
        let mut w = world_base(clean_snapshot());
        w.workspace_mode = WorkspaceMode::Worktree;
        w.owner = owner;
        w.branch_mismatch = mismatch;
        if mismatch {
            w.current_branch = Some("issue-1".to_string());
        }
        w
    }

    #[test]
    fn external_mismatch_prompts_cleanup() {
        let w = worktree_world(WorktreeOwner::External, true);
        let t = advance(&detecting(), &w, CompletionEvent::Begin).unwrap();
        assert_phase(&t, IssueCompletionPhase::ConfirmingWorktreeCleanup);
    }

    #[test]
    fn cleanup_confirmed_rebases_then_completes() {
        let w = worktree_world(WorktreeOwner::External, true);
        let mut state = detecting();
        state.phase = IssueCompletionPhase::ConfirmingWorktreeCleanup;
        let t = advance(
            &state,
            &w,
            CompletionEvent::CleanupDecided { cleanup: true },
        )
        .unwrap();
        assert_phase(&t, IssueCompletionPhase::Completed);
        assert!(matches!(
            t.effects[0],
            Effect::AttemptRebaseAndCleanup {
                on_failure: FailurePolicy::Block
            }
        ));
        assert!(matches!(t.effects[1], Effect::CommitCompletion { .. }));
    }

    #[test]
    fn cleanup_declined_completes_without_rebase() {
        let w = worktree_world(WorktreeOwner::External, true);
        let mut state = detecting();
        state.phase = IssueCompletionPhase::ConfirmingWorktreeCleanup;
        let t = advance(
            &state,
            &w,
            CompletionEvent::CleanupDecided { cleanup: false },
        )
        .unwrap();
        assert_phase(&t, IssueCompletionPhase::Completed);
        assert!(t
            .effects
            .iter()
            .all(|e| !matches!(e, Effect::AttemptRebaseAndCleanup { .. })));
    }

    #[test]
    fn redwhisk_mismatch_rebases_then_completes() {
        let w = worktree_world(WorktreeOwner::Redwhisk, true);
        let t = advance(&detecting(), &w, CompletionEvent::Begin).unwrap();
        assert_phase(&t, IssueCompletionPhase::Completed);
        assert!(matches!(
            t.effects[0],
            Effect::AttemptRebaseAndCleanup {
                on_failure: FailurePolicy::Block
            }
        ));
    }

    #[test]
    fn redwhisk_missing_worktree_blocks() {
        let mut w = worktree_world(WorktreeOwner::Redwhisk, false);
        w.workspace_missing = true;
        w.missing_worktree_not_closed_out = true;
        let t = advance(&detecting(), &w, CompletionEvent::Begin).unwrap();
        assert_phase(&t, IssueCompletionPhase::Blocked);
    }

    // ---- 非法组合 ----

    #[test]
    fn cleanup_decided_rejected_from_detecting() {
        let res = advance(
            &detecting(),
            &world_base(clean_snapshot()),
            CompletionEvent::CleanupDecided { cleanup: true },
        );
        assert!(res.is_err());
    }

    #[test]
    fn begin_rejected_only_from_completed() {
        let mut state = detecting();
        state.phase = IssueCompletionPhase::Completed;
        let res = advance(
            &state,
            &world_base(clean_snapshot()),
            CompletionEvent::Begin,
        );
        assert!(res.is_err());
    }

    #[test]
    fn begin_recovers_from_cancelled() {
        let mut state = detecting();
        state.phase = IssueCompletionPhase::Cancelled;
        let t = advance(
            &state,
            &world_base(clean_snapshot()),
            CompletionEvent::Begin,
        )
        .unwrap();
        assert_phase(&t, IssueCompletionPhase::Completed);
    }
}
