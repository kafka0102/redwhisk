# Grok Build `agent stdio`（ACP）源码级协议事实

> 调研日期：2026-09-27
> 上游项目：https://github.com/xai-org/grok-build（Apache-2.0，Rust）
> 证据基准：
> - 源码：`xai-org/grok-build` main，`SOURCE_REV = 036a5d8348cd744767cd0b08518ab17bf608fa7f`（tar 包取自 codeload，与调研时的 main 一致）
> - 本机 CLI：`grok 1.0.41 (4220f3b224a6)`（`/Users/yujianjia/.local/bin/grok`）
> - 运行时实证：向 `grok agent stdio` 手工发送 JSON-RPC（见文末「运行时实证」）
>
> 姊妹文档：[grok-build-structured-mode-feasibility.md](./grok-build-structured-mode-feasibility.md)（可行性 + RedWhisk 落地方案）、[grok-build-cli-probe-notes.md](./grok-build-cli-probe-notes.md)（CLI 运行时实测记录）
> 全文源码路径均为**上游仓库内相对路径**（省略仓库根前缀），行号对应该 `SOURCE_REV`；复现方式见文末「如何复现源码树」。

---

## 一、结论摘要表

| # | 结论 | 判定 | 关键证据 |
| --- | --- | --- | --- |
| 1 | 存在常驻、非 TUI 的 stdio 结构化接入：`grok agent stdio`，走标准 **ACP**（Agent Client Protocol）JSON-RPC over stdio | 成立 | `crates/codegen/xai-grok-pager/src/app/cli.rs:330`（`AgentCmd`，`Stdio` 变体）；`crates/codegen/xai-grok-pager-bin/src/main.rs:1424` |
| 2 | 协议即 ACP，依赖 crate `agent-client-protocol` **0.10.4**（features `["unstable"]`），与 Zed 同源 | 成立 | `Cargo.toml:118`；`crates/codegen/xai-grok-pager/Cargo.toml`（`agent-client-protocol`） |
| 3 | method 注册表：`initialize` / `authenticate` / `session/new` / `session/load` / `session/set_mode` / `session/prompt` / `session/cancel` / `session/set_model`，另有 `session/list` / `session/resume` / `session/close` 能力 | 成立 | `crates/codegen/xai-acp-lib/src/message.rs:356-383`；`.../mvp_agent/acp_agent.rs:954-999` |
| 4 | 流式事件为 `session/update` 通知（标准 ACP `SessionUpdate`）+ Grok 扩展 `x.ai/session_notification`（自定义 variant 枚举） | 成立 | `crates/codegen/xai-grok-shell/src/extensions/notification.rs:501`；`.../acp_session_impl/updates.rs:255-324` |
| 5 | 有 headless 输出格式：`--output-format plain\|json\|streaming-json\|streaming-messages-json` | 成立 | `crates/codegen/xai-grok-pager/src/headless/cli.rs:9-20` |
| 6 | 有 token 用量统计（input/output/cached/cache-creation/reasoning、按模型、numTurns、cost）；有精确耗时（每 turn `elapsed_ms`、`api_duration_ms`、`_meta` 时间戳、TTFT 依据） | 成立（字段级） | `.../extensions/notification.rs:107,207,247,1103`；`.../mvp_agent/mod.rs:424-469`；`.../acp_session_impl/updates.rs:283-303` |
| 7 | 会话能力：新建 / 恢复(resume) / 载入(load) / 指定 cwd / 指定 model / 权限模式 / 取消 均可结构化表达 | 成立 | 见第三节证据 |
| 8 | 常驻 server 形态：`agent serve`（WebSocket）、`agent leader`（Unix socket / Windows named pipe）、`agent headless`（WebSocket relay） | 成立 | `crates/codegen/xai-grok-shell/src/agent/server.rs:1-36`；`.../leader/mod.rs:5-31`；`.../leader/transport.rs:1-14` |
| 9 | 稳定性：ACP 接口无 `experimental`/`deprecated` 标注；仅协议 crate 启用 `unstable` feature，`--minimal` 被标为 “Experimental” | 部分成立 | `Cargo.toml:118`；`cli.rs` 中 `--minimal` 帮助文本 |
| 10 | 与 Codex app-server 能力对照：核心一一对应，Grok 额外提供 cost/子代理/plan 审批/`_meta` 细粒度时间戳 | 成立 | 见第五节 |

