# Revise Issue Completion Commit Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 issue 运行前的「提交策略（manual / agent_auto_commit）」字段，改为完成时基于实际执行路径统一检测未提交改动、弹框决策（自动提交 / 不提交 / 取消）；补齐运行中 worktree 漂移捕获；重写完成流程状态机与 worktree 合并/失败/删除逻辑。

**Architecture:** 后端以 `issue_completion_flows` 为完成流程事实来源，phase 枚举重写为按步推进的统一阶段（去掉 manual/auto 二分）。新增 `resolve_actual_execution_path` 在完成时解析 session 当前真实 cwd（活跃）或启动快照（关闭），并与启动 `workspace_path` 比对识别漂移。前端 dirty-workspace 三选项对话框驱动流程，自动提交分支跳转 session 页并等待提交确认。worktree 删除按 `WorktreeOwner` 分流，漂移 worktree 一律按 External。

**Tech Stack:** Tauri 2、Rust 2021、rusqlite、React 19、TypeScript、Vitest、SQLite migrations、Git CLI。

## Global Constraints

- 所有 shell 命令必须加 `rtk` 前缀；链式命令每一段都加 `rtk`。
- 说明文字默认使用简体中文；代码标识符、命令、路径保持原样。
- SQLite 表名使用 `snake_case` 复数名词；主键 `id INTEGER PRIMARY KEY`；时间列以 `_at` 结尾并保存 Unix epoch milliseconds。
- 跨 Tauri 边界 DTO 使用 Rust `#[serde(rename_all = "camelCase")]` 与 TypeScript camelCase 类型同步。
- 前端用户可见文案必须国际化（中英文），不新增散落硬编码文案。
- 应用不得执行 `git add .`，不得静默提交全部改动；自动提交只能向 Agent session 注入 commit 指令。
- `completed` Issue 不提供 Run/Reopen 主路径；完成前必须写入审计记录。
- 改动 TypeScript/TSX 后必须按顺序运行 `rtk pnpm format`、`rtk pnpm lint`、`rtk pnpm typecheck`，改动运行时行为还必须运行 `rtk pnpm test`。
- 改动 Rust/Tauri/SQLite migration 后必须运行 `rtk cargo test`（在 `src-tauri` 下）。
- 最终必须运行 `rtk proxy openspec validate revise-issue-completion-commit-flow --strict`。

## Key Design Decisions（已确认）

1. **移除范围（议题1=A）**：运行对话框选择器 + 项目设置页选择器 + `projects.completion_policy` 列 + `agent_sessions.completion_policy_override` + 相关类型/命令/i18n/测试全部删除。
2. **自动提交语义（议题2）**：dirty → 选自动提交 → 跳转 session 页 → 注入 commit 指令 → 检测到新 commit → 弹「代码已提交成功。确定继续标记完成吗？」→ 是则继续 worktree reconciliation，否则终止（issue 保持未完成）。不自动 resume。
3. **路径解析（议题3）**：完成时 `resolve_actual_execution_path`：session 活跃取 live cwd，关闭取启动 `workspace_path`；PTY 无 live cwd 则退化为弹框手填兜底。
4. **分支名填充（议题4）**：情况一/二自动只读预填，情况三/session 关闭可编辑。
5. **worktree 归属（议题5）**：运行中漂移到的新 worktree 一律 `External`，删除前必须二次确认；rebase 失败不弹框，活跃 session 发消息 / 关闭则新建 session 携带上下文。

## File Structure

后端：

