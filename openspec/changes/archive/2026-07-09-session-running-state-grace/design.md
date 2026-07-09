# Design: 会话运行态 grace period

## 方案概述

方案 1（后端时间戳 grace，单一数据源）：把「turn 是否在 grace 期内」做成 DB 层 list 查询时计算，无定时器、单一数据源。前端 composer 不再本地推测运行态，统一消费 DB 计算结果。

## 数据层

### migration `0034`

```sql
ALTER TABLE agent_sessions ADD COLUMN turn_ended_at INTEGER NULL;
```

- 单位：Unix epoch ms。
- 语义：最近一次「应触发 grace 的 turn 终结」时间戳。NULL 表示无待 grace 的终结（运行中 / 已清 / 已终止）。

### repository（`src-tauri/src/db/agent_session_repository.rs`）

- struct `AgentSessionListRow` 加 `turn_ended_at: Option<i64>`（:21 附近）。
- list 查询列补 `agent_sessions.turn_ended_at`（:124 附近，紧跟 `is_turn_running`），读取（`agent_session_list_row_from_row` :690 附近，按列索引补一行，后续列索引顺移）。
- 新增独立方法，避免一个 SQL 承载两种语义：
  - `update_turn_ended_at(session_id, now)`：`SET turn_ended_at = ?1, last_active_at = MAX(last_active_at + 1, ?2) WHERE id = ?3 AND status = 'running' AND del = 0`
  - `clear_turn_ended_at(session_id)`：`SET turn_ended_at = NULL WHERE id = ?3`
- `mark_terminated_in_transaction`（:404）/ `mark_terminated_without_fetch_in_transaction`（:431）：在现有 `is_turn_running = 0` 基础上顺带 `turn_ended_at = NULL`。
- `update_turn_running`（:597）签名不变；保持现状 SQL（`WHERE id = ?3 AND status = 'running' AND del = 0`，已带守卫），grace 改造不改此行为。

## broadcaster 三态改造（`src-tauri/src/agent/agent_event_broadcaster.rs`）

`turn_running_from_stream_event`（:293）返回从 `Option<bool>` 扩展为三态决策枚举：

```rust
enum TurnRunningDecision {
    Running,                       // turn_started：置 is_turn_running=1 + 清 turn_ended_at
    EndedWithGrace(i64 /* now */), // turn_completed / 空 error turn_failed：写 turn_ended_at=now，不置 is_turn_running=0
    EndedImmediately,              // 带 error turn_failed / turn_canceled：置 is_turn_running=0 + 清 turn_ended_at
    None,                          // 其他事件（timeline / usage_updated / ...）
}
```

映射规则：

| 事件 | 条件 | 决策 |
|---|---|---|
| `TurnStarted` | — | `Running` |
| `TurnCompleted` | — | `EndedWithGrace(now)` |
| `TurnFailed` | `error.trim().is_empty()` | `EndedWithGrace(now)` |
| `TurnFailed` | `error` 非空 | `EndedImmediately` |
| `TurnCanceled` | — | `EndedImmediately` |
| 其他 | — | `None` |

`persist_stream_event`（:155-210）按决策分支：

- `Running` → `update_turn_running(session_id, true, now)` + `clear_turn_ended_at(session_id)`
- `EndedWithGrace(now)` → `update_turn_ended_at(session_id, now)`（不动 `is_turn_running`）
- `EndedImmediately` → `update_turn_running(session_id, false, now)` + `clear_turn_ended_at(session_id)`
- `None` → 不动 turn 字段

`persist_stream_event` 现有「`turn_running.is_none()` 则跳过 DB 写」的早退逻辑（:185）改为按 `TurnRunningDecision::None` 判断。

## service list grace 计算（`src-tauri/src/core/agent_session_service.rs:1510`）

```rust
is_turn_running: is_session_running
    && row.is_turn_running
    && turn_still_running_by_grace(row.turn_ended_at, now),
```

