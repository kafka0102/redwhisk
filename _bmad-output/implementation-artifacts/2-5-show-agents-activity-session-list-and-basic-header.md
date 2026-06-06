# Story 2.5: 展示 Agents Activity Session List 和基础 Header

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望启动 Codex 后立即进入 Agents Activity 并看到当前 Session,
以便我能在同一个工作台里继续回到对应会话，而不是停留在仅有占位文案的空页面。

## Acceptance Criteria

1. 给定某个 Issue 成功启动 `AgentSession`，当 Run Dialog 关闭后，应用切换到 `Agents Activity`，并在左侧 `Running` 分组中显示该 Session。
2. 给定当前 Project 下存在多个 `AgentSession`，当左侧 Session list 渲染时，`Running` 分组按 `last_active_at` 倒序展示，`Completed` 分组按最近结束时间倒序预留展示 `closed`、`crashed`、`stopped` 的最近 20 条 Session，且 `review` 不是 Session 分组。
3. 给定当前选中的 Session 关联了 Issue，当右侧基础 Header 渲染时，Header 显示该 Issue 标题，并保留进入关联 Issue 上下文的入口；本 Epic 内不实现 `Mark Review`、Completion 或完整 Issue Inspector。

## Tasks / Subtasks

- [x] 把“启动成功 / 打开现有 Session”真正接到 Agents Activity，而不是停留在 Issues (AC: 1, 3)
  - [x] 调整 `src/features/issues/issues-activity.tsx` 的成功回调，消费 `StartAgentSessionResult.sessionId`，在刷新 Issue 列表后切换到 `Agents Activity` 并选中当前 Session。
  - [x] 复用 Story 2.4 已有的 `Open Session` 入口，让“二次打开现有 Session”和“首次启动成功后进入 Session”走同一条选中逻辑。
  - [x] 保持 Rust Core 仍是业务事实来源；React 只切换视图状态，不自行伪造 Session 或 Issue 状态。
- [x] 为 Agents Activity 补齐最小可用的 Session 查询边界与 DTO (AC: 1, 2, 3)
  - [x] 在 Rust 侧新增当前 Project 的 Session 列表查询能力，返回渲染列表与 Header 所需最小字段：`sessionId`、`issueId`、`issueTitle`、`title`、`agentType`、`status`、`attention`、`lastActiveAt`、`startedAt`、`closedAt`。
  - [x] `Running` 只包含 `status=running`；`Completed` 只包含 `closed`、`crashed`、`stopped`，并在查询或映射层限制最近 20 条。
  - [x] 不把 `review` 建成 Session 状态或列表分组；不要为了 2.5 提前实现临时 Session 创建、resume、completion 或日志动作。
- [x] 落地 Agents Activity 左侧 Session list 的基础布局与选择态 (AC: 1, 2)
  - [x] 用真正的左右两栏替换 `src/features/agents/agents-activity.tsx` 的占位实现，左侧展示 `Running` / `Completed` 两个分组，右侧保留当前 Session 主区。
  - [x] `AppShell` / `ActivityRouter` 继续以 `activeAgentSessionId` 作为入口上下文；若未显式指定，则默认选中首个 `Running` Session，否则退回首个 `Completed` Session。
  - [x] Session item 至少展示 Issue title 或 Session title、Agent 类型和运行状态；若当前只有 Issue 关联 Session，也要保留对后续临时 Session title 的兼容字段，不要写死为“只有 Issue title”。
- [x] 落地右侧基础 Header 与 2.6 前的主区占位 (AC: 3)
  - [x] 当前 Session 关联 Issue 时，Header 显示 Issue 标题，并提供进入关联 Issue 上下文的入口；此入口可以先复用最小按钮/回调，不提前实现完整 Inspector。
  - [x] 当前 Session 不关联 Issue 时，不显示 Issue 区域，也不显示 `No linked issue`。
  - [x] 右侧主区仍可保留事实性占位文案，明确 PTY/xterm 的真实终端体验由 Story 2.6 承接。
