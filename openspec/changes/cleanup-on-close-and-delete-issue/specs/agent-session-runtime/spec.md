# agent-session-runtime Specification Delta

## ADDED Requirements

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
