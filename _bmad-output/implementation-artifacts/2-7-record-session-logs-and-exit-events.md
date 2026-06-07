---
baseline_commit: 01028ad
---

# Story 2.7: 记录 Session 日志和退出事件

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望 Agent Session 的原始输出和关键退出事件被稳定记录,
以便后续可以复盘 Codex 执行过程，并为 crashed/stopped 处理与日志入口提供可信事实来源。

## Acceptance Criteria

1. 给定 Codex PTY 持续输出内容，当输出流到达 Rust Core 时，系统把原始输出写入当前 Session log 文件，并且 SQLite 不逐字符写入终端输出。
2. 给定 AgentSession 已成功启动，当系统创建或更新 `SessionEvent` 时，SQLite 保存关键事件与 `log_path`，并且 `SessionEvent.payload` 使用统一 JSON 结构。
3. 给定 Codex 进程退出，当 Rust Core 收到 exit 信息时，系统记录退出相关 `SessionEvent`，并为后续 Epic 4 的 `crashed` / `stopped` 故事保留可消费的事实边界，而不是在本 story 中抢跑完整异常状态 UX。

## Tasks / Subtasks

- [x] 收口 Session 原始日志与结构化事件的职责边界，避免把高频终端输出写进 SQLite (AC: 1, 2)
  - [x] 以 `src-tauri/src/agent/pty_session_manager.rs`、`src-tauri/src/core/agent_session_service.rs` 和现有 `session-logs/*.log` 路径为主边界，确认原始 PTY 输出继续只写日志文件，不新增逐字符 `SessionEvent`。
  - [x] 评估当前 `read_agent_session_terminal` 的日志快照读取路径，确保日志文件仍是终端内容的单一事实来源，而 `SessionEvent` 只记录关键生命周期事件和必要摘要。
  - [x] 若需要扩展 Rust 类型或 repository，保持 `log_path`、时间戳与 JSON payload 结构和既有 schema 风格一致，不引入第二套并行日志索引模型。
- [x] 补齐 `SessionEvent` 的统一事件类型与 payload 合同，覆盖退出相关事实 (AC: 2, 3)
  - [x] 扩展 `src-tauri/src/types/session_event.rs`、`src-tauri/src/db/event_repository.rs` 及相关映射，使 `session_started` 之外的退出类事件拥有稳定字面量、统一 JSON payload 和可测试的持久化语义。
  - [x] 明确退出事件至少要携带 `sessionId`、`issueId`、退出时间、退出原因或 exit code、`logPath`，并在无法获得完整信息时保持字段缺失语义清晰，而不是混入模糊字符串。
  - [x] 本 story 只负责记录“发生了什么”；`crashed` / `stopped` 的完整状态机收口、列表分组和 UI 展示继续留给 Epic 4。
- [x] 在 Rust Core 接住 PTY / Agent 退出事实，并把它落成可复盘记录 (AC: 2, 3)
  - [x] 基于现有 PTY manager 的活会话注册与等待逻辑，在进程退出时补写结构化 `SessionEvent`，保证正常退出、异常退出至少有一条可查询记录。
  - [x] 如本 story 需要更新 `agent_sessions` 的 `last_active_at`、`closed_at` 或状态字段，只做 Epic 2.7 验收必需的最小写入，不提前实现 Epic 4 的完整 `crashed` / `stopped` 判定与 UI 联动。
  - [x] 保持 Rust Core 是日志路径、退出信息和事件写入的唯一事实来源；React 不直接推断退出原因，也不自行生成 `SessionEvent`。
- [x] 为后续复盘和异常处理留出最小可消费查询面，但不抢跑完整日志 UI (AC: 2, 3)
  - [x] 若当前仓库尚无读取 SessionEvent 的最小命令或查询能力，按最小范围补齐仅供测试或后续 story 复用的边界。
  - [x] 不在本 story 中实现完整 `Open Log`、Summary 页面或 `crashed` / `stopped` 标记 UI；这些继续由 Epic 4 / Epic 5 承接。
