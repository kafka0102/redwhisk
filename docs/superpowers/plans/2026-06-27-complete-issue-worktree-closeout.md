# Issue Worktree Completion Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Issue 标记完成时绕过 Git/worktree 收尾的问题，让所有 completed 入口都经过可恢复的 completion flow。

**Architecture:** 后端以 SQLite 为完成流程事实来源，新增 session 启动快照字段和 `issue_completion_flows` 断点表；Rust Core 统一完成入口，返回前端下一步动作；前端只根据 command 返回展示确认/进度，不直接决定 Issue 完成。Git 收尾改为 worktree 分支 rebase 到目标分支后 fast-forward 合入。

**Tech Stack:** Tauri 2、Rust 2021、rusqlite、React 19、TypeScript、Vitest、SQLite migrations、Git CLI。

## Global Constraints

- 所有 shell 命令必须加 `rtk` 前缀；链式命令每一段都加 `rtk`。
- 说明文字默认使用简体中文；代码标识符、命令、路径保持原样。
- SQLite 表名使用 `snake_case` 复数名词；主键 `id INTEGER PRIMARY KEY`；时间列以 `_at` 结尾并保存 Unix epoch milliseconds。
- 跨 Tauri 边界 DTO 使用 Rust `#[serde(rename_all = "camelCase")]` 与 TypeScript camelCase 类型同步。
- 前端用户可见文案必须国际化，不新增散落硬编码文案。
- 应用不得执行 `git add .`，不得静默提交全部改动；`agent_auto_commit` 只能向 Agent session 注入 prompt。
- `completed` Issue 不提供 Run/Reopen/重新完成主路径；完成前必须写入审计记录。
- 改动 TypeScript/TSX 后必须按顺序运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`，改动运行时行为还必须运行 `pnpm test`。
- 改动 Rust/Tauri/SQLite migration 后必须运行 `rtk cargo test`。
- 最终必须运行 `rtk proxy openspec validate complete-issue-worktree-closeout --strict`。

---

## File Structure

后端新增/修改：

- Create: `src-tauri/migrations/0027_issue_completion_flows.sql`，新增 session metadata 字段和 completion flow 表。
- Modify: `src-tauri/src/db/migrations.rs`，注册 `0027_issue_completion_flows.sql`。
- Create: `src-tauri/src/types/issue_completion.rs`，定义 completion flow phase、request、action/result DTO。
- Create: `src-tauri/src/db/issue_completion_flow_repository.rs`，读写 completion flow 断点。
- Modify: `src-tauri/src/types/mod.rs`，导出新类型模块。
- Modify: `src-tauri/src/db/mod.rs`，导出新 repository。
- Modify: `src-tauri/src/types/agent_session.rs`，为 session record/list row 增加 `origin_branch`、`worktree_owner`。
- Modify: `src-tauri/src/db/agent_session_repository.rs`，同步 SQL select/insert/row mapping。
- Modify: `src-tauri/src/core/agent_session_service.rs`，启动 session 时记录 origin branch 和 worktree owner。
- Modify: `src-tauri/src/git/worktree.rs`，新增 rebase/fast-forward/current worktree helper，并替换普通 merge helper。
- Modify: `src-tauri/src/core/issue_service.rs`，新增统一 completion orchestration，替换 direct completed 写入路径。
- Modify: `src-tauri/src/commands/issue_commands.rs`，新增 unified completion command 并在完成后关闭 runtime session。
- Modify: `src-tauri/src/lib.rs`，注册新增 command。
- Test: `src-tauri/tests/agent_session.rs`、`src-tauri/tests/issue.rs`，必要时新增 `src-tauri/tests/git_worktree.rs` 或在现有 Rust module tests 中补覆盖。

前端新增/修改：

- Modify: `src/features/issues/issue-commands.ts`，新增 completion flow DTO 与 command wrapper。
- Modify: `src/features/issues/issues-activity.tsx`，完成入口改为统一 completion command，新增 manual dirty 和 external worktree 确认。
- Modify: `src/features/agents/agents-session-pane.tsx`，保留 header 的 `Mark done` / split action 入口，但事件最终必须进入统一 flow。
- Modify: `src/features/agents/agents-activity.tsx`，直接完成 Issue 的入口也必须迁移到统一 completion command 或被后端兼容命令重定向，不能继续绕过 flow。
- Modify: `src/shared/i18n/messages.ts`，新增 completion flow 文案。
- Test: `src/features/issues/issues-activity.test.tsx`，覆盖 completed 状态入口和新增弹窗分支。
- Test: `src/features/agents/agents-activity.test.tsx`，覆盖 Agents Activity header 完成入口不再调用旧 completion commands 绕过 flow。

OpenSpec / OneSpec：

- Modify: `openspec/changes/complete-issue-worktree-closeout/tasks.md`，实现完成后勾选任务。
- Modify: `openspec/changes/complete-issue-worktree-closeout/.onespec.yaml`，通过 OneSpec 脚本维护 plan、phase、touched files。

---

### Task 1: Schema And Session Metadata

**Files:**
- Create: `src-tauri/migrations/0027_issue_completion_flows.sql`
- Modify: `src-tauri/src/db/migrations.rs`
- Create: `src-tauri/src/types/issue_completion.rs`
- Create: `src-tauri/src/db/issue_completion_flow_repository.rs`
- Modify: `src-tauri/src/types/mod.rs`
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/types/agent_session.rs`
- Modify: `src-tauri/src/db/agent_session_repository.rs`
- Modify: `src-tauri/src/core/agent_session_service.rs`
- Test: `src-tauri/tests/agent_session.rs`

