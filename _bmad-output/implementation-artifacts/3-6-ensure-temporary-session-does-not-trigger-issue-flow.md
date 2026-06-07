---
baseline_commit: a757501
---

# Story 3.6: 临时 Session 不触发 Issue 流转

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望临时 Codex Session 与 Issue 工作流隔离,
以便临时操作不会污染 Issue 状态或完成策略。

## Acceptance Criteria

1. 给定当前选中的是不关联 Issue 的 AgentSession，当右侧 Session Header 渲染时，Header 不显示 Issue 标题，并且不显示 `No linked issue` 文案。
2. 给定用户与临时 Codex Session 交互，当 Session 产生日志或事件时，系统记录 AgentSession 日志和 SessionEvent，并且不写入 IssueAction。
3. 给定临时 Session 正在运行或已结束，当用户查看 Issue 列表时，不改变任何 Issue 的 `backlog`、`running`、`review` 或 `completed` 状态，并且临时 Session 不参与 Completion Policy。

## Tasks / Subtasks

- [x] 收口临时 Session 的 Header / Inspector 隔离行为，只保留 Session 语义，不暴露 Issue 语义 (AC: 1, 3)
  - [x] 复查 `src/features/agents/agents-activity.tsx` 当前 `linkedIssue` 判定和右侧 info pane 渲染，确认 `issueId = null` 的 standalone Session 在 Running 与 Completed 两种展示下都不会出现 Issue 标题、Issue 按钮或 `No linked issue` 类空态文案。
  - [x] 如果现有实现已经满足 AC1，则只补最小守卫和回归测试，不重做 `AgentsActivity` 布局、splitter、toolbar 或终端承载层。
  - [x] 明确保持“无关联 Issue 时 Header 整块隐藏”的既有方向，不借本 story 新增临时 Session 的伪 Issue 占位信息。
- [x] 巩固 standalone Session 的事件与审计边界，确保只写 Session 侧事实，不写 Issue 侧事实 (AC: 2)
  - [x] 复查 `src-tauri/src/core/agent_session_service.rs` 中 standalone Session 的启动、attention、输入、退出与列表刷新相关路径，确保它们最多写入 `agent_sessions` / `session_events` / 日志文件，不追加 `issue_actions`。
  - [x] 对现有 issue-linked 路径继续保留 `IssueAction` 记录；若共用 helper 同时服务两类 Session，必须显式按 `issue_id` 或等价事实分支，避免临时 Session 静默复用到 Issue 审计写入。
  - [x] 如发现某些事件当前没有结构化记录，需要优先沿用现有 `SessionEventType` 或等价模式补齐，而不是发明新审计表或把终端日志写回 SQLite。
- [x] 防止临时 Session 通过列表聚合、Issue 查询或完成入口间接污染 Issue 状态 (AC: 3)
  - [x] 复查 `src-tauri/src/core/issue_service.rs`、`src-tauri/src/db/issue_repository.rs` 与相关查询/聚合逻辑，确认 Issue 列表上的 linked session 状态、attention 与排序不会因为 standalone Session 的 `project_id` 归属而被误算到任意 Issue 上。
  - [x] 如当前代码库已存在完成策略或完成入口的共享逻辑，补显式 guard：standalone Session 无 `issue_id` 时不得触发 Completion Policy、Issue 完成或 IssueAction 写入。
  - [x] 保持范围收口在“隔离与防回归”，不提前实现 Epic 4 / 5 的 review、Issue Inspector 编辑或 completion UI。
- [x] 以回归测试锁定 3.6 的隔离边界，而不是只凭人工阅读代码判断 (AC: 1, 2, 3)
  - [x] 前端测试覆盖：选中 standalone Session 时不渲染 linked issue pane、Issue 标题、Issue 跳转按钮或 `No linked issue` 文案；切换到 issue-linked Session 时现有 UI 继续正常显示。
  - [x] Rust 测试覆盖：standalone Session 在启动、attention 变化、终端输入/输出或退出后仍不新增 `IssueAction`，并且同项目 Issue 列表状态保持原值。
  - [x] 若为了 AC3 引入新的 guard 或查询修正，补对应测试证明 issue-linked Session 现有行为未回退。
