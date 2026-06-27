## Why

实测发现，Issue 从状态菜单切换到 `completed` 时，部分路径会直接调用通用状态推进，把 Issue 标为完成，但没有执行完成前 Git 检查、worktree 合入、临时分支清理或失败断点记录。对于 worktree 模式开发的 Issue，这会留下未合入代码和未清理 worktree。

现有规格已经定义了 worktree merge-back，但当前行为还缺少两个关键约束：

- 完成入口必须统一经过可恢复的 completion flow，不能让状态切换绕过收尾状态机。
- runtime 必须能区分 session 启动时所在分支、应用创建的 worktree、用户外部创建的 worktree，并在用户选择手动处理或应用重启后继续完成流程。

## What Changes

- 启动 Agent session 时记录当前工作区分支和 worktree 归属信息，作为完成时判断基线。
- 用户把 Issue 状态切换为 `completed` 时，统一进入 completion orchestration：先检查当前 session 所在工作区是否有未提交代码，再处理分支/worktree 收尾，最后才写入 `completed`。
- 未提交代码处理遵循 session 的 completion policy 快照：
  - `agent_auto_commit`：向关联 Agent session 注入自动提交 prompt，记录等待状态并等待后续检测。
  - `manual`：弹窗提示本地存在未提交代码，用户可选择忽略继续，或手动处理后再次点击完成继续。
- worktree 收尾区分两类来源：
  - RedWhisk 创建的 worktree：先 rebase 到记录的目标分支；成功后以 rebase/fast-forward 语义合入目标分支；失败时把合并任务交给 Agent session 并暂停完成。
  - 用户外部创建的 worktree：弹窗询问是否合入并删除 worktree；选择是则执行同类流程，选择否则直接标记完成，选择取消则暂停等待用户处理。
- 引入持久化 completion state，记录当前完成流程阶段、用户选择和阻塞原因，保证应用重启后可恢复或重新开始同一完成流程。
- 所有完成尝试继续写入 `completion_attempts` 与 Issue/Session 审计记录。

## Non-goals

- 不新增 Issue 状态值或 Agent Session 状态值。
- 不执行 `git push`，不改写远端历史。
- 不把应用改成自动提交所有改动；自动提交仍只通过 Agent prompt 完成。
- 不重做 Issues 页面布局，只补齐完成流程需要的确认弹窗、进度与断点提示。

## Capabilities

### Modified Capabilities

- `issue-execution-worktree`: 完成流程必须记录分支基线、处理 dirty 状态、按 worktree 来源合入/清理，并支持重启后续跑。
- `issues-ui`: 状态切换到 `completed` 时必须走 completion flow，并展示 manual dirty、外部 worktree 合入、取消/继续等交互。

## Impact

- 后端：`agent_sessions` 数据模型与 migration、completion flow service/repository、Git worktree/rebase helper、Issue completion command。
- 前端：Issue 完成入口、完成进度/确认弹窗、i18n 文案、断点恢复提示。
- 测试：Rust service/repository/Git helper 测试，Issues Activity completion flow 测试，OpenSpec strict validate。
