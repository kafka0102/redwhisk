# OpenCode JSON 模式可行性（RedWhisk 接入）

> 调研日期：2026-07-23  
> CLI 版本：opencode-ai **1.17.12**（本机 `opencode`）  
> 目标：判定 Issue 执行路径是否可在本期以 `displayMode=json` 接入 OpenCode（对标 Claude 同档最小能力）。  
> 姊妹文档：`docs/survey/agent-output-format-survey.md`（跨 Agent 清单，判定 OpenCode 为 CAN）。

## 1. 结论

| 项 | 结论 |
| --- | --- |
| **总判定** | **GO（本期可接入）** |
| 推荐主路径 | `opencode run --format json`（+ `-s` / `--continue` 续会话） |
| 备选（本期不做） | `opencode acp`（ACP JSON-RPC，对标 Codex app-server）；`opencode serve`（HTTP） |
| TUI | **无阻塞**：默认 `opencode` 交互式 TUI，可复用 ADR-0022 进程级 PTY 路径 |
| 与门槛对照 | 满足「事件可映射 + 可续会话」（见 §6） |

## 2. 协议事实（源码 + 实跑）

### 2.1 命令面

```text
opencode run [message..] --format json|default
  -s, --session <id>     续接指定 session
  -c, --continue         续接最近 session
  -m, --model provider/model
  --auto                 非明确拒绝的权限自动 once 批准（dangerous）
  --dir <cwd>
  --variant <effort-like>
  --thinking             是否输出 reasoning 事件（default 格式下也控制 thinking 展示）
```

TUI 默认入口：`opencode [project]`（无 `run` / 无 `--format`）。

### 2.2 JSON 行信封（源码可证）

`run --format json` 时，内部发射函数等价于：

```js
process.stdout.write(JSON.stringify({
  type,           // 事件名
  timestamp: Date.now(),
  sessionID,      // 会话创建后立即固定
  ...payload
}) + "\n")
```

即 **NDJSON**，每行一个对象；公共字段稳定为 `type` / `timestamp` / `sessionID`。

### 2.3 事件类型与 payload（源码可证）

内部订阅 OpenCode 服务端 SSE/事件流，再**折叠**为下列 json 类型：

| `type` | 触发条件（内部事件） | payload 要点 | 映射到 RedWhisk（建议） |
| --- | --- | --- | --- |
| `step_start` | `message.part.updated` 且 `part.type==="step-start"` | `{ part }` | `turn_started`（可用 `part`/`message` id 作 turnId 启发式） |
| `step_finish` | `part.type==="step-finish"` | `{ part }` | `turn_completed`（usage 若 part 含 cost/tokens 则透传，否则 null） |
| `text` | `part.type==="text"` **且** `part.time?.end` | `{ part }`，`part.text` | `timeline.assistant_message` |
| `reasoning` | `part.type==="reasoning"` 且 end，且开启 thinking | `{ part }` | `timeline.reasoning` |
| `tool_use` | `part.type==="tool"` 且 `state.status` 为 `completed` / `error` | `{ part }`（含 tool 名、state、input/output） | `timeline.tool_call`（status completed/failed；detail 以 unknown/shell 等启发式） |
| `error` | `session.error` | `{ error: { name, data? } }` | `timeline.error` 和/或 `turn_failed` |

**实跑样例**（本机无有效模型凭据时仍写出 JSON 行，2026-07-23）：

```json
{"type":"error","timestamp":1784801716412,"sessionID":"ses_0718724eaffe3Oo6svlXn9Yl8g","error":{"name":"UnknownError","data":{"message":"Failed to get direct access token: 401 Unauthorized - {\"message\":\"401 Unauthorized\"}"}}}
```

成功路径的 `text` / `tool_use` / `step_*` 未在本环境完整跑通（凭据 401），但发射分支与 `error` 同源，**源码路径完整**。

### 2.4 会话模型

- **每轮子进程**：一次 `opencode run` ≈ 一次 prompt 回合；进程在 `session.status == idle` 后结束。
- **续会话**：下一轮带 `-s <sessionID>` 或 `--continue`（与 Claude `--resume` 同构）。
- **thread_id 回填**：启动后即可从首条事件或进程内 session 创建结果拿到 `ses_…`；可对齐 `ThreadIdBackfill::WhenPresent` / 首事件写库。
- **session 导出**：`opencode export <sessionID>` 可拿完整 messages/parts（归档兜底，非 live 主路径）。

### 2.5 权限

