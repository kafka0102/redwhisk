---
story_key: 5-9-open-completed-issue-log
baseline_commit: c88e091
---

# Story 5.9: 打开 Completed Issue 日志

Status: done

## Story

作为本地开发者,
我希望从 completed Issue 打开原始日志,
以便我可以查看 Agent Session 的完整输出。

## Acceptance Criteria

1. 给定 completed Issue 关联 AgentSession 且存在 `log_path`，当用户点击 `Open Log` 时，系统打开或定位原始日志文件，并且不在 SQLite 中读取逐字符终端输出。
2. 给定日志路径缺失或文件不存在，当用户点击 `Open Log` 时，UI 显示明确错误，并保留日志路径或缺失原因供 Diagnostics 查看。
3. 给定 Issue 已 completed，当用户查看可用操作时，不显示 `Run`、`Mark Review`、`Complete Manually`、`Complete with Agent Commit`，并且 MVP 不提供 `Reopen`。

## Tasks / Subtasks

- [x] 收口 completed Issue 的日志打开入口，复用现有 opener 能力而不是新建日志查看器 (AC: 1, 3)
  - [x] 复查 [src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx)、[src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 与 [src/features/agents/issue-inspector.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/issue-inspector.tsx) 中现有 `Open Log` / `View Summary` 边界，确定 completed Issue 应在 Issue Detail、Agents Header、Inspector 三处已存在 surface 暴露 `Open Log`。
  - [x] 保持 `@tauri-apps/plugin-opener` 的现有 `openPath(...)` 调用链路，不新增嵌入式日志 viewer、路由页或 SQLite 日志回放。
  - [x] 对 completed Issue 只补日志复盘入口，不引入 `Run`、`Mark Review`、`Complete*`、`Reopen` 或其它会改变完成态语义的动作。
- [x] 复用既有权威数据源，把 completed 日志事实透传到所需 UI 边界 (AC: 1, 2)
  - [x] 优先复用 `IssueRecord.linkedSessionLogPath`、selected session `logPath`、`get_issue_summary` 和现有 linked session 事实，不额外创建并行日志索引或审计表。
  - [x] 本次无需新增 DTO / command；现有 completed 入口已能拿到 `logPath`，实现只在前端收口 completed gating。
  - [x] 明确区分“没有日志路径”和“有路径但打开失败”两种情况，并让 UI 按事实展示，而不是统一吞成无动作空白态。
- [x] 处理 completed 日志失败路径与诊断保留，避免伪成功 (AC: 2)
  - [x] 复用现有 `toCommandError` / `openPath` 失败展示模式，点击 `Open Log` 失败时给出明确错误，而不是静默失败。
  - [x] 在 completed Issue 的 Summary、Inspector 或 Detail 中保留原始 `logPath` 或缺失诊断，确保用户知道日志去哪了、缺口是什么。
  - [x] 保持“日志原文在文件系统、SQLite 只保存 `log_path` 与摘要/事件”的边界，不为了 completed 复盘去读取逐字符终端输出。
- [x] 锁定 completed 动作边界，避免回归到运行态或异常态语义 (AC: 3)
  - [x] 复查 completed Issue 在 Issues Detail、Agents Header、Inspector 三处动作集合，确认新增 `Open Log` 后仍不显示 `Run`、`Mark Review`、`Complete Manually`、`Complete with Agent Commit`。
  - [x] 对 completed + `closed/crashed/stopped` 统一保持事实性表达，不把异常 Session 伪装成正常完成。
  - [x] 不重写 Story 5.8 已交付的 Summary 能力；5.9 只补“打开原始日志”这条链路。
- [x] 用测试锁定 completed 日志入口、失败提示和动作 gating (AC: 1, 2, 3)
  - [x] 前端测试覆盖：completed Issue 在 Issue Detail、Agents Header 或 Inspector 的目标入口显示 `Open Log`，成功时调用 `openPath`。
  - [x] 前端测试覆盖：日志缺失或 `openPath` 失败时显示明确错误，并保留 `log path` 或 diagnostics 文本。
  - [x] 前端测试覆盖：completed Issue 仍不显示 `Run`、`Mark Review`、`Complete Manually`、`Complete with Agent Commit`、`Reopen`。
  - [x] 本次未改 Rust 契约；现有 `log_path` 与 completed 状态事实已满足需求，无需新增 Rust 测试基建。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [x] 已执行 `pnpm prettier --write src/features/issues/issues-activity.tsx src/features/agents/issue-inspector.tsx src/features/agents/agents-activity.tsx src/features/issues/issues-activity.test.tsx src/features/agents/agents-activity.test.tsx`、`pnpm lint`、`pnpm typecheck`、`pnpm test -- --run src/features/issues/issues-activity.test.tsx src/features/agents/agents-activity.test.tsx`。
  - [x] 本次未修改 Rust command / service / repository / DTO，因此未运行 `cargo fmt` / `cargo test`。
  - [x] 已执行 `git diff --check`，并在 Dev Agent Record 中逐条记录实际命令与结果。

## Dev Notes

### 关键假设与取舍

- Story 5.8 已把 completed Issue 的 Summary 交付出来，并且 Summary 中已经展示 `log path`；5.9 的最小目标是把“打开原始日志文件”补齐，而不是再设计新的 completed 复盘 UI。
- Story 4.7 已为 `crashed` / `stopped` Session 打通 `Open Log` 的基础链路；5.9 默认优先复用这套 opener 和错误处理模式，把 completed 场景接上同一事实来源。
- 当前仓库已经明确规定原始终端输出只写日志文件、SQLite 只保存 `log_path`、SessionEvent 和摘要；5.9 不允许为了 completed 日志查看破坏这条数据边界。

### 范围边界

- 交付：completed Issue 的 `Open Log` 入口、失败提示、诊断保留、动作边界与测试。
- 不交付：新的日志查看器、终端回放、SQLite 终端输出存储、completed Issue 的 reopen / rerun / complete 路径。
- 不交付：重构 Story 5.8 的 Summary 结构；若需要 diagnostics，可在现有 Summary / Inspector / Detail 边界上最小补充。

### 当前代码状态与修改指引

- [src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx) 已引入 `openPath`，并包含 `selectedIssue.linkedSessionLogPath` 的打开逻辑与错误处理；需要重点确认 completed Issue 当前是否只在部分条件下显示 `Open Log`，以及动作边界是否与 5.9 的 AC 完全一致。
- [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 已为 `crashed` / `stopped` Session 提供 Header `Open Log`，同时 completed linked issue 已有 `View Summary` 入口；5.9 需要判断 closed completed session 是否也应显式提供 `Open Log`，并保持 completed group 的动作不回退到运行态。
- [src/features/agents/issue-inspector.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/issue-inspector.tsx) 当前 `Open Log` gating 偏向异常 Session，而 completed Issue 已有 `View Summary`；如果 completed Inspector 也需要 `Open Log`，应在现有动作区最小扩展，而不是新建额外面板。
- [src/features/issues/issue-summary-dialog.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-summary-dialog.tsx) 已展示 `Log path` 与 diagnostics，可作为 5.9 的事实补充面；但该 story 的主目标仍是“打开日志文件”，不是只读显示路径。
- [src/features/issues/issue-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-commands.ts) 里的 `IssueRecord` 已具备 `linkedSessionLogPath`，优先复用该字段，不要把日志路径再塞进额外 completed 专用模型。

### 架构约束

- 不绕过 Rust Core 写 SQLite 或改业务状态；前端只消费 command 返回的 completed / session / log 事实。[Source: `_bmad-output/planning-artifacts/architecture.md` §Service Boundaries, §Data Boundaries]
- Session 原始输出写入 log files；SQLite 只保存 `log_path`、SessionEvent 和摘要，不允许把原始终端输出逐字符回灌数据库。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Boundaries; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-24]
- completed Issue 不在主路径上新增 `Run` / `Reopen` / 完成类动作。[Source: `_bmad-output/planning-artifacts/architecture.md` §All AI Agents MUST; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-23]
- 新增跨边界 DTO 或 command 时，必须同步 Rust 类型导出、前端类型引用、统一错误 code 与至少一个失败路径测试。[Source: `_bmad-output/planning-artifacts/architecture.md` §Pattern Enforcement]

### UX 与产品约束

- completed Issue 的主复盘路径是 `View Summary` 与 `Open Log`，不显示 `Run`、`Mark Review` 或完成类按钮。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-23, §FR-24; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` 状态矩阵]
- 日志缺失也必须给出明确错误，并保留路径或缺失原因供 Diagnostics 查看，不能让按钮无效却无解释。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Summary / Log View, §用户需要复盘]
- 若 completed Issue 的 Session 事实异常，例如 `crashed` / `stopped` / 状态不一致，系统要暴露事实而不是伪装成成功；5.9 只在该前提下提供日志复盘入口。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §用户怕异常被伪装成成功]

### 前置故事信息

- Story 2.7 已建立 Session 原始日志与 `log_path` 的权威事实来源，后续故事必须复用该边界。
- Story 4.7 已为 `crashed` / `stopped` Session 打通 `Open Log` 和失败提示路径，是 5.9 的直接实现参考。
- Story 5.8 已交付 completed Summary，并且 Summary 中已呈现 `log path` 与 diagnostics；5.9 不应重复实现 summary，只需补齐打开日志文件的最终动作。

### Git 与最近模式

- 当前 workflow 基线 `HEAD` 为 `c88e091`，最近相关提交已经依次完成 completed Summary、Git operation block、no-commit 保持等收口；5.9 应延续这些提交的最小增量风格，而不是再做跨 story 重构。
- 当前工作区存在无关脏改动 `src/features/agents/codex-terminal-snapshot.ts`；后续开发和提交必须显式排除该文件。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 5 / Story 5.9 的用户故事、验收标准和与 5.8 的边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-23、FR-24、completed Issue 复盘与 Open Log 要求。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — completed / crashed / stopped 状态矩阵与 `Open Log` 边界。
- `_bmad-output/planning-artifacts/architecture.md` — Service/Data Boundaries、Pattern Enforcement、completed 不 reopen 约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Summary / Log View、日志缺失错误、异常不伪装成成功。
- `_bmad-output/implementation-artifacts/4-7-provide-log-review-entry-for-abnormal-sessions.md` — 已有异常 Session 日志入口实现与测试模式。
- `_bmad-output/implementation-artifacts/5-8-view-completed-issue-summary.md` — 已有 completed Summary 能力与 `log path`/diagnostics 边界。
- `src/features/issues/issues-activity.tsx`
- `src/features/agents/agents-activity.tsx`
- `src/features/agents/issue-inspector.tsx`
- `src/features/issues/issue-summary-dialog.tsx`
- `src/features/issues/issue-commands.ts`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-09T17:28:58+08:00：`bmad-dev-workflow` preflight 读取完整 `sprint-status.yaml`，确认当前没有 `ready-for-dev` story，按顺序锁定首个 backlog story `5-9-open-completed-issue-log`，当前基线 `HEAD` 为 `c88e091`。
- 2026-06-09T17:28:58+08:00：交叉核对 Epic 5.9、FR23/FR24、UX Summary / Log View、Architecture 的 service/data boundary，确认本 story 只补 completed `Open Log`，不混入 reopen / rerun / 新日志 viewer。
- 2026-06-09T17:28:58+08:00：复查 4.7 与 5.8 的实现工件、当前前端组件和测试锚点，确认 `logPath`、`openPath`、`View Summary` 已具备复用基础，当前重点是收口 completed 日志入口与动作 gating。
- 2026-06-09T18:08:09+08:00：实现 `IssuesActivity`、`AgentsActivity` 与 `IssueInspector` 的 completed `Open Log` 入口，复用现有 `openPath` 链路，并在缺失 `logPath` 时返回事实性错误。
- 2026-06-09T18:08:09+08:00：补充 completed `Open Log` 的前端回归测试，覆盖 Issue Detail、Agents Header、Inspector 成功路径，以及缺失 `logPath` 的错误提示。
- 2026-06-09T18:08:09+08:00：执行 `pnpm prettier --write ...`、`pnpm lint`、`pnpm typecheck`、`pnpm test -- --run src/features/issues/issues-activity.test.tsx src/features/agents/agents-activity.test.tsx` 与 `git diff --check`，均通过。

### Completion Notes List

- 2026-06-09：create-story 已为 Story 5.9 生成开发上下文，并将范围收口为“completed Issue 的原始日志打开入口”。
- 2026-06-09：已明确 5.9 复用 4.7 的 opener/错误链路与 5.8 的 summary/log path 事实，不重新设计日志系统或复盘 UI。
- 2026-06-09：已把 completed 动作边界、日志失败路径、Rust Core 数据边界和建议验证命令写入 story，供 dev-story 直接执行。
- 2026-06-09：completed Issue 现在可从 Issue Detail、Agents Header、Inspector 直接执行 `Open Log`，且仍不暴露运行态或完成态之外的额外动作。
- 2026-06-09：当 completed Session 缺少 `logPath` 时，UI 现在给出明确错误 `No log path recorded for this session.`，而不是静默无响应。
- 2026-06-09：本次实现未改动 Rust 边界，完全复用现有 `logPath` / `openPath` 事实链路完成收口。

### File List

- _bmad-output/implementation-artifacts/5-9-open-completed-issue-log.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- src/features/issues/issues-activity.tsx
- src/features/issues/issues-activity.test.tsx
- src/features/agents/agents-activity.tsx
- src/features/agents/agents-activity.test.tsx
- src/features/agents/issue-inspector.tsx

### Validation Commands

- `pnpm prettier --write src/features/issues/issues-activity.tsx src/features/agents/issue-inspector.tsx src/features/agents/agents-activity.tsx src/features/issues/issues-activity.test.tsx src/features/agents/agents-activity.test.tsx`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/issues/issues-activity.test.tsx src/features/agents/agents-activity.test.tsx`
- `git diff --check`

### Validation Results

- `pnpm prettier --write src/features/issues/issues-activity.tsx src/features/agents/issue-inspector.tsx src/features/agents/agents-activity.tsx src/features/issues/issues-activity.test.tsx src/features/agents/agents-activity.test.tsx`：通过；5 个目标文件均保持或整理为一致格式，未触发额外无关改动。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test -- --run src/features/issues/issues-activity.test.tsx src/features/agents/agents-activity.test.tsx`：通过，8 个测试文件 / 144 个测试通过；输出包含既有 jsdom `HTMLCanvasElement.getContext()` 与 CSS stylesheet parsing 警告，不影响结果。
- `git diff --check`：通过。

### Change Log

- 2026-06-09：为 completed Issue 在 Issue Detail、Agents Header、Inspector 三处补齐 `Open Log` 入口。
- 2026-06-09：completed `Open Log` 现在在缺少 `logPath` 时显示事实性错误，而不是静默失败。
- 2026-06-09：新增前端回归测试，覆盖 completed 日志入口成功路径与缺失 `logPath` 错误路径。

## Senior Developer Review (AI)

### Review Date

2026-06-09

### Outcome

Approved

### Findings Summary

- Clean review：本次 diff 只把既有 `openPath` 链路扩展到 completed 场景，并补足缺失 `logPath` 的事实性错误与回归测试；未发现阻塞问题。

### Reviewer Notes

- Blind Hunter：completed Issue 新增 `Open Log` 后仍未暴露 `Run`、`Mark Review`、`Complete*` 或 `Reopen`，动作边界符合 FR23/FR24。
- Edge Case Hunter：没有 `logPath` 的 completed Session 现在会明确报错，不再出现按钮存在但无反馈的静默失败。
- Acceptance Auditor：AC1、AC2、AC3 均已有对应实现与测试覆盖，review clean。