- [x] 测试与验证 (AC: 1, 2, 3)
  - [x] 新增 Rust 测试覆盖：Session 启动后写日志文件、退出后写入结构化 `SessionEvent`，并且不会把终端全文逐字符塞进 SQLite。
  - [x] 新增 Rust 测试覆盖：正常退出与异常退出至少拥有可区分的事件或 payload 事实，且 `log_path` 与时间戳被正确保存。
  - [x] 若本 story 修改了 TypeScript / TSX 运行时逻辑，运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
  - [x] 若本 story 修改了 Rust command / service / repository / PTY 管理层，运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与 `cargo test --manifest-path src-tauri/Cargo.toml`。

## Senior Developer Review (AI)

- Outcome: Approve
- Date: 2026-06-07
- Findings: 本轮 review 未发现阻塞 Story 2.7 交付的功能或边界问题；当前实现把退出事实统一收口到 Rust Core，保持了“日志文件承载原始输出、SQLite 只保存结构化事件”的边界，`stopped` 仍明确留给应用重启场景，不与本 story 混淆。

## Dev Notes

### 关键假设与取舍

- Story 2.6 已经用 `portable-pty` 建立活 PTY 会话管理，并确认“原始输出写 session log、前端通过日志快照轮询读终端内容”的最小闭环成立；Story 2.7 的默认取舍是在这条既有事实之上补齐结构化事件和退出记录，而不是重做终端同步方案。
- Epic 2.7 的核心不是做完整异常状态产品行为，而是把“日志在哪里、何时退出、为什么退出”先记录可靠。若此处事实源不稳定，Epic 4 的 `crashed` / `stopped` 展示与 Epic 5 的日志复盘都会建立在脏数据之上。
- 当前 `SessionEventType` 只有 `session_started`；本 story 需要把退出相关事件建模为稳定、可查询、可测试的字面量和 payload，而不是把退出信息散落在线程日志或临时字符串中。

### 范围边界

- 交付：Session 原始输出继续写日志文件、退出相关 `SessionEvent`、统一 payload 结构、最小查询/测试边界。
- 不交付：完整 `crashed` / `stopped` UX、Resume Session、Open Log 页面、Summary 页面、completion/commit 检测。
- 不交付：把日志轮询升级为实时事件流；若现有快照轮询已满足 AC，就保持最小方案。

### 架构约束

- 高频终端输出必须写日志文件，SQLite 只保存结构化事件、摘要和 `log_path`，不得逐字符写业务数据库。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-11; `_bmad-output/planning-artifacts/architecture.md` §Data Flow, §Pattern Enforcement]
- Codex 启动、退出、crash、日志写入和可能的 resume 需要统一由 Rust Core / PTY 管理层处理；React 不能直接推断这些事实。[Source: `_bmad-output/planning-artifacts/architecture.md` §Architecture Summary, §Component Boundaries]
- 所有 Agent 启动、关闭、异常都应写入 `SessionEvent`，并保持 payload 为统一 JSON 结构。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §Commands and Events, §MVP 模块边界]
- `crashed` / `stopped` 必须显式可见，但该可见性产品化属于 Epic 4；Story 2.7 只先提供可信退出事实与日志路径。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-19; `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md`]

### 当前代码状态与修改指引

- `src-tauri/src/agent/pty_session_manager.rs` 当前已经负责 PTY spawn、writer/resize/kill 与“输出持续写 log 文件”，但退出后只会从内存活会话表中移除，还没有把退出事实回写为结构化事件。
- `src-tauri/src/core/agent_session_service.rs` 当前在启动事务里只写入 `session_started` 事件；读取终端快照时依赖 `session.log_path`，这意味着日志文件已经是事实来源，2.7 应复用而不是重建。
- `src-tauri/src/types/session_event.rs` 当前仅建模 `SessionStarted`；`src-tauri/src/db/event_repository.rs` 也只映射 `session_started`，这里是本 story 的主要类型与持久化扩展入口。
- `src/features/agents/agent-session-commands.ts` 当前只有 session list 和 terminal read/write/resize command；若后续实现需要最小事件查询，优先保持边界窄，不提前实现完整日志/事件 UI。
- `spikes/embedded-codex-terminal.md` 已把“Story 2.7 直接复用当前 session log 事实来源，把退出事件和结构化 SessionEvent 补齐”写成后续建议，这应视为当前故事的直接输入约束。