- [x] 测试与验证 (AC: 1, 2, 3)
  - [x] 新增前端测试覆盖：启动成功后切到 Agents Activity 并选中返回的 Session；已有 Session 入口也能落到同一选中态。
  - [x] 新增前端测试覆盖：Session list 的 `Running` / `Completed` 分组、默认选中逻辑，以及有无关联 Issue 时 Header 的显示差异。
  - [x] 新增 Rust 测试覆盖：Session 列表查询的分组排序、`Completed` 截断为最近 20 条、以及列表项对 `issueTitle` / `agentType` 的映射。
  - [x] 若本 story 修改了 TypeScript / TSX 运行时逻辑，运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
  - [x] 若本 story 修改了 Rust command / service / repository，运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与 `cargo test --manifest-path src-tauri/Cargo.toml`。

## Senior Developer Review (AI)

- Outcome: Approve
- Date: 2026-06-06
- Findings: 本轮 review 未发现阻塞 Story 2.5 交付的功能、排序、状态分组或入口回跳问题；剩余 PTY/xterm、临时 Session 与完整 Inspector 仍留在 2.6 / 3.x，符合本 story 的范围边界。

## Dev Notes

### 关键假设与取舍

- Story 2.5 的目标是把当前“能进入 Agents Activity”这条路径从空占位升级为真实的 Session 工作台骨架，而不是提前交付 PTY/xterm 终端本体。
- Story 2.4 已经把 `Open Session` 入口挂到 Issue 详情中，但 `AgentsActivity` 仍只有占位文案；2.5 的默认取舍是让“启动成功进入 Session”和“重新打开现有 Session”复用同一选中态，而不是各自维护一套跳转分支。
- 虽然 PRD 的 FR-13 提到了左侧顶部展示形态 icon 和临时 Session 新建按钮，但真正的临时 Session Dialog / 启动流程由 Epic 3 的 3.4 / 3.5 承接；2.5 只需建立可承接这些入口的布局骨架，不应抢跑完整交互。

### 范围边界

- 交付：成功启动后切到 Agents Activity、当前 Project 的 Session list、`Running` / `Completed` 分组、基础 Header、与当前 Session 对应的右侧占位主区。
- 不交付：真实 PTY/xterm 渲染、Session 输出流、resume、临时 Session 启动、`Mark Review`、Completion、Issue Inspector 交互、日志入口。
- 不交付：attention 标记、crashed/stopped 生命周期写入策略、Session 退出处理；这些继续由 Epic 3 / Epic 4 承接。

### 架构约束

