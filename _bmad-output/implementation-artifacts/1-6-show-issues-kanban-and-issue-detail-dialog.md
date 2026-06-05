---
baseline_commit: d6ae47e
---

# Story 1.6: 展示 Issues 四泳道和 Issue Detail Dialog

Status: ready-for-dev

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望在 Issues Activity 中查看四泳道并打开 Issue 详情,
以便我可以快速理解本地任务状态并编辑任务内容.

## Acceptance Criteria

1. 给定 Project 已打开，当用户进入 Issues Activity，则 UI 显示 `Backlog`、`Running`、`Review`、`Completed` 四个常驻泳道，并将 Issue 按 `status` 分入对应泳道。
2. 给定 Issues Activity 渲染 Issue card，当用户查看卡片内容，则卡片只展示 `title`、`status`、`updated_at` 和可选 Session/attention 标记；不得展示 `description`、priority、label、assignee、milestone 或扩展字段。
3. 给定用户点击 Issue card，当 Issue Detail Dialog 打开，则 Dialog 使用左右两栏布局；左侧可编辑 `title` 和 `description`，右侧显示 Session 关联区和当前可用操作。
4. 给定 Issue Detail Dialog 展示，当用户查看字段，则 Dialog 不展示 `status` 字段和 `updated_at` 字段；`backlog` 且无 Agent Session 的 Issue 显示 `Run`。
5. 给定用户通过键盘操作 Dialog，当 Dialog 打开或关闭，则初始焦点进入 Dialog，`Esc` 可关闭，关闭后焦点回到触发的 Issue card；`Tab` 顺序按左右两栏视觉阅读顺序移动。
6. 给定截图风格要求，当 Issues Activity 渲染，则看板视觉接近用户提供的浅色桌面看板：四列均匀排列、列底色非常浅、卡片白底细边线、5px 左右克制圆角、标题和元信息紧凑对齐，不使用彩色状态柱、拖拽排序、营销 hero 或大型管理后台组件。

## Tasks / Subtasks

- [ ] 将 `IssuesActivity` 从最小列表/表单重构为四泳道看板 (AC: 1, 2, 6)
  - [ ] 保留 `listIssues({ projectId })` 的 Rust Core 查询边界，不新增前端直连数据库或本地文件读取。
  - [ ] 在前端按 `IssueStatus` 派生 `Backlog`、`Running`、`Review`、`Completed` 四个固定泳道；即使某泳道为空也必须常驻显示。
  - [ ] 每个泳道 header 显示状态文案和数量；当前 Story 1.9 尚未实现 i18n 基础设施，文案可暂时沿用英文状态名或本 story 内部常量，但需集中定义，避免散落硬编码。
  - [ ] Issue card 使用 `<button>` 或等价可聚焦控件打开详情 Dialog；卡片字段严格限制为 `title`、状态文案、`updated_at`，并预留但不虚构 Session/attention 小标记位置。
  - [ ] 空泳道显示轻量 empty row；空 Backlog 泳道保留 `New Issue` 动作，不使用大插画或整页空态。
- [ ] 实现 Issue Detail Dialog 的左右两栏编辑体验 (AC: 3, 4, 5)
  - [ ] 点击 Issue card 后打开 Dialog，而不是在看板旁边继续使用 Story 1.5 的内联编辑表单。
  - [ ] Dialog 左侧只包含 `title` 和 `description` 编辑控件；保存仍通过 `updateIssue({ projectId, issueId, title, description })`，不得允许前端修改 `status`。
  - [ ] Dialog 右侧显示 Session 关联区占位和当前可用操作区；对于 `backlog` 且无 Agent Session 的 Issue 显示 `Run`，但 Run Dialog、Agent Profile、Agent Session 启动不在本 story 实现。
  - [ ] Dialog 内不得展示 `status` 表单字段、`updated_at` 字段、priority、label、assignee、milestone。
  - [ ] 保存失败时保留用户当前输入并展示事实性错误；不得把本地缓存伪装成已保存。
- [ ] 补齐键盘、焦点和关闭行为 (AC: 5)
  - [ ] Dialog 打开时保存触发卡片引用，关闭后把焦点还给该卡片；如果触发卡片已不存在，则回退到 `New Issue` 或看板容器。
  - [ ] `Esc` 关闭最上层 Dialog；点击遮罩或关闭按钮也关闭 Dialog，且不改变 Issue 状态。
  - [ ] `Enter` 在 Dialog 表单中提交当前主动作；`Tab` 顺序先左侧编辑字段，再右侧 Session/操作区，再底部动作。
  - [ ] 新建 Issue 入口仍可键盘访问；若创建也使用 Dialog，应复用相同焦点纪律。