- Create: `src-tauri/migrations/00NN_drop_project_completion_policy.sql`（编号取现有最大 +1），删除 `projects.completion_policy`、`agent_sessions.completion_policy_override`，归一化 `issue_completion_flows.phase` 旧 policy 值。
- Modify: `src-tauri/src/db/migrations.rs`，注册新迁移、撤销 0010 的语义。
- Modify: `src-tauri/src/types/project.rs`，删 `ProjectCompletionPolicy` enum 及 DTO 字段。
- Modify: `src-tauri/src/types/agent_session.rs`，删 `completion_policy_override` / 反序列化字段。
- Modify: `src-tauri/src/types/completion_attempt.rs`，删 `CompletionAttemptOption::AgentAutoCommit` 变体。
- Modify: `src-tauri/src/types/issue_completion.rs`，重写 phase 枚举与 completion action/result DTO（新增 dirty 三选项、auto-commit 等待、提交后确认、worktree cleanup 确认）。
- Modify: `src-tauri/src/db/project_repository.rs` / `agent_session_repository.rs` / `completion_attempt_repository.rs`，清理 policy 列读写与 from_str/to_str。
- Modify: `src-tauri/src/db/issue_completion_flow_repository.rs`，phase 新枚举读写。
- Modify: `src-tauri/src/core/project_service.rs`，删 `update_project_completion_policy`。
- Modify: `src-tauri/src/core/agent_session_service.rs`，删 effective policy 计算（945-948/1604-1606）；新增 `resolve_actual_execution_path` + live cwd 上报查询；启动路径记录保持不变。
- Modify: `src-tauri/src/core/session_workspace_service.rs`，新增基于 `actual_path` 的 dirty 检测与新 commit 检测。
- Modify: `src-tauri/src/core/issue_service.rs`，重写 `complete_issue_flow_transaction` 走新 phase 状态机；删 policy 映射（835-839）与拦截（1895-1911）；重写 `reconciling_worktree`（rebase 失败发消息/新建 session、External 删除确认）。
- Modify: `src-tauri/src/commands/project_commands.rs` / `lib.rs`，删 `update_project_completion_policy` 命令与注册。
- Modify: `src-tauri/src/commands/issue_commands.rs`，completion command 适配新 action DTO。
- Test: `src-tauri/tests/`（issue / agent_session / local_data migration 固定）+ 新增路径解析与漂移覆盖。

前端：

- Modify: `src/features/project/project-commands.ts`，删 `ProjectCompletionPolicy` 类型与 `updateProjectCompletionPolicy`、`completionPolicy` 字段。
- Modify: `src/features/issues/issue-commands.ts`，删 `completionPolicyOverride`；新增 completion flow 新 action DTO 与 command。
- Modify: `src/features/issues/issue-run-dialog.tsx`，删提交策略选择器（L502-530）及相关 state/props。
- Modify: `src/features/project/project-details-form.tsx`，删提交策略选择器（L128-157）。
- Modify: `src/features/settings/settings-general-panel.tsx`，删 completionPolicy 状态。
- Modify: `src/features/issues/issues-activity.tsx`，接入 dirty 三选项对话框、自动提交→session 跳转、提交成功确认、worktree cleanup 确认。
- Modify: `src/features/agents/agents-activity.tsx`，删 `projectCompletionPolicy` prop 与 L839 条件分支，完成入口接入新 flow。
- Modify: `src/app/app.tsx` / `app-shell.tsx` / `activity-router.tsx`，清理 `completionPolicy` prop 透传链。
- Modify: `src/features/settings/project-settings-activity.tsx`，清理 prop。
- Modify: `src/shared/i18n/messages.ts`，删旧 key、新增新文案（中英文）。
- Test: `src/**/*.test.tsx`（app/app-shell/project-settings/agents/issues/project-details-form/command-client）。

OpenSpec / OneSpec：

- Modify: `openspec/changes/revise-issue-completion-commit-flow/tasks.md`，实现完成后勾选。
- Modify: `openspec/changes/revise-issue-completion-commit-flow/.onespec.yaml`，通过 OneSpec 脚本维护 plan、phase、touched files。

---

### Task 1: Spike — PTY live cwd 上报能力验证

**Files:**
- Investigate: `src-tauri/src/agent/**`（PTY session 句柄）、`src-tauri/src/core/agent_session_service.rs`

**Steps:**
- [ ] 1.1 确认 PTY session 句柄是否能在运行中上报当前 cwd（读进程 cwd / shell 集成 / 已有上报字段）；结构化 codex app-server session 是否上报 workspace cwd。
- [ ] 1.2 若可得上报 → 在 design.md 记录获取方式，后续 Task 9 直接用。
- [ ] 1.3 若不可得 → 在 design.md 记录兜底（弹框手填分支名 + 路径），并在 Task 9 实现兜底分支。

