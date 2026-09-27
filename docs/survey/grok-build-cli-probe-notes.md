# Grok CLI 结构化接入实测记录

> 调研日期：2026-09-27
> 姊妹文档：[grok-build-acp-protocol-notes.md](./grok-build-acp-protocol-notes.md)（源码级协议事实）、[grok-build-structured-mode-feasibility.md](./grok-build-structured-mode-feasibility.md)（可行性 + RedWhisk 落地方案）
> 原始 trace 文件属临时产物，未纳入仓库；**本文正文已内联全部关键报文**，文末附录给出可直接复现的采集脚本。

- CLI：`/Users/yujianjia/.local/bin/grok`，`grok 1.0.41 (4220f3b224a6)`
- 系统：macOS；实测在临时工作目录 `/tmp/grok-probe` 中进行
- 参考源码：本记录不含源码级结论，源码级证据见 `grok-build-acp-protocol-notes.md`（`xai-org/grok-build@036a5d83`）
- 实测模型调用次数：6 次（`-p` 2 次、ACP `session/prompt` 4 次），均为 `Reply with exactly: ...` 这类最小 prompt

## 0. 环境事实（影响结论）

`~/.grok/config.toml`（已脱敏）指向**第三方 base_url**，不是 xAI 官方端点：

```toml
[endpoints]
models_base_url = "https://learn.rumengling.ink/v1"

[models]
default = "my-model"

[model.my-model]
model = "grok-4.7"
base_url = "https://learn.rumengling.ink/v1"
api_key = <REDACTED>

[ui]
permission_mode = "always-approve"
```

对本任务的直接影响（重要）：

1. 所有 token 计数、`apiDurationMs`、`modelId` 字段都是 **agent 侧（grok 自身）统计/落库** 的结果，实跑证明它们在第三方端点下依然完整返回。
2. **本机任何结构化输出里都没有 cost / price / USD 字段**（对全部实跑输出全文 grep `cost|price|usd`，唯一命中是某个 plugin 描述文本，非统计字段）。`grok usage --help` 自称 “Print persisted token and cost usage”，但实际输出只有 token。合理推断：cost 依赖 xAI 官方端点的价格表，第三方 base_url 下不可得。**未实测官方端点**。（注意：源码侧**存在** `costUsdTicks` / `costIsPartial` 字段，见 [grok-build-acp-protocol-notes.md](./grok-build-acp-protocol-notes.md) §4.3，故这是「端点未返回」而非「协议不支持」。）
3. 因为 `[ui] permission_mode = "always-approve"`，工具调用**未触发真实的人工批准等待**（见 §4.6），所以“需要批准时客户端应该回什么”只拿到了间接证据。

---

## 1. 命令清单与原始输出（脱敏）

### 1.1 `grok --help`（顶层，关键部分）

```
Usage: grok [OPTIONS] [PROMPT] [COMMAND]

      --output-format <OUTPUT_FORMAT>
          Output format for headless mode
          Possible values:
          - plain
          - json
          - streaming-json:          NDJSON: one ACP session update per line, the agent's native format
          - streaming-messages-json: NDJSON in the Anthropic Messages API wire format
          [default: plain]

  -p, --single <PROMPT>            Single-turn prompt. Prints the response to stdout and exits
      --prompt-file <PATH>         Single-turn prompt from a file
      --prompt-json <JSON>         Single-turn prompt as JSON content blocks
      --json-schema <SCHEMA>       JSON Schema for structured output (implies --output-format json)
      --include-partial-messages   Emit incremental `stream_event` lines alongside whole messages
                                   (only affects --output-format streaming-messages-json)
  -m, --model <MODEL>
      --reasoning-effort <EFFORT>  [aliases: --effort]
      --max-turns <N>
      --permission-mode <MODE>     [possible values: default, acceptEdits, auto, dontAsk, bypassPermissions, plan]
  -c, --continue                              Continue the most recent session for the current working directory
  -r, --resume [<SESSION_ID_OR_TITLE>]        Resume a session by ID or title, or the most recent if omitted
  -s, --session-id <SESSION_ID>               Use a specific session UUID for a **new** conversation
      --fork-session                          When resuming, create a new session ID instead of reusing the original
      --always-approve / --allow / --deny
      --tools <TOOLS> / --disallowed-tools <TOOLS>
      --cwd <CWD> / --sandbox <PROFILE> / --worktree
  -v, --version

Commands:
  agent   Run Grok without the interactive UI
  export, inspect, leader, login, logout, mcp, memory, models, plugin,
  sessions, setup, trace, update, usage, worktree, clone, completions,
  cursor-worker, dashboard, doctor, du, wrap
```

### 1.2 `grok agent --help`

