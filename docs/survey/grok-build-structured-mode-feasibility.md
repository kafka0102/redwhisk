# Grok Build 结构化接入调研与可行性（RedWhisk）

> 调研日期：2026-09-27
> 上游项目：https://github.com/xai-org/grok-build（Apache-2.0，Rust）
> 本机 CLI：`grok 1.0.41 (4220f3b224a6)`，路径 `/Users/yujianjia/.local/bin/grok`
> 目标：判定能否把 Grok 从 **TUI-only** 升级为 **Codex app-server 式结构化接入**（JSON 化渲染，不走 TUI），并核实 token 用量 / 精确耗时等统计信息可得性。
> 姊妹文档：[agent-output-format-survey.md](./agent-output-format-survey.md)（跨 Agent 清单）、[opencode-json-mode-feasibility.md](./opencode-json-mode-feasibility.md)（上一轮同构调研）
> 事实源优先级：`docs/**` > `AGENTS.md` > 代码与实测；RedWhisk 侧结论均给 `文件:行号`。

## 0. 结论

| 项 | 结论 |
| --- | --- |
| **总判定** | **GO（有条件）** —— Grok 提供对标 Codex app-server 的 **ACP（JSON-RPC 2.0 over stdio）** 通道，RedWhisk 侧 structured provider seam 已就绪 |
| 推荐主路径 | `grok agent stdio`（ACP over stdio，长驻进程 + JSON-RPC 双工），**不要**用 `-p --output-format` 系列 |
| 次选（不推荐） | `grok -p --output-format streaming-json`（单向 NDJSON，事件集不等价 ACP，且**无任何耗时字段**） |
| JSON 化渲染 | 可达成。前端 `message-stream-reducer` 与 timeline 渲染 **provider 无关**，Grok 产出合规 `AgentStreamEvent` 即可零改动切换（§6.4） |
| token 统计 | **可拿到且比 headless 更全**：本轮 + session 累计双口径（input/output/cached-read/cache-creation/reasoning/modelCalls/numTurns），可归一到 ADR-0039 现成三项（§4） |
| 精确执行时间 | Turn 级现成承接位可直接用；**更细的 API 耗时 / 端到端耗时 / 首 token 延迟均可从 ACP 事件算得**，但 TTFT 与每步耗时在 RedWhisk 侧无落库位，需扩模型（§4.3） |
| 明确缺口 | **cost / 金额**：所有结构化输出均无该字段（当前第三方端点下；未在 xAI 官方端点验证） |
| 主要风险 | 客户端状态机复杂度（长驻进程不退出、9 条 setup 进度、MCP 冷启动 5s+、`available_commands` 重复推送、工具增量走私有通知）；闭源二进制字段漂移 |
| 工作量（粗估） | 约 **2.5–4 人周**、17–26 个文件（§7.3） |

### 0.1 给后续 session 的接手指引

1. 先读 §1–§4 建立「Grok 端有什么」的事实底座，再读 §6 的 RedWhisk 改动清单。
2. §6.2 是可直接开票的最小改动清单；§6.3 给出 Grok 事件 → `AgentStreamEvent` 的映射表。
3. §8 列出尚未验证的 8 项，其中「权限请求实数方法」与「`session/load` 跨进程恢复」建议在实现前补测一次（各 1 次最小调用）。
4. 若只做最小可用版本：`grok agent stdio` + 文本/推理/工具三类事件 + token 三项 + resume，即可对标现有 OpenCode json 能力。

---

## 1. 上游与本地事实

| 项 | 值 |
| --- | --- |
| 仓库 | `xai-org/grok-build`，默认分支 `main`，Apache-2.0，主语言 Rust |
| 项目自述 | 「coding agent harness and TUI. Fullscreen, mouse interactive, extensible.」 |
| 本机版本 | `grok 1.0.41 (4220f3b224a6)`（与调研时 `main` 同代） |
| 配置 | `~/.grok/config.toml`（本机 `[ui] permission_mode = "always-approve"`，`endpoints.models_base_url` 指向第三方端点，非 xAI 官方） |
| 会话持久化 | `~/.grok/` 下 session 元数据；`grok sessions list` 可列，`grok usage <session-id>` 可分轮打印 token |

**程序化接入面总览**（`grok --help` / `grok agent --help` 实测）：

| 入口 | 形态 | 对 RedWhisk 的意义 |
| --- | --- | --- |
| `grok agent stdio` | ACP JSON-RPC 2.0 over stdio，长驻 | **对标 Codex app-server**，推荐主路径 |
| `grok agent serve` | WebSocket server（默认 `127.0.0.1:2419`，`--secret` / `GROK_AGENT_SECRET`） | 需要多客户端共享 agent 时才用；本期不做 |
| `grok agent headless` | 走 Grok WebSocket relay | 需远端中继，本期不做 |
| `grok -p --output-format json` | 一次性单 JSON 对象 | 轻量但无耗时字段 |
| `grok -p --output-format streaming-json` | NDJSON，`type` ∈ `available_commands`/`thought`/`text`/`usage`/`end` | 事件集 ≠ ACP，是 headless 投影 |
| `grok -p --output-format streaming-messages-json` | Anthropic Messages API wire format | 未实测 |
| `grok usage <session-id> [turn]` | 打印持久化分轮 token | 归档/补数兜底，非 live 主路径 |

