# Worktree 与 Git 生命周期

本文档约束 Issue 在当前分支或隔离 worktree 中执行及其完成流程。实现入口为 `src-tauri/src/git/worktree.rs`、`core/agent_session_service.rs`、`core/issue_service.rs` 与 `types/issue_completion.rs`。

## 执行空间

| 模式              | 工作目录                                       | 分支/所有权                                           | 适用情况                       |
| ----------------- | ---------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| `current_branch`  | 项目仓库                                       | 当前分支，非 RedWhisk 管理 worktree                   | 用户选择直接在现有工作区执行   |
| `worktree`        | 由 `projects.worktree_location` 决定的独立目录 | 默认 `issue-{issueNumber}`；`worktree_owner=redwhisk` | 隔离执行 Issue                 |
| external worktree | provider 实际 cwd 或已存在 worktree            | `worktree_owner=external`                             | 检测到执行路径漂移或外部工作区 |

`id` 仍是跨边界寻址键；项目内 `number` 只用于展示、日志与 worktree 命名，必须保持不可逆且项目内唯一。

## 创建与清理

1. 创建隔离会话前确定 target branch、worktree root 和 setup command。
2. `git worktree add -B issue-{issueNumber}` 创建工作区；目录冲突会产生明确阻断，不得静默复用未知目录。
3. 仅 `worktree_owner=redwhisk` 的工作区可由应用执行 `worktree remove --force`、删除分支和 `worktree prune`。
4. 外部工作区必须通过完成 flow 明示确认；不得删除用户拥有的目录或分支。

## 完成 flow

完成不再由 `completion_policy` 决定。当前 `IssueCompletionPhase` 是：

```text
detecting_workspace
  → prompting_dirty_decision → auto_committing → confirming_continue_after_commit
  → reconciling_worktree → confirming_worktree_cleanup → completed
  └→ cancelled
  └→ blocked
```

未提交改动的选择为 `auto_commit`、`skip`、`cancel`。自动提交是向关联 Agent 注入明确 completion 指令并检测 Git 结果，不是应用执行 `git add .` 或静默提交。

## Git 安全边界

- 变基或 fast-forward 前必须检查 target 与 workspace 均干净。
- 检测到 merge、rebase、cherry-pick、revert、sequencer 或未合并状态时，流程进入阻断/需人工处理路径。
- `rebase_and_fast_forward` 只能在干净的 RedWhisk 管理路径上执行；失败不可自动掩盖或改写历史。
- workspace inspector 读取文件时必须使用仓库内相对路径、canonical path 检查和符号链接越界防护；不要把用户传入路径直接交给文件系统。
- Issue 删除仅对 RedWhisk 所有且存在的 worktree 做 best-effort 清理；保留删除结果给 UI 反馈。

## 修改检查清单

- 新状态是否加入 Rust enum、migration CHECK、repository、UI action 和审计记录？
- 是否区分实际执行路径、启动快照和 worktree owner？
- 是否覆盖 dirty、冲突、Git operation、外部 worktree、清理取消与重试？
- 是否从不执行广泛暂存或无提示的 destructive Git 操作？
