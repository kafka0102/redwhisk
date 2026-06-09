---
baseline_commit: 4157f0c
---

# Story 5.3: 展示 Agent Commit 完成确认面板

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望在有未提交改动时确认是否让 Codex 提交并完成,
以便我能在提交前看到 Git 摘要并避免误提交。

## Acceptance Criteria

1. 给定 Issue 状态为 `review`、AgentSession 为 `running`、completion policy 为 `agent_auto_commit`，当 Git status 存在未提交改动时，Session Header 显示 `Complete with Agent Commit`，且不显示 `Complete` 或 `Complete Manually`。
2. 给定用户点击 `Complete with Agent Commit`，当 Rust Core 检测当前 Issue、AgentSession、Project、HEAD、Git status 和 changed files 时，系统打开 Completion Confirmation，并展示 Git 摘要、changed files 数量、当前 HEAD 和完成选项。
3. 给定 Completion Confirmation 打开，当用户查看 completion prompt 时，completion prompt 默认隐藏，但用户可以展开查看完整 prompt。
4. 给定用户取消 Completion Confirmation，当本次完成尝试未被确认时，不发送 completion prompt、不写入完成成功审计，且 Issue 保持 `review`、AgentSession 保持 `running`。

## Tasks / Subtasks

- [x] 收口 dirty worktree 下的 Header 动作分支，只交付确认面板入口与展示，不提前实现 prompt 注入和 commit 检测收口 (AC: 1, 4)
  - [x] 复查 [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx)、[src/features/agents/agents-activity.test.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.test.tsx)、[src/features/issues/issue-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-commands.ts)，确认 5.2 已交付的 `Complete` clean-path 与 `Complete Manually` gating 哪些可复用，哪些要为 dirty-path 新增最小 UI 状态。
  - [x] 明确 Story 5.3 只负责“显示 `Complete with Agent Commit` 并打开确认面板”；不在本故事内发送 completion prompt、不检测新 commit hash、不完成 Issue、不实现 no-commit 分支提示。
  - [x] 若当前 Session 列表项对 dirty-path 还缺少最小事实源，只补支持本 story gating 所需的最小字段，避免提前扩展 5.4 / 5.5 的完整状态机。
- [x] 在 Rust Core 提供 Completion Confirmation 所需的只读快照命令 (AC: 2, 4)
  - [x] 复用 [src-tauri/src/git/status.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/git/status.rs)、[src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs)、[src-tauri/src/db/project_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/project_repository.rs)，新增只读检测路径，返回当前 `HEAD`、dirty/clean 状态、changed files 摘要或数量，以及 completion option 所需上下文。
  - [x] 校验该检测路径只允许 `review` Issue + linked `running` AgentSession + `agent_auto_commit` policy 进入；若 Git clean、Git operation in-progress、repo 不可访问或业务状态不满足，应返回事实性错误而不是伪造确认面板。
  - [x] 本 story 只做只读检测与面板数据准备；不要在该命令中写入 `CompletionAttempt` 成功记录，也不要顺手注入 completion prompt。
- [x] 实现 Completion Confirmation 面板与 prompt 折叠展示 (AC: 2, 3, 4)
  - [x] 在现有 Agents Activity / Session Header 上接入确认面板，展示 Git 摘要、changed files 数量、当前 HEAD、完成选项，并保持 xterm / inspector 不被无关卸载。
  - [x] completion prompt 默认折叠，仅在用户主动展开时显示全文；prompt 内容应来自当前应用已知的 completion prompt 生成事实源，若该事实源尚未成型，只补 Story 5.3 渲染所需的最小预览能力。
  - [x] 取消或关闭确认面板时，不触发完成命令，不改变 Issue / Session 状态，不写入成功审计。
- [x] 用测试锁定 dirty-path 确认面板的显示与失败护栏 (AC: 1, 2, 3, 4)
  - [x] 前端测试覆盖：`review + running + agent_auto_commit + dirty` 时显示 `Complete with Agent Commit`；clean-path 不显示该按钮；点击后打开确认面板并展示 HEAD / changed files / prompt 折叠区。
  - [x] 前端测试覆盖：取消确认面板时不调用后续完成动作；关闭后 Session Header 仍保持 `review` 路径。
  - [x] Rust 测试覆盖：只读检测命令在 dirty worktree 下返回确认面板所需事实；clean repo、Git operation in-progress、非 `review` Issue、无 linked running session、跨 Project、repo 不可访问等路径返回显式错误且无写入副作用。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3, 4)
  - [x] 本 story 预计会修改 TypeScript / TSX 渲染逻辑、Rust Core Git 检测消费层与测试，默认至少执行：