---

## 二、非 TUI 程序化接入面（逐条证据）

### 2.1 子命令注册

- `AgentCmd` 枚举（`agent` 的子命令）：`Stdio` / `Headless` / `Serve` / `Leader`
  - `crates/codegen/xai-grok-pager/src/app/cli.rs:330-338`
    （`pub enum AgentCmd { Stdio, Headless(HeadlessArgs), Serve(ServeArgs), Leader(LeaderArgs) }`）
- `AgentArgs`（`--model` / `--reasoning-effort` / `--always-approve`（alias `--yolo`，`:275`）/ `--agent-profile` / `--plugin-dir` / `--leader|--no-leader` / `--debug-file`）：`crates/codegen/xai-grok-pager/src/app/cli.rs:255-327`
- `ServeArgs`（`--bind` 默认 `127.0.0.1:2419`，`--secret`（env `GROK_AGENT_SECRET`））：同文件 `cli.rs:350`
- 运行时分发：
  - `crates/codegen/xai-grok-pager/src/agent_runtime.rs:47,59`
  - `crates/codegen/xai-grok-pager-bin/src/main.rs:1238,1270,1377,1424,1458,1597`

### 2.2 协议栈：ACP over stdio（自定义 JSON-RPC 编解码，line-delimited）

- 传输层实现（stdin 逐行读、逐行 JSON 写出、方法名分发）在 `xai-acp-lib`：
  - `crates/codegen/xai-acp-lib/src/lib.rs:1-27`（模块与导出：`line_reader`、`stdin_reader`、`message`、`gateway`）
  - `crates/codegen/xai-acp-lib/src/message.rs:44-47`（`trait AcpMethod { fn method_name(&self) -> &'static str; }`）
  - `crates/codegen/xai-acp-lib/src/message.rs:497-519`（按 method 名 deserialize 分发到 `Initialize/Authenticate/NewSession/LoadSession/SetSessionMode/Prompt/Cancel/SetSessionModel/ExtMethod/ExtNotification`）
- 依赖的是官方 ACP crate，不是私造协议：
  - `Cargo.toml:118`：`agent-client-protocol = { version = "0.10.4", features = ["unstable"] }`
  - `Cargo.lock:43-45`：`agent-client-protocol 0.10.4`
  - method 名字符串常量来自 `acp::AGENT_METHOD_NAMES.*`（`crates/codegen/xai-acp-lib/src/message.rs:356-383`）
  - 仓库内自测客户端用字面量交叉印证：`crates/codegen/xai-grok-test-support/src/acp_client.rs:149,159,257,298`（`initialize` / `session/new` / `session/load` / `session/cancel`）

### 2.3 agent（服务端）实现：`MvpAgent` 实现 `acp::Agent`

- `crates/codegen/xai-grok-shell/src/agent/mvp_agent/acp_agent.rs:92`：`impl acp::Agent for MvpAgent {`
- 各 method（含行号）：
  - `initialize`：`acp_agent.rs:94-97`
  - `authenticate`：`acp_agent.rs:602`
  - `new_session`：`acp_agent.rs:954`
  - `load_session`：`acp_agent.rs:967`
  - `list_sessions`：`acp_agent.rs:973`
  - `resume_session`：`acp_agent.rs:979`
  - `close_session`：`acp_agent.rs:985`
  - `prompt`：`acp_agent.rs:997`
  - `cancel`：`acp_agent.rs:1852`
  - `set_session_mode`：`acp_agent.rs:1918`
  - `set_session_model`：`acp_agent.rs:1940`
  - `set_session_config_option`：`acp_agent.rs:1946`

### 2.4 常驻 server 形态

- `grok agent serve`：WebSocket server（axum），默认 `127.0.0.1:2419`，token 鉴权（`--secret` / `GROK_AGENT_SECRET`）
  - `crates/codegen/xai-grok-shell/src/agent/server.rs:1-36`（模块头 + `use axum ... ws`）
  - `crates/codegen/xai-grok-shell/src/agent/server.rs:56-60`（`struct ServerConfig { bind_addr, secret }`）
