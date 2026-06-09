---
story_key: 5-8-view-completed-issue-summary
baseline_commit: 3629596
---

# Story 5.8: 查看 Completed Issue Summary

Status: done

## Story

作为本地开发者,
我希望查看 completed Issue 的 Summary,
以便我能复盘 Agent 做过什么、是否提交、日志在哪里。

## Acceptance Criteria

1. 给定 Issue 状态为 `completed`，当用户在 Issue Detail、Agents Header 或 Inspector 中触发 `View Summary` 时，系统展示 completed Issue Summary，并至少包含 Issue 信息、Agent Session 时间、Agent Session 状态、CompletionAttempt 结果、commit hash 和日志路径。
2. 给定 completed Issue 对应的 CompletionAttempt 存在 `commit_hash`，当 Summary 展示时，commit hash 清晰可见；若没有 `commit_hash`，Summary 明确说明本次完成未产生提交或属于无提交完成路径，而不是留空让用户猜测。
3. 给定 completed Issue 的 Session / CompletionAttempt / 日志事实存在缺口或状态不一致，当 Summary 展示时，系统暴露事实性诊断信息，不自动修复状态，也不把异常伪装成成功。

## Tasks / Subtasks

- [x] 明确 Summary 只服务于 `completed` Issue 的复盘，不混入 5.9 的日志打开动作与 reopen/重跑路径 (AC: 1, 2, 3)
  - [x] 复查 [src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx)、[src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 与 [src/features/agents/issue-inspector.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/issue-inspector.tsx) 中 completed / abnormal session 的现有动作边界，确认本 story 只新增 `View Summary`，保留现有 `Open Log` 行为给 5.9 继续收口。
  - [x] 对照 [src/features/agents/agents-activity.test.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.test.tsx) 中已存在的 `View Summary` 缺口断言，以及 [src/features/issues/issues-activity.test.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.test.tsx) 中 completed Issue 当前 “No actions available.” 的现状，确定最小可交付入口范围。
  - [x] 不新增 completed Issue 的 `Run`、`Mark Review`、`Complete`、`Reopen` 或自动修复入口；MVP 只读展示 summary。
- [x] 在 Rust Core 暴露 completed summary 所需的聚合查询，复用现有权威数据源而不是新增平行表 (AC: 1, 2, 3)
  - [x] 基于 [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs)、[src-tauri/src/db/completion_attempt_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/completion_attempt_repository.rs) 与现有 `IssueRecord` / `CompletionAttemptRecord`，设计最小的新 command / DTO，聚合 completed Issue、linked session、最新相关 CompletionAttempt 与 `log_path`。
  - [x] 优先复用 `completion_attempts` 里已有的 `option`、`result`、`commit_hash`、`failure_reason`、`head_before` / `head_after` 与 `changed_files_json`；不要为 summary 另建专用审计表或复制状态。
  - [x] 当 completed Issue 没有关联 session、没有 completion attempt、session 状态异常或日志路径缺失时，summary 返回明确诊断字段，让前端按事实展示而不是用空白兜底。
- [x] 在前端补齐 completed Summary 的入口与只读展示 (AC: 1, 2, 3)
  - [x] 在 [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 的 completed header 动作中显示 `View Summary`，并保持 completed Issue 不出现 `Mark Review` / `Complete*` 等运行态动作。
  - [x] 在 [src/features/agents/issue-inspector.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/issue-inspector.tsx) 与 [src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx) 为 completed Issue 提供一致的 summary 打开路径；新增 [src/features/issues/issue-summary-dialog.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-summary-dialog.tsx) 承载只读展示。
  - [x] Summary 至少展示：Issue 标题/状态、Session 时间与状态、completion option / result、commit hash 或“未产生提交”说明、日志路径，以及数据缺口/不一致时的诊断说明；保持事实性文案，不伪装成成功。
- [x] 用测试锁定 completed Summary 的入口、内容和诊断边界 (AC: 1, 2, 3)
  - [x] 前端测试覆盖：Agents Header、Issue Inspector、Issue Detail 在 completed Issue 下展示 `View Summary`，同时仍不展示禁用范围内的运行态动作。
  - [x] 前端测试覆盖：summary 视图展示 commit hash、无 commit 文案、日志路径及诊断信息；缺字段时仍显示明确说明，不崩溃、不静默留空。
  - [x] Rust 测试覆盖：summary command 在 manual completion、clean completion、agent_auto_commit completion场景下返回预期聚合结果与诊断字段。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [x] 已执行受影响范围的格式化、`lint`、`typecheck`、`test`，并在本记录中逐条记录实际命令与结果。

### Review Follow-ups (AI)

- [x] [AI-Review][High] 让 completed summary 绑定“最终完成事实”，不要直接取最新 `CompletionAttempt` 作为 completion 展示来源 (AC: 2, 3)
  - [x] 当 Issue 先经历 `agent_auto_commit` 的 `no_commit_detected` / `git_operation_blocked`，之后再走 `complete_manual` 或 `complete_clean` 完成时，`get_issue_summary` 不能继续显示之前那条失败 attempt；应优先选择能代表最终 completed 状态的记录，或回退到 `IssueCompleted` action / session 事实并输出诊断。
  - [x] 为“失败 attempt 后手动完成”或“失败 attempt 后 clean completion”补集成测试，锁定 summary 不会把最终完成 Issue 错报成 `no_commit_detected` / `git_operation_blocked`。
- [x] [AI-Review][Medium] completed issue 的不一致状态也必须能从 Agents Header 进入 Summary，并在 Summary 中输出明确 diagnostics (AC: 1, 3)
  - [x] 当前 `AgentsActivity` 仅在 `selectedSession.status === "closed"` 时显示 `View Summary`；若 completed Issue 关联 session 为 `crashed` / `stopped` 或其他异常状态，Header 无法进入 Summary，违背“Header 可查看 Summary”与“不一致状态要可诊断”的目标。
  - [x] 在 `get_issue_summary` 中补 completed + session 状态不一致的诊断，例如 completed Issue 仍关联 `running` / `crashed` / `stopped`、缺少 `closed_at` 等；并为这些诊断补测试。

## Dev Notes

### 关键假设与取舍

- Story 5.8 的目标是“让 completed Issue 可复盘”，不是让用户重新进入执行流；因此 UI 必须是只读 summary，而不是新的修复/重跑入口。
- 现有仓库已经具备 `Open Log` 按钮和 CompletionAttempt 审计模型；本 story 默认优先把这些事实组织成 summary，不重新设计日志系统，也不把 5.9 的“打开原始日志”能力混入本 story。
- 当前 `IssueRecord` 只暴露 linked session 的少量字段，无法直接满足 summary 详情；因此需要最小新增一个 summary 查询合同，而不是把 `list_issues` 变成过载 DTO。
- completed Issue 可能来自 `complete_manual`、clean completion 或 `agent_auto_commit`，也可能没有 `commit_hash`；UI 必须把“没有提交”作为合法事实展示，而不是把 commit 区块直接隐藏。

### 范围边界

- 交付：completed Issue 的 `View Summary` 入口、summary 数据聚合合同、只读展示、缺失/不一致诊断与测试。
- 不交付：`Open Log` 打开文件行为的主实现、completed Issue 重新运行 / reopen、Git 修复建议、commit diff 浏览、Session transcript 内嵌查看。
- 不交付：重构整个 Issues / Agents 布局；只在现有 completed action surface 上补 summary。

### 当前代码状态与修改指引

- [src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx) 当前 completed Issue 在详情对话框中没有动作，只有 abnormal linked session 才显示 `Open Log`；5.8 需要为 completed 状态补 `View Summary` 路径。
- [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 当前 review/running header 已区分 `Mark Review`、`Complete`、`Complete with Agent Commit`、`Open Log`；测试中已经存在 completed 场景下 `View Summary` 不应出现在 review 的断言，说明该入口应只出现在 completed 语义下。
- [src/features/agents/issue-inspector.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/issue-inspector.tsx) 目前只提供 `Open Log` / `Open in Issues`；5.8 需要补 completed summary 的一致入口，但仍需保留现有 inspector 编辑/查看边界。
- [src/features/issues/issue-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-commands.ts) 当前没有 completed summary 的 command 合同；应新增最小接口，不要把 summary 数据塞进 `IssueRecord`。
- [src-tauri/src/db/completion_attempt_repository.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/db/completion_attempt_repository.rs) 已支持按 issue 列出 completion attempts，可直接作为 summary 聚合的数据源。
- [src-tauri/src/core/issue_service.rs](/Users/yujianjia/workspace/kafka/redwhisk/src-tauri/src/core/issue_service.rs) 已统一处理 manual / clean / agent-auto-commit 完成及 `CompletionAttempt` 记录，是新增 summary query 的优先落点。

### 架构约束

- FR23 / FR24 的 completed Summary / Log 属于 `features/issues` + Rust Core 聚合能力，前端不直接拼接 SQLite 原始结构，也不自行判断权威状态。[Source: `_bmad-output/planning-artifacts/architecture.md` §Feature / FR Mapping, §Service Boundaries, §Data Boundaries]
- completed Issue 不新增 `Run`、`Mark Review`、`Complete Manually`、`Complete with Agent Commit` 或 `Reopen` 主路径。[Source: `_bmad-output/planning-artifacts/epics.md` Story 5.9 AC3; `_bmad-output/planning-artifacts/architecture.md` §不在 completed Issue 上新增 Run/Reopen 主路径]
- Summary 必须使用事实性诊断展示异常，不能自动修复状态，也不能把 crashed / missing log / no commit 伪装成 completed success。[Source: `_bmad-output/planning-artifacts/epics.md` Story 5.8 AC3; `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §用户怕异常被伪装成成功]
- 日志原文仍保留在文件系统中；summary 只展示日志路径与复盘摘要，不把原始 PTY 输出复制进 SQLite。[Source: `_bmad-output/planning-artifacts/epics.md` Story 5.9 AC1; `_bmad-output/planning-artifacts/architecture.md` §Data Boundaries]

### 前置故事信息

- Story 5.2 已支持 clean-path 完成并把 Issue / Session 正确推进到 `completed` / `closed`。
- Story 5.5 已支持检测真实 commit hash 并完成 Issue；Story 5.6 已覆盖“未检测到 commit 仍保持 review”；Story 5.7 已补齐 `git_operation_blocked` 的 CompletionAttempt 审计。
- 因此 5.8 应消费既有 completion 审计事实，覆盖 `complete_manual`、`complete_clean`、`agent_auto_commit + completed` 等 completed 路径，同时能在数据缺口时显示诊断。

### 非目标

- 不实现 `Open Log` 命令本身的新行为或新的操作系统集成。
- 不实现 completed Issue 的 diff 浏览、commit checkout、日志全文阅读或 reopen。
- 不顺手重构 `IssueRecord`、Session list 分组或 Settings 页面。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 5 / Story 5.8、5.9 的验收标准与 completed 约束。
- `_bmad-output/planning-artifacts/architecture.md` — FR23 / FR24 的结构映射、service/data boundary、completed 不 reopen 约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Summary / Log View、异常不伪装成成功、completed 后复盘路径。
- `src/features/agents/agents-activity.test.tsx` — completed / review header 动作边界与 `View Summary` 相关断言锚点。
- `src/features/issues/issues-activity.test.tsx` — completed Issue 当前动作现状与 Issue Detail 交互基线。
- `src-tauri/src/db/completion_attempt_repository.rs`、`src-tauri/src/core/issue_service.rs` — summary 复用的 CompletionAttempt / Issue 权威数据源。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-09T16:22:33+08:00：`bmad-dev-workflow` preflight 读取完整 `sprint-status.yaml`，确认没有 `ready-for-dev` story，按顺序锁定首个 backlog story `5-8-view-completed-issue-summary`。
- 2026-06-09T16:22:33+08:00：交叉核对 Epic 5.8 / 5.9、Architecture 的 FR23 / FR24 映射，以及 UX 文档中的 Summary / Log View，确认 5.8 只交付 completed summary，不提前吸收 Open Log 主能力。
- 2026-06-09T16:22:33+08:00：复查现有前端代码与测试，确认 `Open Log` 已在 abnormal session 路径存在，而 `View Summary` 尚未落地为 completed 可见入口；同时 CompletionAttempt / linked session / log path 的底层事实已具备复用条件。
- 2026-06-09T16:48:28+08:00：新增 `get_issue_summary` Rust command / DTO / service 聚合，优先读取最新 `CompletionAttempt`，对 `complete_manual` 等缺少 attempt 的旧路径回退到 `IssueCompleted` action 并输出诊断信息。
- 2026-06-09T16:48:28+08:00：新增 `IssueSummaryDialog`，并在 `IssuesActivity`、`AgentsActivity`、`IssueInspector` 三处 completed 入口接入 `View Summary`；保持 `Open Log` 与运行态动作边界不变。
- 2026-06-09T16:48:28+08:00：补齐 command client、前端交互与 Rust 集成测试，覆盖 completed summary 的 commit hash、无 commit fallback、日志路径与诊断显示。
- 2026-06-09T17:11:16+08:00：根据 review follow-up 修正 summary completion 选择规则，优先绑定最终 completed 事实；当不存在完成态 attempt 时回退到 `IssueCompleted` action，并为“失败 attempt 后再完成”补集成测试。
- 2026-06-09T17:11:16+08:00：放宽 Agents Header 的 `View Summary` 入口到所有 completed issue，并为 stopped / closed_at 缺失等 completed-session 不一致场景补 diagnostics 与前端回归测试。

### Completion Notes List

- 2026-06-09：create-story 已把 Story 5.8 收口为 completed Issue 的只读 summary 功能，避免与 5.9 的日志打开动作混范围。
- 2026-06-09：已显式标注应复用 `completion_attempts`、Issue linked session 和 `log_path` 现有事实，避免为 summary 再造平行审计模型。
- 2026-06-09：已把 completed 入口边界、summary 必含字段、无 commit / 数据缺口诊断和测试要求写入 story，供后续 dev-story 直接实现。
- 2026-06-09：已实现 completed summary 查询合同与前端对话框；completed issue 现在可从 Issue Detail、Agents Header 和 Inspector 打开 Summary。
- 2026-06-09：对没有 `CompletionAttempt` 的 manual completion 路径新增 fallback summary 逻辑，并显式输出“回退到 Issue 完成事件推断”的诊断，避免空白复盘。
- 2026-06-09：本 story 未改动 `Open Log` 打开文件行为，也未新增 completed issue 的 reopen / run / complete 路径。
- 2026-06-09：已修复 review 指出的两类边界：summary 现在不会被历史失败 attempt 污染；completed + stopped/crashed 等异常 session 也能从 Header 进入 Summary 查看 diagnostics。

### File List

- _bmad-output/implementation-artifacts/5-8-view-completed-issue-summary.md
- src-tauri/src/commands/issue_commands.rs
- src-tauri/src/core/issue_service.rs
- src-tauri/src/lib.rs
- src-tauri/src/types/issue.rs
- src-tauri/tests/issue.rs
- src/features/agents/agents-activity.test.tsx
- src/features/agents/agents-activity.tsx
- src/features/agents/issue-inspector.tsx
- src/features/issues/issue-commands.ts
- src/features/issues/issue-summary-dialog.tsx
- src/features/issues/issues-activity.test.tsx
- src/features/issues/issues-activity.tsx
- src/shared/commands/command-client.test.ts
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml

### Validation Commands

- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/issues/issues-activity.test.tsx src/features/agents/agents-activity.test.tsx src/shared/commands/command-client.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue get_issue_summary`
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`
- `git diff --check`

### Validation Results

- `pnpm format`：通过；发现无关文件 `src/features/agents/codex-terminal-snapshot.ts` 仅有格式化差异，后续提交已排除该文件。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test -- --run src/features/issues/issues-activity.test.tsx src/features/agents/agents-activity.test.tsx src/shared/commands/command-client.test.ts`：通过，8 files / 140 tests；存在既有 jsdom `HTMLCanvasElement.getContext()` 与 CSS stylesheet parsing 警告，不影响结果。
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue get_issue_summary`：通过，3/3。
- `cargo test --manifest-path src-tauri/Cargo.toml --test issue`：通过，31/31。
- `git diff --check`：通过。

### Change Log

- 2026-06-09：新增 completed issue summary 的 Rust command / DTO / service 聚合，并为 manual completion 增加基于 `IssueCompleted` action 的 fallback summary。
- 2026-06-09：新增 `IssueSummaryDialog`，并在 Issue Detail、Agents Header、Issue Inspector 接入 `View Summary`。
- 2026-06-09：补齐前端与 Rust 测试，锁定 completed summary 的入口、内容和诊断边界。
- 2026-06-09：修正 completed summary 的最终事实选择规则，并补 completed-session 状态不一致 diagnostics 与 Header 入口覆盖。

## Senior Developer Review (AI)

### Review Date

2026-06-09

### Outcome

Approved

### Findings Summary

- Follow-up review clean：已修复“历史失败 attempt 污染最终 completed Summary”与“completed 异常 session 无法从 Header 打开 Summary”两条问题，补充了对应的前后端回归测试。

### Reviewer Notes

- Blind Hunter：summary 现在优先绑定最终 completed 事实，没有完成态 attempt 时会显式回退到 `IssueCompleted` action 并留下 diagnostics，不再把最近一次失败 attempt 冒充最终结果。
- Edge Case Hunter：completed + `stopped` / 缺少 `closed_at` 等异常 session 现在仍可从 Header 查看 Summary，诊断信息可见。
- Acceptance Auditor：AC1、AC2、AC3 均已有对应入口/事实/诊断测试覆盖，review clean。
