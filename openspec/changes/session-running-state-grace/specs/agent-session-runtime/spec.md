# agent-session-runtime Specification Delta

## ADDED Requirements

### Requirement: Session turn running state

系统 SHALL 以 session 级单一布尔 `is_turn_running` 表示 Agent Session 当前是否有 turn 在运行，并 SHALL 在 list 查询时由 `turn_ended_at` 与当前时间计算 grace period，避免 turn 间过渡或瞬态失败导致运行态误判。`GRACE_MS` 默认为 `3000` 毫秒。

#### Scenario: turn_started 恢复运行态

- **WHEN** Agent Session 收到 `turn_started` 事件
- **THEN** 系统置 `is_turn_running=1`
- **AND** 系统清空 `turn_ended_at`
- **AND** list 查询返回的 `is_turn_running` 为 true

#### Scenario: turn_completed 进入 grace

- **WHEN** Agent Session 收到 `turn_completed` 事件
- **THEN** 系统写入 `turn_ended_at` 为当前时间戳
- **AND** 系统不立即置 `is_turn_running=0`
- **AND** 在 `GRACE_MS` 内的 list 查询返回 `is_turn_running=true`
- **AND** 超过 `GRACE_MS` 后的 list 查询返回 `is_turn_running=false`

#### Scenario: 空 error 的 turn_failed 进入 grace

- **WHEN** Agent Session 收到 `turn_failed` 事件
- **AND** 其 `error` 字段为空串或纯空白
- **THEN** 系统按 `turn_completed` 同样处理
- **AND** 系统写入 `turn_ended_at` 为当前时间戳
- **AND** 系统不立即置 `is_turn_running=0`

#### Scenario: 带 error 的 turn_failed 立即终止

- **WHEN** Agent Session 收到 `turn_failed` 事件
- **AND** 其 `error` 字段非空
- **THEN** 系统立即置 `is_turn_running=0`
- **AND** 系统清空 `turn_ended_at`

#### Scenario: turn_canceled 立即终止

- **WHEN** Agent Session 收到 `turn_canceled` 事件
- **THEN** 系统立即置 `is_turn_running=0`
- **AND** 系统清空 `turn_ended_at`

#### Scenario: 多 turn 并发的 grace 刷新

- **WHEN** Agent Session 有多个并发 turn（如 claude code sub agent 各自独立 turn）
- **AND** 多个 turn 陆续发出 `turn_completed`
- **THEN** 每次 `turn_completed` 刷新 `turn_ended_at` 为当前时间
- **AND** 只要最近一次 `turn_completed` 在 `GRACE_MS` 内，list 查询返回 `is_turn_running=true`

#### Scenario: Session 非运行时运行态为 false

- **WHEN** Agent Session 的 `status` 不是 `running`（如 stopped / crashed）
- **THEN** list 查询返回 `is_turn_running=false`
- **AND** grace 计算不生效（受 `is_session_running` 守卫）

#### Scenario: Session 终止时清理 grace 状态

- **WHEN** Agent Session 被 `mark_terminated` 终止
- **THEN** 系统置 `is_turn_running=0`
- **AND** 系统清空 `turn_ended_at`

### Requirement: Composer 运行态派生

Composer 发送按钮的运行态 SHALL 从 session 级 `is_turn_running`（已带 grace）派生，不再从消息流 reducer 的 `turnStatus` 派生。

#### Scenario: 发送按钮随 isTurnRunning 切换

- **WHEN** `isTurnRunning=true`
- **THEN** Composer 显示取消按钮
- **AND** 提交按钮处于运行态

- **WHEN** `isTurnRunning=false`
- **THEN** Composer 显示发送按钮

#### Scenario: 本地提交锁保留

- **WHEN** 用户点击发送
- **THEN** 本地 `isSubmitting` 锁置 true
- **AND** 在 `isTurnRunning` 回流为 true 之前，提交按钮保持运行态
- **AND** `isTurnRunning` 回流后由 `isTurnRunning` 接管运行态
