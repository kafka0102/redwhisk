---
baseline_commit: 4a18372
---

# Story 4.6: 应用重启后标记不可恢复 Session

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望应用重启后看到无法恢复的运行中 Session 被明确标记,
以便我可以复盘异常而不是被误导为仍在运行。

## Acceptance Criteria

1. 给定应用关闭前存在 `running` AgentSession，当应用重启且无法恢复活 PTY 进程时，Rust Core 将该 AgentSession 标记为 `stopped`，并且系统写入 SessionEvent 说明恢复失败原因。
2. 给定 stopped/crashed AgentSession 关联 Issue，当用户查看 Issues Activity 或 Agents Activity 时，关联 Issue 不自动变为 `completed`，并且 UI 显示异常状态和日志入口。
3. 给定 AgentSession 状态为 `stopped`，当 UI、事件和持久化记录渲染或保存该状态时，`stopped` 使用正式状态枚举和 i18n 文案，并且 Completed 分组包含该 Session。

## Tasks / Subtasks

- [x] 补齐应用启动后的 Session 恢复巡检与 `stopped` 降级闭环 (AC: 1)
  - [x] 复查 [src-tauri/src/lib.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/lib.rs)、[src-tauri/src/app_state.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/app_state.rs) 与 [src-tauri/src/commands/agent_session_commands.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/commands/agent_session_commands.rs)，确认当前应用启动阶段尚未执行“历史 running Session 恢复巡检”，并在现有 Rust Core 边界内补上最小入口。
  - [x] 在 [src-tauri/src/core/agent_session_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/agent_session_service.rs) 或相邻核心层新增一次性恢复检查：仅扫描当前 Project 下持久化为 `running`、但内存 `PtySessionManager` 中不存在活 PTY 的 Session，并将其标记为 `stopped`。
  - [x] 为每个被降级的 Session 写入 `session_exited` 或等价 SessionEvent，payload 至少包含 `sessionId`、`issueId`、`status=stopped`、`reason`、`logPath`，明确说明“应用重启后未恢复到活 PTY”这一事实。
- [x] 锁定 `stopped` 状态对数据层、命令层与 UI 的统一口径 (AC: 1, 2, 3)
  - [x] 复核 [src-tauri/src/types/agent_session.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/types/agent_session.rs)、[src-tauri/src/db/agent_session_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/agent_session_repository.rs)、[src/features/agents/agent-session-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agent-session-commands.ts) 与相关 issue DTO，确保 `stopped` 在 Rust 枚举、SQLite 映射、Tauri command 返回和前端类型里保持同一正式字面量。
  - [x] 复查 [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx)、[src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx)、[src/features/agents/issue-inspector.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/issue-inspector.tsx) 对 `stopped` 的分组、显式文案、日志入口和动作 gating，保证异常 Session 不被继续当作活会话。
  - [x] 本故事只实现“重启后无法恢复时标记 stopped 的降级路径”；不提前实现真正的跨重启 resume、自动重新附着 PTY，或 Story 4.7 的完整日志复盘体验。
- [x] 用测试锁定重启恢复失败与 `stopped` 展示矩阵，防止回归 (AC: 1, 2, 3)
  - [x] Rust 测试覆盖：应用冷启动后巡检到持久化 `running` Session 且 `PtySessionManager` 无对应活会话时，会把 Session 更新为 `stopped`、只写一条恢复失败事件，并保持关联 Issue 原状态。
  - [x] 前端测试覆盖：Stopped Session 出现在 Completed 分组、显示显式 `stopped` 文案与日志入口，Issues Activity / Inspector 不把异常 Session 误导成可继续运行或已完成。
  - [x] 若需要补充命令层入口测试，优先扩展现有 [src-tauri/tests/agent_session.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/tests/agent_session.rs)、[src/features/agents/agents-activity.test.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.test.tsx)、[src/features/issues/issues-activity.test.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.test.tsx)，不要新建无必要测试基建。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [x] 本 story 预计会修改 Rust 与 TypeScript 运行时逻辑及测试，默认至少执行：

```bash
pnpm format
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm typecheck
pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml agent_session
pnpm test
git diff --check
```

## Dev Notes

### 关键假设与取舍

- 当前仓库已经有 `stopped` 状态枚举、数据库约束和前端分组能力，但没有真正的“应用重启后巡检 running Session 并降级”为 `stopped` 的启动闭环；本故事默认在现有边界内补齐这条最小恢复失败路径，而不是设计完整 resume 能力。
- 由于 `AppState::new()` 每次启动都会创建新的空 `PtySessionManager`，应用重启后的内存态天然不知道旧 PTY；因此本故事的事实判断应建立在“数据库仍为 running，但当前进程内不存在对应活会话”这一降级条件上，并明确把原因写入事件。
- Spike 2 只要求“恢复能力可验证或可降级”；本故事选择先落地降级路径，避免在恢复机制未被验证前暴露不可执行的继续会话入口。