---

## 2. 三条结构化通道对比（实测）

| 维度 | `agent stdio`（ACP） | `-p --output-format json` | `-p --output-format streaming-json` |
| --- | --- | --- | --- |
| 传输 | JSON-RPC 2.0 over stdio，双向长驻 | 一次性单对象 | NDJSON 单向，进程结束即退出 |
| 多轮 | 同一进程同一 `sessionId` 连续 `session/prompt`（实测通过） | 每轮一个进程 + `--resume <id>` | 同左 |
| 增量文本 | 有（`agent_message_chunk` / `agent_thought_chunk`） | 无（整段返回） | 有（`text` / `thought` 的 `data` 增量） |
| 工具生命周期 | 完整（Pending → InProgress → completed，含结构化 `rawOutput`） | 无 | 无 |
| 权限交互 | 有事件（`pending_interaction` / `interaction_resolved`） | 无 | 无 |
| token | 本轮 + session 累计双口径 | 本轮口径 | 本轮口径 + `end` 汇总 |
| **耗时** | ✅ `usage.apiDurationMs`、`turn_completed.elapsed_ms`、事件级 ms 时间戳 | ❌ | ❌ |
| cost | ❌ | ❌ | ❌ |
| 建议 | **接入主路径** | 仅探活/回归用 | 不采用（易被误当 ACP 等价物） |

> 关键提示：`streaming-json` 的 help 自述「one ACP session update per line, the agent's native format」，但**实测其 `type` 集合与 ACP `session/update` 结构不同**，不能互相替代（§3.5）。

---

## 3. ACP（`grok agent stdio`）协议事实

实测两次独立进程，stdout **全部为合法 JSON（0 行非 JSON）**，stderr **0 行**；按行分隔的 LSP 风格 JSON-RPC。

### 3.1 握手与一轮 prompt 时序（实测，单位秒，相对进程启动）

```text
0.009  -> initialize
0.420  <- initialize result
0.432  <- _x.ai/mcp/servers_updated (notification)
3.014  -> session/new
3.101  <- _x.ai/session/setup phase=auth ...（共 9 条 setup 进度通知）
3.341  <- session/new result
3.379  <- _x.ai/mcp/init_progress (total=3)
3.393  <- session/update available_commands_update
3.518  -> session/prompt
3.523  <- _x.ai/sessions/changed, _x.ai/queue/changed
3.569  <- _x.ai/session_notification hook_run_started(user_prompt_submit)
20.924 <- session/update agent_thought_chunk（首 token）
23.929 <- session/update agent_message_chunk ("hi")
24.094 <- _x.ai/session_notification response_completed（usage）
24.703 <- _x.ai/session_notification turn_completed（usage + elapsed_ms）
24.707 <- _x.ai/session/prompt_complete
24.711 <- session/prompt result (id=3)
```

要点：`session/new` 约 3.3s（含 9 条 setup），首 token 约 17.4s，`_x.ai/mcp_initialized` 报 `elapsedMs: 6134` —— **MCP 冷启动是首 token 延迟主因**。

