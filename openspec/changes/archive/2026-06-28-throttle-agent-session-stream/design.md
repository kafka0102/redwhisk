# 设计

## 后端 delta 合并

Codex app-server 的 delta 仍按完整累积文本落到内部 buffer。`AgentMessageDelta` 与 `ReasoningDelta` 到达时只更新 buffer，并在距离上次 flush 超过短窗口时广播最新完整文本。`ItemCompleted` 和 `TurnCompleted` 前强制 flush 未广播的文本，避免最终内容丢失。

窗口选择 `80ms`，对应当前日志里约 `80ms` 的重复广播节奏，可以把更高频 delta 合并到 UI 可感知的刷新频率内，同时不会让用户明显感觉输出滞后。

## 持久化节流

广播器维护 session log path 缓存，避免每条事件重新打开数据库查询 session。JSONL 仍按事件追加，保证恢复路径不丢事件；`latest_output` 只在重要事件或节流窗口后更新，避免每个 delta 都写 SQLite。

## 前端帧级合并

Hook 订阅事件后不再逐条 dispatch，而是把同一浏览器帧内的事件收集为 batch。Reducer 新增 `EVENT_BATCH`，按现有 `applyEvent` 语义顺序折叠。这样不会改变状态结果，只减少 React render 次数。
