## Why

当前 issue 的「提交策略（completion_policy：manual / agent_auto_commit）」是在**运行前**通过表单一次性选定的：运行对话框和项目设置页都有该选择器，结果持久化在 `projects.completion_policy` 与 `agent_sessions.completion_policy_override` 上，并在完成流程里据此分流。这种设计有两个问题：

1. 用户在运行前无法预知结束时的工作区状态，提前选定的策略与实际代码改动情况经常不一致。
2. 完成流程对「current branch 模式运行、但运行中 skill 自建了 worktree 导致 session 实际 cwd 漂移」这第三种情况没有捕获能力——`workspace_path` 只是启动时的静态快照。

本变更把「提交时机」从运行前的策略选择，后移到**完成时基于实际工作区状态统一检测 + 对话框决策**，并补齐运行中 worktree 漂移的捕获能力。

## What Changes

- **移除提交策略字段**：删除 issue 运行对话框与项目设置页中的提交策略选择器、`projects.completion_policy` 列（迁移 0010）、`agent_sessions.completion_policy_override`、`ProjectCompletionPolicy` 类型（前后端）、`update_project_completion_policy` 命令、`CompletionAttemptOption::AgentAutoCommit` 变体及相关 i18n / 测试夹具。
- **完成时统一检测未提交代码**：issue 标记完成时，按「session 活跃 → 取 session 当前真实 cwd；session 关闭 → 取启动记录的 `workspace_path`」解析实际执行路径，检测该路径下的未提交改动。
- **捕获运行中 worktree 漂移**：完成时实时解析 session 实际 cwd，与启动记录的 `workspace_path` 比对，识别「current branch 模式启动但运行中漂移到新 worktree」这第三种情况。
- **未提交代码弹框（三选项）**：检测到未提交改动时弹出对话框，自动填充已知分支名（情况三 / session 关闭无法解析时允许手填兜底），提供「自动提交 / 不提交 / 取消」。
  - **自动提交**：跳转 session 页，向 session 发送含 commit message 的指令；检测到提交完成后弹「代码已提交成功。确定继续标记完成吗？」，是→继续后续 worktree 检查，否→终止。
  - **不提交**：忽略未提交改动，继续后续 worktree 检查。
  - **取消**：退出完成流程，issue 保持未完成。
- **worktree 合并 / 失败 / 删除重写**：「不提交」或无未提交改动路径下，若实际路径处于 worktree 且与启动路径不同，则尝试 rebase 合并；rebase 失败不弹框，改为向 session 发「代码合并冲突，请根据本次修改合并代码」（session 关闭则新建 session 并携带改动上下文）；session 内提交完成后再按 `WorktreeOwner` 删除 worktree（Redwhisk→直接删；External→弹「代码已提交至 [base 分支]，是否删除当前 work tree？」）。
- **skill 创建的 worktree 归属**：明确运行中漂移到的新 worktree 一律按 `External`（用户创建）对待，删除前必须二次确认。

## Non-goals

- 不改动 issue 的状态机本身（`backlog / running / review / completed` 仍由现有状态迁移规则约束）。
- 不改动 worktree 的创建、命名、setup 命令执行逻辑（`create_worktree_for_issue` / `run_worktree_setup_command` 保持不变）。
- 不改动独立（非 issue）session 的启动与删除路径。
- 不引入新的 git 合并原语；复用现有 `rebase_and_fast_forward` / `cleanup_worktree`。
- 不改动项目设置页除「提交策略」以外的其它配置项。

## Capabilities

### Modified Capabilities

- `issue-execution-worktree`：重写完成编排——移除 manual/auto policy 驱动的完成分流，改为完成时统一检测实际路径与未提交改动、弹框决策、以及重写后的 worktree 合并/失败/删除流程；新增运行中 worktree 漂移捕获。

## Impact

- **前端**：`src/features/issues/issue-run-dialog.tsx`、`src/features/project/project-details-form.tsx`、`src/features/settings/settings-general-panel.tsx`、`src/features/issues/issues-activity.tsx`、`src/features/agents/agents-activity.tsx`、`src/app/**` 中的 `completionPolicy` prop 透传链、`src/features/issues/issue-commands.ts`、`src/features/project/project-commands.ts`、`src/shared/i18n/messages.ts`、相关测试。
- **后端**：`src-tauri/src/types/{project,agent_session,completion_attempt}.rs`、`src-tauri/src/db/{project_repository,agent_session_repository,completion_attempt_repository,migrations}.rs`、`src-tauri/src/core/{issue_service,agent_session_service,project_service,session_workspace_service}.rs`、`src-tauri/src/commands/{project,issue,agent_session}_commands.rs`、新增一条迁移（清退 completion_policy 列）。
- **spec**：`openspec/specs/issue-execution-worktree/spec.md`。
- **验证**：完成时三种路径检测、未提交弹框三选项、自动提交→session 跳转→提交成功确认、rebase 失败的消息/新建 session 分支、Redwhisk/External worktree 删除分流、运行中 worktree 漂移捕获。