**Interfaces:**
- Produces enum `WorktreeOwner` in `types::agent_session` with serde snake_case values `redwhisk` and `external`.
- Produces `IssueCompletionFlowRecord`, `IssueCompletionPhase`, `IssueCompletionExternalWorktreeDecision` in `types::issue_completion`.
- Produces repository methods:
  - `IssueCompletionFlowRepository::upsert_in_transaction(transaction, record_input) -> rusqlite::Result<IssueCompletionFlowRecord>`
  - `IssueCompletionFlowRepository::find_by_issue_id_in_transaction(transaction, issue_id) -> rusqlite::Result<Option<IssueCompletionFlowRecord>>`
  - `IssueCompletionFlowRepository::clear_in_transaction(transaction, issue_id) -> rusqlite::Result<()>`
- Later tasks consume `AgentSessionRecord.origin_branch`, `AgentSessionRecord.worktree_owner`, and flow repository methods.

- [ ] **Step 1: Add the migration**

Create `src-tauri/migrations/0027_issue_completion_flows.sql` with:

```sql
ALTER TABLE agent_sessions ADD COLUMN origin_branch TEXT;
ALTER TABLE agent_sessions ADD COLUMN worktree_owner TEXT NOT NULL DEFAULT 'external'
CHECK (worktree_owner IN ('redwhisk', 'external'));

UPDATE agent_sessions
SET origin_branch = COALESCE(target_branch, workspace_branch, ''),
    worktree_owner = CASE
      WHEN workspace_mode = 'worktree'
       AND workspace_path IS NOT NULL
       AND workspace_branch IS NOT NULL
      THEN 'redwhisk'
      ELSE 'external'
    END;

CREATE TABLE IF NOT EXISTS issue_completion_flows (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES agent_sessions(id) ON DELETE SET NULL,
  phase TEXT NOT NULL CHECK (phase IN (
    'checking_dirty',
    'waiting_agent_commit',
    'manual_dirty_blocked',
    'checking_branch',
    'confirming_external_worktree',
    'rebasing',
    'agent_merge_blocked',
    'completed'
  )),
  ignore_dirty INTEGER NOT NULL DEFAULT 0 CHECK (ignore_dirty IN (0, 1)),
  external_worktree_decision TEXT CHECK (
    external_worktree_decision IS NULL
    OR external_worktree_decision IN ('merge_and_delete', 'skip', 'cancel')
  ),
  base_branch TEXT,
  workspace_branch TEXT,
  workspace_path TEXT,
  failure_reason TEXT,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_completion_flows_issue_id
ON issue_completion_flows(issue_id);
```

- [ ] **Step 2: Add Rust flow types**

In `src-tauri/src/db/migrations.rs`, add a const and include it in the default migration list:

```rust
const MIGRATION_0027_ISSUE_COMPLETION_FLOWS: &str =
    include_str!("../../migrations/0027_issue_completion_flows.sql");
```

Add the matching `Migration { version: 27, name: "issue_completion_flows", sql: MIGRATION_0027_ISSUE_COMPLETION_FLOWS }` entry after version 26. Use the exact local `Migration` struct style in the file.

- [ ] **Step 3: Add Rust flow types**

