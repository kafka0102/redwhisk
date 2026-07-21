# Agent Provider 协议

RedWhisk 当前正式支持 `codex` 和 `claude` 两种 Agent provider。前端只消费统一的 session command 与（json 路径下的）`AgentStreamEvent`；provider 私有协议必须在 Rust `agent/` 层归一化或在 tui 路径下以交互式 PTY 呈现。

## 统一边界

`AgentSessionHandle` 是**结构化（json）**会话运行时抽象。Core service 负责持久化 session、启动/恢复、turn 状态和审计；provider 负责子进程协议、消息发送、取消及把私有输出映射为统一事件。

交互式（tui）会话不经 `AgentSessionHandle` 消息协议，而经 `PtySessionManager` + 终端 transport 命令/事件与前端 `TerminalSurface` 对接（见 [ADR-0022](../adr/0022-display-mode-runtime-transport.md)）。

```text
# displayMode 快照 = json
Composer / session UI
  → send_agent_message / cancel_agent_turn / respond_agent_permission
  → AgentSessionHandle
  → Codex app-server 或 Claude stream-json
  → AgentStreamEventEnvelope
  → message-stream reducer / timeline

# displayMode 快照 = tui
Agent TUI 会话视图 (xterm)
  → agent session 终端 read/write/resize/restore/subscribe
  → PtySessionManager + 交互式 CLI（descriptor.build_tui_command_snapshot）
  → 进程生命周期 → session closed / crashed / stopped
```

`agent_sessions` 保存跨重启所需的业务快照（含 **Session 展示形式快照** `displayMode`）；运行中的 handle、pending permission、事件序号、PTY 进程属于内存运行时状态，不能由前端伪造或直接更新。

## json / tui 分流

启动 Agent Session 时从 profile 读取 **Agent 展示形式**（`displayMode`），写入 session 快照后分流：

| 快照 | 传输 | 命令构造 | 前端主区 | 状态语义 |
| --- | --- | --- | --- | --- |
| `json` | 结构化 provider（Codex app-server / Claude stream-json） | `build_launch_command_snapshot` 等 structured 路径 API | 消息流 + composer | turn / 权限 / timeline |
| `tui` | 交互式 PTY（`PtySessionManager`） | `build_tui_command_snapshot(raw, mode, dangerous)` | Agent TUI 会话视图（xterm） | 进程级（exit / 重启 reconcile） |

规则：

1. 会话存续期只认 **Session 展示形式快照**，不回读 profile 当前 `displayMode`。
2. TUI 命令**不得**注入 structured 专属参数（Codex 无 `app-server`；Claude 无 `stream-json` / `-p` / `--print` / `--output-format`）。
3. mode / dangerous 映射由 descriptor 按 provider 交互式 CLI 语义处理；service / command 不按 `agentType` 散落 match。
4. 本期仅 codex/claude 可真正以 tui 启动；opencode/grok 仍不可启动（descriptor 占位仅 trim）。
5. 运行中不得热切换 displayMode。

### TUI 命令映射要点（descriptor）

- **Codex TUI**：`full-access` / `full-auto` /（未知 mode 且 `dangerous`）→ `--dangerously-bypass-approvals-and-sandbox`；`auto` → `--ask-for-approval on-request --sandbox workspace-write`；`read-only` / `read_only` → `--ask-for-approval on-request --sandbox read-only`；已知 mode 优先于 `dangerous`；不重复已有 flag；trim 路径。
- **Claude TUI**：已有 `--permission-mode` 则保留；`full-access` 或 `dangerous` → `--permission-mode bypassPermissions`；`plan` / `acceptEdits` / `auto` 映射对应 permission-mode；trim 路径。
- **Stub（opencode/grok）**：仅 trim。

## Session 生命周期 seam（displayMode）

运行时传输选择集中在 `features/agent_session/lifecycle`：

| 意图 | 入口 | 真相来源 |
| --- | --- | --- |
| 启动分流 | service start* → `runtime_transport_from_raw(profile.display_mode)` 后持久化为 session 快照 | profile → session 快照 |
| inject | `lifecycle::inject_prompt(session.display_mode, …)` | **仅** session 快照 |
| timeline 观察 | `lifecycle::read_timeline_for_session` | **仅** session 快照；tui 不返回 structured timeline |
| archive | `build_issue_session_archive(..., display_mode)`（[ADR-0023](../adr/0023-tui-issue-archive-plain-text.md)） | session 快照 |
| UI 能力 | `descriptor.ui_capabilities()` → `list_agent_models.capabilities` | provider descriptor，前端不维护静态双表 |

禁止：用 `pty_sessions.contains` / registry membership **选择**传输层；membership 只表示进程是否仍在。

## Provider 差异（structured / json）

| 项目      | Codex                                                         | Claude                                                  |
| --------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| 进程协议  | `codex app-server`，stdio 上 NDJSON JSON-RPC                  | `claude -p --output-format stream-json`，NDJSON 单向流  |
| 会话模型  | 持久 app-server session，维护 `threadId` / 当前 turn          | 单轮子进程；后续消息用 `--resume <session_id>` 续接     |
| 权限      | server→client request；前端经 `respond_agent_permission` 回复 | stream-json 没有等价 request/response 审批通道          |
| 模型/模式 | 通过 provider 请求与通知同步                                  | 由 Claude provider 能力与配置决定；第三方模型列表可只读 |
| 输出      | JSON-RPC notification 映射 timeline                           | SDKMessage 流映射 timeline                              |

因此，不能把 Codex 的 JSON-RPC、权限卡片、thread 字段或 effort 假定为所有 provider 都具备。**json 快照**不得为 Claude/Codex 回退重建 xterm 渲染链路；**tui 快照**则必须使用交互式终端主区，不得混用 structured composer / 权限卡。

