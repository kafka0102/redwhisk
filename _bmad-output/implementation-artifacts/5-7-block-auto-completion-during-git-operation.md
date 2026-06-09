---
baseline_commit: 29fc520
---

# Story 5.7: 阻止 Git 操作进行中状态下自动完成

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望 merge/rebase/cherry-pick 等 Git 操作进行中时系统不要自动完成 Issue,
以便仓库处于复杂状态时不会被错误收口为完成。

## Acceptance Criteria

1. 给定 Issue 处于 `review`，当用户尝试 `Complete` 或 `Complete with Agent Commit` 时，Rust Core 会检测当前仓库的 Git operation state，并能识别 `merge`、`rebase`、`cherry-pick`、`revert`、`sequencer` 与 `unmerged` 等进行中状态。
2. 给定 Git operation 正在进行，当用户选择 `Complete` 或 `Complete with Agent Commit` 时，系统阻止自动完成，向用户展示事实性提示要求先手动处理 Git 状态，且 Issue 保持 `review`、Session 保持原有可继续处理状态。
3. 给定完成被 Git operation blocker 阻止，当系统记录这次完成尝试时，CompletionAttempt 会记录明确的 blocked / failed 结果原因，且不会误写 `completed`、不会写入成功 `commit_hash`。

## Tasks / Subtasks

