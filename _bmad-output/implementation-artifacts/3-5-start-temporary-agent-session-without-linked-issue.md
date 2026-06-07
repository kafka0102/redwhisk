---
baseline_commit: 5842f99
---

# Story 3.5: 启动不关联 Issue 的临时 Agent Session

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望从 Session Dialog 启动临时 Codex Session,
以便我可以在当前 Project 中使用 Codex 而不影响任何 Issue。

## Acceptance Criteria

1. 给定 Session Dialog 已填写 `title`、`agent_profile` 和 `prompt`，当用户点击 `Start`，系统使用当前 Project `repo_path` 作为 working directory 启动 Agent 进程，并且只有 Rust Core 确认进程成功启动后才创建 AgentSession。
2. 给定临时 AgentSession 创建成功，当 Session list 刷新时，该 Session 出现在 Running 分组，`issue_id` 为空，title 使用用户填写值或默认标题。
3. 给定临时 Session 启动失败，当 Rust Core 返回错误时，系统不创建 AgentSession，Session Dialog 显示失败原因。

## Tasks / Subtasks

- [x] 补齐临时 Session 的前端启动合同与 Dialog 提交流程 (AC: 1, 2, 3)
  - [x] 在 `src/features/agents/temporary-session-dialog.tsx` 中把当前 “Story 3.5 承接启动能力” 占位提交改为真实的异步启动流程，增加 `isStarting` / 错误展示收口，避免重复点击与伪成功。
  - [x] 在 `src/features/agents/agent-session-commands.ts` 或等价前端 command wrapper 中新增 `startStandaloneAgentSession(input)`，输入至少包含 `projectId`、`agentProfileId`、`title`、`promptSnapshot`，返回新建 `sessionId`。
  - [x] 成功后由 `AgentsActivity` 刷新 Session list，并确保新创建的临时 Session 可被选中或至少立即出现在 Running 分组；失败时 Dialog 保持打开并显示事实性错误。
- [x] 在 Rust Core 实现 `start_standalone_agent_session` 的真实启动路径 (AC: 1, 3)
  - [x] 在 `src-tauri/src/types/agent_session.rs`、`src-tauri/src/commands/agent_session_commands.rs`、`src-tauri/src/lib.rs` 中补齐 standalone 输入/输出 DTO、Tauri command 暴露与注册。
  - [x] 在 `src-tauri/src/core/agent_session_service.rs` 中复用现有 `start_agent_session` 的最小稳定能力：Project / Profile 校验、`prompt_snapshot` 校验、`repo_path` 作为 working directory、日志文件创建、PTY / 进程启动、启动失败回滚。
  - [x] 仅当 Agent 进程真实启动成功后才写入 `agent_sessions` 与 `session_events`；启动失败、校验失败或持久化失败都不得留下有效临时 Session 脏数据。
- [x] 解决临时 Session 的 Project 归属与列表查询边界 (AC: 2)
  - [x] 当前 `agent_sessions` schema 只有可空 `issue_id`，而 `list_by_project_id` 通过 `INNER JOIN issues` 过滤项目；这会导致 `issue_id = null` 的临时 Session 无法进入当前 Project 列表。实现前必须先确定最小可验证归属方案，默认推荐为给 `agent_sessions` 增加显式 `project_id` 并在 issue / standalone 两条启动路径都写入它。
  - [x] 相应更新 `src-tauri/src/db/agent_session_repository.rs` 的插入与列表查询，使临时 Session 在 `issue_id` 为空时仍可被当前 Project 的 Running / Completed 分组读取，并保留现有排序规则。
  - [x] 保持 `AgentsActivity` 现有 `formatSessionTitle(session)` 回退顺序 `issueTitle ?? title ?? Session #id`，不要在 3.5 中引入 `No linked issue` 占位文案。
- [x] 保持临时 Session 与 Issue 工作流隔离，但不越界实现 3.6 (AC: 2, 3)
  - [x] 临时 Session 创建成功时只写 `AgentSession` 与 `SessionEvent`，不写 `IssueAction`，不改变任何 Issue 状态，也不接入 Completion Policy。
  - [x] 失败路径只反馈 Session 启动错误，不追加 Issue 侧副作用；右侧 linked issue pane 对 `issue_id = null` 的隐藏行为复用现有逻辑即可，不在 3.5 顺手改 3.6 的 UI 结构。
