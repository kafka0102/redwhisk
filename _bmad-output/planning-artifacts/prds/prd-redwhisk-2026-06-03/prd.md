---
title: RedWhisk 跨平台 Agent 开发工作台 MVP PRD
status: final
created: 2026-06-03
updated: 2026-06-03
---

# PRD：RedWhisk 跨平台 Agent 开发工作台 MVP

## 0. 文档目的

本文档用于把 2026-06-02 至 2026-06-03 头脑风暴中已确认的 MVP scope freeze 固化为可交给 UX、架构和故事拆分使用的产品需求。PRD 主体只描述用户可感知行为、状态边界、验收条件、非目标、成功指标和开放问题；技术模块边界、数据表草案、Spike 和开发里程碑放在同目录 `addendum.md`。所有未由输入文档直接确认的内容以 `[ASSUMPTION]` 标记，并在文末索引。

## 1. 愿景

RedWhisk 是一个以 Git 仓库 Project 为入口的跨平台桌面 Agent 开发工作台。[ASSUMPTION: 产品名沿用当前项目名 RedWhisk。] 它不试图成为另一个完整 AI 编辑器，也不把看板做成独立项目管理工具；它把本地 Issue、Codex Agent Session、内嵌终端、验收状态、完成策略和审计记录放进同一个 VS Code 形态的工作台。

MVP 的核心赌注是：AI 编程任务不是一次聊天，而是一段可管理、可暂停关注、可验收、可追溯的本地开发工作流。用户从一个本地 Issue 出发，选择 Codex Agent，确认最终 prompt，在内嵌 Codex Native Session View 中交互，手动进入 review，必要时继续修正，最后通过手动完成或 Agent Commit 完成 Issue。

第一阶段只验证本地闭环。GitHub/GitLab、云协作、插件系统、完整代码浏览、完整 Diff、Git 历史和 Worktree 自动化都不进入 MVP。这个范围冻结是本文档的约束，不在 PRD 中扩大。

## 2. 目标用户

### 2.1 Jobs To Be Done

- 当我同时处理多个 AI Coding 任务时，我希望每个任务都有清晰 Issue、Session、状态和日志，而不是散落在终端窗口和聊天历史里。
- 当我把任务交给 Codex 时，我希望保留接近原生 CLI 的交互体验，同时获得工作台级别的状态提醒、验收入口和完成审计。
- 当 Agent 产出结果后，我希望能先验收、继续修正，再明确完成，而不是让工具替我误判任务已经结束。
- 当任务完成时，我希望知道是否产生了 commit、commit hash 是什么、日志在哪里，以及哪些状态变化发生过。
- 当我重新打开应用时，我希望能恢复 Project、Issue、Session 元数据和日志索引，继续复盘或处理异常状态。

### 2.2 非目标用户（MVP）

- 需要多人 SaaS 协作、权限管理、云端同步或组织级审计的团队。
- 需要完整 IDE 编辑能力、语言服务、调试器、代码浏览和 Git GUI 的用户。
- 需要 Jira、Linear 等完整项目管理字段和流程的团队。
- 需要同时运行多种 Agent、多 Session Attempt 或复杂 Worktree 编排的高级团队场景。

### 2.3 关键用户旅程

- **UJ-1. 林航从本地 Issue 跑起一次 Codex 任务并完成验收。**
  林航是独立开发者，正在一个本地 Git 仓库里修复功能问题。他打开 RedWhisk，首先看到本机已保存 Project 的卡片列表，最后一个卡片是 `+` 创建 Project 入口。他点击已有 Project 卡片，或通过 `+` 选择该仓库创建 Project 后，才进入带 Activity Bar 的 Project 工作台，并在 Issues Activity 创建一个 backlog Issue。林航点击 `Run`，选择 Codex Agent Profile，在 Run Dialog 中检查并编辑最终 prompt。Codex 进程成功启动后，Issue 进入 `running`，Agents Activity 打开关联 Agent Session。林航在 Codex Native Session View 中交互，认为结果可验收后点击 `Mark Review`。他检查结果并点击完成；系统关闭 Session，Issue 进入 `completed`，并保留摘要和日志。

- **UJ-2. 周宁为不同仓库复用同一个 Codex Agent 配置。**
  周宁是 AI Coding 重度用户，多个仓库都使用本机 Codex CLI。她在全局设置中创建 Codex Agent Profile，系统通过 login shell 检测 `codex` 命令；某个仓库需要额外默认 skill，于是她在 Project 级覆盖 `default_skill` 和 `prompt_template`。以后从该 Project 的 Issue 运行 Agent 时，Run Dialog 使用覆盖后的生效配置，并展示 prompt 来源。

