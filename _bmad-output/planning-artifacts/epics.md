---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md
  - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md
  - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/reconcile-brainstorming.md
  - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/review-rubric.md
  - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/.decision-log.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/reconcile-prd.md
  - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/review-ux.md
  - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/.decision-log.md
---

# redwhisk - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for redwhisk, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: 用户可以选择本地 Git Repository 创建 Workspace；系统必须校验目录是 Git Repository，保存 `workspace_id`、`name`、`repo_path`、`created_at`、`last_opened_at`，创建成功后进入 Issues Activity；非 Git 目录必须被拒绝并展示明确错误。

FR2: 用户重新打开应用时可以回到最近打开的 Workspace；系统必须更新并持久化 `last_opened_at`，应用重启后展示最近 Workspace 的 Issues Activity；若 `repo_path` 不存在或不可访问，必须展示错误且不删除 Workspace 记录。

FR3: 系统必须区分当前 Workspace Settings 与 Global Settings；Workspace Settings 位于 Activity Bar 的 `Settings` 并只影响当前 Workspace；Global Settings 通过左下角 gear 或原生顶部菜单打开；两者必须支持 Completion Policy、Agent Profile/Override、日志/数据目录、UI language、About 与 Diagnostics 等配置边界。

FR4: 用户可以在 Workspace 内创建和编辑本地 Issue；Issue 至少保存 `title`、`description`、`status`、`created_at`、`updated_at`；新 Issue 默认为 `backlog`；MVP 不提供 priority、label、assignee、milestone。

FR5: 用户点击 Issue 卡片后，系统打开左右两栏 Issue 详情弹窗；左侧展示并可编辑 `title` 和 `description`，右侧展示 Session 关联区和当前 Issue 可执行操作；弹窗不展示 `status` 和 `updated_at` 字段，并按 Issue 状态显示 `Run`、`Open Session` 或无操作。

FR6: 所有改变 Issue 状态的动作必须写入 IssueAction；创建 Issue、启动 Agent 成功、标记 review、完成 Issue 都生成 IssueAction；启动失败不得把 Issue 改为 `running`，但可以记录失败原因。

FR7: 系统可以检测本机 `codex` command，并允许手动路径兜底；创建 Codex Agent Profile 时通过用户 login shell 执行 `command -v codex`；command 不可执行时不得保存 enabled Agent Profile。

FR8: 用户可以创建全局 Agent Profile，并为 Workspace 设置 WorkspaceAgentOverride；Agent Profile 至少保存 `name`、`agent_type`、`command`、`default_args`、`default_skill`、`prompt_template`、`enabled`；Workspace override 可覆盖默认参数、默认 skill、prompt 模板和 enabled 状态；Run Dialog 使用覆盖后的生效配置。

FR9: 用户从 Issue 点击 `Run` 后，Run Dialog 必须展示可编辑最终 prompt；最终 prompt 由 Issue、Workspace、Agent Profile、WorkspaceAgentOverride、默认 skill、prompt 模板和应用补充说明组成；Run Dialog 支持折叠查看 prompt 来源并保存最终 prompt 快照。

FR10: 用户确认 Run Dialog 后，系统尝试启动 Agent 进程；只有进程成功启动后，才创建 Agent Session、写入 SessionEvent，并将 Issue 改为 `running`；启动失败时 Issue 保持 `backlog`，失败原因展示在 Run Dialog 中。

FR11: 系统必须保存 Agent Session 关键元数据和日志索引；Agent Session 至少保存 `issue_id`、`agent_profile_id`、`codex_session_id`、`status`、`attention`、`working_dir`、`command_snapshot`、`prompt_snapshot`、`log_path`、`started_at`；高频终端输出写入日志文件，SQLite 只保存关键 SessionEvent 和日志路径。

FR12: MVP 中一个 Issue 最多关联一个 Agent Session；已有关联 Agent Session 的 Issue 不允许创建第二个并列 Agent Session；异常退出后优先提供 resume 或日志复盘路径，多 Session Attempt 不进入 MVP。

FR13: Agents Activity 必须展示当前 Workspace 的 Agent Session 列表和当前 Codex Native Session View；左侧按 `Running` 和 `Completed` 分组，`Running` 按 `last_active_at` 排序，`Completed` 展示 `closed`、`crashed` 或 `stopped` 的最近 20 条；列表项展示 Issue title 或临时 Session title、Agent 类型和运行状态。

FR14: 系统必须通过内嵌 PTY 和 xterm.js 运行 Codex CLI；用户输入直接进入 Codex TUI；右侧工作区能显示 Codex TUI 的主要界面、颜色和交互；Enter、方向键、Ctrl+C、粘贴、resize 和退出检测必须在 Spike 中验证。

FR15: 系统必须支持对运行中的 Agent Session 标记用户关注需求；Agent Session 主状态保持 `running`，等待用户输入不改变主状态；`attention` 只取 `none` 或 `requested`；Issues Activity 和 Agents Activity 能展示 Needs Attention。

FR16: 用户可以在 Agents Activity 中创建不关联 Issue 的临时 Agent Session；点击左侧栏顶部新建按钮后打开 Session Dialog；字段为 `title`、`agent_profile`、`prompt`、`Cancel`、`Start`；启动成功后才创建 Session，不触发 Issue 状态流转，也不参与 Completion Policy。

FR17: 用户可以手动将 `running` Issue 标记为 `review`；只有 `running` Issue 且存在关联 Agent Session 时显示 `Mark Review`；点击后 Issue 变为 `review`，Agent Session 保持 `running`，并写入 IssueAction。

FR18: 用户在 `review` Issue 中继续向 Codex 输入修正需求时，Issue 不退回 `running`；同一个 Agent Session 继续记录日志和事件流；Header 仍显示完成类按钮。

FR19: 系统必须显式展示异常 Agent Session，而不是伪装成完成；Codex 进程异常退出时 Agent Session 进入 `crashed`；应用重启后不可恢复的活进程可标记为 `crashed` 或 `stopped`；关联 Issue 不自动进入 `completed`。

FR20: 用户可以在 `manual` 策略下手动完成 Issue，也可以在 `agent_auto_commit` 且无未提交改动时直接完成；确认后系统关闭 Agent Session，将 Agent Session 标记为 `closed`，将 Issue 标记为 `completed`，并写入 IssueAction。

FR21: 用户可以在 `agent_auto_commit` 策略下让当前 Codex 只提交本 Issue 相关改动并完成 Issue；系统必须检测 Issue、Session、Workspace、Git status、HEAD、changed files 和策略配置；用户确认后把 completion prompt 发送给当前 Codex Agent Session；检测到新 commit 后记录 hash 并完成 Issue，未检测到 commit 时保持 `review`。

FR22: 每次完成尝试必须写入 CompletionAttempt；至少记录 `issue_id`、`session_id`、`option`、`head_before`、`head_after`、`changed_files_json`、`commit_hash`、`result`、`error`、`created_at`；遇到 merge/rebase/cherry-pick 进行中状态时提示手动处理，不自动完成。

FR23: completed Issue 不提供重新打开或重新运行能力；completed Issue 不显示 `Run`、`Mark Review`、`Complete Manually`、`Complete with Agent Commit`；MVP 不实现 `Reopen`；状态不一致时展示诊断信息，不自动修复。

FR24: 用户可以查看 completed Issue 的 Summary 和日志；Summary 至少展示 Issue 信息、Agent Session 时间、Agent Session 状态、CompletionAttempt 结果、commit hash 和日志路径；`Open Log` 能打开或定位原始日志文件；日志缺失时展示明确错误。

FR25: 当前 Agent Session 关联 Issue 时，右侧 Session Header 显示 Issue 标题和操作；无关联 Issue 时不显示 Issue 区域，也不显示 `No linked issue`；点击 Issue 标题打开 Issue Inspector，不跳转页面，不卸载 xterm；Issue Inspector 可编辑 `title` 和 `description` 并展示 Session 关联区和操作区。

