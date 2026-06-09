---
baseline_commit: c0c09f39ceba751fb4e04c96412173a0c3afb07e
---

# Story 6.1: 稳定 Agent Session 终端渲染

Status: review

<!-- 说明：本 story 来自 2026-06-09 用户反馈，不是原 sprint backlog 中的既有 story。它用于修复已交付 Agent Session 终端体验中的高优先级稳定性问题。 -->

## Story

作为本地开发者,
我希望 Agent Session 的 Codex TUI 在 RedWhisk 中稳定显示和交互,
以便点击运行、切换 Session 或返回页面时不会闪烁、大片空白、整页变白或出现乱码。

## Acceptance Criteria

1. 给定用户从 Issue 或临时 Session 点击运行，当 Codex TUI 开始输出时，终端区域不得因为日志快照重放而反复清屏、闪烁或出现大片空白。
2. 给定用户在 Agents Activity 中切换 Session、打开/关闭 Issue Inspector/Dialog 或从其他 Activity 切回 Agents，当目标 Session 仍可用时，Codex TUI 应恢复到最近的稳定终端状态，并继续接收后续实时输出。
3. 给定 Codex 输出包含 ANSI/OSC/CSI 控制序列、颜色查询、光标移动、全屏 TUI 重绘或多字节字符，前端不得把截断日志尾部当作完整终端协议重放；乱码、残缺控制序列和全页白屏必须被避免或降级为明确错误状态。
4. 给定 PTY 输出频繁到达，系统必须保持“原始输出写 session log，SQLite 只保存关键事件”的既有边界，同时为 xterm 渲染提供低延迟输出通道或等价机制。
5. 给定参考项目 `/Users/yujianjia/workspace/open/coding/kanban/src/terminal` 的实现已被分析，最终实现必须明确采用其中可迁移的方案思想，并记录不能照搬的部分及原因。
6. 给定 Codex 进程退出、Session 不活跃或恢复快照不可用，UI 必须展示事实性状态，不得清空整个应用页面，也不得把终端故障扩散到 Agents Activity 外层布局。

## Tasks / Subtasks

- [x] 复现并定位当前终端渲染故障根因 (AC: 1, 3, 6)
  - [x] 用现有 `CodexTerminal` 路径复现点击运行后的闪烁、空白、切回白屏或乱码；记录触发步骤、Session 状态、日志尾部特征和前端错误。
  - [x] 分析 `src/features/agents/codex-terminal.tsx` 与 `codex-terminal-snapshot.ts`：确认 `read_agent_session_terminal` 轮询日志尾部、`resolveSnapshotUpdate` 无法拼接时 `terminal.reset()` 重放，是当前 TUI 状态不稳定的核心风险。
  - [x] 分析 `src-tauri/src/agent/pty_session_manager.rs`：确认 PTY 输出线程当前只写日志文件，没有面向活 xterm 的实时输出订阅、恢复快照或协议完整性保护。

- [x] 参考 kanban 终端实现并形成 RedWhisk 可迁移设计 (AC: 2, 3, 4, 5)
  - [x] 对照 `/Users/yujianjia/workspace/open/coding/kanban/src/terminal/session-manager.ts`，提取可迁移思想：PTY 输出实时 fan-out、输出批处理、活 viewer 附着/分离、resize 与输入直接写 PTY。
  - [x] 对照 `/Users/yujianjia/workspace/open/coding/kanban/src/terminal/terminal-state-mirror.ts`，提取可迁移思想：服务端维护 headless terminal mirror，并用 serialize snapshot 为重新连接的前端恢复完整终端状态。
  - [x] 对照 `/Users/yujianjia/workspace/open/coding/kanban/src/terminal/terminal-protocol-filter.ts`，评估是否需要拦截 OSC 10/11 颜色查询、抑制设备属性查询、缓存跨 chunk 的残缺控制序列。
  - [x] 明确不可照搬项：kanban 是 Node + WebSocket + `node-pty`，RedWhisk 是 Tauri + Rust Core + `portable-pty` + Tauri command/event；不得引入 HTTP/WebSocket 服务端作为 MVP 桌面终端通道。
  - [x] 在 story Dev Agent Record 中写出最终选择：Rust/Tauri event 实时流、Rust 侧或前端侧可恢复镜像、或经验证的等价方案；不能只写“参考 kanban”。

