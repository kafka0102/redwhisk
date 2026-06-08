---
baseline_commit: eda4c7b
---

# Story 4.1: 在 Session Header 中手动 Mark Review

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望手动把 running Issue 标记为待验收,
以便我可以明确进入人工 review 阶段，而不是让系统替我判断。

## Acceptance Criteria

1. 给定当前 AgentSession 关联一个 `running` Issue，当 Session Header 渲染时，Header 显示 Issue title，并且主按钮显示 `Mark Review`。
2. 给定用户点击 `Mark Review`，当 Rust Core 校验 Issue 为 `running` 且存在关联 AgentSession 时，Issue 状态变为 `review`，并且 AgentSession 保持 `running`。
3. 给定 Mark Review 成功，当状态更新完成时，系统写入 IssueAction，并且前端通过 command 返回或 event 刷新 Header 与 Issues Activity。

## Tasks / Subtasks

- [x] 在 Rust Core 中新增 Mark Review 业务命令，保持 Issue 状态 source of truth 在核心层 (AC: 2, 3)
  - [x] 新增 `MarkIssueReviewInput`，字段至少包含 `project_id` 与 `issue_id`，遵循跨 Tauri 边界 `camelCase` 序列化。
  - [x] 在 `IssueService` 中新增 `mark_issue_review`，先校验 Project 存在，再校验 Issue 属于该 Project、状态为 `running`，且存在关联 AgentSession。
  - [x] 成功时在同一事务中把 Issue 更新为 `review`，写入 `IssueActionType::IssueReviewMarked`，payload 至少包含前后状态与 linked session id。
  - [x] 明确不改变 `agent_sessions.status`、PTY 生命周期、terminal 日志和 SessionEvent 既有行为。
- [x] 暴露 Tauri command 与前端 command wrapper (AC: 1, 2, 3)
  - [x] 在 `src-tauri/src/commands/issue_commands.rs` 暴露 `mark_issue_review`，并在 `src-tauri/src/lib.rs` 注册到 `generate_handler!`。
  - [x] 在 `src/features/issues/issue-commands.ts` 增加 `markIssueReview` wrapper 与输入类型，复用现有 `invokeCommand` 错误通道。
  - [x] 如果前端 Agents 侧需要 Issue 状态字段，优先扩展现有 `AgentSessionListItem` 投影，避免在 UI 中自行推导或缓存核心状态。
- [x] 在 Agents Activity 的 Session Header 中接入 `Mark Review` 操作 (AC: 1, 3)
  - [x] 复查 `src/features/agents/agents-activity.tsx` 当前 toolbar / linked issue pane 结构；在当前 session 关联 `running` Issue 时展示 Issue title 与 `Mark Review` 主按钮。
  - [x] 点击按钮后调用 `markIssueReview`，成功后刷新 `listAgentSessions(projectId)`，确保 Header / linked issue 信息与 Issues Activity 下次查询一致。
  - [x] 失败时在现有 `issues-status` / command error 模式内显示错误，不卸载 `CodexTerminal`，不关闭当前 running Session。
  - [x] 保持无关联 Session 不显示 Issue 操作；`review`、`completed`、`backlog` 或异常状态不显示 `Mark Review`。
- [x] 用回归测试锁定状态转换、审计和 UI 显示规则 (AC: 1, 2, 3)
  - [x] Rust 测试覆盖：running Issue + linked running AgentSession 可以标记 review；Issue 更新为 `review`；AgentSession 仍为 `running`；新增 `IssueReviewMarked` action。
  - [x] Rust 测试覆盖：非 running Issue、无 linked AgentSession、跨 Project issue 均拒绝，并且不写入 IssueAction、不改变状态。
  - [x] 前端测试覆盖：linked running Issue 的 Header 显示标题与 `Mark Review`；点击成功后调用 command 并刷新 session list。
  - [x] 前端测试覆盖：standalone Session、review Issue、completed Issue 不显示 `Mark Review`，并保持 xterm 容器存在。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [x] 本 story 预计会修改 TypeScript / TSX 与 Rust 运行时 / 测试逻辑，默认至少执行：

