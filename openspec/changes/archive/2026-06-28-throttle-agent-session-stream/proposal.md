# 优化 Agent session 事件流放大

## 背景

长时间 Codex session 会产生高频 assistant / reasoning delta。当前后端对每个 delta 广播完整累积文本，广播器又同步持久化并更新 `latest_output`，前端收到每条事件后立即 dispatch，导致 SQLite 写入、Tauri event、React reducer 和 Markdown 渲染被同时放大。

## 变更

- 后端对 assistant / reasoning delta 做短窗口合并，保留 item 完成与 turn 完成时的最终 flush。
- 事件持久化复用 session 日志路径缓存，并对 `latest_output` 更新做节流。
- 前端在一帧内合并同一 session 的连续事件后再 dispatch，降低 React 渲染次数。

## 非目标

- 不在本次引入消息流虚拟列表。
- 不改变跨边界事件 DTO。
- 不改变 Issue / Agent Session 状态机。