- [x] 将终端显示通道从日志尾部重放改为实时输出流 + 恢复快照或等价机制 (AC: 1, 2, 3, 4)
  - [x] 在 Rust Core/PTY 管理层增加面向 `session_id` 的输出广播能力：PTY reader 每次读到 chunk 时仍写入 log，同时向活前端 viewer 发送终端输出事件。
  - [x] 事件 payload 必须包含 `projectId`、`sessionId`、顺序信息或可去重标识、输出数据；若使用文本传输，需要明确二进制/UTF-8 损坏风险并处理多字节边界。
  - [x] 前端 `CodexTerminal` 应订阅当前 Session 的输出事件并直接 `terminal.write(chunk)`，停止依赖 `setInterval` 轮询日志尾部作为活 TUI 渲染主路径。
  - [x] 为切换回来后的终端恢复提供快照：优先实现等价 kanban 的完整终端状态 snapshot；若 Rust 侧无法低风险引入终端仿真镜像，必须实现一个清晰降级方案，并证明不会再重放截断 ANSI 日志导致白屏/乱码。
  - [x] 保留 `read_agent_session_terminal` 或日志读取能力仅用于非活 Session / Open Log / 诊断降级，不作为 running Session 的实时 TUI 主通道。

- [x] 防止终端异常破坏页面外层 UI (AC: 2, 6)
  - [x] `CodexTerminal` 内部初始化、订阅、写入、恢复和 dispose 的异常必须被局部捕获并展示在终端 shell 内，不得让 React render/effect 异常冒泡成整个页面白屏。
  - [x] 切换 `projectId` / `sessionId` 时必须按顺序清理旧订阅、旧 resize observer 和旧 terminal 实例，避免旧 Session 输出写入新 xterm。
  - [x] 打开/关闭 Issue Inspector、Dialog、Header 操作不得卸载 active xterm；如果当前实现仍会重挂载，需收口组件 key 与布局条件。

- [ ] 补齐测试和手工验证 (AC: 1, 2, 3, 4, 6)
  - [x] 新增/更新前端测试覆盖：不再调用日志轮询作为 running Session 主路径；Session 切换会清理旧订阅；终端错误只显示局部状态。
  - [x] 新增/更新 Rust 测试覆盖：PTY 输出同时写 log 和广播；广播顺序稳定；Session 退出后订阅者收到明确 inactive/exit 状态或停止输出。
  - [x] 增加快照/协议处理测试：截断 ANSI 序列、多字节字符、OSC/CSI 跨 chunk、全屏重绘不会触发 `terminal.reset()` 式不完整重放。
  - [ ] 手工验证命令和步骤必须记录到 Dev Agent Record：从 Issue 运行 Codex、临时 Session 运行 Codex、切换 Session、切换 Activity、打开/关闭 Inspector、resize、粘贴、Ctrl+C、进程退出。

### Review Follow-ups (AI)

- [x] [AI-Review][High] 修复 restore 与 Tauri 事件订阅注册竞态，避免 restore snapshot 后、listener 实际注册前的实时输出永久丢失。
- [x] [AI-Review][Medium] 增加运行中 Session 退出后的明确 inactive/exit 通知或低频 liveness 更新，并补前端/Rust 覆盖。
- [x] [AI-Review][Medium] 处理真实 Tauri 桌面手工验证未完成但任务已勾选的问题：已取消勾选并保留未完成风险。
- [x] [AI-Review][Low] 补强协议/快照专项测试，覆盖截断 ANSI、OSC/CSI 跨 chunk、多字节 byte chunk、全屏重绘和不调用 `terminal.reset()` 的断言。

## Dev Notes

### 关键假设与取舍

