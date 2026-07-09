# Tasks: 会话运行态 grace period

## 1. 数据层：migration + repository

- [x] 1.1 新增 migration `src-tauri/migrations/0034_agent_session_turn_ended_at.sql`：`ALTER TABLE agent_sessions ADD COLUMN turn_ended_at INTEGER NULL;`
- [x] 1.2 `AgentSessionRow` struct 加 `turn_ended_at: Option<i64>`（`agent_session_repository.rs:21` 附近）；list 查询列（:124）与读取（:690）补齐
- [x] 1.3 新增 `update_turn_ended_at(session_id, now)` 与 `clear_turn_ended_at(session_id)`
- [x] 1.4 `mark_terminated_in_transaction`（:404）/ `mark_terminated_without_fetch_in_transaction`（:431）顺带 `turn_ended_at = NULL`
- [x] 1.5 repository 单测：`turn_ended_at` 读写、`mark_terminated` 清理、list 查询返回字段

## 2. broadcaster 三态改造

- [x] 2.1 新增 `TurnRunningDecision` 枚举，`turn_running_from_stream_event`（`agent_event_broadcaster.rs:293`）返回改为该枚举
- [x] 2.2 `turn_failed` 空判断 `error.trim().is_empty()` → `EndedWithGrace`；带 error → `EndedImmediately`
- [x] 2.3 `persist_stream_event`（:155-210）按决策分支调 `update_turn_running` / `update_turn_ended_at` / `clear_turn_ended_at`；早退逻辑（:185）按 `None` 判断
- [x] 2.4 broadcaster 单测：四种 turn 事件的决策映射、空 / 带 error `turn_failed` 分支

## 3. service list grace 计算

- [x] 3.1 新增 `GRACE_MS` 常量与 `turn_still_running_by_grace(turn_ended_at, now)` 函数（`agent_session_service.rs`）
- [x] 3.2 list 合成 `is_turn_running`（:1510）加入 grace 判断；`now` 在遍历前取一次
- [x] 3.3 service 单测：grace 边界（`ended_at=NULL` / 期内 / 期外）、`is_session_running` 守卫

## 4. 前端验证（无需改 isSending 派生）

> `effectiveTurnStatus`（`agent-session-view.tsx:60-65`）已合并 `isTurnRunning`，grace 改造后 composer `isSending` 自动维持运行态，无需改派生。

- [x] 4.1 前端测试：`effectiveTurnStatus` 在 `isTurnRunning=true`（grace 内）时维持 `"running"`，即使 reducer `turnStatus=idle`
- [x] 4.2 前端测试：`isTurnRunning=false`（grace 过期）且 `turnStatus=idle` 时 `effectiveTurnStatus=idle`
- [x] 4.3 `pnpm lint` + `pnpm typecheck` + `pnpm test`

## 5. 端到端验证

- [x] 5.1 模拟 codex 空 error `turn_failed` 序列：grace 期内不误判完成
- [x] 5.2 模拟 claude code 多 turn 并发：sub turn 陆续 `completed` 不误判完成
- [x] 5.3 `turn_canceled` / 带 error `turn_failed` 立即非运行
- [x] 5.4 `pnpm lint` + `pnpm typecheck` + `pnpm test`；`cd src-tauri && cargo test`
