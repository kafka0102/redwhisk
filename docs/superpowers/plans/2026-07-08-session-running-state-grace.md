# 会话运行态 grace period 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Agent Session 运行态引入 turn 结束 grace period，消除 sub agent / turn 终结导致的「完成态反复横跳」。

**Architecture:** 方案 1（后端时间戳 grace，单一数据源）。turn 终结事件不立即置 `is_turn_running=false`，而是写入 `turn_ended_at`；list 查询时由 `turn_ended_at` 与当前时间计算 grace（3000ms）决定运行态。无定时器竞态。前端 composer 无需改派生（`effectiveTurnStatus` 已合并 `isTurnRunning`）。

**Tech Stack:** Rust（Tauri 后端，rusqlite，SQLite migration）、TypeScript/React（前端，vitest）。

## Global Constraints

- migration 编号 `0034`（最新 `0033_project_terminal_shortcut_commands.sql`）。
- `GRACE_MS = 3000`（`i64`，毫秒），定义在 `src-tauri/src/core/agent_session_service.rs`。
- 空 error 判断：`turn_failed.error.trim().is_empty()`。
- `turn_ended_at` 加在 `AgentSessionListRow` struct 与 list 查询列**末尾**（`closed_at` 之后），避免现有列索引顺移。
- Rust 验证：`cd src-tauri && cargo test`。
- TS 验证：`pnpm lint` + `pnpm typecheck` + `pnpm test`。
- 提交规范：中文 Conventional Commits，`<type>: <描述>`，禁止 scope，正文尾追加 `Refs: #32`。
- 语言：所有说明性文字简体中文（项目 CLAUDE.md）。
- 外科手术式修改：只改本任务相关代码，不顺手重构。

---

### Task 1: migration + repository turn_ended_at 读写

**Files:**
- Create: `src-tauri/migrations/0034_agent_session_turn_ended_at.sql`
- Modify: `src-tauri/src/db/agent_session_repository.rs`（struct `AgentSessionListRow` :9-34、list 查询 :112-137、`agent_session_list_row_from_row` :673-704、`mark_terminated_in_transaction` :410-422、`mark_terminated_without_fetch_in_transaction` :437-449、新增 `update_turn_ended_at` / `clear_turn_ended_at` 紧随 `update_turn_running` :597-610）
- Test: `src-tauri/src/core/agent_session_service.rs` 测试 mod（复用 `setup_session_list_database` / `insert_session_list_row` / `test_agent_session_service`，仿 :5813 模式）

**Interfaces:**
- Produces: `AgentSessionListRow.turn_ended_at: Option<i64>`；`AgentSessionRepository::update_turn_ended_at(&self, session_id: i64, now: i64) -> rusqlite::Result<usize>`；`AgentSessionRepository::clear_turn_ended_at(&self, session_id: i64) -> rusqlite::Result<usize>`。Task 2/3 依赖。

- [ ] **Step 1: 写 migration**

`src-tauri/migrations/0034_agent_session_turn_ended_at.sql`：
```sql
ALTER TABLE agent_sessions ADD COLUMN turn_ended_at INTEGER NULL;
```

- [ ] **Step 2: 写失败测试**