- Rust Core 仍是 Agent Session 与 Issue 状态的唯一事实来源；前端只能读取 query 结果并切换视图状态，不能自行伪造 Session 分组或核心状态。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns, §Pattern Examples]
- `review` 是 Issue 状态，不是 `AgentSession` 状态或 Session list 分组；Agents Activity 左侧固定使用 `Running` / `Completed`。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-13; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md`]
- `Session Header` 只在当前 Session 关联 Issue 时显示 Issue 标题和操作；无关联 Issue 时不显示 Issue 区域，也不显示 `No linked issue`。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §Agents Activity, §FR-25; `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md`]
- xterm 生命周期后续必须独立于 Inspector/Dialog；2.5 即便暂时使用右侧占位主区，也不应把结构写死成只能承载纯文案页。[Source: `_bmad-output/planning-artifacts/architecture.md` §Communication Patterns, §Component Boundaries]

### 当前代码状态与修改指引

- `src/features/agents/agents-activity.tsx` 当前只接收 `activeSessionId` 并输出一段占位文案，没有 Session query、分组列表或 Header，这是 2.5 的主要前端入口。
- `src/app/app-shell.tsx` 已经维护 `activeActivity` 与 `activeAgentSessionId`；这意味着 2.5 不需要再引入新的全局 store，只需把现有选中态真正喂给 Agents Activity。
- `src/app/activity-router.tsx` 当前把 `activeAgentSessionId` 传给 `AgentsActivity`，但没有把 `projectId` 或刷新能力传进去；2.5 需要补齐 Agents Activity 读取当前 Project Session 的最小上下文。
- `src/features/issues/issue-run-dialog.tsx` 已经返回完整的 `StartAgentSessionResult`，并在 `AGENT_SESSION_ALREADY_EXISTS` 时从错误 detail 中提取 `sessionId`；但 `src/features/issues/issues-activity.tsx` 的 `handleRunStarted` 目前只刷新 Issue 列表，没有根据 `sessionId` 自动切到 Agents。
- `src-tauri/src/db/agent_session_repository.rs` 当前只有 `find_by_id` / `find_by_issue_id` / `insert_in_transaction`，尚无“按 Project 列出 Session”的查询能力；2.5 预计要从这里补齐最小列表查询，并关联 Issue 标题与 Agent 类型字段。
- `src-tauri/src/types/agent_session.rs` 目前只覆盖启动输入、启动结果和底层 `AgentSessionRecord`，还没有专门给列表 / Header 用的跨边界 DTO；新增 DTO 时应保持 `camelCase` 输出，避免让前端自己拼接业务语义。

### 前置故事信息

- Story 2.3 已经在真实启动成功后创建 `agent_sessions`、写入 `session_events`，并把 Issue 置为 `running`；2.5 要消费这批已存在的会话事实，而不是再造本地 Session 状态。
- Story 2.4 已经把 `linkedSessionId` / `linkedSessionStatus` 带到 Issue 列表，并在 Issue 详情中提供 `Open Session` 入口；2.5 要把这条入口真正落到 Session 工作台。
- Story 2.6 将承接 PTY/xterm 的真实 Session View，因此 2.5 右侧主区可以保持事实性占位，但 Header 与列表必须是真实数据驱动。
- Story 3.1 / 3.2 / 3.4 / 3.5 会继续扩展 Session list 的异常状态、attention 和临时 Session；2.5 只交付这些能力的最小承载骨架。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `b35687b`。
- 当前工作区在 story creation 阶段是干净的；后续开发若出现无关改动，最终提交只能包含 Story 2.5 直接相关文件。
- 预计本 story 会同时改动 TypeScript / TSX 与 Rust 查询边界，默认至少运行：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

### 测试要求

- TypeScript / React 运行时逻辑变更：必须运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。
- Rust command / repository / DTO 变更：必须运行 `cargo fmt --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`。
- 若仓库格式化配置覆盖到本次修改文件，先运行 `pnpm format` 再进入 lint/typecheck/test。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 2 / Story 2.5、2.6 与 Epic 3 相邻 story 的验收标准和职责边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR13、FR25、Agents Activity 工作区形态与 Session Header 约束。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — `Running` / `Completed` 分组、Session Header 行为和 MVP 模块边界。
- `_bmad-output/planning-artifacts/architecture.md` — `features/agents` 边界、状态来源、跨边界 DTO 与 xterm 生命周期约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Agents Activity、Session Header、Run Dialog 成功后的体验衔接。
- `_bmad-output/implementation-artifacts/2-3-create-agent-session-and-update-issue-after-successful-start.md` — Story 2.3 已交付的 Session 创建与成功结果回传边界。
- `_bmad-output/implementation-artifacts/2-4-enforce-one-agent-session-per-issue.md` — Story 2.4 已交付的 `Open Session` 入口、关联 Session 字段和当前占位实现缺口。
- `src/app/app-shell.tsx`、`src/app/activity-router.tsx`、`src/features/agents/agents-activity.tsx`、`src/features/issues/issues-activity.tsx` — 2.5 的主要前端改动入口。
- `src-tauri/src/db/agent_session_repository.rs`、`src-tauri/src/types/agent_session.rs`、`src-tauri/src/commands/agent_session_commands.rs` — 2.5 的主要 Rust 查询边界入口。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-06T21:18+0800：以 `b35687b` 为基线进入 Story 2.5，实现目标限定为真实 Session list、基础 Header 和启动后切到 Agents，不提前接 PTY/xterm 或临时 Session。
- 2026-06-06T21:25+0800：补齐 Rust `list_agent_sessions` 查询链路，包括 DTO、repository、service、command 与 Tauri invoke handler，并新增 Rust 测试覆盖分组排序、Completed 截断和 Project 作用域。
- 2026-06-06T21:31+0800：实现 `AgentsActivity` 左右两栏、基础 Header、Session 选中逻辑与 `Open in Issues` 入口；把 Issue 启动成功 / 打开现有 Session 都接到同一 `activeAgentSessionId` 入口。
- 2026-06-06T21:35+0800：针对 React hook lint 约束，把 Session 选中逻辑改为“外部 activeSessionId 优先、本地手动选择其次、否则回退到首个 Running/Completed”的纯派生模式，避免 effect 中同步 setState。
- 2026-06-06T21:39+0800：补强 `Agents -> Issues` 回跳，至少带着 `requestedIssueId` 回到对应 Issue 选中态，而不是只做页面切换。
- 2026-06-06T21:40+0800：完成前后端验证并做本地 code review，确认 2.5 的 scope 与 AC 一致。

### Completion Notes List

- 2026-06-06：保留 create-story 生成的 2.5 上下文，并在此基础上完成实现、验证和 review 收口。
- 新增 `list_agent_sessions` 命令链路，Rust Core 现在可以按 Project 返回 Session list 所需的最小事实字段，并把 `Running` / `Completed` 排序和 `Completed` 最近 20 条限制收口在服务层。
- `AgentsActivity` 从占位文案升级为真实的左右两栏骨架：左侧展示 `Running` / `Completed`，右侧展示基础 Header 和 Story 2.6 前的终端占位主区。
- `IssuesActivity` 现在会在启动成功或命中 `AGENT_SESSION_ALREADY_EXISTS` 后，把返回的 `sessionId` 交给 AppShell，自动切到 `Agents` 并选中当前 Session。
- Header 的 `Open in Issues` 入口会把关联 `issueId` 带回 `Issues` Activity 的选中态，满足“进入关联 Issue 上下文”的最小闭环，而不抢跑完整 Inspector。
- 前端测试补齐了 Agents list 分组、默认选中、无关联 Issue 时 Header 隐藏、Header 跳转入口，以及 Run 成功后切到 Agents 的行为。
- Rust 测试补齐了 Session list 的 Project 作用域、`Running` / `Completed` 排序和 `Completed` 截断，避免后续扩展时把 `review` 或其他状态误带入 Session 分组。

### File List

- _bmad-output/implementation-artifacts/2-5-show-agents-activity-session-list-and-basic-header.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/app/activity-router.tsx
- src/app/app-shell.tsx
- src/app/app.css
- src/features/agents/agent-session-commands.ts
- src/features/agents/agents-activity.tsx
- src/features/agents/agents-activity.test.tsx
- src/features/issues/issues-activity.tsx
- src/features/issues/issues-activity.test.tsx
- src/shared/commands/command-client.test.ts
- src-tauri/src/commands/agent_session_commands.rs
- src-tauri/src/core/agent_session_service.rs
- src-tauri/src/db/agent_session_repository.rs
- src-tauri/src/lib.rs
- src-tauri/src/types/agent_session.rs
- src-tauri/tests/agent_session.rs

### Validation Commands

- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`

### Validation Results

- `pnpm format`：通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：通过；中途曾因 `AgentsActivity` 在 effect 中同步 `setState` 触发 `react-hooks/set-state-in-effect` 报错，已改为纯派生选中逻辑后复跑通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过，7 个测试文件、77 个测试通过；输出仍包含既有 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，`agent_session`、`issue`、`local_data`、`project`、`settings` 全量测试均通过。

### Change Log

- 2026-06-06：创建 Story 2.5 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-06：完成 Agents Activity Session list、基础 Header、Issue->Agents / Agents->Issues 入口衔接，以及前后端测试与 review，状态推进到 `done`。
