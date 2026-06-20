# Agent Session 处理竞品分析

## 结论摘要

参考项目在 Agent Session 处理上的核心优势，是把 Codex App Server 的原始 JSON-RPC/notification 事件固定收敛在 daemon/provider 层完成归一化，前端只消费稳定的 timeline 协议。这样历史回放、实时流、工具调用、Markdown 渲染、搜索结果、计划卡片与权限审批都共享同一套结构化数据模型，不需要前端猜测原始 JSON 的形态，也不会把日志原文泄漏到用户界面。

RedWhisk 当前已经具备相似方向：Rust Core 通过 `codex app-server` 接入，广播 `agent-session-stream-event`，前端用 `read_agent_timeline` + reducer 渲染结构化消息流。但从截图和代码事实看，历史日志兼容、实时去重、模型/Think 控件来源、工具详情展示仍有明显缺口。

## 参考项目的数据路径

参考项目的输入与输出路径分工清晰：

- 输入从 composer 进入：前端先追加乐观用户消息，再调用 client RPC 发送给 daemon。
- daemon 的 AgentManager 启动 provider，Codex App provider 通过 `turn/start` 驱动 Codex App Server。
- Codex App Server 原始事件只在 provider 内部处理。`agent_message_delta`、`reasoning_delta`、`exec_command_*`、`patch_apply_*`、`item_started`、`item_completed` 等事件被映射成统一的 `AgentTimelineItem`。
- 前端通过 WebSocket 接收 `agent_stream`，事件格式固定为 `timeline`、`usage_updated`、`permission_requested` 等业务语义。
- 历史回放不读取终端文本，而是走 `fetch_agent_timeline_request` 返回权威 timeline entries。

这条链路的重要点是：前端从不执行 Codex 输出，也不直接展示 provider 原始 JSON。原始 JSON 只是 daemon 内部协议，UI 只认归一化后的消息、推理、工具调用、计划、压缩标记和错误。

## Timeline 模型

参考项目常见 timeline item 包括：

- `user_message`：用户输入，带可选 `messageId`。
- `assistant_message`：助手输出，支持增量聚合。
- `reasoning`：推理/思考片段，通常折叠显示。
- `tool_call`：命令、补丁、文件、搜索、子 Agent、MCP 等工具调用。
- `todo`：计划或任务清单。
- `error`：结构化错误。
- `compaction`：上下文压缩标记。

前端渲染上，参考项目把 timeline 进一步转成稳定的 UI stream item，并使用 head/tail 模型：

- tail 是已提交历史。
- head 是当前流式输出。
- assistant/reasoning 这类可流式内容在 head 中持续更新。
- 非流式工具调用会先 flush head，再追加工具卡。
- turn 完成后把 head 提交到 tail。

这套模型能避免 assistant delta 在 UI 中堆出多条，也能避免历史回放和实时事件双写时出现重复。

## 工具调用体验

参考项目工具调用不是裸文本日志，而是按工具类型展示：

- Shell：显示命令、状态、退出码和输出折叠区。
- Patch/Edit：显示文件路径和 diff。
- Search：显示搜索图标、摘要，点击后查看具体 query、匹配内容和 URL。
- Plan：专用计划卡，不走普通工具 badge。
- Sub-agent/MCP/Web search：保留工具名、状态和可展开详情。

这解释了截图中的差距：当前 RedWhisk 的 Search 仅显示 `搜索：query` 和 matches 列表，缺少“可点击查看搜索详情”的交互层级，也没有把 URL 作为链接强调。

## 模型选择与数据来源

参考项目的模型切换来自 daemon/provider 层的模型能力接口，而不是前端静态猜测。Codex 路径下，模型列表通过 app-server 的 `model/list` 获取，模型切换通过下一次 `turn/start` 的 `model` 字段生效。reasoning effort 同理，应由 provider 确认支持后再暴露。

RedWhisk 当前代码中：

- Codex session 支持 `list_agent_models`，数据来自运行中的 `CodexSessionHandle.list_models()`，底层调用 app-server `model/list`。
- 历史 session 没有运行中的 handle，因此 `list_agent_models` 会返回“当前 Session 没有运行中的结构化会话”。
- Claude / Claude Code 当前没有实现 provider 适配和模型列表 API，前端无法可靠得知具体模型实例。
- Think 模式在 UI 默认显示 `medium`，但当前实际模型不支持或没有稳定事件源确认支持，且用户无法可靠修改。