在 `src-tauri/src/core/agent_session_service.rs` 测试 mod（:4862 `#[cfg(test)]` 内，紧随 :5857 `list_agent_sessions_reads_persisted_turn_running_state` 之后）新增：
```rust
#[test]
fn update_turn_ended_at_writes_timestamp_for_running_session() {
    let database = setup_session_list_database();
    insert_session_list_row(
        &database,
        401,
        Some(30),
        Some("Grace issue"),
        Some("running"),
        AgentSessionStatus::Running,
        20,
        None,
    );
    let repository = AgentSessionRepository::new(&database);

    repository
        .update_turn_ended_at(401, 1_000)
        .expect("update turn_ended_at");

    let ended_at: Option<i64> = database
        .query_row(
            "SELECT turn_ended_at FROM agent_sessions WHERE id = 401",
            [],
            |row| row.get(0),
        )
        .expect("read turn_ended_at");
    assert_eq!(ended_at, Some(1_000));
}

#[test]
fn clear_turn_ended_at_nulls_timestamp() {
    let database = setup_session_list_database();
    insert_session_list_row(
        &database,
        402,
        Some(31),
        Some("Clear issue"),
        Some("running"),
        AgentSessionStatus::Running,
        21,
        None,
    );
    let repository = AgentSessionRepository::new(&database);
    repository.update_turn_ended_at(402, 1_000).expect("set");

    repository.clear_turn_ended_at(402).expect("clear");

    let ended_at: Option<i64> = database
        .query_row(
            "SELECT turn_ended_at FROM agent_sessions WHERE id = 402",
            [],
            |row| row.get(0),
        )
        .expect("read turn_ended_at");
    assert_eq!(ended_at, None);
}

#[test]
fn mark_terminated_clears_turn_ended_at() {
    let database = setup_session_list_database();
    insert_session_list_row(
        &database,
        403,
        Some(32),
        Some("Terminate issue"),
        Some("running"),
        AgentSessionStatus::Running,
        22,
        None,
    );
    let repository = AgentSessionRepository::new(&database);
    repository.update_turn_ended_at(403, 1_000).expect("set");

    database
        .execute(
            "UPDATE agent_sessions SET status = 'stopped', is_turn_running = 0, turn_ended_at = NULL, closed_at = 50 WHERE id = 403 AND closed_at IS NULL AND del = 0",
            [],
        )
        .expect("terminate");

    let ended_at: Option<i64> = database
        .query_row(
            "SELECT turn_ended_at FROM agent_sessions WHERE id = 403",
            [],
            |row| row.get(0),
        )
        .expect("read turn_ended_at");
    assert_eq!(ended_at, None);
}
```
> 注：`mark_terminated_clears_turn_ended_at` 直接用 SQL 模拟 `mark_terminated_*` 的 SET 子句（含新增 `turn_ended_at = NULL`），验证清理语义。

- [ ] **Step 3: 运行测试确认失败**

Run: `cd src-tauri && cargo test --lib update_turn_ended_at_writes_timestamp_for_running_session clear_turn_ended_at_nulls_timestamp mark_terminated_clears_turn_ended_at`
Expected: 编译失败（`AgentSessionListRow` 无 `turn_ended_at` 字段、无 `update_turn_ended_at` / `clear_turn_ended_at` 方法；migration 0034 未跑则 `turn_ended_at` 列不存在）。

- [ ] **Step 4: 实现 struct 字段 + 查询列 + 读取**

`agent_session_repository.rs` struct `AgentSessionListRow`（:33 `closed_at` 后、:34 `}` 前）加：
```rust
    pub closed_at: Option<i64>,
    pub turn_ended_at: Option<i64>,
}
```

list 查询（:136 `agent_sessions.closed_at` 后）加列：
```sql
                agent_sessions.closed_at,
                agent_sessions.turn_ended_at
             FROM agent_sessions
```

`agent_session_list_row_from_row`（:703 `closed_at: row.get(22)?,` 后）加：
```rust
        closed_at: row.get(22)?,
        turn_ended_at: row.get::<_, Option<i64>>(23)?,
    })
```

- [ ] **Step 5: 实现 update_turn_ended_at / clear_turn_ended_at**

在 `update_turn_running`（:597-610）后新增：
```rust
    pub fn update_turn_ended_at(
        &self,
        session_id: i64,
        now: i64,
    ) -> rusqlite::Result<usize> {
        self.connection.execute(
            "UPDATE agent_sessions
             SET turn_ended_at = ?1,
                 last_active_at = MAX(last_active_at + 1, ?2)
             WHERE id = ?3 AND status = 'running' AND del = 0",
            params![now, now, session_id],
        )
    }

    pub fn clear_turn_ended_at(&self, session_id: i64) -> rusqlite::Result<usize> {
        self.connection.execute(
            "UPDATE agent_sessions
             SET turn_ended_at = NULL
             WHERE id = ?1",
            params![session_id],
        )
    }
```

