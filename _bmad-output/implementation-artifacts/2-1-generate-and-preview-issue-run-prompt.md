---
baseline_commit: c009ee5
---

# Story 2.1: 生成并预览 Issue Run Prompt

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望从 backlog Issue 生成并预览最终 prompt,
以便我可以在启动 Agent 前确认 Codex 将收到的任务上下文。

## Acceptance Criteria

1. 给定一个 `backlog` Issue 且无关联 Agent Session，当用户在 Issue Detail Dialog 点击 `Run` 时，系统打开 Run Dialog，并显示 Agent Profile 选择、working directory、default args、`Cancel` 和 `Start`。
2. 给定 Project 存在 Agent Profile 和 Project 级生效配置，当 Run Dialog 打开时，系统使用当前生效配置生成最终 prompt，并可折叠查看 prompt 来源，包括 Issue description、default skill、prompt template、app instructions。
3. 给定默认 prompt template 未显式引用 `{{issue.title}}`，当系统生成最终 prompt 时，prompt 不包含 Issue title；只有模板显式引用 `{{issue.title}}` 时才包含标题。

## Tasks / Subtasks

- [x] 为 Issue Detail 增加 Run Dialog 入口与状态流转，但不提前实现 Session 启动 (AC: 1)
  - [x] 在 `src/features/issues/` 中新增专用 Run Dialog 组件或等价清晰边界，不把第二个弹窗的状态机继续堆进 `issues-activity.tsx` 的单文件内。
  - [x] 仅允许 `backlog` Issue 打开 Run Dialog；保持既有 Issue Detail 的 `Esc`、焦点恢复和外部点击关闭行为不回退。
  - [x] 当当前 Project 下没有可运行的 Agent Profile 时，`Run` 保持禁用并给出 `配置 Agent` 入口或事实性提示；不要伪造一个空 Agent 配置继续后续流程。
- [x] 建立最小可维护的 prompt 预览拼装逻辑与来源模型 (AC: 2, 3)
  - [x] 新增 `run-prompt-builder.ts` 或等价文件，集中处理 prompt section、模板渲染、来源列表和标题是否注入的规则，不把字符串拼接散落在组件 JSX 内。
  - [x] 默认实现采用最小模板能力：只支持本 story 明确需要的占位符替换；不要引入完整模板引擎、表达式语法或提前设计插件式 prompt pipeline。
  - [x] 明确并测试 `{{issue.title}}` 为显式 opt-in；未引用标题时，默认 prompt 只能使用 Issue description、Project 基本上下文、default skill 和 app instructions。
  - [x] 为当前已落地的数据模型定义“生效配置”规则：优先使用用户在 Run Dialog 选择的单个 profile 记录本身，不恢复已被 `0007_restructure_agent_profiles.sql` 移除的 `project_agent_overrides` 表。
  - [x] 基于当前 `mode` / `dangerous` 字段生成可读的 `default args` 预览文本或列表，满足 Run Dialog 的展示要求，但不要在本 story 回退 settings schema。
- [x] 复用现有 Settings / Project 数据边界，为 Run Dialog 提供所需上下文 (AC: 1, 2)
  - [x] 通过现有 `listAgentProfiles` command 获取 `project` 与 `global` 两类 profile，并在前端合并成可选择列表；排序和默认选中规则必须稳定且可测试。
  - [x] 将 working directory 作为事实值展示为当前 Project `repo_path`；若当前 `IssuesActivity` 无法直接拿到 path，则从 `AppShell` / `ActivityRouter` 向下传递，避免额外新增 Rust command。
  - [x] Run Dialog 不展示 command 可用性、继承来源或覆盖来源解释，这些仍属于 Settings 侧。
- [x] 保持 Epic 2 后续 story 的职责边界清晰 (AC: 1, 2, 3)
  - [x] Story 2.1 只交付“打开 Run Dialog + 选择 profile + 生成 prompt 预览 + 展示来源”；不要提前创建 AgentSession、保存 prompt snapshot、修改 Issue 状态或启动 PTY。
  - [x] `Start` 按钮在本 story 中只保留 UI 位置与最小交互骨架，具体提交 prompt snapshot 和启动 Session 的动作留给 Story 2.2 / 2.3 接管；不得制造“看起来已启动但实际上没有任何状态变化”的假成功。
  - [x] 不在本 story 引入 `session_events`、`issue_actions`、`completion_attempts`、Codex resume、commit 检测或 Agents Activity 数据结构。
