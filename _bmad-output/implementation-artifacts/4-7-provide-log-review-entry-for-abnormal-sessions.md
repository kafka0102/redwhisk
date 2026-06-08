---
baseline_commit: 4b3e706
---

# Story 4.7: 异常 Session 的日志复盘入口

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望对 crashed/stopped Session 打开日志,
以便我可以判断 Agent 到底执行到了哪里。

## Acceptance Criteria

1. 给定 AgentSession 状态为 `crashed` 或 `stopped`，当用户在 Session list 或 Header 选择打开日志时，系统通过记录的 `log_path` 打开或定位日志文件。
2. 给定日志路径存在但文件不可访问，当用户点击打开日志时，UI 显示明确错误，并且保留原始 `log_path` 供 Diagnostics 查看。
3. 给定异常 Session 仍关联 Issue，当用户查看 Header 或 Inspector 时，不显示会导致 `completed` 的完成确认，并且显示日志入口或诊断入口，且不显示继续会话入口，除非 Codex resume 能力已由 Spike 或后续 story 明确实现。

## Tasks / Subtasks

- [x] 补齐异常 Session 的日志复盘入口闭环 (AC: 1)
  - [x] 复查 [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx)、[src/features/agents/agent-session-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agent-session-commands.ts)、[src-tauri/src/core/agent_session_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/agent_session_service.rs) 当前 `logPath` 透传与 `Open Log` 行为，确认 Session list、Header 与数据层对 `crashed` / `stopped` 使用同一事实来源。
  - [x] 若 Session list 已支持 `Open Log`，优先在现有 Header / Inspector 边界内复用同一 opener 路径与状态 gating，不新建日志查看器、额外路由或并行动作体系。
  - [x] 如果实现需要补 DTO、command 或 Rust 映射，只在现有 `list_agent_sessions` / `list_issues` 边界内做最小修改，确保 `logPath` 与异常状态字面量跨边界一致。
- [x] 处理日志不可访问时的显式错误与诊断保留 (AC: 2)
  - [x] 复查现有前端 `openPath(...)` 失败分支，确保 crashed/stopped Session 点击 `Open Log` 失败时出现明确错误，而不是静默失败或误导为已打开。
  - [x] 保留原始 `logPath` 作为诊断事实；若当前 Inspector 尚未展示路径，可在不破坏现有布局的前提下提供最小可见性，但不要提前扩展完整 Diagnostics 页面。
  - [x] 明确区分“没有 `logPath`”与“有路径但无法打开”两类失败，必要时沿用现有 `command-error` 展示模式，不发明新的全局错误框架。
- [x] 收紧异常 Session 的动作边界，避免伪完成或伪恢复入口 (AC: 3)
  - [x] 复查 [src/features/agents/issue-inspector.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/issue-inspector.tsx)、[src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx) 与相关状态矩阵，保证 `crashed` / `stopped` 关联 Issue 不显示会导致 `completed` 的完成确认。
  - [x] 若 Header、Inspector 或 Issues Activity 仍残留 `Open Session`、继续会话占位或等价误导入口，只做最小收口；除非后续 story 明确实现 resume，否则不暴露继续会话入口。
  - [x] 延续 Story 4.5 / 4.6 已建立的 Completed 分组与显式状态文案，不重写布局、不顺手改造 Epic 5 的完成策略。
- [x] 用测试锁定日志入口、失败提示和动作 gating，防止回归 (AC: 1, 2, 3)
  - [x] 前端测试覆盖：`crashed` 与 `stopped` Session 在 Header 或 Session list 可触发 `Open Log`，成功时调用 opener，失败时显示明确错误。
  - [x] 前端测试覆盖：异常 Session 关联 Issue 的 Inspector / Issues Activity 不显示 `Open Session`、完成确认或伪恢复入口，同时保留诊断所需的状态与日志事实。
  - [x] 如需 Rust 测试，优先补充 `list_agent_sessions` / `list_issues` 对 `log_path`、`crashed`、`stopped` 的返回契约，不新建无必要测试基建。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [x] 本 story 预计会修改 TypeScript 渲染逻辑与测试，视实现范围可能触及 Rust command / DTO，默认至少执行：

