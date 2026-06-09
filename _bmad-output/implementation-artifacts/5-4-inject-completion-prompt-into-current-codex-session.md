---
baseline_commit: 194ea2c
---

# Story 5.4: 向当前 Codex Session 注入 Completion Prompt

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望让当前 Codex Session 只提交本 Issue 相关改动,
以便完成动作保留上下文并避免应用直接执行 Git 提交。

## Acceptance Criteria

1. 给定 Completion Confirmation 已打开，当用户确认 Agent Commit 时，Rust Core 将 completion prompt 发送给当前 Codex PTY，且不启动新的无上下文 Codex 进程。
2. 给定 completion prompt 已发送，当系统记录事件时，写入可审计的 SessionEvent，并为本次 Agent Commit 创建或更新 CompletionAttempt，至少记录 `head_before`、`changed_files_json`、`option=agent_auto_commit`。
3. 给定应用执行 Agent Commit 流程，当检查实现行为时，应用层不得直接执行 `git add .` 或自行提交全部改动，只能通过 Codex Session 和后续 Git 检测验证结果。

## Tasks / Subtasks

- [x] 把 5.3 的只读确认面板推进为“确认后注入 completion prompt”，继续复用已存在的活会话注入链路，不新开进程 (AC: 1, 3)
  - [x] 复查 [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx)、[src/features/agents/agent-session-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agent-session-commands.ts)、[src/features/issues/issue-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-commands.ts)、[src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs)、[src-tauri/src/core/agent_session_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/agent_session_service.rs)，确认 5.3 的确认面板和 2.8 的 prompt 注入命令各自负责什么。
  - [x] 保持范围边界：本 story 只负责“发送 completion prompt 并留下审计事实”，不在这里检测 commit hash，不关闭 Session，不把 Issue 置为 `completed`。
- [x] 在 Rust Core 新增 Agent Commit 注入命令，并在发送前重新校验业务与 Git 前置条件 (AC: 1, 3)
  - [x] 基于 `prepare_agent_commit_completion` 返回的 `session_id`、`head`、`changed_files` 和 `completion_prompt`，新增明确的“确认并发送 Agent Commit prompt”命令入口，而不是让前端直接拼装底层 PTY 注入调用。
  - [x] 发送前再次校验：Project `completion_policy=agent_auto_commit`、Issue 仍为 `review`、linked Agent Session 仍为 `running`、Git 仍有未提交改动且 `operation_state=none`；如果事实已变化，返回显式错误并保持原状态。
  - [x] 复用 Story 2.8 已验证的 `inject_agent_session_prompt` / PTY writer 链路，确保 prompt 真正进入当前活 Session。
- [x] 为 Agent Commit 建立最小审计落库，而不是提前做完后续完成状态机 (AC: 2, 3)
  - [x] 扩展 [src-tauri/src/types/completion_attempt.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/types/completion_attempt.rs) 与对应 repository / migration，只补本 story 必需字段：`option=agent_auto_commit`、`head_before`、`changed_files_json`，以及一个能表达“prompt 已发送但尚未判定完成”的最小结果。
  - [x] 复用当前 `session_prompt_injected` 事件模型；当前通过 `kind=completion`、`issueId` 和单独的 `CompletionAttempt` 记录形成审计闭环，没有额外新造重复事件类型。
  - [x] 保持单一事实源：应用只记录“已发送 prompt”的尝试，不伪造 commit hash、`head_after` 或完成成功结果；这些继续留给 5.5 / 5.6。
- [x] 把确认面板的主动作接到新命令，并锁住发送后的最小前端行为 (AC: 1, 2)
  - [x] 用户在 Completion Confirmation 点击确认后，前端调用新的 Agent Commit 注入命令；成功时关闭确认面板并刷新 Session 列表，但 Issue 保持 `review`、Session 保持 `running`。
  - [x] 失败时保留当前 review 上下文，不清空 xterm、不卸载 inspector，并展示来自 Rust Core 的事实性错误。
  - [x] 不允许前端直接调用通用 `injectAgentSessionPrompt` 绕过 5.3 准备态与 5.4 业务校验。
