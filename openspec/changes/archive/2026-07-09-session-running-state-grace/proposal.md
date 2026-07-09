# Proposal: 会话运行态 grace period 止血

## Why

使用 superpowers sub agent 开发时，session card 与 composer 提交按钮出现「完成态反复横跳」：某个 sub agent / turn 结束时状态短暂显示「已完成」，几秒后主 agent 再输出又变回「运行中」。

根因：运行态是 session 级单一全局布尔 `is_turn_running`，由 turn 终结事件（`turn_completed` / `turn_failed` / `turn_canceled`）在 `turn_running_from_stream_event`（`src-tauri/src/agent/agent_event_broadcaster.rs:293-301`）中**无差别**拉低，无 turn 归属判断。前端无法区分「主任务真完成」与「turn 间过渡 / 瞬态失败」。

两个真实现场已确证（`~/.redwhisk/session-logs/runtime/project-1/`）：

- **codex**（`project-1-issue-109-session-153.jsonl`，34016 行）：turn 串行模型（`turn-<epoch>`），`turn_failed(error:"")` 空错误瞬态把 `is_turn_running` 误拉低（交接文档 `session-139` 现场，2 次空 error `turn_failed`，固定模式 `assistant_message → usage_updated×2 → turn_failed(error:"")`）。
- **claude code**（`project-1-issue-105-session-154.jsonl`，1942 行）：`collabAgentToolCall` sub agent **各自产生独立 turn**（UUID turn_id），多 turn 并发（4 个同时 running，LIFO 完成）；任一 sub turn `completed` 都会无差别拉低 session 级运行态。

> 注：交接文档原述「sub agent 不产生独立 turn」仅适用 codex；claude code 的 sub agent 产生独立 turn，本 proposal 据此修正。

## What

引入 **turn 结束 grace period**：turn 终结事件不立即置 `is_turn_running=false`，而是记录 `turn_ended_at` 时间戳，由 list 查询时计算「是否仍在 grace 期内」决定运行态。采用方案 1（后端时间戳 grace，单一数据源），无定时器竞态。

触发条件（方案 B，用户已确认）：

- **延迟 `GRACE_MS`（3000ms）置非运行**：`turn_completed` + **空 error** 的 `turn_failed`（写入 `turn_ended_at=now`，不置 `is_turn_running=0`）
- **立即置非运行**：`turn_canceled`（用户中断）+ **带 error** 的 `turn_failed`（真失败）
- **恢复运行 + 取消延迟**：`turn_started`（置 `is_turn_running=1` + 清 `turn_ended_at`）

空判断：`turn_failed.error.trim().is_empty()`。

## Scope（止血）

覆盖 Q1.1（空 error `turn_failed` 容忍）+ Q1.2（grace period）。覆盖 codex 与 claude code 两种 provider。

对 claude code 多 turn 并发：每个 sub turn 的 `completed` 持续刷新 `turn_ended_at`，grace 不会在 sub turn 陆续完成时提前到期（只要最近一次 `completed` 在 `GRACE_MS` 内即视为运行）。

## Non-goals

- **Q2 区分主 / sub 输出**：后端识别 `Agent` / `TaskOutput` / `collabAgentToolCall`，从 rawInput 解析 `task_id` / `description`，归一化为结构化 sub_agent detail；timeline item 挂 `origin: main|sub`。raw 字段已确认含标识，留独立 spec。
- **Q1.3 三态化**：`is_turn_running` 单布尔 → `running/transitioning/idle` + session card `in-progress` tone 语义澄清。
- **多 turn 并发严格正确性（turn 引用计数）**：所有 turn 完成 + 主 agent 沉默 > `GRACE_MS` 仍会短暂误判，3 秒可调，根治留 Q1.3。
- **codex 原生 task 工具**的 sub agent 事件模型（用户确认用的是 superpowers Task/Agent）。

## Impact

- migration `0034`：`agent_sessions` 加 `turn_ended_at INTEGER NULL`。
- 后端：broadcaster 三态决策（`turn_running_from_stream_event` 返回扩展）、repository `turn_ended_at` 读写、service list grace 计算（`agent_session_service.rs:1510`）。
- 前端：无需改 composer `isSending` 派生（`effectiveTurnStatus` 已合并 `isTurnRunning`，grace 改造后自动维持运行态）。
- 验证：Rust `cd src-tauri && cargo test`；TS `pnpm lint` + `pnpm typecheck` + `pnpm test`。