FR26: 系统必须为核心状态和命令提供 `zh-CN` 与 `en-US` 文案；Issue 状态文案包含 `backlog=待办`、`running=运行中`、`review=待验收`、`completed=已完成`；核心命令文案包含运行、打开会话、标记待验收、继续会话、手动完成、Agent 提交并完成、不提交直接完成、查看总结、打开日志、配置 Agent；UI 命令语义不把 Codex 写死为唯一 Agent 名称。

### NonFunctional Requirements

NFR1: 本地优先与隐私。MVP 不需要用户登录，不上传 Issue、prompt、日志、Git 状态或代码内容；所有核心数据保存在本机。

NFR2: 状态可靠性。Issue 状态和 Agent Session 状态的改变必须由 Rust Core 或等价核心层完成；前端不得单独把核心状态写为 `running`、`review`、`completed`、`closed`。

NFR3: 审计性。所有状态变化、完成尝试和 Agent Session 关键事件必须能在 SQLite 结构化记录或日志文件中复盘。

NFR4: 终端性能。原始终端输出写入日志文件，SQLite 只保存关键事件和摘要，避免高频输出拖垮数据库。

NFR5: 完成安全。应用不得默认执行 `git add .` 或自行提交全部改动；Agent Commit 只能通过向当前 Codex Agent Session 注入 completion prompt，并由应用侧 Git 检测验证结果。

NFR6: 失败可见性。启动失败、command 不可用、Agent Session crashed、未检测到 commit、日志缺失和 Git 操作异常必须明确展示，不得静默改为成功状态。

NFR7: 跨平台目标。产品方向是 macOS 桌面应用并尽量支持 Windows 和 Linux；MVP 验收以 macOS 先通过为主，Windows/Linux 兼容性风险在 Spike 中记录但不阻塞 MVP。

NFR8: UX 可访问性基础。所有操作按钮必须可键盘聚焦；Dialog 关闭后焦点回到触发控件；xterm 区域必须有可读 label；attention、crashed、no commit detected 等状态不能只靠颜色表达；核心状态和命令文案不能硬编码在组件内部。

NFR9: 桌面工具视觉一致性。UI 必须保持简洁、清新、克制、有桌面软件质感；避免管理 SaaS、营销式 hero、彩色阶段柱、大圆角卡片墙、渐变装饰和廉价 Web app shell。

NFR10: 范围控制。MVP 不实现完整代码浏览、完整 Diff、Git 历史、merge/rebase UI、插件系统、GitHub/GitLab、云同步、Worktree 自动化、多 Session Attempt 或 completed Issue Reopen。

### Additional Requirements

- 使用官方 `create-tauri-app` 的 `react-ts` starter 初始化项目；首个 implementation story 应执行 `pnpm create tauri-app@latest . --template react-ts`，并补齐 lint、typecheck、format、test 脚本。
- 前端使用 React + TypeScript；桌面核心使用 Rust；Vite 负责前端开发服务器和构建；Tauri CLI 负责桌面应用开发、打包和 Rust 集成。
- SQLite 只能由 Rust Core 读写，React 不直接访问数据库；Rust Core 通过 repository/service 层封装数据访问和状态机事务。
- 迁移文件随应用打包，首次启动或打开 Workspace 时运行 migration；表结构至少覆盖 Workspace、WorkspaceSettings、Issue、AgentProfile、WorkspaceAgentOverride、AgentSession、SessionEvent、IssueAction、CompletionAttempt。
- Tauri command/event 是唯一前后端通信边界；不引入 HTTP REST/GraphQL；command 用于请求动作，event 用于通知状态变化和 Session 输出索引更新。
- Command 错误结构必须包含 `code`、`message`，可选 `details`；错误码使用 `SCREAMING_SNAKE_CASE`。
- 前后端类型合同由 Rust `serde` 模型生成 TypeScript 类型，避免手写漂移；跨边界 DTO 显式建模。
- React store 只保存 view state、选中项、Dialog/Inspector 可见性和缓存查询结果；业务状态 source of truth 是 Rust Core。
- Codex 通过 Rust PTY 管理，xterm.js 只负责展示和输入转发；Issue Inspector、Dialog、Header 操作不能卸载 xterm。
- 原始终端输出按 Session 写入日志文件；SQLite 只保存关键 SessionEvent、摘要和日志路径。
- Agent command 检测、Codex 启动、PTY 输入、Git status/HEAD 检测、日志路径创建都由 Rust Core 校验后执行；React 不能直接调用 shell 执行任意命令。
- Completion Policy 只能通过 completion prompt 与 Git 检测闭环；应用层不得静默提交。
- Event name 使用 kebab-case domain event，例如 `workspace-created`、`session-started`、`issue-review-marked`、`completion-failed`；event payload 必须包含可定位实体 ID。
- SQLite 表名使用 `snake_case` 复数名词，列名使用 `snake_case`，timestamp 列以 `_at` 结尾并保存 ISO 8601 UTC 字符串。
- 前端按 Activity/feature 组织：`features/workspace`、`features/issues`、`features/agents`、`features/settings`；Rust 按 `commands/core/db/agent/git/logs/events/types` 分层组织。
- Spike 1 必须验证 Embedded Codex Terminal：启动 Codex、继承 login shell PATH、xterm 显示、键盘输入、Ctrl+C、粘贴、resize、退出检测和日志写入。
- Spike 2 必须验证 Codex Session Resume 与 completion prompt 注入：保存或推断 Codex session id、同 PTY 后续 prompt、completion prompt 注入、异常后的 resume 或降级。
- Spike 3 必须验证 Git Commit Detection：completion 前后记录 HEAD/status/changed files，HEAD 改变时记录 commit hash，未改变时保持 `review` 并记录 `no_commit_detected`。
- 初始架构不引入 Turbo；当前 MVP 使用 `pnpm` 即可，后续拆出多 package monorepo 时再评估任务编排和缓存。

### UX Design Requirements

UX-DR1: 实现 light/dark 双主题 token：light 以 `#F7F8FA`、`#FFFFFF`、黑灰文字和细边线为主；dark 以 `#000000`、`#0B0B0C`、`#141416`、浅色文字和细边线为主。

UX-DR2: 实现全局 typography token：正文 13px、标签 12px、元信息 11px、mono 12px；所有 `letterSpacing` 保持 0；终端、命令、路径、commit hash 使用 mono 字体。

UX-DR3: 实现桌面布局尺寸 token：Activity Bar 48px、Sidebar 280px、Session Header 44px、Issue Inspector 360px、4px 基础 spacing scale。

UX-DR4: 实现克制圆角规则：小控件 3px，按钮和卡片 5px，Dialog 和 Inspector 7px；不得使用大圆角 pill 承载普通文本。

UX-DR5: Activity Bar 固定在左侧，只包含 Issues、Agents、Settings；当前入口用细竖线或细底色表示，左下角 gear 打开 Global Settings。

UX-DR6: Issues Activity 使用 Backlog、Running、Review、Completed 四个常驻泳道；Issue card 只展示 `title`、`status`、`updated_at`，可显示 Agent Session 标记和 attention 标记。

UX-DR7: Issue Detail Dialog 使用左右两栏；左侧编辑 `title` 和 `description`，右侧展示 Session 关联和操作；关闭 Dialog 不改变 Issue 状态。

UX-DR8: Run Dialog 显示 Agent Profile、working directory、default args、可编辑最终 prompt 和可折叠 prompt 来源；不显示 command 可用性或配置继承来源；启动失败时留在 Dialog 并显示失败原因。

UX-DR9: Agents Activity 使用左右两栏；左侧 Session list 按 Running/Completed 分组；右侧展示 Codex Native Session View。

UX-DR10: Session Dialog 只包含 `title`、`agent_profile`、`prompt`、`Cancel`、`Start`；不展示 working directory、command 可用性或配置来源。

UX-DR11: Session Header 只在当前 Session 关联 Issue 时显示 Issue 标题和操作；无关联 Issue 时不显示 Issue 区域，也不显示 `No linked issue`。