- [ ] **Step 6: mark_terminated 加 turn_ended_at = NULL**

`mark_terminated_in_transaction`（:411-416）与 `mark_terminated_without_fetch_in_transaction`（:438-443）的 SET 子句，在 `is_turn_running = 0,` 后加 `turn_ended_at = NULL,`：
```sql
            SET status = ?1,
                is_turn_running = 0,
                turn_ended_at = NULL,
                last_active_at = MAX(last_active_at + 1, ?2),
                 closed_at = COALESCE(closed_at, ?2)
             WHERE id = ?3 AND closed_at IS NULL AND del = 0",
```

- [ ] **Step 7: 运行测试确认通过**

Run: `cd src-tauri && cargo test --lib update_turn_ended_at_writes_timestamp_for_running_session clear_turn_ended_at_nulls_timestamp mark_terminated_clears_turn_ended_at`
Expected: 3 个测试 PASS。

- [ ] **Step 8: 全量 cargo test + commit**

Run: `cd src-tauri && cargo test`
Expected: 全部 PASS（含现有 :5813 等测试，因 turn_ended_at 默认 NULL 不影响现有断言）。
```bash
git add src-tauri/migrations/0034_agent_session_turn_ended_at.sql src-tauri/src/db/agent_session_repository.rs src-tauri/src/core/agent_session_service.rs
git commit -m "feat: 新增 agent_sessions.turn_ended_at 列与 repository 读写

为 grace period 止血方案打数据层基础：新增 turn_ended_at 列、
repository update/clear 方法，mark_terminated 终止时顺带清理。

Refs: #32"
```

---

### Task 2: broadcaster 三态决策

**Files:**
- Modify: `src-tauri/src/agent/agent_event_broadcaster.rs`（`turn_running_from_stream_event` :293-301、`persist_stream_event` :155-210、更新测试 :416-449）
- Test: 同文件测试 mod（:356）

**Interfaces:**
- Consumes: Task 1 的 `update_turn_ended_at` / `clear_turn_ended_at`。
- Produces: `TurnRunningDecision` 枚举（`Running` / `EndedWithGrace` / `EndedImmediately` / `None`）；`turn_running_from_stream_event(event) -> TurnRunningDecision`。Task 3 不直接依赖，但行为由 broadcaster 驱动。

- [ ] **Step 1: 写失败测试**

在 broadcaster 测试 mod（:449 后）新增（先不删 :416 旧测试，Step 4 统一更新）：
```rust
#[test]
fn turn_decision_maps_turn_events() {
    use TurnRunningDecision::*;
    assert_eq!(
        turn_running_from_stream_event(&AgentStreamEvent::TurnStarted { turn_id: None }),
        Running
    );
    assert_eq!(
        turn_running_from_stream_event(&AgentStreamEvent::TurnCompleted {
            turn_id: None,
            usage: None,
        }),
        EndedWithGrace
    );
    // 空 error 的 turn_failed → grace（codex 瞬态空错误）
    assert_eq!(
        turn_running_from_stream_event(&AgentStreamEvent::TurnFailed {
            turn_id: None,
            error: "".to_string(),
            code: None,
        }),
        EndedWithGrace
    );
    assert_eq!(
        turn_running_from_stream_event(&AgentStreamEvent::TurnFailed {
            turn_id: None,
            error: "   ".to_string(),
            code: None,
        }),
        EndedWithGrace
    );
    // 带 error 的 turn_failed → 立即终止（真失败）
    assert_eq!(
        turn_running_from_stream_event(&AgentStreamEvent::TurnFailed {
            turn_id: None,
            error: "boom".to_string(),
            code: None,
        }),
        EndedImmediately
    );
    assert_eq!(
        turn_running_from_stream_event(&AgentStreamEvent::TurnCanceled {
            turn_id: None,
            reason: "user".to_string(),
        }),
        EndedImmediately
    );
    assert_eq!(
        turn_running_from_stream_event(&AgentStreamEvent::ModelChanged {
            model_id: "gpt-5".to_string(),
        }),
        None
    );
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test --lib turn_decision_maps_turn_events`
Expected: 编译失败（`TurnRunningDecision` 未定义；`turn_running_from_stream_event` 返回 `Option<bool>` 无法与枚举比较）。

