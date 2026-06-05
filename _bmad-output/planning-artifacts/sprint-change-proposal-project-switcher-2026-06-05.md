# Sprint Change Proposal：Story 1.4 Project Switcher

**Date:** 2026-06-05
**Status:** Applied
**Trigger Story:** Story 1.4 `展示 Project Home 并处理路径异常`
**Mode:** Batch

## 1. 问题摘要

用户在 `pnpm tauri dev` 运行后的窗口体验中发现，当前顶部仍以静态 `RedWhisk` 和内容区顶部的 `PROJECT` / Project 名称 / repo path 表达当前项目。新的期望是更接近 VS Code 的 Project 切换体验：窗口顶部与关闭按钮同一行显示当前 Project 名称下拉；展开后展示本机 Projects，每项包含 icon、项目名、路径和当前选中对钩。

本次变更把 Story 1.4 从“只恢复 Project Home 和路径异常”扩展为“恢复 Project Home + 提供工作台顶部 Project Switcher”。切换到其它 Project 时，不在当前窗口原地替换 Project，而是打开一个新的 RedWhisk 窗口显示目标 Project。

## 2. 影响分析

**Epic Impact**

- Epic 1 仍然成立，不需要新增 epic 或重排 epic。
- Story 1.4 范围扩大，但仍属于 FR2 的 Project 恢复与打开选中 Project 能力。
- Story 1.3 不变：创建 Project 成功后进入新 Project 的 Issues Activity。
- 后续 Issue / Agent stories 不需要改顺序；它们继续假设“当前窗口已有一个打开的 Project context”。

**Artifact Impact**

- PRD：FR-2 和产品形态需要加入 Project Switcher、新窗口打开目标 Project、移除内容区重复 Project 标识。
- Epics：FR2 inventory、UX-DR5、Story 1.4 acceptance criteria 需要同步。
- UX：需要新增 Project Switcher surface、component 行为、键盘交互、路径异常状态和 Tab 顺序。
- Architecture：需要明确 Project Switcher 属于 `features/project`，Project 切换通过 Rust/Tauri command 打开新窗口，不能只在前端 store 中切换当前 Project。

**Technical Impact**

- 需要复用最近 Project 查询 DTO，供 Project Home 和 Project Switcher 使用。
- 需要一个 Tauri command，例如 `open_project_window` / `openProjectWindow`，负责校验 `repo_path`、更新目标 Project 的 `last_opened_at`、创建新 Tauri window。
- Project Switcher icon 色彩应从固定色板按 `project_id` 或名称稳定派生；不要每次渲染随机变化。

## 3. 推荐方案

采用 **Direct Adjustment**。

理由：

- Story 1.4 仍是 `backlog`，尚未生成独立 story 文件，直接更新 planning artifacts 成本最低。
- 变更没有推翻 Project / Issue / Agent 的核心状态模型，也不影响已完成 Story 1.2 / 1.3 的实现边界。
- 新窗口打开是产品行为变化，但可以通过 Project feature 和 Tauri command 边界局部承载，不需要重新设计整个 MVP。

替代方案：

- 原地切换当前窗口 Project：不采用。它会让当前窗口 store、正在打开的 Dialog/Agent Session/terminal 生命周期更复杂，且不符合本次明确要求。
- 取消 Project Home，只保留顶部 switcher：不采用。原 PRD 明确 Project Home 是冷启动首屏，本次需求没有要求删除它。

## 4. 详细变更

### PRD

**文件:** `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md`

**Section:** 术语表

OLD:

```text
仅定义 Project Home、Activity Bar、Project 等概念。
```

NEW:

```text
新增 Project Switcher：Project 工作台顶部、与窗口关闭/最小化/缩放控件同一行的当前 Project 下拉入口。入口显示当前 Project 名称；展开后展示本机 Project 列表，每项包含稳定色块 icon、Project 名称、repo path 和当前选中对钩。
```

**Section:** FR-2

OLD:

```text
用户点击某个 Project 卡片后，系统更新并持久化该 Project 的 last_opened_at，再进入该 Project 的 Issues Activity。
```

NEW:

```text
进入 Project 工作台后，窗口顶部与关闭/最小化/缩放控件同一行显示 Project Switcher；折叠态显示当前 Project 名称，不显示静态 RedWhisk 标题。用户在 Project Switcher 中选择另一个可访问 Project 时，系统更新目标 Project 的 last_opened_at，并打开新窗口显示目标 Project。
```