UX-DR12: Issue Inspector 从 Header Issue title 打开；支持 `X`、`Esc`、再次点击 Issue title、点击面板外关闭；打开关闭不改变路由，不卸载 xterm。

UX-DR13: Completion Confirmation 展示 Git status、HEAD、changed files 摘要和 completion option；completion prompt 默认隐藏但可展开；未检测到新 commit 时 Issue 保持 `review`。

UX-DR14: Summary / Log View 展示 Issue 信息、Session 时间、Session 状态、CompletionAttempt、commit hash 和日志路径；日志缺失时显示明确错误并保留路径。

UX-DR15: Needs Attention 必须用小型 attention 标记和事实文案表达，不改变 Agent Session 主状态，不用整行或整卡背景色表达。

UX-DR16: Session crashed/stopped 必须在 Agents list/Header 中显式展示；关联 Issue 不自动 completed，提供继续会话或日志入口。

UX-DR17: completed Issue 不显示 Run、Mark Review、Complete；只显示查看总结、打开日志或打开 Inspector。

UX-DR18: 所有核心命令文案必须来自 i18n 字典，并覆盖 zh-CN/en-US；状态文案保持事实性，不使用庆祝、拟人或绩效管理语气。

UX-DR19: Keyboard interaction 必须支持 `Esc` 关闭最上层 Dialog/Inspector、`Enter` 在 Dialog 中提交主动作且在 Codex terminal 中原样传递、`Tab` 按视觉阅读顺序移动焦点。

UX-DR20: Dialog 打开时焦点进入 Dialog，关闭后回到触发控件；Issue Inspector 不应强制抢走 Codex TUI 焦点，除非用户通过键盘打开 Inspector。

UX-DR21: xterm 区域必须有可读 label，例如 `Codex Session terminal`；进入后键盘输入原样传递给终端。

UX-DR22: 所有操作按钮必须可键盘聚焦，focus ring 使用 accent blue；控件 hit target 最小 28px，Activity Bar 图标 hit target 40px 以上。

UX-DR23: Reduce Motion 下禁用面板滑入动画；Inspector/Dialog 直接出现或使用极短淡入。

UX-DR24: Responsive 桌面宽度规则：`>=1280px` 时 Activity Bar、Sidebar、主区域和 Inspector 可并存；`960px-1279px` 时 Inspector 覆盖右侧部分内容但不卸载 xterm；`<960px` Sidebar 行为作为实现前待确认项。

UX-DR25: UI 禁止 hover-only 关键操作、拖拽排序、彩色批量状态筛选、无限滚动、营销 hero、复杂卡片展开和 celebration animation。

UX-DR26: 视觉实现不得使用大型管理后台组件库作为基底；必须用自建桌面工作台组件层和 CSS/token 层实现。

UX-DR27: 后续如需要视觉校准，优先补 `Issues Activity`、`Agents Activity with linked Issue`、`Run Dialog`、`Completion Confirmation` 四个 key-screen mockups。

UX-DR28: Command Palette 和快捷键属于 UX 假设，核心流程不得依赖 Command Palette；快捷键需在实现前确认是否与平台或 Codex TUI 冲突。

### FR Coverage Map

FR1: Epic 1 - 创建 Git Workspace
FR2: Epic 1 - 打开最近 Workspace
FR3: Epic 1 - Workspace Settings 与 Global Settings
FR4: Epic 1 - 创建和编辑 Issue
FR5: Epic 1 - Issue 详情弹窗
FR6: Epic 1 - IssueAction 审计记录
FR7: Epic 1 - Codex command 检测
FR8: Epic 1 - Agent Profile 与 WorkspaceAgentOverride
FR9: Epic 2 - 最终 prompt 生成与确认
FR10: Epic 2 - 成功启动后才进入 running
FR11: Epic 2 - Agent Session 快照和日志索引
FR12: Epic 2 - 一 Issue 一 Agent Session
FR13: Epic 2 - Agents Activity 左右两栏和 Session list 基础
FR14: Epic 2 - 内嵌 PTY/xterm 运行 Codex
FR15: Epic 3 - Needs Attention
FR16: Epic 3 - 不关联 Issue 的临时 Agent Session
FR17: Epic 4 - 手动 Mark Review
FR18: Epic 4 - review 阶段继续修正
FR19: Epic 4 - crashed / stopped Agent Session
FR20: Epic 5 - 手动完成或无提交完成
FR21: Epic 5 - Agent Commit 完成
FR22: Epic 5 - CompletionAttempt
FR23: Epic 5 - completed Issue 操作限制
FR24: Epic 5 - Summary 和日志复盘
FR25: Epic 4 - Session Header 与 Issue Inspector
FR26: Epic 1 - zh-CN / en-US 核心文案

## Epic List

### Epic 1: 本地 Workspace、Issue 与配置基础
用户可以打开一个本地 Git Repository 作为 Workspace，管理极简本地 Issue，并配置 Workspace / Global Settings、Codex Agent Profile 和基础双语文案，为后续 Agent 工作流建立可信本地基础。
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR26

### Epic 2: 从 Issue 可靠启动 Codex Session
用户可以从一个 backlog Issue 生成并确认最终 prompt，启动 Codex Agent Session，并在启动成功后进入可交互的 Codex Native Session View；启动失败不污染 Issue 状态。
**FRs covered:** FR9, FR10, FR11, FR12, FR13, FR14

### Epic 3: Agent Session 管理与临时 Codex 会话
用户可以在 Agents Activity 中查看 Running / Completed Session，识别 Needs Attention，并创建不关联 Issue 的临时 Codex Session；这些临时 Session 不影响 Issue 状态流转。
**FRs covered:** FR15, FR16

### Epic 4: Review 循环、Issue Inspector 与异常 Session
用户可以手动将 running Issue 标记为 review，在 review 阶段继续让 Codex 修正，并通过 Session Header / Issue Inspector 管理关联 Issue；crashed 或 stopped Session 必须显式展示且不自动完成 Issue。
**FRs covered:** FR17, FR18, FR19, FR25

### Epic 5: 完成策略、Agent Commit 与复盘
用户可以按 manual 或 agent_auto_commit 策略完成 Issue；系统记录 CompletionAttempt、检测 commit hash、避免误完成，并在 completed 后提供 Summary 和 Open Log。
**FRs covered:** FR20, FR21, FR22, FR23, FR24

## Epic 1: 本地 Workspace、Issue 与配置基础

用户可以打开一个本地 Git Repository 作为 Workspace，管理极简本地 Issue，并配置 Workspace / Global Settings、Codex Agent Profile 和基础双语文案，为后续 Agent 工作流建立可信本地基础。

### Story 1.1: 初始化 RedWhisk 桌面工作台骨架

As a 本地开发者,
I want 能启动 RedWhisk 桌面应用并看到基础工作台壳,
So that 我可以在一个可信的本地桌面入口中继续配置 Workspace 和 Issue.

**Requirements:** 架构 starter template、pnpm/no Turbo；UX-DR5、UX-DR9、NFR7

**Acceptance Criteria:**

**Given** 仓库尚未包含应用源码
**When** 开发者按架构要求初始化项目
**Then** 项目使用 `create-tauri-app` 的 `react-ts` 模板
**And** 根目录包含可运行的 Tauri + React + TypeScript 应用骨架

**Given** 应用启动成功
**When** 用户打开 RedWhisk
**Then** UI 显示桌面工作台壳，包含 Activity Bar 的 `Issues`、`Agents`、`Settings` 入口
**And** 当前入口状态可见，但未实现的业务区域可以显示空态

**Given** 项目已初始化
**When** 开发者运行质量脚本
**Then** 至少存在并可执行 format、lint、typecheck、test 的基础脚本
**And** 不引入 Turbo 作为初始任务编排工具

### Story 1.2: 建立本地数据存储和核心命令边界

As a RedWhisk 用户,
I want 应用把本地 Workspace 和 Issue 数据可靠保存在本机,
So that 我重新打开应用时能继续之前的工作流.

