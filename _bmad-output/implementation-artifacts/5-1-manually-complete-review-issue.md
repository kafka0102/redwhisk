---
baseline_commit: 9efbc2f
---

# Story 5.1: 手动完成 Review Issue

Status: ready-for-dev

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望在 `manual` 策略下手动完成待验收 Issue,
以便我可以明确结束一个已经人工确认的任务。

## Acceptance Criteria

1. 给定当前 AgentSession 关联 `review` Issue，且当前生效 completion policy 为 `manual`，当 Session Header 渲染时，Header 显示 `Complete Manually` 主按钮。
2. 给定用户点击 `Complete Manually` 并确认，当 Rust Core 校验当前 Project、Issue 与 AgentSession 状态都满足手动完成条件时，AgentSession 状态变为 `closed`，Issue 状态变为 `completed`。
3. 给定手动完成成功，当状态更新完成时，系统写入可复盘的 IssueAction 与 SessionEvent，并且 completed Issue 不再显示 `Run`、`Mark Review`、`Complete Manually` 或其他完成类按钮。

## Tasks / Subtasks

- [ ] 补齐 manual completion 的核心状态闭环，只覆盖 Story 5.1 需要的最小路径 (AC: 2, 3)
  - [ ] 复查 [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs)、[src-tauri/src/db/issue_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/issue_repository.rs)、[src-tauri/src/db/agent_session_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/agent_session_repository.rs) 与 [src-tauri/src/db/event_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/event_repository.rs)，确定现有 `review -> completed` 与 `running -> closed` 事务边界是否已存在可复用原语。
  - [ ] 若缺少显式命令，按最小范围新增 Rust Core completion command，只允许 `review` Issue + linked `running` AgentSession 成功完成；不要顺手实现 5.2-5.6 的 Git 检测、CompletionAttempt 或 prompt 注入。
  - [ ] 在同一事务内完成状态校验、Issue 更新、AgentSession 关闭、IssueAction 写入与 SessionEvent 写入，避免“Issue 已 completed 但 Session 仍 running”之类的中间态。
- [ ] 把 manual completion 暴露到现有 Header 与 command 边界，不发明新页面流 (AC: 1, 2, 3)
  - [ ] 复查 [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx)、[src/features/issues/issue-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-commands.ts) 和相关 Tauri command，沿用 Story 4.1 `Mark Review` 的接线方式补 `Complete Manually`。
  - [ ] 若当前 completion policy 运行时读取尚未完整落地，优先采用项目当前默认的 `manual` 事实来源或最小可用读取路径，只满足 AC 所需显示与校验，不提前扩展 agent_auto_commit 分支。
  - [ ] 保持 Header 的 linked issue title / inspector 打开入口与 terminal 挂载连续性不变；完成成功后允许刷新到 completed 展示，但不要卸载或重建无关 UI 结构。
- [ ] 收紧 completed Issue 的 Header / Issue 操作 gating，避免伪入口残留 (AC: 3)
  - [ ] 复查 [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx)、[src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx) 与 [src/features/agents/issue-inspector.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/issue-inspector.tsx) 的 completed 路径，确保完成后不再显示 `Run`、`Mark Review`、`Complete Manually` 或其它未实现完成动作。
  - [ ] 本故事只需要把 completed 后的禁用/隐藏边界与手动完成闭环对齐；不要提前实现 Story 5.8 / 5.9 的 Summary、Open Log 入口增强。
- [ ] 用测试锁定 manual completion 的成功路径和状态护栏 (AC: 1, 2, 3)
  - [ ] Rust 测试覆盖：只有 `review` Issue + linked `running` AgentSession 能手动完成；成功后 Issue 为 `completed`、AgentSession 为 `closed`，并新增对应 IssueAction 与 SessionEvent。
  - [ ] Rust 测试覆盖：非 `review` Issue、无 linked running session、跨 Project 或已关闭 Session 的手动完成必须失败，且不产生部分写入。
  - [ ] 前端测试覆盖：review Header 在 manual 策略路径显示 `Complete Manually`，点击后调用 command 并刷新；completed 路径不再显示 `Run`、`Mark Review` 或 `Complete Manually`。