- **UJ-3. 陈悦在 review 阶段继续让 Codex 修正。**
  陈悦把一个 Issue 标记为 `review` 后发现验收失败。她不希望重新创建 Session，也不希望 Issue 状态来回切换。她继续在当前 Codex Native Session View 中输入修正要求，Issue 保持 `review`，Agent Session 仍为 `running`。修正完成后，她再次验收并执行完成动作。

- **UJ-4. 马骁复盘已完成任务和异常 Session。**
  马骁第二天重新打开应用，Project Home 展示本机已保存 Project 卡片，并按最近打开时间优先排序。他点击目标 Project 后进入 Issues Activity，打开一个 completed Issue，查看 Summary、commit hash、Session 时间和日志路径。另一个曾经运行中的 Session 因应用重启被标记为 `crashed` 或 `stopped`；系统不把它伪装成 completed，而是保留日志和诊断信息。

- **UJ-5. 何岚在当前仓库里启动一个不关联 Issue 的临时 Codex Session。**
  何岚在当前 Project 中想临时问 Codex 一个问题，但这个操作还不值得创建 Issue。她进入 Agents Activity，点击左侧 Session 列表顶部的新建按钮，打开 Session Dialog。她确认默认标题、选择 Agent Profile、填写初始 prompt 并点击 `Start`。进程成功启动后，这个临时 Agent Session 出现在 Running 分组；它不触发任何 Issue 状态变化，也不参与 Completion Policy。

## 3. 术语表

- **Project Home** — RedWhisk 打开后的首屏。展示本机已保存 Project 卡片，最后一个卡片是 `+` 创建 Project 入口；未选择 Project 时不显示 Activity Bar。
- **Activity Bar** — Project 内工作台左侧一级导航。MVP 只包含 `Issues`、`Agents`、`Settings`，其中 `Settings` 指当前 Project Settings。
- **Project** — RedWhisk 中的项目入口。MVP 中一个 Project 必须绑定一个本地 Git Repository。
- **Git Repository** — 用户选择的本地 Git 仓库目录。非 Git 目录不能创建 Project。
- **Issues Activity** — 展示本地 Issue 四泳道看板和 Issue 详情入口的一级页面。
- **Agents Activity** — 展示 Agent Session 列表和当前 Codex Native Session View 的一级页面。
- **Project Settings** — 当前 Project 的设置入口，位于 Activity Bar 中，只影响当前 Project。
- **Global Settings** — 全局应用设置，在 Project Home 通过原生顶部菜单打开；进入 Project 工作台后也可通过左下角 gear 打开，不属于 Activity Bar 主入口。
- **Issue** — Project 内的本地任务实体。MVP 只包含 `title`、`description`、`status`、`created_at`、`updated_at` 等极简字段。
- **Issue 状态** — Issue 的业务阶段，取值为 `backlog`、`running`、`review`、`completed`。
- **Agent Profile** — 用户配置的本地 Agent 启动配置，包括名称、Agent 类型、command、默认参数、默认 skill、prompt 模板和 enabled 状态。
- **ProjectAgentOverride** — Project 对 Agent Profile 的覆盖配置，可覆盖默认参数、默认 skill、prompt 模板和 enabled 状态。
- **Run Dialog** — 从 Issue 启动 Agent 前的确认界面，展示生效 Agent Profile、prompt 来源和可编辑最终 prompt。
- **Session Dialog** — 在 Agents Activity 中创建不关联 Issue 的临时 Agent Session 的轻量弹窗。
- **Agent Session** — 一次本地 Agent 执行上下文。Agent Session 可以关联 Issue，也可以是不关联 Issue 的临时 Session；MVP 中一个 Issue 最多关联一个 Agent Session。
- **Agent Session 状态** — Agent Session 的进程/会话状态，取值为 `running`、`closed`、`crashed`、`stopped`。`crashed` 表示 Codex 进程异常退出；`stopped` 表示应用生命周期中断后原 `running` PTY 无法恢复。
- **Session 展示分组** — Agents Activity 左侧列表的展示分组，MVP 固定提供 `Running` 和 `Completed`。`Running` 展示 `status=running` 的 Agent Session；`Completed` 展示 `status=closed`、`crashed` 或 `stopped` 的最近 Agent Session。
- **Codex Native Session View** — 通过内嵌 PTY 和 xterm.js 呈现的 Codex CLI 原生交互视图。
- **PTY** — 伪终端，用于让 GUI 应用内的 xterm.js 与本地 Codex CLI 交互。
- **attention** — Agent Session 的关注标记，取值为 `none` 或 `requested`。它不属于 Agent Session 主状态。
- **Needs Attention** — UI 对 `attention=requested` 的展示，用于提醒用户回到 Agent Session。
- **Session Header** — Agents Activity 右侧工作区顶部区域。仅当当前 Agent Session 关联 Issue 时展示 Issue 标题和 Issue 操作。
- **Issue Inspector** — 在 Agents Activity 中点击关联 Issue 标题后打开的详情面板，不改变路由，不卸载 xterm。
- **SessionEvent** — Agent Session 的关键事件记录，例如启动、退出、attention 变化、completion prompt 发送和日志路径。
- **IssueAction** — Issue 状态变化和用户动作审计记录。
- **Completion Policy** — Issue 完成策略，取值为 `manual` 或 `agent_auto_commit`。
- **CompletionAttempt** — 每次完成尝试的结构化审计记录，包括完成前后 HEAD、changed files 摘要、用户选择、commit hash、结果和失败原因。

