---
baseline_commit: fbb58c0
---

# Story 4.5: 处理 Codex 进程 crashed

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望 Codex 异常退出时 Session 被明确标记为 crashed,
以便我不会把失败的 Agent Session 误认为已完成。

## Acceptance Criteria

1. 给定 Codex PTY 进程异常退出，当 Rust Core 收到异常退出信息时，AgentSession 状态变为 `crashed`，并且系统写入 SessionEvent。
2. 给定 crashed AgentSession 关联 `running` 或 `review` Issue，当状态更新完成时，Issue 不自动变为 `completed`，并且 UI 显示明确 crashed 状态。
3. 给定 Agents Activity 左侧列表渲染，当 Session 状态为 `crashed` 时，Session 出现在 Completed 展示分组、标记 `crashed`、提供日志入口或诊断入口，并且不显示不可执行的继续会话入口。

## Tasks / Subtasks

- [x] 复核并补齐 Rust Core 的异常退出状态落库与事件记录链路 (AC: 1)
  - [x] 复查 [src-tauri/src/core/agent_session_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/agent_session_service.rs) 的 `record_session_termination_in_data_dir`、PTY exit callback 与 `termination_reason`，确认非零退出码和缺失退出码都稳定映射到 `crashed`。
  - [x] 确认 `session_exited` 事件 payload 至少包含 `sessionId`、`issueId`、`status`、`exitCode`、`reason`、`logPath`，且跨边界字段保持 `camelCase`。
  - [x] 若发现 `crashed` 路径仍可能把 Session 写成 `closed`、漏写 `closed_at` 或重复写多条退出事件，仅在现有服务与 repository 范围内做最小修正。
- [x] 锁定 crashed Session 对 Issue 与 Agents / Inspector 可见性的产品边界 (AC: 2, 3)
  - [x] 复查 [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx)、[src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx)、[src/features/agents/issue-inspector.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/issue-inspector.tsx) 当前对 `crashed` 的渲染与动作 gating。
  - [x] 保证 crashed Session 留在 Completed 分组，关联 Issue 仍保持原业务状态，不自动进入 `completed`，且 UI 使用明确 `crashed` 文案而不是通用失败态。
  - [x] 本故事只交付 crashed 的显式可见性与动作收口；不提前实现 Story 4.6 的重启恢复、Epic 5 的完成确认，或真正的日志查看器，只允许复用现有日志/诊断入口。
- [x] 用测试覆盖异常退出链路与前端状态矩阵，防止回归 (AC: 1, 2, 3)
  - [x] Rust 测试覆盖：非零退出码会把 Session 标记为 `crashed`、只写一条 `session_exited` 事件，并保持关联 Issue 不自动完成。
  - [x] 前端测试覆盖：Completed 分组包含 `crashed` Session，Issue 详情 / Header 不暴露不可执行的继续会话入口，并显示明确 crashed 状态文案或标签。
  - [x] 若需要补事件或 DTO 断言，优先在现有 `agent_session.rs`、`issues-activity.test.tsx`、`agents-activity.test.tsx` 邻近测试中扩充，不新建无必要测试基建。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [x] 本 story 预计会修改 Rust 与 TypeScript 运行时逻辑及测试，默认至少执行：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml agent_session