- 内部事件 `permission.asked` 在 **json 输出路径不会变成可回复的 host 协议**。
- headless：`--auto` → `permission.reply({ reply: "once" })`；否则打印警告并 **reject**。
- 与产品决策一致：`profile.dangerous` 或 `mode=full-access` → 追加 `--auto`；**不做**权限卡 UI。

## 3. 与 Claude 路径的同构性

| 维度 | Claude（现网） | OpenCode json（本期） |
| --- | --- | --- |
| 传输 | 子进程 stdout NDJSON | 同左 |
| 多轮 | 每轮进程 + `--resume` | 每轮进程 + `-s` / `--continue` |
| 权限卡 | 无 JSON-RPC 审批 | 无；`--auto` 策略 |
| 文本流 | stream-json 可有 partial | **仅 completed text**（`time.end` 后才 emit） |
| 工具 | tool_use + tool_result 成对 | 仅 completed/error 的 `tool_use` 折叠事件 |
| Factory 接入 | `ClaudeSessionHandle` | 新建 `OpenCodeSessionHandle` 即可，不必上 ACP |

工程结论：应 **仿 Claude streaming adapter**，不要仿 Codex app-server。

## 4. 能力差距与风险

| 风险 | 级别 | 缓解 |
| --- | --- | --- |
| 无官方强 JSON Schema / 稳定性承诺 | 中 | 解析宽容（忽略未知字段）；单测用固化样例 + 源码注释版本钉在 1.17.x |
| 无 token 级 partial 文本 | 低 | 产品接受「块级」assistant 更新（与部分 headless 工具一致） |
| 工具无 running 中间态（json 折叠） | 低 | tool 直接 completed/failed；UI 可跳过 running |
| `--format json` + `--command` 已知丢 JSON（上游 #2923） | 中 | **禁止**依赖 `--command` 拼装；只用 message 参数 + 自建 argv |
| 权限无法做交互审批 | 中（已接受） | dangerous→`--auto`；否则可能卡在 reject |
| 本环境未采到成功 turn 全样例 | 中 | 实现阶段用可配置 fixture；可选 CI 凭据跑 smoke |
| ACP 更强但成本高 | 信息 | 记入 follow-up，不挡本期 |

## 5. TUI 路径（无独立阻塞）

- 命令：profile.command 默认 `opencode`；`build_tui_command_snapshot`：trim +（dangerous/full-access → `--auto`）；**不**注入 `run` / `--format`。
- 首条 prompt：CLI 支持顶层 `--prompt`；否则 PTY 就绪写 stdin（与 ADR-0022 一致）。
- 生命周期：进程级 closed/crashed/stopped；归档走 ADR-0023 纯文本。

## 6. 门槛核对（grill Q7）

| 门槛 | 状态 |
| --- | --- |
| session id 稳定可得 | **过** — 每事件 `sessionID`，创建后固定 |
| 助手文本可映射 | **过** — `type=text` + `part.text` |
| 至少一类工具/错误事件 | **过** — `tool_use` / `error`（error 已实跑） |
| `-s` / `--continue` 多轮 | **过** — CLI 与源码会话模型支持 |
| 无双向权限时 `--auto` 可接受 | **过** — 产品已采纳 |
| 可复现样例 | **部分** — error 实跑 + 源码事件表；成功 turn 待实现期补 fixture |

→ **总判定 GO**：可进入本期 json 最小实现（Claude 同档）。

## 7. 建议实现切片（供 to-spec / to-tickets）

1. **Descriptor 实装**：OpenCode 脱离 Stub；TUI / structured 命令构造；dangerous→`--auto`；model 启动透传 `-m`；`ui_capabilities` 隐藏切换与 modes。  
2. **TUI 可启动**：factory/eligibility 解锁；Issue Run / Agents「+」可选；进程级 PTY。  
3. **json adapter**：`run --format json` 子进程 + NDJSON 解析 + 映射子集 + session 回填 + composer 多轮 `-s`。  
4. **displayMode 解锁**：`agent-display-mode` / launch eligibility 将 OpenCode 视为「已接入 JSON」；**不** migration 存量 profile。  
5. **单测**：命令 snapshot、事件映射 fixture、eligibility、displayMode 切换。

**Grok：本期不动。**

## 8. go/no-go

- **go**：本期交付 TUI 可启动 + json 最小结构化（若排期紧，实现顺序 TUI → json，但 json 不因可行性再开调研闸）。  
- **no-go 条件**（实现中若出现则停 json、保留 TUI）：事件信封在新版本破坏性变更且无法兼容；或无法可靠拿到 session id / 文本。

