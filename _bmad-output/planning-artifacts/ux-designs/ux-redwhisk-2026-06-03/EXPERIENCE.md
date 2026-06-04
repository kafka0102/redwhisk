---
name: RedWhisk
status: final
sources:
  - {planning_artifacts}/prds/prd-redwhisk-2026-06-03/prd.md
  - {planning_artifacts}/prds/prd-redwhisk-2026-06-03/addendum.md
updated: 2026-06-03
---

# RedWhisk — Experience Spine

## Foundation

RedWhisk 是跨平台桌面应用，MVP 以 macOS 体验优先验证，同时为 Windows / Linux 保留布局和输入兼容性。前端为 React + TypeScript，运行在 Tauri 桌面壳中。UI 不是 Web SaaS 组件库换皮；它采用自建桌面工作台组件层，遵守 `DESIGN.md` 的视觉 token 和桌面质感规则。

`DESIGN.md` 是视觉身份 reference，本文件只定义信息架构、行为、状态、交互、可访问性和关键流程。体验优先级是：本地工作流可信、Codex 原生交互不中断、状态不误导、界面简洁清新且不像管理后台。

MVP 形态是单窗口桌面工作台。应用打开后的首屏是 Project Home，展示本机 Project card 网格，最后一个 card 是 `+` 创建 Project 入口。用户点击某个 Project 后才进入 Project 工作台；此时窗口内一级导航为 Activity Bar。所有核心 Issue / Agent 流程围绕一个已打开的 Project 进行。`DESIGN.md` 中 `{spacing.activity-bar-width}`、`{spacing.sidebar-width}`、`{spacing.header-height}` 和 `{spacing.inspector-width}` 是 Project 工作台布局默认尺寸。

## Information Architecture

| Surface | Reached from | Purpose |
| --- | --- | --- |
| Project Home / Project Grid | App cold open / no Project loaded | 展示本机所有 Project card，按最近打开优先排序；最后一个 `+` card 创建新 Project；处理 repo path 不可访问错误 |
| Issues Activity | Activity Bar `Issues` / Project open default | 四泳道本地 Issue 看板，创建 Issue，打开 Issue 详情，启动 Agent |
| Issue Detail Dialog | Issue card click | 编辑 `title` / `description`，查看 Session 关联，执行 Issue 当前可用操作 |
| Run Dialog | Issue Detail `Run` | 选择 Agent Profile，预览和编辑最终 prompt，确认启动 |
| Agents Activity | Activity Bar `Agents` / Run success | 查看 Agent Session 列表，使用 Codex Native Session View，执行关联 Issue 操作 |
| Session Dialog | Agents left sidebar new button | 创建不关联 Issue 的临时 Agent Session |
| Issue Inspector | Agents Session Header Issue title click | 在不中断 Codex Session 的情况下查看和编辑关联 Issue |
| Completion Confirmation | Session Header complete action | 展示 Git 摘要、completion option 和可展开 prompt，确认完成尝试 |
| Project Settings | Activity Bar `Settings` | 当前 Project 名称、repo path、completion policy、默认 Agent、Project override、instructions、日志存储 |
| Global Settings | Left-bottom gear / native menu `Settings...` | UI language、全局 Agent Profiles、全局 completion policy、数据目录、日志目录、About / Diagnostics |
| Summary / Log View | completed Issue / Header / Inspector | 复盘 Issue、Agent Session、CompletionAttempt、commit hash 和日志路径 |

Project Home 不显示 Activity Bar。Activity Bar 只在某个 Project 打开后显示，并且只包含 `Issues`、`Agents`、`Settings`。不要加入 `Code`、`Diff`、`Git History`、`Terminal` 作为 MVP 一级入口。Global Settings 不在 Activity Bar 中，避免把 Project 设置和应用设置混在一起；Project Home 只能通过原生菜单进入 Global Settings。