```bash
pnpm format
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm typecheck
pnpm test -- --run src/features/agents/agents-activity.test.tsx
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --test issue
cargo test --manifest-path src-tauri/Cargo.toml --test agent_session
cargo test --manifest-path src-tauri/Cargo.toml
```

### Review Findings

- [x] [Review][Patch] Mark Review 的校验与写入不在同一事务内 [src-tauri/src/core/issue_service.rs:97]
- [x] [Review][Patch] Mark Review 成功但刷新失败时 Header 可能保留旧按钮 [src/features/agents/agents-activity.tsx:198]
- [x] [Review][Patch] Mark Review 本地 review 状态可能被旧轮询响应覆盖 [src/features/agents/agents-activity.tsx:89]
- [x] [Review][Patch] Mark Review command 失败后 Header 可能继续显示无效按钮 [src/features/agents/agents-activity.tsx:198]
- [x] [Review][Patch] AgentSession list 投影未按 project 约束 joined Issue [src-tauri/src/db/agent_session_repository.rs:61]

## Dev Notes

### 关键假设与取舍

- Story 4.1 是 Epic 4 的入口，只交付“人工进入 review”的明确动作；不交付 Story 4.2 的 review 阶段继续修正、不交付 Story 4.3 的 Issue Inspector 编辑、不交付 Epic 5 的完成策略或 commit 检测。
- `review` 是 Issue 状态，不是 AgentSession 状态，也不是 Agents Session list 分组。点击 `Mark Review` 后，AgentSession 必须继续保持 `running`。
- 前端不得直接把 Issue 改为 `review`；状态转换、校验、持久化和 IssueAction 写入必须由 Rust Core 完成。
- 现有右侧 linked issue pane 仍是当前实现基础。实现可以在既有 toolbar / info pane 结构上做最小调整，但不能为了本 story 重做整个 Agents Activity 布局。

### 当前代码状态与修改指引

- `src/features/agents/agents-activity.tsx` 当前只从 `selectedSession.issueId` 与 `issueTitle` 派生 `linkedIssue`，并在右侧 info pane 展示 Issue 标题和跳转按钮；还没有根据 Issue 状态展示 Header 主按钮。
- `src/features/agents/agent-session-commands.ts` 的 `AgentSessionListItem` 当前包含 `issueId`、`issueTitle`、`status`、`attention`，不包含 linked Issue status。若 UI 需要区分 `running` / `review` Issue，应由 Rust list projection 返回该字段，而不是在 React 里猜测。
- `src/features/issues/issue-commands.ts` 已有 `listIssues`、`createIssue`、`updateIssue`、`startAgentSession` wrapper；`markIssueReview` 应放在这里，保持 Issue 状态命令集中。
- `src-tauri/src/core/issue_service.rs` 当前负责 Issue 创建、列表、编辑，并在创建时写入 `IssueActionType::IssueCreated`；Mark Review 应放在同一 service 中，复用 `ensure_project_exists`、`IssueRepository::update_status_in_transaction` 与 `EventRepository`。
- `src-tauri/src/db/issue_repository.rs` 已有 `update_status_in_transaction`；如果新增查找 linked session 的能力，优先通过 repository / service 明确查询 `agent_sessions.issue_id = issue.id`，不要通过前端传入 session id 作为信任依据。
- `src-tauri/src/types/issue_action.rs` 当前仅有 `IssueCreated` 与 `AgentSessionStarted`；需要新增 `IssueReviewMarked`，字符串值应为 `issue_review_marked`，与架构事件命名 `issue-review-marked` 保持语义一致但不混淆存储格式。
- `src-tauri/src/lib.rs` 的 `generate_handler!` 需要注册新 command，否则前端 wrapper 会在运行时失败。

### 架构约束

