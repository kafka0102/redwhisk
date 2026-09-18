# 0037. Issue 启动准备进度用 Tauri 事件推送真实阶段

**状态**：采纳（待执行）

## 背景

运行 Issue 时，`start_agent_session` 是一次阻塞调用：创建 Worktree、执行 Worktree 初始化命令、再拉起 Agent 都发生在命令返回之前。现有 LoadingDialog 全程只显示默认文案「正在创建智能体会话...」，长等待无法区分卡在哪一步。历史上曾用前端步骤弹窗假装推进，因无法感知真实时点而被移除。

## 决定

1. **真实阶段才换文案**：后端仅在真正开始创建 Worktree、真正开始执行非空 Worktree 初始化命令时发出 Issue 启动准备进度；前端收到后再改 LoadingDialog 文案。不按「选了 worktree / 填了命令」猜测。
2. **走 Tauri 事件，不拆 command**：不把 `start_agent_session` 拆成创建 / 初始化 / 启动三次调用。新增事件 `issue-session-start-progress`，载荷含 `projectId`、`issueId` 与阶段：`creating_worktree`、`running_setup_command`、`starting_session`。
3. **有则依次展示，无则保持默认**：当前分支模式不发准备阶段。Worktree 但无初始化命令则 `creating_worktree` 后发 `starting_session` 回到默认。两步都有则按创建 → 初始化 → 回到默认。默认文案不变。
4. **只覆盖 Issue 运行启动 LoadingDialog**：不含 Agents resume / 恢复已有 Worktree。失败时仍关闭 loading、回到运行弹窗，不另做进度失败态。
5. **文案**：创建 Worktree 为「正在创建 worktree」/ `Creating worktree...`；初始化为「正在初始化命令」/ `Running setup command...`。不展示具体命令或 Worktree 名。

## 后果

- 须登记 `docs/architecture-design/tauri-contract.md`，并补 listener 释放与序列测试。
- 服务层用可注入进度 sink，避免单测依赖 `AppHandle`。
- 前端须在点击开始前已订阅事件，避免 `listen()` 异步就绪前丢掉首个阶段。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 前端按本次选项猜测文案 | 一次阻塞调用内无法在创建与初始化之间切换，且会在未真正执行时误示 |
| 拆成多个 command | 扩大启动事务与失败回滚面，超出「换 loading 文案」的范围 |
| 恢复旧步骤进度弹窗 | 已因 overlay 冲突与假进度被 LoadingDialog 取代 |

## 代码事实来源

- 本决策：`docs/adr/0037-issue-session-start-progress-event.md`
- 启动准备：`src-tauri/src/features/agent_session/launch.rs`
- LoadingDialog：`src/features/issues/issues-activity.tsx`、`src/components/ui/loading-dialog.tsx`
- 契约：`docs/architecture-design/tauri-contract.md`