- [ ] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [ ] 本 story 预计会修改 TypeScript / TSX 渲染逻辑、Rust 核心状态事务与测试，默认至少执行：

```bash
pnpm format
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm typecheck
pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml --test issue
cargo test --manifest-path src-tauri/Cargo.toml --test agent_session
pnpm test
git diff --check
```

## Dev Notes

### 关键假设与取舍

- Story 5.1 只交付 `manual` completion 闭环，不交付 Git status 检测、CompletionAttempt、completion prompt 注入或 commit hash 检测；这些都属于 5.2-5.6 的后续范围。
- 当前仓库中还没有看到成型的 completion policy 运行时代码；本故事默认取舍是先打通 `manual` 路径，并把策略来源读取收敛到现有可用事实，不为未来策略系统提前铺复杂抽象。
- `completed` 是 Issue 状态，`closed` 是 AgentSession 状态；完成动作必须同时更新两者，并且写入与该状态转换直接对应的审计记录，不能只改其中一侧。

### 当前代码状态与修改指引

- [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 目前已经具备 linked issue title、`Mark Review`、`Open Log` 等 Header gating；Story 5.1 最可能在这里新增 `Complete Manually` 的显示与点击链路。
- [src/features/issues/issue-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-commands.ts) 当前只暴露 `listIssues`、`createIssue`、`updateIssue`、`markIssueReview`；手动完成大概率需要新增与 `markIssueReview` 对称的 command wrapper。
- [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs) 已经为 `mark_issue_review` 建立了“先校验，再事务内写 IssueAction”的模式；5.1 应优先沿用这一组织方式，而不是新开平行 service。
- [src-tauri/src/core/agent_session_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/agent_session_service.rs) 目前覆盖了 Session 启动、attention、prompt 注入、退出事件等能力；若关闭 session 需要复用或新增最小原语，应优先保持 AgentSession 状态事实写入仍由 Rust Core 控制。
- [src-tauri/src/types/issue_action.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/types/issue_action.rs) 与 [src-tauri/src/types/session_event.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/types/session_event.rs) 目前尚未出现 “issue completed” / “session closed” 对应枚举；若 Story 5.1 需要新增，命名必须与既有 `snake_case` 约定一致，并补齐 repository 反序列化分支与测试。

### 架构约束

- Issue / AgentSession / CompletionAttempt 状态变化只能通过 Rust Core command 完成；前端不得直接把核心状态设为 `completed` 或 `closed`。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns]
- 新增状态变更时，必须同时补 IssueAction 或 SessionEvent / CompletionAttempt，确保完成动作可审计、可复盘。[Source: `_bmad-output/planning-artifacts/architecture.md` §审计与可复盘]
- completed Issue 不是 reopen 流的开始；本故事只允许“完成后不再暴露运行/完成入口”，不实现 reopen 或回退语义。[Source: `_bmad-output/planning-artifacts/architecture.md` §Feature Mapping]
- 状态字面量跨边界统一使用 `review`、`completed`、`running`、`closed` 等既定字面量，不引入 `done`、`finished` 之类别名。[Source: `_bmad-output/planning-artifacts/architecture.md` §Code Naming Conventions]

### UX 与文案约束

- `review` Issue 在 `completion_policy=manual` 时，Session Header 主按钮应为 `Complete Manually`；确认成功后 AgentSession 关闭、Issue 完成。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-20]
- completed Issue 不显示 `Run`、`Mark Review`、`Complete Manually`、`Complete with Agent Commit`；本故事至少要把自己引入的 `Complete Manually` 在完成后收掉。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-23]
- addendum 的 Header 状态矩阵已经把 `review + running + manual` 定义为 `Complete Manually`，Story 5.1 应让当前实现开始与这张矩阵对齐，但不要一次实现 agent_auto_commit 其它分支。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §Session Header / Issue 操作状态表]

### 前置故事信息