- [x] 补齐测试与验证 (AC: 1, 2, 3)
  - [x] Rust 测试覆盖：standalone 启动成功时创建 `issue_id = null` 的 Session、记录 `session_started`、保留 title、并能被当前 Project 的 `list_agent_sessions` 查询到。
  - [x] Rust 测试覆盖：命令启动失败或校验失败时不创建 Session、不产生脏 `session_events`。
  - [x] 前端测试覆盖：`TemporarySessionDialog` 点击 `Start` 会调用新 command、成功时关闭并刷新列表、失败时保留 Dialog 并显示错误；新增临时 Session 出现后，Agents Activity 不显示 linked issue pane。
- [x] 本 story 预计会修改 TypeScript / TSX 与 Rust 运行时逻辑，默认验证命令包括：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --test agent_session
cargo test --manifest-path src-tauri/Cargo.toml
```

## Senior Developer Review (AI)

- Outcome: Approve
- Date: 2026-06-07
- Findings: 同会话自动 code review 未发现需要补丁、决策或延期处理的问题。当前实现满足 Story 3.5 的验收标准，并通过 `project_id` 归属修复保证 standalone Session 能进入当前 Project 列表且复用既有终端链路。

## Dev Notes

### 关键假设与取舍

- Story 3.4 已经交付“打开临时 Session Dialog”的 UI 与键盘/焦点约束；3.5 的最小目标是把 `Start` 接到真实启动路径，而不是重做 Dialog 字段、文案或布局。
- 当前仓库对“临时 Session 属于哪个 Project”的数据归属存在明确缺口：`agent_sessions` 表没有 `project_id`，但临时 Session 又要求出现在当前 Project 的 Session list。为了避免实现者静默猜测，默认推荐在本 story 中补显式 `project_id`，而不是依赖 `working_dir` 字符串倒推归属。
- `title` 已在 schema 中存在且 `AgentsActivity` 已优先回退 `issueTitle ?? title ?? Session #id`，因此临时 Session 的展示标题应以 Dialog 用户输入或默认值为权威来源，不需要新造派生标题逻辑。

### 范围边界

- 交付：点击 `Start` 后真实启动临时 Session、成功后进入当前 Project 的 Running 列表、失败时保留 Dialog 与错误。
- 不交付：新的 Session Header 行为、临时 Session 日志复盘界面、Completion Policy、review 流程、Resume、Issue Inspector 结构调整。
- 不交付：3.6 才收口的 Issue 工作流隔离审计扩展；3.5 只需确保“不触发 Issue 副作用”，不顺手扩大量 log / audit UI。

### 架构约束

- React Workbench 不直接写业务事实；前端只能通过 command wrapper 请求 Rust Core，最终状态以前端重新查询到的 Session 列表和 Core 返回值为准。[Source: `_bmad-output/planning-artifacts/architecture.md` §Internal Communication, §Data Flow]
- 临时 Session 默认使用当前 Project `repo_path` 作为 working directory，Dialog 不展示也不允许覆盖该值。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-16]
- 启动失败不得创建 AgentSession；成功后临时 Session 只记录 `AgentSession` 与 `SessionEvent`，不写 `IssueAction`、不改变 Issue 状态。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §命令与事件表, §Session Header / Issue 操作状态表]
- `list_agent_sessions` 需要继续保持当前 Running / Completed 排序语义；支持临时 Session 后不能让现有 issue-linked Session 排序或分组回退。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Agent Session List]

### 当前代码状态与修改指引

- `src/features/agents/temporary-session-dialog.tsx` 已经完成 profile 加载、最小字段、`Esc` / `Tab` focus trap 与关闭回焦，但 `handleSubmit` 仍只写占位状态消息；这里是 3.5 的前端主入口。
- `src/features/agents/agents-activity.tsx` 已经具备轮询刷新 Session list、`formatSessionTitle` 的 title 回退，以及 `linkedIssue == null` 时隐藏右侧 issue pane 的行为；3.5 应复用这些现成逻辑，不要重做列表或空态。
- `src-tauri/src/core/agent_session_service.rs` 和 `src-tauri/tests/agent_session.rs` 已为 issue-linked `start_agent_session` 建好真实启动、失败回滚和 PTY prompt 提交路径；3.5 应优先抽取或复用这条能力，而不是复制出第二套不一致实现。
- `src-tauri/src/db/agent_session_repository.rs` 当前 `list_by_project_id` 依赖 `INNER JOIN issues`，这正是临时 Session 无法列出的直接阻塞点；无论选 `project_id` 还是其他归属方案，都必须先修复这里。
- `src/shared/commands/command-client.test.ts`、`src/features/agents/agents-activity.test.tsx` 已有 command wrapper 与 AgentsActivity 的前端回归测试骨架，可在此基础上增补 standalone start 断言。

