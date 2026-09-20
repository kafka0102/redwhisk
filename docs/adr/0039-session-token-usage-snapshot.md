# 0039. Session Token 消耗按统一口径累计并落在 Session 记录上

**状态**：采纳（待执行）

Issue 详情与 Session 页需要实时展示该次 Agent Session 的 token 消耗，并在重启后保持同一数值。现有 `AgentUsage` 只服务 composer 上下文条，读的是 Codex `last` 当轮用量，不累计、不落库，也不能表达 cache 与命中率。

## 决定

1. **统一口径**：输入=未命中缓存的 input（Claude 的 cache 写入计入输入）；输出=output（Codex reasoning 计入输出）；缓存=cache 读取；总计=输入+输出+缓存；命中率=缓存/(输入+缓存)，分母为 0 则横线。
2. **事实源是 Session 记录**：在 Agent Session 上持久化输入、输出、缓存三个累计值；总计与命中率由此派生。不靠每次打开回放日志来「猜」总数。
3. **实时写入**：结构化用量事件到达即更新累计值并推到 UI。Codex 优先采用线程累计 `total`（有则覆盖，避免把 `last` 再加一遍）；Claude 按 turn 增量累加，同一 turn 不把 assistant 分片与 result 总额重复计算。
4. **优先 Codex 与 Claude Code**：其它 Agent 若能解析出同口径字段则同样累计，否则三项留空、界面横线。TUI 无结构化用量时横线。
5. **历史 Session 不回填**：本能力上线前的记录没有累计值，显示横线。

## 后果

- 须扩展跨边界 DTO（list session 增加 token 字段）及用量事件中的 cache 字段，并同步契约。
- composer 上下文条仍用上下文窗口占用，与本累计消耗分离。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 每次从 structured log 重算 | 现有日志不一定含完整 cache 字段；Codex `last` 与 Claude 分片用量容易算错 |
| 只展示 `last.total_tokens` | 那是当前上下文占用，不是累计消耗 |
| 输入/缓存直接用 provider 原始字段相加 | Codex 的 input 常已包含 cache，会重复计数 |

## 代码事实来源

- 本决策：`docs/adr/0039-session-token-usage-snapshot.md`
- 现有用量：`src-tauri/src/types/agent_session_stream.rs`、`src-tauri/src/agent/codex_app_server/thread_item.rs`、`src-tauri/src/agent/claude_streaming/event_mapper.rs`
- 会话信息 UI：`src/features/issues/issue-detail/issue-readonly-session-panel.tsx`、`src/features/agents/session-side-panel/session-issue-panel.tsx`
