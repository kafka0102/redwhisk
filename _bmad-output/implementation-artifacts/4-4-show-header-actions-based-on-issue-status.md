---
baseline_commit: c502483
---

# Story 4.4: 根据 Issue 状态展示 Header 操作

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望 Session Header 只显示当前 Issue 状态允许的操作,
以便我不会误触不该出现的 Run、Review 或 Completion 操作。

## Acceptance Criteria

1. 给定当前 AgentSession 关联 `running` Issue，当 Header 渲染时，主按钮为 `Mark Review`。
2. 给定当前 AgentSession 关联 `review` Issue，当 Header 渲染时，Header 显示 Issue title 和打开 Issue Inspector 的入口，并且不显示 `Mark Review`，也不显示任何未实现的完成类按钮、占位入口或不可用完成控件。
3. 给定当前 AgentSession 不关联 Issue，当 Header 渲染时，不显示 Issue title，并且不显示 `No linked issue` 或任何 Issue 操作。

## Tasks / Subtasks

- [x] 收口 Session Header 的状态分支，只暴露当前故事已实现且允许出现的 Issue 操作 (AC: 1, 2, 3)
  - [x] 复查 [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 当前 Header、linked issue 区域与 `Mark Review` / Inspector 入口逻辑，确认 `running`、`review`、standalone session 三条渲染路径的现状。
  - [x] 明确最小取舍：本故事只交付 Header 可见性与按钮 gating，不提前实现 Epic 5 的 `Complete Manually`、`Complete with Agent Commit`、`Complete`、`View Summary` 或 `Open Log`。
  - [x] 在 `review` Issue 路径下保留 Issue title 与 Inspector 打开入口，但隐藏 `Mark Review` 与任何“尚未实现”的完成类占位。
- [x] 保持无关联 Session 与 terminal 生命周期边界不被 Header 调整破坏 (AC: 2, 3)
  - [x] 复查 Story 3.6 与 Story 4.3 的现有实现，确保 standalone session 仍然不显示 Issue 区域，也不会出现 `No linked issue`。
  - [x] 确保 Header 条件渲染不会切换 `selectedSessionId`、不会卸载 `CodexTerminal`、不会影响 Issue Inspector 的开关行为。
  - [x] 若当前实现仍残留旧 linked issue info pane 或 header 空态文案，按最小修改移除或收口到不渲染。
- [x] 用前端回归测试锁定 Header 操作的状态矩阵 (AC: 1, 2, 3)
  - [x] 测试覆盖：linked `running` Issue 的 Header 显示 Issue title 与 `Mark Review`。
  - [x] 测试覆盖：linked `review` Issue 的 Header 保留 Issue title / Inspector 入口，但不显示 `Mark Review`，也不出现任何完成类占位文案。
  - [x] 测试覆盖：standalone session 不显示 Issue 区域、不显示 `No linked issue`，并保持 terminal 容器持续挂载。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [x] 本 story 预计主要修改 TypeScript / TSX 渲染逻辑与测试，默认至少执行：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test -- --run src/features/agents/agents-activity.test.tsx
pnpm test
git diff --check
```

## Dev Notes

### 关键假设与取舍

- Story 4.4 的最小目标是把 Session Header 的可见操作与当前已实现的状态边界对齐，而不是提前落地 Epic 5 的完成流。
- 当前产品文档对 `review` Issue 的最终目标是显示完成类按钮，但这些能力属于 Epic 5；因此本故事默认取舍是“不显示未实现按钮”，而不是做 disabled 占位或假入口。
- `running` / `review` 是 Issue 状态，`running` / `closed` / `crashed` 是 AgentSession 状态；Header gating 必须依赖现有核心投影字段，不能在 React 里发明新的业务状态机。

### 当前代码状态与修改指引

- [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 已在 Story 4.1 中接入 `Mark Review`，并在 Story 4.3 中接入 Header Issue title 打开 Inspector；4.4 主要是在这些既有入口之上收口状态分支，而不是新增后端命令。
- Story 4.3 已把“无关联 Session 时不显示 `No linked issue`”收敛到 Header / Inspector 路径；4.4 需要确认当前实现没有因为后续改动重新引入空态文案或额外占位按钮。
- 当前最可能的改动面在 `features/agents` 前端渲染和测试；除非发现现有 session list 投影缺少必要字段，否则默认不改 Rust Core。

### 架构约束

- Header / Inspector 操作不能卸载 xterm，也不能打断当前 PTY 会话。[Source: `_bmad-output/planning-artifacts/architecture.md` §UI 不卸载终端]
- React store 只保存 view state；Issue 状态与 AgentSession 状态的事实来源仍是 Rust Core 返回的投影数据。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns]
- 若仅调整 Header gating，不应新增命令、事件或持久化结构；本故事优先保持“前端显示层改动”范围最小。[Source: `_bmad-output/planning-artifacts/architecture.md` §Feature Mapping]

### UX 与文案约束

- Session Header 只在当前 Session 关联 Issue 时显示 Issue 标题和操作；无关联 Issue 时不显示 Issue 区域，也不显示 `No linked issue`。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Core Screens]
- `running` Issue 的 Header 主按钮是 `Mark Review`；`review` Issue 最终会根据 Completion Policy 展示完成类按钮，但在该能力未实现前，不应渲染误导性的占位控件。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-25, `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §Session Header / Issue 操作状态表]
- 点击 Header Issue title 打开 Inspector 的交互已由 Story 4.3 建立；本故事不改变该入口，只约束不同状态下哪些操作可见。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Issue Inspector]

