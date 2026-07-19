# AI 编程 Agent 结构化输出能力调研

本文件回答一个问题：市面上常见的 AI 编程 Agent，是否像 OpenAI Codex CLI 那样提供机器可读的「结构化输出」协议（JSON / JSONL / JSON-RPC / MCP 事件流），让外部程序可以逐条事件解析并做自定义转换，还是只输出 TUI / 终端 ANSI 文本无法干净解析。姊妹文件 `agent-session-output-analysis.md` 讲的是「会话输出归一化」的竞品对比，本文件是「各 Agent 输出格式能力清单」，角度互补，不重复其内容。

判定标记：

- **CAN**：提供官方、文档化（或源码可证）的非交互结构化输出协议，外部程序可像 Codex 一样干净解析。
- **PARTIAL**：实际能拿到结构化数据，但 schema 未文档化、字段不完整或无稳定性承诺，外部消费者需要容忍变动。
- **CANNOT**：仅 TUI / 终端 ANSI 文本，或产物形态根本不是 agent 事件流，无法干净解析。

## 结论摘要表

| Agent | 结构化输出模式 | 关键 flag / 机制 | 主要来源 | 判定 | 备注 |
| --- | --- | --- | --- | --- | --- |
| OpenAI Codex CLI（基准） | JSONL + JSON-RPC + 落盘 jsonl | `codex exec --json`、`codex app-server`、`~/.codex/sessions/**/rollout-*.jsonl` | [app-server/README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)、[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) | **CAN** | 三套互补，含 `generate-ts` / `generate-json-schema` |
| Anthropic Claude Code（基准） | NDJSON stream + Agent SDK | `claude -p --output-format stream-json --include-partial-messages`、`@anthropic-ai/claude-agent-sdk` | [headless 文档](https://code.claude.com/docs/en/headless)、[claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript) | **CAN** | CLI 闭源；stream-json type 枚举文档不完整 |
| OpenCode（sst/opencode） | NDJSON + ACP JSON-RPC + SDK | `opencode run --format json`、`opencode acp`、`opencode serve` | [CLI 文档](https://opencode.ai/docs/cli/)、[ACP 文档](https://opencode.ai/docs/acp/) | **CAN** | ACP 是社区开放协议 |
| Grok Build（xAI `grok`） | JSON / streaming-json + ACP JSON-RPC | `grok -p --output-format streaming-json`、`grok agent stdio` | [Headless scripting](https://docs.x.ai/build/cli/headless-scripting)、[Build overview](https://docs.x.ai/build/overview) | **CAN** | CLI 闭源，仅有文档级证据 |
| Google Gemini CLI | JSON / stream-json | `gemini -p --output-format stream-json` | [headless 文档](https://geminicli.com/docs/cli/headless/)、[源码 config.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/config/config.ts) | **CAN** | 与 Codex 同形态；stream-json 自 v0.11.0 |
| Qwen Code（QwenLM/qwen-code） | JSON / stream-json | `qwen -p --output-format stream-json` | [headless 文档](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/)、[config.ts](https://github.com/QwenLM/qwen-code/blob/main/packages/core/src/config/config.ts) | **CAN** | fork 自 gemini-cli，schema 与 Gemini 等价 |
| Sourcegraph Amp | NDJSON + 双向 stream-json | `amp -x --stream-json`、`--stream-json-input` | [Manual Appendix](https://ampcode.com/manual/appendix)、[Streaming JSON 公告](https://ampcode.com/news/streaming-json) | **CAN** | 显式声明 Claude Code compatible |
| Cursor CLI | NDJSON + 偏移 delta | `cursor agent --print --output-format stream-json --stream-partial-output` | [output-format 文档](https://cursor.com/docs/cli/reference/output-format) | **CAN** | 有前向兼容承诺 |
| Block Goose（aaif-goose/goose） | NDJSON + ACP JSON-RPC | `goose run --output-format stream-json`、`goose acp`、`goose serve` | [cli.rs](https://github.com/aaif-goose/goose/blob/main/crates/goose-cli/src/cli.rs)、[CLI 命令](https://goose-docs.ai/docs/guides/goose-cli-commands) | **CAN** | 与 Codex 双模式最完整对齐 |
| Continue（`cn`） | NDJSON + MCP server | `cn --json`、`cn --headless`、MCP server 模式 | [CLI 文档](https://docs.continue.dev/guides/cli) | **CAN** | 事件 `task:*`；payload 字段文档偏枚举层 |
| Cline | NDJSON | `cline --json --yolo` | [CLI reference](https://docs.cline.bot/cli/cli-reference)、[Issue #6996](https://github.com/cline/cline/issues/6996) | **CAN** | payload 字段未完整文档化 |
| Charm Crush（charmbracelet/crush） | JSONL（继承自 opencode） | `crush run --format json` | [Issue #2412](https://github.com/charmbracelet/crush/issues/2412) | **PARTIAL** | flag 未文档化，字段仍在补全 |
| Aider（Aider-AI/aider） | 无 | 无 `--json` / `--output-format` | [options.html](https://aider.chat/docs/config/options.html#output-settings)、[Issue #1355](https://github.com/Aider-AI/aider/issues/1355) | **CANNOT** | 作者公开反对「代码塞 JSON」 |
| Roo Code（RooCodeInc/Roo-Code） | 无（仅 basic CLI shim） | 无 `--json` flag | [CHANGELOG](https://github.com/RooCodeInc/Roo-Code/blob/main/CHANGELOG.md)、[Issue #3835](https://github.com/RooCodeInc/Roo-Code/issues/3835) | **CANNOT** | 仓库 2026-05-15 归档停更 |
| Simon Willison `llm`（simonw/llm） | 仅响应对象 JSON Schema | `llm --schema` | [schemas 文档](https://llm.datasette.io/en/stable/schemas.html) | **CANNOT** | 非 coding agent，无事件流 |
| OpenClaw（openclaw/openclaw） | IM 渠道消息流 | 非编程 agent | [openclaw.ai](https://openclaw.ai)、[openclaw/openclaw](https://github.com/openclaw/openclaw) | **不适用** | 见「Open Claw 名称歧义查证」 |

CAN 11 款、PARTIAL 1 款、CANNOT 3 款、不适用 1 款（共 16 行，含基准与歧义项）。

## 逐款详述

### OpenAI Codex CLI（基准）

- **仓库/官网**：https://github.com/openai/codex ｜ Rust 实现 `codex-rs/` ｜ 官方文档 https://learn.chatgpt.com/docs/non-interactive-mode
- **1. 非交互 / headless 模式**：是。两条路径：`codex exec "<prompt>"` 单 turn 一次性执行；`codex app-server` 长驻状态化进程驱动多 turn 对话。来源：[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)、[codex-rs/app-server/README.md](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)。
- **2. 结构化输出机制**：三套互补，全部 JSONL / JSON-RPC：
  - `codex exec --json`：stdout 变成 JSON Lines 事件流，事件类型 `thread.started` / `turn.started` / `turn.completed` / `turn.failed` / `item.*` / `error`；item 子类型含 `agent_message` / `reasoning` / `command_execution` / `file_change` / `mcp_tool_call` / `web_search` / `plan`。来源：[Non-interactive mode「Sample JSON stream」段](https://learn.chatgpt.com/docs/non-interactive-mode)。
  - `codex app-server`（stdio JSON-RPC 2.0）：协议、notification、server-initiated request 全部定义在 [codex-rs/app-server/README.md](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)（2397 行单文件）；transport 默认 stdio newline-delimited JSON，可通过 `--listen ws://IP:PORT` / `unix://PATH` / `off` 切换。核心 notification 含 `thread/started` `turn/started` `turn/completed` `item/started` `item/completed` `item/agentMessage/delta` `item/commandExecution/outputDelta` `item/fileChange/patchUpdated` `item/reasoning/*` `thread/tokenUsage/updated` 等。
  - rollout 文件（落盘 JSONL）：每次会话自动写入 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`，与会话同生命周期。来源：GitHub Issue [#2288](https://github.com/openai/codex/issues/2288)、Discussion [#3827](https://github.com/openai/codex/discussions/3827)。
- **3. Schema 文档化与稳定度**：官方提供命令 `codex app-server generate-ts --out DIR` 与 `codex app-server generate-json-schema --out DIR`，导出 TS / JSON Schema 与当前 Codex 版本逐字一致；非 experimental 部分（去掉 `--experimental` flag）即稳定表面。`exec --json` 字段精确性有维护滞后（[Issue #4776](https://github.com/openai/codex/issues/4776)，docs 与 v0.44.0 实际 `item_type` 不一致）。WebSocket transport 与大量方法标注 `experimental`，需 `initialize.params.capabilities.experimentalApi = true` opt-in。
- **4. 判定**：**CAN** —— Codex 是本调研的基准本身。`app-server` 定义完整 JSON-RPC notification 协议（含源码级 README），`codex exec --json` 提供 stdout JSONL 事件流，rollout 文件自动落盘。
- **备注**：Rust 重写已完成（Discussion [#1174](https://github.com/openai/codex/discussions/1174)），`codex-rs/` 是现役实现；实战以源码为准，官方 learn docs 偶尔滞后于实际输出。

### Anthropic Claude Code（基准）

- **仓库/官网**：CLI（闭源 npm 包 `@anthropic-ai/claude-code`）文档 https://code.claude.com/docs/en/headless ｜ Agent SDK TypeScript https://github.com/anthropics/claude-agent-sdk-typescript ｜ Agent SDK Python https://github.com/anthropics/claude-agent-sdk-python
- **1. 非交互 / headless 模式**：是。`claude -p "<prompt>"`（`--print`）进入 headless；`--bare` 进一步跳过 hooks / skills / MCP / CLAUDE.md 自动加载。来源：[headless 文档](https://code.claude.com/docs/en/headless)。
- **2. 结构化输出机制**：
  - CLI flag `--output-format`：三选一 `text` / `json` / `stream-json`。`stream-json` 输出 NDJSON，配合 `--verbose` 与 `--include-partial-messages` 拿到 token 级增量。事件类别含 `system/init`（capabilities、model、tools、mcp、plugins）、`system/api_retry`、`assistant` / `user`（含 `parent_tool_use_id` 区分 subagent）、`result`（终态，含 `total_cost_usd` 与 per-model cost）。
  - `--json-schema`：与 `--output-format json` 联用，把响应包成 `{ ..., structured_output: <符合 schema 的对象> }`。
  - `--input-format stream-json`：唯一可双向程序化驱动 Claude Code 的 stdin 通道（[Issue #24594](https://github.com/anthropics/claude-code/issues/24594)）。
  - Claude Agent SDK：把 CLI 同款 agent loop 暴露为库，`query()` 接受 `outputFormat` JSON Schema 与原生 message 对象。
- **3. Schema 文档化与稳定度**：CLI `--output-format` 三档在官方 headless 文档长期稳定，未标注 experimental；但 stream-json 事件 `.type` 的完整 schema 文档被官方 issue 点名为不完整：[#24612](https://github.com/anthropics/claude-code/issues/24612)、[#24594](https://github.com/anthropics/claude-code/issues/24594)。CLI 本体闭源，无法给源码行号；Agent SDK 开源。
- **4. 判定**：**CAN** —— `claude -p --output-format stream-json --include-partial-messages --verbose` 给出 NDJSON 事件流，外加 `--json-schema` 约束最终输出、Agent SDK 暴露 typed message 对象。唯一短板是 stream-json 的完整 type 枚举没有一份官方「schema 单页」。
- **备注**：当前稳定线为 v2.1.x（2026-07）；能力探测用 `system.init.capabilities` 数组，不要靠版本号字符串比较；历史 alias `--json`（deprecated）→ `--output-format json`，`@anthropic-ai/claude-code` SDK 已更名为 `@anthropic-ai/claude-agent-sdk`（[Migration guide](https://code.claude.com/docs/en/agent-sdk/migration-guide)）。

### OpenCode（sst/opencode）

- **仓库/官网**：https://github.com/sst/opencode ｜ https://opencode.ai ｜ [CLI 文档](https://opencode.ai/docs/cli/)
- **1. 非交互 / headless 模式**：是。三种 headless 通道：`opencode run "<prompt>"`（单次非交互）、`opencode serve`（HTTP headless server）、`opencode acp`（stdio subprocess）。来源：[CLI 文档](https://opencode.ai/docs/cli/)。
- **2. 结构化输出机制**：
  - `opencode run --format json`：raw JSON events 写入 stdout；`--format` 枚举 `default | json`。
  - `opencode acp`：**Agent Client Protocol**（JSON-RPC 2.0 over stdio nd-JSON），直接对应 Codex `app-server`。来源：[ACP 文档](https://opencode.ai/docs/acp/)。
  - `opencode serve`：HTTP server 配合官方 JS/TS SDK（`opencode-ai`，SSE 事件流）和 Go SDK（`github.com/sst/opencode-sdk-go`）。
- **3. Schema 文档化与稳定度**：官方文档化、稳定，未被标 experimental。ACP 是社区开放协议（https://github.com/agentclientprotocol/agent-client-protocol），被 Zed / JetBrains / Neovim 原生支持。注意 `--format json` 输出事件流但**无强 JSON Schema 约束**，schema-constrained output 仍是 open feature request（[issue #10456](https://github.com/sst/opencode/issues/10456)、[#9320](https://github.com/sst/opencode/issues/9320)）。已知 bug：`--format json` 与 `--command` 同用时 JSON 会丢失（[issue #2923](https://github.com/sst/opencode/issues/2923)）。
- **4. 判定**：**CAN** —— 同时提供 `--format json`（对应 `codex exec --json`）和 `opencode acp`（对应 `codex app-server` 的 stdio JSON-RPC），外加 SDK。
- **备注**：docs 更新 2026-07-17。注意区分同名项目：`github.com/anomalyco/opencode` 是 mirror/fork 命名空间。

### Grok Build（xAI，CLI 命令 `grok`）

- **仓库/官网**：https://x.ai/cli ｜ [发布公告](https://x.ai/news/grok-build-cli) ｜ 文档 https://docs.x.ai/build/overview ｜ [CLI 文档](https://docs.x.ai/build/cli/headless-scripting)
- **1. 非交互 / headless 模式**：是。`grok -p "<prompt>"`（`-p` / `--single`）单次 headless 执行；`--no-alt-screen` 可在非 TUI 行内运行。
- **2. 结构化输出机制**：三层全覆盖，与 Codex 完全对齐：
  - `grok -p "..." --output-format json`：一次性 JSON 对象。
  - `grok -p "..." --output-format streaming-json`：newline-delimited JSON 事件流，等价 `codex exec --json`。
  - `grok agent stdio`：**ACP over JSON-RPC on stdin/stdout**，等价 `codex app-server`。官方文档给出完整的 Node.js `spawn("grok", ["agent", "stdio"])` + JSON-RPC `initialize` / `authenticate` / `session/new` / `session/prompt` / `session/update` 示例。
  - 来源：[Headless scripting](https://docs.x.ai/build/cli/headless-scripting) 的 Headless mode / Output formats / ACP 三段；[Build overview](https://docs.x.ai/build/overview) 有 `grok -p "Explain the architecture" --output-format streaming-json` 原文示例。
- **3. Schema 文档化与稳定度**：官方文档化、稳定，未被标 experimental。flag 表格（`-p/--single`、`-m/--model`、`-s/--session-id`、`-r/--resume`、`-c/--continue`、`--cwd`、`--output-format`、`--always-approve`、`--no-alt-screen`、`--no-auto-update`）全部列在 [Headless scripting](https://docs.x.ai/build/cli/headless-scripting)。ACP 走标准 JSON-RPC 2.0。xAI 未公开 CLI 源码（grok 二进制闭源），属「文档声称」级别，非「源码可证」。
- **4. 判定**：**CAN** —— `--output-format streaming-json` 与 `grok agent stdio` 一一对应 Codex 的 `exec --json` 与 `app-server`。
- **备注**：产品名 "Grok Build"，CLI 命令 `grok`，社区讨论出现的 "Grok Code" 是误称；CLI 由 `curl -fsSL https://x.ai/cli/install.sh | bash` 分发。开源替代有社区 `superagent-ai/grok-cli`（仅接 xAI API，非官方）。

### Google Gemini CLI

- **仓库/官网**：https://github.com/google-gemini/gemini-cli ｜ [官方文档](https://geminicli.com/docs/cli/headless/)
- **1. 非交互 / headless 模式**：是。非 TTY 环境或使用 `--prompt`/`-p` 触发。源码 `packages/cli/src/nonInteractiveCli.ts` 承载 headless 主循环。
- **2. 结构化输出机制**：`--output-format`（别名 `-o`）取值 `text | json | stream-json`。
  - `--output-format json`：输出单个 JSON 对象，schema 为 `response`（string）+ `stats`（object）+ 可选 `error`。
  - `--output-format stream-json`：NDJSON 事件流，事件类型 `init` / `message` / `tool_use` / `tool_result` / `error` / `result`。
  - 解析与校验逻辑在 [config.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/config/config.ts)（`!['text', 'json', 'stream-json'].includes(outputFormat)`）和 [nonInteractiveCli.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/nonInteractiveCli.ts)。
- **3. Schema 文档化与稳定度**：官方文档化、stable，未标 experimental。headless 文档列出 JSON schema 字段、stream-json 事件类型、exit codes（0/1/42/53）。版本锚点：`json` 自 v0.6.1（[PR #8022](https://github.com/google-gemini/gemini-cli/issues/8022)，2025-09），`stream-json` 自 v0.11.0（2025-10-20，[CHANGELOG](https://geminicli.com/docs/changelogs/)）。文档页脚 `Last updated: Mar 10, 2026`。
- **4. 判定**：**CAN** —— 与 Codex `--json` / `app-server` 等价，提供 NDJSON 事件流和单 JSON 两种 schema，源码、文档、稳定版本号齐全。
- **备注**：[官方 headless 文档](https://geminicli.com/docs/cli/headless/) 顶部 banner 提示 unpaid tier 与 Google One 账号将在 2026-06-18 由 Antigravity CLI 接管，后续 schema 是否平移需关注。

### Qwen Code（QwenLM/qwen-code）

- **仓库/官网**：https://github.com/QwenLM/qwen-code ｜ [headless 文档](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/)
- **1. 非交互 / headless 模式**：是。`--prompt`/`-p`、stdin 管道、`--continue`/`--resume` 复用 session。
- **2. 结构化输出机制**：`--output-format`（别名 `-o`）取值 `text | json | stream-json`；另有 `--input-format text | stream-json`（双向）与 `--include-partial-messages`（partial 事件：`message_start` / `content_block_delta`）。
  - `--output-format json`：会话结束输出一个 JSON 数组，元素类型 `system`(subtype=`session_start`) / `assistant` / `result`(subtype=`success`)。
  - `--output-format stream-json`：NDJSON，按 `system` / `assistant` / `result` 逐行实时发出。
  - 来源：[headless 文档](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/#output-formats)、[config.ts](https://github.com/QwenLM/qwen-code/blob/main/packages/core/src/config/config.ts)、[CHANGELOG](https://github.com/QwenLM/qwen-code/blob/main/CHANGELOG.md)。
- **3. Schema 文档化与稳定度**：官方文档化、stable。headless 文档给出每个字段（`type`/`subtype`/`uuid`/`session_id`/`message`/`usage`/`duration_ms`/`is_error`/`result`）和示例 JSON，exit codes 0/1/42/53/55。CHANGELOG 显示 `--output-format json|stream-json` 自 v0.2.0（2025-08-15）起加入；[issue #795](https://github.com/QwenLM/qwen-code/issues/795) 官方回复补充 stream-json 自 v0.3.0 起稳定。`--input-format stream-json` 标注「currently under construction, intended for SDK integration」（[issue #2044](https://github.com/QwenLM/qwen-code/issues/2044)），双向协议尚未完全稳定，单向 stream-json 已稳定。
- **4. 判定**：**CAN** —— fork 自 gemini-cli，继承同一套 NDJSON 协议；schema 官方文档化、版本化、非 experimental。
- **备注**：与 Gemini CLI 几乎同构（事件类型 / exit codes 一一对应，额外多出 `--max-wall-time`/`--max-tool-calls` 等 budget flag 与 exit code 55 的 `FatalBudgetExceededError`）。文档页脚 `publishedTime: 2026-07-02`。

### Sourcegraph Amp

- **仓库/官网**：https://ampcode.com ｜ npm `@ampcode/cli`（原 `@sourcegraph/amp`）
- **1. 非交互 / headless 模式**：是。`amp -x "<prompt>"` / `amp --execute "<prompt>"` 单轮执行后退出；重定向 stdout 自动进入 execute 模式；`AMP_API_KEY` 用于 CI。
- **2. 结构化输出机制**：`--stream-json`（必须配合 `--execute`），stdout 输出 NDJSON（每行一个 JSON 对象），事件含 `system/init`、`user`、`assistant`、`result`；`--stream-json-input` 接收 stdin 结构化输入（支持多轮对话 + 图片 + `steer` 字段）；`--stream-json-thinking` 额外输出 thinking 块。完整 TypeScript schema 与多段示例（含工具调用、subagent `parent_tool_use_id`、多轮对话）在 [Manual Appendix](https://ampcode.com/manual/appendix)。
- **3. Schema 文档化与稳定度**：官方文档完整文档化，并显式声明 "Amp's CLI supports Claude Code compatible stream JSON output format"（即对标 Claude Code 的 NDJSON 事实标准）。未标注 experimental；`--stream-json-thinking` 单独说明 "extends the schema and is not Claude Code compatible"。
- **4. 判定**：**CAN** —— 官方文档化的 `--stream-json` NDJSON 输出，schema 完整、显式兼容 Claude Code 格式，配合 `--stream-json-input` 可做多轮对话与 subagent，等价于 Codex `codex exec --json` 的可解析能力。
- **备注**：schema 在 2025 年随 [Streaming JSON 公告](https://ampcode.com/news/streaming-json) 落地，文档持续更新至本月；与 Claude Code stream-JSON 同源，可复用 parser。

### Cursor CLI（Cursor Agent CLI）

- **仓库/官网**：https://cursor.com/cli（独立 CLI，npm 分发，IDE-independent）
- **1. 非交互 / headless 模式**：是。`cursor agent --print`（`-p`）进入 headless 单次执行；non-TTY stdout 或管道 stdin 时自动推断 print 模式。
- **2. 结构化输出机制**：`--output-format text|json|stream-json` 配合 `--print`。`json` 输出单个结果对象；`stream-json` 输出 NDJSON 事件流，事件含 `system/init`、`user`、`assistant`、`tool_call`（`started` / `completed`）、`result`；`--stream-partial-output` 进一步开启字符级实时 delta（三种 assistant 子事件及其 `timestamp_ms` / `model_call_id` 去重规则文档化）。来源：[output-format 文档](https://cursor.com/docs/cli/reference/output-format)。
- **3. Schema 文档化与稳定度**：官方文档完整文档化；明确 "Field additions may occur over time in a backward-compatible way (consumers should ignore unknown fields)"（前向兼容承诺），`thinking` 事件在 print 模式被抑制。未标注 experimental。
- **4. 判定**：**CAN** —— 官方文档化的 `--output-format stream-json` NDJSON 输出，schema 完整、有前向兼容承诺、含完整 tool_call 生命周期事件。
- **备注**：社区论坛有 `cursor agent -p` hang 不返回的 bug 报告与 Linux ARM64 安装 403 报告，属实现稳定性 / 分发问题，不影响 schema 可解析性判定。

### Block Goose（aaif-goose/goose）

- **仓库/官网**：https://github.com/aaif-goose/goose（原 `block/goose`，51.3k stars，`block/goose` URL 现重定向至 AAIF）｜ [CLI 文档](https://goose-docs.ai/docs/guides/goose-cli-commands)
- **1. 非交互 / headless 模式**：是。`goose run -t "<prompt>"` / `goose run -i <file>` / `goose run --no-session` 原生支持非交互运行；`-q/--quiet` 仅输出模型响应；`--max-turns`、`--max-tool-calls` 用于自动化限流。
- **2. 结构化输出机制**：
  - `goose run --output-format <FORMAT>`，`FORMAT` ∈ `text | json | stream-json`（`json` = 跑完后一次性输出完整 JSON；`stream-json` = 实时 JSON Lines 事件流）。源码定义 [crates/goose-cli/src/cli.rs](https://github.com/aaif-goose/goose/blob/main/crates/goose-cli/src/cli.rs) 的 `OutputOptions`，`value_parser = clap::builder::PossibleValuesParser::new(["text", "json", "stream-json"])`。
  - `goose acp`：stdio 启动 **Agent Client Protocol**（ACP）server，基于 JSON-RPC 2.0 over stdio，类比 LSP。
  - `goose serve`：HTTP/WebSocket 版本的 ACP server（支持 TLS、CORS、secret key 鉴权）。
  - `goose mcp <name>`：运行内置 MCP server。
- **3. Schema 文档化与稳定度**：官方文档 GA 级（非 experimental），与 Claude Code `--output-format` 直接对齐；ACP 协议是跨厂商开放标准（JSON-RPC 2.0）。[Issue #4419](https://github.com/aaif-goose/goose/issues/4419)（已关闭、已实现）是该 flag 的特性请求来源。
- **4. 判定**：**CAN** —— `--output-format stream-json` 与 Codex `exec --json` 完全同形态；外加 `goose acp`（JSON-RPC stdio server）与 Codex `app-server` 同形态，是与 Codex 双模式对齐最完整的一款。
- **备注**：仓库已从 `block/goose` 迁移至 AAIF，引用源码时用新 URL；`block/goose` 链接 GitHub 会自动跳转。

### Continue（`cn`）

- **仓库/官网**：扩展主仓 https://github.com/continuedev/continue ｜ 独立 CLI 仓 https://github.com/continuedev/cli ｜ npm `@continuedev/cli`（命令名 `cn`）｜ [CLI 文档](https://docs.continue.dev/guides/cli)
- **1. 非交互 / headless 模式**：是。三种运行模式：TUI（默认）、headless、MCP server。Headless 触发方式：stdin 管道（`cn < task.txt`）或 `--headless` flag。
- **2. 结构化输出机制**：`cn --json "..."` 产出结构化事件流（JSON Lines / NDJSON），事件 `type` 包括 `task:started` / `task:completed` / `task:error` / `task:cancelled` / `task:delta`；`cn resume [task id]` 可从 JSON 输出中拿到的 taskId 续跑。MCP server 模式下 `cn` 可作为 MCP server 供其他 agent 调用（`cn` 既是 MCP client 也可被作为 server 驱动）。
- **3. Schema 文档化与稳定度**：官方文档列出事件类型枚举，但每种 `type` 的 payload 字段细节未完整给出（文档原文："payload structure varies by event type"）。npm 最新版 1.5.47（2026-07-01 发布），非 experimental 标注，但 schema 偏事件类型枚举层。
- **4. 判定**：**CAN** —— `cn --json` 提供与 Codex `exec --json` 同形态的 NDJSON 事件流 + headless + MCP server 三合一。
- **备注**：注意 `continuedev/continue`（扩展主仓）与 `continuedev/cli`（CLI 仓）是分开仓库，CLI 早期在主仓内后独立。Schema 公开但 payload 细节需结合源码与样例确认。

### Cline（cline/cline）

- **仓库/官网**：https://github.com/cline/cline（monorepo，CLI 位于 `apps/cli/`）｜ npm `cline` ｜ [CLI reference](https://docs.cline.bot/cli/cli-reference)
- **1. 非交互 / headless 模式**：是。`apps/cli/` 子包就是为 CI/CD 与脚本化设计的 headless CLI；`--yolo` 跳过所有审批并在任务完成时自动退出；stdin 管道或输出重定向自动进入 headless。
- **2. 结构化输出机制**：`cline --json "..."` 流式输出 **NDJSON 事件**（官方文档原话 "streams NDJSON events, ideal for piping into other tools"），与 Claude message-stream 派生的事件结构一致（含 `type`、`message`、`tool_use` / `tool_result` 等）；`cline mcp` 子命令用于管理 MCP server（Cline 作为 MCP **client**）；`globalSetup`（experimental）允许通过 MCP 编程式定义工具。
- **3. Schema 文档化与稳定度**：CLI 总体 GA，但完整 NDJSON 字段 schema 在 README 未逐一文档化；[Issue #6996](https://github.com/cline/cline/issues/6996) "output-format json everywhere appropriate" 表明 JSON 输出仍在持续打磨（部分代码路径已覆盖、部分尚未）。版本 v1.110.16（CLI npm 最近发布 2026-07）。
- **4. 判定**：**CAN** —— `cline --json` + `--yolo` 与 Codex `exec --json` 直接对标；唯一妥协是 payload 字段 schema 未在官方文档完整枚举，需读源码或观察样例补齐。
- **备注**：Cline 的 MCP 是 client 侧能力（Cline 调用外部 MCP server），而非把 Cline 本身暴露为 MCP server；如需「外部驱动 Cline」，走 `cline --json` stdio 事件流。

### Charm Crush（charmbracelet/crush）

- **仓库/官网**：https://github.com/charmbracelet/crush
- **1. 非交互 / headless 模式**：是。子命令 `crush run "<prompt>"` 为非交互模式（始终 yolo，无 TUI）；社区仍在推进更完整的 `--headless` 形态（[issue #1862](https://github.com/charmbracelet/crush/issues/1862) 已 Closed + feature 标签）。
- **2. 结构化输出机制**：`crush run --format json`（从 opencode 沿用），输出 JSONL 事件流，事件类型含 `step_start` / `text` / `step_finish`。源码可证级证据来自 [Issue #2412](https://github.com/charmbracelet/crush/issues/2412)（2026-03-15）：在请求给现有 JSON 事件补 `model` 字段时陈述 "When running in headless JSON mode (`crush run --format json`, formerly `opencode run --format json`), the events (`step_start`, `text`, `step_finish`) ... `step_finish` has cost and token counts, and `text` events have `metadata.openai`"。README 未列出此 flag。
- **3. Schema 文档化与稳定度**：无官方文档化、无稳定性承诺。README 与 mintlify 站点均未覆盖 `--format json`；schema 细节只见于 issue 描述与第三方 cheatsheet（源自 opencode 时期）。`crush serve`（HTTP + SSE 后端 API）目前是 [Discussion #1766](https://github.com/charmbracelet/crush/discussions/1766) 的 feature request，README 中「shared backend / SSE event stream」是前瞻描述，未实现。
- **4. 判定**：**PARTIAL** —— `crush run --format json` 实际可用且输出 JSONL（官方仓库 issue 可证），但 schema 未文档化、字段不完整（仍在请求补 model 字段）、无稳定性标记，外部消费者需要容忍 schema 变动。
- **备注**：Crush 由 Charm 从 opencode 收购延续而来（[charm.land/blog/crush-comes-home](https://charm.land/blog/crush-comes-home/)），`--format json` 继承自 opencode 时期；仓库约 26.6k stars / 355 open issues，活跃度高但结构化输出能力仍在演进。

### Aider（Aider-AI/aider）

- **仓库/官网**：https://github.com/Aider-AI/aider（原 `paul-gauthier/aider` 重定向至此）｜ https://aider.chat/ ｜ [options.html](https://aider.chat/docs/config/options.html)
- **1. 非交互 / headless 模式**：是。`--message`/`-m`、`--message-file`/`-f`、`--apply FILE`、`--exit`、stdin 重定向等均支持「单次执行后退出」。
- **2. 结构化输出机制**：无。完整 `aider --help`（即 options.html 全量）中不存在 `--json`、`--output-format`、`--stream-json`、`--json-schema` 等 flag；Output settings 分组只有 `--dark-mode`/`--light-mode`/`--pretty`/`--stream`/`--show-diffs` 及若干颜色项。这里的 `--stream` 仅控制「LLM token-level streaming」（默认 True），是 ANSI 文本流，不是结构化事件流。来源：[options.html#output-settings](https://aider.chat/docs/config/options.html#output-settings)。
- **3. Schema 文档化与稳定度**：无 schema。结构化输出为长期 open feature request：[Issue #1355](https://github.com/Aider-AI/aider/issues/1355)（2024-09-05），其中的 `coder.query_with_response_model(...)` 是提案伪代码，非已实现 API。作者官方博客《[LLMs are bad at returning code in JSON](https://aider.chat/2024/08/14/code-in-json.html)》明确反对把代码塞进 JSON，这是至今未加 `--json` 的设计取向。事后可解析的只有文件级日志：`.aider.chat.history.md`（Markdown）和 `--llm-history-file`（JSONL 形式的 raw LLM 请求/响应，非产品级 agent 事件流）。
- **4. 判定**：**CANNOT** —— 只产出终端 ANSI 文本（+ 事后文件日志），无机器可读事件流；issue #1355 仍 open，无官方 flag。
- **备注**：截至 2026-07-19 仍无结构化输出 flag。若要接入 Aider，只能 spawn 子进程后正则/流式解析 ANSI 文本，或直接读 `.aider.llm.history` JSONL —— 不属于「像 Codex 一样干净解析」。

### Roo Code（RooCodeInc/Roo-Code）

- **仓库/官网**：https://github.com/RooCodeInc/Roo-Code（**仓库已于 2026-05-15 归档为只读，项目关闭**）；继任者为 Kilo Code（商业 fork，https://kilo.ai）与 Zoo Code（社区 fork）
- **1. 非交互 / headless 模式**：是（仅 basic）。v3.21.0（2026-02-09）合并 PR #10452 "VSCode shim and basic CLI for running Roo Code headlessly" 和 PR #10474 "Add CLI installer for headless Roo Code"；v3.39 release notes 将其称为 "Headless Roo Code (CLI + VS Code shim)"。来源：[CHANGELOG.md](https://github.com/RooCodeInc/Roo-Code/blob/main/CHANGELOG.md)、[v3.39 update notes](https://roocodeinc.github.io/Roo-Code/update-notes/v3.39/)。
- **2. 结构化输出机制**：无公开文档化的 `--json` / `--output-format` flag。CHANGELOG 与 release notes 只描述 "basic CLI" 和 "VSCode shim"，未声明任何 NDJSON / JSON-RPC / MCP server 模式；[Issue #3835](https://github.com/RooCodeInc/Roo-Code/issues/3835) 长期作为 feature request 开放，未在归档前落地结构化输出 schema。
- **3. Schema 文档化与稳定度**：无 schema（headless CLI 仅 basic，未文档化结构化输出）；项目已归档，不会再演进。
- **4. 判定**：**CANNOT** —— 即使有 headless CLI 也只是 basic shim，无公开结构化输出 schema；且上游项目已于 2026-05-15 归档关闭。
- **备注**：如需 Roo 血脉的结构化能力，转向 Kilo Code 或 Zoo Code，但需独立验证其各自的 CLI / 结构化输出能力，本调研不覆盖。

### Simon Willison `llm`（simonw/llm）

- **仓库/官网**：https://github.com/simonw/llm ｜ 文档 https://llm.datasette.io/en/stable/
- **1. 非交互 / headless 模式**：是。`llm` 本身就是 non-interactive CLI，`echo "prompt" | llm`、`llm 'prompt'` 即可一行式调用；无 TUI、无对话循环。
- **2. 结构化输出机制**：仅「最终响应内容」可结构化，无 agent 运行事件流。机制是 `--schema` / `--schema-multi`（接受 JSON Schema 字符串、文件、简写 DSL、或已注册 schema id），让底层模型按 OpenAI / Anthropic / Gemini 的 structured output 能力返回单个 JSON 对象。来源：[schemas 文档](https://llm.datasette.io/en/stable/schemas.html)。`llm logs --schema X --data` 可将历史响应按 NDJSON / JSON 数组导出。
- **3. Schema 文档化与稳定度**：官方文档稳定页长期维护，非 experimental；但仅约束「单次模型输出对象」的形状，不提供 process / turn / tool-call / file-edit 等 agent 事件分类。
- **4. 判定**：**CANNOT（作为 agent 输出解析基准）** —— `llm` 不是 coding agent，没有 agent loop / 工具调用事件流；它能给你一个符合 schema 的 JSON 对象作为模型最终答复，但给不出 Codex 那种 `thread.started` / `item.*` / `turn.completed` 持续事件流。
- **备注**：定位是「LLM curl」，不是「Codex 替代」。若 RedWhisk 只想要「让 LLM 吐一段结构化 JSON」，`llm --schema` 够用；要做 agent session 解析，`llm` 不在候选列。

## 「Open Claw」名称歧义查证

「Open Claw」极可能是「OpenCode」的口误 / 听写误差 / 缩写混淆（Claw 与 Code 一字之差），同时存在一个真实但与本调研主旨不匹配的「OpenClaw」项目。逐一查证如下：

- **OpenClaw（[github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) / https://openclaw.ai）**：项目**确实存在**，但不是编程 Agent CLI。它是 Peter Steinberger（steipete）主导的「个人 AI 助手」框架，前身是 Clawdbot / Moltbot（为一只叫 Molty 的太空龙虾 AI 构建的助理），主要形态是「Gateway + 多 IM 渠道接入（WhatsApp / Telegram / Slack / Discord / iMessage 等）」。仓库 README 开口即写 "Your own personal AI assistant. Any OS. Any Platform. The lobster way." 与编程 CLI agent（Codex / OpenCode / Grok Build）**不是同一类产品**。它带 `openclaw` CLI（`onboard` / `gateway` / `agent` / `message` 等子命令）和 sandbox/agent 能力，也支持 skills、cron、webhooks，但应用场景是「跨聊天渠道的私人助理」，核心输出面向聊天渠道消息流而非代码 agent 事件流。**判定：不适用本调研的 Codex 式结构化输出判据（若强行套用即 CANNOT —— 不是编程 agent CLI）**。
- **OpenClaude**：GitHub 上未发现同名主流开源编程 agent，也未在 Anthropic 官方产品线中出现。**判定：基本不存在**。
- **OpenCoder**：存在但**不是编程 agent**，而是一系列开源代码 LLM 模型（如 INF/OpenCoder 系列，是基座 / 补全模型，无 CLI agent 形态）。**判定：存在但与 CLI agent 调研无关**。
- **OpenCode 的别名 / 误写**：考虑到「Claw」与「Code」一字之差，OpenCode 仓库 README 自己吐槽过 "the other confusingly named repo"，以及社区里存在「Codex / Claude Code for openclaw agent」这类混淆讨论，**「Open Claw」最可能的本意就是 OpenCode（sst/opencode）**。**判定：归并到 OpenCode**。

**结论**：若原始任务清单把「Open Claw」与「OpenCode」当作两条独立条目，请回到上游确认 —— 要么是 OpenCode 的笔误（去重），要么是 OpenClaw（但需明确它非编程 agent，不适用 Codex 式结构化输出判据）。本报告按最可能含义归并到 OpenCode。

## 给 RedWhisk 的集成建议

基于本调研结论，把候选 Agent 按接入成本分三档（点到为止，不展开实现）：

- **接入成本低（可直接复用 Codex/Claude 解析思路）**：OpenCode（ACP + `--format json` 双模式与 Codex 几乎一一对应）、Block Goose（双模式最完整对齐，含 `goose acp` JSON-RPC）、Grok Build（同上，含 `grok agent stdio`）、Gemini CLI、Qwen Code（与 Gemini 同构）、Sourcegraph Amp（显式声明 Claude Code 兼容，可复用 Claude 的 stream-json parser）、Cursor CLI（前向兼容承诺 + 完整 tool_call 生命周期）。这些 Agent 都给出官方文档化的 NDJSON 或 ACP/JSON-RPC，RedWhisk 后端只需新增一类 provider 适配器即可。
- **接入成本中（需妥协 schema 不稳定）**：Charm Crush（`crush run --format json` 实际可用但 schema 未文档化）、Continue（payload 字段文档偏枚举层）、Cline（payload 字段未完整文档化）。可以接入，但要准备基于源码 / 样例探测字段、容忍 schema 变动的兜底逻辑。
- **不建议接入（需走 PTY 终端模拟）**：Aider（无 `--json`，作者公开反对 JSON 化，只能正则解析 ANSI）、Roo Code（仓库已归档停更，无结构化输出）、Simon Willison `llm`（非 coding agent）、OpenClaw（非编程 agent，定位是跨聊天渠道私人助理）。

跨 Agent 协议层观察：Codex `app-server`、OpenCode/Goose/Grok 的 ACP、Claude Code 的 `stream-json`、Amp 的 Claude-Code-compatible stream JSON，事实上形成两条主路线 —— **JSON-RPC over stdio（ACP 阵营）** 与 **NDJSON over stdout（Claude Code 阵营）**。RedWhisk 后端若把 provider 抽象收敛到这两条路线，可一次性覆盖本表绝大多数 CAN Agent，无需为每个 Agent 重写解析层。