### 前置故事信息

- Story 2.3 已完成“真实启动成功后才创建 Agent Session”的 issue-linked 启动闭环，这是 3.5 最应该复用的后端能力。
- Story 2.5 / 2.6 已把 Agents Activity、Session list 与 Codex terminal 承载面搭好，因此 3.5 不需要再搭新的工作台壳层。
- Story 3.4 已确认 `New session` 只打开 Dialog、不创建 Session；3.5 只负责把 `Start` 接到真实启动链路。
- Story 3.6 将继续约束“临时 Session 不触发 Issue 流转”的更完整行为验证；3.5 需要为它保留干净边界，而不是把 3.6 全做完。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `5842f99`。
- 当前工作区在 story creation 阶段是干净的；后续开发若出现无关改动，最终提交只能包含 Story 3.5 直接相关文件。
- 由于本 story 预计会同时修改前端 TypeScript / TSX 与 Rust command / service / repository / migration，默认至少执行以下验证：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --test agent_session
cargo test --manifest-path src-tauri/Cargo.toml
```

### 测试要求

- 前端运行时逻辑变更：必须运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`，并至少覆盖 `TemporarySessionDialog` / `AgentsActivity` 相关回归。
- Rust command / service / repository / migration 变更：必须运行 `cargo fmt`、`cargo test`，并包含 standalone start 的成功与失败路径。
- 如果最终选择给 `agent_sessions` 增加 `project_id`，必须补 migration 回归或等价测试，证明旧的 issue-linked 查询没有回退。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 3 / Story 3.5、3.6 的验收标准与相邻边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — UJ-5、FR-16、Agents Activity / Session Dialog / 临时 Session 列表行为。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — `start_standalone_agent_session(input)`、AgentSession 数据表草案、无关联 Issue 状态表。
- `_bmad-output/planning-artifacts/architecture.md` — React -> command -> Rust Core 数据边界、FR-13 至 FR-16 结构映射。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Flow 3 与 Agent Session List 的分组/排序口径。
- `_bmad-output/implementation-artifacts/2-3-create-agent-session-and-update-issue-after-successful-start.md` — issue-linked 启动闭环、失败回滚与测试边界。
- `_bmad-output/implementation-artifacts/3-4-open-temporary-session-dialog.md` — 当前 Temporary Session Dialog 的 UI 范围与既有测试约束。
- `src/features/agents/temporary-session-dialog.tsx`、`src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx` — 3.5 的前端主入口与现成回归测试。
- `src/features/agents/agent-session-commands.ts`、`src/shared/commands/command-client.test.ts` — 前端 command wrapper 与调用契约测试。
- `src-tauri/src/commands/agent_session_commands.rs`、`src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/db/agent_session_repository.rs`、`src-tauri/tests/agent_session.rs` — 3.5 的 Rust Core / repository / 测试主入口。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-07T20:49:18+0800：`bmad-dev-workflow` preflight 确认当前无 `ready-for-dev` story，按 sprint 顺序锁定 `3-5-start-temporary-agent-session-without-linked-issue`，基线 `HEAD` 为 `5842f99`。
- 2026-06-07T20:49:18+0800：交叉核对 Epic 3.5、PRD FR-16、addendum 命令/状态表、Flow 3 以及 Story 2.3 / 3.4，确认当前 Dialog 已存在但 `Start` 仍是占位实现。
- 2026-06-07T20:49:18+0800：复查 `agent_sessions` schema 与 `list_by_project_id` 查询后确认一处关键实现歧义：临时 Session 的 `issue_id = null` 已被 schema 允许，但当前 repository 仍无法按 Project 列出它；已把该点前置写入 story 作为必须先解决的约束。
- 2026-06-07T21:10:00+0800：先为前端 command client、Agents Activity 和 Rust `agent_session` 测试补红测，锁定 `start_standalone_agent_session` 命令契约、Dialog 成功/失败态，以及 standalone Session 的持久化/列表行为。
- 2026-06-07T21:24:00+0800：新增 `0009_agent_sessions_project_id.sql`，为 `agent_sessions` 补 `project_id` 并回填既有 issue-linked 数据；同步更新 repository 查询，使 `issue_id = null` 的临时 Session 能按 Project 列出。
- 2026-06-07T21:31:00+0800：在 Rust Core 中补齐 standalone Session DTO、Tauri command 和 service 启动路径，并把 `find_project_session` 改为基于 `project_id` 校验，从而让临时 Session 也能走终端读写与 attention 路径。
- 2026-06-07T21:37:00+0800：接通 `TemporarySessionDialog` 的真实提交流程与 `AgentsActivity` 的成功刷新/选中逻辑；随后完成前端与 Rust 定点验证。
- 2026-06-07T21:41:00+0800：全量验证首轮发现 `temporary-session-dialog.tsx` 使用 `finally` 中 `return` 触发 `no-unsafe-finally`；移除该控制流后重跑 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 全部通过。

