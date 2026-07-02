# Design — revise-issue-completion-commit-flow

记录关键技术与设计决策，供实现阶段参考。只写有设计价值的部分。

## 1. 数据模型与迁移

### 1.1 删除项

- `projects.completion_policy`（迁移 0010 引入的列）：新增迁移 `00NN_drop_project_completion_policy.sql`，`ALTER TABLE projects DROP COLUMN completion_policy;`（SQLite 较新版本支持 DROP COLUMN；若版本不足，走 table-rebuild）。同时撤销 0010 的 CHECK 约束。
- `agent_sessions.completion_policy_override`：同迁移内 `ALTER TABLE agent_sessions DROP COLUMN completion_policy_override;`。
- `issue_completion_flows.phase` 现有 `'manual_dirty'` / `'awaiting_agent_commit'` 等 policy 相关枚举值：本变更重写完成阶段语义，新增 phase 值（见 1.2），旧行通过迁移归一化为新值或置为 `'cancelled'` 由用户重试。

### 1.2 完成流程状态机重写（issue_completion_flows.phase 新枚举）

取代 manual/auto 二分，统一为按步推进的阶段：

- `detecting_workspace`：解析实际执行路径 + 检测未提交改动。
- `prompting_dirty_decision`：等待用户在「自动提交 / 不提交 / 取消」对话框上的选择。
- `auto_committing`：已向 session 发送 commit 指令，等待检测到新 commit。
- `confirming_continue_after_commit`：提交完成后的「确定继续标记完成吗」确认。
- `reconciling_worktree`：路径比对 / rebase 合并 / 失败消息 / 新建 session。
- `confirming_worktree_cleanup`：External worktree 的删除确认。
- `completed` / `cancelled` / `blocked`：终态。

phase 持久化保证应用重启后可恢复，与现有 `complete_issue_flow_transaction` 的可恢复语义一致。

## 2. 实际执行路径解析（核心新增能力）

入口：完成流程的 `detecting_workspace` 阶段，新增 `resolve_actual_execution_path(project, session)`：

1. 若 session 活跃（`status == Running && closed_at.is_none()`）：
   - PTY session → 读取 PTY 进程的当前 cwd（复用现有 pty session 句柄上报能力；若无，则回退到启动记录 `workspace_path`，并在路径比对阶段允许用户手填兜底）。
   - 结构化（codex app-server）session → 读取 session 上报的 workspace cwd。
2. 若 session 已关闭 → 使用启动记录的 `session.workspace_path`。
3. 拿到 `actual_path` 后判断是否在 worktree：
   - `git -C <actual_path> rev-parse --is-inside-work-tree`、`git -C <actual_path> rev-parse --git-dir` 与 `--git-common-dir` 比对，不同则在附加 worktree 内。
   - 取该 worktree 的 checkout 分支 `git -C <actual_path> rev-parse --abbrev-ref HEAD` 与 worktree 根路径。

### 2.1 路径比对（识别第三种情况）

- `startup_path = session.workspace_path`（启动快照）。
- 若 `actual_path != startup_path` 且 `actual_path` 在某 worktree 内 → 命中「运行中漂移到新 worktree」，该 worktree 的 owner 一律视为 `External`（即使用户侧 skill 创建），删除前必须二次确认。
- 若 `actual_path == startup_path` → 按启动记录的 `worktree_owner` 走既有分流。

## 3. 未提交改动检测

复用 `session_workspace_service::resolve_workspace_root` 思路，在 `actual_path` 上执行 `git status --porcelain`（非空即 dirty）。检测点必须在「自动提交」前后各跑一次：前一次决定是否弹框，后一次（auto_committing 阶段轮询/事件）判定提交是否完成。

## 4. 三选项对话框与分支名填充

- 弹框字段 `branchName`：默认值
  - 情况一（current branch，无漂移）→ `origin_branch` / 当前分支，只读。
  - 情况二（worktree 模式，程序创建）→ `workspace_branch`（`issue-{id}`），只读。
  - 情况三（漂移到 External worktree）/ session 关闭且无法解析 → 空值，允许手填（兜底）。
- `branchName` 用途：①后续「代码已提交至 [base 分支]」提示与②rebase 目标分支默认值。

## 5. 自动提交分支（议题 2 确认语义）