- [x] 测试与验证 (AC: 1, 2, 3)
  - [x] 新增前端测试覆盖：backlog Issue 在存在 profile 时可打开 Run Dialog；无 profile 时 `Run` 禁用或显示配置提示；`Cancel` 关闭后焦点正确恢复。
  - [x] 新增前端测试覆盖：project/global profile 合并后的默认选中规则、working directory 展示、prompt source 折叠区内容。
  - [x] 新增前端测试覆盖：模板未引用 `{{issue.title}}` 时最终 prompt 不含标题；模板显式引用时标题才出现。
  - [x] 若新增了独立的 prompt builder 工具，补其纯函数单测，锁定 section 顺序、空字段处理和 `default args` 预览输出。
  - [x] 运行 `pnpm format`。
  - [x] 运行 `pnpm lint`。
  - [x] 运行 `pnpm typecheck`。
  - [x] 运行 `pnpm test`。
  - [x] 运行 `pnpm build`。

## Senior Developer Review (AI)

- Outcome: Approve
- Date: 2026-06-06
- Findings: 本轮 review 未发现需要阻塞 Story 2.1 的功能、边界或回归问题。

## Dev Notes

### 关键假设与取舍

- 当前规划文档里的 FR8/FR9 仍以 `agent_profiles + project_agent_overrides + default_args + enabled` 叙述，但仓库在 `3547b5e` 已迁移到 `agent_profiles(scope, project_id, mode, dangerous, default_skill, prompt_template)`。默认选择是：Story 2.1 基于“当前真实代码”实现，而不是在预览 prompt 的同一条 story 里回滚整个 Settings 数据模型。
- 因此，本 story 中“生效配置”解释为“用户在 Run Dialog 选择的一个 profile 记录”，Project 级能力由 `scope=project` 的 profile 提供，暂不恢复 override 继承链。
- `default args` 在 schema 中已不再持久化为字符串数组。为满足 Run Dialog 展示要求，本 story应从 `mode` 与 `dangerous` 派生一个可读 preview；后续若重新引入真实 args 模型，再由专门 story 调整。
- Prompt 生成默认走最小方案：固定 section 拼装 + 少量显式占位符替换。不要为一个标题显式注入规则引入完整模板引擎。
- `Start` 在产品最终语义上会触发启动流程，但本 story 不拥有 snapshot 持久化或 Session 启动责任。实现时必须避免“点击 Start 看似成功、但系统没有任何可解释状态”的假完成；可接受的最小方式是保留明确的 UI 骨架并把真正提交动作留给后续 story 接入。

### 范围边界

- 交付 Run Dialog 打开、Profile 选择、working directory 展示、prompt 预览、prompt 来源折叠与标题注入规则。
- 不交付 AgentSession 创建、Issue `running` 状态流转、SessionEvent、IssueAction、prompt snapshot 持久化、Codex 启动、PTY、xterm、resume 或 completion。
- 不回滚 `3547b5e` 的 scoped profile 重构，不新增 Settings 新字段，不重做 Global Settings / Project Settings IA。

### 架构约束

- 前端只能通过 `src/shared/commands/command-client.ts` -> `settings-commands.ts` / `issue-commands.ts` 调用 Rust Core；不要在 React 里直接访问 SQLite 或 shell。[Source: `_bmad-output/planning-artifacts/architecture.md` §Boundaries]
- `features/issues` 负责 Issue 看板、Issue Detail 与 Run Dialog；`features/settings` 继续负责 Agent Profile 配置；不要把 prompt builder 丢进 `shared/ui` 或 Settings 表单文件里。[Source: `_bmad-output/planning-artifacts/architecture.md` §Component Boundaries]
- Story 2.1 不需要新的业务状态写入路径；Issue 状态仍以 Rust Core 为唯一权威写入口，因此在未进入 Story 2.3 前，前端不得私自把 Issue 改成 `running`。[Source: `_bmad-output/planning-artifacts/architecture.md` §Service Boundaries]
- Run Dialog 不展示 command 可用性或配置来源解释，这是 PRD/UX 的明确边界，不应把 Settings 事实泄漏到 Run 预览层。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-9；`EXPERIENCE.md` Component Patterns]

