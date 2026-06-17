# Agent Worktree Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 agent profile 和 issue run 流程增加 worktree 执行配置，并在 Rust 运行时实现 worktree 创建、分支派生、完成时 merge-back 与清理。

**Architecture:** 前端新增两处执行上下文入口：Settings Agents 的 `Worktree path` 与 Issue Run Dialog 的 `Commit strategy` / `开发模式` / `目标分支`。后端通过 migration 扩展 `agent_profiles` 与 `agent_sessions`，新增最小 `git/worktree` 模块，把一次运行的 workspace context 持久化到 session，并在 completion 流程中读取该快照执行 merge-back 和 cleanup。

**Tech Stack:** React 19 + Vitest、Tauri 2、Rust + rusqlite、git CLI

---

## File Map

- Modify: `src/features/settings/agent-profile-form.tsx`
  负责 agent profile 表单新增 `Worktree path` 字段、默认值和前端校验。
- Modify: `src/features/settings/project-settings-activity.tsx`
  把当前项目 `projectPath` 传给 `AgentProfileForm`。
- Modify: `src/features/settings/settings-commands.ts`
  扩展 agent profile 类型和保存入参。
- Modify: `src/features/issues/issue-run-dialog.tsx`
  新增 `Commit strategy`、`开发模式`、`目标分支` UI 与 localStorage 记忆。
- Modify: `src/features/issues/issue-commands.ts`
  扩展 `startAgentSession` 入参，并新增 git 分支查询命令类型。
- Modify: `src/shared/commands/command-client.test.ts`
  覆盖新增命令参数与新命令调用。
- Modify: `src/features/settings/project-settings-activity.test.tsx`
  覆盖 worktree path 默认值、自定义路径校验和保存。
- Modify: `src/features/issues/issues-activity.test.tsx`
  覆盖 run dialog 的 commit strategy、mode、branch 行为与启动参数。
- Create: `src-tauri/migrations/0022_agent_worktree_execution.sql`
  扩展 `agent_profiles` 和 `agent_sessions` schema。
- Modify: `src-tauri/src/db/migrations.rs`
  注册 `0022` migration。
- Modify: `src-tauri/src/types/agent_profile.rs`
  增加 `worktree_path` 字段。
- Modify: `src-tauri/src/db/agent_profile_repository.rs`
  读写 `worktree_path`。
- Modify: `src-tauri/src/core/settings_service.rs`
  实现后端 worktree path 校验。
- Modify: `src-tauri/src/types/agent_session.rs`
  扩展 `StartAgentSessionInput` 与 session record。
- Modify: `src-tauri/src/db/agent_session_repository.rs`
  持久化 session execution context。
- Create: `src-tauri/src/git/worktree.rs`
  本地分支查询、worktree 创建、临时分支派生、merge/back cleanup。
- Modify: `src-tauri/src/git/mod.rs`
  导出新 worktree 模块。
- Modify: `src-tauri/src/core/agent_session_service.rs`
  启动阶段解析 workspace mode，必要时创建 worktree。
- Modify: `src-tauri/src/core/issue_service.rs`
  completion 阶段按 session context 执行 merge-back 和 cleanup。
- Modify: `src-tauri/src/commands/agent_session_commands.rs`
  暴露扩展后的启动命令。
- Modify: `src-tauri/src/commands/settings_commands.rs`
  若需要单独路径校验命令，在此层接线。
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`
  注册 git 分支查询命令。
- Create or Modify: `src-tauri/src/types/project_git.rs` 或就近放在现有 types 文件
  定义 git 分支查询返回结构。
- Modify: `src-tauri/tests/settings.rs`
  覆盖 settings migration、save_agent_profile 的 worktree path 规则。
- Modify: `src-tauri/tests/agent_session.rs`
  覆盖 start session 的 current-branch/worktree 两种路径。
- Modify: `src-tauri/tests/issue.rs`（若存在）或补到现有 issue 测试文件
  覆盖 merge-back、冲突、cleanup 失败。

## Task 1: 扩展 agent profile 的持久化模型与前端表单

**Files:**
- Create: `src-tauri/migrations/0022_agent_worktree_execution.sql`
- Modify: `src-tauri/src/db/migrations.rs`
- Modify: `src-tauri/src/types/agent_profile.rs`
- Modify: `src-tauri/src/db/agent_profile_repository.rs`
- Modify: `src-tauri/src/core/settings_service.rs`
- Modify: `src/features/settings/settings-commands.ts`
- Modify: `src/features/settings/agent-profile-form.tsx`
- Modify: `src/features/settings/project-settings-activity.tsx`
- Test: `src/features/settings/project-settings-activity.test.tsx`
- Test: `src-tauri/tests/settings.rs`

- [ ] **Step 1: 为 migration 和 settings service 写失败测试**

在 `src-tauri/tests/settings.rs` 增加测试：

```rust
#[test]
fn settings_migration_adds_worktree_path_column() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path()).open().expect("database");
    MigrationRunner::default().run(&database.connection).expect("migrations");

    let profile_columns = table_columns(&database.connection, "agent_profiles");
    assert!(profile_columns.contains(&"worktree_path".to_string()));
}