- `grok agent leader`：多客户端共享同一后端；IPC 为 Unix domain socket（`~/.grok/leader.sock`），Windows 走 named pipe
  - `crates/codegen/xai-grok-shell/src/leader/mod.rs:5-31`（拓扑图：leader `~/.grok/leader.sock`，客户端 stdio / websocket）
  - `crates/codegen/xai-grok-shell/src/leader/transport.rs:1-14`（Unix = `tokio::net::UnixStream`；Windows = named pipe `\\.\pipe\grok-leader-<hash>`）
- `grok agent headless`：经 Grok WebSocket relay 的无头运行（`cli.rs:333`）

### 2.5 headless 输出格式枚举与输出分支

- 枚举定义：`crates/codegen/xai-grok-pager/src/headless/cli.rs:9-20`
  ```rust
  pub enum OutputFormat { Plain, Json, StreamingJson, StreamingMessagesJson } // #[value(name="streaming-json" / "streaming-messages-json")]
  ```
  - 注释（同文件 15、18 行）：`streaming-json` = “NDJSON: one ACP session update per line, the agent's native format”；`streaming-messages-json` = “NDJSON in the Anthropic Messages API wire format”
- 格式→reducer 映射：`crates/codegen/xai-grok-pager/src/headless/reducer/mod.rs:430-432`
  - `StreamingJson => AcpReducer`；`StreamingMessagesJson => MessagesReducer`；`Plain | Json => None`（无 reducer，直接输出）
- 输出分支：
  - 生命周期/文本/思考/结束/错误分流：`crates/codegen/xai-grok-pager/src/headless.rs:191-348`
  - `--output-format json` 的终态单对象（含 `text`/`stopReason`/`sessionId`/`requestId`/`thought`/`usage` 等）：`headless.rs:276-300`
  - 错误对象：`headless.rs:340-348`
- `streaming-json` 每行 envelope（`AcpLine` 的 variant：`text`/`thought`/`tool_call`/`tool_call_update`/`plan`/`available_commands`/`max_turns_reached`/`error`/`auto_compact_*`/`auto_continue_completed`/`image_compressed`/`memory_*`）：`crates/codegen/xai-grok-pager/src/headless/reducer/acp.rs:33-96`
  - `usage` 行结构 `AcpUsageLine`（含 `usage`, `stopReason`, `messageId`）：`acp.rs:13-30`
  - 终态 `AcpEndLine`（`type`/`stopReason`/`sessionId`/`requestId`）：`acp.rs:100-110`

---

## 三、事件 / 消息模型

### 3.1 两层事件模型

1. **标准 ACP `session/update`**（方法名 `session/update`，`params.update.sessionUpdate` 为 variant tag）
   - 标准 chunk 由脚本/会话层发出 ACP 类型，例如 `acp::SessionUpdate::AgentMessageChunk` / `AgentThoughtChunk` / `ToolCall` / `AvailableCommandsUpdate`
     - `crates/codegen/xai-grok-shell/src/agent/update_chunk_merge.rs:366,388`
     - `crates/codegen/xai-grok-shell/src/session/acp_session_impl/updates.rs:603`（`AvailableCommandsUpdate`）
   - variant 名对应关系（`sessionUpdate` 取值，标准 ACP）：`user_message_chunk` / `agent_message_chunk` / `agent_thought_chunk` / `tool_call` / `tool_call_update` / `plan` / `available_commands_update` / `current_mode_update` …
     - 仓库内测试报文交叉印证：`crates/codegen/xai-grok-pager/src/app/acp_handler/tests/mod.rs`、`crates/codegen/xai-grok-shell/tests/test_leader_stdio_integration.rs:3064`
2. **Grok 扩展 `x.ai/session_notification`（无 ACP tag 的自定义枚举）**
   - 发送点：`crates/codegen/xai-grok-shell/src/session/pending_interaction.rs:44-52`（`broadcast` → `acp::ExtNotification::new("x.ai/session_notification", ...)`）
   - 客户端识别为 session-update 扩展方法的白名单：`crates/codegen/xai-grok-pager/src/acp/mod.rs:19`（`"x.ai/session_notification" | "x.ai/session/update"`）

### 3.2 Grok 扩展 update 枚举（`SessionUpdate`，`snake_case` tag = `sessionUpdate`）