## 4. 产品形态与信息架构

MVP 是桌面应用，目标形态为 VS Code 式一窗口工作台。应用打开后先进入 Project Home：页面展示本机已保存 Project 的卡片列表，最后一个卡片是 `+` 创建 Project 入口。用户点击某个 Project 卡片后，才进入该 Project 的工作台并显示左侧 Activity Bar。Activity Bar 只包含 `Issues`、`Agents`、`Settings` 三个一级入口；`Settings` 是当前 Project Settings。全局应用设置通过原生顶部菜单打开；进入 Project 工作台后也可以通过左下角 gear 打开，不作为 Activity Bar 一级入口。

Issues Activity 使用四个常驻泳道：`Backlog`、`Running`、`Review`、`Completed`。Issue 卡片字段保持极简，只展示 `title`、`status`、`updated_at`，以及可选 Agent Session 标记和 attention 标记。点击 Issue 卡片打开 Issue 详情弹窗。

Agents Activity 采用左右两栏。左侧是 Agent Session 列表，默认按 `Running` / `Completed` 展示；左侧顶部提供展示形态 icon 和新建临时 Agent Session 的小按钮。右侧展示当前选中的 Codex Native Session View。若当前 Agent Session 关联 Issue，右侧 Session Header 展示 Issue 标题和 Issue 操作；若不关联 Issue，Header 不显示 Issue 区域，也不显示 `No linked issue`。未来可以扩展 changed files 或 Diff 信息，但不进入 MVP 主路径。

应用 UI 支持 `zh-CN` 和 `en-US`，UI language 属于 Global Settings。

## 5. 功能需求

### 5.1 Project 与本地恢复

**描述：** 用户必须从本地 Git Repository 创建 Project。Project 是 Issue、Agent Session、Completion Policy 和日志索引的边界。实现 UJ-1、UJ-4。

#### FR-1：创建 Git Project

用户可以选择本地目录创建 Project；系统必须校验该目录是 Git Repository。

**可测试结果：**
- 用户点击 Project Home 的 `+` 卡片后可以选择 Git Repository。
- 选择 Git Repository 时，系统创建 Project 并保存 `project_id`、`name`、`repo_path`、`created_at`、`last_opened_at`。
- 选择非 Git 目录时，系统拒绝创建 Project，并展示明确错误。
- 创建成功后，应用进入该 Project 工作台的 Issues Activity，并显示 Activity Bar。

#### FR-2：展示本地 Project 列表并打开选中 Project

用户重新打开应用时，先看到本机已保存 Project 的卡片列表，并可以选择要进入的 Project。

**可测试结果：**
- Project Home 展示本机所有已保存 Project 卡片，按 `last_opened_at` 优先排序。
- Project Home 最后一个卡片固定为 `+` 创建 Project 入口。
- 用户点击某个 Project 卡片后，系统更新并持久化该 Project 的 `last_opened_at`，再进入该 Project 的 Issues Activity。
- 未选择 Project 前不显示 Activity Bar。
- 若 `repo_path` 不存在或不可访问，Project 卡片展示明确错误状态；用户点击该卡片时系统展示错误，不删除 Project 记录。

#### FR-3：提供 Project Settings 与 Global Settings

系统必须区分当前 Project Settings 和全局应用级 Global Settings。

**可测试结果：**
- Project Settings 位于 Activity Bar 的 `Settings`，只影响当前 Project。
- Project Settings 至少包含 Project 名称、`repo_path`、Project 级 `completion_policy`、默认 Agent Profile、ProjectAgentOverride、项目级 instructions、日志和 Agent Session 存储信息。
- Global Settings 在 Project Home 中通过原生顶部菜单打开；进入 Project 工作台后也可通过左下角 gear 打开。
- Global Settings 至少包含 UI language、全局 Agent Profiles、全局默认 `completion_policy`、全局数据目录、全局日志目录、About 和 Diagnostics。
- Project Settings 通过 `Inherit global default` 或 `Override for this project` 与 Global Settings 连接。
- `completion_policy` 只能是 `manual` 或 `agent_auto_commit`。
- [ASSUMPTION: 新 Project 的默认 Completion Policy 为 `manual`，降低误提交风险。]

### 5.2 本地 Issue 管理