**Verification:** design.md 补一条「PTY live cwd 结论」记录；结论决定 Task 9 实现形态。

---

### Task 2: 移除 completion_policy — 数据库与迁移

**Files:**
- Create: `src-tauri/migrations/00NN_drop_project_completion_policy.sql`
- Modify: `src-tauri/src/db/migrations.rs`
- Modify: `src-tauri/tests/local_data.rs`（migration 固定列表/版本/总数）

**Interfaces:**
- `projects` 表去掉 `completion_policy`；`agent_sessions` 表去掉 `completion_policy_override`。
- `issue_completion_flows.phase` 旧 policy 相关字面量在迁移内归一化（→ `cancelled` 或新等价值）。

**Steps:**
- [ ] 2.1 编写迁移：`ALTER TABLE projects DROP COLUMN completion_policy;`、`ALTER TABLE agent_sessions DROP COLUMN completion_policy_override;`；SQLite 版本不支持 DROP COLUMN 时走 table-rebuild。
- [ ] 2.2 迁移内归一化 `issue_completion_flows.phase` 旧 policy 值（UPDATE）。
- [ ] 2.3 在 `migrations.rs` 注册，更新当前版本号与总数。
- [ ] 2.4 更新 `local_data.rs` 固定。
- [ ] 2.5 `rtk cargo test`（migration + local_data）。

**Verification:** 迁移在空库与带旧数据 fixture 上均通过；`cargo test` 绿。

---

### Task 3: 移除 completion_policy — Rust 类型与 repository

**Files:**
- Modify: `src-tauri/src/types/{project,agent_session,completion_attempt}.rs`
- Modify: `src-tauri/src/db/{project_repository,agent_session_repository,completion_attempt_repository}.rs`

**Steps:**
- [ ] 3.1 删 `ProjectCompletionPolicy` enum 及所有 DTO 字段。
- [ ] 3.2 删 `agent_sessions` 的 `completion_policy_override` 与反序列化 `completion_policy` 字段。
- [ ] 3.3 删 `CompletionAttemptOption::AgentAutoCommit` 变体（保留 manual 语义或整体按新 flow 重命名）。
- [ ] 3.4 清理三个 repository 的 SELECT/INSERT/row mapping 与 `from_str/to_str`。
- [ ] 3.5 `rtk cargo build` 通过编译（此时 service 层会报错，Task 4 修）。

**Verification:** 类型层编译干净；repository 不再读写 policy 列。

---

### Task 4: 移除 completion_policy — service / command 层

**Files:**
- Modify: `src-tauri/src/core/{project_service,agent_session_service,issue_service}.rs`
- Modify: `src-tauri/src/commands/{project_commands,lib.rs}.rs`

**Steps:**
- [ ] 4.1 删 `project_service::update_project_completion_policy` 与 `project_commands::update_project_completion_policy` 命令 + `lib.rs` 注册。
- [ ] 4.2 删 `agent_session_service` effective policy 计算（945-948/1604-1606）与启动时存 policy 快照。
- [ ] 4.3 暂时移除 `issue_service.rs` 中 policy→CompletionAttemptOption 映射（835-839）与 policy 拦截（1895-1911）；用临时桩让 completion 流程先编译（Task 7 重写）。
- [ ] 4.4 `rtk cargo build` 全绿。

**Verification:** 后端整体编译通过，无 policy 残留引用。

---

### Task 5: 重写 completion flow 类型与 phase 状态机

**Files:**
- Modify: `src-tauri/src/types/issue_completion.rs`
- Modify: `src-tauri/src/db/issue_completion_flow_repository.rs`

**Interfaces:**
- 新 phase 枚举：`DetectingWorkspace` / `PromptingDirtyDecision` / `AutoCommitting` / `ConfirmingContinueAfterCommit` / `ReconcilingWorktree` / `ConfirmingWorktreeCleanup` / `Completed` / `Cancelled` / `Blocked`（serde snake_case）。
- 新 action/result DTO：`DirtyWorkspaceDecision { branch_name, option: AutoCommit|Skip|Cancel }`、`ContinueAfterCommitDecision { confirm: bool }`、`WorktreeCleanupDecision { delete: bool }`。