1. 用户在 issue 页触发完成 → 命中 dirty → 选「自动提交」。
2. 前端**跳转到 session 页**（保持 session 活跃可见）。
3. 后端复用 `send_agent_commit_prompt`（`issue_service.rs:669`）向 session 发送 commit 指令（含本次修改的 commit message 上下文）。phase → `auto_committing`。
4. 检测到 `actual_path` 上出现新 commit（与弹框前的 git head 比对）→ phase → `confirming_continue_after_commit`。
5. 弹「代码已提交成功。确定继续标记完成吗？」：
   - 是 → 进入 `reconciling_worktree`（走与「不提交」相同的 worktree 检查/合并/删除）。
   - 否 → phase → `cancelled`，issue 保持未完成，流程终止。

> 与现有 `agent_auto_commit` 的差异：现有逻辑在检测到新 commit 后**自动 resume** 同一流程；新逻辑在 resume 前插入一次显式用户确认，并由该确认决定是否继续。

## 6. worktree 合并 / 失败 / 删除（议题 5）

进入 `reconciling_worktree` 的前提：无未提交改动，或用户选了「不提交」/自动提交后确认继续。

- 若 `actual_path` 不在 worktree（或与启动路径一致且 owner 为 External-current-branch）→ 跳过合并，直接走 session 关闭 + 审计 + `Completed`。
- 若在 worktree 且路径不同 → 调 `rebase_and_fast_forward(workspace_branch onto base_branch)`（base_branch = `branchName` / `origin_branch`）。
  - 成功 → 继续。
  - 失败 → **不弹框**：
    - session 活跃 → `send_agent_message` / `inject_session_prompt` 发送「代码合并冲突，请根据本次修改合并代码」。phase → `blocked`（可恢复）。
    - session 关闭 → 在该 worktree 路径新建 session（携带"未完成合并 + 改动文件摘要"上下文 prompt），phase → `blocked`。
    - 用户在 session 内解决并提交后，再次触发完成 → 流程从 `reconciling_worktree` 续跑。
- 提交/合并完成后进入删除判定（仅当仍处于 worktree）：
  - `WorktreeOwner::Redwhisk` → 直接 `cleanup_worktree`。
  - `WorktreeOwner::External`（含情况三漂移 worktree）→ phase → `confirming_worktree_cleanup`，弹「代码已提交至 [base 分支名称]，是否删除当前 work tree？」：是→`cleanup_worktree`；否→不处理。
- 全部成功 → 关闭 session、写完成审计、`IssueStatus::Completed`。

## 7. 删除清单（移除 completion_policy 的连带改动）

按调研报告分组，避免遗漏：

- 类型：`ProjectCompletionPolicy`（前后端）、`completion_policy_override`、`CompletionAttemptOption::AgentAutoCommit`。
- DB：迁移 0010 列 + sessions 表 override 列 + `issue_completion_flows.phase` 旧 policy 值。
- UI：`issue-run-dialog.tsx` L502-530、`project-details-form.tsx` L128-157、`settings-general-panel.tsx`、`app.tsx`/`app-shell.tsx`/`activity-router.tsx`/`issues-activity.tsx`/`project-settings-activity.tsx`/`agents-activity.tsx` 的 prop 透传、`agents-activity.tsx:839` 的条件分支。
- 命令：`update_project_completion_policy`（命令 + handler 注册）。
- i18n：`commitStrategy` / `agentAutoCommit` / `autoCommit` / `completionHandleManually` 等 key。
- 消费点：`issue_service.rs:835-839` 映射、`1895-1911` 拦截、`agent_session_service.rs:945-948 / 1604-1606`。
- 测试夹具：前后端相关 fixture。

## 8. 风险与取舍

- **PTY live cwd 可获取性**：若 PTY 句柄无法上报 cwd，第三种情况的自动解析退化为「弹框手填分支名 + 路径」兜底；这是本变更最大的技术不确定性，实现首步需先验证 PTY cwd 上报能力。
- **破坏性迁移**：删除 `completion_policy` 列与重写 phase 枚举是不可逆变更；迁移需保证旧数据行不致崩溃（phase 旧值归一化）。
- **完成态写入**：仅在整条新流程全部成功（或 External worktree 用户选否但仍判定可完成）时写 `Completed`；任一步 `cancelled` / `blocked` 都保持未完成。