**描述：** Issue 是驱动 Agent 工作流的源头。MVP 保持 Issue 字段极简，不复刻 Jira、Linear 或完整看板系统。实现 UJ-1。

#### FR-4：创建和编辑 Issue

用户可以在 Project 内创建和编辑本地 Issue。

**可测试结果：**
- Issue 至少保存 `title`、`description`、`status`、`created_at`、`updated_at`。
- 新 Issue 默认状态为 `backlog`。
- 用户可以在 Issue 详情弹窗中编辑 `title` 和 `description`。
- MVP 不提供 priority、label、assignee、milestone。

#### FR-5：展示 Issue 详情弹窗

用户点击 Issue 卡片后，系统打开 Issue 详情弹窗。

**可测试结果：**
- Issue 详情弹窗采用左右两栏布局。
- 左侧主要区域展示 `title` 和 `description`，两者均可随时编辑并保存至数据库。
- 右侧辅助区域展示 Session 关联区和当前 Issue 可执行操作按钮。
- Issue 详情弹窗不展示 `status` 字段，不展示 `updated_at` 字段。
- `backlog` 且无 Agent Session 的 Issue 显示 `Run`。
- `running` 或 `review` 且有关联 Agent Session 的 Issue 显示 `Open Session`。
- `completed` Issue 不显示 `Run`、`Mark Review` 或完成类按钮。
- MVP 不在 Issue 详情弹窗展示完整日志、完整 Diff 或 Git 历史。

#### FR-6：记录 IssueAction

所有改变 Issue 状态的动作必须写入 IssueAction。

**可测试结果：**
- 创建 Issue、启动 Agent 成功、标记 review、完成 Issue 都生成 IssueAction。
- IssueAction 至少包含 `issue_id`、`action_type`、`payload_json`、`created_at`。
- 启动失败不得把 Issue 改为 `running`，但可以记录失败原因。

### 5.3 Agent Profile 与 prompt 编排

**描述：** MVP 首个 Agent 是 Codex，但 Run 流程不能把 Codex 写死在 UI 命令里。用户通过 Agent Profile 管理本地 Agent 配置，并在启动前确认最终 prompt。实现 UJ-2。

#### FR-7：检测 Codex command

系统可以检测本机 `codex` 命令，并允许手动路径兜底。

**可测试结果：**
- 创建 Codex Agent Profile 时，系统通过用户 login shell 执行 `command -v codex`。
- 检测失败时，用户可以手动填写 command path 并运行 Test。
- command 不可执行时，系统不得保存 enabled Agent Profile。

#### FR-8：保存 Agent Profile 与 ProjectAgentOverride

用户可以创建全局 Agent Profile，并为 Project 设置覆盖项。

**可测试结果：**
- Agent Profile 至少保存 `name`、`agent_type`、`command`、`default_args`、`default_skill`、`prompt_template`、`enabled`。
- ProjectAgentOverride 可以覆盖 `default_args`、`default_skill`、`prompt_template`、`enabled`。
- Run Dialog 使用覆盖后的生效配置。
- 配置来源和 command 可用性属于 Settings / Agent Profile 配置层，不进入 Run Dialog。

#### FR-9：生成并确认最终 prompt

用户从 Issue 点击 `Run` 后，Run Dialog 必须展示可编辑最终 prompt。

**可测试结果：**
- 最终 prompt 由 Issue、Project、Agent Profile、ProjectAgentOverride、默认 skill、prompt 模板和应用补充说明组成。
- Run Dialog 显示最终 prompt，默认可编辑。
- Run Dialog 可以折叠查看 prompt 来源，例如 Issue description、default skill、prompt template、app instructions。
- Run Dialog 显示 Agent Profile 选择、working directory、default args、`Cancel` 和 `Start`。
- Run Dialog 不展示 command 是否可用，不展示配置继承或覆盖来源。
- 默认 prompt 不包含 Issue `title`；只有 `prompt_template` 显式引用 `{{issue.title}}` 时，Issue `title` 才进入 prompt。
- 用户确认后，系统保存最终 prompt 快照。

### 5.4 从 Issue 启动 Agent Session

**描述：** Agent Session 的创建和 Issue 状态变化必须以本地进程成功启动为前提。实现 UJ-1。

#### FR-10：成功启动后才进入 running

用户确认 Run Dialog 后，系统尝试启动 Agent 进程；只有进程成功启动后，才创建或激活 Agent Session，并将 Issue 改为 `running`。

**可测试结果：**
- 启动成功时，系统创建 Agent Session、写入 SessionEvent，并将 Issue 状态改为 `running`。
- 启动失败时，Issue 保持 `backlog`。
- 启动失败原因展示在 Run Dialog 中，并可写入 IssueAction 或 SessionEvent。

#### FR-11：保存 Agent Session 快照和日志索引

系统必须保存 Agent Session 的关键元数据和日志文件路径。