```
Run Grok without the interactive UI

Usage: grok agent [OPTIONS] [COMMAND]

Commands:
  stdio     Run the agent over stdio
  headless  Run the agent headlessly over the Grok WebSocket relay
  serve     Run the agent as a WebSocket server
  leader    Run as the shared leader process for other clients
  help      Print this message or the help of the given subcommand(s)

Options:
      --reauth
  -m, --model <MODEL>
      --reasoning-effort <EFFORT>       [aliases: --effort]
      --always-approve
      --agent-profile <PATH>
      --plugin-dir <DIR>                (repeatable; "Used by the Agent SDKs to inject per-connection plugins")
      --leader / --no-leader
      --grok-ws-origin <GROK_WS_ORIGIN>
      --grok-ws-url <GROK_WS_URL>
      --cli-chat-proxy-base-url <CLI_CHAT_PROXY_BASE_URL>
      --xai-api-base-url <XAI_API_BASE_URL>
      --debug / --debug-file <FILE>
      --leader-socket <PATH>
```

### 1.3 `grok agent stdio --help`

```
Run the agent over stdio

Usage: grok agent stdio [OPTIONS]

Options:
      --debug
      --debug-file <FILE>
  -h, --help
      --leader-socket <PATH>
```

> 注意：`agent stdio` **只有调试/leader 参数**，没有 `--cwd` / `--model` / `--permission-mode`。工作目录、MCP、模型等全部通过 JSON-RPC 参数传入（`initialize` / `session/new`），见 §4。

### 1.4 `grok agent serve --help` / `grok agent headless --help`

```
Run the agent as a WebSocket server
Usage: grok agent serve [OPTIONS]
      --bind <BIND>      [default: 127.0.0.1:2419]
      --secret <SECRET>  [env: GROK_AGENT_SECRET=]
      --remote <REMOTE>  Remote agent URL for proxy mode

Run the agent headlessly over the Grok WebSocket relay
Usage: grok agent headless [OPTIONS]
      --grok-ws-origin / --grok-ws-url
```

### 1.5 `grok usage --help` / `grok models` / `grok sessions list`

```
Print persisted token and cost usage for a session
Usage: grok usage [OPTIONS] <SESSION_ID> [TURN]
Arguments:
  <SESSION_ID>  Session ID
  [TURN]        Turn number. Omit for session totals and every recorded turn
```

```
$ grok models
Model 'my-model' is using its own API key.
Default model: my-model
Available models:
  * my-model (default)
```

```
$ grok sessions list
SESSION ID                            CREATED     UPDATED     STATUS      SUMMARY
01a0e314-ad16-76a0-b8e8-9b0ee8a24bbe  2026-09-27  2026-09-27  local  User requests exact hi reply
01a0e314-43bc-7a73-86cf-63626f37a2a9  2026-09-27  2026-09-27  local  User requests exact hi reply only
```

---

## 2. headless 模式结构化输出实测

### 2.1 `grok -p "Reply with exactly: hi" --output-format json`

进程总耗时 **17.58s**（`time` 实测，冷启动）。stdout 是**单个 JSON 对象**（非 NDJSON），stderr 为空，exit=0。原文（`thought` 已截断）：

```json
{
  "text": "hi",
  "stopReason": "end_turn",
  "sessionId": "01a0e314-43bc-7a73-86cf-63626f37a2a9",
  "requestId": "5ee39cf5-208e-49fa-b99b-6cd04348229b",
  "thought": "The user wants me to reply with exactly \"hi\"...\n\n",
  "usage": {
    "input_tokens": 28751,
    "cache_read_input_tokens": 1152,
    "cache_creation_input_tokens": 0,
    "output_tokens": 328,
    "reasoning_tokens": 327,
    "total_tokens": 30231
  },
  "num_turns": 1,
  "modelUsage": {
    "grok-4.7-build": {
      "inputTokens": 28751,
      "outputTokens": 328,
      "cacheReadInputTokens": 1152,
      "cacheCreationInputTokens": 0,
      "modelCalls": 1
    }
  }
}
```

关键观察：

- 有 `usage`（snake_case）+ `modelUsage`（camelCase，按模型分组），有 `sessionId` / `requestId` / `stopReason` / `num_turns`。
- **有 token，没有任何耗时字段**，也没有 cost。
- `thought` 是把整段思维链一次性塞进同一个对象（非流式），大 prompt 下这个字段会很大。

### 2.2 `grok -p "..." --output-format streaming-json`

进程总耗时 **15.72s**，50 行、**纯 NDJSON**（`wc -l` = 50），stderr 空，exit=0。每行都是一个独立 `{"type": ...}` 对象。真实行样本（`available_commands` 长数组已省略）：

```json
{"type":"available_commands","tools":["run_terminal_command","read_file",...],"commands":["compact","always-approve",...]}
{"type":"thought","data":"The"}
{"type":"thought","data":" user"}
...
{"type":"text","data":"hi"}
{"type":"usage","usage":{"input_tokens":28753,"output_tokens":305,"cache_read_input_tokens":1152,"cache_creation_input_tokens":0,"reasoning_tokens":304}}
{"type":"end","stopReason":"end_turn","sessionId":"01a0e314-ad16-76a0-b8e8-9b0ee8a24bbe","requestId":"ce5462b4-d48e-4dbe-9b7b-338e617d74d1","usage":{"input_tokens":28753,"cache_read_input_tokens":1152,"cache_creation_input_tokens":0,"output_tokens":305,"reasoning_tokens":304,"total_tokens":30210},"num_turns":1,"modelUsage":{"grok-4.7-build":{"inputTokens":28753,"outputTokens":305,"cacheReadInputTokens":1152,"cacheCreationInputTokens":0,"modelCalls":1}}}
```