- [x] 用测试锁定“发送 prompt 而不直接完成”的边界 (AC: 1, 2, 3)
  - [x] Rust 测试覆盖：dirty review issue 在确认后会把 completion prompt 写入当前活 PTY，并写入 SessionEvent / CompletionAttempt；clean repo、Git operation in-progress、非 `review` Issue、无 linked running session 等路径显式失败且无部分写入。
  - [x] 前端测试覆盖：Completion Confirmation 点击确认后会调用新命令；成功时关闭面板但不把 Issue 直接改成 `completed`；失败时错误可见且 review Header 仍留在当前上下文。
  - [x] command bridge 测试已在 [src/shared/commands/command-client.test.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/shared/commands/command-client.test.ts) 补齐。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [x] 本 story 预计会修改 TypeScript / TSX、Rust Core 命令/服务、数据库类型或 migration，默认至少执行：

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

- Story 5.4 的最小目标是“把 confirmation 变成真实 prompt 注入”，不是完成整个 Agent Commit 闭环；commit hash 检测、Issue / Session 收口和 no-commit 分支分别属于 5.5 / 5.6 / 5.7。
- Story 2.8 已验证“向当前活 Session 注入 follow-up / completion prompt”这条能力可用，因此 5.4 不应重复发明第二套注入机制，而应把它包裹进 Epic 5 的业务校验和审计边界。
- Story 5.3 已经准备好了 dirty-path 所需的 `head`、`changed_files` 和 `completion_prompt` 预览；5.4 应继续复用这些事实，而不是在前端重新读取 Git 或重新拼 prompt。
- 当前 `CompletionAttempt` 类型仍只覆盖 `complete_manual` / `complete_clean` 和 `completed` 成功结果；5.4 需要最小扩展为“Agent Commit 尝试已发送但尚未判定结果”的中间态，但不要顺手把 5.5/5.6 的最终状态机一次做完。

### 范围边界

- 交付：确认后把 completion prompt 发送到当前活 Session、发送前再校验业务与 Git 前置条件、最小 `CompletionAttempt`/`SessionEvent` 审计、前后端测试。
- 不交付：检测新 commit hash、更新 `head_after` / `commit_hash`、将 Issue 置为 `completed`、关闭 Agent Session、`no_commit_detected` 提示分支、Summary / Open Log。
- 不交付：新的 resume 入口、完整 diff 浏览、应用侧直接执行 Git 命令提交、绕过当前 Session 的无上下文新进程。

### 当前代码状态与修改指引

- [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs) 已有 `prepare_agent_commit_completion`，负责 5.3 的 dirty-path 预检和 prompt 预览；5.4 更适合在这里新增“确认发送”的业务命令，而不是让前端直接拿 preview 结果去调底层 PTY 命令。
- [src-tauri/src/commands/agent_session_commands.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/commands/agent_session_commands.rs) 与 [src/features/agents/agent-session-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agent-session-commands.ts) 已暴露 `inject_agent_session_prompt`；5.4 应优先复用这条链路，但把调用权收束在 Epic 5 的业务命令内。
- [src-tauri/src/types/session_event.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/types/session_event.rs) 当前已有 `session_prompt_injected`；最小方案优先复用这一事件，并通过 payload 区分 `intent=completion`，避免新增重复事件类型后又无人消费。
- [src-tauri/src/types/completion_attempt.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/types/completion_attempt.rs) 目前没有 `agent_auto_commit` 选项、`changed_files_json` 或中间结果；这是 5.4 需要补的最小数据模型缺口。
- [spikes/codex-resume-completion-prompt.md](/Users/yujianjia/workspace/kafka/redwhisk/spikes/codex-resume-completion-prompt.md) 已明确 5.4 可以依赖“向当前活 Session 注入 completion prompt”的能力，但不能把“prompt 已送达”误当作“commit 一定会产生”。
- [spikes/git-commit-detection.md](/Users/yujianjia/workspace/kafka/redwhisk/spikes/git-commit-detection.md) 已明确 `HEAD` 不变时必须视为 `no_commit_detected`；因此 5.4 不要尝试提前消费 `detect_commit_result` 去收口完成状态。

### 架构约束