```bash
pnpm format
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm typecheck
pnpm test -- --run src/features/agents/agents-activity.test.tsx src/features/issues/issues-activity.test.tsx src/app/app.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml --test issue
cargo test --manifest-path src-tauri/Cargo.toml --test agent_session
cargo test --manifest-path src-tauri/Cargo.toml --test git_detection
pnpm test
git diff --check
```

## Dev Notes

### 关键假设与取舍

- Story 5.3 只交付 Agent Commit 的确认面板，不交付 completion prompt 注入、commit hash 检测、Issue 完成收口或 no-commit 后续分支；这些分别属于 5.4、5.5、5.6。
- 5.2 已经把 `agent_auto_commit + clean worktree` 收口为直接 `Complete`；因此 5.3 的入口条件应聚焦 dirty worktree，而不是重新改写 clean-path 行为。
- Completion Confirmation 必须建立在 Rust Core 对当前 Project 仓库事实的读取上；前端缓存只能决定“是否尝试打开面板”，不能作为最终 Git 摘要事实源。
- 本故事默认接受“changed files 数量或最小摘要”即可满足面板展示，不提前扩展到完整 Diff 浏览或按文件明细 review。

### 范围边界

- 交付：dirty-path Header 动作 `Complete with Agent Commit`、Completion Confirmation 面板、HEAD / changed files / completion option 展示、completion prompt 折叠区、取消不落库护栏、对应前后端测试。
- 不交付：向当前 Codex Session 注入 completion prompt、检测 HEAD 变化后的 commit hash、`CompletionAttempt` 完整成功/失败记录、Issue / Session 完成状态收口、Summary / Open Log。
- 不交付：完整 diff 浏览、changed files 逐文件审阅、reopen completed Issue、Git operation recovery UI、跨 Session completion。

### 当前代码状态与修改指引

- [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 已有 `Complete Manually` 与 clean-path `Complete` 的 gating、确认弹窗和状态 overlay；5.3 应优先沿用这套 Header 接线方式，为 dirty-path 增加 `Complete with Agent Commit` 与确认面板，而不是新开页面流。
- [src/features/agents/agents-activity.test.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.test.tsx) 已经包含 `Complete Manually` / `Complete` / `Complete with Agent Commit` 的占位可见性断言；5.3 应在这里把 dirty-path 的真实行为补齐。
- [src/features/issues/issue-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-commands.ts) 当前已有 `completeIssueManual`、`completeIssueClean`，但还没有“读取 Agent Commit completion confirmation 数据”的只读命令；5.3 适合新增与现有 completion command 并列的查询 wrapper。
- [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs) 已经在 clean-path 中完成 `agent_auto_commit` policy、Git operation、Git clean 与业务状态校验；5.3 应复用这些校验骨架，但把结果改为“返回确认面板所需快照”，而不是直接完成 Issue。
- [src-tauri/src/types/completion_attempt.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/types/completion_attempt.rs) 当前只覆盖 `complete_manual` / `complete_clean` 成功结果；在 5.3 里不应为了未来流程提前扩展未消费的 result 或 option，除非确认面板数据模型必须跨边界复用。
- [src/features/settings/project-settings-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/settings/project-settings-activity.tsx) 已把 `agent_auto_commit` 作为 Project completion policy 暴露给 UI；5.3 只需要消费这一事实，不应重构 settings 流。

### 架构约束

- Issue / AgentSession / CompletionAttempt 状态变化只能通过 Rust Core command 完成；Completion Confirmation 作为只读准备态，不能让前端直接推断完成成功。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns]
- Completion Policy 的 Git 检测必须由应用侧执行；应用不得默认执行 `git add .` 或静默提交全部改动。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR21, §NFR5]
- 失败路径必须显式可见：Git operation in-progress、repo 不可访问、业务状态不满足都应以事实性错误返回，不能展示误导性的确认面板。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §NFR6]
- Inspector、Dialog、Header 操作不能卸载 xterm；确认面板必须保持当前 Codex Session 上下文连续。[Source: `_bmad-output/planning-artifacts/architecture.md` §Cross-Cutting Concerns, `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` Product-Specific Trust Rules]