```bash
pnpm format
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm typecheck
pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml agent_session
cargo test --manifest-path src-tauri/Cargo.toml issue
pnpm test
git diff --check
```

## Dev Notes

### 关键假设与取舍

- Story 4.5 已为异常退出的 `crashed` Session 提供基本 `Open Log` 能力，Story 4.6 又把应用重启后不可恢复 Session 正式收口为 `stopped`；4.7 的最小目标是把“异常 Session 的日志复盘入口”在 Header / Inspector / Issues 边界上补齐，而不是再发明新的日志产品形态。
- PRD 与 UX 的要求重点是“失败可见、可复盘、不伪装成 completed”；因此本故事默认优先复用 `@tauri-apps/plugin-opener` 的 `openPath` 能力和现有错误展示模式，不新增嵌入式日志 viewer、文件浏览器或 resume 流程。
- 若 `logPath` 已存在但文件不可访问，系统需要把它当作显式失败而不是空状态；本故事的事实保留优先级高于界面华丽度。

### 当前代码状态与修改指引

- [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 当前已对 `crashed` / `stopped` Session 提供 Header `Open Log` 按钮，并在 `openPath` 失败时通过现有错误状态展示反馈；实现时先核对这条链路是否已经完全满足 AC，缺口若存在应优先补在同一组件内。
- [src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx) 与 [src/features/agents/issue-inspector.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/issue-inspector.tsx) 已认识 `crashed` / `stopped` 状态，但当前 Inspector 动作区仍只有 `Open in Issues`；如 AC 要求 Header 或 Inspector 直接暴露日志或诊断入口，优先在现有动作区补最小按钮，而不是新建面板流转。
- [src/features/agents/agent-session-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agent-session-commands.ts) 已把 `logPath?: string | null` 暴露给前端；若异常 Issue 详情也需要消费日志路径，先确认是应扩展 `IssueRecord`，还是通过已选 Session 上下文复用，避免双源状态。
- [src-tauri/src/core/agent_session_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/agent_session_service.rs)、[src-tauri/src/db/agent_session_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/agent_session_repository.rs)、[src-tauri/src/db/issue_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/issue_repository.rs) 已持久化并返回 `log_path`、`crashed`、`stopped`；若测试显示命令层返回缺口，优先补这里，不在 UI 层拼接伪数据。

### 架构约束

- 失败路径必须显式可见；`crashed`、`stopped`、`no_commit_detected`、`log_missing` 都不能被通用成功态吞掉。[Source: `_bmad-output/planning-artifacts/architecture.md` §Error Handling Patterns]
- 状态枚举跨边界统一使用 `running`、`closed`、`crashed`、`stopped` 等既定字面量；不得在 UI 或命令层引入别名。[Source: `_bmad-output/planning-artifacts/architecture.md` §Code Naming Conventions]
- React 不是业务状态源；日志路径、Session 状态与异常事实应来自 Rust Core 和 command 返回，而不是前端按组件上下文猜测。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns]
- 本故事只补“日志复盘入口”这条最小链路，不扩大为跨应用恢复、Summary 面板或完成策略流程。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §M5 - Recovery Polish]

### 技术与库要求

- 前端继续使用现有 React 19 + TypeScript + Vitest 测试栈；不要因为一个日志入口新增状态管理框架或路由层抽象。
- `@tauri-apps/plugin-opener` v2 官方 JS API 仍以 `openPath(path, openWith?)` 为标准入口；若补动作按钮，应沿用这一官方接口而不是手写平台分支。
- Rust / Tauri 侧保持现有 Tauri 2 command 边界；只有在日志路径未透出到所需 DTO 时才最小扩展返回结构。

### UX 与文案约束

- `crashed` / `stopped` 必须显式显示，不自动 completed，并提供日志入口或诊断入口；不能显示不可执行的继续会话入口。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Session crashed, §App restart with live process lost]
- 日志缺失也要显示路径和错误，确保用户知道失败发生在哪，而不是只看到按钮无效。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §用户需要复盘]
- 异常状态不能只靠颜色表达；若新增日志入口附近的状态反馈，必须保留可见文本或可访问 label。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Accessibility Floor]