- 定义：`crates/codegen/xai-grok-shell/src/extensions/notification.rs:501`（`#[serde(rename_all="snake_case", tag="sessionUpdate")] pub enum SessionUpdate`）
- 关键 variant（行号）：
  - `DiffReview` `:503`、`RetryState` `:508`
  - `AutoCompactStarted` `:510`、`AutoCompactCompleted` `:521`（含 `elapsed_ms`）、`AutoCompactFailed` `:534`、`AutoCompactCancelled` `:586`、`AutoContinueCompleted` `:592`（`total_tokens`）
  - Memory 系列：`MemoryFlushStarted/Completed` `:539/:541`、`MemoryCaptureActivity` `:549`、`MemoryDream*` `:566/:568/:573`、`MemorySessionSaved` `:581`
  - Hook：`HookAnnotation` `:620`、`HookRunStarted` `:628`、`HookExecution` `:639`（含每个 run 的 `status.elapsed_ms`）
  - 子代理：`SubagentSpawned` `:723`、`SubagentProgress` `:773`、`SubagentFinished` `:802`
  - 任务：`TaskCompleted` `:713`、`TaskBackgrounded` `:834`、`BackgroundTasks` `:864`、`ScheduledTask*` `:869/:875/:884`
  - 模型/内容：`ModelAutoSwitched` `:898`、`ModelChanged` `:909`、`ToolCallDeltaChunk` `:919`、`ImageCompressed` `:933`、`ImageDropped` `:940`
  - Plan：`PlanKept` `:1095`、`PlanCleared` `:1097`、`PlanExecuting` `:1099`
  - 交互/审批：`PendingInteraction` `:1086`、`InteractionResolved` `:1092`
  - **终态**：`TurnCompleted` `:1103`、`ResponseStarted` `:1124`、`ReasoningCompleted` `:1138`、`ResponseCompleted` `:1145`
  - 其他：`GoalUpdated` `:1001`、`WorkflowUpdated` `:957`、`MonitorEvent` `:891`、`SessionStatus` `:669`、`LastTurnSummary` `:693`、`RewindMarker` `:706`、`CompactionCheckpoint` `:703`
- 文本 / reasoning / tool 字段承载：
  - 文本与思考走标准 ACP chunk（`ContentBlock::Text`）：`crates/codegen/xai-grok-shell/src/agent/update_chunk_merge.rs:366-393`
  - tool call 事件带 `kind`（如 `ToolKind::Edit`）、`locations`：`crates/codegen/xai-grok-shell/src/session/acp_session_impl/updates.rs:261-275`

### 3.3 `_meta`（每条通知的时间戳与序号）

- 构建点：`crates/codegen/xai-grok-shell/src/session/acp_session_impl/updates.rs:283-313`
  - `_meta` 字段：`totalTokens`、`eventId`（`"{sessionId}-{counter}"`）、`agentTimestampMs`（UTC ms）、`promptId`、`streamStartMs`、`turnStartMs`、`updateType`、`updateParams`、`chunkId`、`isReplay`
- 客户端解析（类型定义）：`crates/codegen/xai-grok-pager/src/acp/meta.rs:14-36`
  - `total_tokens`(`totalTokens`) / `agent_timestamp_ms`(`agentTimestampMs`) / `stream_start_ms`(`streamStartMs`) / `turn_start_ms`(`turnStartMs`) / `prompt_id`(`promptId`) / `is_replay`(`isReplay`) / `event_id`(`eventId`) / `event_seq`
- 运行时实证（见文末）：`"_meta":{"totalTokens":2262,"eventId":"01a0...-1","agentTimestampMs":1790517500401,"updateType":"AvailableCommandsUpdate","updateParams":{"commandsCount":196}}`

---

## 四、统计信息（token / 耗时 / cost）

### 4.1 token 用量

- **会话/整 prompt 聚合 `PromptUsage`**：`crates/codegen/xai-grok-shell/src/extensions/notification.rs:107-126`
  - `totals: PromptUsageModel`（flatten）、`modelUsage: IndexMap<model, PromptUsageModel>`、`numTurns`、`usageIsIncomplete`