**Steps:**
- [ ] 5.1 定义新 phase 枚举与序列化。
- [ ] 5.2 定义新 action/result DTO（跨 Tauri 边界 camelCase）。
- [ ] 5.3 更新 `issue_completion_flow_repository` 读写新 phase 字面量。
- [ ] 5.4 `rtk cargo build` + `rtk cargo test`。

**Verification:** 新状态机类型可持久化与恢复。

---

### Task 6: 实际执行路径解析与 worktree 漂移捕获

**Files:**
- Modify: `src-tauri/src/core/agent_session_service.rs`
- Modify: `src-tauri/src/core/session_workspace_service.rs`
- Modify: `src-tauri/src/git/worktree.rs`（如需新增 cwd→worktree 判定 helper）

**Interfaces:**
- `resolve_actual_execution_path(project, session) -> ActualPath { path, in_worktree, worktree_branch, worktree_root, drifted: bool }`。

**Steps:**
- [ ] 6.1 实现 live cwd 获取（按 Task 1 结论；不可得走兜底）。
- [ ] 6.2 session 关闭 → 用 `session.workspace_path`。
- [ ] 6.3 在 `actual_path` 上判定是否在 worktree（`--git-dir` vs `--git-common-dir`），取 checkout 分支与根。
- [ ] 6.4 路径比对：`actual_path != startup_path` 且在 worktree → `drifted=true`，owner 视为 External。
- [ ] 6.5 dirty 检测（`git status --porcelain`）与新 commit 检测（对比记录的 head）helper。
- [ ] 6.6 `rtk cargo test` 覆盖三种路径 + 漂移。

**Verification:** 三种路径解析与漂移识别单元测试通过。

---

### Task 7: 重写 completion orchestration（detecting → dirty 三选项）

**Files:**
- Modify: `src-tauri/src/core/issue_service.rs`
- Modify: `src-tauri/src/commands/issue_commands.rs`

**Steps:**
- [ ] 7.1 `complete_issue_flow_transaction` 以 `DetectingWorkspace` 起步，调 `resolve_actual_execution_path` + dirty 检测。
- [ ] 7.2 dirty → 返回 `DirtyWorkspaceDecision` action（携带预填分支名），phase → `PromptingDirtyDecision`。
- [ ] 7.3 非 dirty → 直接进入 `ReconcilingWorktree`。
- [ ] 7.4 接受用户决策命令，按 AutoCommit/Skip/Cancel 分流。
- [ ] 7.5 `rtk cargo test` 覆盖 dirty/非dirty/三选项。

**Verification:** 完成入口统一走新状态机；policy 旧路径已移除。

---

### Task 8: 自动提交分支（跳转 session + 提交确认）

**Files:**
- Modify: `src-tauri/src/core/issue_service.rs`
- Modify: `src-tauri/src/commands/issue_commands.rs`

**Steps:**
- [ ] 8.1 AutoCommit → 复用 `send_agent_commit_prompt` 注入 commit 指令（含 commit message 上下文），记录弹框前 git head，phase → `AutoCommitting`。
- [ ] 8.2 检测到 `actual_path` 上出现新 commit → phase → `ConfirmingContinueAfterCommit`，返回 `ContinueAfterCommitDecision` action。
- [ ] 8.3 confirm=true → `ReconcilingWorktree`；confirm=false → `Cancelled`。
- [ ] 8.4 `rtk cargo test` 覆盖新 commit 命中 / 未命中 / 用户拒绝。

**Verification:** 自动提交→等待→确认链路与状态持久化正确。

---

### Task 9: worktree reconciliation（rebase / 失败 / 删除）

**Files:**
- Modify: `src-tauri/src/core/issue_service.rs`
- Modify: `src-tauri/src/git/worktree.rs`（复用现有原语）