#[test]
fn save_agent_profile_rejects_missing_custom_worktree_path() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo");
    let service = settings_service(
        &database.connection,
        StubCommandDetector::with_test_result("codex", Ok("/usr/local/bin/codex")),
    );

    let error = service
        .save_agent_profile(SaveAgentProfileInput {
            id: None,
            name: "Codex".to_string(),
            agent_type: AgentType::Codex,
            command: "codex".to_string(),
            scope: AgentScope::Project,
            project_id: Some(project_id),
            mode: "default".to_string(),
            dangerous: true,
            default_skill: "".to_string(),
            prompt_template: "".to_string(),
            worktree_path: "/path/does/not/exist".to_string(),
        })
        .expect_err("missing custom worktree path should fail");

    assert_eq!(error.code, CommandErrorCode::AgentProfileValidationFailed);
}
```

- [ ] **Step 2: 运行 Rust settings 测试并确认失败**

Run:
```bash
cargo test --manifest-path src-tauri/Cargo.toml settings -- --nocapture
```

Expected: FAIL，提示 `worktree_path` 字段缺失或 `SaveAgentProfileInput` 字段不匹配。

- [ ] **Step 3: 实现 migration、类型和 repository 最小变更**

在 `src-tauri/migrations/0022_agent_worktree_execution.sql` 写入：

```sql
ALTER TABLE agent_profiles ADD COLUMN worktree_path TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_sessions ADD COLUMN workspace_mode TEXT NOT NULL DEFAULT 'current_branch';
ALTER TABLE agent_sessions ADD COLUMN target_branch TEXT;
ALTER TABLE agent_sessions ADD COLUMN workspace_branch TEXT;
ALTER TABLE agent_sessions ADD COLUMN workspace_path TEXT;
ALTER TABLE agent_sessions ADD COLUMN completion_policy TEXT;
ALTER TABLE agent_sessions ADD COLUMN worktree_root_path TEXT;
```

在 `src-tauri/src/types/agent_profile.rs` 增加：

```rust
pub worktree_path: String,
```

并同步更新 `AgentProfileRecord` 与 `SaveAgentProfileInput`。

在 `src-tauri/src/db/agent_profile_repository.rs` 所有 SQL 的 select / insert / update 增加 `worktree_path`。

- [ ] **Step 4: 在 settings service 实现 worktree path 校验**

在 `src-tauri/src/core/settings_service.rs` 中：

```rust
let worktree_path = validate_worktree_path(
    input.worktree_path.trim(),
    input.project_id,
    &self.project_repository,
)?;
```

要求：
- project profile 且值等于 `<repo_path>.worktrees` 时允许目录不存在
- 非默认值时必须 `Path::new(...).is_dir()`
- global profile 无 project repo 时仅做 trim 和空字符串容忍

- [ ] **Step 5: 为前端表单写失败测试**

在 `src/features/settings/project-settings-activity.test.tsx` 增加用例：

```tsx
it("prefills worktree path from the current project repo path", async () => {
  // 打开 New agent
  expect(screen.getByLabelText("Worktree path")).toHaveValue(
    "/Users/kafka0102/workspace/kafka/redwhisk.worktrees",
  );
});