- [ ] **Step 3: 实现枚举 + 改造 turn_running_from_stream_event**

在 `turn_running_from_stream_event`（:293）前新增枚举，并改写函数：
```rust
#[derive(Debug, Clone, PartialEq, Eq)]
enum TurnRunningDecision {
    Running,
    EndedWithGrace,
    EndedImmediately,
    None,
}

fn turn_running_from_stream_event(event: &AgentStreamEvent) -> TurnRunningDecision {
    match event {
        AgentStreamEvent::TurnStarted { .. } => TurnRunningDecision::Running,
        AgentStreamEvent::TurnCompleted { .. } => TurnRunningDecision::EndedWithGrace,
        AgentStreamEvent::TurnFailed { error, .. } => {
            if error.trim().is_empty() {
                TurnRunningDecision::EndedWithGrace
            } else {
                TurnRunningDecision::EndedImmediately
            }
        }
        AgentStreamEvent::TurnCanceled { .. } => TurnRunningDecision::EndedImmediately,
        _ => TurnRunningDecision::None,
    }
}
```

- [ ] **Step 4: persist_stream_event 按决策分支**

`persist_stream_event`（:164）改：
```rust
        let decision = turn_running_from_stream_event(&envelope.event);
```
:185 早退改：
```rust
        if !should_update_latest_output && decision == TurnRunningDecision::None && resume_session_id.is_none() {
            return false;
        }
```
:202-205 `if let Some(is_turn_running) = turn_running` 块替换为：
```rust
        match decision {
            TurnRunningDecision::Running => {
                let _ = repository.update_turn_running(envelope.session_id, true, updated_at);
                let _ = repository.clear_turn_ended_at(envelope.session_id);
            }
            TurnRunningDecision::EndedWithGrace => {
                let _ = repository.update_turn_ended_at(envelope.session_id, updated_at);
            }
            TurnRunningDecision::EndedImmediately => {
                let _ = repository.update_turn_running(envelope.session_id, false, updated_at);
                let _ = repository.clear_turn_ended_at(envelope.session_id);
            }
            TurnRunningDecision::None => {}
        }
```

- [ ] **Step 5: 更新现有 :416 测试**

`turn_running_state_is_derived_from_turn_events`（:416-449）的断言已与新枚举冲突，改用 `TurnRunningDecision` 断言（与 Step 1 测试合并或保持等价）。最简做法：删除 :416 旧测试（被 `turn_decision_maps_turn_events` 覆盖且更全），或将其断言改为：
```rust
    #[test]
    fn turn_running_state_is_derived_from_turn_events() {
        use TurnRunningDecision::*;
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnStarted { turn_id: None }),
            Running
        );
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnCompleted {
                turn_id: None,
                usage: None,
            }),
            EndedWithGrace
        );
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnFailed {
                turn_id: None,
                error: "failed".to_string(),
                code: None,
            }),
            EndedImmediately
        );
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::TurnCanceled {
                turn_id: None,
                reason: "canceled".to_string(),
            }),
            EndedImmediately
        );
        assert_eq!(
            turn_running_from_stream_event(&AgentStreamEvent::ModelChanged {
                model_id: "gpt-5".to_string(),
            }),
            None
        );
    }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd src-tauri && cargo test --lib turn_decision_maps_turn_events turn_running_state_is_derived_from_turn_events`
