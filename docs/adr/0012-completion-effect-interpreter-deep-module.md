# ADR 0012：完成流程 Effect 解释器收为深 module

## 状态

采纳。

## 背景

Issue 完成流程的 phase 迁移决策已抽为纯深 module `completion_state_machine::advance`（`advance(state, world, event) -> Transition { new_state, effects }`，17 测试打在 interface 上，零 I/O）。但 `Effect` 的「解释执行」（effect → DB / git / agent 副作用）不是 module——是烤进 `issue_service.rs` 的**两条 `match` 循环**，arm 覆盖互不相同：

- `apply_completion_transition`（经 `complete_issue_flow` 入口）：处理 `InjectCommitPrompt` / `RecordCompletionAttempt{PromptSent,None}` / `AttemptRebaseAndCleanup{Block}` / `CommitCompletion`，其余落 `_ => {}`。
- `detect_agent_commit_completion`（前端轮询入口）：仅以 `if let` 处理 `RecordCompletionAttempt{Completed,Some}`，余者不匹配。

逐事件核对：`complete_issue_flow` 路径不产出 `Completed` effect、`detect_commit` 恰只产单个 `Completed` effect，故当前两条 loop 都**未实际丢失 effect**（良性）。但结构上是「深状态机之下的两个浅解释器」：arm 分歧无编译期保证、无单测拦截；未来给 `Effect` 加 variant 会静默落进 `_ => {}` 而无任何信号。effect→副作用映射也无 interface 可单测，只能经端到端 command 测试间接触达。这与 [ADR-0010](./0010-worktree-lifecycle-deep-module.md)「完成流 effect 可改为调用意图 API」的预告一致，属其同向收尾。

## 决定

1. **抬升一个 effect 解释深 module**：在 `IssueService` 上新增 `pub(crate) fn interpret_effects(&self, ctx: &EffectContext, transition: Transition) -> Result<InterpretationOutcome, CommandError>`。两个完成流程入口在 `advance()` 之后都调它，取代各自内嵌的 loop + upsert 尾巴。
2. **边界只取 effect 解释**：module 拥有 effect 循环 + `FailurePolicy::Block` 的相位改写语义（rebase 失败 → `new_state.phase = Blocked` 并停执剩余 effect）+ flow upsert（含「Completed 跳过 upsert」迁移不变式）。纯 `advance()` 不动；调用方各自的事件派生 / 前置守卫（closed-fast-path、git-op 守卫、phase 门控、head 比较）与 world 构造留在原入口。
3. **中性 Outcome**：`InterpretationOutcome { new_state, completed_issue, merge_block, flow_record }`；`CompleteIssueFlowResult` / `DetectAgentCommitCompletionResult` 的结果塑形与文案是视图投影，留调用方。入参以 `EffectContext` 打包解释器实际读取的字段（`repo_path` / `issue` / `session` / `world` / `agent_registry`）；`actual` 仅调用方投影用，不入 ctx。
4. **不新增 trait port**：可测依赖按 local-substitutable 处理——复用内存 SQLite + temp git repo + 已有 fake `AgentSessionHandle`（ADR-0011）。git reconcile 保持对 `git/worktree` 的直接调用；不为单 adapter 立假想 seam，与 ADR-0010 收敛 git seam 同向。
5. **落点**：新文件 `src-tauri/src/core/completion_effect_interpreter.rs`，`impl IssueService` 块（复用 `self` 的 repo 与 `complete_issue_flow_transaction` / `upsert_completion_flow`）+ 同文件 `#[cfg(test)] mod tests`。纯状态机文件零改动。
6. **行为冻结**：不改 phase / effect 语义、前端协议、dirty / External 产品策略；唯一结构性变化是 `_ => {}` 删除（match 在共享处穷尽），不改变今天任何可观测输出。`detect_agent_commit_completion` 手搓的 dummy `CompletionWorld` 良性但属 `advance()` 输入，本次不收口，留 follow-up。

## 后果

- effect→副作用映射首次有了可单测的 interface；新增 `Effect` variant 由共享处的穷尽 match 在编译期兜底，arm 分歧不再可能。
- 两入口的 loop + upsert 尾巴合一，消除重复与「同一 effect 两处不同 arm」的结构裂缝。
- 纯状态机 `completion_state_machine` 边界保持（零 I/O、零展示文本），不受解释器 I/O 污染。
- 端到端 command 测试（内联 ~15 + `tests/issue.rs` ~11）保留作行为冻结重构的 parity 安全网；新增每-effect interface 测试钉死副作用。
- 个别被解释器调用的私有 helper（`reconcile_session_worktree` / `merge_block_from_worktree_error` 等）按最小 churn 提 `pub(crate)` 或搬入新文件。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| module 吞下 `advance()` + 解释（`run_completion_step`） | 污染纯状态机边界，逼解释器测试重复覆盖 advance 已覆盖的迁移逻辑；两入口 advance 前的守卫本就不同，吞下也省不掉 |
| flow upsert 留两入口各自重复 | 正是要消除的 locality 缺失；「Completed 跳过」是迁移不变式，应收进 module |
| 为 git reconcile 立 trait port | 单 adapter 假想 seam，违背「两 adapter 才是真 seam」；与 ADR-0010 收敛 git seam 逆向；stand-in（temp git）已存在 |
| 顺手收口 dummy `CompletionWorld` | 越过纯状态机边界，属范围蔓延；产出正确行为，留 follow-up |
| 解释器写进 `issue_service.rs` | 该文件已近 6,000 行，应减压非增压 |

## 代码事实来源

- 本决策记录：`docs/adr/0012-completion-effect-interpreter-deep-module.md`
- 相关 ADR：[ADR-0010](./0010-worktree-lifecycle-deep-module.md)（其「后果」预告 effect 收口）、[ADR-0001](./0001-core-architecture-boundaries.md)
- 领域语言：`CONTEXT.md`（完成流程）
- 纯状态机（不改）：`src-tauri/src/core/completion_state_machine.rs`（`advance` / `Effect` / `Transition`）
- 新深 module：`src-tauri/src/core/completion_effect_interpreter.rs`
- 两入口接线：`src-tauri/src/core/issue_service.rs`（`apply_completion_transition`、`detect_agent_commit_completion`）
