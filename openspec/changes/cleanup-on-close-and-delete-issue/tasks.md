# Tasks: 关闭终端删日志 + 删除 Issue 清理

## 1. 关闭 Project Terminal 删除日志

- [x] 1.1 `close_terminal` 在 registry remove 后删除 session `log_path`（不存在/失败静默）
- [x] 1.2 单测：创建终端产生日志后 close，日志文件被删除
- [x] 1.3 `delete_project_terminal_config` 删除关联 session 日志

## 2. 删除 Issue 收集清理上下文

- [x] 2.1 扩展 `DeleteIssueResult` 返回 linked session log path 与 worktree 清理元数据
- [x] 2.2 `IssueService::delete_issue` 在 soft-delete 前收集 session log path、worktree owner/path/branch、project repo path
- [x] 2.3 保持既有 soft-delete / running session mark closed / issue action 审计行为

## 3. 删除 Issue 后执行清理

- [x] 3.1 command 层对 linked session 调用完整 runtime shutdown：`pty kill` + `agent_sessions.unregister` + `handle.shutdown`
- [x] 3.2 删除 session log 文件
- [x] 3.3 若 worktree 为 RedWhisk 管理且目录存在，调用 `cleanup_worktree`（best-effort）
- [x] 3.4 单测：删除 issue 返回 session log / worktree cleanup；external worktree 不返回 cleanup

## 4. 验证

- [x] 4.1 `cargo test --lib close_terminal_removes_session_log_file` / `delete_issue_` / `project_terminal_service::tests` 通过
- [x] 4.2 `pnpm typecheck` 通过
- [x] 4.3 `openspec validate cleanup-on-close-and-delete-issue --strict`
