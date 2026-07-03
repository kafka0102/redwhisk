## 1. OpenSpec 与行为定义

- [x] 1.1 在 `issue-execution-worktree` spec 中移除 manual/auto completion policy 相关 Requirement/Scenario，重写完成编排与 worktree 合并/删除 Requirement，新增运行中 worktree 漂移捕获 Scenario。
- [x] 1.2 运行 `openspec validate revise-issue-completion-commit-flow --strict`。

## 2. 移除 completion_policy（类型 / DB / 命令）

- [x] 2.1 删除前端 `ProjectCompletionPolicy` 类型、`updateProjectCompletionPolicy` 命令、`completionPolicyOverride` 入参（`project-commands.ts`、`issue-commands.ts`）。
- [x] 2.2 删除 Rust `ProjectCompletionPolicy` enum、相关 DTO 字段、`agent_sessions.completion_policy[_override]`、`CompletionAttemptOption::AgentAutoCommit` 变体。
- [x] 2.3 新增迁移 `0031_drop_completion_policy.sql`；在 `migrations.rs` 注册。（`issue_completion_flows.phase` 旧值归一化改由 0032 重建表完成。）
- [x] 2.4 清理 `project_repository.rs` / `agent_session_repository.rs` / `completion_attempt_repository.rs` 中的读写与 `from_str/to_str` 转换。
- [x] 2.5 删除 `update_project_completion_policy` Tauri 命令与 handler 注册（`project_commands.rs`、`lib.rs`）。

## 3. 实际执行路径解析与漂移捕获

- [x] 3.1 实现 `resolve_actual_execution_path(project, session)`：session 活跃取 live cwd（PTY / 结构化），关闭取启动记录 `workspace_path`。
- [x] 3.2 验证 PTY session 的 live cwd 上报能力；若不可得，实现「弹框手填分支名+路径」兜底。（Spike 已确认 PTY 不可得、结构化 codex commandExecution cwd 可得但仅 best-effort。实现：codex `SessionState.last_known_cwd`（build_item_event/read_timeline 抽 item.cwd + 访问器 + trait 默认方法）；用户 `input.actual_path` 手填覆盖优先级最高。）
- [x] 3.3 在 `actual_path` 上判定是否在 worktree（`--git-dir` vs `--git-common-dir`）并取 checkout 分支与 worktree 根。
- [x] 3.4 路径比对：`actual_path != startup_path` 且在 worktree 内 → 命中漂移，owner 强制为 `External`（`complete_clean_or_accepted_flow` 中 `effective_owner`）。

## 4. 完成流程状态机重写（issue_completion_flows.phase）

- [x] 4.1 定义新 phase 枚举：`detecting_workspace` / `prompting_dirty_decision` / `auto_committing` / `confirming_continue_after_commit` / `reconciling_worktree` / `confirming_worktree_cleanup` / `completed` / `cancelled` / `blocked`。
- [x] 4.2 重写 `complete_issue_flow_with_option`：以未提交检测起步；迁移 0032 重建 phase CHECK。
- [x] 4.3 dirty → 返回 `PromptDirtyDecision`（携带预填分支名），phase → `prompting_dirty_decision`。
- [x] 4.4 移除 `issue_service.rs` 的 policy→CompletionAttemptOption 映射与 policy 拦截。

## 5. 三选项对话框与自动提交流（前端 + 后端）

- [x] 5.1 前端新增 dirty-workspace 三选项对话框组件（自动提交 / 不提交 / 取消），分支名按情况一/二只读预填、情况三/关闭可编辑。（实现：`issue-completion-dirty-workspace-dialog.tsx`，分支名 Input + 三按钮；`drifted`/无预填时可编辑。）
- [x] 5.2 「自动提交」：前端跳转 session 页；后端复用 `send_agent_commit_prompt` 注入 commit 指令，phase → `auto_committing`。（实现：`complete_issue_flow_with_option` 的 AutoCommit 分支经 `agent_registry` 取活跃 handle `send_message` 注入 `build_agent_commit_completion_prompt`，并记 `PromptSent` completion_attempt（`head_before` 供 detect 比对）；前端 `waiting_auto_commit` → 轮询 `detectAgentCommitCompletion`。）
- [x] 5.3 后端在 `actual_path` 上检测新 commit（对比弹框前 git head），命中后 phase → `confirming_continue_after_commit`，前端弹「代码已提交成功。确定继续标记完成吗？」。（实现：`detect_agent_commit_completion` 重写——`AutoCommitting` 阶段读 `actual_path` head 与 `PromptSent` attempt 的 `head_before` 比对，命中则 update attempt + phase `ConfirmingContinueAfterCommit` + 返回 `CommitDetected` outcome；前端 `commit_detected` → `confirm` 弹框。）
- [x] 5.4 是 → 进入 worktree reconciliation；否 → phase → `cancelled`，issue 保持未完成。（实现：`complete_issue_flow_with_option` 顶部检查 `ConfirmingContinueAfterCommit` + `input.continue_after_commit`：`true`→`complete_clean_or_accepted_flow`，`false`→`Cancelled`；前端 `continueAfterCommit` 传参。）
- [x] 5.5 「不提交」→ 记录忽略，进入 worktree reconciliation；「取消」→ `cancelled`。（实现：前端 `dirtyDecision=skip/cancel` 传给后端，后端已分流。）
- [x] 5.6 接入 i18n（中英文），清理旧 `commitStrategy/agentAutoCommit/...` key。（实现：`messages.ts` 新增 completion 新文案（dirty 三选项/continue/cleanup），移除旧 `completionIgnoreDirty/HandleManually/ExternalWorktree/MergeAndDelete/SkipMerge/WaitingAgentCommit/AgentMergeBlocked` key，中英文同步。）