### 当前代码状态与修改指引

- `src/features/issues/issues-activity.tsx` 当前只有一个 Issue Detail Dialog，`Run` 按钮始终 disabled，右侧 Session 区也还是静态 `No session linked.`。实现 2.1 时应把 Run Dialog 逻辑从这个单文件中拆出明确边界，避免继续堆叠弹窗状态。
- `src/features/issues/issues-activity.test.tsx` 已覆盖四泳道、Issue Detail 打开/关闭、焦点环和当前 disabled Run 行为；这些测试是 2.1 的直接回归面。
- `src/features/settings/settings-commands.ts` 已可按 `scope` + `projectId` 拉取 profile；`AgentProfileRecord` 当前字段为 `scope`、`projectId`、`mode`、`dangerous`、`defaultSkill`、`promptTemplate`，没有 `enabled`、`defaultArgs` 或 override DTO。
- `src/features/settings/agent-profile-form.tsx` 当前只允许配置 `mode`、`dangerous`、`defaultSkill`、`promptTemplate`。Run Dialog 预览必须消费这些真实字段，而不是假设 settings 侧已经有另一套未落地参数。
- `src/app/app-shell.tsx` / `src/app/activity-router.tsx` 当前只把 `projectId`、`projectName` 传给 `IssuesActivity`；若要显示 working directory，需要把 `ProjectSummary.path` 一并传下去，这是当前最小、最直接的接线方式。
- `src/features/issues/issue-commands.ts` 当前只有 list/create/update，没有任何 Run / Session command；这正是 2.1 不应提前启动 Rust Session 流程的信号。

### 前置故事信息

- Story 1.5 已建立 Issue CRUD 与 Issue Detail Dialog，给了 2.1 现成的 backlog Issue 打开入口。
- Story 1.8 初始建立了 Agent Profile / Project override 基础，但仓库后续已在 `3547b5e` 收敛成 scoped profiles；2.1 必须以当前代码为准。
- Story 1.10 已完成桌面视觉 token 与基础弹窗/焦点规则，Run Dialog 应复用当前 dialog 外观与可访问性基线，而不是另起一套视觉语言。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `c009ee5`。
- 当前工作流创建阶段只应修改 story 工件与 `sprint-status.yaml`；开发阶段再根据实际实现决定是否涉及 `src/app/`、`src/features/issues/`、`src/features/settings/`。
- 由于 2.1 预期只改 TypeScript / React 代码，默认最小验证是 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`，并建议保留 `pnpm build` 作为 UI 收尾验证。

### 测试要求

- 因本 story 将修改 TypeScript / React 源码，必须运行 `pnpm lint` 与 `pnpm typecheck`。
- 因本 story 会修改弹窗状态流、渲染逻辑、数据选择与测试依赖实现，必须运行 `pnpm test`。
- 因本 story 会改动 Vite/React 的 UI 组装与样式消费路径，建议保留 `pnpm build` 作为最后验证。
- 最小验证命令清单：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 2 / Story 2.1、FR9、UX-DR8。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-5、FR-8、FR-9、Run Dialog 边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — Run Dialog 所属 React Workbench 模块与数据模型原始设计。
- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` — FR-9 可测试结果与 Run Dialog 可视化风险提示。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Run Dialog 行为规则、Issue backlog 无 profile 时的 UX 处理。
- `_bmad-output/planning-artifacts/architecture.md` — Component / Service / Data Boundaries。
- `src/features/issues/issues-activity.tsx`、`src/features/issues/issues-activity.test.tsx` — 当前 Issue Detail 与回归面。
- `src/features/settings/settings-commands.ts`、`src/features/settings/agent-profile-form.tsx` — 当前 scoped profile 真实字段与可用配置输入。
- `src/app/app.tsx`、`src/app/app-shell.tsx`、`src/app/activity-router.tsx` — 当前 Project path 传递边界。
- `src-tauri/migrations/0007_restructure_agent_profiles.sql` — scoped profiles 现行 schema 事实来源。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-06T16:09+0800：`bmad-dev-workflow` preflight 识别 `2-1-generate-and-preview-issue-run-prompt` 为 Epic 2 首个 backlog story，基线 `HEAD` 为 `c009ee5`。
- 2026-06-06T16:12+0800：核对 `epics.md`、PRD、UX 与 architecture，确认 Story 2.1 只负责 Run Dialog 预览，不负责 Session 启动或状态机变更。
- 2026-06-06T16:14+0800：读取当前 `IssuesActivity`、`settings-commands`、`agent-profile-form` 和 `0007_restructure_agent_profiles.sql`，确认仓库真实模型已从 override 演进为 scoped profiles，story 已按现状重写实现指导。
- 2026-06-06T17:36+0800：实现 `run-prompt-builder`、`IssueRunDialog` 和 `IssuesActivity` 的 profile 可用性判断，明确 `Start` 仅保留 Story 2.2 / 2.3 的接线占位。
- 2026-06-06T17:39+0800：完成定向测试、全量 `format/lint/typecheck/test/build` 验证，并人工复核 Run Dialog 未越界引入 Session 启动或状态流转。