**Requirements:** NFR1、NFR2、NFR3；架构 SQLite/Rust Core、Tauri command/event、错误结构、migration 边界

**Acceptance Criteria:**

**Given** 应用首次启动
**When** Rust Core 初始化本地数据目录
**Then** 系统创建或打开 SQLite 数据库
**And** 运行 migration 基础设施，包含迁移版本记录和后续故事可增量扩展的 schema 管理

**Given** React 需要读取或改变业务状态
**When** 前端触发操作
**Then** 前端只能通过 Tauri command 调用 Rust Core
**And** 不直接访问 SQLite 或 shell

**Given** Rust Core command 失败
**When** 错误返回前端
**Then** 错误结构包含 `code`、`message` 和可选 `details`
**And** 错误码使用 `SCREAMING_SNAKE_CASE`

### Story 1.3: 创建 Git Workspace

As a 本地开发者,
I want 选择一个本地 Git Repository 创建 Workspace,
So that RedWhisk 能以该仓库作为 Issue 和 Agent 工作流边界.

**Requirements:** FR1、NFR1、NFR2；架构 `workspaces` 表、Rust Core Git 校验

**Acceptance Criteria:**

**Given** 用户没有打开 Workspace
**When** 用户选择一个本地 Git Repository
**Then** Rust Core 校验该目录是 Git Repository
**And** 如 schema 尚未存在则通过 migration 创建 `workspaces` 表，并保存 `workspace_id`、`name`、`repo_path`、`created_at`、`last_opened_at`

**Given** 用户选择非 Git 目录
**When** Rust Core 校验失败
**Then** 系统拒绝创建 Workspace
**And** UI 显示明确错误，且不写入有效 Workspace 记录

**Given** Workspace 创建成功
**When** command 返回成功
**Then** 应用进入该 Workspace 的 Issues Activity
**And** Activity Bar 中 `Issues` 处于选中状态

### Story 1.4: 打开最近 Workspace 并处理路径异常

As a 本地开发者,
I want 重新打开 RedWhisk 时回到最近 Workspace,
So that 我可以继续之前的本地任务流而不用重新选择仓库.

**Requirements:** FR2、NFR1、NFR6

**Acceptance Criteria:**

**Given** 用户曾成功打开 Workspace
**When** 应用重启
**Then** 系统读取最近 Workspace
**And** 展示该 Workspace 的 Issues Activity

**Given** 最近 Workspace 的 `repo_path` 不存在或不可访问
**When** 应用尝试恢复 Workspace
**Then** UI 显示明确错误
**And** 不删除 Workspace 记录

**Given** 用户重新打开某个 Workspace
**When** 打开成功
**Then** 系统更新并持久化 `last_opened_at`

### Story 1.5: 创建和编辑本地 Issue

As a 本地开发者,
I want 在 Workspace 内创建和编辑极简 Issue,
So that 我可以把本地开发任务作为 Agent 工作流入口.

**Requirements:** FR4、NFR1、NFR2；架构 `issues` 表

**Acceptance Criteria:**

**Given** 用户位于 Issues Activity
**When** 用户创建 Issue 并填写 `title` 和 `description`
**Then** 如 schema 尚未存在则通过 migration 创建 `issues` 表，并保存 Issue，默认 `status=backlog`
**And** 保存 `created_at` 和 `updated_at`

**Given** Issue 已创建
**When** 用户编辑 `title` 或 `description`
**Then** 系统持久化更新
**And** 更新 `updated_at`

**Given** 用户查看 Issue 表单
**When** UI 展示字段
**Then** 不提供 priority、label、assignee、milestone 字段

### Story 1.6: 展示 Issues 四泳道和 Issue Detail Dialog

As a 本地开发者,
I want 在 Issues Activity 中查看四泳道并打开 Issue 详情,
So that 我可以快速理解本地任务状态并编辑任务内容.

**Requirements:** FR5、UX-DR6、UX-DR7、UX-DR19、UX-DR20、NFR8

**Acceptance Criteria:**

**Given** Workspace 已打开
**When** 用户进入 Issues Activity
**Then** UI 显示 `Backlog`、`Running`、`Review`、`Completed` 四个常驻泳道
**And** Issue card 只展示 `title`、`status`、`updated_at` 和可选 Session/attention 标记

**Given** 用户点击 Issue card
**When** Issue Detail Dialog 打开
**Then** Dialog 使用左右两栏布局
**And** 左侧可编辑 `title` 和 `description`，右侧显示 Session 关联区和当前可用操作

**Given** Issue Detail Dialog 展示
**When** 用户查看字段
**Then** Dialog 不展示 `status` 字段和 `updated_at` 字段
**And** `backlog` 且无 Agent Session 的 Issue 显示 `Run`

### Story 1.7: 记录 IssueAction 审计

As a 本地开发者,
I want Issue 状态相关动作被记录,
So that 我能复盘本地任务发生过什么.

**Requirements:** FR6、NFR3；架构 `issue_actions` 表

**Acceptance Criteria:**

**Given** 用户创建 Issue
**When** Issue 创建成功
**Then** 如 schema 尚未存在则通过 migration 创建 `issue_actions` 表，并写入一条 IssueAction
**And** IssueAction 至少包含 `issue_id`、`action_type`、`payload_json`、`created_at`

**Given** 后续状态动作尚未实现
**When** 当前 Epic 中只支持创建和编辑 Issue
**Then** IssueAction 结构仍能支持后续启动 Agent、Mark Review、完成 Issue 的动作类型
**And** 不要求提前实现后续状态流转

**Given** Issue 创建失败
**When** command 返回错误
**Then** 不写入成功类 IssueAction
**And** UI 显示失败原因

### Story 1.8: 配置 Codex Agent Profile 和 Workspace Override

As a AI Coding 用户,
I want 配置全局 Codex Agent Profile 并在 Workspace 中覆盖部分配置,
So that 不同仓库可以复用或调整 Codex 启动方式.

**Requirements:** FR7、FR8、NFR2、NFR6；架构 `agent_profiles` 和 `workspace_agent_overrides` 表、login shell command 检测

**Acceptance Criteria:**

**Given** 用户打开 Global Settings
**When** 用户创建 Codex Agent Profile
**Then** 系统通过用户 login shell 执行 `command -v codex`
**And** 如 schema 尚未存在则通过 migration 创建 `agent_profiles` 表，并保存 `name`、`agent_type`、`command`、`default_args`、`default_skill`、`prompt_template`、`enabled`

**Given** `codex` command 检测失败
**When** 用户手动填写 command path 并运行 Test
**Then** command 可执行时允许保存 enabled Agent Profile
**And** command 不可执行时不得保存 enabled Agent Profile

**Given** Workspace 已打开
**When** 用户设置 WorkspaceAgentOverride
**Then** 如 schema 尚未存在则通过 migration 创建 `workspace_agent_overrides` 表，并可以覆盖 `default_args`、`default_skill`、`prompt_template`、`enabled`
**And** override 只影响当前 Workspace

### Story 1.9: 实现 Workspace Settings、Global Settings 与基础 i18n

As a RedWhisk 用户,
I want 区分 Workspace 设置和全局设置，并能切换核心 UI 文案语言,
So that 我可以清楚知道配置作用范围并使用熟悉语言.

**Requirements:** FR3、FR26、NFR8；UX-DR5、UX-DR18；架构 `workspace_settings` 表

**Acceptance Criteria:**

**Given** Workspace 已打开
**When** 用户点击 Activity Bar 的 `Settings`
**Then** 如 schema 尚未存在则通过 migration 创建 `workspace_settings` 表，并打开 Workspace Settings
**And** 只显示影响当前 Workspace 的名称、`repo_path`、completion policy、默认 Agent Profile、WorkspaceAgentOverride、项目 instructions、日志和 Session 存储信息

**Given** 用户点击左下角 gear 或原生菜单 Settings
**When** Global Settings 打开
**Then** 显示 UI language、全局 Agent Profiles、全局默认 completion policy、全局数据目录、全局日志目录、About 和 Diagnostics