- [ ] 视觉样式对齐截图和设计系统 (AC: 1, 2, 3, 6)
  - [ ] 看板使用四列常驻布局，列宽稳定，容器高度填满工作区；在可用宽度不足时允许水平滚动，不把四泳道压缩到不可读。
  - [ ] 列背景使用非常浅的中性色或轻微状态 tint，卡片使用白底、1px 细边线、无重阴影、约 5px 圆角。
  - [ ] 卡片内部文本使用桌面工具密度：标题 13px/600 左右，元信息 11px；长标题单行或两行截断，不撑开卡片宽度。
  - [ ] 不引入大型管理后台组件库，不新增渐变装饰、彩色状态柱、拖拽排序、hover-only 关键操作或 celebration animation。
- [ ] 保留前置 story 行为并控制范围 (AC: 1-6)
  - [ ] 保留 Project Home、Project Switcher、路径异常、Activity Bar、Project 打开和 Issue CRUD 持久化行为。
  - [ ] 不新增 `issue_actions`；Story 1.7 专门负责 IssueAction 审计。
  - [ ] 不实现 Run Dialog、Agent Profile、Agent Session、Mark Review、Completion、Summary/Log、Git history、拖拽排序或 cloud sync。
  - [ ] 不修改 Rust `IssueStatus` 状态机语义；如需测试非 backlog 状态，可通过测试数据/mock 数据构造，不新增本 story 不拥有的状态流转 command。
- [ ] 测试与验证 (AC: 1-6)
  - [ ] 更新或新增 Vitest 覆盖四泳道常驻渲染、按状态分组、卡片字段限制、点击卡片打开 Dialog、Dialog 不展示 `status`/`updated_at` 字段、`backlog` Issue 显示 `Run`、`Esc` 关闭与焦点恢复、保存失败不伪造成功。
  - [ ] 保留 Story 1.5 已有 create/update 失败路径测试，必要时迁移到 Dialog 交互。
  - [ ] 运行 `pnpm format`。
  - [ ] 运行 `pnpm lint`。
  - [ ] 运行 `pnpm typecheck`。
  - [ ] 运行 `pnpm test`。
  - [ ] 运行 `pnpm build`。

## Dev Notes

### 关键假设与取舍

- 用户提供的截图是本 story 的视觉约束来源：目标是浅色、克制、桌面工具式 kanban，而不是完整项目管理 SaaS。实现时可以使用轻微列底色帮助识别列，但颜色不能成为主表达。
- 本 story 只消费现有 Issue 数据和更新 `title`/`description`；`running`、`review`、`completed` 状态当前没有 UI 流转命令，不能为展示看板而提前实现后续 Epic 的状态动作。
- `Run` 只是 Issue Detail Dialog 中的可用操作入口占位或禁用按钮；真正 Run Dialog 和 Agent 启动由 Epic 2 负责。
- Story 1.9 尚未完成 i18n 基础设施，因此本 story 可以集中定义临时状态/操作文案；后续 i18n story 再迁移到字典，不能在本 story 扩大范围实现完整 i18n。

### 范围边界

- 交付 FR5、UX-DR6、UX-DR7、UX-DR19、UX-DR20 和 NFR8 中与 Issues Activity / Issue Detail Dialog 直接相关的部分。
- 不交付 FR6 IssueAction 审计，不交付 FR9/FR10 Run Dialog 和 Agent Session，不交付 FR15 attention 数据写入。
- 可显示 Session/attention 标记的占位规则，但不得虚构不存在的 Agent Session 数据。

### 架构约束

- SQLite 只能由 Rust Core 的 repository/service 层读写；React 不直接访问数据库或 shell。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Architecture]
- React store 只保存 view state、选中项、Dialog 可见性和缓存查询结果；业务状态 source of truth 是 Rust Core。[Source: `_bmad-output/planning-artifacts/architecture.md` §Frontend Architecture]
- Tauri command 使用 `snake_case`，前端 wrapper 使用 `camelCase`；本 story 应继续通过 `src/features/issues/issue-commands.ts` 调用 `listIssues` / `updateIssue`。[Source: `_bmad-output/planning-artifacts/architecture.md` §API / Command Naming Conventions]
- 前端按 feature 组织；Issues 看板、卡片、详情 Dialog 归属 `src/features/issues/`，不要放入泛化 `shared`，除非抽出真正跨 feature 的 primitive。[Source: `_bmad-output/planning-artifacts/architecture.md` §Project Organization]
- 控件必须可键盘聚焦，focus ring 使用 accent blue；Dialog 打开时焦点进入，关闭后回到触发控件。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Keyboard & Accessibility]

### 当前代码状态与修改指引

