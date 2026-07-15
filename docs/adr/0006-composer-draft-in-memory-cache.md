# ADR 0006：Session 输入草稿使用纯内存缓存并按 Session 删除清理

## 状态

已采纳。

## 背景

Agent Session 输入框（`AgentComposer` 的 textarea）的文本此前是 `useAgentComposer` 内的 `useState("")` 本地状态。顶层 Activity 切换（`ActivityRouter` 的条件渲染）会使整个 `AgentsActivity` 卸载，连带其实例池内所有 `AgentComposer` 卸载、本地状态销毁；切回时重建为空字符串。用户因此丢失未发送的输入，且要求不同 Session 的输入互不混淆。

## 决定

1. **纯内存缓存**：草稿以 module-level `Map<sessionId, string>` 形式存活于 `AgentsActivity` 生命周期之外，由 `useAgentComposer` 在挂载时读取、在 `setText` 时写回。**不持久化**——关闭应用即丢失是有意取舍，草稿不属于业务状态（业务状态唯一事实源是 SQLite）。
2. **键为 sessionId**：`agent_sessions.id` 全局自增、跨项目唯一，单独以 `sessionId` 为键即可，无需 `projectId` 前缀。
3. **发送成功后清除**：`handleSubmit` 现有的 `setText("")` 同步清除该 Session 的缓存项。
4. **Session 删除时必须清除**：`deleteAgentSession` 成功后主动清除该 `sessionId` 的缓存项。

## 后果

- 草稿在「切到其他 Activity 再切回」「同一 AgentsActivity 内切 Session」两种场景下均保留且互不混淆。
- 关闭应用或刷新后草稿丢失——这是内存介质的预期行为，非缺陷。
- **非显然约束**：`agent_sessions.id` 定义为 `INTEGER PRIMARY KEY`（migration 0008）而**无 `AUTOINCREMENT`**，SQLite 在删除一行后可能将该 id 分配给新插入的行。因此第 4 条「Session 删除时清除」是**正确性要求**而非内存优化：若不清除，旧 Session 的草稿会出现在复用该 id 的新 Session 输入框中，造成内容混淆。维护者不得以「靠应用重启自然释放」为由移除删除时的清理逻辑。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 持久化到 localStorage / SQLite | 草稿非业务数据；带来序列化、陈旧清理、跨项目键冲突等额外复杂度，违反最小方案 |
| 将文本状态提升到 Activity 之上的层级经 props / context 下传 | 需穿透多层 props 或新增 Provider，改动面大；module-level Map 更内聚 |
| 仅发送时清除、删除时不清除 | 因 id 会复用，会串内容，违背「不同 Session 内容不混淆」的硬要求 |

## 事实来源

- 本决策记录：`docs/adr/0006-composer-draft-in-memory-cache.md`
- 领域语言：`CONTEXT.md`（Session 输入草稿）
- 现状代码：`src/features/agents/composer/use-agent-composer.ts`、`src/features/agents/composer/agent-composer.tsx`
- 卸载根因：`src/app/activity-router.tsx`（顶层条件渲染）、`src/features/agents/agents-session-pane.tsx`（实例池）
- id 复用根因：`src-tauri/migrations/0008_agent_sessions_and_session_events.sql`（`id INTEGER PRIMARY KEY` 无 `AUTOINCREMENT`）
- 删除回调点：`src/features/agents/agents-activity.tsx`（`deleteAgentSession` 成功后）
