# ADR 0020：内置智能体自动检测播种与 Agent 展示字段

## 状态

采纳（待执行）。

## 背景

当前 Agent profile 完全由用户手动添加，`agent_type` 仅 `codex`/`claude` 两种，本机命令检测只有 `detect_codex_command` 一处硬编码探测。`agent_profiles` 表无「展示形式」「启用状态」字段，用户无法区分某 profile 用 JSON 结构化还是（未来的）TUI 流式呈现，也无法在 UI 上禁用某个 agent。需求要求：app 启动自动识别本机已装的 codex/claude/opencode/grok 并默认开启地加入表格；新增 `displayMode`（json/tui）与 `enabled`（是/否）字段；表格按既定顺序与禁用视觉重排；命令列以小图标提示实际启动参数。

调研结论：codex/claude 已有 JSON 解析器；opencode（`opencode run --format json`，JSONL）与 grok（Grok Build CLI headless 支持 plain/JSON/streaming-JSON）CLI 层面都能输出 JSON，但二者 schema 与现有解析器互不兼容，需各自独立 adapter，工程量与本次其余工作不在同一量级。

## 决定

1. **内置 agent 范围与顺序**：支持 codex / claude / opencode / grok 四种，`agent_type` 枚举与 DB CHECK 扩到四值；展示与播种顺序固定为 Codex、Claude Code、OpenCode、Grok。
2. **启动异步检测 + 幂等播种**：app 启动在 setup 钩子异步检测四命令是否安装，对已安装且库中该 agentType **无任何记录（含软删 `del=1`）**者插入一条默认开启（`enabled=1`）的 global profile。软删后记录留存，重启不再重复播种。
3. **displayMode 字段**（`json`/`tui`，默认 `json`）：判定以「RedWhisk 当前是否已接入该 agentType 的 JSON 解析器」为准——已接入（codex/claude/opencode）默认 `json` 且可在 json/tui 间切换，未接入（grok）锁定 `tui` 且表单隐藏切换。字段本身记录 profile 选择；运行时分流见 [ADR-0022](./0022-display-mode-runtime-transport.md)。
4. **enabled 字段**（默认启用）：禁用的 profile 在 Agent 表以浅灰行底区分、排序置末；在「启动 Agent 会话」选择列表中**前端隐藏**。本期**后端不做启动校验**。
5. **Grok 仅登记不执行；OpenCode 已开放 json + TUI**：OpenCode 已接入 JSON 解析器与 TUI descriptor（`dangerous`/`full-access` → `--auto`）；Grok 仍为占位臂且不可启动。前端选择列表仅将 Grok 置灰「暂不支持启动」，OpenCode 在 enabled 时可选 json/tui。
6. **命令参数预览**：后端 command `preview_agent_command_args` 复用 `provider_descriptor` 的 command snapshot 返回某 profile 启动时实际带上的参数；前端在命令名后以「i」小图标提示，悬停 Tooltip 展示；无参数（如 Grok 或 `dangerous=false`）不显示图标；OpenCode 在 dangerous 时展示 `--auto`。

## 后果

- 全新环境自动出现已装内置 agent 的默认 profile；用户软删某内置 agent 即「永久隐藏」，需手动新建方可恢复。
- Grok 可在表格中登记、编辑 displayMode/enabled，但不能真正启动会话（前端置灰）。
- OpenCode 已接入 json 解析器与 TUI descriptor：自动播种默认 `display_mode=json`，表单可在 json/tui 间切换；**不** migration 改写存量 profile 行。
- Grok 仍为占位 descriptor，displayMode 锁定 tui。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| displayMode 按 CLI 能力判定（四者都默认 json 可切） | 与「按 RedWhisk 接入度诚实标注」冲突；未接入 JSON 解析器的类型（当前 grok）标 json 会误导 |
| 每次启动强制该 agentType 存在 del=0 记录（删了又冒回） | 骚扰用户，违背删除意图 |
| enabled 后端启动校验（防绕过） | 改动会话启动路径多处，超出本期范围；YAGNI |
| 独立 seeder 模块承载检测播种 | 仅 4 种内置 agent，编排简单，放 settings service 即可；待 ≥ 6 种或策略复杂化再抽 |
| 在 0020 同期一并实现全部 provider 解析器 | 各需独立 adapter，工程量与「自动播种 + 字段」不在同一量级；OpenCode json 已在后续变更接入，Grok 仍后置 |

## 代码事实来源

- 本决策记录：`docs/adr/0020-builtin-agent-autoseed-and-display-fields.md`
- DB migration：`src-tauri/migrations/`（新编号，扩 agent_type CHECK + 加 display_mode/enabled 列）
- 枚举/DTO：`src-tauri/src/types/agent_profile.rs`
- 检测播种：`src-tauri/src/features/settings/service.rs`、`src-tauri/src/agent/command_detector.rs`、`src-tauri/src/lib.rs`（setup 钩子）
- 占位 descriptor / 参数预览：`src-tauri/src/agent/provider_descriptor.rs`、`src-tauri/src/features/settings/commands.rs`
- 前端表格/表单：`src/features/settings/settings-agents-panel.tsx`、`src/features/settings/agent-profile-form.tsx`、`src/features/agents/agent-visuals.ts`
- 相关 ADR：[ADR-0011](./0011-agent-session-provider-factory.md)、[ADR-0015](./0015-agent-provider-descriptor.md)、[ADR-0014](./0014-service-repository-sql-boundary.md)