it("blocks save when a custom worktree path does not exist", async () => {
  // 输入自定义不存在路径
  // 断言 Save disabled 且出现错误文本
});
```

- [ ] **Step 6: 实现前端表单最小逻辑**

在 `src/features/settings/project-settings-activity.tsx` 传入：

```tsx
projectPath={projectPath}
```

在 `src/features/settings/agent-profile-form.tsx`：
- 新增 `projectPath?: string`
- 新增 `worktreePath` state
- 计算默认路径：

```ts
function buildDefaultWorktreePath(projectPath: string): string {
  return projectPath.trim().length === 0 ? "" : `${projectPath}.worktrees`;
}
```

- 自定义路径存在性校验用：

```ts
const isDerivedDefault = worktreePath.trim() === defaultWorktreePath;
```

并把 `worktreePath` 一起提交给 `saveAgentProfile`。

- [ ] **Step 7: 运行相关测试并提交本任务**

Run:
```bash
pnpm test -- src/features/settings/project-settings-activity.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml settings -- --nocapture
```

Expected: PASS

Commit:
```bash
git add src/features/settings/agent-profile-form.tsx src/features/settings/project-settings-activity.tsx src/features/settings/settings-commands.ts src/features/settings/project-settings-activity.test.tsx src-tauri/migrations/0022_agent_worktree_execution.sql src-tauri/src/db/migrations.rs src-tauri/src/types/agent_profile.rs src-tauri/src/db/agent_profile_repository.rs src-tauri/src/core/settings_service.rs src-tauri/tests/settings.rs
git commit -m "feat: add agent worktree path settings"
```

## Task 2: 扩展 issue run dialog 的执行上下文

**Files:**
- Modify: `src/features/issues/issue-run-dialog.tsx`
- Modify: `src/features/issues/issue-commands.ts`
- Modify: `src/features/project/project-commands.ts`（如需复用 completion policy 类型）
- Modify: `src/shared/commands/command-client.test.ts`
- Test: `src/features/issues/issues-activity.test.tsx`

- [ ] **Step 1: 为 run dialog 新交互写失败测试**

在 `src/features/issues/issues-activity.test.tsx` 增加：

```tsx
it("defaults commit strategy from the project and locks branch in current branch mode", async () => {
  const dialog = screen.getByRole("dialog", { name: "Run Issue #20" });
  expect(within(dialog).getByLabelText("Commit strategy")).toHaveValue("manual");
  expect(within(dialog).getByLabelText("Development mode")).toHaveValue("current_branch");
  expect(within(dialog).getByLabelText("Target branch")).toBeDisabled();
});

it("sends workspace mode, target branch, and completion policy override on start", async () => {
  expect(startAgentSessionMock).toHaveBeenCalledWith(
    expect.objectContaining({
      completionPolicyOverride: "agent_auto_commit",
      workspaceMode: "worktree",
      targetBranch: "devlop",
    }),
  );
});
```

- [ ] **Step 2: 运行前端 issue 测试并确认失败**

Run:
```bash
pnpm test -- src/features/issues/issues-activity.test.tsx
```

Expected: FAIL，提示缺少新字段或 start 参数不匹配。

- [ ] **Step 3: 增加命令类型与新命令**

在 `src/features/issues/issue-commands.ts` 增加：

```ts
export type WorkspaceMode = "current_branch" | "worktree";

export interface GetProjectGitBranchesInput {
  projectId: number;
}

export interface ProjectGitBranchesResult {
  currentBranch: string;
  localBranches: string[];
}
```

扩展 `StartAgentSessionInput`：

```ts
completionPolicyOverride: ProjectCompletionPolicy;
workspaceMode: WorkspaceMode;
targetBranch: string;
```

新增：

```ts
export function getProjectGitBranches(...) { ... }
```

- [ ] **Step 4: 在 run dialog 实现 UI 与 localStorage 逻辑**

在 `src/features/issues/issue-run-dialog.tsx`：
- 增加项目 completion policy prop
- 加载 git branches
- 新增两个 localStorage key：

```ts
const RECENT_WORKSPACE_MODE_STORAGE_KEY = "redwhisk.issue-run.recent-workspace-mode";
const RECENT_TARGET_BRANCH_STORAGE_KEY = "redwhisk.issue-run.recent-target-branch";
```

- 字段行为：
  - `Commit strategy` 默认取 prop
  - `Development mode` 默认取最近值，否则 `current_branch`
  - `Target branch` 默认取当前分支；`current_branch` 模式下 disabled
  - `worktree` 模式时允许切换

- [ ] **Step 5: 更新 command client 测试**

在 `src/shared/commands/command-client.test.ts` 增加：

```ts
await startAgentSession({
  projectId: 1,
  issueId: 2,
  agentProfileId: 3,
  promptSnapshot: "prompt",
  completionPolicyOverride: "manual",
  workspaceMode: "current_branch",
  targetBranch: "devlop",
});
```

并断言 invoke payload。

- [ ] **Step 6: 运行相关测试并提交本任务**

Run:
```bash
pnpm test -- src/features/issues/issues-activity.test.tsx src/shared/commands/command-client.test.ts
```

Expected: PASS

Commit:
```bash
git add src/features/issues/issue-run-dialog.tsx src/features/issues/issue-commands.ts src/shared/commands/command-client.test.ts src/features/issues/issues-activity.test.tsx
git commit -m "feat: add issue run workspace controls"
```

## Task 3: 实现 Rust 的 git 分支查询与 session execution context

**Files:**
- Create: `src-tauri/src/git/worktree.rs`
- Modify: `src-tauri/src/git/mod.rs`
- Modify: `src-tauri/src/types/agent_session.rs`
- Modify: `src-tauri/src/db/agent_session_repository.rs`
- Modify: `src-tauri/src/core/agent_session_service.rs`
- Modify: `src-tauri/src/commands/agent_session_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/agent_session.rs`

- [ ] **Step 1: 为 branches 命令和 session context 写失败测试**

在 `src-tauri/tests/agent_session.rs` 增加：

```rust
#[test]
fn start_agent_session_persists_current_branch_workspace_context() {
    // 启动 current_branch 模式
    // 断言 session.workspace_mode == "current_branch"
    // target_branch / workspace_branch 被写入
}