### 前置故事信息

- Story 2.7 已建立日志文件与 `session_exited` 结构化事件的基础事实记录；4.7 应复用现有 `log_path`，不重建日志模型。
- Story 4.5 已为 `crashed` 场景打通列表/Header 层的 `Open Log` 与显式状态；4.7 需要确认这一能力在异常 Session 的其它入口上是否仍有缺口。
- Story 4.6 已把应用重启后失活 Session 正式收口为 `stopped`，并保证它同样进入 Completed 分组；4.7 应沿用这一定义，不把 `stopped` 回退成 `crashed` 或 `closed`。
- Story 2.8 的 Spike 尚未给出可稳定交付的 resume 能力；因此 4.7 不能因为“方便复盘”而重新引入占位式继续会话按钮。

### Git 与最近提交情报

- 最近相关提交 `4a18372 feat: 处理 crashed 会话的日志入口与状态展示`、`4b3e706 feat: 标记重启后不可恢复的会话` 已分别落地 `crashed` 和 `stopped` 的最小闭环；本故事应优先沿用这些实现模式和测试位置，而不是另起平行实现。
- 如果本故事最终只涉及前端动作和测试，提交范围应收口在相关 TypeScript / 测试文件及 story/sprint 工件；若扩展 Rust DTO，再把对应 command / repository / Rust test 一并纳入，禁止混入无关格式化。

### 非目标

- 不实现新的日志查看器、嵌入式终端回放、Summary 页面或 Diagnostics 专页。
- 不实现真正的 resume / continue session 能力，也不保留不可执行的占位入口。
- 不扩展 Epic 5 的完成确认、commit 检测或 completed Issue 总结流。
- 不顺手重构 Agents / Issues 页面布局；若现有结构满足 AC，优先补动作和测试而不是改视觉。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 4 / Story 4.7 的故事定义、验收标准及与 4.5、4.6、Epic 5 的边界。
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-04.md` — 4.7 去除 resume 占位、收口为日志/诊断入口的变更背景。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-19、FR-24、失败可见性、Open Log 要求。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — Session Header / Issue 操作状态矩阵与 `open_log` 动作约束。
- `_bmad-output/planning-artifacts/architecture.md` — 状态字面量、失败可见性、Rust Core 权威事实来源约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — crashed/stopped 状态、Open Log、日志缺失与可访问性要求。
- `_bmad-output/implementation-artifacts/2-7-record-session-logs-and-exit-events.md`、`4-5-handle-codex-process-crashed.md`、`4-6-mark-unrecoverable-sessions-after-app-restart.md` — 相关前置实现与边界说明。
- `src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx`、`src/features/agents/issue-inspector.tsx`、`src/features/issues/issues-activity.tsx`、`src/features/issues/issues-activity.test.tsx`、`src/features/agents/agent-session-commands.ts`、`src-tauri/src/core/agent_session_service.rs`、`src-tauri/tests/agent_session.rs`、`src-tauri/tests/issue.rs` — 本 story 的主要代码与测试锚点。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-08T21:10:02+08:00：按 TDD 先为 `Issue Detail` / `Issue Inspector` 的异常 Session `Open Log` 入口及失败提示补测试，再运行定向前端测试确认当前缺少按钮而按预期失败。
- 2026-06-08T21:13:10+08:00：新增 Rust 契约断言 `list_issues_includes_linked_session_facts`，编译失败确认 `IssueRecord` 尚未透出 `linkedSessionLogPath`，缺口定位到 `src-tauri/src/types/issue.rs` 与 `src-tauri/src/db/issue_repository.rs`。
- 2026-06-08T21:16:29+08:00：最小实现 `linkedSessionLogPath` 透传，并在 [src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx) 与 [src/features/agents/issue-inspector.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/issue-inspector.tsx) 复用 `openPath` 补齐异常 Session 的 `Open Log` 和错误提示。
- 2026-06-08T21:24:36+08:00：完成 `pnpm format`、`cargo fmt`、`pnpm lint`、`pnpm typecheck`、受影响前端测试、Rust `agent_session` / `issue` 测试、全量 `pnpm test` 与 `git diff --check`；自动 code review clean。

### Completion Notes List

- 2026-06-08：create-story 已为 Story 4.7 生成开发上下文，并将范围收口为“异常 Session 的日志复盘入口与失败可见性补齐”。
- 2026-06-08：已明确 4.7 不能提前实现 resume、日志查看器或 Epic 5 的完成策略，只允许在现有 Header / Inspector / Issues 边界内做最小补强。
- 2026-06-08：已把 `logPath` 透传、`openPath` 官方 API、异常状态动作边界和建议验证命令写入上下文，供 dev-story 直接消费。
- 2026-06-08：为 `IssueRecord` 新增 `linkedSessionLogPath`，让 `list_issues` 返回异常会话的日志路径事实，而不是在前端拼接或猜测。
- 2026-06-08：Issue Detail 和 Issue Inspector 现在都能直接对 `crashed` / `stopped` 会话执行 `Open Log`，失败时显示明确错误，并显示原始 `log path` 供诊断查看。
- 2026-06-08：保持 `Open Session` 只对 `running` 会话可见，异常会话继续不暴露 resume / 完成类误导入口。

### File List

- _bmad-output/implementation-artifacts/4-7-provide-log-review-entry-for-abnormal-sessions.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- src-tauri/src/db/issue_repository.rs
- src-tauri/src/types/issue.rs
- src-tauri/tests/issue.rs
- src/features/agents/agents-activity.test.tsx
- src/features/agents/agents-activity.tsx
- src/features/agents/issue-inspector.tsx
- src/features/issues/issue-commands.ts
- src/features/issues/issues-activity.test.tsx
- src/features/issues/issues-activity.tsx

### Validation Commands

- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_session`
- `cargo test --manifest-path src-tauri/Cargo.toml issue`
- `pnpm test`
- `git diff --check`

