# Embedded Codex Terminal Spike

日期：2026-06-06

## 目标

验证 RedWhisk 是否能在 Tauri + Rust PTY + xterm.js 的最小闭环里承载 Codex Native Session View，并为后续 Session / review / completion 故事提供可信前置事实。

## 本次实现

- Rust 侧新增 `src-tauri/src/agent/pty_session_manager.rs`，负责：
  - 用 `portable-pty` 创建 PTY
  - 通过 login shell `-lc` 启动 Agent command
  - 持有活跃会话的 writer / resize / killer
  - 将 PTY 输出持续写入现有 `session-logs/*.log`
- `start_agent_session` 在 Tauri command 路径下切换为 PTY 启动，并在数据库事务成功后才把活会话注册到内存 session manager。
- 新增 terminal commands：
  - `read_agent_session_terminal`
  - `write_agent_session_terminal`
  - `resize_agent_session_terminal`
- 前端新增 `CodexTerminal`，在 Agents Activity 右侧直接承载 xterm.js。
  - 无额外聊天输入框
  - 用户键盘输入直接写回 PTY
  - 通过 `FitAddon` 和 resize command 同步终端尺寸
  - 通过轮询 session log 快照恢复/刷新终端可见内容

## 自动化证据

已执行：

```bash
pnpm format
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm typecheck
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
```

关键证据：

- `src-tauri/tests/agent_session.rs` 继续覆盖 Session 创建、失败回滚、一 Issue 一 Session 等回归。
- 新增 PTY manager 集成测试，覆盖：
  - PTY 启动成功
  - 输入写入 PTY
  - resize 调用可执行
  - 输出落到 session log
- `src/shared/commands/command-client.test.ts` 覆盖 terminal bridge 的 3 个新 command。
- `src/features/agents/codex-terminal.test.tsx` 覆盖 headless/jsdom 环境下的事实性降级。

## 结论

### 已验证成立

- Rust Core 可以以 PTY 方式启动 Agent command，而不是普通 stdout/stderr 子进程。
- 前端已经具备承载真实 PTY terminal 的命令边界和 xterm.js 容器。
- 输入、resize 和日志快照读取链路已经贯通。
- 打开 Agents 右侧工作区后，不需要新增聊天输入框，符合原始 UX 约束。

### 仍然存在的限制

- 本次自动化验证运行在 headless 环境；真实 Codex TUI 的颜色、复杂光标行为和完整视觉保真度没有在 GUI 自动化里直接截图验证。
- 当前终端内容刷新采用“session log 快照轮询”而不是事件流推送。
  - 对本次 Spike 足够。
  - 后续如要做更丝滑的实时体验，可再升级为事件推送。
- 应用重启后不恢复活 PTY，只保留日志快照；这符合 MVP 当前边界，恢复语义继续由后续故事处理。

## 平台判断

- macOS：当前开发环境下作为优先目标，代码路径与测试证据已建立。
- Windows / Linux：`portable-pty` 已提供跨平台实现，但本次未做本地实机验证，仍应视为兼容性风险。

## 建议给后续故事

- Story 2.7 直接复用当前 `session log` 事实来源，把退出事件和结构化 `SessionEvent` 补齐。
- Story 2.8 如果需要 prompt 注入 / resume，可继续复用当前 PTY session manager 的活会话 writer。
- 若后续需要更低延迟体验，再把 terminal 内容同步从轮询日志升级为事件流。