#[test]
fn start_agent_session_creates_worktree_and_workspace_branch() {
    // 初始化 git repo，创建 devlop 分支
    // 启动 worktree 模式
    // 断言 working_dir 在配置的 worktree 根目录下
    // 断言 session.workspace_mode / target_branch / workspace_branch / workspace_path 已保存
}
```

- [ ] **Step 2: 运行 agent_session 测试并确认失败**

Run:
```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_session -- --nocapture
```

Expected: FAIL，缺少新字段或 worktree 行为未实现。

- [ ] **Step 3: 新增最小 git/worktree 模块**

在 `src-tauri/src/git/worktree.rs` 实现：

```rust
pub fn list_local_branches(repo_path: &Path) -> Result<ProjectGitBranchesResult, GitStatusError>;
pub fn create_issue_worktree(... ) -> Result<CreatedWorktree, GitStatusError>;
pub fn is_branch_merged(... ) -> Result<bool, GitStatusError>;
pub fn merge_branch_into_target(... ) -> Result<(), GitStatusError>;
pub fn cleanup_issue_worktree(... ) -> Result<(), GitStatusError>;
```

全部基于 `git` CLI，保持最小封装。

- [ ] **Step 4: 扩展 session types、repository 和启动服务**

在 `src-tauri/src/types/agent_session.rs` 扩展：

```rust
pub completion_policy_override: ProjectCompletionPolicy,
pub workspace_mode: WorkspaceMode,
pub target_branch: String,
```

在 `AgentSessionRecord` 增加 execution context 字段。

在 repository 的 select / insert SQL 一并更新。

在 `AgentSessionService::prepare_session_launch` / `start_agent_session_internal` 中：
- `current_branch` 模式直接用 `project.repo_path`
- `worktree` 模式调用 `create_issue_worktree`
- 将 execution context 与 `working_dir` 一并持久化

- [ ] **Step 5: 暴露 git branches 查询命令**

在 `agent_session_commands.rs` 新增：

```rust
#[tauri::command]
pub fn get_project_git_branches(...)
```

并在 `lib.rs` 注册。

- [ ] **Step 6: 运行相关测试并提交本任务**

Run:
```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_session -- --nocapture
```

Expected: PASS

Commit:
```bash
git add src-tauri/src/git/worktree.rs src-tauri/src/git/mod.rs src-tauri/src/types/agent_session.rs src-tauri/src/db/agent_session_repository.rs src-tauri/src/core/agent_session_service.rs src-tauri/src/commands/agent_session_commands.rs src-tauri/src/lib.rs src-tauri/tests/agent_session.rs
git commit -m "feat: persist issue workspace context"
```

## Task 4: 在 completion 流程中实现 merge-back 与 cleanup

**Files:**
- Modify: `src-tauri/src/core/issue_service.rs`
- Modify: `src-tauri/tests/issue.rs` 或现有 issue 测试文件
- Modify: `src-tauri/src/db/completion_attempt_repository.rs`（如需记录失败原因）

- [ ] **Step 1: 为 worktree completion 写失败测试**

在 issue 测试文件增加：

```rust
#[test]
fn detect_agent_commit_completion_merges_workspace_branch_before_completing_issue() {
    // 构造 worktree session + 新 commit
    // 断言完成后 issue = completed，目标分支包含 workspace_branch
}