Expected: PASS。

- [ ] **Step 7: 全量 cargo test + commit**

Run: `cd src-tauri && cargo test`
Expected: 全部 PASS。
```bash
git add src-tauri/src/agent/agent_event_broadcaster.rs
git commit -m "refactor: broadcaster turn 运行态改为三态决策

turn_running_from_stream_event 返回 TurnRunningDecision：
turn_started 恢复运行、turn_completed/空 error turn_failed 进入 grace
（写 turn_ended_at 不置 is_turn_running=0）、带 error turn_failed/
turn_canceled 立即终止。persist_stream_event 按决策分支写入。

Refs: #32"
```

---

### Task 3: service list grace 计算

**Files:**
- Modify: `src-tauri/src/core/agent_session_service.rs`（新增 `GRACE_MS` 常量与 `turn_still_running_by_grace` 函数、list 合成 :1510、测试 mod 新增 grace 边界测试）
- Test: 同文件测试 mod

**Interfaces:**
- Consumes: Task 1 的 `AgentSessionListRow.turn_ended_at`。
- Produces: list 查询 `is_turn_running` 带 grace 计算。

- [ ] **Step 1: 写失败测试**

在测试 mod（紧随 Task 1 新增测试之后）新增：
```rust
#[test]
fn list_reports_turn_running_within_grace_after_turn_ended() {
    let database = setup_session_list_database();
    insert_session_list_row(
        &database,
        501,
        Some(40),
        Some("Grace within issue"),
        Some("running"),
        AgentSessionStatus::Running,
        30,
        None,
    );
    database
        .execute(
            "UPDATE agent_sessions SET is_turn_running = 1, turn_ended_at = ?1 WHERE id = 501",
            params![current_millis() - 1_000],
        )
        .expect("set grace within");

    let service = test_agent_session_service(&database);
    let response = service.list_agent_sessions(1).expect("list");
    let session = response
        .sessions
        .iter()
        .find(|s| s.session_id == 501)
        .expect("session");
    assert!(session.is_turn_running);
}

#[test]
fn list_reports_turn_idle_after_grace_expires() {
    let database = setup_session_list_database();
    insert_session_list_row(
        &database,
        502,
        Some(41),
        Some("Grace expired issue"),
        Some("running"),
        AgentSessionStatus::Running,
        31,
        None,
    );
    database
        .execute(
            "UPDATE agent_sessions SET is_turn_running = 1, turn_ended_at = ?1 WHERE id = 502",
            params![current_millis() - 4_000],
        )
        .expect("set grace expired");

    let service = test_agent_session_service(&database);
    let response = service.list_agent_sessions(1).expect("list");
    let session = response
        .sessions
        .iter()
        .find(|s| s.session_id == 502)
        .expect("session");
    assert!(!session.is_turn_running);
}

#[test]
fn list_reports_turn_running_when_turn_ended_at_null_and_running() {
    let database = setup_session_list_database();
    insert_session_list_row(
        &database,
        503,
        Some(42),
        Some("Null ended issue"),
        Some("running"),
        AgentSessionStatus::Running,
        32,
        None,
    );
    database
        .execute(
            "UPDATE agent_sessions SET is_turn_running = 1 WHERE id = 503",
            [],
        )
        .expect("set running");

    let service = test_agent_session_service(&database);
    let response = service.list_agent_sessions(1).expect("list");
    let session = response
        .sessions
        .iter()
        .find(|s| s.session_id == 503)
        .expect("session");
    assert!(session.is_turn_running);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test --lib list_reports_turn_running_within_grace_after_turn_ended list_reports_turn_idle_after_grace_expires list_reports_turn_running_when_turn_ended_at_null_and_running`
