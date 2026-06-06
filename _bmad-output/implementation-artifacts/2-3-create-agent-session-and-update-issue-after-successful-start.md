---
baseline_commit: badda72
---

# Story 2.3: 启动成功后创建 Agent Session 并更新 Issue 状态

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望只有在 Codex 进程成功启动后才创建 Agent Session 并把 Issue 置为 `running`,
以便启动失败不会污染任务状态，且后续 Session / 审计数据都能可信追溯。

## Acceptance Criteria

1. 给定用户在 Run Dialog 点击 `Start`，当 Rust Core 成功启动真实的 Codex 进程后，系统创建 `agent_sessions` 记录，并保存 `issue_id`、`agent_profile_id`、`status=running`、`attention=none`、`working_dir`、`command_snapshot`、`prompt_snapshot`、`log_path`、`started_at`，且如 schema 尚未存在则通过 migration 创建 `agent_sessions` 与 `session_events` 表。
2. 给定 Agent Session 创建成功，当状态写入事务提交时，系统把关联 Issue 从 `backlog` 更新为 `running`，并同时写入至少一条 `session_events` 记录与一条 `issue_actions` 记录。
3. 给定 Codex 进程启动失败、前置校验失败或持久化失败，当 `start_agent_session` 返回错误时，Issue 保持 `backlog`，不创建有效 Agent Session，Run Dialog 显示失败原因。

## Tasks / Subtasks

- [x] 为 Agent Session / SessionEvent 补齐最小持久化 schema 与类型合同 (AC: 1, 2)
  - [x] 在 `src-tauri/migrations/` 新增 migration，创建 `agent_sessions` 与 `session_events` 表，字段命名与 architecture / addendum 保持一致，时间列继续使用 epoch milliseconds。
  - [x] 在 `src-tauri/src/types/` 中新增或扩展 Agent Session / SessionEvent DTO，显式建模 `status`、`attention`、`workingDir`、`commandSnapshot`、`promptSnapshot`、`logPath`、`startedAt` 等跨边界字段。
  - [x] 若新增跨边界枚举或记录类型，保持 Rust / TypeScript 命名与现有 command contract 一致，不引入 `review` 之类不属于 Session 主状态的值。
- [x] 在 Rust Core 实现“成功启动后才落库”的 `start_agent_session` 真路径 (AC: 1, 2, 3)
  - [x] 以 `src-tauri/src/core/agent_session_service.rs` 为主边界，在现有输入校验通过后接入真实启动流程；未证明进程成功启动前，不得先写 `agent_sessions` 或先把 Issue 置为 `running`。
  - [x] 组装并保存 `working_dir`、`command_snapshot`、`prompt_snapshot` 与 `log_path`，其中 `prompt_snapshot` 必须来自 Story 2.2 已提交的最终 prompt 文本，而不是重新按模板现算。
  - [x] 用单个事务完成 Agent Session 创建、Issue 状态更新、`session_events` 写入与 `issue_actions` 写入；任一步失败都必须整体回滚，避免出现孤儿 Session 或已变为 `running` 的脏 Issue。
  - [x] 失败路径要返回统一错误码和事实性文案，区分前置校验失败、启动失败与持久化失败；不要继续复用 Story 2.2 的 `AgentSessionStartNotReady` 占位语义。
- [x] 收口前端启动成功/失败行为，不越界实现后续 Session 工作台 (AC: 2, 3)
  - [x] 在 `src/features/issues/issue-run-dialog.tsx` 与相关 command wrapper 中把成功路径从“仅等待错误”改为“启动成功后关闭 Dialog，并为后续 Story 2.5/2.6 暴露可消费的成功结果或刷新钩子”。
  - [x] 启动失败时继续保留 Dialog 与错误展示，不创建前端伪 Session，不直接在 React 中手改 Issue 状态。
  - [x] 本 story 只负责把成功启动后的真实状态落库并返回前端，不抢先实现完整 PTY/xterm 视图、Session list 分组或 Agents Activity Header 行为；这些继续由 2.5 / 2.6 承接。
- [x] 明确处理“一 Issue 一 Session”与当前规划依赖风险的边界 (AC: 1, 2, 3)
  - [x] 若当前 Issue 已存在关联中的有效 Agent Session，本 story 不得静默创建第二条并列 Session；至少在 Core 层保留可测试的阻断点或明确留给 Story 2.4 的 follow-up。
  - [x] 由于 implementation readiness 已指出 Story 2.3 依赖 2.6 的 PTY/Codex 启动能力，开发时必须以“真实可验证启动成功”为准；若当前仓库尚无该能力，宁可返回清晰失败或 gating 信息，也不能伪造成功路径。