#[test]
fn detect_agent_commit_completion_keeps_issue_in_review_when_merge_conflicts() {
    // 构造冲突
    // 断言 issue 仍是 review，失败原因被记录
}
```

- [ ] **Step 2: 运行 issue 测试并确认失败**

Run:
```bash
cargo test --manifest-path src-tauri/Cargo.toml issue -- --nocapture
```

Expected: FAIL

- [ ] **Step 3: 修改 issue completion 逻辑**

在 `src-tauri/src/core/issue_service.rs` 中：
- 读取 session execution context
- 对 `current_branch` 维持现有逻辑
- 对 `worktree`：
  - 检查 commit 是否存在
  - merge 回 `target_branch`
  - 成功后 cleanup 分支与 worktree
  - 失败则返回 `DetectAgentCommitCompletionResult`，保持 issue 在 `review`

`complete_issue_clean` 也要在 worktree 模式下检查 workspace 是否干净，再执行 cleanup。

- [ ] **Step 4: 运行相关测试并提交本任务**

Run:
```bash
cargo test --manifest-path src-tauri/Cargo.toml issue -- --nocapture
```

Expected: PASS

Commit:
```bash
git add src-tauri/src/core/issue_service.rs src-tauri/tests/issue.rs
git commit -m "feat: merge and cleanup issue worktrees"
```

## Task 5: 全量验证、回填 OpenSpec 与收口

**Files:**
- Modify: `openspec/changes/2026-06-16-agent-worktree-execution/tasks.md`
- Modify: `openspec/changes/2026-06-16-agent-worktree-execution/design.md`（若实现细节需要同步）
- Modify: `openspec/changes/2026-06-16-agent-worktree-execution/.onespec.yaml`

- [ ] **Step 1: 运行前端验证**

Run:
```bash
pnpm lint
pnpm typecheck
pnpm test -- src/features/settings/project-settings-activity.test.tsx src/features/issues/issues-activity.test.tsx src/shared/commands/command-client.test.ts
```

Expected: PASS

- [ ] **Step 2: 运行 Rust 验证**

Run:
```bash
cargo test --manifest-path src-tauri/Cargo.toml settings -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml agent_session -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml issue -- --nocapture
```

Expected: PASS

- [ ] **Step 3: 回填 OpenSpec artifacts**

在 `openspec/changes/2026-06-16-agent-worktree-execution/tasks.md` 勾选完成项；若实际实现改变了设计事实，同步更新 `design.md` 和 spec delta。

- [ ] **Step 4: 运行 OpenSpec 校验**

Run:
```bash
openspec validate 2026-06-16-agent-worktree-execution --strict
```

Expected: PASS

- [ ] **Step 5: 跟踪 touched files 并创建最终实现提交**

Run:
```bash
ONESPEC_ENV="${ONESPEC_ENV:-$(find . "$HOME"/.codex "$HOME"/.claude "$HOME"/.cursor "$HOME"/.gemini "$HOME"/.copilot "$HOME"/.agents "$HOME"/.config -path '*/onespec/scripts/onespec-env.sh' -type f -print -quit 2>/dev/null)}"
. "$ONESPEC_ENV"
"$ONESPEC_BASH" "$ONESPEC_COMMIT" track 2026-06-16-agent-worktree-execution <paths...>
git add <task-related-files>
git commit -m "feat: add issue worktree execution flow"
```

- [ ] **Step 6: 将 OneSpec 状态切到 review**

Run:
```bash
ONESPEC_ENV="${ONESPEC_ENV:-$(find . "$HOME"/.codex "$HOME"/.claude "$HOME"/.cursor "$HOME"/.gemini "$HOME"/.copilot "$HOME"/.agents "$HOME"/.config -path '*/onespec/scripts/onespec-env.sh' -type f -print -quit 2>/dev/null)}"
. "$ONESPEC_ENV"
"$ONESPEC_BASH" "$ONESPEC_STATE" set 2026-06-16-agent-worktree-execution phase review
"$ONESPEC_BASH" "$ONESPEC_HANDOFF" 2026-06-16-agent-worktree-execution review --write
```

Expected: review handoff 写入成功。
