# 0036. Agent 模型列表以本机配置为唯一来源，启动期模型选择不写回全局配置

**状态**：采纳（待执行）

## 背景

模型选项此前只在执行 session 页的 composer 出现，来源是 `list_agent_models`（需 `projectId + sessionId`），且各 provider 的取数策略不一致：Codex 无论本机是否配置模型都返回一份硬编码列表（`gpt-5.5 / gpt-5 / gpt-5-mini / gpt-5-nano`，已落后于 codex-cli 实际目录），Claude 官方接口下返回硬编码别名，Grok 只读展示 `[models].default` 单条，OpenCode 返回空。Issue Run Dialog 选定 Agent Profile 后没有任何模型选项，`start_agent_session` 也不接受模型入参，启动期模型完全由 Agent 自己的全局配置决定。

需要在「选定 Agent 后按需提供模型选项」的同时，避免两类错误：给没有模型目录的 Agent 塞入并不存在的默认模型；以及为了取列表去调用 Agent 的模型接口（拉起子进程、依赖鉴权与网络）。

## 决定

1. **唯一来源是本机配置**：模型列表只从 Agent 本机配置文件解析，不调用 Agent 的模型接口（不 spawn `codex app-server` 的 `model/list`，不执行 `grok models`）。解析失败或文件缺失一律按「无模型目录」处理，不阻断启动。
2. **Codex 三级来源**：`$CODEX_HOME/config.toml` 的 `model_catalog_json` 指向的目录文件 → 同 `$CODEX_HOME` 下的 CLI 模型缓存 → 内置模型回退列表。前两级只取 `visibility = "list"` 的条目，按 `priority` 升序；`slug` 为模型 id，`display_name` / `default_reasoning_level` / `supported_reasoning_levels` 映射为展示名与 effort 能力。`$CODEX_HOME` 仍按 profile command 解析（多 profile 各自独立）。
3. **已配置模型必须在列表内**：解析到的当前模型（`config.toml` 的 `model`）若不在列表里，插到首位并标为默认；列表为空且无当前模型时不返回任何条目。
4. **内置模型回退列表只有 Codex 有**，内容对齐 codex-cli 0.154.0 内置目录的可见项：`gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`、`gpt-5.2`，effort 能力按该目录逐项给出（新模型含 `max` / `ultra`）。其它 Agent 无本机模型目录时返回空列表，UI 不提供任何默认模型。
5. **Grok 模型目录 = 配置里的模型别名表**：枚举 `~/.grok/config.toml` 的 `[model.<别名>]` 表名，`[models].default` 对应项标默认；只有 `[models].default` 而无别名表时按单条只读处理。Grok 的模型列表不再整体标记只读。
6. **Claude 维持现状语义**：官方接口下沿用 CLI 合法别名（opus / sonnet / haiku），第三方网关（存在 `base_url` / `auth_token`）下仍是单条只读真实模型；无 `settings.json` 时无模型目录。
7. **按 Profile 查模型**：新增不依赖 session 的查询入口（入参为项目与 Agent Profile），与会话内 `list_agent_models` 共用同一份 provider 解析逻辑与能力投影，避免出现第二套模型来源。
8. **启动期模型选择只作用于本次启动**：`start_agent_session` 接受可选模型；结构化（json）路径经启动期 runtime 配置传给 provider，交互式（tui）路径由 descriptor 在命令快照上注入该 provider 的模型参数（`codex -m`、`claude --model`、`grok -m`、`opencode -m`）。两条路径都**不**写回 Agent 全局配置文件——这与会话内切换模型（按 ADR-0011 由 handle adapter 写盘）是两套语义。
9. **Run Dialog 显示规则**：`canShowModel` 为真、模型列表非只读、且条目数 ≥ 2 时才显示模型下拉；恰好 1 条不显示（区别于 composer 的只读文本）；加载中显示占位，加载失败显示错误文案且不阻塞「开始运行」。默认选中项为解析到的当前模型，无则列表首条。

## 后果

- 模型列表的新鲜度取决于本机文件：CLI 模型缓存可能过期，此时展示的是缓存内容而非服务端最新目录。这是「不调接口」的自觉代价。
- composer 与 Run Dialog 共用 provider 解析，模型口径一致；更新内置回退列表只需改一处。
- TUI 命令快照新增模型参数注入，`command_snapshot` 语义随之扩展；ADR-0022 的「能作 CLI 参数则注入参数」原则在此沿用。
- 跨边界 DTO 新增字段（启动入参的可选模型、按 Profile 查模型的入参与结果），须同步 parity 快照与 `docs/architecture-design/tauri-contract.md`。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 调用 Agent 模型接口取列表（`codex app-server` 的 `model/list`、`grok models`） | 需拉起子进程并依赖鉴权与网络，慢且离线失败；Run Dialog 每次换 Agent 都要付这个代价 |
| 为所有 Agent 内置默认模型列表 | 给没有模型目录的 Agent 提供并不一定可用的模型，等于替用户猜 |
| 选择模型即写回 Agent 全局配置 | 污染用户在 RedWhisk 之外的 Agent 配置，且与「只对本次启动生效」的诉求相反 |
| Run Dialog 复用 `list_agent_models` | 该入口以 session 为键，启动前没有 session；强行复用会造出假 session |

## 代码事实来源

- 本决策：`docs/adr/0036-agent-model-list-from-local-config.md`
- 前置：`docs/adr/0015-agent-provider-descriptor.md`（descriptor 承载 `list_models` / 能力投影）、`docs/adr/0011-agent-session-provider-factory.md`（会话内模型写盘）、`docs/adr/0022-display-mode-runtime-transport.md`（json / tui 两条启动路径）、`docs/adr/0024-agent-session-must-link-issue.md`（Run Dialog 是唯一新建入口）
- 术语：`CONTEXT.md`（模型目录 / 内置模型回退列表 / 启动期模型选择）