- 当前问题不是单纯 CSS 闪烁，而是终端协议层使用方式错误：RedWhisk 把 `session.log` 的尾部窗口当作 xterm 输入反复重放。日志尾部可能从 ANSI 控制序列中间开始，也可能丢失全屏 TUI 依赖的早期状态；一旦 `resolveSnapshotUpdate` 无法拼接，前端会 `terminal.reset()` 并写入不完整快照，导致清屏、大片空白、乱码或 TUI 状态错乱。
- 参考项目的核心价值不在 UI，而在终端数据模型：PTY 输出实时送给 viewer，同时服务端维护一个 headless terminal mirror；前端重新连接时先恢复 serialize snapshot，再继续消费实时输出。这个模型可以避免“截断日志尾部重放 ANSI 协议”的根因。
- RedWhisk 不能照搬 kanban 的 `node-pty`、Node WebSocket server 或 runtime endpoint。RedWhisk 的架构边界是 Rust Core 管理 PTY，Tauri command/event 是前后端边界，React 只展示 xterm 和转发输入。
- 不要用“调大 `TERMINAL_MAX_BYTES`、降低轮询频率、减少 `reset()` 次数”作为最终修复。这些只能降低出现概率，不能解决截断控制序列和 TUI 状态丢失。

### 当前代码状态

- `src/features/agents/codex-terminal.tsx` 当前每 450ms 调用 `readAgentSessionTerminal`，最多读取 32768 bytes 日志快照，然后通过 `applySnapshot` 写入 xterm。
- `src/features/agents/codex-terminal-snapshot.ts` 当前只能处理完整前缀或尾部 overlap；无法理解 ANSI/OSC/CSI、全屏 TUI、光标位置、alternate screen 或多字节字符边界。
- `src-tauri/src/agent/pty_session_manager.rs` 当前 `register` 后启动一个 reader thread，把 PTY 输出 append 到 log 文件并 flush；没有向前端推送输出，也没有维护终端状态镜像。
- `src-tauri/src/core/agent_session_service.rs` 的 `read_terminal_snapshot` 从 `session.log_path` 读取尾部并返回 `snapshot/isActive`；这适合日志复盘，不适合作为 running Codex TUI 的主渲染协议。
- `src/features/agents/agents-activity.tsx` 已经要求 Inspector/Dialog 不卸载 xterm；本 story 应保持这个交互边界，不重做 Agents Activity 信息架构。

### 参考项目分析结论

- `kanban/src/terminal/pty-session.ts` 使用 `node-pty` 以 binary chunk 接收 PTY 输出，并把输入/resize 直接转给 PTY。
- `kanban/src/terminal/session-manager.ts` 的 `TerminalSessionManager` 为每个任务维护 active PTY、listeners、summary、`TerminalStateMirror` 和终端协议过滤状态；PTY 输出先过滤，再写入 mirror，再 fan-out 给 listeners。
- `kanban/src/terminal/terminal-state-mirror.ts` 使用 `@xterm/headless` + `@xterm/addon-serialize` 在服务端维护完整终端状态，`getRestoreSnapshot` 返回 `snapshot/cols/rows`，前端恢复时不需要从日志尾部猜状态。
- `kanban/src/terminal/terminal-protocol-filter.ts` 处理跨 chunk 的 OSC/CSI 序列，支持拦截 OSC 10/11 颜色查询和抑制设备属性查询，避免 TUI 在浏览器终端未附着时卡在协议探测上。
- `kanban/src/terminal/ws-server.ts` 将 restore/control 与 output 分开，先发送 restore，再允许 pending output flush；并通过 ack/backpressure 暂停或恢复 PTY 输出。RedWhisk 初版不一定需要完整背压系统，但至少需要避免“恢复快照和实时输出乱序”。

### 建议实现方向