- Tauri command 使用 `snake_case` 动词短语；前端 wrapper 使用 `camelCase`。本 story command 预期为 `mark_issue_review` / `markIssueReview`。[Source: `_bmad-output/planning-artifacts/architecture.md` §API / Command Naming Conventions]
- 业务状态变化必须由 Rust Core 完成，React store 只保存 view state、选中项和查询缓存；`running`、`review`、`completed` 等状态不得由前端直接 set。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns]
- Issue 与 AgentSession 状态更新必须来自 command 返回或 core event；本 story 可以先通过 command 返回后刷新列表完成 UI 一致性，不要求提前实现事件总线。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns]
- SQLite timestamp 继续使用 Unix epoch milliseconds；本 story 不需要新增表或 migration，除非实现发现 `issue_actions` 约束阻止新增 action type。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Architecture]

### UX 与文案约束

- 当前 Agent Session 关联 Issue 时，右侧 Session Header 显示 Issue 标题；`running` Issue 的 Header 主按钮为 `Mark Review`。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-25]
- `Mark Review` 只在 `running` Issue 且存在关联 Agent Session 时显示。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-17]
- 打开 Inspector、点击 Header 操作或刷新 linked issue 信息不得卸载 xterm / PTY；本 story 的错误状态也不能替换掉 terminal 主体。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Modal discipline, §State Patterns]
- 核心命令文案需要支持 i18n，最终状态文案包含 `review=待验收`，但本 story 不需要一次性完成全部 Epic 4/5 文案扩展。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-26]

### 前置故事信息

- Story 2.5 已建立 Agents Activity 的基础 Session list 与右侧 Session 工作区。
- Story 2.7 已建立 Session 日志与退出事件边界；Story 4.1 不改变终端日志与 PTY 生命周期。
- Story 3.6 已明确 standalone Session 不触发 Issue 流转；本 story 必须保持该隔离，standalone Session 不显示 `Mark Review`，也不能写入 IssueAction。
- 最近提交显示 Epic 3 收口在临时 Session 隔离回归测试，说明当前代码倾向通过小步测试锁定边界；Story 4.1 应延续这种方式，不做大范围布局重构。

### 非目标

- 不新增 Completion Confirmation、`Complete Manually`、`Complete with Agent Commit`、Summary / Log View。
- 不实现 Issue Inspector 编辑、Inspector 开关行为或点击 Issue title 打开 Inspector 的完整交互。
- 不新增自动判断 Codex 是否完成的逻辑；是否进入 review 完全由用户点击决定。
- 不把 `review` Issue 重新变回 `running`，这属于 Story 4.2 的继续修正语义。

### 测试要求