Issues Activity 使用四个常驻泳道：`Backlog`、`Running`、`Review`、`Completed`。四泳道直接对应 Issue 状态，不用彩色状态柱表达。每张 Issue card 只展示 `title`、`status`、`updated_at`，可显示 Agent Session 标记和 attention 标记。

Agents Activity 采用左右两栏。左侧为 Agent Session list，默认分组为 `Running` 和 `Completed`。右侧为当前 Codex Native Session View。Session 与 `review` 无关，`review` 是 Issue 状态，不是 Agent Session 分组。

## Voice and Tone

微文案要像开发工具，不像项目管理系统。短、直接、可审计。品牌语气和视觉姿态见 `DESIGN.md` Brand & Style。

| Do | Don't |
| --- | --- |
| `选择一个 Git 仓库。` | `让我们开始搭建你的高效项目空间！` |
| `未检测到 commit，Issue 保持待验收。` | `完成失败，请重试。` |
| `Codex 需要你的确认。` | `你的 Agent 正在等待你的协作～` |
| `Session 已异常退出。` | `出了点小问题。` |
| `此 Session 未关联 Issue。` 只在设置或详情上下文中说明 | 在 Header 空状态显示 `No linked issue` |
| 状态文案保持事实性 | 使用庆祝、拟人或绩效管理语气 |

按钮文案沿用 PRD Button Copy：`运行`、`打开会话`、`标记待验收`、`继续会话`、`手动完成`、`Agent 提交并完成`、`不提交直接完成`、`查看总结`、`打开日志`、`配置 Agent`。

## Component Patterns

视觉规格见 `DESIGN.md.Components`。本节只定义行为。

| Component | Use | Behavioral rules |
| --- | --- | --- |
| Project Card Grid | Project Home | 展示本机 Project card。每张 card 展示 Project 名称、repo path、最近打开时间和路径异常状态。最后一个 card 固定为 `+` 创建 Project。点击 Project card 后进入 Project 工作台；未进入 Project 前不显示 Activity Bar。 |
| Activity Bar | Project 工作台一级导航 | 固定左侧。点击切换 Issues / Agents / Project Settings。当前项保持选中，不自动打开弹窗。左下角 gear 打开 Global Settings。 |
| Issue Card | Issues Activity 四泳道 | 点击打开 Issue Detail Dialog。卡片不内联展开。若有关联 Agent Session，显示小型 Agent/Session 标记；若 `attention=requested`，显示 Needs Attention 标记。 |
| Issue Detail Dialog | Issue 查看/编辑 | 左侧编辑 `title` / `description`，修改即保存。右侧展示 Session 关联和操作。Dialog 关闭不改变 Issue 状态。 |
| Run Dialog | 从 Issue 启动 Agent | 选择 Agent Profile；显示可编辑最终 prompt；可折叠查看 prompt 来源；显示 working directory 和 default args；不显示 command 可用性或配置继承来源。`Start` 成功后关闭并进入 Agents Activity；失败时留在 Dialog。 |
| Agent Session List | Agents Activity 左侧 | `Running` 按 `last_active_at` 排序；`Completed` 按结束时间排序，只显示最近 20 条。列表项展示 Issue title 或临时 Session title、Agent 类型、运行状态。 |
| Session Dialog | 新建临时 Agent Session | 字段为 `title`、`agent_profile`、`prompt`。不展示 working directory、command 可用性、配置来源。启动失败不创建 Session。 |
| Session Header | Agents 右侧 | 只在当前 Session 关联 Issue 时显示 Issue 标题和操作。无关联 Issue 时不显示 Issue 区域，不显示 `No linked issue`。 |
| Codex Native Session View | Agents 右侧主体 | xterm 承载 PTY 输入输出。用户输入直接进入 Codex TUI，不提供额外聊天输入框。打开 Inspector 或 Dialog 不卸载 xterm。 |
| Issue Inspector | Agents 中查看关联 Issue | 点击 Header Issue title 打开。`X`、`Esc`、再次点击 Issue title、点击面板外关闭。打开关闭不改变路由，不中断 Session。 |
| Completion Confirmation | Review 完成动作 | 展示 Git status、HEAD、changed files 摘要、completion option。completion prompt 默认隐藏，可展开。未检测到新 commit 时关闭确认面板但 Issue 保持 `review`。 |
| Summary / Log View | completed 复盘 | 展示 Issue 信息、Session 时间、Session 状态、CompletionAttempt、commit hash 和日志路径。日志缺失时显示明确错误。 |