- `src/features/issues/issues-activity.tsx` 当前是 Story 1.5 的最小列表 + 内联创建/编辑表单；本 story 应将其升级为 kanban + Dialog，但复用现有 `listIssues`、`createIssue`、`updateIssue`、Project 切换 stale state 防护和失败处理思路。
- `src/features/issues/issues-activity.test.tsx` 当前覆盖 create/update 失败、Project 切换 stale state、late create 防护和 cancel 恢复；重构后需要保留这些行为的等价覆盖。
- `src/app/app.css` 当前承载 Issues 最小 UI 样式；本 story 可以继续在此文件新增/替换 Issues 相关 class，保持改动局部，不顺手重构 Project Switcher 或 Activity Bar 样式。
- `src/features/issues/issue-commands.ts` 已定义 `IssueStatus = "backlog" | "running" | "review" | "completed"` 和 `IssueRecord`；看板分组应复用这些类型。
- Rust 侧 Issue service 已保证 Project 作用域、title trim、空标题错误和 `updated_at` 单调推进；本 story 优先只改前端，除非测试暴露必须补充的跨边界行为。

### 视觉与交互细节

- 四泳道标题可以映射为 `Backlog`、`Running`、`Review`、`Completed`；数量显示在标题旁，类似截图中 `待办 1` 的紧凑计数。
- 卡片建议展示：第一行状态/短横标记 + Issue id 或状态 meta，第二行粗体 title，第三行可选 description 摘要不允许，因为 AC 限定 card 只展示 `title`、`status`、`updated_at` 和可选标记。若需要更丰富内容，只能放入 Dialog。
- `updated_at` 展示使用现有 epoch ms 本地时间格式化；若需要压缩显示，可集中实现 helper，不改数据结构。
- Dialog 左右两栏：左侧编辑区宽度较大，右侧为 Session/操作区。右侧在当前 story 可显示 “No session linked” 类型事实性文案和 `Run` 按钮，但不得打开 Run Dialog。
- 卡片与 Dialog 不使用大圆角；卡片约 5px，Dialog 约 7px，边线表达层级，阴影极轻或不用。

### 前置故事信息

- Story 1.2 建立了 `LocalDataService`、SQLite 连接、migration runner、`initialize_local_data` command、统一 `CommandError` 和前端 `invokeCommand` wrapper。
- Story 1.3 建立了 Project 创建、Git repo 校验、Project DTO/repository/service/command 和 Tauri dialog 创建流程。
- Story 1.4 建立了 Project Home 恢复、Project Switcher、路径异常展示和跨窗口 Project 打开行为。
- Story 1.5 已完成 Issue schema、Issue DTO/repository/service/commands、前端最小 Issue CRUD、Project 作用域更新、SQLite foreign keys、前端 stale state/竞态防护和失败路径测试。

### Git Intelligence

- `d6ae47e Implement local issue CRUD workflow` 是 Story 1.5 的最终实现提交；本 story 应基于该提交后的 `IssuesActivity` 做局部演进。
- `873ba93 Refactor project ids and timestamps` 确认实体 id 和 timestamp 使用 INTEGER / epoch milliseconds；本 story 不应重新引入字符串 id 或 ISO timestamp。
- `adc21ae Set macOS traffic light y position to 22` 只调整窗口 chrome；本 story 不需要修改 titlebar 行为。

### 测试要求

- 因本 story 会改动 TypeScript/React 源码，必须运行 `pnpm lint` 与 `pnpm typecheck`。
- 因本 story 会改动渲染逻辑、分支逻辑、数据流和测试依赖实现，除 lint/typecheck 外必须运行前端测试。
- 本 story 预期不改 Rust 源码；如实际改动 Rust，则必须额外运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 和 `cd src-tauri && cargo test`。
- 最小验证命令清单：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 1 / Story 1.6、FR5、UX-DR6、UX-DR7、UX-DR19、UX-DR20、NFR8。
- `_bmad-output/planning-artifacts/architecture.md` — Data Architecture、Frontend Architecture、API & Communication Patterns、Project Organization。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Issues Activity 四泳道、Issue Detail Dialog、Keyboard & Accessibility、Modal discipline。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md` — Issue card、Dialog、颜色、圆角、桌面工具视觉密度。
- `_bmad-output/implementation-artifacts/1-5-create-and-edit-local-issue.md` — 前置 Issue CRUD、测试、review 修复和文件边界。
- `src/features/issues/issues-activity.tsx` — 当前最小 Issue UI，将升级为看板与 Dialog。
- `src/features/issues/issues-activity.test.tsx` — 当前 Issues Activity 行为覆盖，重构后需保留等价断言。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

### Completion Notes List

- create-story 上下文分析已完成，已生成 Story 1.6 的开发实现指南。
- 用户提供截图中的浅色 kanban 风格已纳入验收标准和视觉实现约束。

### File List

### Change Log