- **单模型/累计明细 `PromptUsageModel`**：`notification.rs:207-243`
  - `inputTokens`、`outputTokens`、`totalTokens`、`cachedReadTokens`、`cacheCreationTokens`、`reasoningTokens`、`modelCalls`、`apiDurationMs`、`costUsdTicks`、`costIsPartial`
  - 注意：ACP 口径 `inputTokens` 含 cache 读取；“headless result” 口径为去缓存（`project_result_usage`，`notification.rs:324`）；`ACP _meta` 的 sibling token 字段仅代表**最后一次模型调用**
    - 口径说明原文：`notification.rs:104`
- **单次调用 `ResponseUsage`**：`notification.rs:247-258`（`input_tokens`/`output_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`/`reasoning_tokens`）
- **`session/prompt` 响应 `_meta`（`PromptResponseMeta`）**：`crates/codegen/xai-grok-shell/src/agent/mvp_agent/mod.rs:424-469`
  - `sessionId`、`requestId`、`promptId`、`totalTokens`、`modelId`、`inputTokens`、`outputTokens`、`cachedReadTokens`、`reasoningTokens`、`usage`(=整 prompt `PromptUsage`)、`cancellationCategory`、`cancellationContext`、`cancelTrigger`、`structuredOutput(_error)`、`toolOverrides`、`completionKind`
  - 构造函数：`mod.rs:489-529`

### 4.2 精确执行时间

- 每 turn 墙钟时长 `elapsed_ms`：随 `TurnCompleted` 上报 —— `notification.rs:1103-1122`（`elapsed_ms: Option<u64>`）
- 每 turn API 时长：`PromptUsageModel.api_duration_ms`（wire `apiDurationMs`）—— `notification.rs:226`
- 更细的起止时间戳（可算 TTFT / 每步耗时）：`_meta.streamStartMs` / `_meta.turnStartMs` / `_meta.agentTimestampMs` —— `crates/codegen/xai-grok-shell/src/session/acp_session_impl/updates.rs:297-303`
  - 客户端在此之上还有专门的 tracker 计算 `agentTimestampMs - streamStartMs`：`crates/codegen/xai-grok-pager/src/acp/tracker.rs:339-361`
- hook / 工具耗时：`HookExecution` 每个 run 带 `status.elapsed_ms`（`notification.rs:639`）；工具超时错误带 `elapsed_ms`（`crates/common/xai-tool-runtime/src/error.rs:331-337`）
- `streaming-messages-json` 终态：`result.usage`（`input_tokens`/`output_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`）、`modelUsage`、`num_turns`、`total_cost_usd`、`duration_api_ms` —— `crates/codegen/xai-grok-pager/src/headless/reducer/messages/usage.rs:17-100`

### 4.3 cost

- `costUsdTicks`（1 USD = 1e10 ticks）：`notification.rs:229-230`、常量 `USD_TICKS_PER_USD`：`notification.rs:309`
- 换算（headless）：`ticks_to_usd` —— `notification.rs:311-313`
- 不信任标志：`costIsPartial`（`notification.rs:232-235`）、`usageIsIncomplete`（`notification.rs:121-126`）；`attach_result_usage_fail_closed`：`notification.rs:415`

### 4.4 拉取历史用量的 CLI

- `grok usage <SESSION_ID> [TURN]`：`grok --help`（Usage 命令）；实现 `crates/codegen/xai-grok-pager/src/usage_cmd.rs:1-52`（session 总计 + 每个 turn；`input_tokens`/`turn_count` 等）

---

## 五、会话能力（结构化模式下如何表达）

