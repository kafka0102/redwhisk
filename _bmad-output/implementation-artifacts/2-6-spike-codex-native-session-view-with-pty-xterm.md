---
baseline_commit: bf81423
---

# Story 2.6: 运行 Codex Native Session View 的 PTY/xterm Spike

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望在 RedWhisk 内嵌终端中直接看到并操作 Codex TUI,
以便在不离开当前工作台的前提下，获得接近原生 CLI 的 Agent 交互体验，并验证后续 Session / review / completion 流程依赖的 PTY 基础是否成立。

## Acceptance Criteria

1. 给定用户启动某个 Codex `AgentSession`，当 Rust Core 创建 PTY 并拉起 Codex CLI 时，Codex 在该 PTY 中运行，并继承用户 login shell 下可用的 PATH。
2. 给定 Codex PTY 已在运行，当前端渲染 Codex Native Session View 时，xterm.js 能显示 Codex TUI 的主要界面、颜色和交互，且用户输入直接进入 Codex TUI，不额外实现独立聊天输入框。
3. 给定用户在 Codex Native Session View 中进行操作，当用户按 Enter、方向键、Ctrl+C、执行粘贴或调整窗口大小时，对应输入和 resize 能正确传递到 PTY，并记录 Spike 结论与兼容性风险。

## Tasks / Subtasks

- [x] 在 Rust Core 落地最小 PTY 会话管理能力，证明 Codex 真实运行在可交互终端内 (AC: 1, 3)
  - [x] 评估并接入适合当前 Tauri/Rust 运行时的 PTY 方案，建立 `agent/pty_session` 或同等边界，负责 spawn、stdin/stdout、resize、exit code 和生命周期清理。
  - [x] 调整现有 Agent 启动路径，使 `start_agent_session` 不再只做普通子进程存活检查，而是以 PTY 方式启动 Codex，并显式继承 login shell PATH 或等价环境解析结果。
  - [x] 保持 Rust Core 仍是进程、日志和状态写入的唯一事实来源；React 不直接执行 shell，也不自行管理 PTY 生命周期。
- [x] 在前端将 Agents Activity 右侧占位主区替换为最小可用的 Codex Native Session View (AC: 2, 3)
  - [x] 在 `src/features/agents/` 落地 xterm.js 容器组件，挂接 PTY 输出流，并为终端区域提供可读 label，例如 `Codex Session terminal`。
  - [x] 不新增独立聊天输入框；键盘输入、粘贴和基础焦点行为直接交给终端组件处理。
  - [x] 保持现有 Agents Activity 左右两栏结构、Header 行为和 Issue 上下文入口不变，不把完整 Inspector / Completion / Review 控件混入本 story。
- [x] 验证 PTY 与 xterm 的关键交互链路，并把 Spike 结果落成可追溯结论 (AC: 1, 2, 3)
  - [x] 验证 Enter、方向键、Ctrl+C、粘贴、窗口 resize、退出检测是否可稳定传递到 Codex PTY。
  - [x] 验证原始输出仍写入 Session log 文件，避免把高频终端输出逐字符写入 SQLite。
  - [x] 新增并维护 Spike 结果文档，记录 macOS 实测结论，以及 Windows/Linux 的兼容性风险、已知限制和可接受降级。
- [x] 为 PTY / xterm 边界补齐最小测试与验证命令 (AC: 1, 2, 3)
  - [x] 为新增的 Rust PTY 管理或服务边界补充单元/集成测试，至少覆盖启动、退出与 resize/输入转发的可断言部分。
  - [x] 为前端终端容器补充组件测试或命令桥接测试，至少覆盖渲染 label、订阅/清理和关键事件转发入口。
  - [x] 若本 story 修改了 TypeScript / TSX 运行时逻辑，运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
  - [x] 若本 story 修改了 Rust command / service / agent 运行层，运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与 `cargo test --manifest-path src-tauri/Cargo.toml`。

## Senior Developer Review (AI)

- Outcome: Approve
- Date: 2026-06-06
- Findings: 本轮 review 未发现阻塞 Story 2.6 交付的功能或边界问题；当前采用“活 PTY + session log 快照轮询”的最小方案，已满足 Spike 目标，跨重启恢复与更低延迟事件流继续留给后续故事。

## Dev Notes

### 关键假设与取舍

- Story 2.6 是一个 Spike，但不是“只写结论文档”的纯研究任务；它必须以最小实现证明 RedWhisk 可以在内嵌终端里承载真实 Codex TUI，并把结论回写为后续故事的可信前置事实。
- Story 2.3 已经完成“启动成功后写 Session / Issue 状态”的最小闭环，Story 2.5 已经完成 Agents Activity 左右两栏和 Header；2.6 的默认取舍是在这些既有事实之上替换右侧占位主区，不重做 Session list、Issue Inspector 或 completion 流程。
- 由于 implementation readiness 已明确指出 Story 2.3 对 2.6 存在前置依赖，本 story 应把“PTY/Codex 能力是否足够稳定”当成核心验收对象；若某能力不稳定，必须留下事实性降级或风险记录，不能口头略过。

