## 1. OpenSpec 与行为定义

- [ ] 1.1 在 `issue-execution-worktree` spec 中移除 manual/auto completion policy 相关 Requirement/Scenario，重写完成编排与 worktree 合并/删除 Requirement，新增运行中 worktree 漂移捕获 Scenario。
- [ ] 1.2 运行 `openspec validate revise-issue-completion-commit-flow --strict`。

## 2. 移除 completion_policy（类型 / DB / 命令）

- [ ] 2.1 删除前端 `ProjectCompletionPolicy` 类型、`updateProjectCompletionPolicy` 命令、`completionPolicyOverride` 入参（`project-commands.ts`、`issue-commands.ts`）。
- [ ] 2.2 删除 Rust `ProjectCompletionPolicy` enum、相关 DTO 字段、`agent_sessions.completion_policy[_override]`、`CompletionAttemptOption::AgentAutoCommit` 变体。
- [ ] 2.3 新增迁移 `00NN_drop_project_completion_policy.sql`：`projects DROP COLUMN completion_policy`、`agent_sessions DROP COLUMN completion_policy_override`，并归一化 `issue_completion_flows.phase` 旧 policy 值；在 `migrations.rs` 注册。
- [ ] 2.4 清理 `project_repository.rs` / `agent_session_repository.rs` / `completion_attempt_repository.rs` 中的读写与 `from_str/to_str` 转换。
- [ ] 2.5 删除 `update_project_completion_policy` Tauri 命令与 handler 注册（`project_commands.rs`、`lib.rs`）。

## 3. 实际执行路径解析与漂移捕获

- [ ] 3.1 实现 `resolve_actual_execution_path(project, session)`：session 活跃取 live cwd（PTY / 结构化），关闭取启动记录 `workspace_path`。
- [ ] 3.2 验证 PTY session 的 live cwd 上报能力；若不可得，实现「弹框手填分支名+路径」兜底。
- [ ] 3.3 在 `actual_path` 上判定是否在 worktree（`--git-dir` vs `--git-common-dir`）并取 checkout 分支与 worktree 根。
- [ ] 3.4 路径比对：`actual_path != startup_path` 且在 worktree 内 → 命中漂移，owner 强制为 `External`。

## 4. 完成流程状态机重写（issue_completion_flows.phase）

- [ ] 4.1 定义新 phase 枚举：`detecting_workspace` / `prompting_dirty_decision` / `auto_committing` / `confirming_continue_after_commit` / `reconciling_worktree` / `confirming_worktree_cleanup` / `completed` / `cancelled` / `blocked`。
- [ ] 4.2 重写 `complete_issue_flow_transaction`：以 `detecting_workspace` 起步，跑未提交检测（`git status --porcelain`）。
- [ ] 4.3 dirty → 返回三选项 dirty-workspace 决策 action（携带预填分支名），phase → `prompting_dirty_decision`。
- [ ] 4.4 移除 `issue_service.rs:835-839` 的 policy→CompletionAttemptOption 映射与 `1895-1911` 的 policy 拦截。

## 5. 三选项对话框与自动提交流（前端 + 后端）

- [ ] 5.1 前端新增 dirty-workspace 三选项对话框组件（自动提交 / 不提交 / 取消），分支名按情况一/二只读预填、情况三/关闭可编辑。
- [ ] 5.2 「自动提交」：前端跳转 session 页；后端复用 `send_agent_commit_prompt` 注入 commit 指令，phase → `auto_committing`。
- [ ] 5.3 后端在 `actual_path` 上检测新 commit（对比弹框前 git head），命中后 phase → `confirming_continue_after_commit`，前端弹「代码已提交成功。确定继续标记完成吗？」。
- [ ] 5.4 是 → 进入 worktree reconciliation；否 → phase → `cancelled`，issue 保持未完成。
- [ ] 5.5 「不提交」→ 记录忽略，进入 worktree reconciliation；「取消」→ `cancelled`。
- [ ] 5.6 接入 i18n（中英文），清理旧 `commitStrategy/agentAutoCommit/...` key。

## 6. worktree 合并 / 失败 / 删除重写

- [ ] 6.1 `reconciling_worktree`：路径一致或非 worktree → 关闭 session + 审计 + `Completed`。
- [ ] 6.2 worktree 且路径不同 → 复用 `rebase_and_fast_forward`（base = 用户/解析的分支名）；成功继续。
- [ ] 6.3 rebase 失败 → 不弹框：session 活跃走 `send_agent_message`/`inject_session_prompt` 发「代码合并冲突，请根据本次修改合并代码。」；session 关闭则在该 worktree 路径新建 session 携带改动上下文；phase → `blocked`。
- [ ] 6.4 提交/合并成功后删除判定：`Redwhisk` → 直接 `cleanup_worktree`；`External`（含漂移 worktree）→ phase → `confirming_worktree_cleanup`，弹「代码已提交至 [base 分支名称]，是否删除当前 work tree？」。
- [ ] 6.5 是 → `cleanup_worktree`；否 → 跳过清理，继续写 `Completed`。

## 7. UI 与设置页清理

- [ ] 7.1 移除 `issue-run-dialog.tsx` 提交策略选择器（L502-530）及相关 state/props。
- [ ] 7.2 移除 `project-details-form.tsx` 提交策略选择器（L128-157）、`settings-general-panel.tsx` 相关状态。
- [ ] 7.3 清理 `app.tsx`/`app-shell.tsx`/`activity-router.tsx`/`issues-activity.tsx`/`project-settings-activity.tsx`/`agents-activity.tsx` 的 `completionPolicy` prop 透传链与 `agents-activity.tsx:839` 条件分支。

## 8. 验证

- [ ] 8.1 更新/新增前后端测试：三路径解析、漂移捕获、dirty 三选项、自动提交→session 跳转→提交成功确认、rebase 失败的发消息/新建 session 分支、Redwhisk/External 删除分流、phase 恢复。
- [ ] 8.2 运行 `pnpm format`。
- [ ] 8.3 运行 `pnpm lint`。
- [ ] 8.4 运行 `pnpm typecheck`。
- [ ] 8.5 运行 `pnpm test`。
- [ ] 8.6 运行 `cargo fmt`、`cargo clippy`、`cargo test`（src-tauri）。