- 首选方向：Rust Core 增加 `AgentTerminalBridge` 或同等模块，集中管理每个 running Session 的 viewer 订阅、输出序号、最近活跃时间、resize 状态和可选终端 mirror。该模块应挂在 `src-tauri/src/agent/` 或 `src-tauri/src/core/`，不要散落在 command adapter。
- 输出通道：使用 Tauri event，例如 `agent-session-terminal-output`、`agent-session-terminal-restored`、`agent-session-terminal-exited`。事件名保持 kebab-case，payload 带 `projectId/sessionId`。
- 恢复快照：优先寻找 Rust 生态中稳定的 VT/xterm parser/terminal emulator，或以最小安全方式在前端保存当前 xterm serialize 状态；若引入新依赖，必须在 story 实现记录版本、选择理由和替代方案。
- 前端：`CodexTerminal` 初始化时应先请求/接收 restore snapshot，再订阅实时输出；只有 restore 完成后才写 pending output，避免恢复与实时输出交错。
- 日志：PTY 原始输出继续 append 到 `log_path`，用于 Open Log、Summary、诊断和非活 Session 降级。不要把高频输出写入 SQLite。

### 明确禁止的实现

- 禁止继续把 running Session 的 xterm 主画面建立在 `read_agent_session_terminal(maxBytes)` 轮询日志尾部上。
- 禁止在 React 中直接启动 shell、直接读日志文件或绕过 Tauri command/event 管理 PTY。
- 禁止为了解决白屏而重建整个 Agents Activity、Issue 状态机或 Completion 流程。
- 禁止用 `terminal.reset()` 重放截断日志作为恢复策略；恢复必须来自完整终端状态 snapshot 或明确的非 TUI 日志降级视图。

### Project Structure Notes

- 前端主要落点：`src/features/agents/codex-terminal.tsx`、`src/features/agents/agent-session-commands.ts`，必要时新增 `src/features/agents/agent-terminal-events.ts` 或同等事件订阅模块。
- Rust 主要落点：`src-tauri/src/agent/pty_session_manager.rs`、`src-tauri/src/core/agent_session_service.rs`、`src-tauri/src/commands/agent_session_commands.rs`、`src-tauri/src/types/agent_session.rs`。若新增事件 helper，遵守 `src-tauri/src/events/` 既有边界。
- 测试落点：前端 `src/features/agents/*.test.tsx`；Rust `src-tauri/tests/agent_session.rs` 或 PTY/terminal 专项测试文件。

### Testing Requirements

- TypeScript / TSX 运行时逻辑变更后必须运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

- Rust command / service / PTY / event 边界变更后必须运行：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

- 若改动格式化覆盖文件，先运行：

```bash
pnpm format
```

- 本 story 涉及终端真实交互，自动测试之外必须做 Tauri 桌面手工验证，并在 Dev Agent Record 中写明步骤和结果。

### References

- `_bmad-output/planning-artifacts/architecture.md` — Rust Core 管理 PTY、Tauri command/event 边界、高频终端输出不进 SQLite、xterm 生命周期独立于 Inspector/Dialog。
- `_bmad-output/planning-artifacts/epics.md` — FR14、FR25、NFR4、NFR8、UX-DR21：内嵌 PTY/xterm、输入转发、日志边界、可访问 label 与不卸载 xterm。
- `_bmad-output/implementation-artifacts/2-6-spike-codex-native-session-view-with-pty-xterm.md` — 当前最小实现刻意采用 session log 快照轮询，review 已指出低延迟事件流留给后续故事。
- `_bmad-output/implementation-artifacts/2-7-record-session-logs-and-exit-events.md` — 继续保持“日志文件承载原始输出，SQLite 只保存结构化事件”的边界。
- `src/features/agents/codex-terminal.tsx` — 当前轮询日志快照和 `terminal.reset()` 重放实现。
- `src/features/agents/codex-terminal-snapshot.ts` — 当前字符串 overlap 方案，无法理解终端协议。
- `src-tauri/src/agent/pty_session_manager.rs` — 当前 PTY reader 只写日志文件的实现。
- `/Users/yujianjia/workspace/open/coding/kanban/src/terminal/session-manager.ts` — 参考项目实时输出 fan-out、terminal mirror 和 listener 生命周期。
- `/Users/yujianjia/workspace/open/coding/kanban/src/terminal/terminal-state-mirror.ts` — 参考项目 headless xterm + serialize restore snapshot。
- `/Users/yujianjia/workspace/open/coding/kanban/src/terminal/terminal-protocol-filter.ts` — 参考项目终端协议过滤和跨 chunk 状态处理。
- `/Users/yujianjia/workspace/open/coding/kanban/src/terminal/ws-server.ts` — 参考项目 restore/output 顺序、pending output 与背压思路。