### Completion Notes List

- 2026-06-07：create-story 已为 Story 3.5 生成开发上下文，并将重点收口到“真实启动临时 Session + 成功后进入当前 Project 列表 + 失败不落脏状态”。
- 2026-06-07：已显式记录 3.5 与 3.4 / 3.6 的边界，避免把 Dialog UI 重做或 Issue 流转隔离的后续范围提前混入。
- 2026-06-07：已把临时 Session 的 Project 归属歧义写成开发前置约束，默认推荐使用显式 `project_id` 而不是隐式从 `working_dir` 反推。
- 2026-06-07：新增 standalone Session 前端 command 与 Dialog 提交流程；成功后 `AgentsActivity` 会刷新列表并选中新建 Session，失败时保留 Dialog 并显示 Rust Core 返回的事实性错误。
- 2026-06-07：通过 `0009_agent_sessions_project_id.sql` 为 `agent_sessions` 补齐 `project_id`，并将 `list_by_project_id` 改为按 Session 自身归属查询，从而让 `issue_id = null` 的临时 Session 正常进入当前 Project 的 Running / Completed 分组。
- 2026-06-07：Rust Core 已支持 `start_standalone_agent_session`，启动成功时只写 `AgentSession` / `SessionEvent`，不写 `IssueAction`，也不改变任何 Issue 状态。
- 2026-06-07：`find_project_session` 改为基于 `project_id` 校验，因此 standalone Session 与 issue-linked Session 都能复用现有终端读写、attention 和退出事件链路。
- 2026-06-07：已运行前端定点测试、Rust `agent_session` 测试、`pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`cargo fmt`、`cargo test`；最新一轮全部通过。

### File List

- _bmad-output/implementation-artifacts/3-5-start-temporary-agent-session-without-linked-issue.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src-tauri/migrations/0009_agent_sessions_project_id.sql
- src-tauri/src/db/migrations.rs
- src-tauri/src/types/agent_session.rs
- src-tauri/src/db/agent_session_repository.rs
- src-tauri/src/core/agent_session_service.rs
- src-tauri/src/commands/agent_session_commands.rs
- src-tauri/src/lib.rs
- src-tauri/tests/agent_session.rs
- src-tauri/tests/local_data.rs
- src/features/agents/agent-session-commands.ts
- src/features/agents/temporary-session-dialog.tsx
- src/features/agents/agents-activity.tsx
- src/features/agents/agents-activity.test.tsx
- src/shared/commands/command-client.test.ts

### Validation Commands

- `pnpm test -- --run src/shared/commands/command-client.test.ts src/features/agents/agents-activity.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

### Validation Results

- `pnpm test -- --run src/shared/commands/command-client.test.ts src/features/agents/agents-activity.test.tsx`：通过，相关前端测试文件通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：通过，23 个 `agent_session` 相关测试通过，包含新增 standalone Session 成功/失败路径。
- `pnpm format`：第一轮通过；`prettier` 曾短暂折行无关文件 `src/features/agents/codex-terminal-snapshot.ts`，该无关改动已从当前 story 范围剔除。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：第一轮失败，`src/features/agents/temporary-session-dialog.tsx` 因 `finally` 中 `return` 触发 `no-unsafe-finally`；修正控制流后继续复验。
- `pnpm typecheck`：第一轮通过。
- `pnpm test`：第一轮通过，8 个测试文件、105 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，Rust 单元测试与集成测试全部通过。
- `pnpm format`：第二轮通过。
- `pnpm lint`：第二轮通过。
- `pnpm typecheck`：第二轮通过。
- `pnpm test`：第二轮通过，8 个测试文件、105 个测试通过；输出仍包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。

### Change Log

- 2026-06-07：创建 Story 3.5 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-07：完成 standalone Session 启动链路、`project_id` 归属修复、前端 Dialog / 列表刷新接线与对应前后端测试，状态推进到 `review`。
- 2026-06-07：完成同会话 code review，未发现阻塞问题，状态推进到 `done`。