**Given** UI language 为 `zh-CN` 或 `en-US`
**When** 用户查看核心状态和命令
**Then** Issue 状态和核心命令文案来自 i18n 字典
**And** UI 命令语义不把 Codex 写死为唯一 Agent 名称

### Story 1.10: 实现桌面视觉 Token 与基础可访问性

As a RedWhisk 用户,
I want 应用具备一致、克制且可访问的桌面视觉基础,
So that 我可以长时间使用工作台而不被网页化或管理后台式 UI 干扰.

**Requirements:** NFR8、NFR9；UX-DR1、UX-DR2、UX-DR3、UX-DR4、UX-DR22、UX-DR23、UX-DR25、UX-DR26

**Acceptance Criteria:**

**Given** 应用工作台壳已初始化
**When** 前端加载全局样式
**Then** 系统提供 light/dark 主题 token、typography token、spacing token、rounded token
**And** token 值遵守 UX Design Requirements 中的桌面视觉约束

**Given** 用户使用基础控件
**When** Button、Dialog、Inspector、Toolbar、Tooltip、Activity Bar 图标渲染
**Then** 控件使用自建桌面工作台组件层和 CSS/token 层
**And** 不引入大型管理后台组件库作为视觉基底

**Given** 用户通过键盘操作应用
**When** 焦点移动到可操作控件
**Then** 控件具备可见 focus ring 和最小 hit target
**And** `Esc`、`Tab`、Dialog focus restore、Reduce Motion 基线行为可被验证

## Epic 2: 从 Issue 可靠启动 Codex Session

用户可以从一个 backlog Issue 生成并确认最终 prompt，启动 Codex Agent Session，并在启动成功后进入可交互的 Codex Native Session View；启动失败不污染 Issue 状态。

### Story 2.1: 生成并预览 Issue Run Prompt

As a 本地开发者,
I want 从 backlog Issue 生成并预览最终 prompt,
So that 我可以在启动 Agent 前确认 Codex 将收到的任务上下文.

**Requirements:** FR9、FR8、UX-DR8

**Acceptance Criteria:**

**Given** 一个 `backlog` Issue 且无关联 Agent Session
**When** 用户在 Issue Detail Dialog 点击 `Run`
**Then** 系统打开 Run Dialog
**And** Dialog 显示 Agent Profile 选择、working directory、default args、`Cancel` 和 `Start`

**Given** Workspace 存在 Agent Profile 和 WorkspaceAgentOverride
**When** Run Dialog 打开
**Then** 系统使用覆盖后的生效配置生成最终 prompt
**And** 可折叠查看 prompt 来源，包括 Issue description、default skill、prompt template、app instructions

**Given** 默认 prompt template 未显式引用 `{{issue.title}}`
**When** 系统生成最终 prompt
**Then** prompt 不包含 Issue title
**And** 只有模板显式引用 `{{issue.title}}` 时才包含标题

### Story 2.2: 编辑并保存最终 Prompt 快照

As a 本地开发者,
I want 在 Run Dialog 中编辑最终 prompt 并保存快照,
So that Agent Session 能保留当次启动时用户确认过的真实输入.

**Requirements:** FR9、FR11、NFR3、UX-DR8

**Acceptance Criteria:**

**Given** Run Dialog 已显示最终 prompt
**When** 用户编辑 prompt 内容
**Then** 编辑后的内容成为本次启动使用的最终 prompt

**Given** 用户点击 `Start`
**When** 启动流程开始
**Then** 系统把最终 prompt 作为 prompt snapshot 传给 Rust Core
**And** 启动成功后该 snapshot 保存在 AgentSession

**Given** 用户点击 `Cancel`
**When** Run Dialog 关闭
**Then** 不创建 AgentSession
**And** 不改变 Issue 状态

### Story 2.3: 启动成功后创建 Agent Session 并更新 Issue 状态

As a 本地开发者,
I want 只有 Codex 进程成功启动后 Issue 才进入 running,
So that 启动失败不会污染任务状态.

**Requirements:** FR10、FR11、FR6、NFR2、NFR3、NFR6；架构 `agent_sessions` 和 `session_events` 表

**Acceptance Criteria:**

**Given** 用户确认 Run Dialog
**When** Rust Core 成功启动 Codex 进程
**Then** 如 schema 尚未存在则通过 migration 创建 `agent_sessions` 和 `session_events` 表，并创建 AgentSession
**And** 保存 `issue_id`、`agent_profile_id`、`status=running`、`attention=none`、`working_dir`、`command_snapshot`、`prompt_snapshot`、`log_path`、`started_at`

**Given** AgentSession 创建成功
**When** Issue 状态更新
**Then** Issue 从 `backlog` 变为 `running`
**And** 系统写入 SessionEvent 和 IssueAction

**Given** Codex 进程启动失败
**When** Rust Core 返回错误
**Then** Issue 保持 `backlog`
**And** 不创建有效 AgentSession
**And** Run Dialog 显示失败原因

### Story 2.4: 限制一 Issue 一 Agent Session

As a 本地开发者,
I want 一个 Issue 在 MVP 中只关联一个 Agent Session,
So that 任务上下文不会因并列 Session 变得混乱.

**Requirements:** FR12、NFR10

**Acceptance Criteria:**

**Given** Issue 已有关联 AgentSession
**When** 用户再次尝试从该 Issue 启动 Agent
**Then** 系统阻止创建第二个并列 AgentSession
**And** UI 显示打开现有 Session 的入口

**Given** 已有关联 AgentSession 的 Issue 状态为 `running`
**When** 用户打开 Issue Detail Dialog
**Then** 显示 `Open Session`
**And** 不显示创建新 Session 的 `Run`

**Given** AgentSession 启动后异常退出的恢复能力尚未实现
**When** 用户查看该 Issue
**Then** 系统保留现有关联关系
**And** 不自动创建新的 Attempt

### Story 2.5: 展示 Agents Activity Session List 和基础 Header

As a 本地开发者,
I want 启动 Codex 后进入 Agents Activity 并看到当前 Session,
So that 我能继续在同一个工作台中与 Codex 交互.

**Requirements:** FR13、FR25、UX-DR9、UX-DR11

**Acceptance Criteria:**

**Given** Issue 启动 AgentSession 成功
**When** Run Dialog 关闭
**Then** 应用切换到 Agents Activity
**And** 左侧 Running 分组显示该 Session

**Given** Agents Activity 有多个 Session
**When** 左侧列表渲染
**Then** `Running` 分组按 `last_active_at` 排序
**And** `Completed` 分组预留展示 `closed`、`crashed`、`stopped` 的最近 20 条能力

**Given** 当前 Session 关联 Issue
**When** 右侧 Header 渲染
**Then** Header 显示 Issue title
**And** 本 Epic 中可显示打开 Issue 上下文入口，但不实现 Mark Review 或 Completion 操作

### Story 2.6: 运行 Codex Native Session View 的 PTY/xterm Spike

As a 本地开发者,
I want 在 RedWhisk 内嵌终端中看到并操作 Codex TUI,
So that 我可以保留接近原生 CLI 的 Agent 交互体验.

**Requirements:** FR14、NFR4、NFR7、NFR8；UX-DR21；架构 Spike 1、Rust PTY、xterm.js

**Acceptance Criteria:**

**Given** 用户启动 Codex AgentSession
**When** Rust Core 创建 PTY 进程
**Then** Codex CLI 在 PTY 中运行
**And** 继承用户 login shell 下可用的 PATH

**Given** Codex PTY 正在运行
**When** 前端渲染 Codex Native Session View
**Then** xterm.js 显示 Codex TUI 的主要界面、颜色和交互
**And** 用户输入直接进入 Codex TUI，不额外实现独立聊天输入框

**Given** 用户在 Codex Native Session View 中操作
**When** 用户按 Enter、方向键、Ctrl+C、粘贴或调整窗口大小
**Then** 对应输入和 resize 能正确传递到 PTY
**And** Spike 记录结果和兼容性风险