### UX 与文案约束

- `review` Issue 在 `completion_policy=agent_auto_commit` 且存在未提交改动时，Session Header 主按钮应为 `Complete with Agent Commit`。[Source: `_bmad-output/planning-artifacts/epics.md` Story 5.3; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR21]
- Completion Confirmation 必须展示 Git 摘要、changed files 数量、当前 HEAD 和完成选项；completion prompt 默认隐藏但可展开。[Source: `_bmad-output/planning-artifacts/epics.md` Story 5.3; `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` Product-Specific Trust Rules]
- 用户取消确认或尚未检测到 commit 时，Issue 必须保持 `review`；本 story 至少先锁住“取消不进入成功路径”。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` Session Header / Issue 操作状态表]

### 前置故事信息

- Story 5.1 已实现 `manual` completion 的最小闭环，建立了 review Header 的完成动作接线方式与完成确认门槛。
- Story 5.2 已实现 `agent_auto_commit + clean worktree` 的直接完成与 `CompletionAttempt` 最小落库；5.3 需要在此基础上补 dirty-path 的确认面板，而不是回退或重写 clean-path。
- Story 2.8 已验证向当前 Codex Session 注入 completion prompt 的技术方向；但 5.3 只需要展示 prompt，不负责真正注入。
- Story 2.9 已验证 Git snapshot、operation-state 与 commit detection 的能力；5.3 只消费其中“展示确认面板所需快照”的最小部分。

### 非目标

- 不实现 completion prompt 注入、commit hash 检测、AgentSession `closed` / Issue `completed` 状态收口。
- 不实现 `CompletionAttempt` 新增字段如 `changed_files_json`、`commit_hash`、`error` 的完整落库，除非最小面板读取模型确实需要。
- 不实现 completed Summary、Open Log、Reopen、完整 Diff 浏览或 Git 历史。
- 不顺手重构 Session Header、Project Settings 或 completion policy 全量模型。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 5 / Story 5.3、5.4、5.5 的故事定义、验收标准与拆分边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR21、FR22、FR23、NFR5、NFR6。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — Session Header / Issue 操作状态矩阵、completion option 定义。
- `_bmad-output/planning-artifacts/architecture.md` — 状态单一写入路径、Git 检测边界、xterm 上下文连续性。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Completion Confirmation 的信任规则、异常可见性要求。
- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` — Story 5.3 的 readiness 结论与可测试结果。
- `_bmad-output/implementation-artifacts/5-1-manually-complete-review-issue.md`、`5-2-complete-directly-when-no-uncommitted-changes.md`、`2-8-spike-codex-resume-and-completion-prompt-injection.md`、`2-9-spike-git-commit-detection.md` — 当前已交付边界和可复用实现锚点。
- `src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx`、`src/features/issues/issue-commands.ts`、`src/features/settings/project-settings-activity.tsx`、`src-tauri/src/core/issue_service.rs`、`src-tauri/src/git/status.rs`、`src-tauri/src/db/project_repository.rs`、`src-tauri/src/types/completion_attempt.rs`、`src-tauri/tests/issue.rs`、`src-tauri/tests/agent_session.rs`、`src-tauri/tests/git_detection.rs` — 预计主要改动与测试锚点。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-09T08:53:34+08:00：`bmad-dev-workflow` preflight 读取完整 `sprint-status.yaml`，确认当前没有 `ready-for-dev` story，按顺序锁定 `5-3-show-agent-commit-completion-confirmation-panel`，工作流基线 `HEAD` 为 `4157f0c`。
- 2026-06-09T08:53:34+08:00：交叉核对 Epic 5.3、PRD FR21 / FR22 / FR23、UX Completion Confirmation 信任规则，以及 Story 5.1、5.2、2.8、2.9 的已交付边界。
- 2026-06-09T08:53:34+08:00：复查当前仓库实现，确认 dirty-path `Complete with Agent Commit` 仍未真实落地；已存在的 clean-path `Complete`、manual path 和 completion policy 事实源可作为本 story 最小依赖。
- 2026-06-09T09:27:57+08:00：新增 `prepare_agent_commit_completion` 只读命令与 `canCompleteAgentCommit` gating，让 Rust Core 基于真实 Git snapshot 决定 dirty-path 入口与确认面板数据。
- 2026-06-09T09:27:57+08:00：在 `AgentsActivity` 接入 Completion Confirmation 轻量对话框，展示 HEAD、changed files 数量/摘要与默认折叠的 completion prompt；取消仅关闭面板，不触发后续完成动作。
- 2026-06-09T09:29:21+08:00：补齐 Vitest / Rust 测试、lint、typecheck、全量前端测试与 `git diff --check`，并清理 `pnpm format` 产生的无关 `codex-terminal-snapshot.ts` 折行 diff。