- Completion Policy 的安全边界是不允许应用层直接 `git add .` / `git commit`；应用只能把约束明确的 completion prompt 发送给当前 Codex Session，再由后续 Git 检测决定是否真正完成。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR21, §NFR5]
- Issue、Agent Session、CompletionAttempt 的状态和审计写入必须由 Rust Core 统一控制；前端不能把“prompt 已发送”直接解释成完成成功。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns]
- 失败路径必须显式可见：repo 不可访问、Git operation in-progress、clean repo、Session 已关闭、Issue 已离开 `review` 都需要事实性错误而不是静默降级。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §NFR6]

### 前置故事信息

- Story 2.8 已提供可复用的 prompt 注入链路与 `session_prompt_injected` 审计事件，是 5.4 的直接技术前置。
- Story 2.9 已提供 Git snapshot / operation-state / commit detection 能力；5.4 只消费其中“发送前仍需 dirty + no operation blocker”的校验，不进入 commit 结果判定。
- Story 5.2 已实现 clean-path `Complete` 与最小 `CompletionAttempt` 落库；5.4 需要在此基础上扩展 `agent_auto_commit` 尝试，而不是重写完成尝试仓储。
- Story 5.3 已交付 Completion Confirmation 面板与 `prepare_agent_commit_completion` 只读预览，是 5.4 的直接 UI / command 前置。

### 非目标

- 不检测 commit hash，不把 Issue 标记为 `completed`，不关闭 Agent Session。
- 不实现 `no_commit_detected`、`HeadMovedWithoutNewCommit`、Git operation blocker 的后续完成分支 UI。
- 不把通用 prompt 注入命令暴露为任何 review 页面都能直接绕过业务校验的快捷路径。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 5 / Story 5.4、5.5、5.6 的边界与验收条件。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR21、FR22、NFR5、NFR6。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — `complete_issue_with_policy`、completion option、CompletionAttempt 审计期望。
- `_bmad-output/planning-artifacts/architecture.md` — Rust Core 单一状态写入、审计与 Git 安全边界。
- `_bmad-output/implementation-artifacts/2-8-spike-codex-resume-and-completion-prompt-injection.md` — 同会话 prompt 注入的已验证结论。
- `_bmad-output/implementation-artifacts/2-9-spike-git-commit-detection.md` — dirty / operation-state / no-commit 的 Git 事实边界。
- `_bmad-output/implementation-artifacts/5-2-complete-directly-when-no-uncommitted-changes.md`、`5-3-show-agent-commit-completion-confirmation-panel.md` — 当前 Epic 5 已交付边界。
- `spikes/codex-resume-completion-prompt.md`、`spikes/git-commit-detection.md` — Story 5.4 可依赖与不可越界的 Spike 结论。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-09T10:01:00+08:00：`bmad-dev-workflow` preflight 读取完整 `sprint-status.yaml`，锁定首个 backlog story `5-4-inject-completion-prompt-into-current-codex-session`，当前基线 `HEAD` 为 `194ea2c`。
- 2026-06-09T10:01:00+08:00：交叉核对 Epic 5.4、PRD FR21 / FR22、addendum 的 completion policy 审计边界，以及 Story 2.8、2.9、5.2、5.3 的已交付事实。
- 2026-06-09T10:01:00+08:00：确认本 story 的最小切片应为“确认后向当前活 Session 发送 completion prompt 并记录尝试”，不混入 commit 检测和完成收口。
- 2026-06-09T10:50:53+08:00：新增 `send_agent_commit_prompt` Rust/Tauri 业务命令，复用 `prepare_agent_commit_completion` 校验与 `inject_agent_session_prompt` PTY 链路，把 Agent Commit 确认动作收口到 Rust Core。
- 2026-06-09T10:50:53+08:00：新增 `0012_agent_commit_completion_attempts.sql`，扩展 `completion_attempts` 支持 `agent_auto_commit` / `prompt_sent` / `changed_files_json`，并保持旧数据迁移为 `'[]'` 默认值。
- 2026-06-09T10:50:53+08:00：Agents Activity 的 Completion Confirmation 已接入真实 Confirm 动作；确认后关闭面板并保留 `review + running` 上下文，不直接进入 completed。
- 2026-06-09T10:50:53+08:00：完成 `pnpm format`、`cargo fmt`、`pnpm lint`、`pnpm typecheck`、Vitest、Rust integration tests、`git diff --check`；其中 `pnpm format` 一度改动无关文件 `src/features/agents/codex-terminal-snapshot.ts`，已在提交前恢复。