### 前置故事信息

- Story 4.1 已完成 linked `running` Issue 的 `Mark Review`，并补齐了 linked issue status 投影。
- Story 4.2 已锁定 review 阶段继续修正时 terminal 与 session 连续性不变，因此 4.4 不能因为 Header 条件渲染让 review session 看起来像“不可继续使用”。
- Story 4.3 已完成 Header Issue title 打开 Inspector；4.4 必须复用这条路径，而不是再加第二个“查看 Issue”入口。
- Story 3.6 已明确 standalone session 不触发 Issue 流，因此无关联 session 的 Header 仍应完全隐藏 Issue 区域。

### 非目标

- 不实现 `Complete Manually`、`Complete with Agent Commit`、`Complete`、`View Summary`、`Open Log`。
- 不实现 Completion Confirmation、Git 摘要、commit 检测或 Issue 完成状态流转。
- 不新增 Inspector 编辑能力、Issue Summary 页面或 crashed/stopped 诊断入口。
- 不重构 Agents Activity 布局或重写 session header 组件结构，除非当前结构阻止最小实现。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 4 / Story 4.4 的需求、验收标准和与 Epic 5 的边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-17、FR-23、FR-25 的可测试结果。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — Header 状态矩阵与完成类按钮的后续落地边界。
- `_bmad-output/planning-artifacts/architecture.md` — Header / Inspector 不卸载终端、React/Rust 状态边界。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Session Header、Issue Inspector 与 trust rules。
- `_bmad-output/implementation-artifacts/3-6-ensure-temporary-session-does-not-trigger-issue-flow.md` — standalone session 与 Issue 流程隔离边界。
- `_bmad-output/implementation-artifacts/4-1-manually-mark-review-in-session-header.md` — `Mark Review` 的前置实现和测试边界。
- `_bmad-output/implementation-artifacts/4-2-continue-fixes-during-review-without-returning-to-running.md` — review 阶段继续修正与 terminal 连续性约束。
- `_bmad-output/implementation-artifacts/4-3-view-and-edit-linked-issue-in-issue-inspector.md` — Header Issue title / Inspector 入口的既有实现边界。
- `src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx` — Header 状态矩阵与前端回归测试入口。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-08T18:20:xx+08:00：`bmad-dev-workflow` preflight 读取 `sprint-status.yaml`，当前没有 `ready-for-dev` story，按顺序锁定 `4-4-show-header-actions-based-on-issue-status`，基线 `HEAD` 为 `c502483`。
- 2026-06-08T18:20:xx+08:00：交叉核对 Epic 4.4、PRD FR-25 / FR-23、UX Session Header 规则、addendum 的 Header 状态矩阵，以及 Story 4.1 / 4.2 / 4.3 / 3.6 的前置边界。
- 2026-06-08T18:20:xx+08:00：复查现有实现后确认 4.4 的主要工作面应在 `features/agents` 前端显示层与测试；默认不扩展 Rust Core，不提前接入 Epic 5 的完成逻辑。
- 2026-06-08T18:31:xx+08:00：进入 dev-story 后复查 `agents-activity.tsx` 与既有回归测试，确认运行时 gating 已由 Story 4.1 / 4.3 提前满足；本次采取最小方案，只补 Header 状态矩阵测试，不新增完成类 UI，也不改 Rust Core。
- 2026-06-08T19:54:xx+08:00：按项目规则执行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test -- --run src/features/agents/agents-activity.test.tsx`、`pnpm test` 与 `git diff --check`；其中 `format` 引入的无关 `codex-terminal-snapshot.ts` 折行差异已回退，不纳入本 story。
- 2026-06-08T19:55:xx+08:00：同会话自动 review 复核本次最小 diff，结论 clean；未发现需要补代码修复的问题，story 可直接收口为 `done`。

### Completion Notes List

- 2026-06-08：create-story 已为 Story 4.4 生成开发上下文，并将范围收口为“根据 linked Issue 状态收口 Session Header 操作可见性”。
- 2026-06-08：已显式记录 Story 4.4 与 Epic 5 完成流之间的边界，默认选择隐藏未实现完成类按钮，而不是渲染占位控件。
- 2026-06-08：已把 Story 4.1、4.2、4.3 和 3.6 的既有实现与非目标约束写入上下文，供 dev-story 直接消费。
- 2026-06-08：实现阶段确认当前 `AgentsActivity` 已满足 4.4 的最小运行时目标；本 story 的直接交付是补齐 review Header 不显示未实现完成按钮的显式测试护栏，并复核 standalone / running / review 三条状态路径。
- 2026-06-08：最终交付只包含前端回归测试与 story 工件更新；运行时代码无需改动，因为现有 Header gating 已满足 AC，本次通过显式测试防止后续回归把未实现完成按钮带入 review Header。

### File List

- _bmad-output/implementation-artifacts/4-4-show-header-actions-based-on-issue-status.md
- src/features/agents/agents-activity.test.tsx

### Validation Commands

- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`
- `pnpm test`
- `git diff --check`