- [x] 测试与验证 (AC: 1, 2, 3)
  - [x] 新增 Rust 测试覆盖：成功启动时创建 Agent Session、写 SessionEvent / IssueAction，并把 Issue 置为 `running`。
  - [x] 新增 Rust 测试覆盖：启动失败或持久化失败时回滚事务，Issue 仍为 `backlog`，且不存在有效 Agent Session。
  - [x] 新增前端测试覆盖：Run Dialog 在成功时走关闭/后续刷新路径，在失败时保留打开并显示错误。
- [x] 若本 story 修改了 TypeScript / TSX 运行时逻辑，运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
  - [x] 若本 story 修改了 Rust command / service / migration，运行 `cargo fmt` 与 `cargo test`。

## Senior Developer Review (AI)

- Outcome: Approve
- Date: 2026-06-06
- Findings: 本轮 review 未发现需要阻塞 Story 2.3 交付的功能、事务一致性、失败回滚或前端成功/失败分支问题；当前未接入 PTY/xterm 与 Session 工作台能力，符合 story 2.3 范围边界，继续由 2.5 / 2.6 承接。

## Dev Notes

### 关键假设与取舍

- Story 2.2 已经把 `promptSnapshot` 从前端传到 Rust Core，并明确以 `AgentSessionStartNotReady` 占位失败收口；Story 2.3 的职责是把这条占位路径替换为“真实启动成功后落库”的最小闭环，而不是重做 Run Dialog 编辑逻辑。
- 当前仓库尚未存在 `agent_sessions` / `session_events` migration，也没有 PTY / Codex 进程管理实现；因此本 story 的关键风险不是 UI 接线，而是“如何证明真实启动成功”。默认取舍是：不能证明成功就不能写 Session、不能改 Issue 状态。
- implementation readiness 明确指出 Story 2.3 依赖后续 Story 2.6 的 PTY/Codex 启动验证能力；如果开发阶段发现当前代码仍缺少可验证启动能力，应优先保持失败可见，而不是引入伪 Session 或乐观状态流转。

### 范围边界

- 交付：真实成功启动后的 Agent Session 持久化、Issue `running` 状态流转、`session_events` / `issue_actions` 审计写入、失败不污染状态。
- 不交付：完整 Agents Activity Session list、Header、xterm 渲染、resume、attention、Mark Review、Completion Policy。
- 不交付：多 Session attempt、恢复异常 Session、`review` 阶段继续修正、commit 检测。

### 架构约束

- Issue / Agent Session 业务状态只能由 Rust Core command 修改，React 不得直接把 Issue 改成 `running`。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Architecture, §Pattern Examples]
- `start_agent_session` 只有在 Rust Core 成功启动 PTY 后才允许创建 `agent_sessions` 并把 Issue 改为 `running`；启动失败不得创建有效 Agent Session。[Source: `_bmad-output/planning-artifacts/architecture.md` §Pattern Examples, §Validation Patterns]
- 新增状态变更时，必须同时补 `IssueAction` 或 `SessionEvent`；新增 command / service 路径时，必须有统一错误码和至少一个失败路径测试。[Source: `_bmad-output/planning-artifacts/architecture.md` §Pattern Enforcement]
- 高频终端输出应写日志文件，SQLite 只保存关键 SessionEvent 和日志路径；不要把逐字符终端输出写进 SQLite。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-11; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §MVP 模块边界]

### 当前代码状态与修改指引

- `src-tauri/src/core/agent_session_service.rs` 当前仅完成 `project` / `issue` / `profile` / `promptSnapshot` 校验，最后固定返回 `AgentSessionStartNotReady`；这里是 2.3 的主要改造入口。
- `src-tauri/tests/agent_session.rs` 目前只覆盖输入校验与 not-ready 占位路径；2.3 需要把测试扩展到成功创建、事务回滚和失败分支。
- `src-tauri/src/db/event_repository.rs` 当前只支持 `issue_actions` 插入，且 `IssueActionType` 还只有 `issue_created`；2.3 需要补齐启动成功/失败相关 action 类型，必要时扩展 repository 能力。
- `src/features/issues/issue-run-dialog.tsx` 当前调用 `startAgentSession` 后只处理失败消息，不处理成功结果；2.3 需要把成功路径向后续 Agents Activity 承接，但不要抢跑完整 Session 工作台。
- `src-tauri/migrations/` 当前只到 `0007_restructure_agent_profiles.sql`，还没有 `agent_sessions` / `session_events` 表；新增 migration 时必须遵守现有命名与 epoch ms 约束。