## 生命周期规则

1. 启动 provider（或 TUI PTY）成功后再创建可用 Agent Session，并更新关联 Issue 状态。
2. **json**：`send_agent_message` 开始 turn；`is_turn_running` 仅由 Rust 后端维护。**tui**：不以结构化 turn 事件驱动；产品状态以进程存活为准（`isTurnRunning` 不依赖易碎启发）。
3. **json**：正常结束、失败和取消都通过统一 stream event 通知前端，并更新持久化 session 事实。**tui**：进程正常退出 → `closed`；异常退出 → `crashed`；应用重启后无活跃 PTY 的 running tui session → `stopped`。
4. `crashed` / `stopped` 均不自动完成 Issue。
5. **json** timeline 历史使用 `read_agent_timeline`；不能将截断 ANSI 日志作为结构化会话恢复方式。**tui** 恢复为终端 buffer restore，不映射 structured timeline。

## 附件与安全

- Agent 附件先由 `save_agent_attachment` 落盘，后续消息仅传路径、展示名与种类。
- Issue 附件与 Agent 附件有各自 DTO；不要直接把浏览器文件对象穿透 Rust 边界。
- provider 新能力必须明确：持久化字段、事件映射、取消语义、权限语义、恢复语义及 unsupported 情形。
- TUI 路径下 mode/dangerous 须落到交互式 CLI 参数，避免与 profile 权限策略脱节。

## 纯 TTY 解析方案要点（演进，非本期生产路径）

目标：在不接入 structured JSON 的前提下，从 PTY 输出中识别粗粒度会话信号（例如 turn 起止、等待输入、错误提示），供列表 badge 或 attention 使用。

要点：

1. **输入源**：仅消费 PTY 原始字节流（或已解码的文本环缓），与 xterm 渲染同源；不得另开第二套子进程旁路。
2. **解析层级**：优先可配置的**低耦合启发式**（提示符/已知 banner/明确错误行）；避免把完整 ANSI 状态机嵌进业务 service。
3. **输出契约**：解析结果应映射为窄事件（如 `tui_signal`：`idle` / `busy` / `needs_input` / `error`），不得伪造 `AgentStreamEvent` 的 structured 语义字段。
4. **稳定性**：启发式默认关闭或仅诊断；不得作为完成工作流、自动评论或权限决策的唯一依据。
5. **与 Hook 关系**：TTY 解析是无 SDK 时的兜底；一旦 provider 提供 Hook/回调，应优先切到显式事件通道。

## Hook 预留切点（文档化，本期不实现）

后续 Agent Hook 接入时，建议落在下列切点，避免侵入 UI：

| 切点 | 说明 |
| --- | --- |
| 进程 spawn 后 / 退出前 | 注册与注销 Hook 订阅；绑定 `sessionId` |
| PTY 读写路径旁路 | 只读观测 stdout/stdin 元事件，不改写用户键入 |
| session 状态迁移 | running → closed/crashed/stopped 时触发生命周期 Hook |
| descriptor / factory | 按 agentType 声明是否支持 Hook 与能力位；启动参数可附加 Hook 相关 flag |
| 前端 | 仅消费归一化后的 attention/状态字段；不直接解析 Hook 私有 payload |

本期不实现 Hook 配置 UI、运行时推送或生产路径 ANSI 启发状态机。

## 扩展检查清单

新增 **agentType** 或 **displayMode** 取值时，按序核对：

1. **术语与 ADR**：`CONTEXT.md` 术语是否需要扩展？是否新建/更新 ADR（如传输分流）？
2. **类型与持久化**：Rust / TS 的 `AgentType`、`displayMode`、DTO、migration 默认值与列表字段是否同步？
3. **Descriptor**：`AgentProviderDescriptor` 是否实现 structured 与（若支持）`build_tui_command_snapshot`，以及 `ui_capabilities()`？是否在 `descriptor_for` 注册？`list_agent_models.capabilities` 是否同步？
4. **Factory / 启动分流**：`provider_factory` 与 `start_*_agent_session` 是否经 `lifecycle::runtime_transport_from_raw` 按 session 快照在 structured / PTY 间分流？未支持组合是否明确失败？
5. **命令与参数**：TUI 是否避免 app-server / stream-json？mode/dangerous 映射是否有单测？
6. **传输命令**：agent session 终端 read/write/resize/restore/subscribe（或等价）是否与 project terminal 对称且不混配置表？
7. **前端视图**：Agents 右侧是否按 **Session 展示形式快照** 在消息流与 Agent TUI 会话视图间切换？json 是否仍走 composer / 权限卡？
8. **主题与 I/O**：TUI 是否同步 `COLORFGBG` / xterm theme？resize 与键盘是否直达 PTY？
9. **生命周期**：exit / crash / 应用重启 reconcile 是否覆盖新路径？关闭/删除是否释放 PTY？
10. **事件与错误码**：Tauri command/event 注册表与错误码（`tauri-contract`）是否更新？
11. **测试**：descriptor 命令形态、service 分流、DTO 字段、UI 选视图、structured 回归是否覆盖？
12. **演进**：若依赖状态识别，是否仅文档化 TTY 解析 / Hook 切点，而不把易碎启发写入完成/评论主路径？

### 结构化路径修改检查清单（json）

- 更新 `AgentSessionHandle`、provider 实现、`AgentStreamEvent` 映射与前端 reducer 是否同步？
- 新增或变更 event 是否具备 `sessionId`、`projectId`、`seq`、`epoch` 语义？
- provider 失败、取消、应用重启、附件与不支持操作是否有测试？
- 是否避免将 provider 私有协议泄露到 feature UI？