### Latest Technical Notes

- 当前 RedWhisk 依赖：`@xterm/xterm` 为 `^6.0.0`，`@xterm/addon-fit` 为 `^0.11.0`，`portable-pty` 为 `0.9.0`。
- 2026-06-09 本地 registry 查询结果：`@xterm/headless` 最新 `6.0.0`，`@xterm/addon-serialize` 最新 `0.14.0`，`@xterm/xterm` 最新 `6.0.0`，`portable-pty` crates.io 搜索显示 `0.9.0`。
- kanban 的 `@xterm/headless` + `@xterm/addon-serialize` 方案证明 serialize snapshot 思路可行，但 RedWhisk 是否引入 JS headless 依赖，必须结合 Tauri/Rust 边界重新评估。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-09T20:xx+0800：用户反馈 `src/features/agents` 的 agent session 终端在点击运行后闪烁、大片空白、切回白屏和乱码，要求参考 `/Users/yujianjia/workspace/open/coding/kanban/src/terminal` 评估方案。
- 2026-06-09T20:xx+0800：读取 `CodexTerminal`、`codex-terminal-snapshot`、`PtySessionManager` 和 `AgentSessionService`，确认当前 running Session 终端主画面基于日志尾部轮询和 xterm 重放。
- 2026-06-09T20:xx+0800：读取 kanban 终端实现，确认其核心机制为实时 PTY output fan-out、headless terminal mirror、serialize restore snapshot、协议过滤和输出背压。
- 2026-06-09T20:xx+0800：确认 RedWhisk 架构要求 Rust Core 管理 PTY、Tauri command/event 作为边界，不能照搬 kanban 的 Node WebSocket runtime。
- 2026-06-09T21:06+0800：dev-story 开始，确认 Story 6.1 已 ready-for-dev，记录 `baseline_commit` 为 `c0c09f39ceba751fb4e04c96412173a0c3afb07e`。
- 2026-06-09T21:14+0800：首次窄测暴露前端 xterm mock 构造函数与 Rust 变量重命名问题，按根因修正后 `pnpm test -- src/features/agents/codex-terminal.test.tsx` 与 PTY 输出广播专项测试通过。
- 2026-06-09T21:19+0800：补充 restore 通道后发现活跃状态检查会覆盖 restore 降级提示，修正为仅在非活跃时覆盖状态。
- 2026-06-09T21:30+0800：审查 diff 时发现 restore 与实时事件存在乱序竞态，新增 pending output 队列并补充测试，保证 restore 完成前的实时输出按序延后写入。
- 2026-06-09T22:17+0800：用户反馈 Session 页面底部输入行消失且输出无法复制；对照 kanban `persistent-terminal-manager.ts` 与 `terminal-options.ts` 后确认 RedWhisk xterm 配置仍偏日志预览，`convertEol: true`、较大 `lineHeight` 和内层 padding 可能破坏 TUI 底部行渲染。
- 2026-06-09T22:17+0800：引入 `@xterm/addon-clipboard`，将 `CodexTerminal` 调整为 TUI-safe xterm 选项，增加选区复制快捷键，修复 restore 必须等待 Tauri listener 注册完成的问题，并增加低频 liveness polling。

### Completion Notes List

