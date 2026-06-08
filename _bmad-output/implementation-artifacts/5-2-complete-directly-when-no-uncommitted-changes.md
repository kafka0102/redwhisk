---
baseline_commit: 9fb3b53
---

# Story 5.2: 无未提交改动时直接完成

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望在 `agent_auto_commit` 策略下无改动时直接完成 Issue,
以便没有 Git 变更的任务也能干净结束。

## Acceptance Criteria

1. 给定 Issue 状态为 `review` 且 AgentSession 为 `running`，当当前生效 completion policy 为 `agent_auto_commit` 且 Git status 无未提交改动时，Session Header 显示 `Complete`，且不显示 `Complete Manually`、`Complete with Agent Commit` 等其它完成分支。
2. 给定用户点击 `Complete` 并确认，当 Rust Core 在执行前再次检测当前 Project 的 Git snapshot 仍为 clean、无 Git operation in-progress，且当前 Issue / AgentSession 仍满足完成前置条件时，Issue 状态变为 `completed`，AgentSession 状态变为 `closed``。`
3. 给定直接完成成功，当系统记录审计时，则如 schema 尚未存在应通过 migration 创建 `completion_attempts` 表，并写入对应 `IssueAction`、`SessionEvent` 和 `CompletionAttempt`；该 `CompletionAttempt` 至少记录 `issue_id`、`session_id`、`option=complete_clean`、`head_before`、`head_after`、`result=completed` 和 `created_at`。
4. 给定 Git snapshot 不 clean、检测到 merge / rebase / cherry-pick / revert / sequencer / unmerged 等 Git operation in-progress、或 completion 前后业务状态不再满足条件时，当用户尝试直接完成，则系统拒绝完成并保持 Issue 为 `review`；其中“有未提交改动”属于本 story 的非目标分支，不应错误落到直接完成成功路径。

## Tasks / Subtasks

- [x] 收口 `agent_auto_commit + clean worktree` 的最小完成路径，不提前混入 5.3-5.7 (AC: 1, 2, 4)
  - [x] 复查 [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx)、[src/features/issues/issue-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-commands.ts)、[src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs) 和 [src-tauri/src/core/agent_session_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/agent_session_service.rs)，确认 5.1 的 manual completion 闭环哪些部分可复用，哪些部分必须新增 `agent_auto_commit` 的 clean-path 分支。
  - [x] 明确最小取舍：本 story 只处理“Git clean 时直接完成”，不实现 `Complete with Agent Commit` 确认面板、不发送 completion prompt、不检测新 commit hash，也不处理 no-commit 之后的留在 `review` 提示 UI。
  - [x] 若当前 completion policy 运行时读取仍未成型，只补满足本 story 所需的最小事实来源，避免为后续策略系统提前堆复杂抽象。
- [x] 在 Rust Core 增加 clean-path 直接完成命令与 Git 前置校验 (AC: 2, 4)
  - [x] 基于 Story 2.9 已落地的 [src-tauri/src/git/status.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/git/status.rs) 复用 `read_git_snapshot` 与 `GitOperationState`，在完成前读取当前 Project `repo_path` 的 Git snapshot，而不是在前端推导 clean 状态。
  - [x] 仅当 snapshot `is_clean=true`、`operation_state=none`、Issue 仍为 `review`、linked AgentSession 仍为 `running` 时，才允许进入事务内完成；否则返回显式错误并保持原状态。
  - [x] 成功路径复用 5.1 的 `review -> completed` / `running -> closed` 状态收口和 PTY 终止策略，但要把完成原因、审计类型与 manual path 明确区分。