### Story 2.7: 记录 Session 日志和退出事件

As a 本地开发者,
I want Agent Session 的原始输出和关键事件被记录,
So that 后续可以复盘 Codex 执行过程.

**Requirements:** FR11、NFR3、NFR4；架构日志文件和 SessionEvent 边界

**Acceptance Criteria:**

**Given** Codex PTY 输出内容
**When** 输出流到达 Rust Core
**Then** 原始输出写入 Session log 文件
**And** SQLite 不逐字符写入终端输出

**Given** AgentSession 已启动
**When** 系统创建或更新 SessionEvent
**Then** SQLite 保存关键事件和 `log_path`
**And** SessionEvent payload 使用统一 JSON 结构

**Given** Codex 进程退出
**When** Rust Core 收到 exit 信息
**Then** 系统记录退出相关 SessionEvent
**And** 后续状态处理留给 Epic 4 的 crashed/stopped 故事完善

## Epic 3: Agent Session 管理与临时 Codex 会话

用户可以在 Agents Activity 中查看 Running / Completed Session，识别 Needs Attention，并创建不关联 Issue 的临时 Codex Session；这些临时 Session 不影响 Issue 状态流转。

### Story 3.1: 完善 Session List 分组和排序

As a 本地开发者,
I want 在 Agents Activity 中按运行状态查看最近 Session,
So that 我可以快速回到当前正在运行或最近结束的 Agent 工作.

**Requirements:** FR13、FR19、NFR6；UX-DR9、UX-DR16

**Acceptance Criteria:**

**Given** Workspace 中存在多个 AgentSession
**When** 用户打开 Agents Activity
**Then** 左侧 Session list 显示 `Running` 和 `Completed` 分组
**And** `Running` 只展示 `status=running` 的 Session

**Given** Running 分组中有多个 Session
**When** Session 有输出或用户输入
**Then** 系统更新 `last_active_at`
**And** Running 分组按 `last_active_at` 倒序展示

**Given** Completed 分组存在已结束 Session
**When** 左侧列表渲染
**Then** Completed 分组展示 `closed`、`crashed` 或 `stopped` 的最近 20 条 Session
**And** 按最近完成或结束时间排序

### Story 3.2: 展示 Needs Attention 标记

As a 本地开发者,
I want 看到哪些运行中的 Codex Session 需要我关注,
So that 我可以及时回到等待确认的任务.

**Requirements:** FR15、NFR8；UX-DR15

**Acceptance Criteria:**

**Given** AgentSession 主状态为 `running`
**When** 系统或用户将 `attention` 设置为 `requested`
**Then** AgentSession 主状态仍保持 `running`
**And** 不创建新的 Session 状态值

**Given** Issue card 关联的 AgentSession `attention=requested`
**When** 用户查看 Issues Activity
**Then** Issue card 显示 Needs Attention 标记
**And** 标记使用小型 attention marker 和事实文案，不改变整卡背景色

**Given** Agents Activity 左侧 Session list 中的 Session `attention=requested`
**When** 列表渲染
**Then** 该 Session item 显示 Needs Attention 标记
**And** 状态不能只靠颜色表达

### Story 3.3: 手动设置和清除 Attention

As a 本地开发者,
I want 能手动标记或清除 Session 的关注状态,
So that 在启发式识别不可靠时仍能维护自己的工作流提醒.

**Requirements:** FR15、NFR2、NFR3；UX-DR15

**Acceptance Criteria:**

**Given** AgentSession 正在运行
**When** 用户对该 Session 执行标记关注操作
**Then** Rust Core 将 `attention` 更新为 `requested`
**And** 写入 SessionEvent

**Given** AgentSession `attention=requested`
**When** 用户清除关注状态
**Then** Rust Core 将 `attention` 更新为 `none`
**And** Issues Activity 和 Agents Activity 的标记消失

**Given** 未来可能加入启发式输出识别
**When** 当前 MVP 实现手动 attention
**Then** 不要求完全可靠解析 Codex TUI 状态
**And** 不把等待用户输入建成 AgentSession 主状态

### Story 3.4: 打开临时 Session Dialog

As a 本地开发者,
I want 在 Agents Activity 中创建不关联 Issue 的临时 Codex Session,
So that 我可以临时询问或操作当前仓库而不创建 Issue.

**Requirements:** FR16、UX-DR10、UX-DR19、UX-DR20

**Acceptance Criteria:**

**Given** 用户位于 Agents Activity
**When** 用户点击左侧 Session 列表顶部的新建按钮
**Then** 系统打开 Session Dialog
**And** 不直接创建 AgentSession

**Given** Session Dialog 打开
**When** 表单渲染
**Then** 只显示 `title`、`agent_profile`、`prompt`、`Cancel` 和 `Start`
**And** 不展示 `working_directory`、command 可用性、配置来源或继承关系

**Given** Session Dialog 初次打开
**When** 系统生成默认值
**Then** `title` 默认为 `Untitled Session` 或等价文案
**And** 用户可以修改 title

### Story 3.5: 启动不关联 Issue 的临时 Agent Session

As a 本地开发者,
I want 从 Session Dialog 启动临时 Codex Session,
So that 我可以在当前 Workspace 中使用 Codex 而不影响任何 Issue.

**Requirements:** FR16、FR11、NFR2、NFR6

**Acceptance Criteria:**

**Given** Session Dialog 已填写 `title`、`agent_profile` 和 `prompt`
**When** 用户点击 `Start`
**Then** Rust Core 使用当前 Workspace `repo_path` 作为 working directory 启动 Agent 进程
**And** 只有进程成功启动后才创建 AgentSession

**Given** 临时 AgentSession 创建成功
**When** Session list 刷新
**Then** 该 Session 出现在 Running 分组
**And** `issue_id` 为空，title 使用用户填写或默认标题

**Given** 临时 Session 启动失败
**When** Rust Core 返回错误
**Then** 不创建 AgentSession
**And** Session Dialog 显示失败原因

### Story 3.6: 临时 Session 不触发 Issue 流转

As a 本地开发者,
I want 临时 Codex Session 与 Issue 工作流隔离,
So that 临时操作不会污染 Issue 状态或完成策略.

**Requirements:** FR16、FR25、NFR2；UX-DR11

**Acceptance Criteria:**

**Given** 当前选中的是不关联 Issue 的 AgentSession
**When** 右侧 Session Header 渲染
**Then** Header 不显示 Issue 标题
**And** 不显示 `No linked issue` 文案

**Given** 用户与临时 Codex Session 交互
**When** Session 产生日志或事件
**Then** 系统记录 AgentSession 日志和 SessionEvent
**And** 不写入 IssueAction

**Given** 临时 Session 正在运行或已结束
**When** 用户查看 Issue 列表
**Then** 不改变任何 Issue 的 `backlog`、`running`、`review` 或 `completed` 状态
**And** 临时 Session 不参与 Completion Policy

## Epic 4: Review 循环、Issue Inspector 与异常 Session

用户可以手动将 running Issue 标记为 review，在 review 阶段继续让 Codex 修正，并通过 Session Header / Issue Inspector 管理关联 Issue；crashed 或 stopped Session 必须显式展示且不自动完成 Issue。

### Story 4.1: 在 Session Header 中手动 Mark Review

As a 本地开发者,
I want 手动把 running Issue 标记为待验收,
So that 我可以明确进入人工 review 阶段而不是让系统替我判断.

**Requirements:** FR17、FR6、NFR2、NFR3

**Acceptance Criteria:**

**Given** 当前 AgentSession 关联一个 `running` Issue
**When** Session Header 渲染
**Then** Header 显示 Issue title
**And** 主按钮显示 `Mark Review`

**Given** 用户点击 `Mark Review`
**When** Rust Core 校验 Issue 为 `running` 且存在关联 AgentSession
**Then** Issue 状态变为 `review`
**And** AgentSession 保持 `running`