Create `src-tauri/src/types/issue_completion.rs` with exported structs/enums:

```rust
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
```

Then export it from `src-tauri/src/types/mod.rs`:

```rust
pub mod issue_completion;
```

- [ ] **Step 4: Add the flow repository**

Create `src-tauri/src/db/issue_completion_flow_repository.rs`. Follow `completion_attempt_repository.rs` style: explicit SQL, `params!`, row mapper, string-to-enum helpers returning `rusqlite::Error::InvalidQuery`.

Export it from `src-tauri/src/db/mod.rs`:

```rust
pub mod issue_completion_flow_repository;
```

- [ ] **Step 5: Add session metadata types**

In `src-tauri/src/types/agent_session.rs`, add:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeOwner {
    Redwhisk,
    External,
}

impl WorktreeOwner {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Redwhisk => "redwhisk",
            Self::External => "external",
        }
    }
}
```

Add `origin_branch: Option<String>` and `worktree_owner: WorktreeOwner` to `AgentSessionListItem` and `AgentSessionRecord`.

- [ ] **Step 6: Update session repository mapping**

Update every `SELECT` in `src-tauri/src/db/agent_session_repository.rs` to include `origin_branch, worktree_owner` after `workspace_path`. Update `AgentSessionListRow`, `AgentSessionRecord` mapping, and `insert_in_transaction` signature to accept `origin_branch: Option<&str>` and `worktree_owner: WorktreeOwner`.

Use helper:

```rust
fn worktree_owner_from_str(value: &str) -> rusqlite::Result<WorktreeOwner> {
    match value {
        "redwhisk" => Ok(WorktreeOwner::Redwhisk),
        "external" => Ok(WorktreeOwner::External),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}
```

- [ ] **Step 7: Record metadata at session launch**

In `src-tauri/src/core/agent_session_service.rs`, extend `SessionLaunchContext` with:

```rust
origin_branch: Option<String>,
worktree_owner: WorktreeOwner,
```

For `WorkspaceMode::CurrentBranch`, set `origin_branch` to `Some(branch_info.current_branch.clone())` and `worktree_owner` to `WorktreeOwner::External`.

For `WorkspaceMode::Worktree`, set `origin_branch` to `Some(branch_info.current_branch.clone())` and `worktree_owner` to `WorktreeOwner::Redwhisk`.

Pass these fields into both structured and PTY `AgentSessionRepository::insert_in_transaction` call sites.

- [ ] **Step 8: Add metadata tests**

In `src-tauri/tests/agent_session.rs`, add or update tests so current branch mode asserts:

```rust
assert_eq!(session.origin_branch.as_deref(), Some("main"));
assert_eq!(session.worktree_owner, WorktreeOwner::External);
```

And worktree mode asserts:

```rust
assert_eq!(session.origin_branch.as_deref(), Some("main"));
assert_eq!(session.worktree_owner, WorktreeOwner::Redwhisk);
```

- [ ] **Step 9: Run focused Rust tests**

Run:

```bash
rtk cargo test agent_session
```

Expected: tests compile and all `agent_session` tests pass.

- [ ] **Step 10: Commit Task 1**

Stage only Task 1 files:

```bash
rtk git add src-tauri/migrations/0027_issue_completion_flows.sql src-tauri/src/db/migrations.rs src-tauri/src/types/issue_completion.rs src-tauri/src/db/issue_completion_flow_repository.rs src-tauri/src/types/mod.rs src-tauri/src/db/mod.rs src-tauri/src/types/agent_session.rs src-tauri/src/db/agent_session_repository.rs src-tauri/src/core/agent_session_service.rs src-tauri/tests/agent_session.rs
rtk git commit -m "feat: 记录 issue 完成流程元数据"
```

### Task 2: Git Rebase Worktree Helpers

**Files:**
- Modify: `src-tauri/src/git/worktree.rs`
- Test: `src-tauri/src/git/worktree.rs` module tests, or `src-tauri/tests/issue.rs` if integration setup is already easier.

**Interfaces:**
- Produces:
  - `current_branch(repo_path) -> Result<String, GitWorktreeError>`
  - `is_additional_worktree(repo_path) -> Result<bool, GitWorktreeError>`
  - `rebase_branch_onto(repo_path, branch, base_branch) -> Result<(), GitWorktreeError>`
  - `fast_forward_branch(repo_path, target_branch, source_branch) -> Result<(), GitWorktreeError>`
  - `rebase_and_fast_forward(repo_path, worktree_path, target_branch, workspace_branch) -> Result<(), GitWorktreeError>`
- Later tasks replace `merge_branch_into_target` with `rebase_and_fast_forward`.

- [ ] **Step 1: Write Git helper tests first**

Add tests that create temp repos using `git init`, config local user, commit base files, create branches, and assert:

```rust
assert!(is_additional_worktree(&worktree_path).expect("detect worktree"));
rebase_and_fast_forward(&repo_dir, &worktree_path, "main", "issue-1").expect("rebase and ff");
assert!(is_branch_merged(&repo_dir, "main", "issue-1").expect("merged"));
```

Add a conflict test where `rebase_and_fast_forward` returns `GitWorktreeError::GitCommandFailed` and leaves the worktree path existing.

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
rtk cargo test git::worktree
```

Expected before implementation: tests fail because helpers do not exist.

- [ ] **Step 3: Implement helpers**

In `worktree.rs`, reuse `run_git` and `Command`. Implement:

```rust
pub fn current_branch(repo_path: impl AsRef<Path>) -> Result<String, GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    run_git(&repo_path, &["branch", "--show-current"])
}
```

Use `git rev-parse --path-format=absolute --git-dir` and `--git-common-dir` for `is_additional_worktree`; compare trimmed outputs and return false for equal paths.

For rebase:

```rust
pub fn rebase_branch_onto(
    repo_path: impl AsRef<Path>,
    branch: &str,
    base_branch: &str,
) -> Result<(), GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    run_git(&repo_path, &["checkout", branch])?;
    run_git(&repo_path, &["rebase", base_branch])?;
    Ok(())
}
```

For fast-forward:

```rust
pub fn fast_forward_branch(
    repo_path: impl AsRef<Path>,
    target_branch: &str,
    source_branch: &str,
) -> Result<(), GitWorktreeError> {
    let repo_path = ensure_repo_dir(repo_path.as_ref())?;
    let original_branch = run_git(&repo_path, &["branch", "--show-current"])?;
    run_git(&repo_path, &["checkout", target_branch])?;
    let result = run_git(&repo_path, &["merge", "--ff-only", source_branch]);
    let _ = run_git(&repo_path, &["checkout", &original_branch]);
    result.map(|_| ())
}
```

For `rebase_and_fast_forward`, run rebase in `worktree_path`, then fast-forward in `repo_path`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
rtk cargo test git::worktree
```

Expected: new helper tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
rtk git add src-tauri/src/git/worktree.rs
rtk git commit -m "feat: 支持 worktree rebase 式合入"
```

### Task 3: Backend Completion Orchestration

**Files:**
- Modify: `src-tauri/src/core/issue_service.rs`
- Modify: `src-tauri/src/commands/issue_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/types/issue.rs`
- Modify: `src-tauri/src/types/issue_completion.rs`
- Modify: `src-tauri/src/db/issue_completion_flow_repository.rs`
- Test: `src-tauri/tests/issue.rs`

**Interfaces:**
- Produces command `complete_issue_flow(input: CompleteIssueFlowInput) -> CompleteIssueFlowResult`.
- Consumes Task 1 `IssueCompletionFlowRepository` and Task 2 `rebase_and_fast_forward`.
- Existing commands `complete_issue_manual`, `complete_issue_clean`, and `detect_agent_commit_completion` must either delegate into the same orchestration or return a validation error instructing callers to use `complete_issue_flow`; they must not keep independent code paths that can skip flow state/worktree handling.

- [ ] **Step 1: Add failing backend tests**

In `src-tauri/tests/issue.rs`, add tests for these behaviors:

1. A review issue with closed or stopped linked session still calls completion flow and does not use `advance_issue_status` direct completion.
2. Manual dirty workspace returns action `ManualDirtyPrompt`, persists `manual_dirty_blocked`, and leaves Issue in `review`.
3. Manual dirty with `ignore_dirty: Some(true)` continues to completion for current branch.
4. Auto-commit dirty returns `WaitingAgentCommit`, writes `completion_attempts` with `agent_auto_commit` / `prompt_sent`, and leaves Issue in `review`.
5. Existing pending auto-commit attempt followed by new commit resumes and completes.
6. RedWhisk worktree clean path rebases, fast-forwards target branch, deletes worktree, deletes temporary branch, and completes Issue.
7. Rebase conflict returns `AgentMergeBlocked`, persists `agent_merge_blocked`, and leaves worktree path existing.
8. External worktree returns `ConfirmExternalWorktree` before merge; decision `skip` completes without cleanup; decision `cancel` pauses without completion.
9. `complete_issue_manual`, `complete_issue_clean`, and `detect_agent_commit_completion` cannot complete a linked issue through a path that bypasses `issue_completion_flows`.

Use existing helpers such as `init_repo`, `write_file`, `git`, `insert_project_with_repo_path_and_policy`, and `insert_agent_session_for_issue`.

- [ ] **Step 2: Add command DTO imports and adapter**

In `src-tauri/src/commands/issue_commands.rs`, import:

```rust
use crate::types::issue_completion::{
    CompleteIssueFlowInput, CompleteIssueFlowResult,
};
```

Add command:

```rust
#[tauri::command]
pub fn complete_issue_flow(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CompleteIssueFlowInput,
) -> Result<CompleteIssueFlowResult, CommandError> {
    let data_dir = prepare_issue_data_dir(&app, &state)?;
    let result = IssueService::complete_issue_flow_in_data_dir(
        data_dir,
        input,
        &state.pty_sessions,
        &state.agent_sessions,
    )?;
    if result.action == crate::types::issue_completion::CompleteIssueFlowAction::Completed {
        shutdown_closed_issue_session(&state, &result.issue);
    }
    Ok(result)
}
```

Register `commands::issue_commands::complete_issue_flow` in `src-tauri/src/lib.rs`.

- [ ] **Step 3: Implement service entry points**

In `IssueService`, add:

```rust
pub fn complete_issue_flow(
    &self,
    input: CompleteIssueFlowInput,
    data_dir: impl AsRef<Path>,
    pty_sessions: &PtySessionManager,
    agent_registry: &AgentSessionRegistry,
) -> Result<CompleteIssueFlowResult, CommandError>
```

and static wrapper:

```rust
pub fn complete_issue_flow_in_data_dir(
    data_dir: impl AsRef<Path>,
    input: CompleteIssueFlowInput,
    pty_sessions: &PtySessionManager,
    agent_registry: &AgentSessionRegistry,
) -> Result<CompleteIssueFlowResult, CommandError>
```

This method must load project, issue, and linked session via `AgentSessionRepository::find_by_issue_id` when no running session exists, because completed status changes for inactive linked sessions still require checks.

- [ ] **Step 4: Implement dirty handling**

Read Git snapshot from `session.working_dir`, not `project.repo_path`.

If `operation_state != GitOperationState::None`, record `CompletionAttemptResult::GitOperationBlocked` when there is a session and return `GitOperationBlocked`.

If dirty and effective `completion_policy` is `ProjectCompletionPolicy::Manual` and `input.ignore_dirty != Some(true)`, upsert flow:

```rust
phase = IssueCompletionPhase::ManualDirtyBlocked
ignore_dirty = false
```

Return `CompleteIssueFlowAction::ManualDirtyPrompt`.

If dirty and policy is `AgentAutoCommit`, inject the same completion prompt path used by `send_agent_commit_prompt`; write a `CompletionAttemptOption::AgentAutoCommit` attempt with `PromptSent`; upsert `WaitingAgentCommit`; return `WaitingAgentCommit`.

- [ ] **Step 5: Implement auto-commit resume**

If there is a latest pending auto-commit attempt, compare `attempt.head_before` with current snapshot from `session.working_dir` using `detect_commit_result`. On `NewCommit`, update attempt to `Completed` with commit hash and continue branch/worktree handling. On `NoCommitDetected`, return `NoCommitDetected` and keep Issue not completed. On operation blocked, update attempt to `GitOperationBlocked` and return `GitOperationBlocked`.

- [ ] **Step 6: Implement branch/worktree handling**

Use `session.origin_branch` as the original branch. If current branch from `session.working_dir` equals origin branch, complete without worktree cleanup.

If `session.workspace_mode == WorkspaceMode::Worktree` and `session.worktree_owner == WorktreeOwner::Redwhisk`, run `rebase_and_fast_forward(project.repo_path, session.workspace_path, target_branch, workspace_branch)`, then `cleanup_worktree`. On failure, upsert `AgentMergeBlocked` and return `AgentMergeBlocked` with target/workspace details.

If `session.worktree_owner == WorktreeOwner::External` and no decision, upsert `ConfirmingExternalWorktree` and return `ConfirmExternalWorktree`. If decision is `Skip`, skip merge/cleanup and complete. If `Cancel`, persist `ConfirmingExternalWorktree` and return `ConfirmExternalWorktree` with message saying completion is paused. If `MergeAndDelete`, run the same rebase/ff/cleanup flow.

- [ ] **Step 7: Complete and audit atomically**

When completing, in one transaction:

- Mark issue completed using `complete_review_issue_manually_in_transaction` when issue is `review` with linked session; use `complete_issue_without_review_in_transaction` for inactive linked-session status paths that are not in `review`.
- Mark linked session `Closed` when it is not already closed.
- Insert `IssueActionType::IssueCompleted`.
- Insert `SessionEventType::SessionClosed` if a session was newly closed.
- Insert or update a `CompletionAttempt` with result `Completed`.
- Clear `issue_completion_flows` for this issue.

- [ ] **Step 8: Stop direct completed bypass**

In `advance_issue_status_with_transaction`, reject or avoid direct `IssueStatus::Completed` completion for linked sessions. The returned error should instruct callers to use `complete_issue_flow`, for example:

```rust
CommandError::new(
    CommandErrorCode::IssueValidationFailed,
    "Issue 完成必须通过完成流程执行。",
)
```

Do not block unrelated non-linked historical transitions if tests require them, but any linked session path must not bypass completion flow.

- [ ] **Step 9: Run backend tests**

Run:

```bash
rtk cargo test issue
```

Expected: new issue completion tests pass.

- [ ] **Step 10: Commit Task 3**

```bash
rtk git add src-tauri/src/core/issue_service.rs src-tauri/src/commands/issue_commands.rs src-tauri/src/lib.rs src-tauri/src/types/issue.rs src-tauri/src/types/issue_completion.rs src-tauri/src/db/issue_completion_flow_repository.rs src-tauri/tests/issue.rs
rtk git commit -m "feat: 统一 issue 完成收尾流程"
```

### Task 4: Frontend Completion Flow UI

**Files:**
- Modify: `src/features/issues/issue-commands.ts`
- Modify: `src/features/issues/issues-activity.tsx`
- Modify: `src/features/agents/agents-session-pane.tsx`
- Modify: `src/features/agents/agents-activity.tsx`
- Modify: `src/shared/i18n/messages.ts`
- Test: `src/features/issues/issues-activity.test.tsx`
- Test: `src/features/agents/agents-activity.test.tsx`

**Interfaces:**
- Consumes backend command `complete_issue_flow`.
- Produces TypeScript wrapper `completeIssueFlow(input: CompleteIssueFlowInput): Promise<CompleteIssueFlowResult>`.

- [ ] **Step 1: Add TypeScript DTOs**

In `issue-commands.ts`, add:

```ts
export type IssueCompletionExternalWorktreeDecision =
  | "merge_and_delete"
  | "skip"
  | "cancel";

export type CompleteIssueFlowAction =
  | "completed"
  | "manual_dirty_prompt"
  | "waiting_agent_commit"
  | "confirm_external_worktree"
  | "agent_merge_blocked"
  | "no_commit_detected"
  | "git_operation_blocked";

export interface CompleteIssueFlowInput {
  projectId: number;
  issueId: number;
  ignoreDirty?: boolean | null;
  externalWorktreeDecision?: IssueCompletionExternalWorktreeDecision | null;
}

export interface CompleteIssueFlowResult {
  action: CompleteIssueFlowAction;
  issue: IssueRecord;
  flow?: {
    id: number;
    issueId: number;
    sessionId?: number | null;
    phase: string;
    ignoreDirty: boolean;
    externalWorktreeDecision?: IssueCompletionExternalWorktreeDecision | null;
    baseBranch?: string | null;
    workspaceBranch?: string | null;
    workspacePath?: string | null;
    failureReason?: string | null;
    updatedAt: number;
  } | null;
  message: string;
  targetBranch?: string | null;
  workspaceBranch?: string | null;
  workspacePath?: string | null;
  sessionId?: number | null;
}
```

Add:

```ts
export function completeIssueFlow(
  input: CompleteIssueFlowInput,
): Promise<CompleteIssueFlowResult> {
  return invokeCommand<CompleteIssueFlowResult>("complete_issue_flow", {
    input,
  });
}
```

- [ ] **Step 2: Add i18n messages**

In `src/shared/i18n/messages.ts`, add issue messages:

```ts
completionDirtyTitle: string;
completionDirtyMessage: string;
completionIgnoreDirty: string;
completionHandleManually: string;
completionExternalWorktreeTitle: string;
completionExternalWorktreeMessage: (branch: string) => string;
completionMergeAndDelete: string;
completionSkipMerge: string;
completionCancel: string;
completionWaitingAgentCommit: string;
completionNoCommitDetected: string;
completionGitOperationBlocked: string;
completionAgentMergeBlocked: string;
```

Provide English and Chinese values.

- [ ] **Step 3: Replace completion calls in IssuesActivity**

In `issues-activity.tsx`, import `completeIssueFlow` and replace `completeIssueWithCompletionChecks` internals so it calls:

```ts
const result = await completeIssueFlow({
  projectId: requestProjectId,
  issueId,
});
```

Then route on `result.action`:

- `completed`: return `result.issue`.
- `manual_dirty_prompt`: show a confirmation dialog with buttons for ignore and manual handling. Ignore calls `completeIssueFlow({ projectId, issueId, ignoreDirty: true })`; manual handling throws `CompletionCancelledError`.
- `waiting_agent_commit`: show waiting progress, then call `completeIssueFlow` again to detect/resume.
- `confirm_external_worktree`: show three-option dialog; call `completeIssueFlow` with `externalWorktreeDecision`.
- `agent_merge_blocked`: use existing `handOffWorktreeMergeConflict` with result details.
- `no_commit_detected` / `git_operation_blocked`: throw `new Error(result.message)`.

Do not call `advanceIssueStatus` for `targetStatus === "completed"`, even when the linked session is closed or stopped.

In `src/features/agents/agents-activity.tsx`, replace direct `completeIssueManual` / `completeIssueClean` completion calls with `completeIssueFlow` where the UI marks an issue complete. If Agents Activity does not have enough UI surface for manual dirty/external worktree decisions, route the user to the linked Issue detail and show a clear localized error from the backend instead of completing directly.

If `agents-session-pane.tsx` exposes split-action labels or disabled-state text for completion, keep its public props stable unless tests require a type update; the stateful completion branching belongs in `agents-activity.tsx`.

For external worktree three-way confirmation, do not force it through `useConfirmDialog` because that hook is two-option only. Add a local feature-level dialog inside `issues-activity.tsx` or `agents-activity.tsx` with three explicit buttons backed by i18n messages:

```ts
type ExternalWorktreeDialogState = {
  issueId: number;
  targetBranch?: string | null;
  workspaceBranch?: string | null;
  workspacePath?: string | null;
};
```

The three buttons must call `completeIssueFlow` with `merge_and_delete`, `skip`, or `cancel` respectively.

- [ ] **Step 4: Update progress steps**

Update `CompletionProgressStepId` and `buildCompletionProgressSteps` to include `rebasing` and `applying` instead of the old generic `merging` wording. Keep stable dimensions and current dialog structure.

- [ ] **Step 5: Add frontend tests**

In `issues-activity.test.tsx`:

- Replace mocks for completed inactive issue so it expects `completeIssueFlow`, not `advanceIssueStatus`.
- Add a test where `completeIssueFlow` returns `manual_dirty_prompt`; assert dirty dialog appears and clicking ignore calls `completeIssueFlow` with `ignoreDirty: true`.
- Add a test where user chooses manual handling; assert issue remains not completed and no second completion call is made.
- Add a test where `confirm_external_worktree` appears; assert the three actions call decisions `merge_and_delete`, `skip`, and cancel behavior as separate cases or table cases.
- Add a test where `agent_merge_blocked` routes to the linked Agent session.
- Add or update `agents-activity.test.tsx` tests:
  - `shows the manual completion action on review header...`
  - `shows agent commit action for dirty review sessions...`
  - `marks a dirty review session done directly...`
  - `detects agent commit completion after sending prompt...`
  Replace old command expectations so they assert `completeIssueFlow` is used and `completeIssueManual` / `completeIssueClean` are not used for completion success.

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
rtk pnpm test -- src/features/issues/issues-activity.test.tsx
```

Expected: Issues Activity tests pass.

- [ ] **Step 7: Commit Task 4**

```bash
rtk git add src/features/issues/issue-commands.ts src/features/issues/issues-activity.tsx src/features/agents/agents-session-pane.tsx src/features/agents/agents-activity.tsx src/shared/i18n/messages.ts src/features/issues/issues-activity.test.tsx src/features/agents/agents-activity.test.tsx
rtk git commit -m "feat: 接入 issue 完成流程交互"
```

### Task 5: OpenSpec Backfill And Full Verification

**Files:**
- Modify: `openspec/changes/complete-issue-worktree-closeout/tasks.md`
- Modify: `openspec/changes/complete-issue-worktree-closeout/.onespec.yaml`
- Modify: `openspec/changes/complete-issue-worktree-closeout/design.md` only when the implemented behavior intentionally differs from the approved design, and explain that design update in the final review report.
- Test: full validation commands.

**Interfaces:**
- Consumes all previous task commits.
- Produces review-ready branch with OpenSpec tasks checked.

- [ ] **Step 1: Review implementation against OpenSpec**

Read:

```bash
rtk read openspec/changes/complete-issue-worktree-closeout/tasks.md
rtk read openspec/changes/complete-issue-worktree-closeout/specs/issue-execution-worktree/spec.md
rtk read openspec/changes/complete-issue-worktree-closeout/specs/issues-ui/spec.md
```

Confirm every scenario has implementation or test evidence.

- [ ] **Step 2: Update OpenSpec task checkboxes**

Edit `openspec/changes/complete-issue-worktree-closeout/tasks.md` so completed tasks are `[x]`. Only mark tasks complete if code, tests, and reviews for that task passed.

- [ ] **Step 3: Track touched files**

Run OneSpec tracking from the implementation worktree:

```bash
ONESPEC_ENV="${ONESPEC_ENV:-$(find . "$HOME"/.codex "$HOME"/.claude "$HOME"/.cursor "$HOME"/.gemini "$HOME"/.copilot "$HOME"/.agents "$HOME"/.config -path '*/onespec/scripts/onespec-env.sh' -type f -print -quit 2>/dev/null)}"
. "$ONESPEC_ENV"
"$ONESPEC_BASH" "$ONESPEC_COMMIT" track complete-issue-worktree-closeout src-tauri/migrations/0027_issue_completion_flows.sql src-tauri/src/db/migrations.rs src-tauri/src/types/issue_completion.rs src-tauri/src/db/issue_completion_flow_repository.rs src-tauri/src/types/mod.rs src-tauri/src/db/mod.rs src-tauri/src/types/agent_session.rs src-tauri/src/db/agent_session_repository.rs src-tauri/src/core/agent_session_service.rs src-tauri/src/git/worktree.rs src-tauri/src/core/issue_service.rs src-tauri/src/commands/issue_commands.rs src-tauri/src/lib.rs src-tauri/tests/agent_session.rs src-tauri/tests/issue.rs src/features/issues/issue-commands.ts src/features/issues/issues-activity.tsx src/features/agents/agents-activity.tsx src/shared/i18n/messages.ts src/features/issues/issues-activity.test.tsx openspec/changes/complete-issue-worktree-closeout/tasks.md
```

- [ ] **Step 4: Run mandatory formatting and checks**

Run in this exact order:

```bash
rtk pnpm format
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm test
rtk cargo test
rtk proxy openspec validate complete-issue-worktree-closeout --strict
```

Run `rtk cargo test` from `src-tauri`.

- [ ] **Step 5: Commit final OpenSpec backfill**

```bash
rtk git add openspec/changes/complete-issue-worktree-closeout/tasks.md openspec/changes/complete-issue-worktree-closeout/.onespec.yaml
rtk git commit -m "docs: 回填 issue 完成流程任务状态"
```

- [ ] **Step 6: Set review phase**

Run:

```bash
ONESPEC_ENV="${ONESPEC_ENV:-$(find . "$HOME"/.codex "$HOME"/.claude "$HOME"/.cursor "$HOME"/.gemini "$HOME"/.copilot "$HOME"/.agents "$HOME"/.config -path '*/onespec/scripts/onespec-env.sh' -type f -print -quit 2>/dev/null)}"
. "$ONESPEC_ENV"
"$ONESPEC_BASH" "$ONESPEC_STATE" set complete-issue-worktree-closeout phase review
"$ONESPEC_BASH" "$ONESPEC_HANDOFF" complete-issue-worktree-closeout review --write
```

Expected: OneSpec state shows `phase: review`.