- [x] 补齐 `completion_attempts` migration、repository 和最小审计写入 (AC: 3)
  - [x] 新增最小 migration 创建 `completion_attempts` 表，字段至少覆盖 Epic 5 当前故事需要的 `issue_id`、`session_id`、`option`、`head_before`、`head_after`、`result`、`created_at`；不要提前为 5.5/5.8 之外的未来字段过度扩展。
  - [x] 在 Rust Core 成功路径内写入 `CompletionAttempt`，并与 `IssueAction`、`SessionEvent` 一起保持单事务一致性，避免出现状态已完成但审计缺失的中间态。
  - [x] 区分 `manual_completion` 与 “clean direct completion” 的审计 payload / event reason / completion option，避免后续 Summary 或诊断无法分辨完成来源。
- [x] 把 clean-path 完成动作接到现有 Session Header，并收紧动作 gating (AC: 1, 4)
  - [x] 在 review Header 上，仅当 completion policy 为 `agent_auto_commit` 且当前 linked issue / session 满足 clean-path 入口条件时显示 `Complete`。
  - [x] `Complete` 仍需确认门槛；确认后调用新的 Rust command。若命令返回“dirty worktree”或“Git operation in-progress”，前端只显示事实性错误，不自行切换到 `Complete with Agent Commit` 占位流程。
  - [x] 保持 completed 后不再显示 `Run`、`Mark Review`、`Complete Manually`、`Complete` 或 `Complete with Agent Commit`，并维持 xterm / inspector 不被无关卸载。
- [x] 用测试锁定 clean direct completion 的成功与失败护栏 (AC: 1, 2, 3, 4)
  - [x] Rust 测试覆盖：`agent_auto_commit + clean repo + review issue + running session` 成功完成，并写入 `IssueAction`、`SessionEvent`、`CompletionAttempt`。
  - [x] Rust 测试覆盖：dirty worktree、Git operation in-progress、非 `review` Issue、无 linked running session、跨 Project、repo path 不可访问等失败路径不会产生部分写入。
  - [x] 前端测试覆盖：review Header 在 clean-path 下显示 `Complete`，manual path 不显示；确认后调用命令，成功后按钮隐藏；失败时保留 `review` 状态并展示错误。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3, 4)
  - [x] 本 story 预计会修改 TypeScript / TSX 渲染逻辑、Rust Core 状态事务、Git 检测消费层、数据库 migration 与测试，默认至少执行：

```bash
pnpm format
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm typecheck
pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml --test issue
cargo test --manifest-path src-tauri/Cargo.toml --test agent_session
cargo test --manifest-path src-tauri/Cargo.toml --test git_detection
pnpm test
git diff --check
```

## Dev Notes

### 关键假设与取舍

- Story 5.2 只交付 `agent_auto_commit` 下“没有任何未提交改动时直接完成”的最小可靠闭环；它不是 Agent Commit 主流程，不负责把改动摘要展示给用户，也不负责向 Codex 注入 completion prompt。
- 当前仓库在 Story 5.1 时已确认 completion policy 运行时代码尚未成型，因此本 story 默认取舍是只补满足 clean-path 所需的最小策略分支，而不是一口气把 5.3-5.7 的完整状态机一起做完。
- “Git clean” 必须由 Rust Core 对当前 Project `repo_path` 再次读取 Git snapshot 认定，不能只信前端缓存或按钮显示时刻的判断；点击确认与真正完成之间可能出现新的脏改动或 Git operation blocker。
- 本 story 虽然引入 `completion_attempts`，但仅记录 clean-path 直完成功路径和直接失败所需的最小审计事实，不提前实现 commit hash、changed files JSON、Summary View 等后续字段消费。

### 范围边界

- 交付：review Header 的 `Complete` clean-path 入口、Rust Core 再校验 Git clean、`completion_attempts` 最小落库、Issue / AgentSession 状态收口、对应前后端测试。
- 不交付：`Complete with Agent Commit`、Completion Confirmation、completion prompt 注入、HEAD 改变后的 commit hash 成功路径、`no_commit_detected` 交互文案、Summary / Open Log 页面增强。
- 不交付：merge / rebase / cherry-pick recovery、Git diff 浏览、Git 历史、reopen completed Issue、多 Session Attempt 或自动选择其它完成分支。