**Given** Mark Review 成功
**When** 状态更新完成
**Then** 系统写入 IssueAction
**And** 前端通过 command 返回或 event 刷新 Header 与 Issues Activity

### Story 4.2: Review 阶段继续修正不退回 Running

As a 本地开发者,
I want 在 review 阶段继续向 Codex 输入修正要求,
So that 我可以在同一个 Session 中完成验收和返工循环.

**Requirements:** FR18、FR11、NFR2、NFR3

**Acceptance Criteria:**

**Given** Issue 状态为 `review` 且 AgentSession 为 `running`
**When** 用户打开 Codex Native Session View
**Then** xterm 仍然可输入
**And** 用户输入继续进入同一个 Codex PTY

**Given** 用户在 review 阶段继续交互
**When** Codex 产生输出或用户输入
**Then** Issue 状态仍为 `review`
**And** 不退回 `running`

**Given** review 阶段发生新的交互
**When** 系统记录日志和事件
**Then** 新内容写入同一个 AgentSession log
**And** 不创建新的 AgentSession

### Story 4.3: Issue Inspector 查看和编辑关联 Issue

As a 本地开发者,
I want 在 Agents Activity 中打开关联 Issue Inspector,
So that 我可以不中断 Codex Session 查看或编辑 Issue 内容.

**Requirements:** FR25、FR5、UX-DR12、UX-DR20、UX-DR24

**Acceptance Criteria:**

**Given** 当前 AgentSession 关联 Issue
**When** 用户点击 Session Header 中的 Issue title
**Then** 系统打开 Issue Inspector
**And** 不跳转路由，不需要返回按钮

**Given** Issue Inspector 打开
**When** 用户编辑 `title` 或 `description`
**Then** 系统保存变更
**And** 当前 Codex Native Session View 不卸载

**Given** Issue Inspector 已打开
**When** 用户按 `X`、`Esc`、再次点击 Issue title 或点击面板外
**Then** Inspector 关闭
**And** xterm 实例和 PTY Session 保持不变

### Story 4.4: 根据 Issue 状态展示 Header 操作

As a 本地开发者,
I want Session Header 只显示当前 Issue 状态允许的操作,
So that 我不会误触不该出现的 Run、Review 或 Completion 操作.

**Requirements:** FR25、FR17、FR18、FR23、UX-DR11、UX-DR17

**Acceptance Criteria:**

**Given** 当前 AgentSession 关联 `running` Issue
**When** Header 渲染
**Then** 主按钮为 `Mark Review`

**Given** 当前 AgentSession 关联 `review` Issue
**When** Header 渲染
**Then** Header 显示完成类按钮占位或入口
**And** 具体 completion 行为由 Epic 5 实现

**Given** 当前 AgentSession 不关联 Issue
**When** Header 渲染
**Then** 不显示 Issue title
**And** 不显示 `No linked issue` 或任何 Issue 操作

### Story 4.5: 处理 Codex 进程 crashed

As a 本地开发者,
I want Codex 异常退出时 Session 被明确标记为 crashed,
So that 我不会把失败的 Agent Session 误认为已完成.

**Requirements:** FR19、NFR6；UX-DR16

**Acceptance Criteria:**

**Given** Codex PTY 进程异常退出
**When** Rust Core 收到异常退出信息
**Then** AgentSession 状态变为 `crashed`
**And** 系统写入 SessionEvent

**Given** crashed AgentSession 关联 `running` 或 `review` Issue
**When** 状态更新完成
**Then** Issue 不自动变为 `completed`
**And** UI 显示明确 crashed 状态

**Given** Agents Activity 左侧列表渲染
**When** Session 状态为 `crashed`
**Then** Session 出现在 Completed 展示分组
**And** 标记 `crashed`，并提供日志入口或继续会话入口占位

### Story 4.6: 应用重启后标记不可恢复 Session

As a 本地开发者,
I want 应用重启后看到无法恢复的运行中 Session 被明确标记,
So that 我可以复盘异常而不是被误导为仍在运行.

**Requirements:** FR19、NFR6；UX-DR16；架构 Codex Session Resume Spike 降级路径

**Acceptance Criteria:**

**Given** 应用关闭前存在 `running` AgentSession
**When** 应用重启且无法恢复活 PTY 进程
**Then** Rust Core 将该 AgentSession 标记为 `stopped` 或 `crashed`
**And** 写入 SessionEvent 说明恢复失败原因

**Given** stopped/crashed AgentSession 关联 Issue
**When** 用户查看 Issues Activity 或 Agents Activity
**Then** 关联 Issue 不自动变为 `completed`
**And** UI 显示异常状态和日志入口

**Given** `stopped` 是否保留为正式状态仍是开放项
**When** 实现状态机
**Then** 必须在实现前选择 `stopped` 或统一用 `crashed`
**And** 选择结果应更新架构或 ADR

### Story 4.7: 异常 Session 的日志复盘入口

As a 本地开发者,
I want 对 crashed/stopped Session 打开日志,
So that 我可以判断 Agent 到底执行到了哪里.

**Requirements:** FR19、FR24、NFR6；UX-DR14、UX-DR16

**Acceptance Criteria:**

**Given** AgentSession 状态为 `crashed` 或 `stopped`
**When** 用户在 Session list 或 Header 选择打开日志
**Then** 系统通过记录的 `log_path` 打开或定位日志文件

**Given** 日志路径存在但文件不可访问
**When** 用户点击打开日志
**Then** UI 显示明确错误
**And** 保留原始 `log_path` 供 Diagnostics 查看

**Given** 异常 Session 仍关联 Issue
**When** 用户查看 Header 或 Inspector
**Then** 不显示会导致 completed 的完成确认
**And** 可提供继续会话入口占位，实际 resume 能力以后续 story 或 Spike 结果为准

## Epic 5: 完成策略、Agent Commit 与复盘

用户可以按 manual 或 agent_auto_commit 策略完成 Issue；系统记录 CompletionAttempt、检测 commit hash、避免误完成，并在 completed 后提供 Summary 和 Open Log。

### Story 5.1: 手动完成 Review Issue

As a 本地开发者,
I want 在 manual 策略下手动完成待验收 Issue,
So that 我可以明确结束一个已经人工确认的任务.

**Requirements:** FR20、FR23、FR6、NFR2、NFR3

**Acceptance Criteria:**

**Given** Issue 状态为 `review` 且 AgentSession 为 `running`
**When** Workspace 或 Global completion policy 生效值为 `manual`
**Then** Session Header 显示 `Complete Manually`

**Given** 用户点击 `Complete Manually` 并确认
**When** Rust Core 校验当前 Issue 和 AgentSession 状态
**Then** AgentSession 状态变为 `closed`
**And** Issue 状态变为 `completed`

**Given** 手动完成成功
**When** 状态更新完成
**Then** 系统写入 IssueAction 和 SessionEvent
**And** completed Issue 不再显示 Run、Mark Review 或完成类按钮

### Story 5.2: 无未提交改动时直接完成

As a 本地开发者,
I want 在 agent_auto_commit 策略下无改动时直接完成 Issue,
So that 没有 Git 变更的任务也能干净结束.

**Requirements:** FR20、FR22、FR23、NFR2、NFR3；架构 `completion_attempts` 表

**Acceptance Criteria:**

**Given** Issue 状态为 `review` 且 AgentSession 为 `running`
**When** completion policy 为 `agent_auto_commit` 且 Git status 无未提交改动
**Then** Session Header 显示 `Complete`

**Given** 用户点击 `Complete` 并确认
**When** Rust Core 再次检测 Git status 仍无未提交改动
**Then** Issue 状态变为 `completed`
**And** AgentSession 状态变为 `closed`

**Given** 完成动作成功
**When** 系统记录审计
**Then** 如 schema 尚未存在则通过 migration 创建 `completion_attempts` 表，并写入 IssueAction、SessionEvent 和 CompletionAttempt
**And** CompletionAttempt 记录 option、head_before、head_after、result