pnpm test
git diff --check
```

## Dev Notes

### 关键假设与取舍

- 当前代码库已经把 `crashed` 作为正式 Session 状态纳入数据库约束、DTO 与前端枚举；Story 4.5 的重点是验证并补齐“异常退出 -> 状态/事件 -> UI 可见性”的闭环，而不是发明新状态。
- PRD / addendum 对 crashed 的最小可交付是“明确显示失败、Issue 不自动完成、提供日志或诊断入口”；本故事默认优先复用现有入口或占位，不额外设计完整日志查看器。
- Story 4.6 单独处理应用重启后的 `stopped` 恢复降级，因此 4.5 不提前动跨重启恢复逻辑；只关注进程仍在当前应用生命周期内异常退出的场景。

### 当前代码状态与修改指引

- [src-tauri/src/core/agent_session_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/agent_session_service.rs) 已在 `record_session_termination_in_data_dir` 中把 `exit_code != 0` 映射为 `AgentSessionStatus::Crashed`，并写入 `session_exited` 事件 payload；开发时先验证这条链路是否覆盖 PTY callback、重复上报幂等和关联 Issue 不自动完成。
- [src-tauri/tests/agent_session.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/tests/agent_session.rs) 已存在 `record_session_termination_marks_non_zero_exit_as_crashed_and_is_idempotent`，可直接扩展为更完整的行为护栏，而不是另起测试结构。
- [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 已把 `closed` / `crashed` / `stopped` 归入 Completed 分组；[src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx) 已在 crashed 场景隐藏 `Open Session`。Story 4.5 需要确认 Header、Issue 详情和 Completed 列表是否完整体现 PRD 对 crashed 的动作边界。
- 当前最可能的改动面是 `src-tauri/src/core/agent_session_service.rs`、相邻 repository / tests，以及 `src/features/agents`、`src/features/issues` 的显示层与测试。除非验证发现 DTO 缺字段，否则避免扩散到无关模块。

### 架构约束

- `crashed` 与 `stopped` 是跨边界统一状态字面量；前后端不得另造别名或把异常路径吞成通用失败态。[Source: `_bmad-output/planning-artifacts/architecture.md` §Code Naming Conventions, §Error Handling Patterns]
- 失败路径必须显式可见；`crashed`、`stopped`、`no_commit_detected`、`log_missing` 都必须是显式状态或错误码，不得静默改为成功。[Source: `_bmad-output/planning-artifacts/architecture.md` §Error Handling Patterns]
- React store 不是业务状态源；Session / Issue 状态事实必须来自 Rust Core command 返回或事件结果，不能在前端自行推导“已完成”。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns]
- 高频终端输出不写结构化事件；本故事仅依赖关键 `SessionEvent` 事实，不新增逐字符事件流。[Source: `_bmad-output/planning-artifacts/architecture.md` §Event System Patterns]

### UX 与文案约束

- crashed Session 必须在 Agents List / Header 中显式展示，进入 Completed 分组，并保留日志入口或诊断入口；不能把异常伪装成 completed，也不能显示不可执行的继续会话入口。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Session crashed]
- `attention`、`crashed`、`no commit detected` 等状态不能只靠颜色表达，必须有文本或可访问 label。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Accessibility Floor]
- addendum 的状态矩阵要求：`running -> crashed` 和 `review -> crashed` 都以 `Open Log` 为主动作，辅助保留打开 Issue Inspector，Issue 不自动 completed，resume 入口仅在后续故事明确实现后显示。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §Session Header / Issue 操作状态表]

### 前置故事信息

- Story 2.7 已建立 session log 与 exit event 的基础事实记录，4.5 应复用这条数据链路，而不是重写日志模型。
- Story 3.5 / 3.6 已区分 linked issue session 与 standalone session；4.5 需要同时确认两条路径在异常退出后的 UI 边界，但不改变“临时 session 不触发 Issue 流”的原则。
- Story 4.1 至 4.4 已建立 Session Header 与 Issue Inspector 的状态 gating；4.5 只在 `crashed` 状态上补齐异常可见性，不提前接入 Epic 5 的完成类操作。

### 非目标

- 不实现应用重启后的 `stopped` 恢复标记和恢复失败原因记录，那属于 Story 4.6。
- 不实现完整 Summary / Log View、日志文件缺失诊断页或新的窗口级错误面板。
- 不新增 resume 会话入口，不把 crashed Session 重新放回 Running，也不自动修复异常数据不一致。
- 不顺手重构 Agents Activity / Issues Activity 布局；若现有结构已满足 AC，优先补测试而不是重写组件。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 4 / Story 4.5 的故事定义、验收标准和与 4.6 / Epic 5 的边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-19、失败可见性、Completed 分组与 Open Log 需求。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — crashed / review / completed 的 Header 状态矩阵和动作边界。
- `_bmad-output/planning-artifacts/architecture.md` — Session 状态枚举、错误处理、事件与状态源约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Session crashed 的界面预期与可访问性要求。
- `_bmad-output/implementation-artifacts/2-7-record-session-logs-and-exit-events.md` — session log / exit event 的前置实现背景。
- `_bmad-output/implementation-artifacts/4-1-manually-mark-review-in-session-header.md`、`4-2-continue-fixes-during-review-without-returning-to-running.md`、`4-3-view-and-edit-linked-issue-in-issue-inspector.md`、`4-4-show-header-actions-based-on-issue-status.md` — Epic 4 已实现的 Header / Inspector / review 边界。
- `src-tauri/src/core/agent_session_service.rs`、`src-tauri/tests/agent_session.rs`、`src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx`、`src/features/issues/issues-activity.tsx`、`src/features/issues/issues-activity.test.tsx`、`src/features/agents/issue-inspector.tsx` — 本 story 的主要代码与测试锚点。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-08T19:59:05+08:00：`bmad-dev-workflow` preflight 读取完整 `sprint-status.yaml`，按顺序定位到首个 backlog story `4-5-handle-codex-process-crashed`，当前 `HEAD` 为 `fbb58c0`。
- 2026-06-08T20:00:xx+08:00：交叉核对 Epic 4.5、PRD FR-19、addendum crashed 状态矩阵、UX `Session crashed` 流程与架构失败可见性要求。
- 2026-06-08T20:00:xx+08:00：复查现有代码后确认仓库已具备 `crashed` 状态枚举、SessionExited 事件和 Completed 分组基础；本 story 的最小实现范围应围绕异常退出闭环与 UI/测试护栏展开。

### Completion Notes List

- 2026-06-08：create-story 已为 Story 4.5 生成开发上下文，并将范围收口为“处理 Codex 进程 crashed 的状态闭环与异常可见性”。
- 2026-06-08：已明确记录 4.5 与 4.6 的边界，避免把跨重启 `stopped` 恢复逻辑混入本 story。
- 2026-06-08：已把 Rust Core 现有 termination 逻辑、前端 Completed / crashed 显示护栏和 addendum 状态矩阵写入上下文，供 dev-story 直接消费。
- 2026-06-08：为 Agent Session 列表 DTO 透传 `logPath`，让 `crashed` 会话的 Header 可以复用系统 opener 提供 `Open Log` 入口，而不新增日志查看器或恢复入口。
- 2026-06-08：Agents Activity 对已结束会话改为显示显式状态字面量；`crashed` 会话在 Header 展示 `Status: crashed` 与 `Open Log`，其它状态继续保持最小动作集。
- 2026-06-08：补充 Rust 与前端测试，锁定 `crashed` 不自动完成 Issue、列表透传 `logPath`、Header 打开日志成功/失败路径，以及临时 session 刷新测试的稳定返回。

### File List

- _bmad-output/implementation-artifacts/4-5-handle-codex-process-crashed.md
- src-tauri/src/core/agent_session_service.rs
- src-tauri/src/db/agent_session_repository.rs
- src-tauri/src/types/agent_session.rs
- src-tauri/tests/agent_session.rs
- src/app/app.css
- src/features/agents/agent-session-commands.ts
- src/features/agents/agents-activity.tsx
- src/features/agents/agents-activity.test.tsx

### Validation Commands

- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_session`
- `pnpm test`
- `git diff --check`

