## 1. OpenSpec 与行为定义

- [x] 1.1 在 `issues-ui` spec 中补充状态回退与完成确认规则。

## 2. 前端状态菜单与确认逻辑

- [x] 2.1 调整 `IssueReadOnlyPage` 状态菜单，允许显示回退目标状态，不再只开放向前推进。
- [x] 2.2 在 `IssuesActivity` 中为所有 backward transition 增加二次确认。
- [x] 2.3 为退回 `backlog` 的运行中 issue 显示“终止并退回”确认文案；无运行中 session 时显示普通 backlog 确认文案。
- [x] 2.4 把切到 `completed` 的确认条件改为仅检查 session 是否仍在运行。
- [x] 2.5 为新增确认文案接入国际化。

## 3. 后端状态回退与 session 收尾

- [x] 3.1 允许 `advance_issue_status` 执行 backward transition。
- [x] 3.2 退回 `backlog` 时终止运行中的关联 session，并解除 issue 的活跃 session 关联。
- [x] 3.3 在命令层同步停止被关闭的 PTY / 结构化 agent session。

## 4. 验证

- [x] 4.1 更新 `src/features/issues/issues-activity.test.tsx`，覆盖回退确认与完成前确认。
- [x] 4.2 运行 `pnpm format`。
- [x] 4.3 运行 `pnpm lint`。
- [x] 4.4 运行 `pnpm typecheck`。
- [x] 4.5 运行 `pnpm test`。
- [x] 4.6 运行 `openspec validate allow-issue-status-rollback-and-backlog-return --strict`。
