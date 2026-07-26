# ADR 0026：完成流程 Skip 在 Worktree 对账前丢弃 Agent worktree 未提交改动

## 状态

采纳（已执行）。

## 背景

完成流程 dirty 三选含「不提交」（`DirtyWorkspaceOption::Skip` / UI「不提交直接完成」）。状态机在 Skip 后跳过再次弹 dirty 窗并进入 Worktree 对账；但 `reconcile_worktree` → `rebase_and_fast_forward` 仍要求 workspace 与 target 工作区干净。Agent worktree 若残留未提交改动（常见为 Agent 执行产生的临时文件），合入被 `workspace_worktree_dirty` 阻断，Skip 在 worktree 场景实质不可用。

用户期望：完成时忽略这些未提交内容——既不将其合入目标分支，也不要求手动清理——同时仍把**已提交**工作合入目标分支并清理 worktree。

## 决定

1. **Skip 的合入语义**：当完成流因 `dirty_already_skipped()`（`ignore_dirty` 或 `dirty_decision == Skip`）进入需要 `AttemptRebaseAndCleanup` 的路径时，在对账前对 **Agent worktree（workspace 路径）** 丢弃未提交改动：`git reset --hard` 与 `git clean -fd`（tracked + untracked；不加 `-x`，不主动清 ignored）。
2. **目标分支工作区**：不因 Skip 丢弃；目标侧 dirty 仍按既有 `target_worktree_dirty` 阻断。
3. **非 worktree / 无需对账路径**：当前分支模式等不走 rebase/cleanup 的 Skip，行为保持「直接标完成、不改写工作区文件」。
4. **职责分层**：丢弃的「是否执行」由完成编排根据 `dirty_already_skipped` 决定；「如何丢弃」落在 `git/worktree` 意图 API（与 ADR-0010 一致），再调用既有 `reconcile_worktree`。
5. **产品文案**：dirty 弹框中英文文案明示 Skip 会丢弃未提交改动，已提交内容仍会合入。

## 后果

- Skip 在 RedWhisk（及用户确认合入的 External）worktree 场景可走通：已提交合入 + worktree 清理 + Issue 完成。
- Skip 变为**破坏性**操作（未提交内容不可恢复）；依赖 UI 文案降低误点风险。
- 目标主工作区不被 Skip 清扫，降低误伤。
- 集成测需覆盖：dirty worktree + Skip → completed、目标分支含已提交内容、未提交未进入目标、worktree 已清理。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| Skip 仅标完成、跳过合入 | 已提交工作留在 worktree 分支，违背完成时合入期望 |
| stash 后再合入 | worktree 删除后 stash 难找回；复杂度高 |
| 目标侧一并 discard | 可能清掉用户主工作区未提交工作，风险过高 |
| 仅放宽 `ensure_clean` 不丢弃 | rebase/checkout 在脏树上仍可能失败；临时文件仍残留 |

## 代码事实来源

- 本决策：`docs/adr/0026-completion-skip-discards-worktree-dirty.md`
- 相关：[ADR-0010](./0010-worktree-lifecycle-deep-module.md)、[ADR-0012](./0012-completion-effect-interpreter-deep-module.md)
- 领域语言：`CONTEXT.md`（完成流程、Worktree 对账）
- 状态机：`src-tauri/src/features/issue/completion/state_machine.rs`（`DirtyWorkspaceOption::Skip`、`dirty_already_skipped`）
- 解释器：`src-tauri/src/features/issue/completion/effect_interpreter.rs`（`AttemptRebaseAndCleanup`）
- git 对账：`src-tauri/src/git/worktree.rs`（`reconcile_worktree`、`ensure_clean_worktree`）