### Validation Results

- `pnpm format`：通过；仅对本 story 文件与测试文件保持格式一致。期间对无关文件 `src/features/agents/codex-terminal-snapshot.ts` 产生纯折行差异，已回退，不纳入本 story。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`：通过，8 个测试文件、118 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `pnpm test`：通过，8 个测试文件、118 个测试通过；输出包含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `git diff --check`：通过。

### Change Log

- 2026-06-08：创建 Story 4.4 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-08：进入开发阶段后确认运行时实现已满足 AC，补齐 review Header 不显示未实现完成按钮的显式测试护栏，状态推进到 `review`。
- 2026-06-08：完成自动 code review，未发现阻塞问题，状态推进到 `done`。

## Senior Developer Review (AI)

### Review Date

2026-06-08

### Outcome

Approved

### Findings Summary

- Clean review：本次 diff 只增加了 Header 状态矩阵的显式测试护栏，并同步更新 story / sprint 工件；未发现逻辑回归、越界实现或缺失验证。

### Reviewer Notes

- Blind Hunter：未发现新增分支会错误暴露 `Mark Review` 或未实现完成按钮。
- Edge Case Hunter：当前 review / standalone / running 三条路径均有显式测试覆盖，terminal 挂载连续性仍被保留。
- Acceptance Auditor：AC1 / AC2 / AC3 均被现有实现满足，本次新增测试把 review Header 的“只保留标题入口、不显示未实现动作”收口为可回归约束。