| 能力 | 结构化表达 | 证据 |
| --- | --- | --- |
| 新建 + 指定 cwd | `session/new`，`params.cwd` | 运行时实证返回 `_meta.currentWorkingDirectory`；`acp_agent.rs:954`；`test-support/acp_client.rs:159` |
| 指定 model | `session/new` `_meta` / `modelId`；`session/set_model` | `acp_agent.rs:1940`；客户端 `acp_client.rs:169,183` |
| 恢复 resume | `session/resume`（能力 `sessionCapabilities.resume`） | `acp_agent.rs:979`；initialize 实证返回 `"sessionCapabilities":{"list":{},"resume":{},"close":{}}` |
| 载入历史 load | `session/load`（replay；`_meta.isReplay`） | `acp_agent.rs:967`；`meta.rs:28,49` |
| 列出/关闭 | `session/list` / `session/close` | `acp_agent.rs:973,985` |
| 续接 continue | `grok -c/--continue`（CLI）；结构化下等价 `resume`+`--fork-session` | `grok --help`；`cli.rs` 中 `--fork-session` |
| 指定 session id | `session/new` `_meta.sessionId`（须 UUID） | `crates/codegen/xai-grok-pager/src/app/session_startup.rs:688,838` |
| 权限模式 | `session/set_mode`；模式枚举 `default/acceptEdits/auto/dontAsk/bypassPermissions/plan` | `crates/codegen/xai-grok-agent/src/config.rs:922-940`；`--permission-mode`（`grok --help`） |
| 审批请求（反向请求） | 阻塞式 ACP 反向请求 `request_permission`（+ `x.ai/ask_user_question`、`x.ai/exit_plan_mode`、MCP elicitation），并广播 `pending_interaction` | `crates/codegen/xai-grok-shell/src/session/pending_interaction.rs:1-13,24-32,69-93` |
| 审批结果 | `interaction_resolved`（update variant），按 `tool_call_id` 关联 | `notification.rs:1092`；`pending_interaction.rs:70-93` |
| 取消/打断 | `session/cancel`（通知），可带 `_meta.cancelTrigger`（`send_now`/`ctrl_c`/`esc`）；结果 `cancelTrigger` 回填到 prompt 响应 | `acp_agent.rs:1852-1866`；`mvp_agent/mod.rs:459-462` |
| always-approve | `--always-approve`（alias `--yolo`）进程级；或 `/always-approve` 命令 | `crates/codegen/xai-grok-pager/src/app/cli.rs:275`；运行时 `availableCommands` 含 `always-approve` |

---

## 六、与 Codex app-server 能力对照

判定基准：Codex 侧为 `Codex app-server`（JSON-RPC over stdio）。

| 维度 | Grok（`agent stdio`） | Codex（app-server） | 对应/差异 |
| --- | --- | --- | --- |
| 传输 | ACP JSON-RPC over stdio（`xai-acp-lib`，line-delimited） | JSON-RPC over stdio | **一一对应** |
| 握手 | `initialize`（返回 `protocolVersion` + `agentCapabilities` + `authMethods` + `_meta`） | `initialize` | 对应（字段名不同） |
| 建会话 | `session/new` → `sessionId` | `newConversation`/`sendUserTurn` 等 | 对应（语义近似，命名不同） |
| 发消息 | `session/prompt`（响应含 `_meta.usage`） | turn/prompt 类方法 | 对应 |
| 流式事件 | `session/update`（标准 ACP）+ `x.ai/session_notification`（扩展 variant） | 事件流（item 事件） | 对应；Grok 扩展 variant 更多 |
| 文本/思考/工具 | `agent_message_chunk` / `agent_thought_chunk` / `tool_call(_update)` | 对应 item 事件 | 对应 |
| tool call 详情 | `kind`、`locations`、`content`、`rawInput/rawOutput`、`status` | 对应 | 对应 |
| 审批 | **阻塞式反向请求** `request_permission` + `pending_interaction`/`interaction_resolved` + `always-approve` | 审批请求事件 | 对应（Grok 还统一了 question/plan/MCP elicitation） |
| 取消 | `session/cancel`（可带 trigger） | interrupt/cancel | 对应 |
| 恢复/续接 | `session/resume` / `session/load` / `--continue` / `--fork-session` | resume/continue | 对应 |
| token 统计 | `PromptUsage`（含 `modelUsage`、`numTurns`、cached/cache-creation/reasoning）、`ResponseUsage` | usage 字段 | **Grok 更细**（按模型 + 缓存分桶 + 不完整标记） |
| cost | `costUsdTicks`（+`costIsPartial`） | （Codex 无等价内建 cost） | **Grok 更强** |
| 耗时 | 每 turn `elapsed_ms` + `apiDurationMs` + `_meta` 时间戳（`streamStartMs`/`turnStartMs`/`agentTimestampMs`） | usage/耗时字段 | **Grok 更细**（有 TTFT 依据） |
| 子代理/计划 | `SubagentSpawned/Progress/Finished`、`PlanKept/Executing/Cleared`、`workflow`/`goal` 命令 | 计划事件 | Grok 扩展更丰富 |
| 常驻 server | `agent serve`（WebSocket 2419）、`agent leader`（unix socket/named pipe）、`agent headless`（WS relay） | app-server（stdio）；另有 socket/http 变体 | 各有；Grok 多出 leader 多客户端共享 |
| SDK | 官方提供 **Agent SDKs**（`--plugin-dir`“Used by the Agent SDKs”）；`acp::Agent` trait 可作库引用 | Codex SDK | 均有（Grok SDK 为 ACP 生态） |
| headless 便捷模式 | `--output-format json/streaming-json/streaming-messages-json` 单进程一次性输出 | `codex exec --json` 等 | 对应 |

