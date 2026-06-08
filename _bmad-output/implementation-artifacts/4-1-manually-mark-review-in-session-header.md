---
baseline_commit: eda4c7b
---

# Story 4.1: 在 Session Header 中手动 Mark Review

Status: ready-for-dev

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

- [ ] 在 Rust Core 中新增 Mark Review 业务命令，保持 Issue 状态 source of truth 在核心层 (AC: 2, 3)
  - [ ] 新增 `MarkIssueReviewInput`，字段至少包含 `project_id` 与 `issue_id`，遵循跨 Tauri 边界 `camelCase` 序列化。
  - [ ] 在 `IssueService` 中新增 `mark_issue_review`，先校验 Project 存在，再校验 Issue 属于该 Project、状态为 `running`，且存在关联 AgentSession。
  - [ ] 成功时在同一事务中把 Issue 更新为 `review`，写入 `IssueActionType::IssueReviewMarked`，payload 至少包含前后状态与 linked session id。
  - [ ] 明确不改变 `agent_sessions.status`、PTY 生命周期、terminal 日志和 SessionEvent 既有行为。
- [ ] 暴露 Tauri command 与前端 command wrapper (AC: 1, 2, 3)
  - [ ] 在 `src-tauri/src/commands/issue_commands.rs` 暴露 `mark_issue_review`，并在 `src-tauri/src/lib.rs` 注册到 `generate_handler!`。
  - [ ] 在 `src/features/issues/issue-commands.ts` 增加 `markIssueReview` wrapper 与输入类型，复用现有 `invokeCommand` 错误通道。
  - [ ] 如果前端 Agents 侧需要 Issue 状态字段，优先扩展现有 `AgentSessionListItem` 投影，避免在 UI 中自行推导或缓存核心状态。
- [ ] 在 Agents Activity 的 Session Header 中接入 `Mark Review` 操作 (AC: 1, 3)
  - [ ] 复查 `src/features/agents/agents-activity.tsx` 当前 toolbar / linked issue pane 结构；在当前 session 关联 `running` Issue 时展示 Issue title 与 `Mark Review` 主按钮。
  - [ ] 点击按钮后调用 `markIssueReview`，成功后刷新 `listAgentSessions(projectId)`，确保 Header / linked issue 信息与 Issues Activity 下次查询一致。
  - [ ] 失败时在现有 `issues-status` / command error 模式内显示错误，不卸载 `CodexTerminal`，不关闭当前 running Session。
  - [ ] 保持无关联 Session 不显示 Issue 操作；`review`、`completed`、`backlog` 或异常状态不显示 `Mark Review`。
- [ ] 用回归测试锁定状态转换、审计和 UI 显示规则 (AC: 1, 2, 3)
  - [ ] Rust 测试覆盖：running Issue + linked running AgentSession 可以标记 review；Issue 更新为 `review`；AgentSession 仍为 `running`；新增 `IssueReviewMarked` action。
  - [ ] Rust 测试覆盖：非 running Issue、无 linked AgentSession、跨 Project issue 均拒绝，并且不写入 IssueAction、不改变状态。
  - [ ] 前端测试覆盖：linked running Issue 的 Header 显示标题与 `Mark Review`；点击成功后调用 command 并刷新 session list。
  - [ ] 前端测试覆盖：standalone Session、review Issue、completed Issue 不显示 `Mark Review`，并保持 xterm 容器存在。
- [ ] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [ ] 本 story 预计会修改 TypeScript / TSX 与 Rust 运行时 / 测试逻辑，默认至少执行：

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

### Completion Notes List

- 2026-06-08：create-story 已为 Story 4.1 生成开发上下文，并将范围收口为“linked running Issue 的手动 Mark Review 状态转换与审计”。
- 2026-06-08：已显式记录 Story 4.1 与 Story 4.2 / 4.3 / Epic 5 的非范围边界，避免提前混入继续修正、Inspector 编辑或 Completion 功能。

### File List

- _bmad-output/implementation-artifacts/4-1-manually-mark-review-in-session-header.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml

### Validation Commands

### Validation Results

### Change Log

- 2026-06-08：创建 Story 4.1 开发上下文并准备将状态推进到 `ready-for-dev`。