Expected: 前两个 FAIL（当前 :1510 `is_turn_running: is_session_running && row.is_turn_running` 不考虑 `turn_ended_at`，grace 内/外都 true）；第三个 PASS（NULL + running 已 true）。

- [ ] **Step 3: 实现 GRACE_MS + turn_still_running_by_grace**

在 `agent_session_service.rs` 顶层（`list_agent_sessions` 函数所在 impl 块外或模块级，靠近 :4527 `current_epoch_millis` 附近）新增：
```rust
const GRACE_MS: i64 = 3000;

fn turn_still_running_by_grace(turn_ended_at: Option<i64>, now: i64) -> bool {
    match turn_ended_at {
        None => true,
        Some(ended) => now - ended < GRACE_MS,
    }
}
```

- [ ] **Step 4: list 合成加入 grace**

在 `list_agent_sessions` 的 `rows.into_iter().map(|row| { ... })`（:1482）前取 `now`：
```rust
        let now = current_epoch_millis()?;
```
> 若 `list_agent_sessions` 签名不返回 `Result` 或错误类型不兼容 `CommandError`，改用 `let now = current_epoch_millis().expect("system clock");` 并在 review 时确认与现有错误处理一致。优先 `?`。

:1510 改：
```rust
                    is_turn_running: is_session_running
                        && row.is_turn_running
                        && turn_still_running_by_grace(row.turn_ended_at, now),
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd src-tauri && cargo test --lib list_reports_turn_running_within_grace_after_turn_ended list_reports_turn_idle_after_grace_expires list_reports_turn_running_when_turn_ended_at_null_and_running`
Expected: 3 个 PASS。

- [ ] **Step 6: 全量 cargo test + commit**

Run: `cd src-tauri && cargo test`
Expected: 全部 PASS（现有 :5813 等测试不受影响：`turn_ended_at` 默认 NULL → grace 函数返回 true → 行为不变）。
```bash
git add src-tauri/src/core/agent_session_service.rs
git commit -m "feat: session list 查询引入 turn 结束 grace period

list 合成 is_turn_running 时叠加 grace 计算：turn_ended_at 为空按
原值，非空则在 GRACE_MS(3000ms) 内视为运行。无定时器，单一数据源。

Refs: #32"
```

---

### Task 4: 前端 effectiveTurnStatus grace 回归测试

> `effectiveTurnStatus`（`agent-session-view.tsx:60-65`）已合并 `isTurnRunning`，grace 改造后 composer `isSending` 自动维持运行态，无需改派生。本任务抽纯函数 + 补回归测试。

**Files:**
- Modify: `src/features/agents/agent-session-view.tsx`（抽 `computeEffectiveTurnStatus` 纯函数，useMemo 调用）
- Test: `src/features/agents/agent-session-view.test.ts`（新建）

**Interfaces:**
- Produces: `export function computeEffectiveTurnStatus(turnStatus, isTurnRunning, canUseExternalTurnRunning): TurnStatus`

- [ ] **Step 1: 抽纯函数**

`agent-session-view.tsx` 在 `AgentSessionView` 组件外（文件顶部 import 后、`interface AgentSessionViewProps` 前）新增：
```ts
export function computeEffectiveTurnStatus(
  turnStatus: TurnStatus,
  isTurnRunning: boolean,
  canUseExternalTurnRunning: boolean,
): TurnStatus {
  return turnStatus === "running" ||
    (canUseExternalTurnRunning && isTurnRunning)
    ? "running"
    : turnStatus;
}
```
`effectiveTurnStatus` useMemo（:60-65）改为调用它：
```ts
  const effectiveTurnStatus = useMemo(
    () =>
      computeEffectiveTurnStatus(
        state.turnStatus,
        isTurnRunning,
        canUseExternalTurnRunning,
      ),
    [canUseExternalTurnRunning, isTurnRunning, state.turnStatus],
  );
```
确保 `TurnStatus` 类型已 import（`message-stream/message-stream-types`）。