### Validation Results

- `pnpm format`：通过；期间对无关文件 `src/features/agents/codex-terminal-snapshot.ts` 产生纯折行差异，已回退，不纳入本 story。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx`：通过；8 个测试文件、123 个测试通过，输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml agent_session`：通过；4 个 unit tests 与 16 个 `tests/agent_session.rs` 过滤后测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml issue`：通过；8 个相关 `agent_session` 过滤测试与 18 个 `tests/issue.rs` 测试通过。
- `pnpm test`：通过；8 个测试文件、123 个测试通过，输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `git diff --check`：通过。

### Change Log

- 2026-06-08：创建 Story 4.7 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-08：为 `list_issues` 增加 `linkedSessionLogPath` 透传，并在 Rust 测试中锁定异常会话日志路径契约。
- 2026-06-08：为 Issue Detail / Issue Inspector 增加异常 Session 的 `Open Log` 动作、失败提示与日志路径显示，状态推进到 `review`。
- 2026-06-08：完成自动 code review，未发现阻塞问题，状态推进到 `done`。

## Senior Developer Review (AI)

### Review Date

2026-06-08

### Outcome

Approved

### Findings Summary

- Clean review：本次 diff 只补异常 `crashed` / `stopped` 会话在 Issue Detail 与 Issue Inspector 的日志复盘入口，并通过 `linkedSessionLogPath` 保持跨边界事实一致；未发现阻塞问题。

### Reviewer Notes

- Blind Hunter：异常会话继续不显示 `Open Session` 或完成类入口，新增 `Open Log` 动作与需求一致。
- Edge Case Hunter：`openPath` 失败分支在 Issue Detail 与 Inspector 都有显式错误提示，同时保留原始日志路径文本，避免“按钮无效但原因不可见”。
- Acceptance Auditor：AC1 由 `linkedSessionLogPath` 透传和两个 UI 入口满足；AC2 由错误提示与 `Log path` 文本满足；AC3 由异常会话动作 gating 与测试覆盖满足。