**可测试结果：**
- Agent Session 至少保存 `issue_id`、`agent_profile_id`、`codex_session_id`、`status`、`attention`、`working_dir`、`command_snapshot`、`prompt_snapshot`、`log_path`、`started_at`。
- 高频终端输出写入日志文件，不逐字符写入 SQLite。
- SQLite 保存关键 SessionEvent 和日志路径。

#### FR-12：限制一 Issue 一 Agent Session

MVP 中一个 Issue 最多关联一个 Agent Session。

**可测试结果：**
- 已有关联 Agent Session 的 Issue 不允许创建第二个并列 Agent Session。
- 若 Agent Session 异常退出，系统优先提供 resume 或日志复盘路径，而不是新建 Attempt。
- 多 Session Attempt 不进入 MVP。

### 5.5 Codex Native Session View

**描述：** RedWhisk 在 Agent 工作区中保留接近 Codex CLI 原生体验的内嵌终端。应用做容器和状态外壳，不重做 Codex 聊天 UI。实现 UJ-1、UJ-3。

#### FR-13：提供 Agents Activity 左右两栏工作区

Agents Activity 必须展示 Agent Session 列表和当前 Codex Native Session View。

**可测试结果：**
- 左侧栏展示当前 Project 的最近 Agent Session。
- 左侧栏默认按 `Running` 和 `Completed` 分组展示。
- `Running` 分组按 `last_active_at` 排序，最近有输出或用户输入的 Agent Session 在上。
- `Completed` 分组展示 `closed`、`crashed` 或 `stopped` Agent Session，按最近完成或结束时间排序，默认只展示最近 20 条 Agent Session。
- 左侧栏顶部提供展示形态 icon，并提供新建不关联 Issue 的临时 Agent Session 按钮。
- 左侧 Agent Session 列表项展示 Issue title 或临时 Session title、Agent 类型和运行状态。
- 右侧展示当前选中的 Codex Native Session View。
- Session 与 `review` 无关；`review` 是 Issue 状态，不是 Agent Session 状态或 Agent Session 分组。

#### FR-14：通过内嵌 PTY 运行 Codex

系统必须通过内嵌 PTY 和 xterm.js 运行 Codex CLI。

**可测试结果：**
- 用户输入直接进入 Codex TUI，不额外实现独立聊天输入框。
- 右侧工作区能显示 Codex TUI 的主要界面、颜色和交互。
- Enter、方向键、Ctrl+C、粘贴和 resize 在 Spike 验收中可用。
- Codex 退出时，系统能获得进程退出信息并记录 SessionEvent。

#### FR-15：展示 Needs Attention

系统必须支持对运行中的 Agent Session 标记用户关注需求。

**可测试结果：**
- Agent Session 主状态保持 `running`，等待用户输入不改变主状态。
- `attention` 只取 `none` 或 `requested`。
- Issues Activity 和 Agents Activity 能展示 Needs Attention。
- MVP 可以通过手动标记和启发式输出识别设置 `attention=requested`。

#### FR-16：创建不关联 Issue 的临时 Agent Session

用户可以在 Agents Activity 中创建不关联 Issue 的临时 Agent Session。实现 UJ-5。

**可测试结果：**
- 点击 Agents 左侧栏顶部的新建按钮后，系统打开 Session Dialog，而不是直接创建 Agent Session。
- Session Dialog 字段保持极简，只包含 `title`、`agent_profile`、`prompt`、`Cancel` 和 `Start`。
- `title` 默认生成，例如 `Untitled Session`，用户可修改。
- Session Dialog 不展示 `working_directory`，默认使用当前 Project `repo_path`。
- Session Dialog 不展示 command 是否可用，不展示配置来源或继承/覆盖关系。
- 点击 `Start` 后，只有 Rust Core 成功启动 Agent 进程，才创建 Agent Session 并加入左侧列表。
- 启动失败时不创建 Agent Session，Session Dialog 显示错误。
- 不关联 Issue 的 Agent Session 不触发 Issue 状态流转，不参与 Completion Policy。

### 5.6 Review 循环

**描述：** Issue 的验收阶段与 Agent Session 的进程状态分离。用户手动判断何时进入 review，review 阶段仍可继续让 Codex 修正。实现 UJ-3。

#### FR-17：手动 Mark Review

用户可以手动将 `running` Issue 标记为 `review`。

**可测试结果：**
- 只有 `running` Issue 且存在关联 Agent Session 时显示 `Mark Review`。
- 在 Agents Activity 中，`Mark Review` 显示在右侧 Session Header 上。
- 点击 `Mark Review` 后，Issue 状态变为 `review`。
- Agent Session 保持 `running`，Codex 进程不关闭。
- 系统写入 IssueAction。

#### FR-18：review 阶段继续修正