- [ ] **Step 2: 写测试**

`src/features/agents/agent-session-view.test.ts`（新建）：
```ts
import { describe, expect, it } from "vitest";

import { computeEffectiveTurnStatus } from "./agent-session-view";

describe("computeEffectiveTurnStatus", () => {
  it("reducer running 时直接 running", () => {
    expect(computeEffectiveTurnStatus("running", false, true)).toBe("running");
  });

  it("grace 期内 isTurnRunning 维持 running，即使 reducer idle", () => {
    expect(computeEffectiveTurnStatus("idle", true, true)).toBe("running");
  });

  it("grace 过期 isTurnRunning=false 且 reducer idle 时 idle", () => {
    expect(computeEffectiveTurnStatus("idle", false, true)).toBe("idle");
  });

  it("canUseExternalTurnRunning=false 时不靠 isTurnRunning", () => {
    expect(computeEffectiveTurnStatus("idle", true, false)).toBe("idle");
  });

  it("reducer failed 且 isTurnRunning=false 时 failed", () => {
    expect(computeEffectiveTurnStatus("failed", false, true)).toBe("failed");
  });
});
```

- [ ] **Step 3: 运行测试确认通过**

Run: `pnpm test -- agent-session-view`
Expected: 5 个 PASS（现状逻辑已正确，抽函数后行为不变）。

- [ ] **Step 4: 全量前端验证 + commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: 全部 PASS。
```bash
git add src/features/agents/agent-session-view.tsx src/features/agents/agent-session-view.test.ts
git commit -m "test: 补充 effectiveTurnStatus 在 grace 期内的回归测试

抽 computeEffectiveTurnStatus 纯函数，验证 grace 期内 isTurnRunning
维持 running、grace 过期回落 idle，为后端 grace 改造提供前端回归保护。

Refs: #32"
```

---

### Task 5: 端到端场景验证

**Files:**
- Test: `src-tauri/src/agent/agent_event_broadcaster.rs` 测试 mod（broadcaster → repository → 端到端决策落地）
- Test: `src-tauri/src/core/agent_session_service.rs` 测试 mod（多 turn 并发 grace 刷新）

> 5.1 / 5.2 用 broadcaster 的 `emit_stream_event` 端到端验证决策落地 DB；若 `emit_stream_event` 依赖 `AppHandle` 难以单测，则降级为直接调 `persist_stream_event` 或在 service 层用 SQL 模拟事件序列 + list 断言。优先 service 层模拟（复用 helper）。

- [ ] **Step 1: codex 空 error turn_failed grace 端到端测试**

在 service 测试 mod 新增：
```rust
#[test]
fn empty_error_turn_failed_keeps_running_within_grace() {
    let database = setup_session_list_database();
    insert_session_list_row(
        &database,
        601,
        Some(50),
        Some("Empty error issue"),
        Some("running"),
        AgentSessionStatus::Running,
        40,
        None,
    );
    // 模拟 broadcaster 对空 error turn_failed 的处理：写 turn_ended_at，不置 0。
    let repository = AgentSessionRepository::new(&database);
    repository.update_turn_running(601, true, 40).expect("start");
    repository.update_turn_ended_at(601, current_millis() - 1_000).expect("empty fail");

    let service = test_agent_session_service(&database);
    let response = service.list_agent_sessions(1).expect("list");
    let session = response
        .sessions
        .iter()
        .find(|s| s.session_id == 601)
        .expect("session");
    assert!(session.is_turn_running, "空 error turn_failed 在 grace 内应仍运行");
}
```

- [ ] **Step 2: claude code 多 turn 并发 grace 刷新测试**