### 当前代码状态与修改指引

- [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 目前只有 `Complete Manually` 的 review Header 分支；Story 5.2 应在不破坏 5.1 行为的前提下，新增 `agent_auto_commit + clean` 的 `Complete` 分支，并保持其它未实现完成动作继续隐藏。
- [src/features/agents/agents-activity.test.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.test.tsx) 已经对 `Complete Manually` / `Complete with Agent Commit` / `Complete` 的可见性做过占位断言；5.2 应优先在这里补 clean-path 的显式行为测试，而不是新造分散测试面。
- [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs) 已有 `complete_issue_manual` 的事务边界、`issue_completed` IssueAction 和 `session_closed` SessionEvent 写入模式；5.2 最适合复用同一组织方式，并最小增量扩展 completion option / reason / attempt 写入。
- [src-tauri/src/core/agent_session_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/agent_session_service.rs) 已负责 manual completion 成功后的 tracked PTY 终止；clean-path 完成也应复用这条收口，避免出现 Issue 已完成但 PTY 仍被视为活动会话。
- [src-tauri/src/git/status.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/git/status.rs) 已提供 `read_git_snapshot`、`detect_commit_result` 与 `GitOperationState`；5.2 只需要消费 `is_clean` 与 `operation_state` 作为“能否直接完成”的 gate，不需要本 story 就接入 commit-result 分支。
- [src-tauri/src/db/project_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/project_repository.rs) 已能读取 `repo_path`；clean-path 完成必须从 Project 事实源拿仓库路径，不允许前端把路径字符串直接传入完成命令。

### 架构约束

- Issue / AgentSession / CompletionAttempt 状态变化只能通过 Rust Core command 完成；前端不得直接写 `completed` / `closed` 或自行认定 Git clean。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns]
- Completion Policy 只能通过应用侧 Git 检测与审计闭环；即使本 story 不发送 completion prompt，也必须把“为什么可以直接完成”建立在真实 Git 事实之上。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR20, §FR22, §NFR5]
- 新增完成尝试必须可审计；`completion_attempts` 与 `IssueAction` / `SessionEvent` 应在同一事务中保持一致性。[Source: `_bmad-output/planning-artifacts/architecture.md` §审计与可复盘]
- Git operation in-progress、repo 不可访问、dirty worktree 等失败路径必须显式可见，不能被吞成成功或伪装成其它完成分支。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §NFR6]

### UX 与文案约束

