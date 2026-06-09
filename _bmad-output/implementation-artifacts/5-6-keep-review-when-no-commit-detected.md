---
baseline_commit: fa4cb73
---

# Story 5.6: 未检测到 Commit 时保持 Review

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望 Agent Commit 没有产生 commit 时 Issue 保持待验收,
以便系统不会把失败或不完整结果伪装成完成。

## Acceptance Criteria

1. 给定用户选择 Agent Commit，当 completion 后 `HEAD` 未改变时，Issue 保持 `review`，且 AgentSession 保持可继续处理的状态。
2. 给定未检测到新 commit，当系统写入 CompletionAttempt 时，`result` 记录为 `no_commit_detected`，且 `commit_hash` 为空或 `null`。
3. 给定 UI 展示结果，当用户返回 Completion Confirmation 或 Header 时，显示事实性提示“未检测到 commit，Issue 保持待验收”，且不自动 `completed`。

## Tasks / Subtasks

- [x] 收口 Story 5.5 遗留的 no-commit 分支，只交付“保持 review + 明确提示”，不提前混入 5.7/5.8/5.9 (AC: 1, 2, 3)
  - [x] 复查 [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs)、[src-tauri/src/types/completion_attempt.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/types/completion_attempt.rs)、[src-tauri/src/db/completion_attempt_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/completion_attempt_repository.rs)、[src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 与 [src/features/issues/issue-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-commands.ts)，确认 5.5 已经具备 `no_commit_detected` 审计基础和错误消息，但当前行为仍停留在“命令失败后保留上下文”的最小形态。
  - [x] 明确本 story 只把 `HEAD` 未变映射成产品层面的稳定分支：Issue 继续 `review`、Session 继续 `running`、CompletionAttempt 记录 `no_commit_detected`、UI 给出事实性提示；Git operation in-progress 的阻断语义继续留给 Story 5.7。
  - [x] 不新增轮询 watcher、后台自动重试、完整 completed Summary、Open Log 或重新打开 completed Issue 的能力。
- [x] 在 Rust Core 把 “未检测到 commit” 固化为显式业务结果，而不是泛化错误 (AC: 1, 2)
  - [x] 基于 [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs) 中已有的 `detect_agent_commit_completion`，把 `GitCommitDetectionResult::NoCommitDetected` 收口为稳定且可消费的结果载荷，确保 Issue 不离开 `review`、linked Session 不被关闭、且不会误写 completed 审计。
  - [x] 复用 Story 5.5 已落地的 `CompletionAttemptResult::NoCommitDetected`、`commit_hash: None` 与最新 `agent_auto_commit + prompt_sent` 尝试选择规则，不新造平行状态表或额外 attempt 类型。
  - [x] 当前接口原本通过抛错表达 no-commit；已做最小合同调整，把“事实性 no-commit”与“真正命令失败/仓库异常”区分开，使前端能稳定显示对应提示而不是把所有情况都当成通用错误。
- [x] 把 no-commit 结果接回现有 Completion Confirmation / Session Header 交互 (AC: 1, 3)
  - [x] 在 [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 保持当前 xterm、Session 选中态和 inspector 上下文不卸载；当检测结果是 no-commit 时，仍停留在当前 review 会话。
  - [x] Completion Confirmation 关闭后或 Header 再次可见时，向用户展示明确且事实性的提示：未检测到 commit，Issue 保持待验收；提示不能只靠颜色表达，也不能伪装成 completed。
  - [x] 保持 `Complete with Agent Commit` 入口仍可在后续修正后再次使用，但没有为本 story 追加新的二次确认流程或复杂恢复 UI。
- [x] 用测试锁定 “HEAD 未变” 的状态与文案边界 (AC: 1, 2, 3)
  - [x] Rust 测试覆盖：completion 后 `HEAD` 未改变时，`detect_agent_commit_completion` 不会把 Issue 标记为 `completed`、不会关闭 Session，且 `CompletionAttempt` 记录 `no_commit_detected` 与空 `commit_hash`。
  - [x] 前端测试覆盖：Agent Commit 检测返回 no-commit 时，当前 review Session 保持选中，终端不卸载，界面展示事实性提示，且完成类按钮不会错误消失为 completed 态。
  - [x] command bridge 测试已同步到新的返回合同，补齐 `outcome`、`issue` 和 `message` 的跨边界断言。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [x] 本 story 实际修改了 TypeScript / TSX 渲染逻辑、Rust Core 命令返回语义与测试，已执行：

```bash
pnpm format
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm typecheck
pnpm test -- --run src/features/agents/agents-activity.test.tsx src/shared/commands/command-client.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --test issue
cargo test --manifest-path src-tauri/Cargo.toml --test agent_session
cargo test --manifest-path src-tauri/Cargo.toml --test git_detection
pnpm test
git diff --check
```

## Dev Notes

### 关键假设与取舍

- Story 5.6 的最小目标不是“再次检测 commit”，而是把 Story 5.5 已经能识别的 `HEAD` 未变结果收口成用户可理解、状态可信的产品行为。
- 当前仓库已经存在 `CompletionAttemptResult::NoCommitDetected`，且 `detect_agent_commit_completion` 在 `HEAD` 未变时会保留 `review` 并返回错误文案；本 story 默认优先复用这套事实，只修正“如何稳定表达给前端和用户”的缺口。
- 本 story 不处理 merge / rebase / cherry-pick / sequencer / unmerged 等 Git operation blocker；那些属于 Story 5.7 的独立边界，不能在这里顺手扩大范围。
- 本 story 不要求自动重新发送 prompt，也不要求生成 completed Summary；用户在 no-commit 后仍应停留在原 review 上下文，继续用当前 Session 修正。

### 范围边界

- 交付：no-commit 的 Rust Core 结果收口、CompletionAttempt 审计对齐、前端 review 上下文保持、事实性提示文案、对应前后端测试。
- 不交付：Git operation blocker 的统一处理、新的 completion watcher/轮询、completed Summary、Open Log、新的 completed 页面动作。
- 不交付：额外的 Git diff/history 浏览、自动重试、重新打开 completed Issue、跨 Session completion attempt 管理。

### 当前代码状态与修改指引

- [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs) 已在 `detect_agent_commit_completion` 中区分 `GitCommitDetectionResult::NoCommitDetected`，并写入 `CompletionAttemptResult::NoCommitDetected`；这里是 5.6 的核心收口点。
- [src-tauri/src/types/completion_attempt.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/types/completion_attempt.rs) 与 [src-tauri/src/db/completion_attempt_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/completion_attempt_repository.rs) 已具备 `no_commit_detected` 枚举和持久化映射；本 story 应优先复用，不新增重复结果值。
- [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 当前在检测失败时已经保留 review Session、xterm 和错误消息；5.6 应在这条现有路径上补足稳定的 no-commit 呈现，而不是改成 completed 或引入重页面切换。
- [src/features/issues/issue-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-commands.ts) 当前 `detectAgentCommitCompletion` 仍按 `IssueRecord` 成功返回值消费；如果 5.6 需要让前端区分 no-commit 与真正错误，应在这里做最小合同调整，并同步 command bridge 测试。
- [src/features/agents/agents-activity.test.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.test.tsx) 已有 “keeps the review session active when agent commit detection does not complete” 测试，这是补齐 5.6 行为断言的最佳锚点。

### 架构约束

- `HEAD` 未变时绝不自动 `completed`；Issue 必须保持 `review`，这是 PRD、Spike 3 和架构文档明确的信任边界。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR21, §FR22; `spikes/git-commit-detection.md` 结论与对后续故事的约束]
- CompletionAttempt 必须记录 `no_commit_detected` 且 `commit_hash` 为空，使这次尝试可以被后续 Summary/诊断复盘。[Source: `_bmad-output/planning-artifacts/epics.md` Story 5.6; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR22, §SM-3]
- 失败路径必须显式可见，不能把 no-commit 吞成通用失败，也不能用 completed 态掩盖。[Source: `_bmad-output/planning-artifacts/architecture.md` §Cross-Cutting Concerns, §失败路径可见]
- Header、Inspector、Completion Confirmation 等 UI 操作不能卸载当前 xterm；no-commit 后继续修正必须沿用同一 Session 上下文。[Source: `_bmad-output/planning-artifacts/architecture.md` §Cross-Cutting Concerns]

### 前置故事信息

- Story 5.4 已实现 completion prompt 注入与 `prompt_sent` 审计，为 5.6 提供 attempt 事实源。
- Story 5.5 已实现“检测到真实新 commit 后完成”的成功闭环，并已在 Rust Core 中加入 `no_commit_detected` 审计分支；5.6 只补 no-commit 的产品收口，不重写成功路径。
- Story 2.9 已验证 `HEAD` 未改变必须稳定归档为 `no_commit_detected`，且 Issue 保持 `review`。
- Story 5.7 仍负责 Git operation in-progress 的专门阻断；5.6 不应顺手吸收这部分复杂度。

### 非目标

- 不实现 merge / rebase / cherry-pick / revert / sequencer 等 blocker 的统一 UX。
- 不实现 completed Summary、Open Log、commit hash 展示页或 completed Issue 复盘面板。
- 不新增轮询、后台自动检测或自动重试机制。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 5 / Story 5.6、5.7 的验收标准与边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR21、FR22、FR23、NFR6、SM-3。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — completion policy 状态表与 `HEAD` 未变时保持 `review` 的规则。
- `_bmad-output/planning-artifacts/architecture.md` — 失败路径显式可见、Rust Core 单一状态写入、xterm 上下文连续性。
- `spikes/git-commit-detection.md` — `NoCommitDetected` 结论及对 Story 5.6 的直接约束。
- `_bmad-output/implementation-artifacts/5-4-inject-completion-prompt-into-current-codex-session.md`、`5-5-detect-commit-hash-and-complete-issue.md` — 5.6 的直接前置故事与已交付边界。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-09T15:04:02+08:00：`bmad-dev-workflow` preflight 读取完整 `sprint-status.yaml`，确认当前没有 `ready-for-dev` story，按顺序锁定首个 backlog story `5-6-keep-review-when-no-commit-detected`，当前基线 `HEAD` 为 `fa4cb73`。
- 2026-06-09T15:04:02+08:00：交叉核对 Epic 5.6、PRD FR21 / FR22、addendum 和 Spike 3 结论，确认本 story 的唯一目标是把 `HEAD` 未变映射成稳定的 `review + no_commit_detected + 用户可见提示`。
- 2026-06-09T15:04:02+08:00：复查当前仓库实现，确认 Rust Core 已有 `CompletionAttemptResult::NoCommitDetected` 与 `detect_agent_commit_completion` 分支，前端也已有“保留 review 会话”的最小行为；因此本 story 不从零实现，而是在现有基础上补齐产品收口与测试。
- 2026-06-09T15:15:27+08:00：将 `detect_agent_commit_completion` 的返回合同从单一 `IssueRecord` 扩展为结构化结果，区分 `completed` 与 `no_commit_detected`，同时在 Rust Core 的 no-commit 分支补写 `CompletionAttemptResult::NoCommitDetected` 和 `head_after`。
- 2026-06-09T15:15:27+08:00：前端 `AgentsActivity` 改为按 `outcome` 消费 Agent Commit 检测结果；no-commit 时关闭 Completion Confirmation、保留当前 review Session/xterm，并在 Header 区域展示事实性提示。
- 2026-06-09T15:15:27+08:00：补齐 Rust 集成测试、前端行为测试和 command bridge 测试；按项目规则完成 `format`、`lint`、`typecheck`、定向/全量 Vitest、Rust tests 与 `git diff --check`。

### Completion Notes List

- 2026-06-09：create-story 已为 Story 5.6 生成开发上下文，并将范围收口为“未检测到 commit 时保持 review”的最小可靠切片。
- 2026-06-09：已显式标出与 5.5、5.7、5.8、5.9 的边界，避免开发阶段把 blocker 处理或 completed 复盘混入同一实现。
- 2026-06-09：已把 Rust Core、CompletionAttempt、前端 review 上下文保持和测试锚点写入上下文，供 dev-story 直接消费。
- 2026-06-09：`detect_agent_commit_completion` 现在在 no-commit 路径返回显式业务结果而不是通用异常；成功路径仍保持 completed 收口，不影响 5.5 已交付行为。
- 2026-06-09：`CompletionAttempt` 在 `HEAD` 未变时会被更新为 `no_commit_detected`，`commit_hash` 为空，Issue 保持 `review`，Session 保持 `running`。
- 2026-06-09：`AgentsActivity` 会在 no-commit 后关闭 Completion Confirmation，并在当前 review Header 下保留 `Complete with Agent Commit` 动作和事实性提示，方便用户继续在同一 Session 修正。

### File List

- _bmad-output/implementation-artifacts/5-6-keep-review-when-no-commit-detected.md
- src-tauri/src/commands/issue_commands.rs
- src-tauri/src/core/issue_service.rs
- src-tauri/src/types/issue.rs
- src-tauri/tests/issue.rs
- src/features/agents/agents-activity.test.tsx
- src/features/agents/agents-activity.tsx
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
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`
- `pnpm test`
- `git diff --check`

### Validation Results

- `pnpm format`：通过；期间对无关文件 `src/features/agents/codex-terminal-snapshot.ts` 产生纯折行差异，已在提交前移除。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx src/shared/commands/command-client.test.ts`：通过，8 files / 133 tests；存在既有 jsdom 警告 `HTMLCanvasElement.getContext()` 与 CSS stylesheet parsing，不影响结果。
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`：通过，27/27。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：通过，30/30。
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`：通过，8/8。
- `pnpm test`：通过，8 files / 133 tests；存在相同既有 jsdom 警告，不影响结果。
- `git diff --check`：通过。

### Change Log

- 2026-06-09：创建 Story 5.6 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-09：把 Agent Commit no-commit 路径从“通用错误”收口为结构化业务结果，补齐 `CompletionAttempt=no_commit_detected` 审计、前端 review 保持逻辑与测试，状态推进到 `done`。

## Senior Developer Review (AI)

### Review Date

2026-06-09

### Outcome

Approved

### Findings Summary

- Clean review：未发现阻塞性问题；5.6 只补了 `HEAD` 未变时的 no-commit 收口，没有越界吸收 5.7 的 Git blocker 或 5.8/5.9 的 completed 复盘范围。

### Reviewer Notes

- Blind Hunter：`detect_agent_commit_completion` 现在会把 no-commit 分支更新为 `CompletionAttemptResult::NoCommitDetected` 并返回结构化结果；completed 路径仍只有在检测到前进式新 commit 时才关闭 Session 并完成 Issue。
- Edge Case Hunter：前端对 `no_commit_detected` 采用显式 `outcome` 分支，不再依赖异常消息字符串判断；Completion Confirmation 会关闭，但 review Session、xterm 和 `Complete with Agent Commit` 动作会保留。
- Acceptance Auditor：AC1 由 no-commit 时 `issue.status=review` / `session.status=running` 满足；AC2 由 `CompletionAttempt.result=no_commit_detected` 和 `commit_hash=None` 满足；AC3 由 Header 下的事实性提示和非 completed 行为满足。
