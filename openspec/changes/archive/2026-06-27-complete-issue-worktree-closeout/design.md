## 现状

当前 `AgentSessionRecord` 已记录 `workspace_mode`、`target_branch`、`workspace_branch`、`workspace_path` 和 `completion_policy`，但没有记录 session 启动时的原始分支，也没有持久化“完成流程进行到哪一步”。前端 `completeIssueWithCompletionChecks` 只覆盖 running/review 且 session 仍 running 的路径；其它切换到 `completed` 的路径仍可能落到 `advanceIssueStatus`，绕过 worktree 收尾。

`src-tauri/src/git/worktree.rs` 当前通过 `git merge --no-ff --no-edit` 合入临时分支。新需求要求先 rebase 基线分支，并使用 rebase 式合入，不再使用普通 merge commit。

## 关键设计

### 1. Session 启动快照

新增 session 启动快照字段：

- `origin_branch`：创建本次 session 时所在工作区分支。
- `worktree_owner`：`redwhisk` 或 `external`，用于区分 RedWhisk 创建的 worktree 和用户/外部 workflow 创建的 worktree。

对现有 worktree session 可用 `workspace_mode = worktree` 且 `workspace_path/workspace_branch` 已存在推断为 `redwhisk`；无法证明时按 `external` 或需要确认处理，避免误删用户 worktree。

### 2. Completion flow 状态

新增持久化表记录 Issue 完成流程，例如 `issue_completion_flows`：

- `issue_id`、`session_id`
- `phase`：`checking_dirty`、`waiting_agent_commit`、`manual_dirty_blocked`、`checking_branch`、`confirming_external_worktree`、`rebasing`、`agent_merge_blocked`、`completed`
- `ignore_dirty`、`external_worktree_decision`
- `base_branch`、`workspace_branch`、`workspace_path`
- `failure_reason`
- `updated_at`

该表不是新业务状态枚举，只是完成流程断点。再次点击完成时，后端根据该记录与当前 Git 状态恢复或重新判定。

### 3. 统一完成入口

状态菜单选择 `completed`、Review 页 Done 按钮和 auto-commit 检测完成都调用同一个后端 completion orchestration。后端必须在写入 Issue `completed` 前完成：

1. 读取 session 的工作目录，而不是始终读取 project repo。
2. 检查 Git operation 是否进行中。
3. 检查 dirty 状态并按 completion policy 处理。
4. 检查当前分支是否等于 session 启动基线；相同则无需 worktree 收尾。
5. 如果是 worktree，则按 owner 决定自动收尾或请求用户确认。
6. 收尾成功后关闭 session、写审计、写 `completion_attempts`。

### 4. Rebase 式 worktree 收尾

RedWhisk 创建的 worktree：

1. 在 worktree 分支执行 `git fetch` 不作为默认行为，避免引入网络依赖；只基于本地目标分支。
2. 在 workspace 分支执行 `git rebase <target_branch>`。
3. rebase 成功后切到 target branch，并使用 `git merge --ff-only <workspace_branch>` 或等价 fast-forward 合入。
4. 合入成功后删除 worktree 和临时分支。
5. rebase 或 fast-forward 失败时，不删除 worktree；记录断点并向 Agent 注入合并 prompt。

外部 worktree：

- 前端先询问用户是否合入并删除。
- 选择“是”后执行同样 rebase/fast-forward 流程，但只有确认后才删除。
- 选择“否”时跳过合入与清理，直接完成 Issue。
- 选择“取消”时记录暂停状态，不完成 Issue。

### 5. 用户交互与恢复

前端根据后端返回的 flow state 展示弹窗或进度，不把流程真相只存在 React 内存中。用户选择手动处理 dirty、取消外部 worktree 合入或 Agent 合并失败时，后端记录阻塞阶段；应用重启后再次打开 Issue 或再次点击完成，可以从该状态继续或重新检查当前 Git 状态。

## 取舍

- 完成流程状态放 SQLite，而不是只存在前端内存；这是为了满足重启恢复。
- 不使用 `git merge --no-ff`，避免创建普通 merge commit；合入语义以 rebase 后 fast-forward 为准。
- 不自动处理用户外部 worktree，除非用户明确确认，避免误删用户自行创建的工作区。