### Epics

**文件:** `_bmad-output/planning-artifacts/epics.md`

**Section:** Story 1.4

OLD:

```text
I want 打开 RedWhisk 时先看到本机所有 Project card,
So that 我可以明确选择要进入的项目，或从 + card 创建新项目.
```

NEW:

```text
I want 打开 RedWhisk 时能从 Project Home 或工作台顶部 Project Switcher 选择 Project,
So that 我可以明确进入当前项目，并在需要切换项目时打开另一个项目窗口.
```

Story 1.4 新增验收点：

- 工作台顶部与窗口控件同一行显示 Project Switcher。
- 折叠态显示当前 Project 名称，替代静态 `RedWhisk` 标题。
- 内容顶部不再重复展示 `PROJECT` 标识、Project 名称或 repo path。
- 下拉列表 item 包含稳定色块 icon、Project 名称、repo path 和当前选中对钩。
- 选择其它可访问 Project 时打开新窗口，当前窗口保持原 Project。

### UX

**文件:** `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md`

新增 Project Switcher surface 和 component 行为，明确：

- Project Switcher 属于窗口顶部 chrome，不属于 Activity Bar 或内容 Header。
- 展开态为 light 模式浮层。
- `ArrowUp` / `ArrowDown` / `Enter` / `Esc` 支持键盘操作。
- `Tab` 顺序从 Project Switcher 开始。
- 路径不可访问 item 显示异常状态，点击后展示错误，不打开新窗口。

**文件:** `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md`

新增 Project Switcher 视觉规格，明确：

- 折叠态是紧凑文本按钮。
- 展开态宽度约 520-620px，item 高度约 72px。
- icon 为 40px 方形，颜色从固定色板稳定派生。
- 当前 Project 对钩在 item 最右侧。

### Architecture

**文件:** `_bmad-output/planning-artifacts/architecture.md`

新增边界要求：

- `src/features/project/` 负责 Project Switcher。
- Project 列表 DTO 支持 Project Home 和 Project Switcher 复用。
- 打开其它 Project 必须通过 Rust/Tauri command，例如 `open_project_window` / `openProjectWindow`。
- command 负责校验目标路径、更新 `last_opened_at`、创建新 Tauri window。
- 当前 Project context 不应由前端 store 原地替换。

## 5. 实施交接

**Scope:** Moderate

**交接给 Developer agent：**

- 后续先运行 `bmad-create-story` 创建 Story 1.4，确保 story 文件吸收本次 PRD/Epic/UX/Architecture 更新。
- 实现时优先修改 `features/project` 和 Tauri Project command 边界。
- 验收必须覆盖 Project Switcher 展开、当前对钩、路径异常、选择其它 Project 打开新窗口、当前窗口不原地切换。

**成功标准：**

- `pnpm tauri dev` 后，进入 Project 工作台时顶部显示当前 Project 名称下拉，而不是静态 `RedWhisk`。
- 工作台内容顶部不再展示 `PROJECT`、Project 名称、repo path 的重复区域。
- Project Switcher light 浮层结构接近参考图：icon、名称、路径、当前对钩。
- 从 switcher 选择其它可访问 Project 会打开新窗口。

## Checklist 执行记录

- [x] 1.1 触发 story 已识别：Story 1.4。
- [x] 1.2 核心问题已定义：新增 Project Switcher 和多窗口打开目标 Project 行为。
- [x] 1.3 证据已记录：用户提供运行后期望与参考截图。
- [x] 2.1-2.5 Epic 影响已评估：Epic 1 局部调整，无需重排。
- [x] 3.1 PRD 影响已评估并更新。
- [x] 3.2 Architecture 影响已评估并更新。
- [x] 3.3 UI/UX 影响已评估并更新。
- [x] 3.4 其它 artifacts：`sprint-status.yaml` 无需更新，因为 story key/status 未变化。
- [x] 4.1 Direct Adjustment 可行。
- [x] 4.2 Rollback 不适用。
- [x] 4.3 MVP Review 不需要。
- [x] 4.4 推荐路径已选择：Direct Adjustment。
- [x] 5.1-5.5 Proposal 和交接计划已完成。
- [x] 6.4 Sprint status 检查完成：无需变更。

## Application Log

- 2026-06-05: 更新 PRD、Epics、UX Experience、UX Design 和 Architecture，以纳入 Story 1.4 Project Switcher 行为。
