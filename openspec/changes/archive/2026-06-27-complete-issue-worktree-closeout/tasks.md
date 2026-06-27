## 1. OpenSpec 与状态模型

- [x] 1.1 更新 `issue-execution-worktree` spec，定义统一 completion flow、dirty 检测、worktree owner、rebase 式合入和重启恢复。
- [x] 1.2 更新 `issues-ui` spec，定义 completed 状态切换时的 dirty/manual/auto-commit/external-worktree 确认交互。
- [x] 1.3 新增 SQLite migration，记录 session 启动分支、worktree owner 与 issue completion flow 断点状态。

## 2. 后端 completion orchestration

- [x] 2.1 在 Agent session 启动时保存 `origin_branch` 与 `worktree_owner`。
- [x] 2.2 新增 completion flow repository/type/DTO，并让 command 返回下一步动作、进度或阻塞原因。
- [x] 2.3 将状态切换到 `completed`、Done 按钮、Agent auto-commit 检测完成统一接入 completion orchestration，禁止绕过 Git/worktree 收尾直接写 `completed`。
- [x] 2.4 将 dirty 检测改为读取当前 session 工作目录，并按 session `completion_policy` 快照处理。
- [x] 2.5 为 `manual` dirty 提供“忽略继续”与“等待手动处理后重试”的持久化分支。
- [x] 2.6 为 `agent_auto_commit` dirty 注入自动提交 prompt，记录等待状态，并在检测到新 commit 后继续 completion flow。

## 3. Git worktree/rebase 收尾

- [x] 3.1 新增 Git helper：检测当前 checkout 是否附加 worktree、读取当前分支、rebase workspace 分支到目标分支、fast-forward 合入目标分支。
- [x] 3.2 RedWhisk 创建的 worktree 自动执行 rebase/fast-forward/cleanup；失败时记录阻塞并注入 Agent 合并 prompt。
- [x] 3.3 外部 worktree 在用户确认后执行同类收尾；拒绝时跳过收尾并完成；取消时暂停。
- [x] 3.4 cleanup 只在合入确认成功后执行，失败不得删除 worktree 或临时分支。

## 4. 前端交互与 i18n

- [x] 4.1 完成入口改为调用统一 completion command，并根据返回动作展示进度、dirty 提示、外部 worktree 确认或阻塞提示。
- [x] 4.2 manual dirty 弹窗提供“忽略继续”和“手动处理”分支；手动处理后再次点击完成从后端断点继续。
- [x] 4.3 外部 worktree 弹窗提供“合入并删除”、“不合入直接完成”、“取消”。
- [x] 4.4 完成流程文案全部接入 `src/shared/i18n/**` 或 feature locale formatter。

## 5. 验证

- [x] 5.1 Rust 测试覆盖：clean current branch 直接完成、manual dirty 阻塞/忽略、auto-commit 等待/继续、RedWhisk worktree rebase 成功清理、rebase 失败交给 Agent、外部 worktree 三种用户选择、重启后恢复断点。
- [x] 5.2 前端测试覆盖：completed 状态切换不再调用裸 `advanceIssueStatus` 绕过 completion flow，dirty/manual/external worktree 弹窗分支正确。
- [x] 5.3 运行 `pnpm format`。
- [x] 5.4 运行 `pnpm lint`。
- [x] 5.5 运行 `pnpm typecheck`。
- [x] 5.6 运行 `pnpm test`。
- [x] 5.7 运行 `cd src-tauri && cargo test`。
- [x] 5.8 运行 `openspec validate complete-issue-worktree-closeout --strict`。