- [x] 按项目规则执行并记录本 story 的必要验证命令 (AC: 1, 2, 3)
  - [x] 本 story 预计会修改 TypeScript / TSX 与 Rust 运行时/测试逻辑，默认至少执行：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --test agent_session
cargo test --manifest-path src-tauri/Cargo.toml --test issue
cargo test --manifest-path src-tauri/Cargo.toml
```

## Senior Developer Review (AI)

- Outcome: Approve
- Date: 2026-06-07
- Findings: 同会话自动 code review 未发现需要补丁、决策或延期处理的问题。当前改动只补充 standalone Session 与 Issue 工作流隔离的回归护栏，覆盖点与 Story 3.6 的验收标准一致，且没有引入新的运行时范围。

## Dev Notes

### 关键假设与取舍

- Story 3.5 已经交付 standalone Session 的真实启动链路，并在成功创建时避免写入 `IssueAction`；3.6 的最小目标不是重做这条链路，而是把“临时 Session 与 Issue 流程隔离”补成可回归、可证明的完整边界。
- `AgentsActivity` 当前已经通过 `linkedIssue` 判定隐藏 `issue_id = null` Session 的右侧 info pane；这很可能已经满足 AC1 的大部分行为。实现时要先验证既有能力，再决定是否需要极小修补，不能为了“显式实现”而重排 UI 结构。
- Story 3.5 为 standalone Session 引入了显式 `project_id` 归属，这解决了列表查询问题，也带来了新的回归风险：Issue 列表或其它聚合逻辑可能错误把 standalone Session 视为某个 Issue 的关联 Session。3.6 要优先防这个风险，而不是继续扩展 Session 功能。

### 范围边界

- 交付：standalone Session 的 Header 隐藏规则、Issue 审计隔离、Issue 列表与完成策略不受 standalone Session 影响，以及对应前后端回归测试。
- 不交付：新的 Session Header 操作、Issue Inspector 编辑、Mark Review、Completion Confirmation、Summary / Log View 或任何 Epic 4 / 5 功能。
- 不交付：新的数据库表、额外的全局设置项、日志查看 UI、resume 能力或临时 Session 的跨项目迁移逻辑。

### 架构约束

- React 不能自行持久化业务事实；无论是隐藏 Header 还是刷新 Issue 列表，最终状态都必须以 Rust Core 查询结果为准。[Source: `_bmad-output/planning-artifacts/architecture.md` §Frontend Architecture, §API & Communication Patterns]
- 临时 Session 的产品定义就是“无关联 Issue 的 Agent Session”；它可以记录日志和 SessionEvent，但不触发 Issue 状态流转，也不参与 Completion Policy。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §UJ-5, §FR-16; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §已冻结的 MVP 判断, §Session Header / Issue 操作状态表]
- Session Header 只在当前 Session 关联 Issue 时展示 Issue 标题和操作；无关联 Issue 时既不显示 Issue 区域，也不显示 `No linked issue` 文案。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Component Patterns, §State Patterns]
- SQLite 结构化审计要区分 `session_events` 与 `issue_actions`；高频终端输出继续写日志文件，不得为满足 3.6 把日志重新设计回数据库。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Architecture; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §MVP 模块边界, §数据表草案]

### 当前代码状态与修改指引

- `src/features/agents/agents-activity.tsx` 已存在 `linkedIssue` 派生逻辑，并在 `linkedIssue == null` 时隐藏右侧 info pane；3.6 应从这里补前端回归测试和最小 guard，而不是复制一套 standalone Header 组件。
- `src/features/agents/agents-activity.test.tsx` 已经有 “starts a temporary session ... hides the linked issue pane” 与 “hides the info pane when the selected session has no linked issue” 的基础覆盖；3.6 应在此基础上继续锁定“不出现任何 Issue 文案/按钮”和切换场景，而不是新建平行测试文件。
- `src-tauri/src/core/agent_session_service.rs` 当前只有 issue-linked `start_agent_session` 会写 `IssueActionType::AgentSessionStarted`；standalone `start_standalone_agent_session` 只写 Session 侧事实。3.6 的重点是审查其它共享路径，例如 attention、输入、退出和列表投影，确保没有后续侧漏。
- `src-tauri/tests/agent_session.rs` 已有 standalone Session 启动成功/失败、attention、终端输入和列表查询测试；若要证明 “不写 IssueAction” 与 “不污染 Issue 列表状态”，优先在这里补精确断言，并按需联动 `src-tauri/tests/issue.rs`。
- Story 3.5 已经把 `agent_sessions.project_id` 作为当前 Project 归属字段写入 schema 与查询；3.6 只能围绕这一既有方案加 guard / 测试，不能再回到从 `working_dir` 反推归属或另建替代模型。

### 前置故事信息

- Story 2.5 建立了 Agents Activity 左右两栏和基础 Session Header 承载面，3.6 不需要再改工作台骨架。
- Story 3.2 / 3.3 已经把 attention 展示和手动标记接入 Running Session；3.6 需要确认这些路径面对 standalone Session 时只影响 Session 自身，不额外波及 Issue 状态。
- Story 3.4 定义了临时 Session Dialog 的极简 UI 边界；Story 3.5 交付了真实启动与 `project_id` 归属。3.6 是对这两步的隔离收口，而不是另起一条启动流程。
- Epic 4 / 5 未来才会引入 Mark Review、Completion Policy 和 Summary/Log；3.6 只需要确保 standalone Session 在这些未来能力接入前就有明确 guard，不提前实现它们。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `a757501`。
- preflight 时工作区是干净的；后续开发若出现无关改动，最终提交只能包含 Story 3.6 直接相关文件。
- 本 story 预计同时影响前端 TS/TSX、Rust Core 查询/审计边界与测试，因此默认需要前后端双侧验证，而不是只跑单边测试。

### 测试要求

- 只要修改 TypeScript / TSX，必须至少运行 `pnpm lint`、`pnpm typecheck`，且因为本 story 涉及运行时行为与回归边界，还必须运行 `pnpm test`。
- 只要修改 Rust Core / repository / 测试依赖实现，必须至少运行 `cargo fmt` 与受影响 Rust 测试；如果 Issue 列表投影或审计边界被修改，`agent_session` 与 `issue` 两组测试都应覆盖。
- 所有实际执行的验证命令必须逐条写入后续 Dev Agent Record；未运行的命令不能写成“已验证”。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 3 / Story 3.5、3.6 的验收标准与相邻边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — UJ-5、FR-16、Agents Activity 与临时 Session 的产品约束。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — 临时 Session 不参与 Issue 流转 / Completion Policy 的冻结口径、命令事件表、Session Header 状态表与数据表草案。
- `_bmad-output/planning-artifacts/architecture.md` — React/Rust 边界、SQLite / 日志职责划分、前端状态只作视图缓存的架构约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Session Header、无关联 Issue 状态、Flow 3/4 的交互规则。
- `_bmad-output/implementation-artifacts/3-4-open-temporary-session-dialog.md` — 临时 Session UI 的范围边界。
- `_bmad-output/implementation-artifacts/3-5-start-temporary-agent-session-without-linked-issue.md` — standalone Session 启动链路、`project_id` 归属与 3.6 的前置实现。
- `src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx` — 3.6 的前端主入口与回归测试入口。
- `src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/core/issue_service.rs`、`src-tauri/src/db/issue_repository.rs`、`src-tauri/tests/agent_session.rs`、`src-tauri/tests/issue.rs` — 3.6 的 Rust Core / 查询 / 审计边界与测试入口。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-07T22:49:31+08:00：`bmad-dev-workflow` preflight 读取 `sprint-status.yaml`，确认当前无 `ready-for-dev` story，按顺序锁定 `3-6-ensure-temporary-session-does-not-trigger-issue-flow`，基线 `HEAD` 为 `a757501`。
- 2026-06-07T22:49:31+08:00：交叉核对 Epic 3.6、PRD FR-16 / UJ-5、UX Session Header 规则、Architecture 的 React/Rust 边界，以及 Story 3.4 / 3.5 的既有实现与边界。
- 2026-06-07T22:49:31+08:00：复查当前代码后确认 AC1 已有明显既有实现基础，3.6 的主要风险转为“standalone Session 在共享查询/审计路径里侧漏到 Issue 工作流”；已把该点前置写入 story 作为最优先验证目标。
- 2026-06-07T22:54:00+08:00：补充 `AgentsActivity`、`issue.rs` 与 `agent_session.rs` 回归测试，分别锁定 standalone Session 的 Header 隔离、Issue 列表不误关联，以及 standalone attention / exit 事件不新增 `IssueAction`。
- 2026-06-07T22:56:07+08:00：先运行 `pnpm test -- --run src/features/agents/agents-activity.test.tsx`、`cargo test --test issue`、`cargo test --test agent_session` 做定点回归，确认实现缺口不在运行时代码，而在隔离边界缺少测试护栏。
- 2026-06-07T22:58:20+08:00：执行 `pnpm format` 与 `cargo fmt`；其中 `pnpm format` 对无关文件 `src/features/agents/codex-terminal-snapshot.ts` 产生折行差异，已从本 story 范围回退，不纳入提交。
- 2026-06-07T22:58:59+08:00：完成 `pnpm lint`、`pnpm typecheck`、`pnpm test` 与 `cargo test` 全量验证，结果全部通过。

### Completion Notes List

- 2026-06-07：create-story 已为 Story 3.6 生成开发上下文，并将范围收口为“验证并巩固 standalone Session 与 Issue 工作流的隔离边界”。
- 2026-06-07：已显式记录 3.6 与 3.4 / 3.5 的承接关系，以及与 Epic 4 / 5 的非范围边界，避免把 review / completion 功能提前混入。
- 2026-06-07：已把 `project_id` 归属带来的潜在回归点写入 story，提醒实现优先检查 Issue 列表投影与共享审计路径，而不是重复实现启动链路。
- 2026-06-07：确认现有运行时代码已经满足 3.6 的隔离语义；本次实现不扩展功能，只补回归护栏，避免未来改动让 standalone Session 重新污染 Issue UI、Issue 列表或 IssueAction。
- 2026-06-07：前端新增断言覆盖运行中与已结束 standalone Session，明确“不渲染 linked issue pane / Issue 文案 / `No linked issue`”。
- 2026-06-07：Rust 新增两组隔离测试，证明 standalone Session 的 attention 变化与退出事件只写 `SessionEvent`，Issue 列表保持原状，`IssueAction` 仍只有 `IssueCreated`。
- 2026-06-07：新增 `issue.rs` 回归，锁定同一 Project 下存在 standalone Session 时，Issue 查询仍只按 `issue_id` 投影 linked session 字段。
- 2026-06-07：同会话 code review 完成，未发现需要继续修复的问题；Story 3.6 状态收口为 `done`。

### File List

- _bmad-output/implementation-artifacts/3-6-ensure-temporary-session-does-not-trigger-issue-flow.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/features/agents/agents-activity.test.tsx
- src-tauri/tests/agent_session.rs
- src-tauri/tests/issue.rs

### Validation Commands

- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`

### Validation Results

- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`：通过，相关前端测试文件通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`：通过，14 个 `issue` 相关测试通过，包含新增“同项目 standalone Session 不污染 Issue 列表”回归。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：通过，25 个 `agent_session` 相关测试通过，包含新增 standalone attention / exit 隔离回归。
- `pnpm format`：通过；`prettier` 曾对无关文件 `src/features/agents/codex-terminal-snapshot.ts` 产生折行差异，该改动已回退，不纳入本 story。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过，8 个测试文件、106 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，Rust 单元测试与集成测试全部通过。

### Change Log

- 2026-06-07：创建 Story 3.6 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-07：补齐 standalone Session 与 Issue 工作流隔离的前后端回归测试，验证现有实现满足 AC，状态推进到 `review`。
- 2026-06-07：完成同会话 code review，未发现阻塞问题，状态推进到 `done`。