### 3.2 `initialize`

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false}},"clientInfo":{"name":"redwhisk","version":"0.0.1"}}}
```

响应关键字段：`protocolVersion:1`、`agentCapabilities.loadSession:true`、`promptCapabilities.image:false`、`sessionCapabilities:{list,resume,close}`、`authMethods:[xai.api_key, grok.com]`、`_meta.agentVersion`、`_meta.modelState.currentModelId` / `availableModels`、`_meta.availableCommands[]`、`_meta.currentWorkingDirectory`。

### 3.3 `session/new`

请求：`{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"<path>","mcpServers":[]}}`

响应含 `sessionId`（UUID）、`models`、`configOptions[{id:"model", type:"select"}]`、`_meta.x.ai/sessionConfig` / `x.ai/sessionDetail`。

> `grok agent stdio` 自身**没有** `--cwd` / `--model` / `--permission-mode` 参数，工作目录与模型全部经 `session/new` 参数下发。

### 3.4 `session/prompt` 与用量双口径（接入必须注意）

请求：`{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"<id>","prompt":[{"type":"text","text":"..."}]}}`

同一 `sessionId` 上**连续多次 `session/prompt` 实测可行**（无需重建 session）。响应 `_meta` 同时含两套口径：

- `_meta.inputTokens` / `outputTokens` / `totalTokens` / `cachedReadTokens` / `reasoningTokens` / `modelId` → **本轮（turn）**
- `_meta.usage.*` → **session 累计**（第 2 轮 input 从 29971 跳到 60063，`modelCalls:2`、`numTurns:2`）
- `_meta.modelId` 是真实模型（`grok-4.7`），`modelUsage` 的 key 是 agent profile 名（`grok-4.7-build`）

### 3.5 事件通道

服务端 → 客户端的实测 method：

| method | 载体 | 实测 `sessionUpdate` / 关键字段 |
| --- | --- | --- |
| `session/update` | 标准 ACP 通知 | `available_commands_update` / `agent_thought_chunk` / `agent_message_chunk` / `session_info_update` / `tool_call` / `tool_call_update` |
| `_x.ai/session_notification` | xAI 私有通知 | `hook_run_started` / `hook_execution` / `session_summary_generated` / `response_completed` / `turn_completed` / `last_turn_summary` / `pending_interaction` / `interaction_resolved` / `tool_call_delta_chunk` |
| `_x.ai/session/setup` | 建会话进度 | `phase`（auth / resolve_workspace / folder_trust / plugin_registry / mcp_merge / persistence_init / spawn_session_actor / git_discovery / finalize_response / tool_overrides / response_ready） |
| `_x.ai/sessions/changed` | 会话列表变更 | `upserted[]`（含 `cwd` / `modelId` / `activity` / `lastChangeUnixMs`） |
| `_x.ai/queue/changed` | 提示队列 | `entries[]` / `runningPromptId` |
| `_x.ai/session/prompt_complete` | 轮次收尾 | `promptId` / `stopReason` / `agentResult` |
| `_x.ai/mcp/servers_updated` / `init_progress` / `server_status` | MCP 状态 | `mcpServers[]` / `total,connected,elapsedMs` / `status,reason,detail,tools` |

通知公共 `_meta`：`eventId`、`agentTimestampMs`、`promptId`、`streamStartMs`、`turnStartMs`、`totalTokens`、`updateType`、`chunkId` —— **毫秒级 epoch，可用于精确分段计时**。

工具调用实测生命周期（`read_file` 实例）：

```json
{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"call-...","title":"read_file","rawInput":{"target_file":"..."},"_meta":{"x.ai/tool":{"name":"read_file","kind":"read","label":"Read","read_only":true}}}}}
{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"call-...","kind":"read","title":"Read `...`","locations":[{"path":"..."}]}}}
{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"call-...","status":"completed","content":[{"type":"content","content":{"type":"text","text":"..."}}],"rawOutput":{"type":"ReadFile","FileContent":{"absolute_path":"...","raw_output":"...","total_lines":2}}}}}
```

工具参数增量走私有通道：`_x.ai/session_notification` + `sessionUpdate:"tool_call_delta_chunk"`（含 `tool_call_id` / `arguments_delta`），**不在 `session/update` 上**。

**幂等要求**：`available_commands_update` 会重复推送（实测 3 次，后出现的包含异步注册的 MCP 工具），客户端须幂等覆盖。

### 3.6 权限交互（证据为间接）

本机 `permission_mode = "always-approve"`，工具执行仍产生权限事件但**瞬间自解**：

```json
{"method":"_x.ai/session_notification","params":{"update":{"sessionUpdate":"pending_interaction","tool_call_id":"call-...","kind":"permission"}}}
{"method":"_x.ai/session_notification","params":{"update":{"sessionUpdate":"interaction_resolved","tool_call_id":"call-..."}}}
```

**未捕获** server→client 带 `id` 的权限请求（ACP 标准方法为 `session/request_permission`），也**未验证** `ask_user_question` 是否复用同一通道。要做「可回复审批」必须先补测（§8）。

### 3.7 进程生命周期

`grok agent stdio` 完成 `session/prompt` 后**保持存活**，等下一轮或新 session，**不自动退出** —— 客户端必须显式关 stdin / kill；这与「每轮子进程」的 Claude/OpenCode 模型不同，adapter 需要长驻 handle。

---

## 4. 统计信息可得性

### 4.1 结论表

| 指标 | headless json | headless streaming-json | **ACP stdio** | `grok usage` 持久化 |
| --- | --- | --- | --- | --- |
| session id | ✅ | ✅ `end.sessionId` | ✅ `session/new` + 各事件 | ✅ |
| request / prompt id | ✅ | ✅ | ✅ `requestId` / `promptId` | ➖ |
| 真实 model 名 | ⚠️ 仅 profile 名 | ⚠️ 仅 profile 名 | ✅ `_meta.modelId` | ✅ `primaryModelId` |
| input / output tokens | ✅ | ✅ | ✅ **本轮 + 累计双口径** | ✅ 分轮 + 汇总 |
| cached read / cache creation | ✅ | ✅ | ✅ `cachedReadTokens` / `cacheCreationTokens` | ✅ |
| reasoning tokens | ✅ | ✅ | ✅ | ✅ |
| model calls / 轮数 | ✅ | ✅ | ✅ `modelCalls` / `numTurns` | ✅ |
| **API 耗时**（模型调用） | ❌ | ❌ | ✅ `usage.apiDurationMs`（实测 5972 / 8184 / 6265 ms） | ❌ |
| **端到端耗时**（含工具/MCP/hook） | ❌ | ❌ | ✅ `turn_completed.elapsed_ms`（实测 21162 / 20685 / 7856 ms） | ❌ |
| 分段/事件级时间戳 | ❌ | ❌ | ✅ `agentTimestampMs` / `streamStartMs` / `turnStartMs` | ➖ |
| hook / MCP 阶段耗时 | ❌ | ❌ | ✅ `hook_execution.runs[].status.elapsed_ms`、`mcp_initialized.elapsedMs` | ➖ |
| **cost / 金额** | ❌ | ❌ | ❌ | ❌（help 自称含 cost，实际只有 token） |
| 工具调用明细 | ❌ | ❌ | ✅ tool_call / tool_call_update（含 `rawOutput`） | ➖ |

**即：token 用量三种格式都有；「精确执行时间」只有 ACP 有。**

### 4.2 可自算的延迟指标（ACP）

有了 `turnStartMs` / `streamStartMs` / `agentTimestampMs` 与 `apiDurationMs` / `elapsed_ms`，客户端可自行得到：

- **首 token 延迟（TTFT）** = 首个 `agent_thought_chunk` / `agent_message_chunk` 的 `agentTimestampMs` − `turnStartMs`（实测约 17.4s，其中 MCP 冷启动 6.1s）
- **模型 API 时长** = `usage.apiDurationMs`
- **端到端轮时长** = `turn_completed.elapsed_ms`
- **hook / MCP 分段** = 各自 `elapsed_ms`

### 4.3 RedWhisk 承接位

| 层 | 位置 | 事实 |
| --- | --- | --- |
| 跨边界类型 | `src-tauri/src/types/agent_session_stream.rs:214-237` | `AgentUsage`：`input_tokens` / `output_tokens` / `context_window_max_tokens` / `context_window_used_tokens` + 累计三项 `session_token_input` / `session_token_output` / `session_token_cache` |
| merge 策略 | `src-tauri/src/types/agent_session_stream.rs:239-249` | `SessionTokenMerge`：`Overwrite`（线程累计）/ `TurnLatest` / `TurnCommit` |
| 归一化 | `src-tauri/src/agent/session_token_usage/normalize.rs:8-70` | 已有 `normalize_codex_token_usage` / `normalize_claude_token_usage` 先例 |
| 事件→累计 | `src-tauri/src/agent/session_token_usage/persist.rs:6-19,35-72` | `session_token_usage_from_event` 从 `UsageUpdated` / `TurnCompleted` 取三项 |
| 落库 | `src-tauri/src/db/agent_session_repository.rs:45-47,442-470` + `src-tauri/migrations/0052_agent_sessions_session_token_usage.sql` | `token_input` / `token_output` / `token_cache` |
| 前端 DTO | `src/features/agents/agent-session-commands.ts:64-69` | `tokenInput` / `tokenOutput` / `tokenCache` |
| Turn 级时长 | `docs/adr/0043-session-duration-active-time.md`、`src-tauri/src/features/agent_session/active_time.rs:24-43`、`src-tauri/migrations/0039_agent_session_processing_duration.sql` | json 快照下按活跃处理时长累计，产规范的 `TurnStarted` / `TurnCompleted` 即自动生效 |
| reasoning 块时长 | `src-tauri/src/types/agent_session_stream.rs:97-102`（`duration_ms`） | 已有先例：块结束时填充 |

结论：

1. **token 三项可零模型改动接入**（新增一个 `usage.rs` 归一即可）；Grok 无 cache 字段时按现有语义记 0。
2. **Turn 级执行时间零改动**（ADR-0043 自动生效）。
3. **TTFT / 每步耗时 / cost 无现成位**，需扩 `AgentUsage` + 事件 variant + DB migration + DTO + UI，属新增能力，不是照搬。

---

## 5. 与 Codex app-server 的能力对照

| 能力 | Codex app-server（现网） | Grok `agent stdio`（ACP） | 差距 |
| --- | --- | --- | --- |
| 传输 | JSON-RPC over stdio，长驻 | JSON-RPC 2.0 over stdio，长驻 | 同构 |
| 会话建立 | `thread/start` → `threadId` | `session/new` → `sessionId` | 同构 |
| 一轮对话 | `turn/start` + 通知流 | `session/prompt` + 通知流 | 同构 |
| 恢复会话 | `thread/resume` | `loadSession:true` + `sessionCapabilities.resume`（**未实测**） | 待验证 |
| 取消 | `turn/interrupt` | `session/cancel`（仅能力声明） | 待验证 |
| 增量文本 / 推理 | 有 | `agent_message_chunk` / `agent_thought_chunk` | 同构 |
| 工具生命周期 | 有 | `tool_call` / `tool_call_update`（含 `rawOutput`） | 同构，Grok 额外有 `rawInput`/`locations` |
| 审批可回复 | `respond_permission` | `pending_interaction(kind=permission)`（**可回复性未验证**） | 关键待验证 |
| token 用量 | `thread/tokenUsage/updated` | `usage` / `turn_completed` / `response_completed` | 同构，Grok 额外给 `apiDurationMs` |
| 耗时 | 无 | `apiDurationMs` / `elapsed_ms` / 事件级 ms | **Grok 更强** |
| cost | 无 | 无 | 平 |
| 长期存活 | 是 | 是（且不自动退出） | 同构 |
| 协议来源 | 官方文档 + 闭源二进制 | ACP 标准 + xAI 私有扩展（闭源二进制） | 均为「文档/实测」级，非源码可证 |

差异需要 adapter 额外处理的部分：`_x.ai/*` 私有通知、9 条 setup 进度、MCP 冷启动与健康通知、`available_commands` 重复推送。

---

## 6. RedWhisk 落地方案

### 6.1 现状：Grok 是 TUI-only（锁定点）

| # | 位置 | 事实 |
| --- | --- | --- |
| 1 | `src-tauri/src/agent/provider_factory.rs:159-161` | `plan_provider_start` 对 `AgentType::Grok` 直接返回 `Err("暂不支持启动 Grok 类型的 Agent 会话。")` —— **唯一后端硬闸** |
| 2 | `src-tauri/src/agent/provider_factory.rs:593-596` | 单测 `plan_still_rejects_grok` 固化上述拒绝 |
| 3 | `src-tauri/src/agent/provider_factory.rs:94-105` | `ProviderStartPlan` 只有 `Codex` / `Claude` / `OpenCode` 三分支 |
| 4 | `src-tauri/src/agent/provider_descriptor_grok.rs:49-52` | `build_launch_command_snapshot` 仅 `trim()`，不注入结构化参数 |
| 5 | `src-tauri/src/agent/provider_descriptor_grok.rs:113-123` | `ui_capabilities()`：`supports_model_switching=false` / `supports_modes=false` / `supports_reasoning_effort=false` / `supports_tui_resume=true` |
| 6 | `src-tauri/src/agent/provider_descriptor_command.rs:25-26,105-116,174-186` | `GROK_ALWAYS_APPROVE_ARG` / `GROK_FALLBACK_BINARY`；TUI 快照与 `--resume` 构造 |
| 7 | `src/features/settings/agent-display-mode.ts:15-18` | `getDisplayModeDefaults("grok")` → `{ defaultMode: "tui", canSwitch: false }` —— **唯一 UI 锁定源** |
| 8 | `src/shared/i18n/locales/zh.json:157` / `en.json:157` | `displayModeTuiLocked` = 「TUI（暂未接入解析器，不可切换）」 |
| 9 | `src-tauri/src/features/agent_session/tui_start_tests/grok.rs:42-110` | TUI 启动回归护栏（断言含 `--always-approve`、不含 `stream-json` / `agent stdio`） |
| 10 | `docs/architecture-design/agent-provider-protocol.md:3,43,51` | 文档把 Grok 定为 TUI-only，需同步更新 |

> 真正的功能闸只有 2 处：`provider_factory.rs:159` + `agent-display-mode.ts:15`。其余为测试/文案/文档随动。

### 6.2 最小改动清单

**A. 新增 adapter 模块**（仿 `opencode_streaming/`，但 transport 需 ACP 双工）

| 新文件 | 职责 | 参照 |
| --- | --- | --- |
| `src-tauri/src/agent/grok_streaming/mod.rs` | 模块入口 + re-export | `src-tauri/src/agent/opencode_streaming/mod.rs` |
| `src-tauri/src/agent/grok_streaming/transport.rs` | 长驻子进程 + JSON-RPC 双工（请求 id 关联 / 通知分发） | `src-tauri/src/agent/opencode_streaming/transport.rs` + `src-tauri/src/agent/codex_app_server/client.rs:164-270` |
| `src-tauri/src/agent/grok_streaming/event_mapper.rs` | Grok 事件 → `AgentStreamEvent` | `src-tauri/src/agent/opencode_streaming/event_mapper.rs:22` |
| `src-tauri/src/agent/grok_streaming/session.rs` | `GrokSessionHandle`（实现 `AgentSessionHandle`） | `src-tauri/src/agent/opencode_streaming/session.rs:44-308` |
| `src-tauri/src/agent/grok_streaming/argv.rs` | `agent stdio` 启动参数（trim + `--always-approve` 策略） | `src-tauri/src/agent/opencode_streaming/argv.rs` |
| `src-tauri/src/agent/grok_streaming/usage.rs` | 用量归一（本轮 + 累计 → `SessionTokenUsage` 三项） | `src-tauri/src/agent/opencode_streaming/usage.rs:5-24` |
| `src-tauri/src/agent/grok_streaming/tool_detail.rs`（可选） | `rawInput` / `rawOutput` → `ToolCallDetail` | `src-tauri/src/agent/opencode_streaming/tool_detail.rs` |

**B. 后端注册与解锁**

| 位置 | 改动 |
| --- | --- |
| `src-tauri/src/agent/mod.rs`（`openCode` 注册旁） | 新增 `pub mod grok_streaming;` |
| `src-tauri/src/agent/provider_factory.rs:94-105` | `ProviderStartPlan` 增加 `Grok { backfill }`（ACP 的 `session/new` 立即可得 id → `Required` 或 `WhenPresent`） |
| `src-tauri/src/agent/provider_factory.rs:159-161` | 移除拒绝，返回 `ProviderStartPlan::Grok` |
| `src-tauri/src/agent/provider_factory.rs:76-90` | `match plan` 增加 Grok 分支 → `start_grok_session(...)` |
| `src-tauri/src/agent/provider_factory.rs:593-596` | `plan_still_rejects_grok` 改为正向路由断言 |
| `src-tauri/src/agent/provider_descriptor_grok.rs:49-52` | `build_launch_command_snapshot` 改为注入 `agent stdio`（结构化快照） |
| `src-tauri/src/agent/provider_descriptor_grok.rs:113-123` | `ui_capabilities()` 按实测调整（如 model 切换：ACP `configOptions` 支持换 model） |
| `src-tauri/src/agent/provider_descriptor_command.rs:105-186` | 新增 Grok 结构化构造；TUI 路径保持不动（避免破坏 `tui_start_tests/grok.rs`） |

**C. 前端能力门控**

| 位置 | 改动 |
| --- | --- |
| `src/features/settings/agent-display-mode.ts:15-18,26-36` | Grok 从 `{tui, canSwitch:false}` 改为 `{json, canSwitch:true}`，并调整强制回退分支 |
| `src/shared/i18n/locales/zh.json:157` / `en.json:157` | 解锁后 `displayModeTuiLocked` 不再适用于 Grok（或在文案中消除该锁定表述），所有 locale 同步补齐 |

> `agent-profile-form.tsx` 消费 `canSwitch`，改 `agent-display-mode.ts` 后自动生效；`agent-launch-eligibility.ts` 只看 `enabled`，无需改（其顶部注释可顺手校正）。

**D. 无需改动的部分（已就绪）**

| 位置 | 事实 |
| --- | --- |
| `src-tauri/src/features/agent_session/service.rs:185-206,1657-1672` | 启动/resume 按 session 快照 display_mode 分流 |
| `src-tauri/src/features/agent_session/launch.rs:40-91` | 结构化启动共享后半段（mark_starting → factory.start → thread 回填 → register → 首条 send_message → 失败回滚） |
| `src-tauri/src/features/agent_session/lifecycle/inject.rs:18-45` | json 走 registry handle，tui 走 PTY |

> 结论：descriptor + factory + adapter 三处对齐后，service / command / lifecycle **零改动**即可在 json 快照下启动 Grok（与 OpenCode 解锁时改动面一致）。

### 6.3 事件映射（Grok → `AgentStreamEvent`）

现有 variant 见 `src-tauri/src/types/agent_session_stream.rs:19-74`（TS 镜像 `src/features/agents/agent-stream-types.ts:15-50`）。

| Grok 侧（实测字段名） | 目标 variant |
| --- | --- |
| `session/new` result `sessionId` | `ThreadStarted { thread_id }` + `update_provider_session_id` |
| `session/prompt` 受理（首个 `session/update` / `_x.ai/queue/changed`） | `TurnStarted { turn_id }`（turn_id 可用 `promptId`） |
| `session/update` `agent_message_chunk` | `Timeline { AssistantMessage }` |
| `session/update` `agent_thought_chunk` | `Timeline { Reasoning }`（若有流入/流出时间戳可填 `duration_ms`） |
| `session/update` `tool_call` / `tool_call_update` | `Timeline { ToolCall }`（Pending → running；completed → completed，`rawInput`/`rawOutput` → `ToolCallDetail`） |
| `_x.ai/session_notification` `tool_call_delta_chunk` | 工具入参增量（可选：仅内部累积，不单独渲染） |
| `_x.ai/session_notification` `response_completed` / `turn_completed` 的 `usage` | `UsageUpdated` 和/或 `TurnCompleted.usage` |
| `session/prompt` result `stopReason` | `TurnCompleted { stop_reason: Some("end_turn") }` |
| 错误（握手失败、prompt error） | `TurnFailed { error, code }` |
| `session/cancel` 后收尾 | `TurnCanceled` |
| `pending_interaction` / `interaction_resolved`（`kind=permission`） | `PermissionRequested` / `PermissionResolved` —— **仅在补测确认可回复后实装**，否则沿用 OpenCode 范式直接 `Err` |
| `available_commands_update` | 无对应位：仅内部维护能力/命令表（幂等覆盖） |
| `_x.ai/session/setup` 9 条进度 | 无对应位：映射为启动态进度（或忽略），不得当成 Turn 事件 |
| `_x.ai/mcp/*` | 无对应位：可仅记录日志 / 启动进度 |

现有模型里**没有对应位**、需决策的项：

1. 可回复审批（取决于 §8 补测结果）。
2. TTFT / 每步耗时 / cost（需扩模型，见 §4.3）。
3. `ToolCallDetail::Edit` 目前仅 `{ path, diff }`（`src-tauri/src/types/agent_session_stream.rs:145-149`）；Grok `rawInput.variant=ReadFile` 这类结构需按 `ToolCallDetail` 二次分发，未知工具落 `Unknown { raw_input, raw_output }`。
4. 多模态输入：`initialize` 声明 `promptCapabilities.image=false`，本期按「仅文本路径」处理。
5. 子会话 / sub-agent：`ToolCallDetail::SubAgent { child_session_id }` 承接位存在，Grok 是否有等价概念未验证。

### 6.4 渲染链路 provider 无关（已确认）

| 位置 | 事实 |
| --- | --- |
| `src/features/agents/message-stream/message-stream-reducer.ts:1-29,90-130` | reducer 只消费 `AgentStreamEvent` / `AgentTimelineItem`，无 provider 分支 |
| `src/features/agents/session-pane/agents-session-pane.tsx:455-465` | 视图切换只按 `displayMode`，不按 `agentType` |
| `src/features/agents/composer/composer-controls.tsx:82-91` | composer 控件由 `capabilities`（`list_agent_models`）驱动 |

> 这是「像 Codex App Server 一样 JSON 化渲染」的直接依据：Grok 只要产出合规事件，前端零改动即可从 TUI 切到消息流。

---

## 7. 风险、工作量与门槛

### 7.1 风险

| 风险 | 级别 | 缓解 |
| --- | --- | --- |
| 客户端状态机复杂度：长驻进程不退出、9 条 setup、MCP 冷启动 5s+、`available_commands` 重复、工具增量走私有通知 | **高** | 按 §3 时序建模；幂等覆盖；启动态与 turn 态分离；超时与 kill 兜底 |
| 协议稳定性（闭源二进制，`_x.ai/*` 私有扩展） | 中 | 解析宽容（忽略未知字段）；fixture 固化 + 版本钉 `grok 1.0.41`；adapter 内做版本探测 |
| 审批语义未确认 | 中 | 先按 OpenCode 决策（dangerous / full-access → `--always-approve`，其它情形接受限制并文档化）；补测后再决定是否实装审批卡 |
| 会话恢复（跨进程 `session/load`）未实测 | 中 | 先做「同进程多轮」；resume 按 `WhenPresent`，失败回退新建 |
| 规范条文：`plan_still_rejects_grok` 等既有测试需同步改 | 低 | 同 PR 内改测试与文档 |
| 跨平台子进程 / PATH | 中 | 复用 `opencode_streaming` 的 spawn 工具与 `command_detector` 探测（`src-tauri/src/agent/command_detector.rs:56`） |
| `streaming-json` 被误用为 ACP 等价物 | 低 | 在 adapter 注释与文档中显式声明二者不等价（本文件 §2） |

### 7.2 门槛核对

| 门槛 | 状态 | 依据 |
| --- | --- | --- |
| 有对标 app-server 的双工通道 | **过** | `grok agent stdio` 实测 `initialize` / `session/new` / `session/prompt` |
| 事件可映射（文本 / 推理 / 工具） | **过** | `agent_message_chunk` / `agent_thought_chunk` / `tool_call(_update)` |
| session id 稳定可得 | **过** | `session/new` result 即返回 UUID |
| 多轮 | **过** | 同 sessionId 连续 `session/prompt` 实测通过 |
| token 统计 | **过** | 本轮 + 累计双口径（§4.1） |
| 精确耗时 | **过（ACP）** | `apiDurationMs` / `elapsed_ms` / 事件级 ms 时间戳 |
| 可回复审批 | **待补测** | 仅观测到自动放行的 `pending_interaction` |
| 可复现样例 | **过** | 两次独立进程 trace，stdout 全合法 JSON、stderr 空 |

→ **总判定 GO**：可进入结构化最小实现。

### 7.3 工作量（粗估 2.5–4 人周 / 17–26 文件）

| 阶段 | 内容 | 文件数 | 估时 |
| --- | --- | --- | --- |
| P0 补测收口 | 权限请求方法、`session/load`、`session/cancel` | 0 | 0.5 人日 |
| P1 adapter 骨架 | `grok_streaming/` transport + session + argv + `mod.rs` | 5–7 | 0.5–1 人周 |
| P2 事件映射 | `event_mapper.rs` + `usage.rs` + `tool_detail.rs` | 2–3 | 0.5–1 人周 |
| P3 descriptor + factory 解锁 | `provider_factory.rs` / `provider_descriptor_grok.rs` / `provider_descriptor_command.rs` | 3–4 | 0.5 人周 |
| P4 前端解锁 + 文案 | `agent-display-mode.ts` + locale ×2 | 2–3 | 0.5 人日 |
| P5 测试 | 命令快照、事件映射 fixture、factory 正向、假二进制 smoke | 3–5 | 0.5 人周 |
| P6 文档 / 契约 | `agent-provider-protocol.md`、按需 `tauri-contract.md` | 2–4 | 0.5 人日 |

### 7.4 go / no-go

- **go**：本期可交付「`grok agent stdio` adapter + descriptor/factory 解锁 + 前端 displayMode 解锁 + token 三项 + Turn 级时长」。
- **no-go 条件**（出现则退回 TUI-only）：ACP 事件信封在新版本破坏性变更且无兼容余地；无法稳定拿到 session id / 助手文本；`agent stdio` 在目标平台不可用。
- **可延后**：TTFT / 每步耗时落库、cost（当前不可得）、多模态输入、`session/load` 跨进程恢复。

---

## 8. 待补测项（实现前建议各跑 1 次最小调用）

| # | 项 | 影响 |
| --- | --- | --- |
| 1 | 关闭 `always-approve` 后，server→client 权限请求的真实方法名与字段（`session/request_permission`？）及客户端回复格式 | 决定是否实装审批卡 |
| 2 | `session/load` 跨进程恢复（新进程内用旧 sessionId） | 决定 resume 实现 |
| 3 | `session/cancel` / `session/close` 的行为与事件 | 决定取消语义 |
| 4 | `ask_user_question` 是否复用 `pending_interaction` | 决定是否支持交互式提问 |
| 5 | `--json-schema` / `streaming-messages-json` / `--include-partial-messages` | 本期不需要，仅记录 |
| 6 | cost 字段在 xAI 官方端点下是否出现 | 决定「费用展示」是否列一票 |
| 7 | `grok agent serve`（WebSocket）多客户端语义 | 本期不需要 |
| 8 | Windows 下 `agent stdio` 行为 | 跨平台支持 |

---

## 9. 证据索引

**Grok 端（实测）**

- 命令面：`grok --help` / `grok agent --help` / `grok agent stdio --help`（见 §1、§2）
- ACP trace：`/tmp/grok-probe/acp-trace.ndjson`（94 行）、`/tmp/grok-probe/acp-trace2.ndjson`（164 行）
- headless 样本：`grok -p "..." --output-format json` / `streaming-json`（见 §2、§4.1）
- 持久化：`grok usage <session-id>` 分轮 token 输出（见 §4.1）

**RedWhisk 侧**

- TUI 硬闸：`src-tauri/src/agent/provider_factory.rs:159-161`
- descriptor 注册：`src-tauri/src/agent/provider_descriptor.rs:157-163`
- Grok descriptor：`src-tauri/src/agent/provider_descriptor_grok.rs:25-124`
- Grok 命令构造：`src-tauri/src/agent/provider_descriptor_command.rs:25-26,105-116,174-186`
- 启动分流：`src-tauri/src/features/agent_session/service.rs:185-206,1657-1672`
- 事件契约：`src-tauri/src/types/agent_session_stream.rs:19-74,86-121,214-249`
- reducer：`src/features/agents/message-stream/message-stream-reducer.ts:1-29,90-130`
- 前端 displayMode 锁定：`src/features/settings/agent-display-mode.ts:15-18,26-36`
- i18n：`src/shared/i18n/locales/zh.json:154-157`、`en.json:154-157`
- 回归护栏：`src-tauri/src/features/agent_session/tui_start_tests/grok.rs:42-110`

**相关文档**

- [ADR-0011 会话 provider factory](../adr/0011-agent-session-provider-factory.md)
- [ADR-0022 displayMode 与运行时传输](../adr/0022-display-mode-runtime-transport.md)
- [ADR-0039 session token 用量快照](../adr/0039-session-token-usage-snapshot.md)
- [ADR-0043 会话活跃时长](../adr/0043-session-duration-active-time.md)
- [Agent Provider 协议](../architecture-design/agent-provider-protocol.md)

> 说明：本文件中的 Grok 端结论来自**实测**（`grok 1.0.41`，两次独立 stdio 进程 + 4 次最小 prompt），非文档转述；RedWhisk 侧结论来自代码阅读，均标 `文件:行号`。
