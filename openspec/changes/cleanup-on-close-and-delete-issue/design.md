# Design: 关闭终端删日志 + 删除 Issue 清理

## Context

- Project Terminal 每次 spawn 都会 `File::create` 日志到 `data_dir/project-terminal-logs/...`。
- Agent Session 有 runtime/archive log path；standalone 删除已调用 `remove_session_log_file`。
- Issue 删除目前只 soft-delete DB 并 `pty_sessions.kill` linked session，不处理 structured agent handle、log 文件、worktree。

## Goals / Non-Goals

**Goals**

- 关闭终端后磁盘不残留该 terminal 的 log 文件。
- 删除 issue 后不残留：linked session 内存句柄、PTY、session log、RedWhisk worktree。

**Non-Goals**

- 不 hard-delete DB 行。
- 不清理 external worktree。
- 不主动关闭与 issue 无绑定关系的 project terminal。
- 不改前端删除确认交互。

## Decisions

### D1. Terminal log 删除放在 service `close_terminal`

`registry.remove` 已返回含 `log_path` 的 session，service 层删除最直接；delete config 路径也会 kill/remove session，但 config 删除不经过 `close_terminal`。

**补充**：`delete_project_terminal_config` 与 `remove_sessions_by_config_id` 路径也应删除对应 log，避免只修 close 漏掉删 config。实现时统一抽 `remove_terminal_log_file(path)`，在：

- `close_terminal`
- `delete_project_terminal_config`（kill 后 remove sessions 时）
- create/spawn 失败回滚 remove session 时（可选，避免失败残留空日志）

中调用。

### D2. Issue 删除清理分「事务内收集 + 事务外副作用」

DB 事务内只做状态变更与审计；磁盘/worktree/PTY/registry 属于事务外副作用，与现有 `delete_standalone_session`（事务后删 log）一致。

`DeleteIssueResult` 扩展字段建议：

```rust
pub struct DeleteIssueResult {
  pub issue_id: i64,
  pub linked_session_id: Option<i64>,
  pub linked_session_log_path: Option<String>,
  pub worktree_cleanup: Option<DeleteIssueWorktreeCleanup>,
}

pub struct DeleteIssueWorktreeCleanup {
  pub repo_path: String,
  pub workspace_path: String,
  pub workspace_branch: String,
  pub worktree_owner: WorktreeOwner, // 或 string
}
```

command 层：

1. `delete_issue_in_data_dir`
2. `shutdown_runtime_session(pty, agent_registry, session_id)`
3. `remove_session_log_file(log_path)`
4. 若 `worktree_cleanup` 且 owner=Redwhisk 且 path exists → `cleanup_worktree`

### D3. Worktree 来源

优先使用 linked session 上的 worktree 字段；若 issue 无 linked session 但历史 session 仍有 RedWhisk worktree，可用 `find_latest_worktree_session_by_issue_id`（与 `delete_issue_worktree` 一致）。为控制范围，本 change 默认：

- 以 **即将 soft-delete 的 linked session** 为主；
- 若 linked session 无 worktree 元数据，再查 latest worktree session（含已关闭但未删 worktree 的情况）。

### D4. 失败策略

- log 删除失败：静默。
- worktree 清理失败：记录/返回错误会阻塞删除结果；优先与 `delete_issue_worktree` 一致——失败应向上返回还是 best-effort？
  - **选择 best-effort**：issue 已 soft-delete 成功后，worktree 清理失败不回滚 issue 删除，但应打日志；避免用户无法删 issue。
  - runtime shutdown 同样 best-effort。

## Risks

- worktree 被外部进程占用导致删除失败 → best-effort + 日志。
- `DeleteIssueResult` 字段扩展需同步 TS 类型与 command-client 测试。
- 删除 config 时多个 session 共享 config_id，需逐个删 log。

## Migration Plan

无 DB migration。纯运行时清理行为变更。