### Completion Notes List

- 2026-06-09：create-story 已为 Story 5.4 生成开发上下文，并将范围收口为“向当前 Codex Session 注入 completion prompt + 最小审计”。
- 2026-06-09：已显式标出与 5.5 / 5.6 / 5.7 的边界，避免开发阶段把 commit 检测、完成收口和 blocker UI 混入同一实现。
- 2026-06-09：新增 `send_agent_commit_prompt` 业务命令，发送前会重做 `agent_auto_commit + dirty + review + running + operation_state=none` 校验，然后通过当前活 PTY 注入 completion prompt。
- 2026-06-09：Completion Confirmation 的确认按钮现在会真正发送 prompt，并在成功后仅关闭面板与刷新会话；Issue 仍保持 `review`，Session 仍保持 `running`。
- 2026-06-09：`completion_attempts` 新增 `agent_auto_commit` / `prompt_sent` / `changed_files_json`，为 5.5 的 commit 检测和 5.6 的 no-commit 收口保留了可追溯事实。

### File List

- _bmad-output/implementation-artifacts/5-4-inject-completion-prompt-into-current-codex-session.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- src-tauri/migrations/0012_agent_commit_completion_attempts.sql
- src-tauri/src/commands/issue_commands.rs
- src-tauri/src/core/issue_service.rs
- src-tauri/src/db/completion_attempt_repository.rs
- src-tauri/src/db/migrations.rs
- src-tauri/src/lib.rs
- src-tauri/src/types/completion_attempt.rs
- src-tauri/src/types/issue.rs
- src-tauri/tests/issue.rs
- src-tauri/tests/local_data.rs
- src/features/agents/agents-activity.test.tsx
- src/features/agents/agents-activity.tsx
- src/features/issues/issue-commands.ts
- src/shared/commands/command-client.test.ts

### Validation Commands

- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx src/shared/commands/command-client.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`
- `cargo test --manifest-path src-tauri/Cargo.toml --test local_data`
- `pnpm test`
- `git diff --check`

### Validation Results

- `pnpm format`：通过；期间对无关文件 `src/features/agents/codex-terminal-snapshot.ts` 产生纯折行差异，已在提交前恢复。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx src/shared/commands/command-client.test.ts`：通过，8 files / 131 tests；存在既有 jsdom 警告 `HTMLCanvasElement.getContext()` 与 CSS stylesheet parsing，不影响结果。
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`：通过，25/25。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：通过，30/30。
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`：通过，8/8。
- `cargo test --manifest-path src-tauri/Cargo.toml --test local_data`：通过，5/5。
- `pnpm test`：通过，8 files / 131 tests；存在相同既有 jsdom 警告，不影响结果。
- `git diff --check`：通过。

### Change Log

- 2026-06-09：创建 Story 5.4 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-09：完成 Agent Commit completion prompt 注入命令、`completion_attempts` 发送态扩展、Completion Confirmation 确认动作接线与前后端测试，状态推进到 `review`。

## Senior Developer Review (AI)

### Review Date

2026-06-09

### Outcome

Approved

### Findings Summary

- Clean review：未发现阻塞性问题；completion prompt 注入仍停留在当前活 Session 和最小审计边界，没有提前越界到 commit 检测或 Issue 完成收口。

### Reviewer Notes

- Blind Hunter：`send_agent_commit_prompt` 仍然先走 `agent_auto_commit + dirty + review + running + operation_state=none` 校验，再通过现有 PTY 注入链路发送 prompt，没有绕过 5.3 的准备态。
- Edge Case Hunter：clean repo、Git operation in-progress、非 `review` Issue 和无 linked running session 仍会被显式拦截；`CompletionAttempt` 只记录 `prompt_sent`，不会伪造 commit 成功。
- Acceptance Auditor：AC1 由确认后发送到当前 PTY 满足；AC2 由 `session_prompt_injected` + `CompletionAttempt(agent_auto_commit, prompt_sent, changed_files_json)` 满足；AC3 由 Rust Core 独占发送路径和“应用不直接执行 git 提交”边界满足。