合理策略是：

- Codex 且 session 正在运行时，展示可切换模型列表。
- 历史 session 或 handle 不存在时，不把“没有运行中的结构化会话”作为错误展示给用户，改为只读模型信息或隐藏模型选择。
- Claude / Claude Code 在 provider 未实现前，只展示“Claude”模型类型；若未来接入 Claude Models API 或本地 profile 显式记录模型名，再显示具体模型。
- reasoning effort 控件必须基于模型能力显示；没有能力证据时直接移除。

截至 2026-06-20 查询 Anthropic 官方 Claude 模型概览，Claude 常用/最新序列包含 Fable 5、Opus 4.8、Sonnet 4.6、Haiku 4.5。由于 RedWhisk 当前没有 Claude provider 的实时模型来源，不能把这些名称当作当前 session 的事实，只适合作为静态兜底说明或未来默认选项参考。

## RedWhisk 当前问题定位

截图中的几个问题可以归因如下：

- 历史 session 输出原始 JSON：历史读取器只接受当前 `AgentStreamEventEnvelope` 格式。旧日志虽然已经是 JSONL 结构化事件，但如果无法反序列化为当前 envelope，就降级为 PTY 文本日志，最终把整段 JSON 当 assistant message 显示。
- 模型加载失败提示：composer 进入历史 session 后仍调用 `list_agent_models`，但 registry 中没有运行中 handle，于是 command 返回“当前 Session 没有运行中的结构化会话”。
- Think 默认 `medium`：前端本地维护默认 effort，与实际 provider 能力脱节。
- 发送后三次重复：reducer 已有乐观用户消息，但后端 timeline 回显的 `user_message` 没有与乐观条目合并，且重复回显没有按 messageId/文本去重。
- 搜索体验弱：`ToolCallDetail.Search` 已有 `query` 和 `matches`，但 UI 没有参考项目那样提供可展开详情、链接识别和结果层级。

## 建议的产品与工程方向

短期修复应集中在已有协议内完成：

- 历史日志读取兼容旧结构化 JSONL，只提取 `event.type === "timeline"` 的 `item`。
- reducer 按 `messageId` 和文本合并 `user_message`，替换乐观条目，避免重复。
- 历史 session 不展示模型加载错误；Claude/Claude Code 显示只读类型。
- 移除无能力证据的 Think 控件。
- Search 工具卡改为“摘要 + 可展开详情”，识别 URL 为链接。

中期应补齐协议能力：

- 后端把当前 session 的 provider、model、reasoning effort、是否可切换等能力作为 session metadata 返回给前端。
- 结构化 timeline 持久化从日志文件升级为数据库表，保留 seq、epoch、timestamp、source range，减少日志格式迁移风险。
- 引入 head/tail 或 equivalent 的流式聚合模型，降低 delta、历史回放、实时事件交错时的复杂度。
- 为 Claude provider 单独定义模型列表来源；如果只能从 profile 得到命令行参数，就明确标注“配置模型”而不是“运行时模型”。

## 对 RedWhisk 的验收标准

- 打开历史结构化 session 时，不再看到原始 JSON 行。
- 打开历史 session 时，底部 composer 不显示“当前 Session 没有运行中的结构化会话”。
- 不再出现不可修改且不生效的 Think 默认值。
- 发送一条消息后，时间轴中最多显示一条用户消息；后端回显到达后替换乐观条目。
- 搜索工具调用有图标、状态、可展开 query 与结果；URL 结果可点击。

## 参考资料

- Anthropic Claude Models overview：https://docs.anthropic.com/en/docs/about-claude/models/overview
- Anthropic Choosing the right model：https://docs.anthropic.com/en/docs/about-claude/models/choosing-a-model
- Anthropic Models API：https://docs.anthropic.com/en/api/models-list
- 参考项目分析文档：`/Users/yujianjia/workspace/open/coding/paseo/docs/codex-agent-session-output.md`