- `review` Issue 在 `completion_policy=agent_auto_commit` 且 Git clean 时，Session Header 主按钮应为 `Complete`；有未提交改动时则属于后续 `Complete with Agent Commit` 分支，不应在本 story 中提前伪装实现。[Source: `_bmad-output/planning-artifacts/epics.md` Story 5.2 / 5.3]
- 完成动作必须经过确认；completed 后不再显示 `Run`、`Mark Review`、`Complete Manually`、`Complete`、`Complete with Agent Commit`。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` Product-Specific Trust Rules; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR23]
- 错误提示保持事实性：dirty worktree、Git operation in-progress、repo 不可访问都应该直接说明，不使用模糊“完成失败”兜底语气。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §NFR6]

### 前置故事信息

- Story 5.1 已实现 `manual` completion 的最小闭环，包括 review Header 按钮、Rust Core 事务完成、`issue_completed` / `session_closed` 审计以及 PTY 终止；5.2 应复用这些稳定部分，而不是重写完成事务。
- Story 2.8 已确认“向当前活 Session 注入 completion prompt”可以作为运行时能力依赖，但它与本 story 的 clean-path 直接完成无强依赖；5.2 不应为了 clean path 抢跑 prompt 注入流程。
- Story 2.9 已确认 Git snapshot 与 operation-state 检测可用，并明确 `completion_attempts` 尚未落地；5.2 正是把其中最小一段检测结论接入真实完成状态机。
- Story 4.4 已把 review Header 的 `Complete` / `Complete with Agent Commit` 留在未来故事；5.2 是把其中 clean-path `Complete` 分支从隐藏推进到真实可用，但仍不实现 dirty-path 分支。

### 非目标

- 不实现 `Complete with Agent Commit` 按钮、Completion Confirmation、completion prompt 注入或 commit hash 成功检测。
- 不实现 `no_commit_detected` 之后的 review follow-up 流程；该路径属于后续 dirty-path / agent-commit 故事。
- 不实现 Summary / Open Log completed 复盘能力。
- 不顺手重构全局 / 项目 completion policy 设置 UI，除非缺少最小事实源导致本 story 无法成立。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 5 / Story 5.2、5.3 的故事定义、AC 与边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR20、FR22、FR23、NFR5、NFR6。
- `_bmad-output/planning-artifacts/architecture.md` — Rust Core 单一状态写入、Git 检测边界、CompletionAttempt 架构要求。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — 完成动作的信任规则与 completed 后动作约束。
- `spikes/git-commit-detection.md` — Git clean / operation-state 检测结论，以及对 Story 5.x 的 gate。
- `spikes/codex-resume-completion-prompt.md` — completion prompt 注入结论，明确 clean-path 不必抢跑该能力。
- `_bmad-output/implementation-artifacts/5-1-manually-complete-review-issue.md` — manual completion 已实现边界与可复用实现锚点。
- `_bmad-output/implementation-artifacts/2-9-spike-git-commit-detection.md` — 5.2 直接依赖的 Git snapshot 能力说明。
- `src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx`、`src/features/issues/issue-commands.ts`、`src-tauri/src/core/issue_service.rs`、`src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/git/status.rs`、`src-tauri/src/db/project_repository.rs`、`src-tauri/tests/issue.rs`、`src-tauri/tests/agent_session.rs`、`src-tauri/tests/git_detection.rs` — 预计主要改动与测试锚点。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-08T22:xx+08:00：`bmad-dev-workflow` preflight 读取完整 `sprint-status.yaml`，确认当前没有 `ready-for-dev` story，按顺序锁定 `5-2-complete-directly-when-no-uncommitted-changes`，基线 `HEAD` 为 `9fb3b53`。
- 2026-06-08T22:xx+08:00：交叉核对 Epic 5.2 / 5.3、PRD FR20 / FR22 / FR23、UX 信任规则、architecture 的 CompletionAttempt / Git 约束，以及 Story 5.1、Story 2.8、Story 2.9 的已交付边界。
- 2026-06-08T22:xx+08:00：复查当前仓库实现，确认 `completion policy` 运行时代码仍未成型、`completion_attempts` 尚未落地，但 Git snapshot 能力已存在；因此将 Story 5.2 范围收口为 clean-path 直接完成，不提前引入 5.3-5.7 的 dirty-path 与 prompt 注入能力。
- 2026-06-08T23:xx+08:00：补齐 `projects.completion_policy` 最小事实源、`completion_attempts` migration/repository、clean-path Rust command 与 Session Header gating，并用 Rust/Vitest 覆盖成功与 dirty fail 护栏。
- 2026-06-08T23:xx+08:00：按仓库规则执行 `format`、`lint`、`typecheck`、Rust integration tests、Vitest 与 `git diff --check`；确认实现和验证均通过后完成工作流收口。

### Completion Notes List

- 2026-06-08：补齐 Project 级 `completionPolicy` 最小存储/读取链路，使 `agent_auto_commit` 能成为 clean-path 完成的真实事实源，并同步到 App / Settings / Agents。
- 2026-06-08：新增 `complete_issue_clean` 命令与 `completion_attempts` 审计闭环；成功路径会在单事务内完成 Issue / Session 状态收口、`IssueAction`、`SessionEvent` 和 `CompletionAttempt` 写入。
- 2026-06-08：前端 Session Header 现在会在 `agent_auto_commit + clean + review + running` 条件下显示 `Complete`，并在成功后隐藏完成动作；dirty worktree 和 Git operation blocker 会保留 `review` 状态并显示事实性错误。
- 2026-06-08：已补齐 Rust schema/夹具测试与前端行为测试，并修复 `list_projects` 返回类型、设置页受控状态和测试夹具随新类型演进带来的静态问题。

### File List

- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- _bmad-output/implementation-artifacts/5-2-complete-directly-when-no-uncommitted-changes.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src-tauri/migrations/0010_project_completion_policy.sql
- src-tauri/migrations/0011_completion_attempts.sql
- src-tauri/src/commands/issue_commands.rs
- src-tauri/src/commands/project_commands.rs
- src-tauri/src/core/agent_session_service.rs
- src-tauri/src/core/issue_service.rs
- src-tauri/src/core/project_service.rs
- src-tauri/src/db/completion_attempt_repository.rs
- src-tauri/src/db/issue_repository.rs
- src-tauri/src/db/migrations.rs
- src-tauri/src/db/mod.rs
- src-tauri/src/db/project_repository.rs
- src-tauri/src/lib.rs
- src-tauri/src/types/agent_session.rs
- src-tauri/src/types/completion_attempt.rs
- src-tauri/src/types/issue.rs
- src-tauri/src/types/mod.rs
- src-tauri/src/types/project.rs
- src-tauri/tests/agent_session.rs
- src-tauri/tests/issue.rs
- src-tauri/tests/local_data.rs
- src-tauri/tests/project.rs
- src-tauri/tests/settings.rs
- src/app/activity-router.tsx
- src/app/app-shell.tsx
- src/app/app.test.tsx
- src/app/app.tsx
- src/features/agents/agent-session-commands.ts
- src/features/agents/agents-activity.test.tsx
- src/features/agents/agents-activity.tsx
- src/features/issues/issue-commands.ts
- src/features/project/project-commands.ts
- src/features/settings/project-settings-activity.test.tsx
- src/features/settings/project-settings-activity.tsx

### Validation Commands

- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml --test project`
- `cargo test --manifest-path src-tauri/Cargo.toml --test local_data`
- `cargo test --manifest-path src-tauri/Cargo.toml --test settings`
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/settings/project-settings-activity.test.tsx src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx src/app/app.test.tsx`
- `pnpm test`
- `git diff --check`

### Validation Results

- `pnpm format`：通过；仅格式化本 story 相关前端文件，额外产生的无关格式化 diff 已在提交前移除。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test project`：通过，15/15。
- `cargo test --manifest-path src-tauri/Cargo.toml --test local_data`：通过，5/5。
- `cargo test --manifest-path src-tauri/Cargo.toml --test settings`：通过，5/5。
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`：通过，22/22。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：通过，30/30。
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`：通过，8/8。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test -- --run src/features/settings/project-settings-activity.test.tsx src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx src/app/app.test.tsx`：通过，8 files / 127 tests；存在既有 jsdom 警告 `HTMLCanvasElement.getContext()` 与 CSS stylesheet parsing，不影响结果。
- `pnpm test`：通过，8 files / 127 tests；存在相同既有 jsdom 警告，不影响结果。
- `git diff --check`：通过。

### Change Log

- 新增 Project 级 completion policy 的最小持久化与设置链路，并把 `list_projects` / `open_project` / `update_project_completion_policy` 返回结构统一到前端可消费的事实源。
- 新增 `completion_attempts` migration、类型和 repository，并在 clean-path 完成成功路径内完成一致性审计写入。
- 新增 clean direct completion 的 Rust command、Session Header gating、前端调用与确认交互，并补齐成功/失败测试护栏。
