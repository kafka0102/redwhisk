# 0047. Grok 结构化（json）接入：`grok agent stdio` 与 TUI 共用同一会话存储

## 状态

采纳（已执行）。

## 背景

RedWhisk 一直是把 Grok 当 **TUI-only** provider：`provider_factory::plan_provider_start` 对
`AgentType::Grok` 直接返回「暂不支持启动 Grok 类型的 Agent 会话」，前端
`getDisplayModeDefaults("grok")` 返回 `{ defaultMode: "tui", canSwitch: false }`，
`displayModeTuiLocked` 文案在设置表单里以只读输入框呈现。结果是 Grok 会话拿不到与
Codex / Claude / OpenCode 同档的消息流渲染、turn 状态、用量统计与崩溃后结构化续接。

调研（[grok-build-structured-mode-feasibility.md](../survey/grok-build-structured-mode-feasibility.md)、
[grok-build-acp-protocol-notes.md](../survey/grok-build-acp-protocol-notes.md)、
[grok-build-cli-probe-notes.md](../survey/grok-build-cli-probe-notes.md)）确认 `grok 1.0.41`
提供对标 `codex app-server` 的通道：`grok agent stdio` 是 **ACP（Agent Client Protocol）**
的 JSON-RPC 2.0 over stdio，长驻进程，支持 `initialize` → `session/new` / `session/load` →
`session/prompt`（每轮）→ `session/cancel`，并以 `session/update` 通知输出
`agent_message_chunk` / `agent_thought_chunk` / `tool_call(_update)` 等增量事件。

关键约束（运行时实测）：

- `--always-approve` / `-m` 是 `grok agent` 层参数，**必须**写在 `stdio` 子命令之前。
- `session/new` 的 `cwd` 必须规范化（canonical）：Grok 会话落盘在
  `~/.grok/sessions/<urlencoded-cwd>/<session-id>`，CLI/TUI 用进程物理 cwd 查 key；
  符号链接字面路径（macOS `/tmp` vs `/private/tmp`）会让 Grok Build TUI 看不到会话。
- 进程一轮结束后不退出，客户端必须显式关闭 stdin / kill。

## 决定

1. **Grok 从 TUI-only 放开为 json / tui 双格式**。json 走 `grok agent stdio`（ACP，长驻
   进程 + JSON-RPC 双工）；tui 路径语义完全不变，仍走交互式 PTY + `PtySessionManager`。
   新增 adapter `src-tauri/src/agent/grok_streaming/`（transport / event_mapper /
   tool_detail / usage / argv / session），形态对齐 `codex_app_server` 与
   `opencode_streaming` 的分层。
2. **每个结构化 Grok 会话一个长驻子进程**（不是每轮一个），握手在 handle `start` 内完成：
   `initialize` → `session/new`（新建）或 `session/load`（续接，失败回退新建）。
3. **结构化启动命令**由 adapter 重建为 `<program> agent [--always-approve] [-m <model>] stdio`；
   `--always-approve` 仅在 `profile.dangerous` 或 `mode_id == "full-access"` 时注入，且必须在
   `stdio` 之前。命令快照（`build_grok_structured_command_snapshot`）只确保含 `agent ... stdio`
   基命令，参数由 adapter 按 profile 现算（沿用 OpenCode 既有做法）。
4. **session id 回填走 `ThreadStarted` 事件**：`session/new` / `session/load` 返回的
   `sessionId` 立即以 `ThreadStarted` 回流，既有 broadcaster 写 `provider_session_id`
   （`ThreadIdBackfill::DeferToStream`，新建；resume 为 `WhenPresent`）。adapter 不直接写库。
5. **cwd 规范化**：`session/new` / `session/load` 的 `cwd` 一律用 `fs::canonicalize` 后的物理路径，
   保证 Grok Build TUI（`grok -r <id>` / `grok -c`）在项目目录下能看到并续接同一会话。
6. **事件归一**：`agent_message_chunk` → 累积后按稳定 `messageId` upsert 的 `AssistantMessage`；
   `agent_thought_chunk` → 累积 `Reasoning`；`tool_call(_update)` → `ToolCall`
   （Pending → running → completed/failed）；`turn_completed` / `response_completed` /
   `session/prompt` 结果的 usage → `UsageUpdated` / `TurnCompleted.usage`；`stopReason` →
   `TurnCompleted.stop_reason`。无对应位的通知（`available_commands_update` 重复推送、MCP /
   setup 进度、`tool_call_delta_chunk`、`pending_interaction` 等）既不新增事件类型，也不误发为
   turn 事件；解析对未知字段宽容，对重复通知幂等。（工具参数增量的处理见文末
   「工具参数增量裁决」。）
7. **用量口径不新增字段**：把 Grok 的整会话累计 `_meta.usage` 收成既有
   `session_token_input` / `session_token_output` / `session_token_cache` 三项，
   合并策略 `Overwrite`（与 Codex 线程累计一致）；执行时长沿用 ADR-0043 的 json 口径（活跃时长心跳）。
8. **展示形式解锁**：`getDisplayModeDefaults("grok")` 由 `{ tui, canSwitch: false }` 改为
   `{ json, canSwitch: true }`；切换 agentType 时不再强制回退 `tui`。存量 profile 不迁移
   （session 快照仍是唯一事实源）。清理所有 locale 的 `displayModeTuiLocked` 锁定文案与只读分支。
9. **明确的本期边界**：不做可回复审批卡（不注入 `--always-approve` 时不回复权限反向请求）、
   不做会话内模型 / reasoning effort 切换（能力位保持关闭）、不落库 `apiDurationMs` / 首 token
   延迟、不读 `~/.grok/sessions` 做归档或补数、不做其它 `agent serve` / `leader` / `headless` 拓扑。