**缺失/差异点（相对 Codex app-server 目标）**
- Grok 扩展事件（`x.ai/session_notification` 的 variant、`_meta` 字段）**不是官方稳定 schema**：无版本号、无 `deprecated` 标注，靠仓库内枚举 + 客户端容错解析（`meta.rs:5-6` “parses degrade gracefully”）。
- 用量口径存在“双重口径”（ACP 含 cache vs headless 去 cache），接入时需按需选择（见 `notification.rs:104`）。
- `session/prompt` 响应 `_meta` 的 sibling token 字段仅代表最后一次模型调用，整 prompt 统计在 `_meta.usage`。

---

## 七、稳定性 / 版本兼容

- 协议 crate 版本：`agent-client-protocol` **0.10.4**，features `["unstable"]` —— `Cargo.toml:118`、`Cargo.lock:43-45`
  - 含义：该 crate 的 `unstable` feature 被启用（ACP 官方把部分能力放 unstable feature gate）；Grok 未在自身代码标注 ACP 接口为 experimental/deprecated。
- 无 `experimental`/`unstable`/`deprecated` 标注于 stdio/ACP 路径：检索范围 `crates/codegen/xai-acp-lib/src/**`、`.../mvp_agent/acp_agent.rs`、`.../headless.rs`，仅命中 `--minimal`（实验性 TUI 渲染）与 `--experimental-memory`。
  - 检索命令：`rg -n 'experimental|unstable|deprecated|UNSTABLE|EXPERIMENTAL' <上述文件>`
- 向前/向后兼容证据（协议演进的容错设计）：
  - 客户端 `_meta` 全字段 `Option`，“grok-shell hasn't been updated or meta is absent”时优雅降级 —— `crates/codegen/xai-grok-pager/src/acp/meta.rs:5-6`
  - `TurnCompleted.elapsed_ms` 对旧文件缺失容错（`None`）—— `notification.rs:1119-1121`；测试 `turn_completed_old_json_without_elapsed_ms_deserializes_none`：`notification.rs:2729`
  - 旧广播 `x.ai/session/prompt_complete` 保留一个版本以兼容未升级 leader —— `crates/codegen/xai-grok-pager/src/app/turn_completion.rs:4`
  - 版本不匹配处理：`x.ai/leader/version_mismatch`（`acp_handler/mod.rs:627`、`acp/mod.rs:12`）
- 无独立 schema 版本号字段：`initialize` 返回 `protocolVersion: 1`（运行时实证），除此之外未发现 Grok 自定义 schema/version 常量。

---

## 八、运行时实证（补充，非源码）

命令：`grok agent stdio`，向其 stdin 逐行写入 JSON-RPC。

1. `initialize` 返回（节选）：
   `{"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"promptCapabilities":{"image":false,"audio":false,"embeddedContext":true},"mcpCapabilities":{"http":true,"sse":true},"sessionCapabilities":{"list":{},"resume":{},"close":{}},"auth":{},...},"authMethods":[{"id":"xai.api_key",...},{"id":"grok.com",...}],"_meta":{"defaultAuthMethodId":"xai.api_key","currentWorkingDirectory":"/private/tmp","agentVersion":"1.0.41",...}}}`
2. `session/new`（`params.cwd=/tmp`）返回（节选）：
   `{"result":{"sessionId":"01a0e328-...","_meta":{"currentWorkingDirectory":"/tmp","x.ai/sessionDetail":{...}}}}`