- TypeScript / TSX 修改后必须运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`，并因本 story 涉及渲染逻辑和 command 数据流，运行 `pnpm test -- --run src/features/agents/agents-activity.test.tsx` 与 `pnpm test`。
- Rust Core / repository / command 修改后必须运行 `cargo fmt --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml --test issue`，并因 linked AgentSession 校验涉及 session 边界，运行 `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session` 与 `cargo test --manifest-path src-tauri/Cargo.toml`。
- 所有实际执行的验证命令必须逐条写入 Dev Agent Record；未运行的命令不能写成“已验证”。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 4 与 Story 4.1 的需求、验收标准和相邻故事边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-17、FR-25、FR-26、NFR2 / NFR3。
- `_bmad-output/planning-artifacts/architecture.md` — command 命名、React/Rust 状态边界、事件与数据结构约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Agents Header、review 状态、xterm 不卸载约束。
- `_bmad-output/implementation-artifacts/3-6-ensure-temporary-session-does-not-trigger-issue-flow.md` — standalone Session 与 Issue 工作流隔离的前置约束。
- `src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx` — 前端显示与回归测试入口。
- `src/features/issues/issue-commands.ts` — 前端 Issue command wrapper 入口。
- `src-tauri/src/core/issue_service.rs`、`src-tauri/src/db/issue_repository.rs`、`src-tauri/src/types/issue_action.rs`、`src-tauri/src/commands/issue_commands.rs`、`src-tauri/src/lib.rs` — 后端 Mark Review 命令、状态转换与审计入口。
- `src-tauri/tests/issue.rs`、`src-tauri/tests/agent_session.rs` — Rust 状态转换、审计与 linked session 回归测试入口。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-08T09:08:54+08:00：`bmad-dev-workflow` preflight 读取 `sprint-status.yaml`，确认当前无 `ready-for-dev` story，按顺序锁定 `4-1-manually-mark-review-in-session-header`，基线 `HEAD` 为 `eda4c7b`。
- 2026-06-08T09:08:54+08:00：交叉核对 Epic 4.1、PRD FR-17 / FR-25 / FR-26、UX Agents Header 规则、Architecture 的 React/Rust 状态边界，以及 Story 3.6 的 standalone Session 隔离约束。
- 2026-06-08T09:08:54+08:00：复查当前代码后确认 `mark_issue_review` 命令、`IssueReviewMarked` action type、前端 `markIssueReview` wrapper 和 Header `Mark Review` UI 尚不存在；已将这些作为 story 的最小实现路径。
- 2026-06-08T09:22:29+08:00：用户批准进入开发阶段，`bmad-dev-story` 开始执行 Story 4.1；保留既有 `baseline_commit: eda4c7b`，先将 story 与 sprint 状态推进到 `in-progress`。
- 2026-06-08T09:27:18+08:00：RED 阶段新增 Rust 与前端回归测试；Rust 失败在缺少 `MarkIssueReviewInput`、`IssueService::mark_issue_review`、`IssueReviewMarked`，前端失败在缺少 `Mark Review` 按钮，符合预期。
- 2026-06-08T09:36:04+08:00：GREEN 阶段实现 Rust Core 状态转换、Tauri command、前端 wrapper、AgentSession linked Issue status 投影和 Agents Header `Mark Review` 操作；定点回归通过。
- 2026-06-08T09:38:14+08:00：完成格式化、lint、typecheck、前端测试、Rust 定点与全量测试，Story 4.1 状态推进到 `review`。
- 2026-06-08T10:15:17+08:00：Review follow-up 修复 2 个 patch finding：`mark_issue_review` 改为在同一事务内完成状态校验、linked running session 校验、条件更新和 IssueAction 写入；前端在 Mark Review command 成功后先本地更新 matching session 的 `issueStatus` 为 `review`，再刷新 session list，避免刷新失败时 Header 保留旧按钮。
- 2026-06-08T10:57:13+08:00：第二轮 re-review 修复 3 个 patch finding：前端对所有 session list 响应叠加本地已确认 review 的 Issue 状态，避免旧轮询响应覆盖；Mark Review command 失败后刷新 session list 但保持 terminal mounted；AgentSession list 投影的 Issue join 增加 project 约束。
- 2026-06-08T11:04:24+08:00：最终三层 re-review 完成，Blind Hunter、Edge Case Hunter、Acceptance Auditor 均为 clean，Story 4.1 状态推进到 `done`。

### Completion Notes List

- 2026-06-08：create-story 已为 Story 4.1 生成开发上下文，并将范围收口为“linked running Issue 的手动 Mark Review 状态转换与审计”。
- 2026-06-08：已显式记录 Story 4.1 与 Story 4.2 / 4.3 / Epic 5 的非范围边界，避免提前混入继续修正、Inspector 编辑或 Completion 功能。
- 2026-06-08：新增 `mark_issue_review` Rust Core 命令，校验 Project、Issue 状态和 linked running AgentSession 后在事务内更新 Issue 为 `review` 并写入 `IssueReviewMarked`。
- 2026-06-08：Agent Session list 增加 linked Issue status 投影，Agents Header 仅在 linked `running` Issue + running Session 时显示 `Mark Review`；成功后刷新 session list，失败时保留 terminal 并显示 command error。
- 2026-06-08：补齐 Rust 与前端回归测试，覆盖成功转换、非 running / 无 linked session / 跨 Project 拒绝、standalone / review / completed 不显示 `Mark Review`。
- 2026-06-08：Review follow-up 已修复两个 patch finding；新增前端刷新失败回归测试，Rust Core 的 Mark Review 校验、条件更新和审计写入现在位于同一事务。
- 2026-06-08：第二轮 re-review 已修复并发轮询 stale UI、command 失败后刷新和跨 Project Issue 投影边界；新增前端旧轮询响应、command 失败刷新和 Rust 跨 Project 投影回归测试。
- 2026-06-08：最终 Blind Hunter、Edge Case Hunter、Acceptance Auditor re-review 均未发现剩余问题。

### File List

- _bmad-output/implementation-artifacts/4-1-manually-mark-review-in-session-header.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src-tauri/src/commands/issue_commands.rs
- src-tauri/src/core/agent_session_service.rs
- src-tauri/src/core/issue_service.rs
- src-tauri/src/db/agent_session_repository.rs
- src-tauri/src/db/event_repository.rs
- src-tauri/src/db/issue_repository.rs
- src-tauri/src/lib.rs
- src-tauri/src/types/agent_session.rs
- src-tauri/src/types/issue.rs
- src-tauri/src/types/issue_action.rs
- src-tauri/tests/issue.rs
- src/app/app.css
- src/features/agents/agent-session-commands.ts
- src/features/agents/agents-activity.test.tsx
- src/features/agents/agents-activity.tsx
- src/features/issues/issue-commands.ts

### Validation Commands

- `cargo test --manifest-path src-tauri/Cargo.toml --test issue mark_issue_review`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx -t "Mark Review|mark review"`
- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `git diff --check`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx -t "older polling response|command fails|refreshing sessions fails|Mark Review|mark review"`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session list_agent_sessions_does_not_project_issue_from_another_project`
- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `git diff --check`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx -t "refreshing sessions fails|Mark Review|mark review"`
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue mark_issue_review`
- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