### 前置故事信息

- Story 2.3 已完成 `agent_sessions` / `session_events` schema、`log_path` 持久化与 `session_started` 事件写入。
- Story 2.5 已让 Agents Activity 消费 Session 元数据，但尚未提供日志入口或退出事件细节。
- Story 2.6 已完成 PTY / xterm Spike，并确认活会话 writer、resize 和 session log 快照链路可用；退出事件回写仍显式留给 2.7。
- Story 2.8 将继续验证 resume 与 completion prompt 注入，因此 2.7 不应破坏当前 PTY manager 的活会话模型和 writer 边界。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `01028ad`。
- 当前工作区在 story creation 阶段是干净的；后续开发若出现无关改动，最终提交只能包含 Story 2.7 直接相关文件。
- 本 story 预计至少会改动 Rust command / service / repository / PTY 管理层；若同时触发前端运行时变更，默认按项目规则执行：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

### 测试要求

- 若修改了 Rust command / service / repository / PTY 管理层，必须运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与 `cargo test --manifest-path src-tauri/Cargo.toml`。
- 若修改了 TypeScript / TSX 运行时逻辑，必须运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。
- 若仓库格式化配置覆盖到本次修改文件，先运行 `pnpm format` 再进入 lint/typecheck/test。
- 所有实际执行的验证命令必须逐条写入 Dev Agent Record；不能只写“已验证”。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 2 / Story 2.7 的验收标准，以及与 2.6、2.8、Epic 4 的边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR11、FR19、日志文件、SessionEvent、退出信息与失败可见性要求。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — `log_path`、Session 状态、命令/事件草案与 MVP 模块边界。
- `_bmad-output/planning-artifacts/architecture.md` — Rust Core / PTY / 日志 / 事件的职责分离，以及高频终端输出不入 SQLite 的约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — `crashed` / `stopped`、日志入口和失败可见性的 UX 约束。
- `_bmad-output/implementation-artifacts/2-3-create-agent-session-and-update-issue-after-successful-start.md` — 已交付的 `session_started`、`log_path` 和 Session 持久化边界。
- `_bmad-output/implementation-artifacts/2-5-show-agents-activity-session-list-and-basic-header.md` — 已交付的 Session 元数据消费边界。
- `_bmad-output/implementation-artifacts/2-6-spike-codex-native-session-view-with-pty-xterm.md` — PTY/xterm Spike 结论，以及“2.7 复用 session log 事实来源并补齐退出事件”的直接前置。
- `spikes/embedded-codex-terminal.md` — 当前 PTY manager、terminal commands、日志轮询方案与后续建议。
- `src-tauri/src/agent/pty_session_manager.rs`、`src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/db/event_repository.rs`、`src-tauri/src/types/session_event.rs` — 本 story 的主要实现入口。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-07T09:xx+0800：`bmad-dev-workflow` preflight 读取 `sprint-status.yaml`，确认当前无 `ready-for-dev` story，按顺序锁定 `2-7-record-session-logs-and-exit-events`，基线 `HEAD` 为 `01028ad`。
- 2026-06-07T09:xx+0800：交叉核对 Epic 2.7、PRD、addendum、architecture、UX 与 Story 2.3 / 2.5 / 2.6，确认本 story 只补“日志与退出事实”而不提前实现完整 `crashed` / `stopped` UX。
- 2026-06-07T09:xx+0800：复查 `agent_session_service`、`pty_session_manager`、`event_repository` 与 `session_event` 类型，确认当前日志文件已是事实来源，但退出事件尚未结构化落库。
- 2026-06-07T09:10+0800：扩展 `SessionEventType` 为 `session_exited`，并在 `event_repository` 中补齐映射，确保退出事件可以作为稳定字面量持久化与回读。
- 2026-06-07T09:12+0800：在 `agent_session_repository` 新增最小 `mark_terminated_in_transaction` 写回路径，并把 PTY manager 的退出线程升级为带退出状态的回调。
- 2026-06-07T09:14+0800：在 `agent_session_service` 新增 `record_session_termination_in_data_dir`，将 `exit_code == 0` 收口为 `closed`，其余退出收口为 `crashed`，并统一写入包含 `sessionId`、`issueId`、`status`、`exitCode`、`reason`、`logPath` 的 JSON payload。
- 2026-06-07T09:16+0800：新增 `agent_session` 集成测试覆盖正常退出、非零退出和重复回写幂等性；首次测试失败暴露 `portable-pty` 的 `exit_code()` 为 `u32`，已在 PTY 边界转换为 `i32` 后复跑通过。
- 2026-06-07T09:20+0800：补齐非 PTY `start_agent_session` 测试路径的退出事件回写，避免主路径与测试/备用路径在退出事实写入上产生行为分叉。
- 2026-06-07T09:22+0800：完成 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与 `cargo test --manifest-path src-tauri/Cargo.toml` 全量复验，并做同会话代码评审，确认未把 Epic 4 的异常状态 UX 提前混入本 story。