观察：

- 逐行 JSON、随时可解析；`thought` / `text` 都是**逐 chunk 差分**（`data` 字段），天然适合增量渲染。
- 结束事件 `type:"end"` 携带与 `--output-format json` 完全同构的汇总。
- **`available_commands` 会重复出现多次**（本次 3 次，且第 3 次比前两次多了 `zai-mcp-server__*` 等 MCP 工具）——说明 MCP 工具是异步注册的，客户端需要做幂等覆盖。
- `streaming-json` 的 help 描述是 “one ACP session update per line, the agent's native format”，但实测的 `type` 值（`available_commands` / `thought` / `text` / `usage` / `end`）**并不是** §4 中 `grok agent stdio` 的 ACP `session/update` 结构。它是 headless 侧的简化投影，不要把它当成 ACP 等价物。
- **仍然没有耗时字段。**

---

## 3. 结构化/ACP：`grok agent stdio` JSON-RPC 实测

两次独立进程实测（trace 为临时产物，已按附录脚本可复现）：

- trace A（94 行）：握手 + 1 次 prompt，无工具调用
- trace B（164 行）：1 次 `session/new` + **同一 session 连续 2 次 `session/prompt`**，第 2 次触发 `read_file` 工具
- 两次 stdout **全部是合法 JSON（0 行 non-JSON）**，stderr **0 行**。按行分隔的 LSP 风格 JSON-RPC over stdio。

### 3.1 握手时序（实测 time 轴，单位秒，相对进程启动）

```
0.009  -> initialize
0.420  <- initialize result
0.432  <- _x.ai/mcp/servers_updated (notification)
3.014  -> session/new
3.101  <- _x.ai/session/setup phase=auth ... (9 条 setup 进度通知)
3.341  <- session/new result
3.379  <- _x.ai/mcp/init_progress (total=3)
3.393  <- session/update available_commands_update
3.518  -> session/prompt
3.523  <- _x.ai/sessions/changed, _x.ai/queue/changed
3.569  <- _x.ai/session_notification hook_run_started(user_prompt_submit)
20.924 <- session/update agent_thought_chunk (首 token)
23.929 <- session/update agent_message_chunk ("hi")
24.094 <- _x.ai/session_notification response_completed (usage)
24.703 <- _x.ai/session_notification turn_completed (usage + elapsed_ms)
24.707 <- _x.ai/session/prompt_complete
24.711 <- session/prompt result (id=3)
```

> 进程总时长 94.55s 是因为 **`grok agent stdio` 完成一轮后不会退出**，需要客户端自己关闭 stdin / 终止进程（脚本在 90s 上限处 terminate）。首 token 延迟约 17.4s，其中 `_x.ai/mcp_initialized` 报 `elapsedMs: 6134`，说明 MCP server 冷启动占了可观时间。

### 3.2 `initialize`

