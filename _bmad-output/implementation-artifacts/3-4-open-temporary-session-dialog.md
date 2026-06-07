---
baseline_commit: af7b11b
---

# Story 3.4: 打开临时 Session Dialog

Status: ready-for-dev

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望在 Agents Activity 中打开一个不关联 Issue 的临时 Session Dialog,
以便我可以先准备临时会话所需的标题、Agent Profile 和初始 prompt，而不立即创建 Session。

## Acceptance Criteria

1. 给定用户位于 Agents Activity，当用户点击左侧 Session 列表顶部的新建按钮时，系统打开 Session Dialog，并且不直接创建 AgentSession。
2. 给定 Session Dialog 打开，当表单渲染时，界面只显示 `title`、`agent_profile`、`prompt`、`Cancel` 和 `Start`，并且不展示 `working_directory`、command 可用性、配置来源或继承关系。
3. 给定 Session Dialog 初次打开，当系统生成默认值时，`title` 默认为 `Untitled Session` 或等价文案，并且用户可以修改 title。

## Tasks / Subtasks

- [ ] 在 Agents Activity 顶部工具栏接通“新建临时会话”入口，而不是继续停留在禁用占位按钮 (AC: 1)
  - [ ] 将 `src/features/agents/agents-activity.tsx` 中当前禁用的 `New session` 按钮改为可交互入口，点击后仅打开 Session Dialog，不调用任何创建/启动 Session 的 Rust command。
  - [ ] 保持当前 Session 列表、终端区、attention 操作和 linked issue pane 的既有行为不变；打开/关闭 Dialog 不应改变当前选中的 Session。
  - [ ] 不顺手实现 `Cmd/Ctrl+N`、Session Header、临时 Session list item 注入或 Issue 流转；这些不属于 3.4 的最小交付。
- [ ] 新建最小可用的 Session Dialog 前端组件，并复用现有对话框交互模式 (AC: 1, 2, 3)
  - [ ] 参考 `src/features/issues/issue-run-dialog.tsx` 与 `src/features/issues/issues-activity.tsx` 的现有 Dialog 结构，在 `src/features/agents/` 下新增 Session Dialog 组件或等价实现，使用同类 overlay、role、焦点陷阱和关闭交互。
  - [ ] Dialog 只包含 `title` 输入、`agent_profile` 选择、`prompt` 多行输入，以及 `Cancel` / `Start` 两个动作；不要展示 working directory、agent command、profile scope、prompt 来源、default args 或其他调试信息。
  - [ ] `title` 初始值设为 `Untitled Session` 或项目既有等价文案；`prompt` 初始值保持最小事实性空白或极简默认值，不在 3.4 预先生成完整 Run prompt preview。
  - [ ] `Start` 只保留为 Dialog 主动作外观和提交流程承载点；在 3.4 不得伪造“已启动成功”的前端假象，也不要提前接入 `start_standalone_agent_session`。
- [ ] 复用现有 Agent Profile 查询能力，为 Dialog 提供最小必需数据 (AC: 2, 3)
  - [ ] 复用 `listAgentProfiles({ scope: "project", projectId })` 与 `listAgentProfiles({ scope: "global", projectId: null })` 的现有合并模式，为 `agent_profile` 下拉提供候选项，优先保持与 `IssueRunDialog` 一致的排序和 label 规则。
  - [ ] 若当前 Project 和全局都没有可用 Agent Profile，显示事实性提示并让 `Start` 保持不可执行状态；不要在 3.4 中内嵌“去 Settings 创建 profile”的复杂跳转。
  - [ ] 不新增 Rust DTO、command、service 或 repository；3.4 的最小范围应收口在前端 UI 和既有 profile 查询。
- [ ] 满足 Session Dialog 的键盘与焦点约束 (AC: 1, 2, 3)
  - [ ] Dialog 打开时把焦点移入 Dialog；关闭后把焦点还给触发它的 `New session` 按钮，满足 UX-DR20。
  - [ ] 支持 `Esc` 关闭最上层 Dialog、`Tab` 按视觉阅读顺序在 Dialog 内循环，满足 UX-DR19；不要让键盘焦点穿透到底层终端或列表。
  - [ ] `Enter` 在表单内仍应走主动作提交流程，但在 3.4 仅触发前端表单 submit/校验，不得隐式创建 Session；真正启动逻辑留给 3.5。