3. 通知流（节选）：
   - `{"method":"_x.ai/session/setup","params":{"method":"session/new","phase":"auth"...}}`（建会话分阶段进度）
   - `{"method":"session/update","params":{"sessionId":"...","update":{"sessionUpdate":"available_commands_update",...},"_meta":{"totalTokens":2262,"eventId":"...-1","agentTimestampMs":1790517500401,"updateType":"AvailableCommandsUpdate","updateParams":{"commandsCount":196}}}}`
   - `{"method":"_x.ai/session_notification","params":{"sessionId":"...","update":{"sessionUpdate":"hook_execution","event_name":"session_start","runs":[{"status":{"status":"success","elapsed_ms":15}},...]},...}}`
   - `{"method":"_x.ai/mcp_initialized","params":{"sessionId":"...","mcpToolCount":8,"elapsedMs":6075}}`

> 结论：`agent stdio` 是**可用的常驻 ACP 服务端**，方法名、`session/update` 与扩展事件、`_meta` 统计字段均与源码一致。

---

## 九、未证实 / 缺口清单

> 状态更新：下列第 1、2、7 项已由并行 CLI 实测补齐，证据见 [grok-build-cli-probe-notes.md](./grok-build-cli-probe-notes.md)；本清单保留原始记录以便区分「源码确证」与「运行时确证」两类证据。

1. **端到端拿到 `turn_completed.usage` 的运行时样本**：~~未取得~~ → **已由 CLI 实测补齐**（`elapsed_ms` 21162 / 20685 / 7856 ms，含本轮 + session 累计 usage）；字段级源码证据见 `notification.rs:1103-1122`。
2. **`AGENT_METHOD_NAMES` 的精确字符串**：未在本地 crate 源码中读到（`agent-client-protocol` 0.10.4 未 vendored 到 `~/.cargo`），采用「仓库内字面量 + 运行时实证」交叉印证：`initialize`/`session/new`/`session/load`/`session/cancel`/`session/set_model`/`session/set_mode`/`session/prompt`。**运行时已确证**其中 `initialize` / `session/new` / `session/prompt` 的 name 与报文（见 CLI 实测文档 §3）。
3. **`session/list` / `session/resume` / `session/close` 的确切 wire 名**：仅由 `agentCapabilities.sessionCapabilities.{list,resume,close}`（运行时实证）+ trait 名 `list_sessions/resume_session/close_session` 推断，未逐条发请求验证。
4. **`x.ai/session_notification` 全量 variant 是否穷举**：本文按 `notification.rs:501-1200` 区间列出，仍有更多 variant（如 workflow/goal 细节）未逐一收录。
5. **多模态**：`initialize.promptCapabilities` 实测为 `image:false, audio:false`（运行时），源码见 `promptCapabilities` 构造（`acp_agent.rs` initialize 分支）；未深挖图片输入路径。
6. **Windows 具体可用性**：仅确认 leader IPC 有 named pipe 实现（`leader/transport.rs:1-14`），未在 Windows 上实测。
7. **`--output-format json`（一次性）完整字段**：源码见 `headless.rs:276-300`，未取得运行时样本。

检索方式备注：主要用 `rg`，关键词含 `agent stdio`、`AgentCmd`、`session/new`、`session/prompt`、`session/update`、`session_notification`、`OutputFormat`、`streaming-json`、`turn_completed`、`usage`、`apiDurationMs`、`elapsed_ms`、`agentTimestampMs`、`PromptUsage`、`PermissionMode`、`request_permission`；重点目录 `crates/codegen/xai-acp-lib`、`crates/codegen/xai-grok-shell/src/{agent,session,extensions,leader}`、`crates/codegen/xai-grok-pager/src/{app,headless,acp}`。

---

## 十、如何复现源码树

调研时的源码树来自临时目录，不随本文保留。复现同版本源码：

```bash
curl -sSL -o grok-build-main.tar.gz \
  "https://codeload.github.com/xai-org/grok-build/tar.gz/<SOURCE_REV>"
mkdir -p grok-src && tar -xzf grok-build-main.tar.gz -C grok-src
cat grok-src/*/SOURCE_REV     # 应输出 036a5d8348cd744767cd0b08518ab17bf608fa7f
```

> 本机 `git clone` 该仓库易出现 `error: RPC failed; curl 18 ... early EOF`，用 codeload tar 包更稳。
> 若要跟随最新 main，把 `<SOURCE_REV>` 换成 `refs/heads/main`；注意行号会随上游演进漂移，届时以本文的**符号名**（枚举/方法名/字段名）为准重新定位。