### Completion Notes List

- 2026-06-09：create-story 已为 Story 5.3 生成开发上下文，并将范围收口为“dirty worktree 下展示 Agent Commit 完成确认面板”的最小可靠切片。
- 2026-06-09：已显式记录 Story 5.3 与 5.4 / 5.5 / 5.6 的边界，避免开发阶段把 prompt 注入、commit hash 检测和完成收口混入同一实现。
- 2026-06-09：已把现有 clean-path / manual path 的可复用接线方式、Rust Core Git 检测骨架和 Completion Confirmation 的 UX 约束写入上下文，供 dev-story 直接消费。
- 2026-06-09：新增 `prepare_agent_commit_completion` Rust/Tauri 只读命令，返回 dirty-path Completion Confirmation 所需的 HEAD、changed files 摘要、completion option 和最小 completion prompt 预览。
- 2026-06-09：Session Header 现在会在 `agent_auto_commit + dirty + review + running` 条件下显示 `Complete with Agent Commit`，点击后打开轻量确认面板；clean-path `Complete` 和 manual path 行为保持不变。
- 2026-06-09：确认面板默认折叠 completion prompt，用户可展开查看；取消仅关闭面板，不发送 prompt、不写入完成成功审计、不改变 Issue / Session 状态。

### File List

- _bmad-output/implementation-artifacts/5-3-show-agent-commit-completion-confirmation-panel.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- src-tauri/src/commands/issue_commands.rs
- src-tauri/src/core/agent_session_service.rs
- src-tauri/src/core/issue_service.rs
- src-tauri/src/lib.rs
- src-tauri/src/types/agent_session.rs
- src-tauri/src/types/issue.rs
- src-tauri/tests/issue.rs
- src/app/app.css
- src/features/agents/agent-session-commands.ts
- src/features/agents/agents-activity.test.tsx
- src/features/agents/agents-activity.tsx
- src/features/issues/issue-commands.ts
- src/shared/commands/command-client.test.ts

### Validation Commands

- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx src/shared/commands/command-client.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`
- `pnpm lint`
- `pnpm typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`
- `pnpm test`
- `git diff --check`
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`

### Validation Results

- `pnpm format`：通过；期间对无关文件 `src/features/agents/codex-terminal-snapshot.ts` 产生纯折行差异，已在提交前移除。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx src/shared/commands/command-client.test.ts`：通过，8 files / 129 tests；存在既有 jsdom 警告 `HTMLCanvasElement.getContext()` 与 CSS stylesheet parsing，不影响结果。
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`：通过，24/24。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test git_detection`：通过，8/8。
- `pnpm test`：通过，8 files / 129 tests；存在相同既有 jsdom 警告，不影响结果。
- `git diff --check`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session`：通过，30/30。

### Change Log

- 2026-06-09：创建 Story 5.3 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-09：新增 dirty-path `Complete with Agent Commit` Header gating、`prepare_agent_commit_completion` 只读命令、Completion Confirmation 轻量对话框与默认折叠的 completion prompt 预览，状态推进到 `review`。

## Senior Developer Review (AI)

### Review Date

2026-06-09

### Outcome

Approved

### Findings Summary

- Clean review：未发现阻塞性问题；dirty-path 入口、只读 Git 快照与确认面板展示边界和本 story 目标一致，且未提前混入 prompt 注入或完成收口副作用。

### Reviewer Notes

- Blind Hunter：`Complete with Agent Commit` 只在 `agent_auto_commit + dirty + review + running` 条件下出现，clean-path `Complete` 与 manual path 保持原行为。
- Edge Case Hunter：`prepare_agent_commit_completion` 会在 Git clean、Git operation in-progress、非 `review` Issue 或无 linked running session 时显式失败，不产生写入副作用。
- Acceptance Auditor：AC1 由 Session Header 的 dirty-path gating 满足；AC2/AC3 由只读快照命令 + Completion Confirmation + 默认折叠 prompt 满足；AC4 由取消仅关闭面板、无后续完成动作满足。