### Validation Results

- `pnpm format`：通过；期间对无关文件 `src/features/agents/codex-terminal-snapshot.ts` 产生纯折行差异，已回退，不纳入本 story。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过；中途发现前端 `logPath` 类型不应强制所有测试数据提供，已将 TS DTO 收口为可选字段后重新通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx`：通过，8 个测试文件、120 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml agent_session`：通过；受过滤器影响实际执行了 `core::agent_session_service` 的 4 个单元测试和 `tests/agent_session.rs` 的 16 个测试。
- `pnpm test`：通过，8 个测试文件、120 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `git diff --check`：通过。

### Change Log

- 2026-06-08：创建 Story 4.5 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-08：补齐 Agent Session 列表 DTO 的 `logPath` 透传和 repository 映射，扩展 Rust 测试以锁定 `crashed` 不自动完成关联 Issue。
- 2026-06-08：在 Agents Activity 为 `crashed` 会话增加显式状态文案和 `Open Log` 入口，并补充前端成功/失败回归测试，状态推进到 `review`。
- 2026-06-08：完成自动 code review，未发现阻塞问题，状态推进到 `done`。

## Senior Developer Review (AI)

### Review Date

2026-06-08

### Outcome

Approved

### Findings Summary

- Clean review：本次 diff 只为 `crashed` 会话补齐最小可见性闭环，新增 `logPath` 透传、`Open Log` 入口与显式状态护栏；未发现越界实现、状态回归或验证缺口。

### Reviewer Notes

- Blind Hunter：`crashed` 会话仍留在 Completed 分组，且没有重新暴露 `Open Session`、resume 或完成类入口。
- Edge Case Hunter：`Open Log` 失败路径已通过前端测试覆盖；临时 session 刷新测试增加稳定返回后没有引入新的状态抖动。
- Acceptance Auditor：AC1 由 Rust termination 测试和 `logPath` 透传覆盖；AC2 与 AC3 由 Agents Activity / Issues Activity 的回归测试和最终手动审阅共同满足。
