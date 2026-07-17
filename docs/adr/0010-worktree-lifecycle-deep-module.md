# Worktree 生命周期收为 git 深 module，并统一 git 执行 adapter

完成流程依赖的 worktree 创建 / 对账 / 清理 / 缺失判定与 merge 失败分类，原先散落在 `issue_service` 自由函数中，且 `run_git` 在 `git/worktree`、`git/status` 等处重复。决定把 **Worktree 生命周期** 抬升为 `src-tauri/src/git/` 下的深 module：对外提供意图级 API（如中性的 `reconcile_worktree`、缺失 closed-out 评估、结构化 merge-block 分类与路径/drift 事实查询），policy 留在 module 内部；git 进程执行收敛为单一 `git/command` adapter，由 worktree / status 映射到各自错误类型。

刻意不做：用户可见中文 merge-block 文案仍由完成编排组装（module 只出稳定 reason 与结构字段）；路径来源优先级（用户覆盖 / codex cwd / 启动快照）留在 issue 完成编排，避免 git 层依赖 session registry；`session_workspace_service` 直连 git 的迁入、完成状态机 phase/effect 语义变更、前端协议与产品策略调整均不在本决策范围。本轮以行为冻结的重构交付，便于 completion effect 解释改为调用深 module。