用户在 `review` Issue 中继续向 Codex 输入修正需求时，Issue 不退回 `running`。

**可测试结果：**
- `review` Issue 仍可打开当前 Codex Native Session View。
- 用户继续交互后，Issue 状态仍为 `review`。
- 右侧 Session Header 仍显示完成类按钮。
- 修正交互继续写入同一个 Agent Session 日志和事件流。

#### FR-19：处理 crashed 或 stopped Agent Session

系统必须显式展示异常 Agent Session，而不是把异常伪装成完成。

**可测试结果：**
- Codex 进程异常退出时，Agent Session 进入 `crashed`。
- 应用重启后无法恢复活进程时，Agent Session 必须标记为 `stopped`；`stopped` 表示应用生命周期中断导致原 `running` PTY 无法恢复。
- `running` 或 `review` Issue 关联异常 Agent Session 时，系统默认提供日志复盘或诊断入口；`Resume Session` 入口只有在 Codex resume 能力由 Spike 或后续 story 明确实现后才显示。
- `crashed` Agent Session 不会让 Issue 自动进入 `completed`。

### 5.7 Completion Policy 与完成闭环

**描述：** Issue 完成必须由用户确认触发。`agent_auto_commit` 不是应用直接执行 `git add .`，而是应用整理上下文并把 completion prompt 发送给当前 Codex Agent Session，再由应用检测 Git 状态和 commit hash。实现 UJ-1、UJ-3。

#### FR-20：手动完成或无提交完成

用户可以在 `manual` 策略下手动完成 Issue，也可以在 `agent_auto_commit` 且无未提交改动时直接完成。

**可测试结果：**
- `completion_policy=manual` 时，`review` Issue 显示 `Complete Manually`。
- `agent_auto_commit` 且无未提交改动时，`review` Issue 显示 `Complete`。
- 用户确认后，系统关闭 Agent Session，将 Agent Session 标记为 `closed`，并将 Issue 标记为 `completed`。
- 完成动作写入 IssueAction。

#### FR-21：Agent Commit 完成

用户可以在 `agent_auto_commit` 策略下让当前 Codex 只提交本 Issue 相关改动并完成 Issue。

**可测试结果：**
- 仅当 Issue 为 `review`、Agent Session 为 `running`、`completion_policy=agent_auto_commit` 且存在未提交改动时显示 `Complete with Agent Commit`。
- 点击后，系统检测当前 Issue、Agent Session、Project、Git status、HEAD、changed files 和策略配置。
- 系统弹出轻量确认面板，默认隐藏 completion prompt，但允许展开查看。
- 用户确认后，系统把 completion prompt 发送给当前 Codex Agent Session。
- 检测到新 commit 后，系统记录 commit hash，关闭 Agent Session，并将 Issue 标记为 `completed`。
- 未检测到新 commit 时，Issue 保持 `review` 并提示用户处理。

#### FR-22：记录 CompletionAttempt

每次完成尝试必须写入 CompletionAttempt。

**可测试结果：**
- CompletionAttempt 至少记录 `issue_id`、`session_id`、`option`、`head_before`、`head_after`、`changed_files_json`、`commit_hash`、`result`、`error`、`created_at`。
- 若 `HEAD` 未改变且用户选择 Agent Commit，CompletionAttempt 记录 `no_commit_detected`。
- 若出现 merge、rebase、cherry-pick 等进行中状态，MVP 提示用户手动处理，不自动完成。

### 5.8 Completed 摘要和日志复盘

**描述：** completed Issue 不可重新运行，但必须可复盘。实现 UJ-4。

#### FR-23：限制 completed Issue 操作

completed Issue 不提供重新打开或重新运行能力。

**可测试结果：**
- completed Issue 不显示 `Run`、`Mark Review`、`Complete Manually`、`Complete with Agent Commit`。
- MVP 不实现 `Reopen`。
- 状态不一致时，系统展示诊断信息，不自动修复。

#### FR-24：查看 Summary 和日志

用户可以查看 completed Issue 的摘要和日志。

**可测试结果：**
- Summary 至少展示 Issue 信息、Agent Session 时间、Agent Session 状态、CompletionAttempt 结果、commit hash 和日志路径。
- `Open Log` 能打开或定位原始日志文件。
- 日志路径缺失或文件不存在时，系统展示明确错误。

### 5.9 Issue Inspector 与 Header 操作

**描述：** Agents Activity 的右侧 Header 只承载关联 Issue 的上下文和操作；Issue 详情通过 Inspector 展示，不改变当前 Codex Session。实现 UJ-1、UJ-3、UJ-4。

#### FR-25：展示 Session Header 和 Issue Inspector

系统必须在当前 Agent Session 关联 Issue 时展示 Issue 上下文，并支持打开 Issue Inspector。