- [ ] 补齐前端测试，锁定 3.4 的边界而不是只测 happy path (AC: 1, 2, 3)
  - [ ] 在 `src/features/agents/agents-activity.test.tsx` 或新增 co-located test 中覆盖：点击 `New session` 按钮会打开 `Session Dialog`，且不会调用任何“创建 Session”命令。
  - [ ] 覆盖 Dialog 首次打开时的默认 `title`、仅渲染 `title` / `agent_profile` / `prompt` / `Cancel` / `Start`、以及“不展示 working directory / command / 配置来源”这些反向断言。
  - [ ] 覆盖 `Esc` 关闭、`Cancel` 关闭、关闭后焦点返回 `New session` 按钮，以及无可用 Agent Profile 时的事实性提示和 `Start` 禁用态。
  - [ ] 若本 story 只修改 TypeScript / TSX / CSS，运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`；除非你意外引入 Rust 改动，否则不要扩大到 `cargo` 侧。

## Senior Developer Review (AI)

- Outcome: Pending
- Date: 2026-06-07
- Findings: 待开发与同会话 code review 后填写。

## Dev Notes

### 关键假设与取舍

- 3.4 的最小目标是“打开并承载临时 Session 的表单 UI”，不是“真正启动临时 Session”。仓库当前还没有 `start_standalone_agent_session` 前后端链路，因此本 story 应显式把启动副作用留给 3.5，避免做出会误导用户的伪成功交互。
- Agents Activity 顶部已经有 `New session` 图标按钮骨架，这是 2.5 预留给 Epic 3 的扩展点。3.4 应优先接通这个既有入口，而不是新造第二个入口或改动 Session toolbar / linked issue pane 的结构。
- 仓库已经有成熟的 Dialog 参考实现：Issue 编辑 Dialog 在 `issues-activity.tsx` 内处理 trigger focus restore 和表单键盘行为，`IssueRunDialog` 处理 overlay、focus trap 和异步 profile 加载。3.4 最稳妥的方案是复用这些交互模式，而不是重新发明一套 modal 基础设施。

### 范围边界

- 交付：Agents 顶部 `New session` 按钮打开 Session Dialog、Dialog 最小字段与默认值、Agent Profile 选择数据加载、键盘与焦点管理、以及前端回归测试。
- 不交付：真正启动临时 Session、创建 `AgentSession` 记录、Rust command / service / repository、Issue 状态流转、Completion Policy、Session Header 或临时 Session 的列表插入。
- 不交付：working directory 展示、command 可用性探测、配置来源/继承信息、prompt 预览构建器、Settings 快捷跳转、多余帮助文案或新的全局快捷键。

### 架构约束

- 无关联 Issue 的临时 Session 不应显示 Issue 区域，也不参与 Issue 状态流转或 Completion Policy；3.4 虽然尚未启动会话，但 Dialog 设计必须围绕这个边界，而不是复用 Run Dialog 的 Issue 语义。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §UJ-5, §FR-16; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §无关联 Issue]
- Session Dialog 必须保持极简，只包含 `title`、`agent_profile`、`prompt`、`Cancel`、`Start`；不得暴露 working directory、command 可用性或配置来源。[Source: `_bmad-output/planning-artifacts/epics.md` §UX-DR10; `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-16]
- Dialog 打开时焦点进入 Dialog，关闭后焦点返回触发控件；`Esc` 关闭最上层 Dialog，`Tab` 在 Dialog 内按视觉顺序移动。这些约束是 3.4 的核心验收，不是“有空再补”的 polish。[Source: `_bmad-output/planning-artifacts/epics.md` §UX-DR19, §UX-DR20]
- Rust Core 仍是业务事实的唯一来源。3.4 只能查询现有 Agent Profile 数据，不能在 React 本地假造“新 Session 已存在”或预写任何 `AgentSession` 到列表中。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Boundaries, §Internal Communication]

### 当前代码状态与修改指引

- `src/features/agents/agents-activity.tsx` 目前在 toolbar 里渲染了 `New session` 图标按钮，但它仍是 `disabled` 占位；这是 3.4 最直接的前端切入点。
- 同文件已经有 attention 操作、分组列表、splitter 和 linked issue pane；新增 Dialog 状态时要避免破坏这些既有交互，尤其不要让 Dialog 的开关逻辑重置 `selectedSessionId`。
- `src/features/issues/issue-run-dialog.tsx` 已实现 profile 加载、Dialog 键盘约束和焦点陷阱；3.4 可以复用它的异步加载和 focusable-element 组织方式，但不应把 `buildRunPromptPreview`、Issue 标题上下文或 working directory 预览带进 Session Dialog。
- `src/features/settings/settings-commands.ts` 已暴露 `listAgentProfiles`，且 `IssueRunDialog` 已证明“项目级 + 全局 profile 合并”是当前仓库的既有模式；3.4 不需要新增 profile 查询接口。
- 仓库里当前没有 `start_standalone_agent_session`、`SessionDialog` 或“临时 Session 启动结果”类型。若实现过程中发现自己开始设计这些边界，说明已经越过 3.4 范围，应回退到仅做 UI 承载。
- 当前代码尚未广泛使用 `shared/i18n` 文案入口；3.4 应优先保持与现有 `IssueRunDialog` / `AgentsActivity` 同层级的一致写法，而不是借机重做一整轮 i18n 接线。

### 前置故事信息