- [x] 收口 Story 5.5 / 5.6 之后的 Git blocker 边界，只交付“进行中操作阻止完成”，不提前混入 5.8 / 5.9 (AC: 1, 2, 3)
  - [x] 复查 [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs)、[src-tauri/src/git/operation_state.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/git/operation_state.rs)、[src-tauri/src/git/status.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/git/status.rs)、[src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 与 [src/features/issues/issue-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-commands.ts)，确认仓库已经具备 Git operation state 检测与部分命令级阻断，但尚未把 completion blocker 明确收口为稳定产品行为与审计结果。
  - [x] 明确本 story 只处理 completion 入口的 Git blocker：`Complete` 与 `Complete with Agent Commit` 在 operation in progress 时都不能完成 Issue；completed Summary、Open Log、已完成复盘入口继续留给 Story 5.8 / 5.9。
  - [x] 不新增后台 watcher、自动恢复 Git 操作、冲突解决向导、Git 历史浏览或跨 Session 的 completion repair 流程。
- [x] 在 Rust Core 把 Git operation in-progress 收口为 completion blocker，而不是通用失败文案 (AC: 1, 2, 3)
  - [x] 基于 [src-tauri/src/git/operation_state.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/git/operation_state.rs) 与 [src-tauri/src/git/status.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/git/status.rs) 现有能力，统一消费 `merge`、`rebase`、`cherry-pick`、`revert`、`sequencer`、`unmerged` 等 blocker，不重新实现第二套 Git 探测。
  - [x] 补齐 [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs) 中 `complete_issue_clean`、`prepare_agent_commit_completion` 与 `detect_agent_commit_completion` 的 blocker 收口，确保结果保持 Issue=`review`、Session 不关闭、不会误写成功审计。
  - [x] 在 `CompletionAttempt` 上按最小方案扩展 `git_operation_blocked` 结果与 `failure_reason` 字段，通过 migration 保持旧数据兼容，不新增平行审计表。
- [x] 把 blocker 结果接回现有 review Header / Completion Confirmation 交互 (AC: 2)
  - [x] 在 [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 既有错误消息路径上保留当前 xterm、Session 选中态和 inspector 上下文；completion 被 Git blocker 阻止时仍停留在当前 review 会话。
  - [x] 对 `Complete` 与 `Complete with Agent Commit` 两条入口展示事实性提示，明确说明当前 Git 操作阻止完成，并提示用户先手动处理仓库状态；提示不依赖颜色，也不伪装成 completed 或 no-commit。
  - [x] 保持已存在的 clean-path / agent-commit 区分与按钮门控；本 story 只补 blocker 提示和结果收口，不重写 Header 信息架构。
- [x] 用测试锁定 blocker 的状态、审计与文案边界 (AC: 1, 2, 3)
  - [x] Rust 测试覆盖：当仓库处于 merge / rebase / cherry-pick / revert / sequencer / unmerged 任一状态时，`complete_issue_clean` 与 Agent Commit 相关 completion 命令不会把 Issue 标记为 `completed`，不会关闭 Session，并返回可消费的 blocker 事实。
  - [x] Rust 测试覆盖：若 blocker 发生在 `prompt_sent` 之后的检测阶段，CompletionAttempt 不会写入成功 `commit_hash`，而是记录对应 blocked 原因。
  - [x] 前端测试覆盖：review Header 或 Completion Confirmation 在 blocker 发生后保留当前 Session/xterm，并展示明确文案提示用户先处理 Git 状态；完成类按钮不会错误消失成 completed 态。
  - [x] command bridge 测试同步到新的 blocker 结果合同，避免前端继续依赖通用错误字符串猜测状态。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [x] 本 story 实际修改了 TypeScript 测试、Rust Core completion 分支、CompletionAttempt 审计模型、数据库 migration 与测试，已执行：

```bash
pnpm format
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm typecheck
pnpm test -- --run src/features/agents/agents-activity.test.tsx src/shared/commands/command-client.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --test issue
cargo test --manifest-path src-tauri/Cargo.toml --test git_detection
git diff --check
```

## Dev Notes

### 关键假设与取舍

- Story 5.7 的最小目标不是重新实现 Git 检测，而是把仓库已存在的 `GitOperationState` 事实稳定接入 completion 入口和审计结果。
- 当前仓库已经具备 `merge`、`rebase`、`cherry-pick`、`revert`、`sequencer`、`unmerged` 的 operation-state 探测，以及部分 completion 命令上的早期阻断；本 story 默认优先复用这些能力，只补“对用户和审计的稳定表达”。
- 本 story 不处理 no-commit 提示优化，那是 Story 5.6 已完成范围；也不处理 completed Summary / Open Log / completed 详情页，那些属于 Story 5.8 / 5.9。
- 本 story 不引入自动 `git merge --abort` / `rebase --abort`、冲突解决流程或自动恢复；用户必须先手动处理 Git 状态，系统只负责阻止错误完成。

### 范围边界

- 交付：completion 入口对 Git operation in-progress 的统一阻断、结构化 blocker 结果 / 审计、review 上下文保持、事实性提示与测试。
- 不交付：自动恢复 Git 状态、冲突解决向导、completed Summary / Open Log、commit 详情展示、重新打开 completed Issue。
- 不交付：后台轮询 watcher、Git diff/history 浏览、跨仓库或跨 Session 的 blocker 管理。

### 当前代码状态与修改指引

- [src-tauri/src/git/operation_state.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/git/operation_state.rs) 已定义 `GitOperationState` 并通过 `.git` 标记文件识别进行中的 merge / rebase / cherry-pick / revert / sequencer，以及通过未合并文件识别 `unmerged`。
- [src-tauri/src/git/status.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/git/status.rs) 已在 snapshot 与 commit detection 结果中暴露 operation state；本 story 应继续复用其事实边界，而不是在 `issue_service` 中手写文件探测。
- [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs) 当前在 `complete_issue_clean` 与 `prepare_agent_commit_completion` 中已有“当前 Git 正在进行中的操作阻止完成/阻止 Agent Commit”的校验；需要检查是否还缺少 `detect_agent_commit_completion` 阶段的 blocker 审计与结构化结果收口。
- [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 已经承担 review Header、Completion Confirmation、错误消息与 Session/xterm 保持逻辑；5.7 应沿用这条现有路径补齐 blocker 的事实性提示与状态消费。
- [src-tauri/tests/git_detection.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/tests/git_detection.rs) 已经覆盖 operation state 探测，是 5.7 增补 completion blocker 测试的直接锚点。

### 架构约束

- 应用不得直接执行 `git add .`、`git commit` 或自动恢复 Git 操作；completion policy 只能通过 Rust Core 的 Git 事实检测和 Codex prompt 注入闭环实现。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR21, §NFR5]
- `merge` / `rebase` / `cherry-pick` 等 Git blocker 必须显式可见，不能被 completed 或通用失败吞掉。[Source: `_bmad-output/planning-artifacts/architecture.md` §失败路径可见; `epics.md` Story 5.7]
- Issue、AgentSession、CompletionAttempt、IssueAction、SessionEvent 的状态与审计写入必须由 Rust Core 统一控制，避免出现“前端以为被阻止，但后端已部分完成”的中间态。[Source: `_bmad-output/planning-artifacts/architecture.md` §状态机一致性, §审计与可复盘]
- Header、Inspector、Completion Confirmation 等 UI 操作不能卸载当前 xterm；blocker 发生后用户应继续留在原 review 上下文中处理问题。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Completion Confirmation, §Failure Paths]

### 前置故事信息

- Story 2.9 已验证 Git snapshot、operation-state 和 commit detection 事实边界，是 5.7 的直接技术前置。
- Story 5.2 已实现 clean-path `Complete` 的成功收口；5.7 需要补的是其 blocker 分支，而不是重写成功路径。
- Story 5.4 已实现 Agent Commit completion prompt 注入；Story 5.5 已实现“检测到真实新 commit 后完成”；Story 5.6 已实现“未检测到 commit 时保持 review”。
- 因此 5.7 的唯一新增切片是：Git operation in-progress 时，无论 clean-path 还是 agent-auto-commit completion，都必须阻止收口并留下可复盘事实。

### 非目标

- 不实现 Git operation 的自动恢复、冲突解决向导或一步式 `abort` 操作。
- 不实现 completed Summary、Open Log、已完成 Issue 详情展示。
- 不重构整个 completion policy 流程或 Session Header 布局，除非缺少本 story 所需最小事实源。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 5 / Story 5.5、5.6、5.7 的边界与验收标准。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR21、FR22、NFR5、NFR6、NFR10。
- `_bmad-output/planning-artifacts/architecture.md` — Git 状态职责边界、失败路径显式可见、状态机一致性、xterm 上下文连续性。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Completion Confirmation、review 继续修正、异常不伪装为成功。
- `spikes/git-commit-detection.md` 与 `_bmad-output/implementation-artifacts/2-9-spike-git-commit-detection.md` — operation state 与 commit detection 的事实边界。
- `_bmad-output/implementation-artifacts/5-5-detect-commit-hash-and-complete-issue.md`、`5-6-keep-review-when-no-commit-detected.md` — 5.7 的直接前置故事与现有 completion 收口边界。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-09T16:xx:xx+08:00：`bmad-dev-workflow` preflight 读取完整 `sprint-status.yaml`，确认当前没有 `ready-for-dev` story，按顺序锁定首个 backlog story `5-7-block-auto-completion-during-git-operation`，当前基线 `HEAD` 为 `29fc520`。
- 2026-06-09T16:xx:xx+08:00：交叉核对 Epic 5.7、PRD FR22 / NFR5 / NFR6 / NFR10、架构失败路径约束以及 UX 文档中的 Completion Confirmation / review 连续性要求，确认本 story 的唯一目标是“Git 操作进行中时阻止完成并保留 review 上下文”。
- 2026-06-09T16:xx:xx+08:00：复查当前仓库实现，确认 `GitOperationState` 与 `read_git_snapshot` 已能识别 merge / rebase / cherry-pick / revert / sequencer / unmerged，且 `issue_service` 已在部分 completion 入口上做早期阻断；因此 create-story 需把开发重点收口到统一阻断、结构化审计和 UI 提示，而不是重复造底层探测。
- 2026-06-09T15:50:30+08:00：为 `completion_attempts` 新增 `failure_reason` 字段与 `git_operation_blocked` 结果，分别通过 `0014_completion_attempt_failure_reason.sql` 与 `0015_completion_attempt_git_operation_blocked.sql` 更新 schema 约束。
- 2026-06-09T15:50:30+08:00：在 `complete_issue_clean`、`prepare_agent_commit_completion` 和 `detect_agent_commit_completion` 中统一收口 Git operation blocker；检测阶段返回结构化 `git_operation_blocked` outcome，预检查阶段记录 blocked attempt 并保持现有错误提示路径。
- 2026-06-09T15:50:30+08:00：补齐 Rust 集成测试、前端行为测试和 command bridge 测试，锁定 clean-path、agent-commit 预检查和 prompt 后检测三条 blocker 路径。

### Completion Notes List

- 2026-06-09：create-story 已为 Story 5.7 生成开发上下文，并将范围锁定为“Git 操作进行中时阻止自动完成”的最小可靠切片。
- 2026-06-09：已显式标注与 Story 5.5 / 5.6 / 5.8 / 5.9 的边界，避免开发阶段把 no-commit 提示、completed Summary 或 Open Log 混入同一实现。
- 2026-06-09：已把 Rust Core 现有 Git operation state 检测、completion 命令入口、前端 review Header 路径和测试锚点写入上下文，供 dev-story 直接消费。
- 2026-06-09：`completion_attempts` 现支持 `failure_reason` 与 `git_operation_blocked`，blocked 尝试会保留 `review` / `running` 事实，不会误写成功 `commit_hash`。
- 2026-06-09：Agent Commit 检测结果新增 `git_operation_blocked` outcome；前端继续使用当前 review 会话，只展示事实性提示，不关闭 Session、不切到 completed。
- 2026-06-09：clean-path `Complete` 在 Git operation blocker 下会保留原按钮和终端上下文，同时写入可复盘的 blocked completion attempt。

### File List

- _bmad-output/implementation-artifacts/5-7-block-auto-completion-during-git-operation.md
- src-tauri/migrations/0014_completion_attempt_failure_reason.sql
- src-tauri/migrations/0015_completion_attempt_git_operation_blocked.sql
- src-tauri/src/core/issue_service.rs
- src-tauri/src/db/completion_attempt_repository.rs
- src-tauri/src/db/migrations.rs
- src-tauri/src/types/completion_attempt.rs
- src-tauri/src/types/issue.rs
- src-tauri/tests/issue.rs
- src-tauri/tests/local_data.rs
- src/features/agents/agents-activity.test.tsx
- src/features/issues/issue-commands.ts
- src/shared/commands/command-client.test.ts
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml

### Validation Commands

- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx src/shared/commands/command-client.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`
- `git diff --check`

### Validation Results

- `pnpm format`：通过；未保留无关文件 `src/features/agents/codex-terminal-snapshot.ts` 的纯格式化差异。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx src/shared/commands/command-client.test.ts`：通过，8 files / 136 tests；存在既有 jsdom 警告 `HTMLCanvasElement.getContext()` 与 CSS stylesheet parsing，不影响结果。
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`：通过，30/30。
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`：通过，8/8。
- `git diff --check`：通过。

### Change Log

- 2026-06-09：创建 Story 5.7 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-09：为 completion blocker 新增 `git_operation_blocked` 审计结果与 `failure_reason` 字段，打通 clean-path、Agent Commit 预检查和 prompt 后检测三条 blocker 路径，状态推进到 `done`。

## Senior Developer Review (AI)

### Review Date

2026-06-09

### Outcome

Approved

### Findings Summary

- Clean review：未发现阻塞性问题；5.7 只补了 Git operation blocker 的 completion 收口，没有越界吸收 completed Summary / Open Log 或 Git 自动恢复范围。

### Reviewer Notes

- Blind Hunter：`completion_attempts` 现在能稳定记录 `git_operation_blocked + failure_reason`；clean-path 与 agent-auto-commit 两条入口在 blocker 下都不会误写 success 审计。
- Edge Case Hunter：`prepare_agent_commit_completion` 的 blocker 仍保留既有错误路径，同时补上 blocked attempt；`detect_agent_commit_completion` 在 prompt 已发送后遇到 Git blocker 会返回结构化 `git_operation_blocked`，不再把它混进 no-commit 或 completed。
- Acceptance Auditor：AC1 由现有 `GitOperationState` 探测与新增测试覆盖满足；AC2 由前端事实性提示和 review/running 保持满足；AC3 由 `CompletionAttempt.result=git_operation_blocked`、`failure_reason` 和空 `commit_hash` 满足。