### 范围边界

- 交付：Codex 通过 PTY 启动、xterm.js 显示与输入转发、resize / Ctrl+C / 粘贴等关键交互验证、Spike 结论文档。
- 不交付：临时 Session 创建、resume / completion prompt 注入、review 阶段继续修正的完整 UX、Issue Inspector 完整编辑、异常 Session 恢复策略。
- 不交付：把 `crashed` / `stopped` 的完整业务闭环一起做完；本 story 只需记录退出检测与风险，为 2.7、2.8、Epic 4 提供事实基础。

### 架构约束

- Codex 必须通过 Rust PTY 管理，xterm.js 只负责展示与输入转发；React 不能直接调用 shell 执行任意命令。[Source: `_bmad-output/planning-artifacts/architecture.md` §关键边界, §Communication Patterns]
- 打开/关闭 Dialog、Issue Inspector 或 Header 操作不得卸载 xterm；终端实例生命周期应独立于周边面板交互。[Source: `_bmad-output/planning-artifacts/architecture.md` §Component Boundaries; `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md`]
- 高频终端输出应进入日志文件，而不是逐字符写入 SQLite；SQLite 只保存关键 `SessionEvent` 和日志路径。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Flow; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §MVP 模块边界]
- xterm 区域必须具备可读 label，键盘输入原样传递给终端，可访问性状态不能只靠颜色表达。[Source: `_bmad-output/planning-artifacts/epics.md` UX-DR21, NFR8; `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md`]

### 当前代码状态与修改指引

- `src/features/agents/agents-activity.tsx` 已在 Story 2.5 中建立左右两栏与右侧终端占位文案；2.6 应把该占位收口为真实终端容器，而不是重新设计 Activity 布局。
- `src/features/agents/` 目录当前尚未存在完整 `codex-terminal.tsx` 实现；architecture 已把该组件作为目标落点，2.6 可以按该边界增量落地。
- `src-tauri/src/core/agent_session_service.rs` 当前已能成功启动 Codex 并创建 `agent_sessions`，但现有成功路径还是普通子进程模型；2.6 需要把“可验证成功启动”的底层事实升级为 PTY 驱动。
- `src-tauri/src/db/agent_session_repository.rs`、`session_events` 与日志路径基础已存在；2.6 应复用现有 Session / log 事实来源，避免为了终端输出单独引入第二套状态通道。
- `src-tauri/src/agent/` 按 architecture 应承载 AgentAdapter、CodexAdapter 与 PTY 管理；若当前目录结构尚未完整，可按最小需要增量建立，不提前抽象完整多 Agent 框架。

### 前置故事信息