### 当前代码状态与修改指引

- [src-tauri/src/commands/agent_session_commands.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/commands/agent_session_commands.rs) 当前每次列出 Session 时只会初始化本地数据并调用 `list_agent_sessions`，还没有任何启动后的恢复巡检；最小方案可以在这里或其下游 service 中，在查询前执行一次“reconcile unrecoverable running sessions”。
- [src-tauri/src/core/agent_session_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/agent_session_service.rs) 已具备 `record_session_termination_in_data_dir`、`list_agent_sessions`、`read_terminal_snapshot` 等核心入口，适合追加一个受控的恢复失败巡检方法，避免把状态机散落到 command 层。
- [src-tauri/src/db/agent_session_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/agent_session_repository.rs) 已支持 `mark_terminated_in_transaction(..., AgentSessionStatus::Stopped, ...)`；优先复用现有终止落库路径，而不是新增第二套状态更新 SQL。
- [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx)、[src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx)、[src/features/agents/issue-inspector.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/issue-inspector.tsx) 已认识 `stopped` 字面量；4.6 重点是确认日志入口、显式状态文案和动作 gating 与恢复失败事实一致，而不是重写布局。

### 架构约束

- `running`、`closed`、`crashed`、`stopped` 是跨边界统一状态字面量；前后端不得另造别名，也不能把恢复失败吞成通用错误。[Source: `_bmad-output/planning-artifacts/architecture.md` §Code Naming Conventions]
- 失败路径必须显式可见；`crashed`、`stopped`、`no_commit_detected`、`log_missing` 都必须是显式状态或错误码，不得伪装成成功。[Source: `_bmad-output/planning-artifacts/architecture.md` §Error Handling Patterns]
- React 不是业务状态源；应用重启后的 Session 状态修正必须由 Rust Core 完成并持久化，再由 command/event 暴露给 UI。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns]
- 高优先级实现顺序要求先补核心状态机与持久化事实，再让 UI 只消费结果；不要让前端根据 `isActive` 自己推导 `stopped`。[Source: `_bmad-output/planning-artifacts/architecture.md` §Decision Impact Analysis]

### UX 与文案约束

- `Session crashed/stopped` 必须在 Agents List/Header 中显式展示；关联 Issue 不自动 completed，提供日志入口或诊断入口。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Session crashed, §App restart with live process lost]
- `attention`、`crashed`、`no commit detected` 等状态不能只靠颜色表达；`stopped` 同样必须有文本或可访问 label。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Accessibility Floor]
- addendum 的状态矩阵要求 `running/crashed`、`review/crashed` 默认以 `Open Log` 为主动作；对 `stopped` 应沿用同一“异常且不可继续”口径，而不是暴露未实现的 resume。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §Session Header / Issue 操作状态表]

### 前置故事信息

- Story 2.7 已建立 Session log 与 exit event 的基础事实记录；4.6 应复用现有日志路径和 SessionEvent 模型，不重建日志体系。
- Story 2.8 的 Spike 结论允许“无法稳定恢复时降级为保留日志并提示用户手动处理”；4.6 正是在该降级路径上补产品化闭环。
- Story 4.5 已实现 `crashed` 的显式可见性与日志入口；4.6 应尽量复用这套异常展示护栏，只补“重启后失活”这一新的状态来源。

### 非目标

- 不实现真正的 `codex resume <session_id>` 或跨应用重启重新附着 PTY。
- 不实现新的日志查看器、Summary 面板或 Diagnostics 扩展页；如需日志入口，优先复用已有 opener 路径。
- 不把 `stopped` Session 自动改成 `crashed` 或 `closed`，也不自动修复关联 Issue 为 `completed`。
- 不顺手改造 Session 轮询、Activity 路由或 Project 打开流程；只处理与重启恢复失败直接相关的最小链路。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 4 / Story 4.6 的故事定义、验收标准以及与 4.5、4.7 的边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-19、`stopped` 状态语义、Completed 分组和失败可见性要求。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — Session Header / Issue 操作状态矩阵、数据模型与 Spike 2 降级口径。
- `_bmad-output/planning-artifacts/architecture.md` — 状态枚举、Rust Core 权威状态写入、事件约束与项目结构。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — `stopped=已停止` 的界面预期、日志入口与可访问性要求。
- `_bmad-output/implementation-artifacts/2-7-record-session-logs-and-exit-events.md`、`2-8-spike-codex-resume-and-completion-prompt-injection.md`、`4-5-handle-codex-process-crashed.md` — 相关前置实现与 Spike 结论。
- `src-tauri/src/lib.rs`、`src-tauri/src/app_state.rs`、`src-tauri/src/commands/agent_session_commands.rs`、`src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/db/agent_session_repository.rs`、`src-tauri/tests/agent_session.rs`、`src/features/agents/agents-activity.tsx`、`src/features/issues/issues-activity.tsx`、`src/features/agents/issue-inspector.tsx` — 本 story 的主要代码与测试锚点。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-08T20:31:06+08:00：`bmad-dev-workflow` preflight 读取完整 `sprint-status.yaml`，按顺序定位到首个 backlog story `4-6-mark-unrecoverable-sessions-after-app-restart`，当前 `HEAD` 为 `4a18372`。
- 2026-06-08T20:31:06+08:00：交叉核对 Epic 4.6、PRD FR-19、addendum 状态矩阵、UX `App restart with live process lost` 以及架构对 `stopped` 的正式状态约束。
- 2026-06-08T20:31:06+08:00：复查现有代码后确认仓库已有 `stopped` 枚举与 Completed 分组展示，但尚未在应用启动或 Session 查询链路中执行“running Session 无法恢复 -> stopped” 的 Rust Core 巡检。