## State Patterns

| State | Surface | Treatment |
| --- | --- | --- |
| No Project | App cold open | 显示 Project Home。若没有任何 Project 记录，只显示 `+` 创建 Project card；非 Git 目录选择后显示错误，不创建 Project。 |
| Project path missing | App open / Project Home | 保留 Project card，显示 repo path 不可访问状态；点击后展示明确错误，提供重新选择目录和从最近列表移除入口。 |
| Empty Backlog | Issues Activity | 泳道内显示轻量 empty row：`暂无待办 Issue。` 单一动作 `新建 Issue`。不要大插画。 |
| Issue backlog | Issue Detail | 显示 `Run`；若无 enabled Agent Profile，`Run` 禁用并提供 `配置 Agent`。 |
| Run start failed | Run Dialog | Issue 保持 `backlog`。Dialog 内显示失败原因和 `重新尝试` / `取消`。 |
| Session running | Agents Activity | Session 在 Running 分组；若有关联 Issue，Header 显示 Issue title 和 `Mark Review`。 |
| Needs Attention | Issues + Agents | 用小型 attention 标记和事实文案 `Codex 需要确认`。不改变 Session 主状态。 |
| Issue review | Agents Header / Issue Detail | 显示完成类按钮；用户仍可继续在 Codex TUI 输入修正，Issue 不退回 `running`。 |
| Agent Commit no commit detected | Completion Confirmation / Issue | 记录 CompletionAttempt，提示 `未检测到 commit，Issue 保持待验收。` Issue 保持 `review`。 |
| Session crashed | Agents List / Header | Session 进入 Completed 展示分组，标记 `crashed`。关联 Issue 不自动 completed，提供日志入口或诊断入口；不显示不可执行的继续会话入口。 |
| App restart with live process lost | Agents List | Agent Session 标记为 `stopped=已停止`。`stopped` 表示应用生命周期中断后原运行中 PTY 无法恢复。 |
| Completed Issue | Issues / Header / Inspector | 不显示 Run / Mark Review / Complete。显示 `查看总结`、`打开日志`。 |
| Log missing | Summary / Log View | 显示 `日志文件不存在或无法访问。` 保留日志路径和诊断入口。 |

## Interaction Primitives

**Keyboard-first but not shortcut-dependent.** RedWhisk 面向开发者，必须支持键盘高效操作，但每个关键动作都要有可见入口。

- `Cmd/Ctrl+K` — [ASSUMPTION] 打开命令面板。MVP PRD 未要求 Command Palette；若不实现，不得让其它流程依赖它。
- `Cmd/Ctrl+1` / `2` / `3` — [ASSUMPTION] 切换 Issues / Agents / Project Settings。
- `Esc` — 关闭最上层 Dialog / Inspector，不关闭或重启 Codex Session。
- `Enter` — 在 Dialog 中提交当前主动作；在 Codex Native Session View 中原样传给 Codex。
- `Cmd/Ctrl+N` — [ASSUMPTION] 在当前 surface 创建对应对象：Issues 中新建 Issue，Agents 中打开 Session Dialog。
- `Tab` — 按视觉阅读顺序移动焦点。

**Mouse / pointer:** 点击 Issue card 打开 Dialog；点击 Session list item 切换右侧 Session；点击 Header Issue title 打开 Inspector。不要使用拖拽作为 MVP 主路径。

**Modal discipline:** 同一时间最多一个 Dialog。Issue Inspector 可与 Codex Native Session View 共存，但不应再打开第二层 Inspector。Completion Confirmation 是 Dialog，打开时不卸载 xterm。

