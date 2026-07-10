# agent-session-runtime Specification

## Purpose
TBD - created by archiving change session-running-state-grace. Update Purpose after archive.
## Requirements
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

### Requirement: Composer 运行态在 grace 期内维持

Composer 发送按钮的运行态 SHALL 通过 `effectiveTurnStatus` 维持，`effectiveTurnStatus` SHALL 合并 session 级 `is_turn_running`（已带 grace）。turn 终结事件使消息流 reducer 的 `turnStatus` 离开 `running` 后，只要 `is_turn_running` 仍处于 grace 期内，Composer SHALL 保持运行态。

#### Scenario: turn 终结后 grace 期内 Composer 保持运行态

- **WHEN** Agent Session 收到 `turn_completed` 或空 error 的 `turn_failed`
- **AND** 消息流 reducer 的 `turnStatus` 变为 `idle`
- **AND** `is_turn_running` 仍在 grace 期内（list 查询返回 true）
- **THEN** Composer 发送按钮保持运行态（取消按钮）
- **AND** Composer 不闪现「完成」

#### Scenario: grace 过期后 Composer 离开运行态

- **WHEN** `is_turn_running` 超过 grace 期（list 查询返回 false）
- **AND** 消息流 reducer 的 `turnStatus` 为 `idle`
- **THEN** Composer 显示发送按钮

#### Scenario: 本地提交锁保留

- **WHEN** 用户点击发送
- **THEN** 本地 `isSubmitting` 锁置 true
- **AND** 在 `is_turn_running` 回流为 true 之前，提交按钮保持运行态
- **AND** `is_turn_running` 回流后由 `effectiveTurnStatus` 接管运行态

### Requirement: Deleting an issue cleans up linked agent session runtime

删除 Issue 时，系统 SHALL 清理其 linked Agent Session 的运行时资源，包括 PTY（如有）、结构化 agent handle 内存注册与 session log 文件。

#### Scenario: Deleting an issue with a running structured session

- **WHEN** 用户删除一个关联了 running Agent Session 的 Issue
- **THEN** 后端将 session 标记为 closed 并 soft-delete
- **AND** 后端从 `AgentSessionRegistry` 注销并 shutdown 该 session handle
- **AND** 后端 kill 对应 PTY（若存在）
- **AND** 后端删除该 session 的 log 文件

#### Scenario: Deleting an issue with a closed session still removes log

- **WHEN** 用户删除一个关联了非 running Agent Session 的 Issue
- **AND** 该 session 仍有 log 文件
- **THEN** 后端 soft-delete session
- **AND** 后端删除该 session 的 log 文件
- **AND** 后端确保内存 registry 中不残留该 session handle

### Requirement: Deleting an issue cleans up RedWhisk-managed worktree

删除 Issue 时，若其关联 session 使用 RedWhisk 管理的 worktree，系统 SHALL 删除该 worktree 目录与对应临时分支。

#### Scenario: Deleting an issue with a RedWhisk worktree

- **WHEN** 用户删除 Issue
- **AND** 关联 session 的 `worktree_owner` 为 RedWhisk
- **AND** `workspace_path` 仍存在
- **THEN** 后端删除该 worktree 与对应 workspace branch

#### Scenario: Deleting an issue with an external worktree leaves it untouched

- **WHEN** 用户删除 Issue
- **AND** 关联 session 的 worktree 非 RedWhisk 管理
- **THEN** 后端不删除该 worktree 目录或分支

#### Scenario: Worktree cleanup failure does not roll back issue deletion

- **WHEN** Issue 与 session 已 soft-delete 成功
- **AND** worktree 清理失败
- **THEN** 删除 Issue 的结果仍视为成功
- **AND** 系统不回滚已完成的 soft-delete

