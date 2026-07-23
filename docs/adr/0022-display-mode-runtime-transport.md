# 0022. displayMode 驱动运行时传输（json=structured / tui=PTY）

**状态**：采纳（已执行）

## 背景

ADR-0020 已为 Agent profile 引入 `displayMode`（`json`/`tui`），但仅作数据记录与表单展示，启动路径仍一律走结构化 provider（Codex app-server / Claude stream-json）。用户需要在 Codex / Claude Code 上体验原生交互式 TUI，同时保留现有 JSON 消息流能力。

## 决定

1. **运行时分流**：启动 Agent Session 时读取 profile 的 `displayMode`：
   - `json` → 结构化路径（`AgentSessionHandle` + `AgentStreamEvent` + 消息流/composer）
   - `tui` → 交互式 PTY 路径（`PtySessionManager` + xterm `TerminalSurface`）
2. **Session 展示形式快照**：将 `displayMode` 持久化到 `agent_sessions`；会话存续期 UI、恢复与重启语义只认快照，不回读 profile。
3. **范围**：codex/claude/opencode 可以 json 与 tui 启动；grok 仍不可启动。TUI 产品能力以**进程生命周期**为准（exit → closed/crashed；应用重启无活跃 PTY → stopped），不实现精细 turn、权限卡、自动评论或完成工作流联动。OpenCode json 走 structured 子进程路径（`run --format json`）。
4. **命令构造分离**：`AgentProviderDescriptor` 提供 TUI 专用命令构造（交互式 CLI + mode/dangerous 参数）；不得复用 structured 的 app-server / stream-json 参数。
5. **首条 prompt**：能作 CLI 参数则注入参数；否则 PTY 就绪后写入 stdin。
6. **前端**：独立 Agent TUI 会话视图，复用 `TerminalSurface` / theme / live pipeline；不混用 Project Terminal 配置实体。
7. **状态通道演进**：本期不做 Agent Hook；纯 TTY 解析方案与 Hook 切点写入架构文档，后续扩展。

## 后果

- `displayMode` 从「表单字段」升级为运行时传输选择器。
- 架构文档中「结构化 Agent 不得使用 PTY/xterm」的表述需改为「json 快照不得使用；tui 快照必须使用」。
- 新增 agentType 或 displayMode 取值时，按 provider 协议扩展清单改 descriptor / factory / 启动分流 / UI。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 主区消息流 + 旁路只读 TUI | 不可交互，无法满足原生 TUI 体验 |
| 同一 session 结构化与 TUI 双轨 | 进程模型冲突、状态双写 |
| 运行中跟随 profile 改 displayMode | 传输层无法热切换，语义混乱 |
| 本期强 ANSI 启发维护 turn/attention | 易碎，与「进程级状态」边界冲突；Hook 更合适作后续通道 |

## 代码事实来源

- 本决策：`docs/adr/0022-display-mode-runtime-transport.md`
- 前置：`docs/adr/0020-builtin-agent-autoseed-and-display-fields.md`、`docs/adr/0011-agent-session-provider-factory.md`、`docs/adr/0015-agent-provider-descriptor.md`
- 协议与扩展清单：`docs/architecture-design/agent-provider-protocol.md`
- 术语：`CONTEXT.md`（Agent 展示形式 / Session 展示形式快照 / Agent TUI 会话视图）