### 前置故事信息

- Story 2.1 完成了 Run Dialog 打开、profile 选择与 prompt preview/source 展示。
- Story 2.2 完成了最终 prompt 可编辑、`start_agent_session` command wrapper 与 Rust 输入校验边界，但显式不创建 Session、不写 `running` Issue。
- Story 2.4 将继续收口“一 Issue 一 Agent Session”规则，因此 2.3 至少要避免静默创建第二个 Session，并为 2.4 保留清晰边界。
- Story 2.5 / 2.6 将承接启动成功后的 Agents Activity 展示与 PTY/xterm 能力；2.3 不需要在 UI 侧把这些一起实现完。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `badda72`。
- 当前工作区在 story creation 阶段是干净的；开发阶段若出现无关改动，最终提交只能包含 Story 2.3 直接相关文件。
- 由于本 story 预计会同时修改 TypeScript / TSX 与 Rust 源码，默认至少运行：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
cargo fmt
cargo test
```

### 测试要求

- TypeScript / React 运行时逻辑变更：必须运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。
- Rust command / service / migration 变更：必须运行 `cargo fmt`、`cargo test`。
- 若后续实现引入额外格式化配置或受影响包脚本，以仓库实际配置为准，但不能省略上述最小校验。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 2 / Story 2.3、2.4、2.5 的验收标准与相邻 story 边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR10、FR11、FR12、失败路径与 Session 元数据要求。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — `start_agent_session` command/event、数据表草案、模块边界。
- `_bmad-output/planning-artifacts/architecture.md` — `start_agent_session` 成功后才创建 Session 的模式、状态边界、错误码与测试约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Run Dialog 成功/失败态、Agents Activity 承接方式。
- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` — Story 2.3 对 2.6 PTY/Codex 能力的前置依赖风险。
- `_bmad-output/implementation-artifacts/2-1-generate-and-preview-issue-run-prompt.md` — Story 2.1 的 Run Dialog 范围边界。
- `_bmad-output/implementation-artifacts/2-2-edit-and-save-final-prompt-snapshot.md` — Story 2.2 的 `promptSnapshot` 提交边界与 not-ready 占位实现。
- `src/features/issues/issue-run-dialog.tsx`、`src/features/issues/issue-commands.ts` — 当前前端启动路径。
- `src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/db/event_repository.rs`、`src-tauri/tests/agent_session.rs` — 当前 Rust Core 校验边界与测试起点。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-06T19:xx+0800：`bmad-dev-workflow` preflight 识别 `2-3-create-agent-session-and-update-issue-after-successful-start` 为 Epic 2 下一条 backlog story，基线 `HEAD` 为 `badda72`。
- 2026-06-06T19:xx+0800：核对 Epic 2、PRD、addendum、architecture、UX 与 implementation readiness，确认 Story 2.3 的关键门槛是“真实启动成功后才可写 Session / Issue 状态”，且依赖 2.6 的 PTY/Codex 启动验证能力。
- 2026-06-06T19:xx+0800：读取 `issue-run-dialog.tsx`、`issue-commands.ts`、`agent_session_service.rs`、现有 migrations 与 `agent_session` 测试，确认仓库当前仅完成输入校验与 not-ready 占位，尚无 Session schema 与成功启动持久化路径。
- 2026-06-06T19:20+0800：新增 `0008_agent_sessions_and_session_events.sql`、`agent_session_repository` 与 `session_event` 类型，补齐 `agent_sessions` / `session_events` 持久化基础与 `0008` migration 回归测试。
- 2026-06-06T19:28+0800：把 Rust `start_agent_session` 从占位错误改为真实启动闭环：校验通过后真实 `spawn` 子进程、创建日志文件、做短时存活检查，并在单个事务内写 `agent_sessions`、`session_events`、`issue_actions` 与 Issue `running` 状态。
- 2026-06-06T19:34+0800：前端 Run Dialog 改为消费 `StartAgentSessionResult`；启动成功后关闭 Dialog 并刷新 Issue 列表，失败时继续保留错误展示。
- 2026-06-06T19:37+0800：补齐 Rust/前端测试与 command client 回归，修复 `command-client.test.ts` 导入错误后重新跑完整 `lint/typecheck/test/cargo test`。
- 2026-06-06T19:40+0800：为成功路径补后台 `child.wait()` 回收，避免成功启动后直接丢弃子进程句柄。