- Story 2.3 已完成 Session 持久化、Issue `running` 状态流转与日志路径落点，但尚未验证 PTY/xterm 的真实终端体验。
- Story 2.4 已收口一 Issue 一 Session 的启动约束，避免因为 PTY 缺口而暴露第二条并列 Session。
- Story 2.5 已完成 Agents Activity Session list、基础 Header 与右侧终端占位，为 2.6 提供稳定 UI 承载面。
- Story 2.7 将承接原始 Session 日志与退出事件的系统化记录；2.6 可以先验证日志与退出检测链路，但不需要在本 story 把完整事件审计能力补完。
- Story 2.8 将承接 resume / completion prompt 注入 Spike，因此 2.6 只需把 PTY 作为后续注入与恢复能力的基础设施前提建立清楚。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `bf81423`。
- 当前工作区在 story creation 阶段是干净的；后续开发若出现无关改动，最终提交只能包含 Story 2.6 直接相关文件。
- 由于本 story 预计会同时修改 TypeScript / TSX 与 Rust 源码，默认至少运行：

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
- Rust command / service / PTY 管理层变更：必须运行 `cargo fmt --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`。
- 若新增单独的 Spike 验证脚本或手工验证命令，必须把实际运行命令逐条记录到 Dev Agent Record，不能只写“已验证 PTY 可用”。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 2 / Story 2.6 的验收标准，以及 FR14、NFR4、NFR7、NFR8、UX-DR21 的原始来源。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR13、FR14、Agents Activity 与 Codex Native Session View 的产品边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — Embedded Codex Terminal Spike 验收清单、模块边界与日志约束。
- `_bmad-output/planning-artifacts/architecture.md` — PTY/xterm 边界、`features/agents` 组件落点、Rust Core 职责与日志/事件数据流。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Codex Native Session View、键盘/焦点约束、Inspector/Dialog 不卸载 xterm 的 UX 规则。
- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` — Story 2.3 对 2.6 PTY/Codex 能力存在前置依赖的风险说明。
- `_bmad-output/implementation-artifacts/2-3-create-agent-session-and-update-issue-after-successful-start.md` — 已交付的 Session 创建、Issue `running` 流转与日志路径边界。
- `_bmad-output/implementation-artifacts/2-4-enforce-one-agent-session-per-issue.md` — 一 Issue 一 Session 规则与 `Open Session` 入口边界。
- `_bmad-output/implementation-artifacts/2-5-show-agents-activity-session-list-and-basic-header.md` — 已交付的 Agents Activity 左右两栏、Header 与终端占位边界。
- `src/features/agents/agents-activity.tsx`、`src/features/agents/`、`src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/agent/` — 2.6 的主要实现入口。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-06T22:xx+0800：`bmad-dev-workflow` preflight 识别当前无 `ready-for-dev` story，按 sprint 顺序锁定 `2-6-spike-codex-native-session-view-with-pty-xterm`，基线 `HEAD` 为 `bf81423`。
- 2026-06-06T22:xx+0800：交叉核对 Epic 2、PRD addendum、architecture、UX 与 implementation readiness，确认 2.6 的核心是“以最小实现验证 PTY/xterm 承载真实 Codex TUI”，而不是继续扩展 Session list 或 review/completion 功能。
- 2026-06-06T22:xx+0800：复查 Story 2.3、2.4、2.5 的实现工件，确认 2.6 以前的基础已具备 Session 创建、一 Issue 一 Session 和 Agents Activity 终端占位，可在此基础上推进到真实终端视图。
- 2026-06-06T22:20+0800：引入 `portable-pty` 与 xterm.js / FitAddon，建立 `PtySessionManager`，把 `start_agent_session` 的 Tauri command 路径切换到 PTY 启动和活会话注册。
- 2026-06-06T22:34+0800：新增 `read/write/resize_agent_session_terminal` commands 与前端 terminal command bridge；Agents 右侧主区从占位文案切换为 `CodexTerminal`。
- 2026-06-06T22:46+0800：为 jsdom 测试环境增加事实性降级；补齐 terminal bridge 测试、`CodexTerminal` 降级测试和 `PtySessionManager` 集成测试。
- 2026-06-06T22:55+0800：完成 `pnpm format`、`cargo fmt --manifest-path src-tauri/Cargo.toml`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 与 `cargo test --manifest-path src-tauri/Cargo.toml`，并整理 Spike 结论文档。

### Completion Notes List

- 使用 `portable-pty` 建立了最小的活会话管理层：Rust Core 现在可以在 PTY 中启动 Codex、持有 writer/resize/kill 能力，并持续把输出写入现有 session log。
- `start_agent_session` 在桌面运行路径上切换到 PTY 启动，并保持“数据库事务成功后才注册活会话”的顺序，避免脏 Session 泄漏到前端。
- Agents 右侧主区新增 `CodexTerminal`，使用 xterm.js 呈现终端内容；用户输入直接进入 PTY，不额外新增聊天输入框。
- 终端内容同步采用“session log 快照轮询”而不是事件流推送，这是本 story 的刻意最小方案；足以验证 Spike 目标，同时避免提前把 2.6 扩成完整终端总线。
- 新增 `spikes/embedded-codex-terminal.md`，把当前 macOS 开发环境下的实现结论、限制和后续建议落成文档。
- 当前仍不处理跨应用重启后的活 PTY 恢复，也不补 `crashed/stopped` 的完整状态写回；这些显式留给 Story 2.7 / 2.8 与 Epic 4。

### File List

- _bmad-output/implementation-artifacts/2-6-spike-codex-native-session-view-with-pty-xterm.md
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- _bmad-output/implementation-artifacts/sprint-status.yaml
- package.json
- pnpm-lock.yaml
- spikes/embedded-codex-terminal.md
- src/app/app.css
- src/features/agents/agent-session-commands.ts
- src/features/agents/agents-activity.test.tsx
- src/features/agents/agents-activity.tsx
- src/features/agents/codex-terminal.test.tsx
- src/features/agents/codex-terminal.tsx
- src/shared/commands/command-client.test.ts
- src-tauri/Cargo.lock
- src-tauri/Cargo.toml
- src-tauri/src/agent/mod.rs
- src-tauri/src/agent/pty_session_manager.rs
- src-tauri/src/app_state.rs
- src-tauri/src/commands/agent_session_commands.rs
- src-tauri/src/core/agent_session_service.rs
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
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过，8 个测试文件、83 个测试通过；jsdom 运行过程中仍输出既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败，且本 story 已在 `CodexTerminal` 中对 headless 环境做事实性降级。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过；包含新增 `pty_session_manager_forwards_input_resizes_and_persists_output` 在内的全部 Rust 单测、集成测试与文档测试通过。

### Change Log

- 2026-06-06：创建 Story 2.6 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-06：完成 PTY session manager、terminal commands、xterm 容器、Spike 文档与前后端验证，状态推进到 `done`。