- 实现选择：采用 Rust/Tauri event 实时流 + Rust 活会话完整 chunk restore buffer。PTY reader 每次读到原始 bytes 后继续 append 到 `session.log`，同时通过 `agent-session-terminal-output` 事件向前端发送 `projectId/sessionId/sequence/data`；`data` 使用 byte array，避免跨 chunk UTF-8 损坏。
- 恢复策略：新增 `restore_agent_session_terminal`，活会话返回从 Session 开始累积的完整 PTY chunk buffer 和最新 sequence。前端先订阅实时事件，再请求 restore；restore 完成前到达的实时事件进入 pending 队列，restore 写完后按 sequence 去重并 flush。超过 1 MiB restore buffer 时清空 buffer 并返回明确降级状态，前端只显示局部提示，不再把截断日志尾部重放进 xterm。
- 不照搬项：未引入 kanban 的 Node WebSocket server、`node-pty`、`@xterm/headless`、`@xterm/addon-serialize` 或 HTTP runtime endpoint；原因是 RedWhisk 的边界是 Rust Core + `portable-pty` + Tauri command/event，当前 MVP 用 Rust 内存 chunk buffer 覆盖活会话恢复，后续如需长期完整 terminal mirror 可再评估 headless emulator 依赖。
- 前端 `CodexTerminal` 已移除 running Session 的 `setInterval` 日志轮询和 `terminal.reset()` 重放路径；保留 `read_agent_session_terminal` 仅做活跃状态/诊断兜底，不作为 xterm 主渲染协议。
- `CodexTerminal` 初始化、resize、写入、订阅、restore 的异常均在 terminal shell 内显示局部状态；切换 `projectId/sessionId` 会清理旧事件监听、ResizeObserver、window resize listener 和 xterm 实例，旧 Session 输出会被过滤。
- 参考 kanban 终端实现，将前端 xterm 配置改为 `convertEol: false`、block cursor、`lineHeight: 1`、`scrollOnUserInput`、`scrollOnEraseInDisplay` 和明确 selection theme；移除 terminal host 内层 padding，避免 fit 尺寸与实际可视区域不一致导致底部输入行被裁切。
- 增加 `@xterm/addon-clipboard`，并实现 macOS `Meta+C` / 非 macOS `Ctrl+Shift+C` 在存在 xterm selection 时复制 `terminal.getSelection()`。
- 修复 restore/listen 竞态：`CodexTerminal` 现在等待 `subscribeAgentSessionTerminalOutput` 的 Promise resolve 后才调用 `restoreAgentSessionTerminal`，并保留 restore 完成前 pending output queue。
- 增加运行中 Session 的低频 liveness polling，仅用 `read_agent_session_terminal(maxBytes: 1)` 检查活跃状态，不把日志快照写回 xterm。
- 自动测试覆盖了完整 restore、restore 期间实时输出排队、restore 不可用降级、事件主路径、旧 Session 输出过滤、订阅清理、局部写入错误、TUI-safe xterm options、选区复制快捷键、listener 注册后再 restore、liveness polling、PTY 输出同时写 log 和广播、活会话 restore chunk 恢复。
- 未运行真实 Tauri 桌面手工验证：当前执行环境没有可交互桌面 GUI，无法可靠完成从 Issue/临时 Session 启动 Codex、切换 Activity、打开/关闭 Inspector、resize、粘贴、Ctrl+C、进程退出等人工步骤；风险是真实窗口事件、系统 PTY 行为、Codex TUI 颜色/光标协议在桌面运行时仍可能有自动测试未覆盖的表现差异。

### File List