**Banned in MVP:** hover-only 关键操作、拖拽排序、彩色批量状态筛选、无限滚动、营销 hero、卡片内复杂展开、celebration animation。

## Accessibility Floor

行为层可访问性。视觉对比由 `DESIGN.md` color tokens 负责。

- 所有操作按钮必须可键盘聚焦，focus ring 使用 `{colors.accent-blue}` / `{colors.accent-blue-dark}`。
- `Tab` 顺序遵循：Activity Bar -> 左侧栏 -> Header -> 主内容 -> Inspector / Dialog。
- Dialog 打开时焦点进入 Dialog；关闭后回到触发控件。
- Issue Inspector 打开时不强制抢走 Codex TUI 焦点，除非用户通过键盘打开 Inspector。
- xterm 区域必须有可读 label，例如 `Codex Session terminal`；进入后键盘输入原样传递给终端。
- attention、crashed、no commit detected 等状态不能只靠颜色表达，必须有文本或可访问 label。
- 控件 hit target 最小 28px；常用 Activity Bar 图标 hit target 40px 以上。
- 支持 `zh-CN` 与 `en-US` 文案；状态和命令文案不能硬编码在组件内部。
- Reduce Motion 下禁用面板滑入动画；Inspector / Dialog 直接出现或使用极短淡入。

## Responsive & Platform

MVP 是桌面优先，不做移动端。窗口尺寸变窄时保持桌面工具逻辑，而不是切成移动 Web。

| Width | Behavior |
| --- | --- |
| `>= 1280px` | Activity Bar + Sidebar + 主 Session / Issues 区域 + Inspector 可并存。 |
| `960px - 1279px` | Sidebar 保持；Inspector 打开时覆盖右侧一部分内容；xterm 不卸载。 |
| `< 960px` | [ASSUMPTION] Sidebar 可折叠到仅图标或临时 overlay；MVP 最小可用宽度待实现确认。 |

macOS 上保留桌面窗口质感；Windows / Linux 不复制 macOS chrome，但保持面板、边线、密度和 keyboard behavior 一致。

## Inspiration & Anti-patterns

- **Lifted from Multica:** light 模式的白底、黑字、灰色辅助和克制信息密度。
- **Lifted from VS Code:** Activity Bar、左侧列表、右侧工作区、状态可信的开发工具结构。
- **Lifted from Trae:** dark 模式的纯黑开发工作台感和沉浸式 coding surface。
- **Rejected — 管理 SaaS 看板：** 不做彩色阶段柱、复杂卡片字段、KPI 式 dashboard、营销式空状态。
- **Rejected — Web app shell：** 不用网页 section 和大卡片拼出桌面应用；核心结构必须像本地工作台。
- **Rejected — 过度设计的 AI Chat UI：** Codex Session 前台保持原生 CLI 体验，应用只负责状态、关联、提醒和完成闭环。

## Product-Specific Trust Rules

| Trust concern | UX rule |
| --- | --- |
| 用户怕 Issue 被误标完成 | 任何完成动作都必须经过确认；未检测到 commit 时 Issue 保持 `review`。 |
| 用户怕 Session 上下文丢失 | Inspector、Dialog、Header 操作不得卸载 xterm；review 继续修正不创建新 Session。 |
| 用户怕应用提交错改动 | `Complete with Agent Commit` 前展示 Git 摘要和 changed files 数量；completion prompt 可展开。 |
| 用户怕异常被伪装成成功 | crashed / stopped 必须显式显示，不自动 completed。 |
| 用户需要复盘 | completed 后提供 Summary 和 Open Log；日志缺失也要显示路径和错误。 |

## Open Items

