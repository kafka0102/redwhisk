# Proposal: 关闭终端删日志 + 删除 Issue 清理 session/worktree

## Why

1. **关闭 Project Terminal 时日志残留**：`close_terminal` 会 kill PTY 并从内存 registry 移除 session，但不会删除 `project-terminal-logs/project-{id}-terminal-{sessionId}.log`。关闭后磁盘上仍有日志文件。
2. **删除 Issue 清理不完整**：`delete_issue` 仅 soft-delete issue 与 linked session，并在 command 层对 linked session 做 `pty_sessions.kill`。对比 `delete_standalone_session` / `shutdown_runtime_session`，当前缺少：
   - `AgentSessionRegistry` 注销与 `handle.shutdown()`
   - session log 文件删除（runtime / archive）
   - RedWhisk 管理的 worktree 与临时分支清理
   - 删除结果中缺少清理上下文（log path / worktree 元数据）供 command 层彻底收尾

## What Changes

### 1. 关闭 Project Terminal 时删除日志

- `ProjectTerminalService::close_terminal` 在 `registry.remove` 成功后，删除该 session 的 `log_path` 文件。
- 文件不存在或删除失败时静默跳过，不阻塞关闭。
- 补充单测：关闭后日志文件不存在。

### 2. 删除 Issue 时完整清理 session / worktree / log / 内存

在 `IssueService::delete_issue` 事务内：

- 继续 soft-delete linked session（running 先 mark closed）与 issue。
- 在 soft-delete 前收集清理上下文：`linked_session_id`、`linked_session_log_path`、worktree 元数据（`workspace_path` / `workspace_branch` / `worktree_owner` / `repo_path`）。

事务提交后 / command 层：

- 删除 session log 文件（`remove_session_log_file`）。
- 若 worktree 由 RedWhisk 管理且路径仍存在，调用 `cleanup_worktree` 删除 worktree 与临时分支。
- 使用 `shutdown_runtime_session` 等价路径：`pty_sessions.kill` + `agent_sessions.unregister` + `handle.shutdown`。

非目标：

- 不清理与该 issue 无关的 project terminal / standalone session。
- 不强制删除外部（非 RedWhisk）worktree。
- 不改变 soft-delete 语义（DB 行仍 soft-delete，不 hard-delete）。
- 不在前端做额外清理逻辑；清理由后端统一完成。

## Impact

- Affected code:
  - `src-tauri/src/core/project_terminal_service.rs`（`close_terminal`）
  - `src-tauri/src/core/issue_service.rs`（`delete_issue` 收集清理上下文）
  - `src-tauri/src/commands/issue_commands.rs`（删除后 runtime / log / worktree 清理）
  - `src-tauri/src/types/issue.rs`（`DeleteIssueResult` 扩展清理字段，如需要）
- Specs: `project-terminals`、`agent-session-runtime`、`issues-ui`
- 验证：`cd src-tauri && cargo test`；相关前端若无改动可不强制全量前端测试