**可测试结果：**
- 当前 Agent Session 关联 Issue 时，右侧 Session Header 显示 Issue 标题。
- 当前 Agent Session 不关联 Issue 时，Header 不显示 Issue 标题，不显示 `No linked issue`，也不显示 Issue 操作。
- `running` Issue 的 Header 主按钮为 `Mark Review`。
- `review` Issue 的 Header 主按钮根据 Completion Policy 显示 `Complete with Agent Commit` 或 `Complete Manually`。
- `completed` Issue 的 Header 不显示完成类主按钮，可显示 `View Summary`、`Open Log` 或打开 Issue Inspector。
- 点击 Issue 标题打开 Issue Inspector，不跳转页面，不需要返回按钮。
- Issue Inspector 可通过 `X`、`Esc`、再次点击 Issue 标题或点击面板外关闭。
- 打开和关闭 Issue Inspector 不影响当前 Codex Native Session View，不卸载 xterm。
- Issue Inspector 可编辑 `title` 和 `description`，并展示 Session 关联区和操作区。

### 5.10 基础国际化

**描述：** MVP 从一开始建立 `zh-CN` 与 `en-US` 文案约束，避免后续大规模替换硬编码文案。

#### FR-26：提供核心状态和命令文案

系统必须为核心状态和命令提供 `zh-CN` 与 `en-US` 文案。

**可测试结果：**
- Issue 状态文案包含：`backlog=待办`、`running=运行中`、`review=待验收`、`completed=已完成`。
- 核心命令文案包含：`运行`、`打开会话`、`标记待验收`、`继续会话`、`手动完成`、`Agent 提交并完成`、`不提交直接完成`、`查看总结`、`打开日志`、`配置 Agent`。
- UI 命令语义不把 Codex 写死为唯一 Agent 名称。

## 6. 跨功能 NFR

- **本地优先与隐私：** MVP 不需要用户登录，不上传 Issue、prompt、日志、Git 状态或代码内容。所有核心数据保存在本机。
- **状态可靠性：** Issue 状态和 Agent Session 状态的改变必须由 Rust Core 或等价核心层完成；前端不得单独把核心状态写为 `running`、`review`、`completed`、`closed`。
- **审计性：** 所有状态变化、完成尝试和 Agent Session 关键事件必须能在 SQLite 结构化记录或日志文件中复盘。
- **终端性能：** 原始终端输出写入日志文件，SQLite 只保存关键事件和摘要，避免高频输出拖垮数据库。
- **完成安全：** 应用不得默认执行 `git add .` 或自行提交全部改动。Agent Commit 只能通过向当前 Codex Agent Session 注入 completion prompt，并由应用侧 Git 检测验证结果。
- **失败可见性：** 启动失败、command 不可用、Agent Session crashed、未检测到 commit、日志缺失和 Git 操作异常必须明确展示，不得静默改为成功状态。
- **跨平台目标：** 产品方向是 Mac 桌面应用并尽量支持 Windows 和 Linux。[ASSUMPTION: MVP 验收以 macOS 先通过为主，Windows/Linux 兼容性风险在 Spike 中记录但不阻塞 MVP PRD。]

## 7. 非目标（明确）

- MVP 不实现完整代码浏览、编辑器、语言服务或调试器。
- MVP 不实现完整 Diff 查看、Git 历史、merge/rebase UI 或 Git GUI。
- MVP 不实现插件系统。
- MVP 不实现 GitHub/GitLab Issue、评论、PR/MR 或云端同步。
- MVP 不实现 Worktree 自动创建、隔离和合并策略。
- MVP 不实现 Project 级多终端任务恢复。
- MVP 不实现多 Agent 类型并行运行；首个 Agent 是 Codex。
- MVP 不实现一 Issue 多 Agent Session Attempt。
- MVP 不实现 completed Issue 的 Reopen。
- MVP 不提供 priority、label、assignee、milestone 等项目管理字段。
- MVP 不让应用层直接自动提交所有 Git 改动。

## 8. MVP 范围

### 8.1 In Scope

- 创建并打开绑定本地 Git Repository 的 Project。
- 创建、编辑、查看极简本地 Issue。
- 配置 Codex Agent Profile，支持 command 自动检测和手动路径兜底。
- 支持 ProjectAgentOverride。
- 通过 Run Dialog 展示 prompt 来源和可编辑最终 prompt。
- 从 Issue 启动 Codex Agent Session，并在启动成功后进入 `running`。
- 通过 Session Dialog 创建不关联 Issue 的临时 Agent Session。
- 提供 Agents Activity 左侧 `Running` / `Completed` Session 展示分组。
- 提供 Session Header 和 Issue Inspector。
- 提供 Project Settings 与 Global Settings 分层。
- 使用内嵌 PTY 和 xterm.js 呈现 Codex Native Session View。
- 支持 Agent Session 日志文件和关键 SessionEvent。
- 支持 `attention=none|requested` 与 Needs Attention 展示。
- 支持手动 `Mark Review`，且 review 阶段继续修正不退回 `running`。
- 支持 `manual` 与 `agent_auto_commit` Completion Policy。
- 支持 CompletionAttempt、commit hash 检测、未检测到 commit 时保持 `review`。
- 支持 completed Issue Summary 和 Open Log。
- 支持基础 `zh-CN` 与 `en-US` 文案。