10. **子进程 spawn 复用既有交互式 PATH**：抽出 `src-tauri/src/agent/provider_spawn.rs` 作为
    opencode / grok 共用的 spawn 命令构造，交互式 PATH 探测仍唯一来自 `command_detector`
    （见 agent-development-rules「交互式 PATH 三条不变量」），不新增第二套 PATH 逻辑。

## 后果

- Grok json 会话获得与其它 provider 同档的消息流渲染、turn 收敛、用量统计与结构化续接；
  Grok TUI 路径行为不变（回归护栏 `features/agent_session/tui_start_tests/grok.rs` 继续通过）。
- json 会话与 Grok Build TUI 共用 `~/.grok/sessions` 存储：RedWhisk 侧用 `session/load` 续接，
  TUI 侧用 `grok -r <session-id>` / `grok -c` 续接同一会话，不会分裂成两套。
- `provider_factory` 对 Grok 的硬拒绝被移除；`plan_still_rejects_grok` 测试改为正向路由断言。
- 结构化 Grok 会话启动会在 handle `start` 内同步完成 `initialize` + `session/new`；真实 grok 的
  MCP 冷启动可能带来数秒级首 token 延迟，属已知现象。
- 未知 / 私有通知一律忽略，上游闭源二进制的小版本字段漂移不会直接崩溃；代价是这些事件
  （hook / subagent / plan / MCP 状态）本期不进入 UI。
- `provider_spawn.rs` 成为 opencode 与 grok 共用的 spawn 构造；`opencode_streaming/transport.rs`
  改为调用它，行为不变。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 继续 TUI-only，只做 ANSI 启发 | 拿不到结构化 turn / 用量 / 工具生命周期，且与其它 provider 能力长期分叉 |
| 用 `grok -p --output-format streaming-json` | 事件集与 ACP 不等价（headless 投影），且没有任何耗时字段 |
| 每轮起一个子进程 + `--resume` | `agent stdio` 本身即长驻、支持同进程多轮 `session/prompt`，每轮重启会丢失 MCP 会话与额外开销 |
| 结构化参数写进命令快照（`-m` / `--always-approve`） | 快照是跨重启的事实源，模型 / 权限策略变化时无法重建；沿用 OpenCode「快照只存基命令、参数 adapter 现算」 |
| 用字面 cwd 建会话 | Grok 会话落盘 key 取物理路径，符号链接路径会让 TUI 看不到会话（本次硬验收点） |
| 本期实装可回复审批卡 | ACP `session/request_permission` 的 wire 细节尚未补测，先按危险 / full-access 自动放行收口 |

## 补充：工具参数增量裁决（2026-09-28）

**问题**：既然首个 `tool_call` 事件已带完整 `rawInput`，`tool_call_delta_chunk`
（工具参数增量）是否还有信息增量？是否需要按增量累积？

**证据**（[grok-build-cli-probe-notes.md](../survey/grok-build-cli-probe-notes.md) §3.5，
`grok 1.0.41` 实测）：

- 首个 `tool_call` 事件即携带完整 `rawInput`（`{"target_file":"/tmp/grok-probe/hello.txt"}`），
  无需增量即可拿到完整入参。
- 随后 `tool_call_delta_chunk`（走 `_x.ai/session_notification`，**不是** `session/update`）
  实测 `arguments_delta` 为**空串**，`tool_index` / `name` 与首事件重复，没有新信息。
- 完成帧 `tool_call_update`（`status:"completed"`）只带 `content` / `rawOutput`，
  **不再携带** `rawInput` / `locations`。

**决定**：`tool_call_delta_chunk` **保持忽略、不做增量累积**；只按 `toolCallId`
累积完整入参（对多次 `rawInput` 做浅合并，避免后续只带 `variant` 子集的帧丢字段）
与 `locations`，供完成帧复用以保证详情自洽
（见 `event_mapper.rs` 的 `ToolCallState`）。若未来实测出现「增量先到、完整参数缺失」
的真实场景，再按 TDD 改为累积（完成时以 `rawInput` / `rawOutput` 覆盖）。

**理由**：当前样本下增量为空、完整参数已在首帧到达，累积是无信息的额外状态；
忽略它同时把「完成帧缺 `rawInput` / `locations`」的退化由前端合并前移到 adapter。

## 代码事实来源

- adapter：`src-tauri/src/agent/grok_streaming/{mod,argv,transport,event_mapper,tool_detail,usage,session}.rs`
- 共用 spawn：`src-tauri/src/agent/provider_spawn.rs`、`src-tauri/src/agent/command_detector.rs`
- provider 注册：`src-tauri/src/agent/provider_factory.rs`、`provider_descriptor_grok.rs`、
  `provider_descriptor_command.rs`
- 事件契约：`src-tauri/src/types/agent_session_stream.rs`、`src-tauri/src/agent/agent_event_broadcaster.rs`
- 前端展示形式：`src/features/settings/agent-display-mode.ts`、`agent-profile-form.tsx`
- 回归护栏：`src-tauri/src/features/agent_session/tui_start_tests/grok.rs`
- 上游证据：[grok-build-structured-mode-feasibility.md](../survey/grok-build-structured-mode-feasibility.md)、
  [grok-build-acp-protocol-notes.md](../survey/grok-build-acp-protocol-notes.md)、
  [grok-build-cli-probe-notes.md](../survey/grok-build-cli-probe-notes.md)
- 相关 ADR：[0011](./0011-agent-session-provider-factory.md)、[0022](./0022-display-mode-runtime-transport.md)、
  [0039](./0039-session-token-usage-snapshot.md)、[0043](./0043-session-duration-active-time.md)
