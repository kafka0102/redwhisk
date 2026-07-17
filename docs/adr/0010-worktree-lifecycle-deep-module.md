# ADR 0010：Worktree 生命周期收为 git 深 module，并统一 git 执行 adapter

## 状态

采纳。

## 背景

完成流程依赖的 worktree 创建 / 对账 / 清理 / 缺失判定与 merge 失败分类，原先散落在 `issue_service` 自由函数中；`run_git` 在 `git/worktree`、`git/status` 等处各写一套，错误路径重复。完成状态机（候选 1）已把 phase 决策抽成纯函数，effect 解释仍绑在浅层 git 拼装上，lifecycle policy 难以在 module 接口上直接单测。

## 决定

1. 把 **Worktree 生命周期** 抬升为 `src-tauri/src/git/` 下的深 module（就地扩展 `worktree`，不另建 `core/worktree_*` 壳）：对外提供意图级 API——中性 `reconcile_worktree`、缺失 closed-out 评估、结构化 merge-block 分类、路径/drift 与分支事实查询；policy 留在 module 内部。
2. git 进程执行收敛为单一 `git/command` adapter；`worktree` / `status` 将低层错误映射到既有 `GitWorktreeError` / `GitStatusError`。本轮至少迁这两处；`session_workspace_service` 迁入记 follow-up。
3. 用户可见中文 merge-block 文案由完成编排组装（module 只出稳定 reason 与结构字段）；路径来源优先级（用户覆盖 / codex cwd / 启动快照）留在 issue 完成编排，避免 git 层依赖 session registry。
4. 对账 API 中性，不按 Worktree 所有权分叉；owner / 是否确认仍由完成状态机与 service 决定。
5. 本轮以**行为冻结**的重构交付：不改 phase/effect 语义、前端协议、dirty/External 产品策略。

## 后果

- 完成流 effect（如 `AttemptRebaseAndCleanup`）可改为调用意图 API；policy 与 drift 事实可在 `git/worktree` 接口上单测。
- git 执行与基础失败处理只维护一处；领域错误类型仍分 worktree / status，避免一次改爆所有调用方。
- `session_workspace` 仍短暂保留自有 `run_git`，全仓未清零，需后续 ticket。
- 公开面仍含底层步骤函数（如 `rebase_and_fast_forward`），窄接口收敛可后续按调用方收 `pub(crate)`。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 新建 `core/worktree_lifecycle` 再调 `git/*` | 形成 git 能力与 core 编排双中心；低层 git 已在 `git/worktree`，应就地抬接口 |
| 全仓一切 `Command::new("git")` 一次清零（含 session_workspace） | 改动面过大，违背本轮行为冻结与可控范围 |
| merge-block 中文文案进 git module | 污染基础设施层；与 i18n/编排职责不符 |
| 路径来源优先级进 git module | 会反向依赖 session registry / 完成输入，泄漏编排关注点 |
| 按 owner 拆 `reconcile_owned` / `reconcile_external` | 底层步骤相同，owner 是策略层而非 git 操作层 |

## 代码事实来源

- 本决策记录：`docs/adr/0010-worktree-lifecycle-deep-module.md`
- 领域语言：`CONTEXT.md`（Worktree 所有权、实际执行路径、Worktree 漂移、Worktree 对账、完成流程）
- command adapter：`src-tauri/src/git/command.rs`
- 生命周期 module：`src-tauri/src/git/worktree.rs`
- status 消费者：`src-tauri/src/git/status.rs`
- 完成编排接线：`src-tauri/src/core/issue_service.rs`
- 相关：完成状态机 `src-tauri/src/core/completion_state_machine.rs`（effect 语义本轮不改）