### Completion Notes List

- 2026-06-08：create-story 已为 Story 4.6 生成开发上下文，并将范围收口为“应用重启后对不可恢复 running Session 的 stopped 降级闭环”。
- 2026-06-08：已明确 4.6 只实现恢复失败降级，不提前承诺真实 resume、完整日志复盘或 Epic 5 的完成类动作。
- 2026-06-08：已把启动链路缺少恢复巡检、`stopped` 的跨边界状态字面量约束、异常 UI 动作边界和建议验证命令写入上下文，供 dev-story 直接消费。
- 2026-06-08：在 Rust Core 增加 `reconcile_unrecoverable_running_sessions*`，让 `list_issues` 与 `list_agent_sessions` 在读取前统一把失活的持久化 `running` Session 降级为 `stopped` 并写入恢复失败事件。
- 2026-06-08：收紧 Issues Activity 的动作 gating；带 `stopped` / `crashed` 异常会话的 Issue 不再显示 `Open Session` 或禁用 `Run` 伪入口。
- 2026-06-08：Agents Activity 为 `stopped` 会话补显式状态文案与 `Open Log` 入口，并补充前端与 Rust 回归测试覆盖。

### File List

- _bmad-output/implementation-artifacts/4-6-mark-unrecoverable-sessions-after-app-restart.md
- src-tauri/src/commands/agent_session_commands.rs
- src-tauri/src/commands/issue_commands.rs
- src-tauri/src/core/agent_session_service.rs
- src-tauri/src/db/agent_session_repository.rs
- src-tauri/tests/agent_session.rs
- src/features/agents/agents-activity.tsx
- src/features/agents/agents-activity.test.tsx
- src/features/issues/issues-activity.tsx
- src/features/issues/issues-activity.test.tsx

### Validation Commands

- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml reconcile_unrecoverable_running_sessions_marks_session_stopped_and_records_restart_reason`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_session`
- `cargo test --manifest-path src-tauri/Cargo.toml issue`
- `pnpm test`
- `git diff --check`

### Validation Results

- `pnpm format`：通过；期间对无关文件 `src/features/agents/codex-terminal-snapshot.ts` 产生纯折行差异，已回退，不纳入本 story。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx`：通过；8 个测试文件、120 个测试通过，输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml reconcile_unrecoverable_running_sessions_marks_session_stopped_and_records_restart_reason`：通过；新增恢复失败降级测试单独通过。
- `cargo test --manifest-path src-tauri/Cargo.toml agent_session`：通过；4 个单元测试和 16 个 `tests/agent_session.rs` 集成测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml issue`：通过；8 个 `agent_session` 过滤到的相关测试与 18 个 `tests/issue.rs` 测试通过。
- `pnpm test`：通过；8 个测试文件、120 个测试通过，输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `git diff --check`：通过。

### Change Log

- 2026-06-08：创建 Story 4.6 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-08：补齐 Rust Core 的重启恢复失败巡检，在读取前把失活 `running` Session 降级为 `stopped` 并写入恢复失败事件。
- 2026-06-08：收紧 Issues / Agents 的异常 Session 动作边界，为 `stopped` 会话补显式状态与日志入口，状态推进到 `review`。
- 2026-06-08：完成自动 code review，未发现阻塞问题，状态推进到 `done`。

## Senior Developer Review (AI)

### Review Date

2026-06-08

### Outcome

Approved

### Findings Summary

- Clean review：本次 diff 只补“应用重启后无法恢复的 running Session -> stopped”降级闭环，Rust Core 恢复巡检、事件事实、UI 动作收口与测试覆盖相互一致，未发现阻塞问题。

### Reviewer Notes

- Blind Hunter：`stopped` 会话仍进入 Completed 分组，且没有暴露 resume、`Open Session` 或完成类误导入口。
- Edge Case Hunter：Issues 与 Agents 两条读取链路都在读取前执行同一恢复巡检，避免先打开 Issues 时仍看到过期 `running` 状态。
- Acceptance Auditor：AC1 由 Rust Core 巡检与 `session_exited` 恢复失败事件测试覆盖；AC2/AC3 由前端 `stopped` 展示和动作 gating 回归测试覆盖。