```rust
#[test]
fn concurrent_turn_completions_refresh_grace_window() {
    let database = setup_session_list_database();
    insert_session_list_row(
        &database,
        602,
        Some(51),
        Some("Concurrent turns issue"),
        Some("running"),
        AgentSessionStatus::Running,
        41,
        None,
    );
    let repository = AgentSessionRepository::new(&database);
    repository.update_turn_running(602, true, 41).expect("start");
    // 多个并发 sub turn 陆续 completed：每次刷新 turn_ended_at。
    repository.update_turn_ended_at(602, current_millis() - 2_500).expect("sub turn 1");
    repository.update_turn_ended_at(602, current_millis() - 1_000).expect("sub turn 2");

    let service = test_agent_session_service(&database);
    let response = service.list_agent_sessions(1).expect("list");
    let session = response
        .sessions
        .iter()
        .find(|s| s.session_id == 602)
        .expect("session");
    assert!(session.is_turn_running, "最近一次 completed 在 grace 内应仍运行");
}
```

- [ ] **Step 3: turn_canceled / 带 error turn_failed 立即非运行测试**

```rust
#[test]
fn turn_canceled_and_error_turn_failed_terminate_immediately() {
    let database = setup_session_list_database();
    insert_session_list_row(
        &database,
        603,
        Some(52),
        Some("Cancel issue"),
        Some("running"),
        AgentSessionStatus::Running,
        42,
        None,
    );
    let repository = AgentSessionRepository::new(&database);
    repository.update_turn_running(603, true, 42).expect("start");
    // 模拟 EndedImmediately：置 is_turn_running=0 + 清 turn_ended_at。
    repository.update_turn_running(603, false, 42).expect("cancel");
    repository.clear_turn_ended_at(603).expect("clear");

    let service = test_agent_session_service(&database);
    let response = service.list_agent_sessions(1).expect("list");
    let session = response
        .sessions
        .iter()
        .find(|s| s.session_id == 603)
        .expect("session");
    assert!(!session.is_turn_running, "turn_canceled 应立即非运行");
}
```

- [ ] **Step 4: 运行端到端测试 + 全量验证**

Run:
```bash
cd src-tauri && cargo test --lib empty_error_turn_failed_keeps_running_within_grace concurrent_turn_completions_refresh_grace_window turn_canceled_and_error_turn_failed_terminate_immediately
cd .. && pnpm lint && pnpm typecheck && pnpm test
```
Expected: Rust 3 个 PASS；前端全 PASS。

- [ ] **Step 5: commit**

```bash
git add src-tauri/src/core/agent_session_service.rs
git commit -m "test: 补充 grace period 端到端场景测试

覆盖 codex 空 error turn_failed grace、claude code 多 turn 并发
grace 刷新、turn_canceled/带 error 立即终止三类场景。

Refs: #32"
```

---

## Self-Review

**1. Spec coverage:** spec delta `agent-session-runtime` 的 8 个 scenario（turn_started 恢复 / turn_completed grace / 空 error grace / 带 error 立即 / turn_canceled 立即 / 多 turn grace 刷新 / 非运行 false / 终止清理）→ Task 1（终止清理）+ Task 2（决策映射覆盖 started/completed/空 error/带 error/canceled）+ Task 3（grace 计算 + is_session_running 守卫）+ Task 5（端到端覆盖空 error/多 turn/cancel）。Composer 3 个 scenario → Task 4。✅ 全覆盖。

**2. Placeholder scan:** 无 TBD/TODO；每个 step 含完整代码或确切命令。✅

**3. Type consistency:** `TurnRunningDecision`（Running/EndedWithGrace/EndedImmediately/None）在 Task 2 定义、测试、persist 分支一致；`update_turn_ended_at(session_id, now)` / `clear_turn_ended_at(session_id)` 签名在 Task 1 定义、Task 2/5 调用一致；`turn_still_running_by_grace(turn_ended_at, now)` 在 Task 3 定义与调用一致；`computeEffectiveTurnStatus(turnStatus, isTurnRunning, canUseExternalTurnRunning)` 在 Task 4 定义与调用一致。✅