- `[ASSUMPTION]` Command Palette 快捷键存在，但 MVP PRD 未要求实现；任何核心流程都不能依赖 Command Palette。
- `[ASSUMPTION]` `Cmd/Ctrl+1` / `2` / `3` 与 `Cmd/Ctrl+N` 是建议快捷键，需在实现前确认是否与平台或 Codex TUI 冲突。
- `[ASSUMPTION]` `< 960px` 窗口下 Sidebar 可折叠；MVP 最小可用宽度需要在前端实现时确认。
- `[NOTE FOR UX]` 本次 Fast path 未生成 key-screen mockups。若后续需要视觉校准，优先补 `Issues Activity`、`Agents Activity with linked Issue`、`Run Dialog`、`Completion Confirmation` 四个 mockups。

## Key Flows

### Flow 1 — 林航从本地 Issue 跑起一次 Codex 任务并完成验收

1. 林航打开 RedWhisk，看到本机 Project card 网格，最后一个 card 是 `+` 创建 Project。
2. 林航点击已有 Project card，或点击 `+` 选择一个本地 Git Repository 创建 Project。
3. Project 打开后默认进入带 Activity Bar 的 Issues Activity，四泳道为空或显示已有 Issue。
4. 他在 `Backlog` 新建 Issue，只填写标题和描述。
5. 点击 Issue card 打开 Issue Detail Dialog，确认描述后点击 `运行`。
6. Run Dialog 打开，林航选择 Codex Agent Profile，检查最终 prompt，点击 `Start`。
7. **Climax:** Codex 进程启动成功，界面切到 Agents Activity；左侧 Running 分组出现该 Session，右侧 Codex Native Session View 保持原生终端体验，Header 显示关联 Issue 和 `标记待验收`。
8. 林航在 Codex TUI 中交互，认为结果可验收后点击 `标记待验收`。
9. Issue 保持 `review`，Session 继续 running。林航验收后按 Completion Policy 完成，系统关闭 Session 并提供 Summary / Log。

Failure: Run 启动失败 -> Run Dialog 显示失败原因，Issue 保持 `backlog`，不创建 Agent Session。

### Flow 2 — 陈悦在 review 阶段继续让 Codex 修正

1. 陈悦打开一个已经进入 `review` 的 Issue 对应 Agent Session。
2. Header 显示 Issue 标题和完成类按钮；Codex Native Session View 仍可输入。
3. 她发现结果不符合预期，直接在 Codex TUI 中输入修正要求。
4. Issue 状态保持 `review`，Session 保持 `running`，新的交互写入同一个日志。
5. **Climax:** 修正完成后，她无需重新 Mark Review，也无需创建新 Session；同一 Header 上完成动作仍可用。

Failure: Codex 进程 crashed -> Session 移到 Completed 分组并标记 crashed，Issue 不自动 completed，提供日志入口或诊断入口。

### Flow 3 — 何岚创建不关联 Issue 的临时 Session

1. 何岚进入 Agents Activity。
2. 她点击左侧 Session 列表顶部的新建按钮。
3. Session Dialog 打开，只包含默认标题、Agent Profile、初始 prompt 和 `Start`。
4. 她点击 `Start`。
5. **Climax:** 临时 Session 出现在 Running 分组，右侧打开 Codex Native Session View；Header 不显示 Issue 区域，也不显示 `No linked issue`。

Failure: 启动失败 -> Session Dialog 显示错误，不创建 Session，不影响任何 Issue。

### Flow 4 — 马骁复盘 completed Issue 和异常 Session

1. 马骁重新打开 RedWhisk，Project Home 按最近打开时间展示 Project cards。
2. 他点击目标 Project card 进入 Issues Activity。
3. Issues Activity 的 Completed 泳道显示已完成 Issue。
4. 他打开 completed Issue，选择 `查看总结`。
5. Summary 显示 Issue 信息、Session 时间、CompletionAttempt、commit hash 和日志路径。
6. **Climax:** 马骁能确认 Agent 做过什么、是否提交、日志在哪里。
7. 他看到另一个 Session 标记为 crashed；系统没有把它伪装成 completed，并提供日志入口。

Failure: 日志文件缺失 -> Summary 显示日志路径和 `日志文件不存在或无法访问。`，保留诊断入口。
