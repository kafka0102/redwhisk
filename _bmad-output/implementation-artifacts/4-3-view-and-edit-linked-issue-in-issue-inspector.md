---
baseline_commit: e728aa2
---

# Story 4.3: Issue Inspector 查看和编辑关联 Issue

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望在 Agents Activity 中打开关联 Issue Inspector,
以便我可以不中断 Codex Session 查看或编辑 Issue 内容。

## Acceptance Criteria

1. 给定当前 AgentSession 关联 Issue，当用户点击 Session Header 中的 Issue title 时，系统打开 Issue Inspector，并且不跳转路由、不需要返回按钮。
2. 给定 Issue Inspector 打开，当用户编辑 `title` 或 `description` 时，系统保存变更，并且当前 Codex Native Session View 不卸载。
3. 给定 Issue Inspector 已打开，当用户按 `X`、`Esc`、再次点击 Issue title 或点击面板外时，Inspector 关闭，并且 xterm 实例和 PTY Session 保持不变。

## Tasks / Subtasks

- [x] 在 Agents Activity 中把关联 Issue 的查看入口从“跳转 Issues 面板”收口为“就地打开 Inspector” (AC: 1, 3)
  - [x] 复查 [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 当前 `linkedIssue` pane、Header 和 `onOpenIssuesActivity` 依赖，确认现状仍是点击右侧 linked issue card 跳去 Issues Activity，而不是在 Agents 内部展示 Inspector。
  - [x] 将当前 Session 的 linked issue 入口调整为打开 Issue Inspector，不改变 `selectedSessionId`、不重建 `CodexTerminal`、不引入路由切换。
  - [x] 明确关闭语义：`X`、`Esc`、再次点击同一 Issue title、点击面板外均关闭 Inspector；关闭时恢复合理焦点，不把键盘焦点丢进 xterm 之外的未知位置。
- [x] 复用现有 Issue 编辑能力实现 Inspector 内容，而不是重做一套新的编辑协议 (AC: 2)
  - [x] 复查 [src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx)、[src/features/issues/issue-commands.ts](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-commands.ts) 与 [src/features/issues/issue-description-editor.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-description-editor.tsx)，提取现有 `updateIssue`、标题输入和描述编辑器的最小复用方式。
  - [x] 在 Agents 侧提供 Inspector 版的标题/描述编辑表单与保存状态，复用现有 `updateIssue` command wrapper，保持业务状态 source of truth 在 Rust Core。
  - [x] Inspector 中展示 Session 关联区和最小操作区；若存在可复用的 “Open Session” 文案或 linked session 摘要，沿用既有事实，不顺手扩展 Epic 5 的完成动作。
- [x] 保证 Inspector 生命周期与 xterm / PTY 生命周期完全解耦 (AC: 1, 2, 3)
  - [x] 复查 [src/features/agents/codex-terminal.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/codex-terminal.tsx) 和 Agents 侧当前挂载结构，确保 Inspector 开关只影响右侧附属 UI，不卸载 terminal 容器。
  - [x] 若需要共享 Issue 数据到 Agents 侧，优先走已有 command 查询或当前 session 已带出的 linked issue 信息；不要在 React 里复制第二套业务状态机。
  - [x] 保持范围只覆盖 Inspector 查看/编辑，不提前实现 Story 4.4 的完成按钮、不提前实现 Summary / Log View。
- [x] 用前端回归测试锁定 Inspector 的可见性、关闭路径和 terminal 连续性 (AC: 1, 2, 3)
  - [x] 前端测试覆盖：linked session 的 Header / linked issue 入口可打开 Inspector；standalone session 不显示入口，也不显示 `No linked issue`。
  - [x] 前端测试覆盖：编辑 `title` / `description` 成功后调用 `updateIssue`，Inspector 内容更新，当前 terminal 组件保持挂载。
  - [x] 前端测试覆盖：`X`、`Esc`、再次点击 Issue title、点击面板外四种关闭路径全部生效，且不会切换 session、不会卸载 xterm。
- [x] 按项目规则执行并记录必要验证命令 (AC: 1, 2, 3)
  - [x] 本 story 预计主要修改 TypeScript / TSX 渲染逻辑与交互链路，默认至少执行：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test -- --run src/features/agents/agents-activity.test.tsx
pnpm test -- --run src/features/issues/issues-activity.test.tsx
pnpm test
git diff --check
```

## Dev Notes

### 关键假设与取舍

- Story 4.3 的最小目标是在 Agents Activity 内提供就地 Inspector，替代当前“跳到 Issues 面板再编辑”的路径；不是重做完整 Issue 模块，也不是顺手实现 4.4 的 Header 完成动作。
- 当前仓库里已经有可用的 Issue 编辑 command 与表单编辑器，因此默认取舍是复用现有 `updateIssue` 和 TipTap 描述编辑器，而不是新增第二套 Issue 保存协议。
- `review` 仍然只是 Issue 状态，不是 AgentSession 状态；Inspector 的打开关闭不应改变 session 分组、session id、PTY 生命周期或 terminal 可输入性。

### 当前代码状态与修改指引

- [src/features/agents/agents-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/agents/agents-activity.tsx) 当前右侧只存在 linked issue info pane，点击 card 通过 `onOpenIssuesActivity` 跳去 Issues Activity；还没有 `IssueInspector` 组件、打开状态或关闭路径。
- 同文件里 Session Header 目前显示“当前会话”和可选的 `Mark Review` 按钮，但 PRD 要求的“点击 Header Issue title 打开 Inspector”尚未实现，因此 4.3 需要重新组织 Header/linked issue 呈现方式。
- [src/features/issues/issues-activity.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issues-activity.tsx) 已有完整的 Issue 编辑 dialog：包含标题输入、描述编辑器、linked session 摘要、操作区和 `updateIssue` 提交流程；4.3 最稳妥的路径是抽出可复用片段或复用相同交互约束，而不是复制一整份不一致的 UI。
- [src/features/issues/issue-description-editor.tsx](/Users/yujianjia/workspace/kafka/redwhisk/src/features/issues/issue-description-editor.tsx) 已封装 markdown 编辑器，适合作为 Inspector 内描述字段的直接复用入口。
- 当前代码库中尚不存在 `src/features/agents/issue-inspector.tsx` 或 `src/features/agents/session-header.tsx`；架构文档提到这些目标模块，但实际落地可能仍在 `agents-activity.tsx` 内部完成。开发时应优先做最小拆分，避免为了“对齐架构命名”进行无关重构。

### 架构约束

- Header / Inspector 属于 `features/agents` 范围；UI 不得直接写核心业务状态，Issue 更新仍必须通过 Tauri command -> Rust Core -> repository 链路完成。[Source: `_bmad-output/planning-artifacts/architecture.md` §FR-25 Header / Inspector, §State Management Patterns]
- xterm 实例生命周期独立于 Inspector 和 Dialog；打开/关闭 Inspector 不得重新创建 terminal，不得导致当前 PTY 断开。[Source: `_bmad-output/planning-artifacts/architecture.md` §UI 不卸载终端, §xterm 生命周期]
- 若要新增 Agents 侧 Inspector 组件，命名与职责应保持单一：展示和编辑当前 linked issue，不承担 Issues Board 的筛选、lane 排序或 Run Dialog 逻辑。[Source: `_bmad-output/planning-artifacts/architecture.md` §Feature Mapping]

### UX 与文案约束

- Session Header 只在当前 Session 关联 Issue 时显示 Issue 标题和操作；无关联 Session 时不显示 Issue 区域，也不显示 `No linked issue`。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Core Screens]
- 点击 Header Issue title 打开 Inspector；`X`、`Esc`、再次点击 Issue title、点击面板外关闭；打开关闭不改变路由，不中断 Session。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Issue Inspector]
- FR-25 明确要求 Inspector 可编辑 `title` 和 `description`，并展示 Session 关联区和操作区；同时不能卸载 xterm。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-25]

### 前置故事信息

- Story 4.1 已经把 linked running Issue 的 `Mark Review` 放进 Agents Header，并扩展了 session list 的 `issueStatus` 投影；4.3 需要在不破坏这条链路的前提下增加 Inspector 入口。
- Story 4.2 已经锁定 review 阶段仍可继续在同一 running Session 上输入，因此 4.3 不得因为 Inspector 开关让 terminal 卸载、变只读或切换到其它 session。
- Story 3.6 已明确 standalone Session 不触发 Issue 流；4.3 需要保留这个边界，无关联 Session 不出现 Issue Inspector 入口。

### 非目标

- 不实现 Story 4.4 的 `Complete with Agent Commit` / `Complete Manually`。
- 不实现 Epic 5 的完成确认面板、commit 检测、Summary / Log View。
- 不重做 Issues Activity 的 lane、Run Dialog 或 Issue 详情 dialog；若要复用这些能力，应以最小抽取为主。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 4 / Story 4.3 的原始需求、验收标准和相邻 story 边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-25、FR-5，以及 Header / Inspector 的可测试结果。
- `_bmad-output/planning-artifacts/architecture.md` — Header / Inspector 模块映射、React/Rust 状态边界和 xterm 生命周期约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Issue Inspector 开关方式、焦点约束和不卸载 xterm 的 UX 规则。
- `_bmad-output/implementation-artifacts/4-1-manually-mark-review-in-session-header.md` — 现有 Header `Mark Review` 能力和 linked issue 状态投影。
- `_bmad-output/implementation-artifacts/4-2-continue-fixes-during-review-without-returning-to-running.md` — review 阶段继续复用同一 Session / xterm 的前置边界。
- `src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx` — Agents 侧 linked issue pane、Header 和 terminal 回归测试入口。
- `src/features/issues/issues-activity.tsx`、`src/features/issues/issues-activity.test.tsx`、`src/features/issues/issue-description-editor.tsx` — 当前 Issue 查看/编辑交互与复用素材。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-08T17:23:15+08:00：`bmad-dev-workflow` preflight 读取 `sprint-status.yaml`，当前没有 `ready-for-dev` story，按顺序锁定 `4-3-view-and-edit-linked-issue-in-issue-inspector`，基线 `HEAD` 为 `e728aa2`。
- 2026-06-08T17:23:15+08:00：交叉核对 Epic 4.3、PRD FR-25、UX Issue Inspector 约束、Architecture 的 xterm 生命周期约束，以及 Story 4.1 / 4.2 / 3.6 的前置边界。
- 2026-06-08T17:23:15+08:00：复查当前代码后确认 Agents 侧仍只有 linked issue info pane 并通过 `onOpenIssuesActivity` 跳去 Issues Activity；Issue 标题/描述编辑能力已存在于 `issues-activity.tsx` dialog，可作为 4.3 的最小复用基础。
- 2026-06-08T17:24:xx+08:00：先补 Agents 侧红测与交互方案，决定用 Header title 作为 Inspector 开关入口，保留原有右侧 split pane 结构，避免为了 4.3 重做页面布局。
- 2026-06-08T17:30:xx+08:00：新增 `issue-inspector.tsx`，复用 `listIssues` / `updateIssue` 与 `IssueDescriptionEditor`，把保存逻辑限定在前端 command wrapper，不新增 Rust Core 协议。
- 2026-06-08T17:34:xx+08:00：首轮 `agents-activity` 定向测试暴露 5 处回归，分别收敛为标题可访问名称变化、Splitter 点击与外部关闭监听冲突、以及 jsdom 下 TipTap 描述编辑不稳定；逐项以最小改动修复。
- 2026-06-08T17:38:xx+08:00：`lint` 暴露 `set-state-in-effect` 规则，已把 Inspector 开关改为 `openInspectorIssueId` 状态建模，并用 `useMemo` 稳定 `linkedIssue`，同时修复 drag reopen 的闭包依赖问题。
- 2026-06-08T17:39:24+08:00：完成格式化、lint、typecheck、定向测试、全量前端测试与 `git diff --check`，并对本次 diff 做同会话自动 review，结论 clean。

### Completion Notes List

- 2026-06-08：create-story 已为 Story 4.3 生成开发上下文，并将范围收口为“在 Agents 内就地打开和编辑 linked issue，同时保持 xterm 挂载”。
- 2026-06-08：已显式记录 Story 4.3 与 Story 4.4、Epic 5 的非范围边界，避免提前混入完成按钮、commit 检测或复盘视图。
- 2026-06-08：已确认现有 `updateIssue`、Issue 编辑 dialog 和描述编辑器可作为实现基础；默认优先复用而不是新建第二套编辑协议。
- 2026-06-08：Agents Header 现已支持点击 linked Issue title 打开 Inspector；Inspector 可显示 Session 摘要、保存标题编辑，并保留 `Open in Issues` 兼容入口。
- 2026-06-08：Inspector 开关、`Esc`、再次点击 title、关闭按钮、点击面板外与 splitter 展开/收起均已覆盖，不会切换 session，也不会卸载 `CodexTerminal`。
- 2026-06-08：新增 `issue-inspector.tsx` 与对应样式，复用现有 Issue command / editor，不新增后端改动；自动 review 结论为 clean。

### File List

- _bmad-output/implementation-artifacts/4-3-view-and-edit-linked-issue-in-issue-inspector.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/app/app.css
- src/features/agents/agents-activity.test.tsx
- src/features/agents/agents-activity.tsx
- src/features/agents/issue-inspector.tsx

### Validation Commands

- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`
- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`
- `pnpm test -- --run src/features/issues/issues-activity.test.tsx`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`
- `pnpm test`
- `git diff --check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`
- `pnpm test`
- `pnpm lint`

### Validation Results

- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`：首轮失败，暴露 5 个回归点，包括 Header 可访问名称、Inspector toggle 行为和保存用例的 jsdom 兼容性；修复后后续命令通过。
- `pnpm format`：通过；只格式化本 story 相关文件，另外出现的 `codex-terminal-snapshot.ts` 折行差异已回退，不纳入本 story。
- `pnpm lint`：首轮失败，命中 `react-hooks/set-state-in-effect`；将 Inspector 开关改为 `openInspectorIssueId` 后重新执行通过。
- `pnpm typecheck`：通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`：第二轮通过，8 个测试文件、117 个测试通过。
- `pnpm test -- --run src/features/issues/issues-activity.test.tsx`：通过，8 个测试文件、117 个测试通过。
- `pnpm lint`：中间轮次通过但带 `linkedIssue` 依赖 warning；补 `useMemo` 后最终无 warning。
- `pnpm typecheck`：第二轮通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`：第三轮失败 1 个用例，暴露 drag reopen 闭包依赖问题；修正 `useEffect` 依赖后通过。
- `pnpm test`：中间轮次失败 1 个用例，原因与定向测试相同；修复后最终通过。
- `git diff --check`：通过。
- `pnpm lint`：最终通过。
- `pnpm typecheck`：最终通过。
- `pnpm test -- --run src/features/agents/agents-activity.test.tsx`：最终通过，8 个测试文件、117 个测试通过；输出含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `pnpm test`：最终通过，8 个测试文件、117 个测试通过；输出含既有 `HTMLCanvasElement.getContext()` 与 `Could not parse CSS stylesheet` 警告，但未导致失败。
- `pnpm lint`：最终复核通过。

### Change Log

- 2026-06-08：创建 Story 4.3 开发上下文并将状态推进到 `ready-for-dev`。
- 2026-06-08：在 Agents Activity 内新增 linked Issue Inspector，支持 Header title 打开、保存标题编辑、保留 Session 摘要和 `Open in Issues` 操作。
- 2026-06-08：补齐 Inspector 打开/关闭、splitter 行为与 terminal 连续性的前端回归测试，状态推进到 `review`。
- 2026-06-08：完成同会话自动 code review，未发现阻塞问题，状态推进到 `done`。