```rust
const GRACE_MS: i64 = 3000;

fn turn_still_running_by_grace(turn_ended_at: Option<i64>, now: i64) -> bool {
    match turn_ended_at {
        None => true,                          // 无待 grace 终结：按 is_turn_running 原值
        Some(ended) => now - ended < GRACE_MS, // grace 期内：仍视为运行
    }
}
```

- `GRACE_MS` 放 service 层常量（与 list 合成同模块，便于单测）。
- `now` 取 list 查询时刻的 `current_epoch_millis()`（list 遍历前取一次，避免逐行漂移）。

## 前端 composer 运行态（无需改造）

`agent-session-view.tsx:60-65` 的 `effectiveTurnStatus` 已是 `state.turnStatus === "running" || (canUseExternalTurnRunning && isTurnRunning)`——已合并 `isTurnRunning`。composer 的 `isSending = turnStatus === "running"`（`turnStatus` 即 `effectiveTurnStatus`）已间接靠 `isTurnRunning`。

grace 改造后，`isTurnRunning`（list 查询返回，带 grace）在 grace 期内保持 true → `effectiveTurnStatus` 自动维持 `"running"` → composer `isSending` 自动保持 true。**无需改 `isSending` 派生**。

- `isTurnRunning` 链路：`agents-session-pane.tsx:453` 传 `workspace.isTurnRunning`（list `is_turn_running`）→ `AgentSessionView` → `effectiveTurnStatus` → composer `turnStatus`。
- `isSubmitting` 本地锁保留（点击发送 → `isTurnRunning` 回流间隙防双击），现状不变。
- reducer `turnStatus`（`message-stream-reducer.ts`）保留 `failed` / `canceled` 供消息流错误条目消费，现状不变。
- turn 事件回流瞬间：reducer `state.turnStatus` 立即变 `idle`，但 `isTurnRunning`（list 旧值或 grace 后新值）仍 true → `effectiveTurnStatus` 维持 `"running"`，不闪现完成。

> 修正说明：交接文档第六节第 5 点原述「composer `isSending` 改从 `isTurnRunning` 派生」基于对 `effectiveTurnStatus` 合并逻辑的遗漏；实际代码已合并，前端无需改派生。

## 覆盖范围

- session card（DB `is_turn_running`，已带 grace）✅
- composer 发送按钮（`effectiveTurnStatus` 已合并 `isTurnRunning`，grace 期内自动维持运行态）✅
- 非活跃 session（list 查询计算）✅
- 无定时器竞态（纯查询时计算）✅

## 待确认设计点的默认决策

| 设计点 | 默认决策 |
|---|---|
| migration 列名 / 默认值 | `turn_ended_at INTEGER NULL`，默认 NULL |
| session resume / 应用重启恢复 | 重启后 status 转 stopped/crashed，`mark_terminated_*` 清 `turn_ended_at`；list 合成受 `is_session_running` 守卫，重启后 `is_session_running=false` → `is_turn_running=false`，grace 不再生效 |
| composer cancel / isCancelling 联动 | `isCancelling` 本地态保留，cancel 请求发出后置 true，turn 终结回流后清；现状不变 |
| `GRACE_MS` 位置 | service 层常量（`agent_session_service.rs`） |
| 前端 `turnStatus=failed/canceled` 提示 | 保留 reducer `turnStatus`，composer 不消费；session card 不展示 failed/canceled 文案（止血范围不做，留 Q1.3） |

## 风险

- grace 3 秒为经验值，sub turn 间隔 > 3 秒仍可能短暂误判（已知局限，non-goal，根治留 Q1.3 三态化）。
- claude code turn 漏终结（如 `session-154` turn B 无 `completed`）：`turn_ended_at` 由后续 turn 覆盖，不影响 session 级运行态；session 真正结束时由 `mark_terminated` 清理。
- `update_turn_running` 现状 SQL 已带 `status='running' AND del=0` 守卫（`agent_session_repository.rs:607`），grace 改造不改此行为，保持现状。
- list 轮询存在间隔，turn 终结瞬间 `isTurnRunning` 可能仍为旧值 true；这正是 grace 想要的「维持运行态」效果，不构成误判。