**Steps:**
- [ ] 9.1 非漂移、current-branch → 关闭 session + 审计 + `Completed`。
- [ ] 9.2 worktree 且（路径不同或 owner=Redwhisk worktree）→ `rebase_and_fast_forward(workspace_branch onto base_branch)`，base = 用户/解析分支名。
- [ ] 9.3 rebase 失败 → 不弹框：session 活跃走 `send_agent_message`/`inject_session_prompt` 发「代码合并冲突，请根据本次修改合并代码。」；session 关闭则在该 worktree 路径新建 session 携带改动上下文；phase → `Blocked`。
- [ ] 9.4 合并成功 → 删除判定：Redwhisk → `cleanup_worktree`；External（含漂移）→ phase → `ConfirmingWorktreeCleanup`，返回 `WorktreeCleanupDecision` action。
- [ ] 9.5 delete=true → `cleanup_worktree`；delete=false → 跳过清理，继续写 `Completed`。
- [ ] 9.6 `rtk cargo test` 覆盖成功 / rebase 失败两分支 / Redwhisk / External。

**Verification:** 合并/失败/删除分流与 spec delta 一致。

---

### Task 10: 前端 — 移除 completion_policy 类型与 prop 透传

**Files:**
- Modify: `src/features/project/project-commands.ts`
- Modify: `src/features/issues/issue-commands.ts`
- Modify: `src/app/{app,app-shell,activity-router}.tsx`
- Modify: `src/features/settings/{settings-general-panel,project-settings-activity}.tsx`
- Modify: `src/features/project/project-details-form.tsx`
- Modify: `src/features/issues/issue-run-dialog.tsx`
- Modify: `src/features/agents/agents-activity.tsx`

**Steps:**
- [ ] 10.1 删 `ProjectCompletionPolicy` 类型、`updateProjectCompletionPolicy`、`completionPolicyOverride`。
- [ ] 10.2 删运行对话框提交策略选择器（L502-530）与 state。
- [ ] 10.3 删项目设置页选择器（L128-157）与 general panel 状态。
- [ ] 10.4 清理 app/app-shell/activity-router/project-settings-activity/issues-activity/agents-activity 的 `completionPolicy` prop 链与 L839 分支。
- [ ] 10.5 `rtk pnpm format && rtk pnpm lint && rtk pnpm typecheck`。

**Verification:** 前端无 policy 残留；typecheck 绿。

---

### Task 11: 前端 — completion flow 新 action DTO 与对话框

**Files:**
- Modify: `src/features/issues/issue-commands.ts`
- Modify: `src/features/issues/issues-activity.tsx`
- Modify: `src/shared/i18n/messages.ts`

**Steps:**
- [ ] 11.1 新增 completion flow 新 action/decision DTO 与 command wrapper。
- [ ] 11.2 dirty 三选项对话框组件（分支名预填/可编辑、自动提交/不提交/取消）。
- [ ] 11.3 自动提交 → 跳转 session 页 + 触发后端 AutoCommitting。
- [ ] 11.4 提交成功确认对话框（是/否）。
- [ ] 11.5 worktree cleanup 确认对话框（是/否，含 [base 分支名称]）。
- [ ] 11.6 接入 i18n（中英文），删旧 `commitStrategy/agentAutoCommit/...` key。
- [ ] 11.7 `rtk pnpm format && rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test`。

**Verification:** 三对话框交互与后端状态机对齐；测试覆盖各分支。

---

### Task 12: 测试、回填、验证

**Files:**
- Modify: 前后端测试夹具
- Modify: `openspec/changes/revise-issue-completion-commit-flow/tasks.md`

**Steps:**
- [ ] 12.1 前后端测试全绿：三路径解析、漂移捕获、dirty 三选项、自动提交→跳转→确认、rebase 失败发消息/新建 session、Redwhisk/External 删除分流、phase 恢复。
- [ ] 12.2 `rtk pnpm format / lint / typecheck / test`。
- [ ] 12.3 `rtk cargo fmt && rtk cargo clippy && rtk cargo test`（src-tauri）。
- [ ] 12.4 回填 `tasks.md` 勾选。
- [ ] 12.5 `rtk proxy openspec validate revise-issue-completion-commit-flow --strict`。

**Verification:** 全部验证通过；OpenSpec 校验通过。