### Completion Notes List

- 2026-06-07：create-story 已为 Story 2.7 生成开发上下文，并将实现焦点限定在 session log 与退出事件事实源。
- 2026-06-07：已明确 2.7 与 2.6 / 2.8 / Epic 4 的边界，避免把实时事件流、异常状态 UX 或日志页面混入当前 story。
- 新增 `session_exited` 结构化事件类型，并将其回读映射接入 `event_repository`，使退出事件与现有 `session_started` 一样具备稳定字面量。
- PTY 退出线程现在会携带 `exit_code` 回调到 Rust Core；Rust Core 在单个事务内写回 `agent_sessions.status` / `last_active_at` / `closed_at` 的最小退出事实，并落一条统一 JSON payload 的 `SessionEvent`。
- 退出状态采用当前 story 的最小规则：`exit_code == 0` 记为 `closed`，非 0 或缺失 exit code 记为 `crashed`；`stopped` 继续保留给应用重启后无法恢复活 PTY 的场景。
- 非 PTY 的 `start_agent_session` 路径也补齐了相同的退出事实回写，避免主路径与测试/备用路径产生行为分叉。
- 新增 Rust 集成测试覆盖正常退出、异常退出和重复回写幂等性，确保不会把终端全文写入 SQLite，且 `log_path`、`exitCode` 与 `reason` 均进入结构化 payload。

### File List

- _bmad-output/implementation-artifacts/2-7-record-session-logs-and-exit-events.md
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src-tauri/src/agent/pty_session_manager.rs
- src-tauri/src/core/agent_session_service.rs
- src-tauri/src/db/agent_session_repository.rs
- src-tauri/src/db/event_repository.rs
- src-tauri/src/types/session_event.rs
- src-tauri/tests/agent_session.rs

### Validation Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`

### Validation Results

- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：首次失败，原因是 `portable-pty` 的 `exit_code()` 返回 `u32`，与新增退出事件模型的 `Option<i32>` 不一致；已在 PTY 边界统一转换后修复。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：修正退出码类型后复跑，通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：复跑通过，13 个测试全部通过，新增退出事件与幂等性用例通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，`agent_session`、`issue`、`local_data`、`project`、`settings` 全量 Rust 测试通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：补齐非 PTY 退出事实回写后复跑，通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：补齐非 PTY 退出事实回写后再次复跑，通过。

### Change Log

- 2026-06-07：创建 Story 2.7 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-07：完成退出事件类型、PTY/非 PTY 退出事实回写、最小 session 终止持久化与 Rust 集成测试，状态推进到 `review`。
- 2026-06-07：完成 Senior Developer Review (AI)，未发现阻塞问题，状态推进到 `done`。