### 8.2 Out of Scope for MVP

- Worktree：延后到 MVP 后的独立能力，避免先扩展 Git 隔离复杂度。
- 完整 Diff：MVP 不做完整变更审查；后续可以在 Agents Activity 右侧扩展 changed files 或 Diff 信息。
- 完整代码浏览和编辑：MVP 不是 IDE 替代品。
- GitHub/GitLab 与 PR/MR：第二阶段再接入协作平台。
- 云端用户、同步和多人协作：第三阶段再验证。
- 插件系统：等本地闭环稳定后再开放扩展。
- 多 Session Attempt：MVP 保持一 Issue 一 Agent Session。
- 活进程跨应用重启恢复：MVP 将应用重启后无法恢复的运行中 Session 标记为 `stopped`，不要求恢复仍在运行的 PTY 进程。

## 9. 成功指标

**Primary**

- **SM-1：Issue 到 Agent Session 完成闭环可演示。** 在同一 Git Repository 中，连续完成 5 次从 Project、Issue、Run、Codex 交互、Mark Review 到 completed 的本地任务流程，不能出现 Issue 状态与 Agent Session 状态不一致导致无法继续的情况。[ASSUMPTION: 5 次连续成功作为 MVP 内部验收阈值。] 验证 FR-1、FR-4、FR-10、FR-14、FR-17、FR-20、FR-21。
- **SM-2：内嵌 Codex 体验通过 Spike。** macOS 上 Codex Native Session View 支持显示、输入、Enter、方向键、Ctrl+C、粘贴、resize、退出检测和日志写入。[ASSUMPTION: macOS Spike 通过是进入完整业务实现前的硬门槛。] 验证 FR-14、FR-15。
- **SM-3：完成动作可追溯。** 每次完成 Issue 都能找到对应 IssueAction；每次 Agent Commit 尝试都能找到 CompletionAttempt、完成前后 HEAD、结果和 commit hash 或失败原因。验证 FR-6、FR-21、FR-22、FR-24。

**Secondary**

- **SM-4：Run 失败不污染状态。** 10 次故意 command 失败测试中，Issue 均保持 `backlog`，并展示失败原因。[ASSUMPTION: 10 次故意失败测试作为启动失败路径验收阈值。] 验证 FR-7、FR-10。
- **SM-5：重启后可复盘。** 应用重启后先展示 Project Home，用户进入选中 Project 后能查看 Issue 列表、completed Summary、日志路径，并把不可恢复的运行中 Session 标记为异常状态。验证 FR-2、FR-19、FR-24。

**Counter-metrics**

- **SM-C1：不要优化 Issue 字段数量。** 不以 priority、label、assignee、milestone 等字段数量衡量 MVP 完成度，避免滑向项目管理工具。反制 FR-4。
- **SM-C2：不要优化自动完成率。** 不以“自动把多少 Issue 置为 completed”为目标；未检测到 commit 或状态异常时保持 `review` 比自动完成更重要。反制 FR-21、FR-22。
- **SM-C3：不要用功能面数量证明价值。** 代码浏览、Diff、Git 历史、插件、Worktree 和云协作不进入 MVP 价值评估，避免突破 scope freeze。

## 10. 开放问题

1. 产品正式名称是否确认使用 RedWhisk，或仅为当前项目代号？
2. 新 Project 的默认 Completion Policy 是否应为 `manual`，还是允许用户在首次设置中选择？
3. `attention=requested` 的启发式识别规则在 MVP 中需要达到什么可靠性，哪些场景只允许手动标记？
4. macOS 通过是否足以作为 MVP 内部验收，Windows/Linux 兼容性应进入哪个里程碑？
5. Completion prompt 的具体模板、失败兜底文案和只提交本 Issue 相关改动的措辞需要在实现前确认。
## 11. 假设索引

- §1 — 产品名沿用当前项目名 RedWhisk。
- §5.1 FR-3 — 新 Project 的默认 Completion Policy 为 `manual`，降低误提交风险。
- §6 — MVP 验收以 macOS 先通过为主，Windows/Linux 兼容性风险在 Spike 中记录但不阻塞 MVP PRD。
- §9 SM-1 — 5 次连续成功作为 MVP 内部验收阈值。
- §9 SM-2 — macOS Spike 通过是进入完整业务实现前的硬门槛。
- §9 SM-4 — 10 次故意失败测试作为启动失败路径验收阈值。