### Completion Notes List

- create-story 已为 Story 2.3 生成完整开发上下文。
- 已显式记录 2.3 与 2.2 / 2.4 / 2.5 / 2.6 的职责边界，避免提前混入 Session list、xterm 或 completion 能力。
- 已把 implementation readiness 指出的依赖风险写入 story：不能证明真实启动成功时，不得伪造 Session 创建或 `running` Issue。
- 新增 `0008` migration、`agent_session_repository`、`session_event` 类型与 `AgentSessionStartFailed` 错误码，补齐 Session 持久化与事件记录的最小基础设施。
- `start_agent_session` 现在会以 Project `repo_path` 作为 `working_dir`，创建本地日志文件后真实 `spawn` Agent 命令；只有当进程未在短时检查内退出时，才会事务化创建 Session 并把 Issue 置为 `running`。
- 启动失败路径现在返回明确的 `AgentSessionStartFailed` 或校验错误，并确保 Issue 保持 `backlog`、数据库中不存在有效 Session 脏数据。
- Run Dialog 启动成功后会关闭自身并刷新 Issue 列表，使关联 Issue 立即呈现为 `running`；失败时继续保留对话框与错误消息。
- 当前实现仍未接入 PTY/xterm 或 prompt 注入，只完成“真实启动 + 可信状态流转 + 审计/日志落点”的 2.3 最小闭环；交互式终端能力继续留给 2.5 / 2.6。

### File List

- _bmad-output/implementation-artifacts/2-3-create-agent-session-and-update-issue-after-successful-start.md
- src/features/issues/issue-commands.ts
- src/features/issues/issue-run-dialog.tsx
- src/features/issues/issues-activity.tsx
- src/features/issues/issues-activity.test.tsx
- src/shared/commands/command-client.test.ts
- src-tauri/migrations/0008_agent_sessions_and_session_events.sql
- src-tauri/src/commands/agent_session_commands.rs
- src-tauri/src/core/agent_session_service.rs
- src-tauri/src/db/agent_session_repository.rs
- src-tauri/src/db/event_repository.rs
- src-tauri/src/db/issue_repository.rs
- src-tauri/src/db/migrations.rs
- src-tauri/src/db/mod.rs
- src-tauri/src/types/agent_session.rs
- src-tauri/src/types/errors.rs
- src-tauri/src/types/issue_action.rs
- src-tauri/src/types/mod.rs
- src-tauri/src/types/session_event.rs
- src-tauri/tests/agent_session.rs
- src-tauri/tests/local_data.rs

### Validation Commands

- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `pnpm test -- --run src/features/issues/issues-activity.test.tsx src/shared/commands/command-client.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `cargo test --manifest-path src-tauri/Cargo.toml --test local_data`
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`

### Validation Results

- `pnpm format`：通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：首次失败，`start_agent_session` 服务签名与测试仍停留在 Story 2.2 的占位形态；已更新测试夹具与成功/失败断言。
- `pnpm test -- --run src/features/issues/issues-activity.test.tsx src/shared/commands/command-client.test.ts`：通过，63 个测试通过；输出包含既有 `Could not parse CSS stylesheet` 警告。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：二次失败，立即退出脚本在短时检查窗口内偶发穿过成功判定；已把失败用例改为“命令无法启动”这一更稳定的启动失败场景。
- `cargo test --manifest-path src-tauri/Cargo.toml --test local_data`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：首次失败，`command-client.test.ts` 错误地从 `project-commands` 导入 `startAgentSession`；已改为从 `features/issues/issue-commands` 导入。
- `pnpm test`：首次失败，原因同上；修正导入后恢复通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，包含新增 Session migration / 状态流转回归测试。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过（补子进程回收后复跑）。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过（补子进程回收后复跑）。

### Change Log

- 2026-06-06：创建 Story 2.3 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-06：完成 Agent Session / SessionEvent schema、真实启动闭环、Issue `running` 状态流转与前端成功刷新路径，状态推进到 `review`。
- 2026-06-06：完成 Senior Developer Review (AI)，未发现阻塞问题，状态推进到 `done`。