- Story 4.1 已完成 `Mark Review` 的 Rust Core 校验、IssueAction 写入和 Header 接线；Story 5.1 最适合复用其 command / service / UI 组织方式。
- Story 4.2 已锁定 review 阶段继续修正时仍绑定同一 running Session；5.1 则是在这条 review 路径上补“明确收口为 completed”的下一步。
- Story 4.4 已显式要求 review Header 不提前显示未实现完成按钮；5.1 就是把其中的 `Complete Manually` 分支从“禁止占位”推进到“真实可用”。
- Story 4.7 已为异常 `crashed` / `stopped` Session 收口日志入口；5.1 不应混入异常完成、日志复盘或 Summary 逻辑。

### 非目标

- 不实现 `agent_auto_commit`、`Complete`、`Complete with Agent Commit`、Completion Confirmation、HEAD/Git status 检测或 commit hash 落库。
- 不实现 completed Issue Summary、Open Log 新入口或复盘页面增强。
- 不实现 completed Issue Reopen、回退到 review/running，或多 Session Attempt。
- 不顺手重构 settings / completion policy 全量配置系统；若策略读取缺口阻塞，只做满足 `manual` 的最小补足。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 5 / Story 5.1 的故事定义、验收标准和与 5.2-5.6 的边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-20、FR-23、FR-24 与完成状态可靠性约束。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — Header 状态矩阵、manual completion 动作定义、Session / Issue 状态投影。
- `_bmad-output/planning-artifacts/architecture.md` — Rust Core 单一写入路径、状态机一致性、审计与可复盘要求。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — completed / review 闭环、Summary / Log View 的后续边界。
- `_bmad-output/implementation-artifacts/4-1-manually-mark-review-in-session-header.md`、`4-2-continue-fixes-during-review-without-returning-to-running.md`、`4-4-show-header-actions-based-on-issue-status.md`、`4-7-provide-log-review-entry-for-abnormal-sessions.md` — 本 story 的直接前置实现与边界说明。
- `src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx`、`src/features/issues/issues-activity.tsx`、`src/features/issues/issues-activity.test.tsx`、`src/features/issues/issue-commands.ts`、`src-tauri/src/core/issue_service.rs`、`src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/db/issue_repository.rs`、`src-tauri/src/db/agent_session_repository.rs`、`src-tauri/src/db/event_repository.rs`、`src-tauri/src/types/issue_action.rs`、`src-tauri/src/types/session_event.rs`、`src-tauri/tests/issue.rs`、`src-tauri/tests/agent_session.rs` — 预计主要改动与测试锚点。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-08T21:43:26+08:00：`bmad-dev-workflow` preflight 读取完整 `sprint-status.yaml`，确认当前没有 `ready-for-dev` story，按顺序锁定 `5-1-manually-complete-review-issue`，基线 `HEAD` 为 `9efbc2f`。
- 2026-06-08T21:43:26+08:00：交叉核对 Epic 5.1、PRD FR-20 / FR-23、addendum Header 状态矩阵、architecture 的状态单一写入约束，以及 Story 4.1 / 4.2 / 4.4 / 4.7 的前置边界。
- 2026-06-08T21:43:26+08:00：复查仓库实现后确认 `completion policy` 运行时代码尚未成型；Story 5.1 的默认最小方案改为先打通 `manual` completion 闭环，不提前扩展 5.2-5.6 的 agent_auto_commit 能力。

### Completion Notes List

- 2026-06-08：create-story 已为 Story 5.1 生成开发上下文，并将范围收口为“manual completion 的最小可靠闭环”。
- 2026-06-08：已显式记录当前仓库缺少成型 completion policy 运行时代码这一歧义，默认选择先满足 `manual` 路径，而不是静默假设 5.2-5.6 依赖已存在。
- 2026-06-08：已把 Review Header gating、Rust Core 状态事务、IssueAction / SessionEvent 审计要求与 completed Issue 禁用边界写入上下文，供 dev-story 直接消费。

### File List

- _bmad-output/implementation-artifacts/5-1-manually-complete-review-issue.md