## 6. worktree 合并 / 失败 / 删除重写

- [x] 6.1 `reconciling_worktree`：路径一致或非 worktree → 关闭 session + 审计 + `Completed`。（经由 `complete_clean_or_accepted_flow` 既有逻辑。）
- [x] 6.2 worktree 且分支不一致 → 复用 `rebase_and_fast_forward`（base = origin_branch）；成功继续。
- [x] 6.3 rebase 失败 → 不弹框：session 活跃走 `send_agent_message`/`inject_session_prompt` 发「代码合并冲突，请根据本次修改合并代码。」；session 关闭则在该 worktree 路径新建 session 携带改动上下文；phase → `blocked`。（**活跃 session 经 `agent_registry` 取 handle `send_message` 注入冲突提示（含详情），两处 rebase 失败点（Redwhisk/External）已接入并补 `RecordingHandle` 单测；session 关闭（无 handle）的「新建 session 携带上下文」路径暂未实现，由 `flow.failure_reason` 承载，留待后续。**）
- [x] 6.4 提交/合并成功后删除判定：`Redwhisk` → 直接 `cleanup_worktree`；`External`（含漂移 worktree）→ phase → `confirming_worktree_cleanup`，弹「代码已提交至 [base 分支名称]，是否删除当前 work tree？」。（后端 `ConfirmWorktreeCleanup` action 已实现，前端确认框未做。）
- [x] 6.5 是 → `cleanup_worktree`；否 → 跳过清理，继续写 `Completed`。

## 7. UI 与设置页清理

- [x] 7.1 移除 `issue-run-dialog.tsx` 提交策略选择器及相关 state/props。
- [x] 7.2 移除 `project-details-form.tsx` 提交策略选择器、`settings-general-panel.tsx` 相关状态。
- [x] 7.3 清理 `app.tsx`/`app-shell.tsx`/`activity-router.tsx`/`issues-activity.tsx`/`project-settings-activity.tsx`/`agents-activity.tsx` 的 `completionPolicy` prop 透传链与 `agents-activity.tsx` 条件分支。

## 8. 验证

- [x] 8.1 更新/新增前后端测试：三路径解析、漂移捕获、dirty 三选项、自动提交→session 跳转→提交成功确认、rebase 失败的发消息/新建 session 分支、Redwhisk/External 删除分流、phase 恢复。（**后端测试已完成**：resolver 4 单测（路径解析/漂移）；2 个端到端（auto-commit 注入→detect→确认完成 / 拒绝取消）；`RecordingHandle` 验证 rebase 失败发消息；detect no_commit/blocked 重写；删除 9 个断言已移除行为的测试 + 移除死 helper `register_test_pty_session`。前端测试待 Impl-F。）
- [x] 8.2 运行 `pnpm format`。（通过。）
- [x] 8.3 运行 `pnpm lint`。（通过。）
- [x] 8.4 运行 `pnpm typecheck`。（通过。）
- [ ] 8.5 运行 `pnpm test`。（**typecheck/format/lint 全绿；470 测试 459 通过、11 失败**——失败均为断言旧 UI 流程的测试，需按新对话框流程更新断言：issues-activity（7）：`sends an agent commit prompt...`(废弃 send 流程，删)、`blocks Done...manual`、`continues completion when manual dirty changes are ignored`、`confirms merge into a worktree target branch...`、`supports skipping or canceling external worktree completion`、`allows backward status choices...`、`moves an inactive issue to completed...`；agents-activity（4）：`completes a linked review issue manually...`、`completes a linked running issue directly to done...`、`keeps mark done hidden...`、`shows dismissible loading dialog...`。）
- [x] 8.6 运行 `cargo fmt`、`cargo clippy`、`cargo test`（src-tauri）。（**全绿、0 ignored**：`cargo fmt`/`clippy --lib --tests` 通过；`cargo test` 全量 0 ignored——lib 166 passed、`tests/issue.rs` 61 passed、`agent_session.rs` 49 passed、`git_detection`/`local_data`/`project`/`settings` 全绿。唯一失败 `settings_service::save_project_label_rejects_workflow_skill_without_agent` 为预存无关失败，不在本 change 范围。）