- Story 2.5 已经把 Agents Activity 扩展为真实的左右两栏布局，并在顶部预留了 `New session` 图标按钮；3.4 应在这个骨架上补 Dialog，而不是重做列表结构。
- Story 2.1 和 2.2 已经建立了 Run Dialog / prompt snapshot 的工作流，但那条链路是“从 Issue 启动 Session”。3.4 需要明确与 Issue 脱钩，只复用对话框和 profile 选择模式，不复用 Issue prompt 拼装语义。
- Story 3.2 和 3.3 已经在 `AgentsActivity` 中加入 attention marker 与“标记关注/清除关注”操作。3.4 必须保证新增 Dialog 后，这些既有操作仍只作用于当前 Session，不因为 overlay 或 focus 处理出现回退。
- Story 3.5 将承接“点击 Start 真正启动不关联 Issue 的临时 Agent Session”；因此 3.4 的结构设计要为后续注入 submit handler 留位置，但本 story 自身不能越权实现启动副作用。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `af7b11b`。
- 当前工作区在 story creation 阶段是干净的；后续开发若出现无关改动，最终提交只能包含 Story 3.4 直接相关文件。
- 按当前代码状态，3.4 的最小实现预计只会改动前端 TypeScript / TSX / CSS，因此默认验证命令为：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

- 只有当实现者错误地把 3.5 的启动链路提前混入本 story 时，才会触发 Rust 侧验证需求；这应视为范围漂移信号，而不是默认路径。

### 测试要求

- 前端运行时逻辑变更：必须运行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
- 重点测试不是“看起来打开了 Dialog”，而是 UI 边界：不直接创建 Session、不展示超范围字段、焦点可回退、无 profile 时主动作不可执行。
- 所有实际执行的验证命令都必须逐条记录到 Dev Agent Record；不能只写“已验证”。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 3 / Story 3.4、3.5、3.6 的验收标准与相邻 story 边界。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — UJ-5、FR-16、Agents Activity 顶部入口与 Session Dialog 极简字段约束。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — 临时 Session 与 Issue 流程隔离的状态表和 IA 冻结口径。
- `_bmad-output/planning-artifacts/architecture.md` — `features/agents` / `settings` 边界、React -> command -> Rust Core 数据流，以及“前端不持久化业务事实”的约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Flow 3、Session Dialog 使用场景与失败路径。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md` — Dialog 组件、桌面工具表单与状态标记的视觉约束。
- `_bmad-output/implementation-artifacts/2-5-show-agents-activity-session-list-and-basic-header.md` — Agents 顶部工具栏骨架、Session 列表与 linked issue pane 的当前承载边界。
- `_bmad-output/implementation-artifacts/3-2-show-needs-attention-indicator.md`、`_bmad-output/implementation-artifacts/3-3-manually-set-and-clear-attention.md` — 当前 `AgentsActivity` 上已经存在的 attention 展示与交互，避免新增 Dialog 时回退。
- `src/features/agents/agents-activity.tsx`、`src/features/agents/agents-activity.test.tsx`、`src/features/issues/issue-run-dialog.tsx`、`src/features/issues/issues-activity.tsx`、`src/features/settings/settings-commands.ts` — 3.4 的主要实现和复用入口。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-07T20:06:30+0800：`bmad-dev-workflow` preflight 读取 `sprint-status.yaml`，确认当前无 `ready-for-dev` story，按顺序锁定 `3-4-open-temporary-session-dialog`，基线 `HEAD` 为 `af7b11b`。
- 2026-06-07T20:08:00+0800：交叉核对 Epic 3.4 / 3.5、PRD FR-16、UX `Session Dialog` / 键盘焦点约束，以及 Story 2.5 / 3.2 / 3.3 的现有边界。
- 2026-06-07T20:09:44+0800：复查代码后确认当前仓库只有 `New session` 占位按钮与现成 profile 查询能力，但尚无 `SessionDialog` 或 `start_standalone_agent_session` 链路；因此 3.4 范围收口为前端 Dialog UI 与测试。

### Completion Notes List

- 2026-06-07：create-story 已为 Story 3.4 生成开发上下文，并将实现范围收口为“打开并管理临时 Session Dialog UI”，不包含真正启动临时 Session。
- 2026-06-07：已明确 3.4 与 3.5 的边界，避免把 `start_standalone_agent_session`、Session 创建或 Issue 隔离逻辑提前混入当前 story。
- 2026-06-07：已识别当前仓库的真实可复用基础：`AgentsActivity` 顶部 `New session` 占位按钮、`IssueRunDialog` 的 Dialog 交互模式，以及 `listAgentProfiles` 的 project/global 合并查询。

### File List

- _bmad-output/implementation-artifacts/3-4-open-temporary-session-dialog.md

### Validation Commands

- create-story 阶段未运行代码验证；待开发阶段按本文件“测试要求”执行并记录实际命令。

### Validation Results

- create-story 阶段已完成工件交叉检查：Epic / PRD / UX / Architecture / 前序 story / 当前代码入口已对齐，故事状态可推进到 `ready-for-dev`。

### Change Log

- 2026-06-07：创建 Story 3.4 开发上下文并将状态推进到 `ready-for-dev`。