### Completion Notes List

- create-story 已为 Story 2.1 生成完整开发上下文。
- 已显式记录规划文档与当前代码在 Agent Profile 数据模型上的偏差，并默认以后者为准。
- 已将 Story 2.1 与 2.2 / 2.3 的职责边界切开，避免在预览 prompt 阶段提前创建 Session 或污染 Issue 状态。
- 新增 `run-prompt-builder.ts`，以最小占位符替换规则集中处理 prompt 预览、来源列表和 `{{issue.title}}` 的显式 opt-in 规则。
- 新增 `IssueRunDialog`，支持选择 project/global profile、展示 working directory / default args / final prompt preview，并在无 profile 时给出事实性提示。
- `IssuesActivity` 现在会预加载 profile 可用性，只有 backlog Issue 且存在 profile 时才启用 `Run`，关闭 Run Dialog 后会把焦点还给 `Run` 按钮。
- 通过 `ActivityRouter` 与 `AppShell` 将当前 Project `path` 传入 `IssuesActivity`，避免为 working directory 预览新增 Rust command。
- 人工 review 已完成，未发现需要继续修补的阻塞问题，Story 状态可收口为 `done`。

### Validation Commands

- `pnpm test -- --run src/features/issues/run-prompt-builder.test.ts src/features/issues/issues-activity.test.tsx`
- `pnpm typecheck`
- `pnpm test -- --run src/features/issues/run-prompt-builder.test.ts src/features/issues/issues-activity.test.tsx`
- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

### Validation Results

- `pnpm test -- --run src/features/issues/run-prompt-builder.test.ts src/features/issues/issues-activity.test.tsx`：失败，2 个新用例初版断言有误，分别是 textarea 值断言写法和重复 mock profile id 导致的重复 key 警告。
- `pnpm typecheck`：通过。
- `pnpm test -- --run src/features/issues/run-prompt-builder.test.ts src/features/issues/issues-activity.test.tsx`：通过，61 个测试通过；输出包含既有 `Could not parse CSS stylesheet` 警告。
- `pnpm format`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过，61 个测试通过；输出包含既有 `Could not parse CSS stylesheet` 警告。
- `pnpm build`：通过；保留既有 esbuild CSS minify warning（`"file" is not a known CSS property`）与 chunk size warning，未阻塞本 story。

### File List

- _bmad-output/implementation-artifacts/2-1-generate-and-preview-issue-run-prompt.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- src/app/activity-router.tsx
- src/app/app-shell.tsx
- src/features/issues/issue-run-dialog.tsx
- src/features/issues/issues-activity.test.tsx
- src/features/issues/issues-activity.tsx
- src/features/issues/run-prompt-builder.test.ts
- src/features/issues/run-prompt-builder.ts

### Change Log

- 2026-06-06：创建 Story 2.1 开发上下文并将状态推进到 ready-for-dev。
- 2026-06-06：完成 Run Dialog 预览、prompt builder、profile 可用性判断与回归测试，状态推进到 review。
- 2026-06-06：完成人工 code review，无阻塞发现，状态推进到 done。