### Validation Results

- `cargo test --manifest-path src-tauri/Cargo.toml --test issue mark_issue_review`：RED 阶段失败，原因是缺少 `MarkIssueReviewInput`、`IssueService::mark_issue_review` 和 `IssueActionType::IssueReviewMarked`；GREEN 后通过，4 个 Mark Review 相关 Rust 测试通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx -t "Mark Review|mark review"`：RED 阶段失败，原因是缺少 `Mark Review` 按钮；GREEN 后通过，相关前端测试通过。
- `pnpm format`：通过；Prettier 曾对无关文件 `src/features/agents/codex-terminal-snapshot.ts` 产生折行差异，已回退，不纳入本 story。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`：通过，8 个测试文件、108 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`：通过，18 个 `issue` 测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：通过，25 个 `agent_session` 测试通过。
- `pnpm test`：通过，8 个测试文件、108 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，Rust 单元测试与集成测试全部通过。
- `git diff --check`：通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx -t "refreshing sessions fails|Mark Review|mark review"`：Review follow-up RED 阶段新增刷新失败测试后失败，原因是 Mark Review command 成功但 session list 刷新失败时按钮仍显示；修复后通过，109 个前端测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue mark_issue_review`：Review follow-up 后通过，4 个 Mark Review 相关 Rust 测试通过。
- `pnpm format`：Review follow-up 后通过；Prettier 再次对无关文件 `src/features/agents/codex-terminal-snapshot.ts` 产生折行差异，已手动恢复，不纳入本 story。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：Review follow-up 后通过。
- `pnpm lint`：Review follow-up 后通过。
- `pnpm typecheck`：Review follow-up 后通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`：Review follow-up 后通过，8 个测试文件、109 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`：Review follow-up 后通过，18 个 `issue` 测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：Review follow-up 后通过，25 个 `agent_session` 测试通过。
- `pnpm test`：Review follow-up 后通过，8 个测试文件、109 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml`：Review follow-up 后通过，Rust 单元测试与集成测试全部通过。
- `git diff --check`：Review follow-up 后通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx -t "older polling response|command fails|refreshing sessions fails|Mark Review|mark review"`：第二轮 re-review 后通过，8 个测试文件、111 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session list_agent_sessions_does_not_project_issue_from_another_project`：第二轮 re-review 后通过，1 个跨 Project Issue 投影测试通过。
- `pnpm format`：第二轮 re-review 后通过；Prettier 再次对无关文件 `src/features/agents/codex-terminal-snapshot.ts` 产生折行差异，已手动恢复，不纳入本 story。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：第二轮 re-review 后通过。
- `pnpm lint`：第二轮 re-review 后通过。
- `pnpm typecheck`：第二轮 re-review 后通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`：第二轮 re-review 后通过，8 个测试文件、111 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`：第二轮 re-review 后通过，18 个 `issue` 测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：第二轮 re-review 后通过，26 个 `agent_session` 测试通过。
- `pnpm test`：第二轮 re-review 后通过，8 个测试文件、111 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml`：第二轮 re-review 后通过，Rust 单元测试与集成测试全部通过。
- `git diff --check`：第二轮 re-review 后通过。

### Change Log

- 2026-06-08：创建 Story 4.1 开发上下文并准备将状态推进到 `ready-for-dev`。
- 2026-06-08：进入开发阶段，Story 4.1 状态推进到 `in-progress`。
- 2026-06-08：实现手动 Mark Review 的核心状态转换、前端 Header 操作和审计回归测试，Story 4.1 状态推进到 `review`。
- 2026-06-08：完成 AI code review，发现 2 个 patch 级问题并作为 action items 留在 story 中，Story 4.1 状态退回 `in-progress`。
- 2026-06-08：完成 review follow-up 修复与验证，2 个 Review Patch action items 已处理，Story 4.1 状态重新推进到 `review`。
- 2026-06-08：完成第二轮 re-review follow-up 修复与验证，3 个新增 Review Patch action items 已处理，Story 4.1 保持 `review` 等待最终 re-review。
- 2026-06-08：最终 re-review clean，Story 4.1 状态推进到 `done`。

## Senior Developer Review (AI)

### Review Date

2026-06-08

### Outcome

Approved

### Findings Summary

- Patch：`mark_issue_review` 在事务外完成 Issue 状态与 linked running AgentSession 校验，随后才开启事务更新和写入 IssueAction；校验与写入之间存在竞态窗口。
- Patch：前端 `Mark Review` command 成功后如果刷新 `listAgentSessions` 失败，错误会显示出来，但本地 session 状态仍可能保留 `running`，导致 Header 继续显示旧按钮。

### Reviewer Notes

- Blind Hunter 与 Edge Case Hunter 均指出事务一致性问题，合并为同一个 patch finding。
- Edge Case Hunter 额外指出刷新失败后的 stale UI 问题。
- Acceptance Auditor 未发现额外验收标准缺口。

### Re-review Follow-up

- 第二轮 Blind Hunter / Edge Case Hunter 指出本地 review 状态可能被旧轮询响应覆盖，已通过本地 `reviewedIssueIds` overlay 应用于所有 session list 响应修复。
- Edge Case Hunter 指出 Mark Review command 失败后可能继续显示无效按钮，已在 command 失败后补偿刷新 session list，同时保留 terminal mounted。
- Edge Case Hunter 指出 AgentSession list 投影未在 `LEFT JOIN issues` 中约束 project，已增加 `issues.project_id = agent_sessions.project_id`，并补跨 Project 投影回归测试。

### Final Re-review

- Blind Hunter：Clean review.
- Edge Case Hunter：Clean review.
- Acceptance Auditor：Clean review；AC1 / AC2 / AC3、两轮 Review Findings 修复与测试覆盖均满足，未发现越界实现。