请求（客户端）：

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false}},"clientInfo":{"name":"redwhisk-probe","version":"0.0.1"}}}
```

响应（截断）：

```json
{"jsonrpc":"2.0","id":1,"result":{
  "protocolVersion":1,
  "agentCapabilities":{
    "loadSession":true,
    "promptCapabilities":{"image":false,"audio":false,"embeddedContext":true},
    "mcpCapabilities":{"http":true,"sse":true},
    "sessionCapabilities":{"list":{},"resume":{},"close":{}},
    "auth":{},
    "_meta":{
      "x.ai/fs_notify":true,
      "x.ai/hooks":{"blockingEvents":["pre_tool_use","stop","subagent_stop"],"decisions":["deny","block"],"stopSignals":["continue","stopReason","additionalContext"]},
      "x.ai/capabilities":{"toolOverrides":{"x_keyword_search":true,"x_semantic_search":true,"x_user_search":false,"x_thread_fetch":false}}
    }
  },
  "authMethods":[
    {"id":"xai.api_key","name":"xai.api_key","description":"XAI_API_KEY or api_key/env_key in config.toml"},
    {"id":"grok.com","name":"Grok","description":"Sign in with Grok"}
  ],
  "_meta":{
    "grokShell":true,"defaultAuthMethodId":"xai.api_key","x.ai/mcp/sdk":true,"x.ai/pluginDirs":true,
    "currentWorkingDirectory":"/private/tmp/grok-probe","agentVersion":"1.0.41",
    "agentId":"9d08cd65-25df-5ea4-8c9d-b53a02f03e7d","agentInstanceId":"43cb855e-e404-4f1d-b143-ec8e4f9f8c73",
    "hostname":"<local-ip>",
    "modelState":{"currentModelId":"my-model","availableModels":[{"modelId":"my-model","name":"my-model","_meta":{"totalContextTokens":200000,"agentType":"grok-build-plan"}}]},
    "mcpServers":[], "mcpApps":false,
    "availableCommands":[{"name":"compact","description":"..."},{"name":"session-info",...},{"name":"goal",...}],
    "cancelRewind":true,"sessionRecap":true,"feedbackTraceOffer":false,"voiceMode":true
  }
}}
```

- 协议是 **ACP（Zed Agent Client Protocol）** 形状 + xAI 私有扩展（`_x.ai/*`、`_meta`）。
- `protocolVersion` 回 1，与请求一致。
- 本次实测**没有调用 `authenticate`**（config 里的 api_key 已足够），认证方法仅作为能力声明返回。

### 3.3 `session/new`

请求：`{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/tmp/grok-probe","mcpServers":[]}}`

响应（截断）：

```json
{"jsonrpc":"2.0","id":2,"result":{
  "sessionId":"01a0e316-2618-78e3-af56-4a37f7e7b81c",
  "models":{"currentModelId":"my-model","availableModels":[{"modelId":"my-model","name":"my-model","_meta":{"totalContextTokens":200000,"agentType":"grok-build-plan"}}]},
  "configOptions":[{"id":"model","name":"Model","category":"model","type":"select","currentValue":"my-model","options":[{"value":"my-model","name":"my-model"}]}],
  "_meta":{
    "currentWorkingDirectory":"/tmp/grok-probe",
    "codebaseIndexed":[],"isGitRepo":false,"gitRoot":null,"showNonGitWarning":false,"feedbackEnabled":false,
    "x.ai/sessionConfig":{"options":[{"id":"my-model","category":"model","label":"my-model","selected":true}]},
    "x.ai/sessionDetail":{"sessionId":"01a0e316-...","kind":"build","cwd":"/tmp/grok-probe","currentModelId":"my-model"},
    "x.ai/memoryMode":"legacy"
  }
}}
```

此外 `session/new` 期间会连续推 9 条 `_x.ai/session/setup` 通知，`phase` 依次为：`auth`、`resolve_workspace`、`folder_trust`、`plugin_registry`、`mcp_merge`、`persistence_init`、`spawn_session_actor`、`git_discovery`、`finalize_response`、`tool_overrides`、`response_ready`。

### 3.4 `session/prompt`（含多轮）

请求：`{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"...","prompt":[{"type":"text","text":"Reply with exactly: hi"}]}}`

**同一个 `sessionId` 上连续发第二次 `session/prompt` 完全可行**（trace2 的 id=4），无需重建 session。两个响应：

```json
// 第 1 轮（id=3）
{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn","_meta":{
  "sessionId":"01a0e318-dba5-7201-871f-94c5eb735b1e",
  "requestId":"dd601a0d-6200-454d-8721-6d7ea88e209c",
  "promptId":"dd601a0d-6200-454d-8721-6d7ea88e209c",
  "totalTokens":30369,"modelId":"grok-4.7","inputTokens":29971,"outputTokens":398,
  "cachedReadTokens":1152,"reasoningTokens":397,
  "usage":{"inputTokens":29971,"outputTokens":398,"totalTokens":30369,"cachedReadTokens":1152,
    "cacheCreationTokens":0,"reasoningTokens":397,"modelCalls":1,"apiDurationMs":8184,
    "modelUsage":{"grok-4.7-build":{...same...,"apiDurationMs":8184}},"numTurns":1}}}}

// 第 2 轮（id=4，触发 read_file）
{"jsonrpc":"2.0","id":4,"result":{"stopReason":"end_turn","_meta":{
  "sessionId":"01a0e318-dba5-7201-871f-94c5eb735b1e",
  "requestId":"ef4be620-baf7-483d-b2cb-a48e1391ac2f","promptId":"ef4be620-...",
  "totalTokens":30068,"modelId":"grok-4.7","inputTokens":30047,"outputTokens":21,
  "cachedReadTokens":29952,"reasoningTokens":20,
  "usage":{"inputTokens":60063,"outputTokens":67,"totalTokens":60130,"cachedReadTokens":59904,
    "cacheCreationTokens":0,"reasoningTokens":44,"modelCalls":2,"apiDurationMs":6265,...,
    "numTurns":2}}}}
```

**关键语义差异（接入时必须注意）**：

- `_meta` 顶层的 `inputTokens/outputTokens/totalTokens/...` 是**本轮（turn）**的量；
- `_meta.usage` 是**整个 session 的累计量**（第 2 轮 `inputTokens` 从 29971 跳到 60063，`modelCalls` = 2，`numTurns` = 2）。
- `_meta.modelId` 是真实模型（`grok-4.7`），而 `modelUsage` 的 key 是 agent profile 名（`grok-4.7-build`）。

### 3.5 工具调用与流式事件（trace2 第 2 轮真实触发 `read_file`）

```json
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"...","update":{
  "sessionUpdate":"tool_call","toolCallId":"call-1250fc50-...-0","title":"read_file",
  "rawInput":{"target_file":"/tmp/grok-probe/hello.txt"},
  "_meta":{"x.ai/tool":{"version":1,"name":"read_file","kind":"read","namespace":"grok_build","label":"Read","read_only":true}}},
  "_meta":{"totalTokens":30062,"eventId":"...-81","agentTimestampMs":1790516479920,
    "promptId":"ef4be620-...","streamStartMs":1790516479473,"turnStartMs":1790516476072,
    "updateType":"ToolCall","updateParams":{...,"kind":"Other","status":"Pending"}}}}

{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"...","update":{
  "sessionUpdate":"tool_call_update","toolCallId":"call-1250fc50-...-0","kind":"read",
  "title":"Read `/tmp/grok-probe/hello.txt`","locations":[{"path":"/tmp/grok-probe/hello.txt"}],
  "rawInput":{"variant":"ReadFile","target_file":"/tmp/grok-probe/hello.txt"},...}}}

{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"...","update":{
  "sessionUpdate":"tool_call_update","toolCallId":"call-1250fc50-...-0","status":"completed",
  "content":[{"type":"content","content":{"type":"text","text":"1→hello\n"}}],
  "rawOutput":{"type":"ReadFile","FileContent":{"content":"1→hello\n","absolute_path":"/private/tmp/grok-probe/hello.txt","raw_output":"hello\n","total_lines":2}}}}}
```

- 工具事件有完整生命周期：`tool_call`（Pending）→ `tool_call_update`（InProgress，带 kind/title/locations）→ `tool_call_update`（completed，带结构化 `rawOutput`）。
- `tool_call_delta_chunk`（工具参数增量）走的是 `_x.ai/session_notification`，**不是** `session/update`：

```json
{"jsonrpc":"2.0","method":"_x.ai/session_notification","params":{"sessionId":"...","update":{
  "sessionUpdate":"tool_call_delta_chunk","tool_call_id":"call-1250fc50-...-0","tool_index":0,"name":"read_file","arguments_delta":""}}}
```

### 3.6 权限交互（重要，但证据是间接的）

本次配置为 `always-approve`，工具执行仍产生了权限交互事件，但**瞬间自解**：

```json
{"jsonrpc":"2.0","method":"_x.ai/session_notification","params":{"sessionId":"...","update":{
  "sessionUpdate":"pending_interaction","tool_call_id":"call-1250fc50-...-0","kind":"permission"}}}
{"jsonrpc":"2.0","method":"_x.ai/session_notification","params":{"sessionId":"...","update":{
  "sessionUpdate":"interaction_resolved","tool_call_id":"call-1250fc50-...-0"}}}
```

- 观测到的 `kind` 值是 `"permission"`；`ask_user_question` 工具应走同一个 `pending_interaction` 通道（`available_commands`/工具列表里有 `ask_user_question`），但**未实测**。
- 因为自动批准，**没有捕获到 server→client 的带 `id` 的权限请求**（ACP 标准方法是 `session/request_permission`）。要接入“需要用户确认”的场景，必须在非 auto-approve 配置下补测一次，或从源码确认方法名/字段。

### 3.7 进程生命周期

- `grok agent stdio` 完成 `session/prompt` 后**保持进程存活**（等下一轮 / 等新 session），不会自动退出；客户端必须显式关闭 stdin 或 kill。
- stdout 严格一行一个 JSON-RPC 消息；本次两次实测 stderr 均为 0 行（MCP 启动失败也只以 `_x.ai/mcp/server_status` 通知出现在 stdout）。

---

## 4. 字段结构归纳

### 4.1 headless `--output-format json`

| 字段 | 含义 | 备注 |
| --- | --- | --- |
| `text` | 最终回答正文 | |
| `thought` | 思维链全文 | 一次性整段，非增量 |
| `stopReason` | `end_turn` | |
| `sessionId` | session UUID | 可用于 `--resume` |
| `requestId` | 本轮请求 id | |
| `usage.*` | `input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` / `reasoning_tokens` / `total_tokens` | **snake_case**；本轮口径 |
| `num_turns` | 轮数 | |
| `modelUsage.<agentProfile>` | 按模型分组的 camelCase 计数 + `modelCalls` | key 是 `grok-4.7-build` |
| 耗时 / cost | **不存在** | |

### 4.2 headless `--output-format streaming-json`（NDJSON）

| `type` | 字段 | 说明 |
| --- | --- | --- |
| `available_commands` | `tools[]`, `commands[]` | 可重复多次；后出现的会包含新注册的 MCP 工具 |
| `thought` | `data` | 思维链增量 |
| `text` | `data` | 回答正文增量 |
| `usage` | `usage{input_tokens,...}` | 结束前一条 |
| `end` | `stopReason`, `sessionId`, `requestId`, `usage{}`, `num_turns`, `modelUsage{}` | 终态汇总，与 json 格式同构 |

### 4.3 ACP `grok agent stdio`（JSON-RPC 2.0 over stdio）

客户端 → 服务端（request）：`initialize`、`session/new`、`session/prompt`（实测）；`session/load`、`session/list`、`authenticate`、`session/cancel`、`session/close` 由能力声明可推断存在。

服务端 → 客户端（notification / response）实测到的 method：

| method | 载体 | 关键字段 |
| --- | --- | --- |
| `session/update` | 标准 ACP 通知 | `sessionUpdate` ∈ `available_commands_update` / `agent_thought_chunk` / `agent_message_chunk` / `session_info_update` / `tool_call` / `tool_call_update` |
| `_x.ai/session_notification` | xAI 私有通知 | `sessionUpdate` ∈ `hook_run_started` / `hook_execution` / `session_summary_generated` / `response_completed` / `turn_completed` / `last_turn_summary` / `pending_interaction` / `interaction_resolved` / `tool_call_delta_chunk` |
| `_x.ai/session/setup` | 建会话进度 | `method` + `phase` + `sessionId` |
| `_x.ai/sessions/changed` | 会话列表变更 | `upserted[]`（含 `cwd`/`modelId`/`yolo`/`activity`/`resident`/`lastChangeUnixMs`） |
| `_x.ai/queue/changed` | 提示队列 | `entries[]` / `runningPromptId` |
| `_x.ai/session/prompt_complete` | 轮次收尾 | `promptId`, `stopReason`, `agentResult` |
| `_x.ai/mcp/servers_updated` | MCP 列表 | `mcpServers[]`（name/source/type/command/args） |
| `_x.ai/mcp/init_progress` | MCP 进度 | `total` / `connected` / `elapsedMs`（`_x.ai/mcp_initialized`） |
| `_x.ai/mcp/server_status` | MCP 健康 | `status` / `reason` / `detail` / `tools` |

通知公共 `_meta`（几乎所有流式事件都带）：`eventId`、`agentTimestampMs`、`promptId`、`streamStartMs`、`turnStartMs`、`totalTokens`、`updateType`、`chunkId`。**这些时间戳是毫秒级 epoch**，可用于客户端做精确分段计时。

---

## 5. 统计信息可得性结论表

| 指标 | headless json | headless streaming-json | ACP stdio | 持久化（`grok usage`） |
| --- | --- | --- | --- | --- |
| session id | ✅ `sessionId` | ✅ `end.sessionId` | ✅ `session/new` 结果 + 各事件 | ✅ |
| request / prompt id | ✅ `requestId` | ✅ `end.requestId` | ✅ `requestId`/`promptId` | ➖ |
| model 名（真实） | ⚠️ 仅 `modelUsage` key（agent profile 名） | ⚠️ 同上 | ✅ `_meta.modelId`（`grok-4.7`） | ✅ `primaryModelId` |
| input / output tokens | ✅ | ✅ | ✅ 本轮 + 累计双口径 | ✅ 分轮 + 汇总 |
| cached read tokens | ✅ | ✅ | ✅ `cachedReadTokens` | ✅ |
| cache creation tokens | ✅（本次恒 0） | ✅ | ✅ | ✅ |
| reasoning tokens | ✅ | ✅ | ✅ | ✅ |
| model calls 次数 | ✅ `modelCalls` | ✅ | ✅ | ✅ |
| 轮数 | ✅ `num_turns` | ✅ | ✅ `numTurns` | ✅ `turnCount` + 分轮数组 |
| API 耗时（模型调用） | ❌ | ❌ | ✅ `usage.apiDurationMs`（例：8184 / 5972 / 6265 ms） | ❌（未持久化该字段） |
| 端到端耗时（含 MCP/工具） | ❌ | ❌ | ✅ `turn_completed.elapsed_ms`（例：20685 / 7856 / 21162 ms） | ❌ |
| 分段/事件级时间戳 | ❌ | ❌ | ✅ `_meta.agentTimestampMs`/`streamStartMs`/`turnStartMs`（ms epoch） | ➖ |
| hook / MCP 阶段耗时 | ❌ | ❌ | ✅ `hook_execution.runs[].status.elapsed_ms`、`_x.ai/mcp_initialized.elapsedMs` | ➖ |
| **cost / 金额** | ❌ | ❌ | ❌（协议侧有 `costUsdTicks` 字段，本机端点未返回） | ❌ |
| 工具调用明细 | ❌ | ❌ | ✅ tool_call / tool_call_update（含 `rawOutput`） | ➖ |
| 权限/交互事件 | ❌ | ❌ | ✅ `pending_interaction` / `interaction_resolved`（自动批准场景） | ➖ |

结论：**“token 用量 + 精确耗时”只能在 ACP（`grok agent stdio`）拿到完整版**——headless 的两种格式都只有 token、没有任何耗时。

---

## 6. 会话续接

### 6.1 headless `--resume`（实测，1 次调用）

```
$ time grok -p "Reply with exactly: bye" --resume 01a0e314-43bc-7a73-86cf-63626f37a2a9 --output-format json
（进程总耗时 9.60s）
```

```json
{
  "text": "bye",
  "stopReason": "end_turn",
  "sessionId": "01a0e314-43bc-7a73-86cf-63626f37a2a9",
  "requestId": "96c7b70b-2549-4ea7-99ef-307698836eca",
  "usage": {"input_tokens":176,"cache_read_input_tokens":29824,"cache_creation_input_tokens":0,"output_tokens":58,"reasoning_tokens":57,"total_tokens":30058},
  "num_turns": 1,
  "modelUsage": {"grok-4.7-build": {"inputTokens":176,"outputTokens":58,"cacheReadInputTokens":29824,"cacheCreationInputTokens":0,"modelCalls":1}}
}
```

- **sessionId 保持不变**，`cache_read_input_tokens` 从 1152 跳升到 29824 → 证明上一轮上下文被复用。
- `num_turns: 1` 指**本轮**轮数；会话级轮数是 2（见下）。
- 续接后 `grok usage <session>` 可看到分轮持久化记录：

```
turn 1 endedAt 2026-09-27T13:36:07.381492+00:00  input 29903  output 328  cached-read 1152  reasoning 327  total 30231
turn 2 endedAt 2026-09-27T13:40:12.010745+00:00  input 30000  output  58  cached-read 29824 reasoning  57  total 30058
session totals: input 59903 output 386 cachedRead 30976 reasoning 384 total 60289 modelCalls 2 turnCount 2 primaryModelId grok-4.7-build
```

### 6.2 ACP 多轮（实测）

同一 `grok agent stdio` 进程、同一 `sessionId` 上直接再发 `session/prompt` 即可（trace2 id=3 → id=4），无需 `session/load`。`session/new` 的 `_meta` 也声明了 `sessionCapabilities: {list, resume, close}` 且 `loadSession: true`，因此跨进程恢复应走 `session/load`（**未实测**）。

### 6.3 flag 语义（来自 `--help`）

- `-s/--session-id <UUID>`：**只为新建会话指定 id**，不能用于恢复；只有与 `--resume/--continue` 同时出现时且带 `--fork-session` 才合法（用于命名 fork）。
- `-r/--resume [<SESSION_ID_OR_TITLE>]`：按 ID 或标题恢复；UUID 形状的一定按 ID 解释；标题重名且无唯一重命名时判定为歧义并失败。
- `-c/--continue`：继续当前目录最近一次会话。
- `--fork-session`：恢复时新建 session id。
- `--restore-code`：恢复时还原仓库快照（远程会话需 `--worktree`）。

---

## 7. 耗时度量（实测值）

| 场景 | 进程总耗时（`time`） | JSON 内部计时 |
| --- | --- | --- |
| `-p` + `--output-format json` | 17.58s | 无 |
| `-p` + `--output-format streaming-json` | 15.72s | 无 |
| `-p` + `--resume` + json | 9.60s | 无 |
| `grok agent stdio` 握手→prompt 完成 | initialize 0.42s / session/new 3.34s / 首 token 20.92s / prompt 结果 24.71s | `turn_completed.elapsed_ms = 21162`；`usage.apiDurationMs = 5972` |
| ACP 第 1 轮（trace2） | 脚本内 prompt 返回即结束 | `elapsed_ms = 20685`；`apiDurationMs = 8184` |
| ACP 第 2 轮（trace2，含 read_file） | 同上 | `elapsed_ms = 7856`；`apiDurationMs = 6265` |

可用的分层计时：

- `usage.apiDurationMs`：仅模型 API 调用时长（本轮）。
- `turn_completed.elapsed_ms`：整轮 agent 侧时长（含工具、MCP、hook）。
- `_meta.turnStartMs` / `streamStartMs` / `agentTimestampMs`：绝对 ms 时间戳，可自行算 delta。
- `hook_execution.runs[].status.elapsed_ms`：单个 hook 耗时（例：165 / 137 / 71 ms）。
- `_x.ai/mcp_initialized.elapsedMs`：MCP 冷启动总耗时（本次 6134 ms）——这是首 token 延迟的主要来源之一。

首次运行有显著的 MCP 冷启动成本（本次 `zai-mcp-server` 就绪约 5s，`websearch`/`webfetch` 反复握手失败并重试 3 次，持续到 48s 才彻底放弃）。

---

## 8. 失败与不确定项

| 项 | 状态 | 证据 / 说明 |
| --- | --- | --- |
| cost / 金额统计 | ❌ 不可得（当前端点） | 所有结构化输出 grep 无 cost 字段；`grok usage` 也只有 token。疑与第三方 base_url 缺价格表有关，**未用官方端点验证** |
| `authenticate` 调用 | 未实测 | config 有 api_key，`initialize` 后直接 `session/new` 成功，未走认证 |
| 权限请求的具体 JSON-RPC 方法 | 未实测 | `always-approve` 导致 `pending_interaction(kind=permission)` 立即 resolves；真实 `session/request_permission` 需关闭自动批准再测 |
| `session/load` 跨进程恢复 | 未实测 | 仅由 `loadSession:true` + `sessionCapabilities.resume` 推断 |
| `session/list` / `session/cancel` / `session/close` | 未实测 | 仅能力声明（`sessionCapabilities`） |
| `--json-schema` 结构化输出 | 未实测 | help 说明存在，未消耗调用验证 |
| `streaming-messages-json`（Anthropic wire format） | 未实测 | 未消耗调用验证；`--include-partial-messages` 只影响该格式 |
| `grok agent serve`（WebSocket, 默认 127.0.0.1:2419） | 未实测 | 仅 help；有 `--secret`/`GROK_AGENT_SECRET` |
| `grok agent headless`（WS relay） | 未实测 | 需要 `GROK_WS_URL` 之类远端中继 |
| MCP server 健康 | 环境问题 | `websearch`/`webfetch` 的 `command: "ept"` 握手失败（`connection closed: initialize response`），重试 3 次后 `exhausted`。这是本机 MCP 环境问题，不影响协议结论 |
| `thought` 字段膨胀 | 风险 | json 模式把整段思维链塞进单对象；长任务下输出体积会很大 |

---

## 9. 对 RedWhisk 接入的直接启示（供父 Agent 汇总，非结论性建议）

1. **有等价于 Codex app-server 的通道**：`grok agent stdio` = ACP JSON-RPC over stdio，能覆盖 initialize / 新建会话 / 多轮 prompt / 工具事件 / 权限交互 / 用量与耗时，且实测稳定输出纯 NDJSON。
2. **统计信息比 Codex 更细**：ACP 下同时有本轮 + 累计 token、`apiDurationMs`、`elapsed_ms`、事件级 ms 时间戳。monetary cost 在本机（第三方 `base_url`）所有结构化输出中都**没有出现**；但源码侧存在 `costUsdTicks` / `costIsPartial` 字段（见 [grok-build-acp-protocol-notes.md](./grok-build-acp-protocol-notes.md) §4.3），故更可能是**端点未提供价格表**而非协议不支持（未用 xAI 官方端点验证）。
3. **“只想拿 JSON 不想跑长驻进程”也有轻量方案**：`-p --output-format json`（一次性）或 `streaming-json`（NDJSON 增量），代价是**没有任何耗时字段**。
4. **注意两套格式不等价**：`streaming-json` 的 `type` 集合 ≠ ACP `session/update`；前者是 headless 投影。若目标是“对标 app-server”，应直接对接 `grok agent stdio` 的 ACP 事件流。
5. **实现细节坑**：`agent stdio` 不走退出；`available_commands` 会重复推送；工具增量走 `_x.ai/session_notification`；`session/new` 期间有 9 条 setup 进度通知 + MCP 冷启动（可达 5s+）；所有这些都需要在客户端做幂等与状态机处理。

---

## 附录 A：复现脚本（ACP stdio 采集）

用于重新采集 `grok agent stdio` 的握手 / 多轮 prompt / 工具调用报文。运行后 trace 落在 `<OUT>`，每行形如 `{"dir":"->"|"<-"|"stderr","t":<秒>,"msg":<原始 JSON 或错误>}`。

```python
#!/usr/bin/env python3
"""grok agent stdio 采集：initialize -> session/new -> 两轮 session/prompt。"""
import json, subprocess, threading, time

OUT = "acp-trace.ndjson"          # 输出 trace 路径
CWD = "/tmp/grok-probe"           # 工作目录（需存在）
T0 = time.time()
state = {"sid": None}
done = set()                      # 已收到 result 的请求 id

def log(obj):
    with open(OUT, "a") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")

proc = subprocess.Popen(
    ["grok", "agent", "stdio"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, bufsize=1,
)

def send(msg):
    log({"dir": "->", "t": round(time.time() - T0, 3), "msg": msg})
    proc.stdin.write(json.dumps(msg) + "\n")
    proc.stdin.flush()

def on_msg(msg):
    if not isinstance(msg, dict) or "result" not in msg:
        return
    if msg.get("id") == 2:
        state["sid"] = (msg["result"] or {}).get("sessionId")
    done.add(msg.get("id"))

def reader(stream, tag, cb=None):
    for line in stream:
        s = line.rstrip("\n")
        if not s.strip():
            continue
        try:
            parsed = json.loads(s)
        except Exception:
            parsed = {"_raw": s[:3000]}
        log({"dir": tag, "t": round(time.time() - T0, 3), "msg": parsed})
        if cb:
            cb(parsed)

threading.Thread(target=reader, args=(proc.stdout, "<-", on_msg), daemon=True).start()
threading.Thread(target=reader, args=(proc.stderr, "stderr"), daemon=True).start()

send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": 1,
    "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False}},
    "clientInfo": {"name": "redwhisk-probe", "version": "0.0.1"}}})
time.sleep(2)

send({"jsonrpc": "2.0", "id": 2, "method": "session/new",
      "params": {"cwd": CWD, "mcpServers": []}})
for _ in range(60):
    if state["sid"]:
        break
    time.sleep(0.5)
if not state["sid"]:
    proc.kill()
    raise SystemExit("NO_SESSION_ID")

def prompt(id_, text, wait_s):
    send({"jsonrpc": "2.0", "id": id_, "method": "session/prompt", "params": {
        "sessionId": state["sid"], "prompt": [{"type": "text", "text": text}]}})
    deadline = time.time() + wait_s
    while time.time() < deadline:
        if id_ in done:
            return True
        time.sleep(0.5)
    return False

print("P1", prompt(3, "Reply with exactly: hi", 90))
time.sleep(2)
print("P2", prompt(4, f"Use the read_file tool to read {CWD}/hello.txt, then reply with its contents only.", 120))
time.sleep(3)

proc.terminate()   # agent stdio 完成一轮后不会自行退出，必须显式结束
time.sleep(1)
proc.kill()
print("ELAPSED", round(time.time() - T0, 3), "SESSION_ID", state["sid"])
```

注意（实测结论，采集前须知）：

1. 每轮 `session/prompt` 会真实消耗 token；脚本中的 prompt 已尽量短。
2. 冷启动有明显延迟：MCP 初始化实测 `elapsedMs ≈ 6000`，首 token 可达 15–20s。
3. 若本机 MCP server 有异常（本次 `websearch` / `webfetch` 握手失败并重试），启动阶段会被拖长，但不影响协议结论。