### Story 5.3: 展示 Agent Commit 完成确认面板

As a 本地开发者,
I want 在有未提交改动时确认是否让 Codex 提交并完成,
So that 我能在提交前看到 Git 摘要并避免误提交.

**Requirements:** FR21、FR22、NFR5、NFR6；UX-DR13；架构 Git Commit Detection Spike

**Acceptance Criteria:**

**Given** Issue 状态为 `review`、AgentSession 为 `running`、completion policy 为 `agent_auto_commit`
**When** Git status 存在未提交改动
**Then** Session Header 显示 `Complete with Agent Commit`

**Given** 用户点击 `Complete with Agent Commit`
**When** Rust Core 检测当前 Issue、AgentSession、Workspace、HEAD、Git status 和 changed files
**Then** 系统打开 Completion Confirmation
**And** 面板展示 Git 摘要、changed files 数量、当前 HEAD 和完成选项

**Given** Completion Confirmation 打开
**When** 用户查看 completion prompt
**Then** completion prompt 默认隐藏
**And** 用户可以展开查看完整 prompt

### Story 5.4: 向当前 Codex Session 注入 Completion Prompt

As a 本地开发者,
I want 让当前 Codex Session 只提交本 Issue 相关改动,
So that 完成动作保留上下文并避免应用直接执行 Git 提交.

**Requirements:** FR21、FR22、NFR5；架构 completion prompt 注入

**Acceptance Criteria:**

**Given** Completion Confirmation 已打开
**When** 用户确认 Agent Commit
**Then** Rust Core 将 completion prompt 发送给当前 Codex PTY
**And** 不启动新的无上下文 Codex 进程

**Given** completion prompt 已发送
**When** 系统记录事件
**Then** 写入 SessionEvent
**And** CompletionAttempt 记录 `head_before`、`changed_files_json`、`option=agent_auto_commit`

**Given** 应用执行 Agent Commit 流程
**When** 检查实现行为
**Then** 应用层不得直接执行 `git add .` 或自行提交全部改动
**And** 只能通过 Codex Session 和后续 Git 检测验证结果

### Story 5.5: 检测 Commit Hash 并完成 Issue

As a 本地开发者,
I want 系统在 Agent Commit 后检测真实 Git commit,
So that completed 状态有可信 commit hash 支撑.

**Requirements:** FR21、FR22、FR20、NFR3、NFR5；架构 Git HEAD/status 检测

**Acceptance Criteria:**

**Given** completion prompt 已发送给 Codex
**When** 系统检测到 Git `HEAD` 相比 `head_before` 发生变化
**Then** CompletionAttempt 记录 `head_after` 和 `commit_hash`
**And** result 标记为成功

**Given** 新 commit 已检测到
**When** Rust Core 完成状态更新
**Then** AgentSession 状态变为 `closed`
**And** Issue 状态变为 `completed`

**Given** Issue 完成成功
**When** 审计记录写入
**Then** IssueAction、SessionEvent、CompletionAttempt 均可复盘
**And** Header 不再显示完成类主按钮

### Story 5.6: 未检测到 Commit 时保持 Review

As a 本地开发者,
I want Agent Commit 没有产生 commit 时 Issue 保持待验收,
So that 系统不会把失败或不完整结果伪装成完成.

**Requirements:** FR21、FR22、NFR6；UX-DR13

**Acceptance Criteria:**

**Given** 用户选择 Agent Commit
**When** completion 后 `HEAD` 未改变
**Then** Issue 保持 `review`
**And** AgentSession 保持可继续处理的状态

**Given** 未检测到新 commit
**When** 系统写入 CompletionAttempt
**Then** result 记录为 `no_commit_detected`
**And** `commit_hash` 为空或 null

**Given** UI 展示结果
**When** 用户返回 Completion Confirmation 或 Header
**Then** 显示事实性提示：未检测到 commit，Issue 保持待验收
**And** 不自动 completed

### Story 5.7: 阻止 Git 操作进行中状态下自动完成

As a 本地开发者,
I want merge/rebase/cherry-pick 进行中时系统不要自动完成 Issue,
So that Git 仓库不会在复杂状态下被错误处理.

**Requirements:** FR22、NFR5、NFR6、NFR10

**Acceptance Criteria:**

**Given** Issue 处于 `review`
**When** 用户尝试完成 Issue
**Then** Rust Core 检测 Git operation state
**And** 能识别 merge、rebase、cherry-pick 等进行中状态

**Given** Git operation 正在进行
**When** 用户选择 `Complete` 或 `Complete with Agent Commit`
**Then** 系统阻止自动完成
**And** 提示用户手动处理 Git 状态

**Given** 完成被阻止
**When** 系统记录 CompletionAttempt
**Then** result 记录失败或 blocked 原因
**And** Issue 保持 `review`

### Story 5.8: 查看 Completed Issue Summary

As a 本地开发者,
I want 查看 completed Issue 的 Summary,
So that 我能复盘 Agent 做过什么、是否提交、日志在哪里.

**Requirements:** FR24、FR23、NFR3、NFR6；UX-DR14、UX-DR17

**Acceptance Criteria:**

**Given** Issue 状态为 `completed`
**When** 用户打开 Issue Detail、Header 或 Inspector 中的 `View Summary`
**Then** 系统展示 Summary
**And** Summary 至少包含 Issue 信息、Agent Session 时间、Agent Session 状态、CompletionAttempt 结果、commit hash 和日志路径

**Given** completed Issue 有 commit hash
**When** Summary 展示
**Then** commit hash 可见
**And** 若没有 commit hash，Summary 明确显示本次完成未产生提交或无提交完成

**Given** completed Issue 存在状态不一致
**When** Summary 展示
**Then** 系统展示诊断信息
**And** 不自动修复状态

### Story 5.9: 打开 Completed Issue 日志

As a 本地开发者,
I want 从 completed Issue 打开原始日志,
So that 我可以查看 Agent Session 的完整输出.

**Requirements:** FR24、FR23、NFR4、NFR6；UX-DR14、UX-DR17

**Acceptance Criteria:**

**Given** completed Issue 关联 AgentSession 且存在 `log_path`
**When** 用户点击 `Open Log`
**Then** 系统打开或定位原始日志文件
**And** 不在 SQLite 中读取逐字符终端输出

**Given** 日志路径缺失或文件不存在
**When** 用户点击 `Open Log`
**Then** UI 显示明确错误
**And** 保留日志路径或缺失原因供 Diagnostics 查看

**Given** Issue 已 completed
**When** 用户查看可用操作
**Then** 不显示 `Run`、`Mark Review`、`Complete Manually`、`Complete with Agent Commit`
**And** MVP 不提供 `Reopen`

### Story 5.10: 完成闭环端到端验收

As a RedWhisk 产品验证者,
I want 连续验证从 Issue 到 Agent Session 完成的本地闭环,
So that MVP 的核心信任链路可演示.

**Requirements:** FR1-FR24、FR26、NFR2、NFR3、NFR5、NFR6；UX-DR27、UX-DR28；核心端到端验收

**Acceptance Criteria:**

**Given** 一个本地 Git Repository Workspace
**When** 验证者连续执行 5 次 Workspace、Issue、Run、Codex 交互、Mark Review、completed 流程
**Then** 不出现 Issue 状态与 AgentSession 状态不一致导致无法继续的情况
**And** 每次完成均可找到 IssueAction 和 SessionEvent

**Given** 流程包含 Agent Commit 尝试
**When** 完成动作结束
**Then** 每次尝试均可找到 CompletionAttempt
**And** CompletionAttempt 包含完成前后 HEAD、结果和 commit hash 或失败原因

**Given** 验证包含故意 command 失败路径
**When** command 启动失败
**Then** Issue 保持 `backlog`
**And** 显示失败原因，不创建有效 AgentSession
**And** 核心流程不依赖 Command Palette 或未确认快捷键；如需要视觉校准，优先覆盖 Issues Activity、Agents Activity with linked Issue、Run Dialog、Completion Confirmation