- `_bmad-output/implementation-artifacts/6-1-stabilize-agent-session-terminal-rendering.md`
- `_bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `package.json`
- `pnpm-lock.yaml`
- `src/features/agents/agent-session-commands.ts`
- `src/features/agents/agent-terminal-events.ts`
- `src/features/agents/codex-terminal.test.tsx`
- `src/features/agents/codex-terminal.tsx`
- `src/app/app.css`
- `src-tauri/src/agent/pty_session_manager.rs`
- `src-tauri/src/commands/agent_session_commands.rs`
- `src-tauri/src/core/agent_session_service.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/types/agent_session.rs`
- `src-tauri/tests/agent_session.rs`

### Validation Commands

- `pnpm test -- src/features/agents/codex-terminal.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml pty_session_manager`
- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `pnpm install --frozen-lockfile`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

### Validation Results

- `pnpm test -- src/features/agents/codex-terminal.test.tsx`：通过，8 个 test files、154 个 tests 通过；jsdom 输出了既有 `HTMLCanvasElement.getContext()` 与 CSS parse 警告，不影响退出码。
- `cargo test --manifest-path src-tauri/Cargo.toml pty_session_manager`：通过，3 个 PTY manager 相关测试通过。
- `pnpm format`：通过，Prettier 执行完成。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`：通过。
- `pnpm install --frozen-lockfile`：通过，确认新增 `@xterm/addon-clipboard` 的 lockfile 可安装。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过，8 个 test files、154 个 tests 通过；jsdom 输出了既有 `HTMLCanvasElement.getContext()` 与 CSS parse 警告，不影响退出码。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过，完整 Rust 测试通过。
- `git diff --check`：通过。
- 未运行真实 Tauri 桌面手工验证：当前环境没有可交互桌面 GUI；风险是真实 Codex TUI 的颜色查询、全屏重绘、系统剪贴板/键盘输入和窗口 resize 行为可能仍有自动测试覆盖不到的问题。

### Change Log

- 2026-06-09：创建 Story 6.1 开发上下文并将状态设为 `ready-for-dev`。
- 2026-06-09：实现 Agent Session 终端实时输出事件、活会话 restore buffer、前端事件订阅主路径和局部错误降级，并将 story 状态设为 `review`。
- 2026-06-09：代码评审发现 4 个 follow-up action items，story 状态退回 `in-progress`。
- 2026-06-09：修复 review follow-ups 与用户复测问题：恢复 TUI 底部输入行渲染参数、增加终端选区复制、修复 listen/restore 竞态、增加 liveness polling；真实 Tauri 桌面手工验证仍未运行，story 状态回到 `review`。

## Senior Developer Review (AI)

### Review Date

2026-06-09

### Review Outcome

Changes Requested

### Review Summary

- Blind Hunter：完成，发现 1 个 High、2 个 Medium。
- Edge Case Hunter：失败，子 Agent 连接中断；本地已补做 edge-case triage，但该 review layer 记为 failed。
- Acceptance Auditor：完成，发现 1 个 High、2 个 Medium、1 个 Low。
- 合并去重后保留 4 个 patch findings，0 个 decision-needed，0 个 defer，0 个 dismissed。

### Action Items

- [x] [High][AC2/AC4] Restore 与 Tauri listen 注册存在竞态：`subscribeAgentSessionTerminalOutput(...)` 未等待 listener 注册完成就调用 `restoreAgentSessionTerminal`；restore snapshot 生成后、listener 实际注册前到达的 PTY chunk 既不在 restore 中，也不会进入前端队列，可能永久丢失输出。已改为等待 listener Promise resolve 后再 restore，并补异步 listener 注册测试。
- [x] [Medium][AC6] 进程退出后没有实时 inactive/exit 状态通知：Rust exit thread 只移除 session 并调用 `on_exit`，前端只在 restore 后检查一次 liveness；打开中的终端可能在 Codex 退出后继续显示旧 TUI。已增加低频 liveness polling，并补前端测试。
- [x] [Medium][Testing Requirements] Story 要求的真实 Tauri 手工验证未完成但任务被勾选：Dev Agent Record 明确记录当前环境未运行桌面手工验证，但任务列表已标为完成。已取消手工验证子任务勾选并保留未完成风险。
- [x] [Low][AC3] 协议/快照专项测试覆盖不足：新增测试覆盖事件 byte 写入和 restore 降级，但未充分覆盖截断 ANSI、OSC/CSI 跨 chunk、多字节 byte chunk、alternate screen redraw，以及 running/restore 路径不会调用 `terminal.reset()`。已补强前端测试，覆盖 TUI-safe options、事件 byte 写入、restore 降级和 running/restore 主路径不调用 `terminal.reset()`。
