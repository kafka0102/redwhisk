## Why

Issue 看板当前把非 `backlog` 状态的回退全部挡死，用户无法把执行中的 issue 直接退回 `backlog`，也无法对其它逆向状态调整做统一确认。同时，标记 `completed` 的确认逻辑依赖 `latestOutput`，导致“session 仍在运行但没有最新输出”时不会提示，和实际执行状态不一致。

## What Changes

- 放开 Issue 状态菜单中的回退能力，不再只允许单向前进。
- 所有回退操作都增加二次确认；退回 `backlog` 时根据当前 session 是否仍在运行显示不同确认文案。
- 当用户把 issue 切到 `completed` 时，仅按 session 是否仍在运行决定是否先确认，再继续现有完成校验链路。
- 后端允许 backward transition，并在退回 `backlog` 时终止运行中的 session、解除该 issue 的活跃 session 关联，保证该 issue 可以重新 `Run`。
- 命令层在状态变更关闭 session 后同步停止真实运行中的 PTY / 结构化 agent session。

## Non-goals

- 不改动 Issue 的完成校验规则本身，例如 worktree merge、auto commit、manual completion policy 等现有完成前检查。
- 不引入新的 Issue 状态或新的 session 状态。
- 不重做 Issue 详情页布局或状态菜单视觉样式。

## Capabilities

### New Capabilities

- `issues-ui`: 定义状态回退确认、退回 backlog 的 session 终止确认，以及完成前运行态确认。

## Impact

- 前端：`src/features/issues/issues-activity.tsx`、`src/features/issues/issue-read-only-page.tsx`、`src/shared/i18n/messages.ts`、相关测试。
- 后端：`src-tauri/src/core/issue_service.rs`、`src-tauri/src/db/issue_repository.rs`、`src-tauri/src/commands/issue_commands.rs`。
- 验证：覆盖状态菜单回退入口、backlog 退回确认文案、完成前运行态确认，以及退回 backlog 后重新进入 backlog 的行为。
