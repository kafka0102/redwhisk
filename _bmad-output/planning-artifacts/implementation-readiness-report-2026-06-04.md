---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
filesIncluded:
  prd:
    - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md
    - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md
    - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/reconcile-brainstorming.md
    - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/review-rubric.md
    - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/.decision-log.md
  architecture:
    - _bmad-output/planning-artifacts/architecture.md
  epics:
    - _bmad-output/planning-artifacts/epics.md
  ux:
    - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md
    - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md
    - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/review-ux.md
    - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/reconcile-prd.md
    - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/.decision-log.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-06-04
**Project:** redwhisk

## Step 1: Document Discovery

### PRD Files Found

**Whole Documents:**
- None found by default pattern: `_bmad-output/planning-artifacts/*prd*.md`

**Sharded Documents:**
- Folder: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/`
  - `prd.md` (34,409 bytes, modified 2026-06-03 21:32:35)
  - `addendum.md` (14,153 bytes, modified 2026-06-03 21:29:58)
  - `reconcile-brainstorming.md` (3,313 bytes, modified 2026-06-03 21:32:10)
  - `review-rubric.md` (3,482 bytes, modified 2026-06-03 21:32:10)
  - `.decision-log.md` (3,869 bytes, modified 2026-06-03 21:32:35)

### Architecture Files Found

**Whole Documents:**
- `_bmad-output/planning-artifacts/architecture.md` (40,151 bytes, modified 2026-06-03 23:00:56)

**Sharded Documents:**
- None found

### Epics & Stories Files Found

**Whole Documents:**
- `_bmad-output/planning-artifacts/epics.md` (59,378 bytes, modified 2026-06-04 10:30:17)

**Sharded Documents:**
- None found

### UX Design Files Found

**Whole Documents:**
- None found by default pattern: `_bmad-output/planning-artifacts/*ux*.md`

**Sharded Documents:**
- Folder: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/`
  - `DESIGN.md` (10,332 bytes, modified 2026-06-03 22:25:35)
  - `EXPERIENCE.md` (17,259 bytes, modified 2026-06-03 22:25:35)
  - `review-ux.md` (2,618 bytes, modified 2026-06-03 22:24:46)
  - `reconcile-prd.md` (2,696 bytes, modified 2026-06-03 22:24:46)
  - `.decision-log.md` (2,866 bytes, modified 2026-06-03 22:25:35)

### Issues Found

- No duplicate whole/sharded document format conflicts were found.
- PRD and UX use non-default sharded directory layouts without shallow `index.md`; the listed folders are selected for assessment.

## Step 2: PRD Analysis

### Functional Requirements

FR-1：创建 Git Workspace

用户可以选择本地目录创建 Workspace；系统必须校验该目录是 Git Repository。

可测试结果：
- 选择 Git Repository 时，系统创建 Workspace 并保存 `workspace_id`、`name`、`repo_path`、`created_at`、`last_opened_at`。
- 选择非 Git 目录时，系统拒绝创建 Workspace，并展示明确错误。
- 创建成功后，应用进入该 Workspace 的 Issues Activity。

FR-2：打开最近 Workspace

用户重新打开应用时，可以回到最近打开的 Workspace。

可测试结果：
- 系统更新并持久化 Workspace 的 `last_opened_at`。
- 应用重启后能展示最近 Workspace 的 Issues Activity。
- 若 `repo_path` 不存在或不可访问，系统展示错误，不删除 Workspace 记录。

FR-3：提供 Workspace Settings 与 Global Settings

系统必须区分当前 Workspace Settings 和全局应用级 Global Settings。

可测试结果：
- Workspace Settings 位于 Activity Bar 的 `Settings`，只影响当前 Workspace。
- Workspace Settings 至少包含 Workspace 名称、`repo_path`、Workspace 级 `completion_policy`、默认 Agent Profile、WorkspaceAgentOverride、项目级 instructions、日志和 Agent Session 存储信息。
- Global Settings 通过左下角 gear 或原生顶部菜单打开。
- Global Settings 至少包含 UI language、全局 Agent Profiles、全局默认 `completion_policy`、全局数据目录、全局日志目录、About 和 Diagnostics。
- Workspace Settings 通过 `Inherit global default` 或 `Override for this workspace` 与 Global Settings 连接。
- `completion_policy` 只能是 `manual` 或 `agent_auto_commit`。
- [ASSUMPTION: 新 Workspace 的默认 Completion Policy 为 `manual`，降低误提交风险。]

FR-4：创建和编辑 Issue

用户可以在 Workspace 内创建和编辑本地 Issue。

可测试结果：
- Issue 至少保存 `title`、`description`、`status`、`created_at`、`updated_at`。
- 新 Issue 默认状态为 `backlog`。
- 用户可以在 Issue 详情弹窗中编辑 `title` 和 `description`。
- MVP 不提供 priority、label、assignee、milestone。

FR-5：展示 Issue 详情弹窗

用户点击 Issue 卡片后，系统打开 Issue 详情弹窗。

可测试结果：
- Issue 详情弹窗采用左右两栏布局。
- 左侧主要区域展示 `title` 和 `description`，两者均可随时编辑并保存至数据库。
- 右侧辅助区域展示 Session 关联区和当前 Issue 可执行操作按钮。
- Issue 详情弹窗不展示 `status` 字段，不展示 `updated_at` 字段。
- `backlog` 且无 Agent Session 的 Issue 显示 `Run`。
- `running` 或 `review` 且有关联 Agent Session 的 Issue 显示 `Open Session`。
- `completed` Issue 不显示 `Run`、`Mark Review` 或完成类按钮。
- MVP 不在 Issue 详情弹窗展示完整日志、完整 Diff 或 Git 历史。

FR-6：记录 IssueAction

所有改变 Issue 状态的动作必须写入 IssueAction。

可测试结果：
- 创建 Issue、启动 Agent 成功、标记 review、完成 Issue 都生成 IssueAction。
- IssueAction 至少包含 `issue_id`、`action_type`、`payload_json`、`created_at`。
- 启动失败不得把 Issue 改为 `running`，但可以记录失败原因。

FR-7：检测 Codex command

系统可以检测本机 `codex` 命令，并允许手动路径兜底。

可测试结果：
- 创建 Codex Agent Profile 时，系统通过用户 login shell 执行 `command -v codex`。
- 检测失败时，用户可以手动填写 command path 并运行 Test。
- command 不可执行时，系统不得保存 enabled Agent Profile。

FR-8：保存 Agent Profile 与 WorkspaceAgentOverride

用户可以创建全局 Agent Profile，并为 Workspace 设置覆盖项。

可测试结果：
- Agent Profile 至少保存 `name`、`agent_type`、`command`、`default_args`、`default_skill`、`prompt_template`、`enabled`。
- WorkspaceAgentOverride 可以覆盖 `default_args`、`default_skill`、`prompt_template`、`enabled`。
- Run Dialog 使用覆盖后的生效配置。
- 配置来源和 command 可用性属于 Settings / Agent Profile 配置层，不进入 Run Dialog。

FR-9：生成并确认最终 prompt

用户从 Issue 点击 `Run` 后，Run Dialog 必须展示可编辑最终 prompt。

可测试结果：
- 最终 prompt 由 Issue、Workspace、Agent Profile、WorkspaceAgentOverride、默认 skill、prompt 模板和应用补充说明组成。
- Run Dialog 显示最终 prompt，默认可编辑。
- Run Dialog 可以折叠查看 prompt 来源，例如 Issue description、default skill、prompt template、app instructions。
- Run Dialog 显示 Agent Profile 选择、working directory、default args、`Cancel` 和 `Start`。
- Run Dialog 不展示 command 是否可用，不展示配置继承或覆盖来源。
- 默认 prompt 不包含 Issue `title`；只有 `prompt_template` 显式引用 `{{issue.title}}` 时，Issue `title` 才进入 prompt。
- 用户确认后，系统保存最终 prompt 快照。

FR-10：成功启动后才进入 running

用户确认 Run Dialog 后，系统尝试启动 Agent 进程；只有进程成功启动后，才创建或激活 Agent Session，并将 Issue 改为 `running`。

可测试结果：
- 启动成功时，系统创建 Agent Session、写入 SessionEvent，并将 Issue 状态改为 `running`。
- 启动失败时，Issue 保持 `backlog`。
- 启动失败原因展示在 Run Dialog 中，并可写入 IssueAction 或 SessionEvent。

FR-11：保存 Agent Session 快照和日志索引

系统必须保存 Agent Session 的关键元数据和日志文件路径。

可测试结果：
- Agent Session 至少保存 `issue_id`、`agent_profile_id`、`codex_session_id`、`status`、`attention`、`working_dir`、`command_snapshot`、`prompt_snapshot`、`log_path`、`started_at`。
- 高频终端输出写入日志文件，不逐字符写入 SQLite。
- SQLite 保存关键 SessionEvent 和日志路径。

FR-12：限制一 Issue 一 Agent Session

MVP 中一个 Issue 最多关联一个 Agent Session。

可测试结果：
- 已有关联 Agent Session 的 Issue 不允许创建第二个并列 Agent Session。
- 若 Agent Session 异常退出，系统优先提供 resume 或日志复盘路径，而不是新建 Attempt。
- 多 Session Attempt 不进入 MVP。

FR-13：提供 Agents Activity 左右两栏工作区

Agents Activity 必须展示 Agent Session 列表和当前 Codex Native Session View。

可测试结果：
- 左侧栏展示当前 Workspace 的最近 Agent Session。
- 左侧栏默认按 `Running` 和 `Completed` 分组展示。
- `Running` 分组按 `last_active_at` 排序，最近有输出或用户输入的 Agent Session 在上。
- `Completed` 分组展示 `closed`、`crashed` 或 `stopped` Agent Session，按最近完成或结束时间排序，默认只展示最近 20 条 Agent Session。
- 左侧栏顶部提供展示形态 icon，并提供新建不关联 Issue 的临时 Agent Session 按钮。
- 左侧 Agent Session 列表项展示 Issue title 或临时 Session title、Agent 类型和运行状态。
- 右侧展示当前选中的 Codex Native Session View。
- Session 与 `review` 无关；`review` 是 Issue 状态，不是 Agent Session 状态或 Agent Session 分组。

FR-14：通过内嵌 PTY 运行 Codex

系统必须通过内嵌 PTY 和 xterm.js 运行 Codex CLI。

可测试结果：
- 用户输入直接进入 Codex TUI，不额外实现独立聊天输入框。
- 右侧工作区能显示 Codex TUI 的主要界面、颜色和交互。
- Enter、方向键、Ctrl+C、粘贴和 resize 在 Spike 验收中可用。
- Codex 退出时，系统能获得进程退出信息并记录 SessionEvent。

FR-15：展示 Needs Attention

系统必须支持对运行中的 Agent Session 标记用户关注需求。

可测试结果：
- Agent Session 主状态保持 `running`，等待用户输入不改变主状态。
- `attention` 只取 `none` 或 `requested`。
- Issues Activity 和 Agents Activity 能展示 Needs Attention。
- MVP 可以通过手动标记和启发式输出识别设置 `attention=requested`。

FR-16：创建不关联 Issue 的临时 Agent Session

用户可以在 Agents Activity 中创建不关联 Issue 的临时 Agent Session。实现 UJ-5。

可测试结果：
- 点击 Agents 左侧栏顶部的新建按钮后，系统打开 Session Dialog，而不是直接创建 Agent Session。
- Session Dialog 字段保持极简，只包含 `title`、`agent_profile`、`prompt`、`Cancel` 和 `Start`。
- `title` 默认生成，例如 `Untitled Session`，用户可修改。
- Session Dialog 不展示 `working_directory`，默认使用当前 Workspace `repo_path`。
- Session Dialog 不展示 command 是否可用，不展示配置来源或继承/覆盖关系。
- 点击 `Start` 后，只有 Rust Core 成功启动 Agent 进程，才创建 Agent Session 并加入左侧列表。
- 启动失败时不创建 Agent Session，Session Dialog 显示错误。
- 不关联 Issue 的 Agent Session 不触发 Issue 状态流转，不参与 Completion Policy。

FR-17：手动 Mark Review

用户可以手动将 `running` Issue 标记为 `review`。

可测试结果：
- 只有 `running` Issue 且存在关联 Agent Session 时显示 `Mark Review`。
- 在 Agents Activity 中，`Mark Review` 显示在右侧 Session Header 上。
- 点击 `Mark Review` 后，Issue 状态变为 `review`。
- Agent Session 保持 `running`，Codex 进程不关闭。
- 系统写入 IssueAction。

FR-18：review 阶段继续修正

用户在 `review` Issue 中继续向 Codex 输入修正需求时，Issue 不退回 `running`。

可测试结果：
- `review` Issue 仍可打开当前 Codex Native Session View。
- 用户继续交互后，Issue 状态仍为 `review`。
- 右侧 Session Header 仍显示完成类按钮。
- 修正交互继续写入同一个 Agent Session 日志和事件流。

FR-19：处理 crashed 或 stopped Agent Session

系统必须显式展示异常 Agent Session，而不是把异常伪装成完成。

可测试结果：
- Codex 进程异常退出时，Agent Session 进入 `crashed`。
- 应用重启后无法恢复活进程时，Agent Session 可以标记为 `crashed` 或 `stopped`。[ASSUMPTION: MVP 可以使用 `stopped` 表示应用重启导致活进程不可恢复的降级状态。]
- `running` 或 `review` Issue 关联 `crashed` Agent Session 时，系统提供 `Resume Session` 或日志复盘入口。
- `crashed` Agent Session 不会让 Issue 自动进入 `completed`。

FR-20：手动完成或无提交完成

用户可以在 `manual` 策略下手动完成 Issue，也可以在 `agent_auto_commit` 且无未提交改动时直接完成。

可测试结果：
- `completion_policy=manual` 时，`review` Issue 显示 `Complete Manually`。
- `agent_auto_commit` 且无未提交改动时，`review` Issue 显示 `Complete`。
- 用户确认后，系统关闭 Agent Session，将 Agent Session 标记为 `closed`，并将 Issue 标记为 `completed`。
- 完成动作写入 IssueAction。

FR-21：Agent Commit 完成

用户可以在 `agent_auto_commit` 策略下让当前 Codex 只提交本 Issue 相关改动并完成 Issue。

可测试结果：
- 仅当 Issue 为 `review`、Agent Session 为 `running`、`completion_policy=agent_auto_commit` 且存在未提交改动时显示 `Complete with Agent Commit`。
- 点击后，系统检测当前 Issue、Agent Session、Workspace、Git status、HEAD、changed files 和策略配置。
- 系统弹出轻量确认面板，默认隐藏 completion prompt，但允许展开查看。
- 用户确认后，系统把 completion prompt 发送给当前 Codex Agent Session。
- 检测到新 commit 后，系统记录 commit hash，关闭 Agent Session，并将 Issue 标记为 `completed`。
- 未检测到新 commit 时，Issue 保持 `review` 并提示用户处理。

FR-22：记录 CompletionAttempt

每次完成尝试必须写入 CompletionAttempt。

可测试结果：
- CompletionAttempt 至少记录 `issue_id`、`session_id`、`option`、`head_before`、`head_after`、`changed_files_json`、`commit_hash`、`result`、`error`、`created_at`。
- 若 `HEAD` 未改变且用户选择 Agent Commit，CompletionAttempt 记录 `no_commit_detected`。
- 若出现 merge、rebase、cherry-pick 等进行中状态，MVP 提示用户手动处理，不自动完成。

FR-23：限制 completed Issue 操作

completed Issue 不提供重新打开或重新运行能力。

可测试结果：
- completed Issue 不显示 `Run`、`Mark Review`、`Complete Manually`、`Complete with Agent Commit`。
- MVP 不实现 `Reopen`。
- 状态不一致时，系统展示诊断信息，不自动修复。

FR-24：查看 Summary 和日志

用户可以查看 completed Issue 的摘要和日志。

可测试结果：
- Summary 至少展示 Issue 信息、Agent Session 时间、Agent Session 状态、CompletionAttempt 结果、commit hash 和日志路径。
- `Open Log` 能打开或定位原始日志文件。
- 日志路径缺失或文件不存在时，系统展示明确错误。

FR-25：展示 Session Header 和 Issue Inspector

系统必须在当前 Agent Session 关联 Issue 时展示 Issue 上下文，并支持打开 Issue Inspector。

可测试结果：
- 当前 Agent Session 关联 Issue 时，右侧 Session Header 显示 Issue 标题。
- 当前 Agent Session 不关联 Issue 时，Header 不显示 Issue 标题，不显示 `No linked issue`，也不显示 Issue 操作。
- `running` Issue 的 Header 主按钮为 `Mark Review`。
- `review` Issue 的 Header 主按钮根据 Completion Policy 显示 `Complete with Agent Commit` 或 `Complete Manually`。
- `completed` Issue 的 Header 不显示完成类主按钮，可显示 `View Summary`、`Open Log` 或打开 Issue Inspector。
- 点击 Issue 标题打开 Issue Inspector，不跳转页面，不需要返回按钮。
- Issue Inspector 可通过 `X`、`Esc`、再次点击 Issue 标题或点击面板外关闭。
- 打开和关闭 Issue Inspector 不影响当前 Codex Native Session View，不卸载 xterm。
- Issue Inspector 可编辑 `title` 和 `description`，并展示 Session 关联区和操作区。

FR-26：提供核心状态和命令文案

系统必须为核心状态和命令提供 `zh-CN` 与 `en-US` 文案。

可测试结果：
- Issue 状态文案包含：`backlog=待办`、`running=运行中`、`review=待验收`、`completed=已完成`。
- 核心命令文案包含：`运行`、`打开会话`、`标记待验收`、`继续会话`、`手动完成`、`Agent 提交并完成`、`不提交直接完成`、`查看总结`、`打开日志`、`配置 Agent`。
- UI 命令语义不把 Codex 写死为唯一 Agent 名称。

Total FRs: 26

### Non-Functional Requirements

NFR-1：本地优先与隐私

MVP 不需要用户登录，不上传 Issue、prompt、日志、Git 状态或代码内容。所有核心数据保存在本机。

NFR-2：状态可靠性

Issue 状态和 Agent Session 状态的改变必须由 Rust Core 或等价核心层完成；前端不得单独把核心状态写为 `running`、`review`、`completed`、`closed`。

NFR-3：审计性

所有状态变化、完成尝试和 Agent Session 关键事件必须能在 SQLite 结构化记录或日志文件中复盘。

NFR-4：终端性能

原始终端输出写入日志文件，SQLite 只保存关键事件和摘要，避免高频输出拖垮数据库。

NFR-5：完成安全

应用不得默认执行 `git add .` 或自行提交全部改动。Agent Commit 只能通过向当前 Codex Agent Session 注入 completion prompt，并由应用侧 Git 检测验证结果。

NFR-6：失败可见性

启动失败、command 不可用、Agent Session crashed、未检测到 commit、日志缺失和 Git 操作异常必须明确展示，不得静默改为成功状态。

NFR-7：跨平台目标

产品方向是 Mac 桌面应用并尽量支持 Windows 和 Linux。[ASSUMPTION: MVP 验收以 macOS 先通过为主，Windows/Linux 兼容性风险在 Spike 中记录但不阻塞 MVP PRD。]

Total NFRs: 7

### Additional Requirements

- MVP 产品定位：VS Code 形态的 Agent 工作台，不是桌面版 Agent Kanban。
- 核心闭环：Git Workspace -> 本地 Issue -> Run Codex -> 内嵌 Codex Session -> Mark Review -> 继续修正或完成 -> Summary/Log。
- 首个 Agent：Codex。
- MVP 必须内嵌终端，不接受外部终端作为主路径。
- Issue 与 Agent Session 是分离的一等实体，通过关联关系和跳转联动。
- MVP 保持一 Issue 一 Agent Session。
- Agent Session 可以不关联 Issue，用于当前 Workspace 下的临时 Codex 交互；临时 Agent Session 不参与 Issue 状态流转和 Completion Policy。
- Issue 状态：`backlog`、`running`、`review`、`completed`。
- Agent Session 状态：`running`、`closed`、`crashed`，`stopped` 为可选降级状态。
- Agents Activity 左侧 Session 展示分组固定包含 `Running` 和 `Completed`，不按 `Review` 分组。
- 等待用户输入不是 Agent Session 主状态，用 `attention=none|requested` 表示。
- `review` 阶段允许继续让 Codex 修正，Issue 不退回 `running`。
- Completion Policy：`manual | agent_auto_commit`。
- `agent_auto_commit` 不等于应用直接 `git add .`，而是向当前 Codex Session 注入 completion prompt，并由应用检测 Git 结果。
- React Workbench 不直接写核心业务状态；前端通过 Tauri command 请求 Rust Core 执行动作，Rust Core 校验条件、执行本地动作、写入 SQLite，并通过事件通知前端刷新。
- 明确非目标：完整代码浏览、编辑器、语言服务、调试器、完整 Diff、Git 历史、merge/rebase UI、Git GUI、插件系统、GitHub/GitLab、Worktree、多 Session Attempt、completed Issue Reopen、完整项目管理字段、应用层直接自动提交所有 Git 改动。
- 成功指标包括 5 次完整闭环可演示、macOS Codex Native Session View Spike 通过、完成动作可追溯、10 次故意 command 失败不污染状态、重启后可复盘。

### PRD Completeness Assessment

PRD 主体已提供连续 FR-1 至 FR-26、7 条跨功能 NFR、MVP In Scope / Out of Scope、成功指标、反指标、开放问题和假设索引。`addendum.md` 补充了模块边界、Command/Event 同步模型、数据表草案、Session Header / Issue 操作状态表、React IA 冻结口径、Button Copy、Spike 计划、开发里程碑和信任风险清单。对账与审查文件均指出 PRD 可进入 UX、架构和故事拆分，但仍有 6 个需后续确认的问题：产品正式名称、默认 Completion Policy、attention 启发式可靠性、Windows/Linux 里程碑、completion prompt 模板、`stopped` 是否保留。

## Step 3: Epic Coverage Validation

### Epic FR Coverage Extracted

FR1: Covered in Epic 1 - 创建 Git Workspace
FR2: Covered in Epic 1 - 打开最近 Workspace
FR3: Covered in Epic 1 - Workspace Settings 与 Global Settings
FR4: Covered in Epic 1 - 创建和编辑 Issue
FR5: Covered in Epic 1 - Issue 详情弹窗
FR6: Covered in Epic 1 - IssueAction 审计记录
FR7: Covered in Epic 1 - Codex command 检测
FR8: Covered in Epic 1 - Agent Profile 与 WorkspaceAgentOverride
FR9: Covered in Epic 2 - 最终 prompt 生成与确认
FR10: Covered in Epic 2 - 成功启动后才进入 running
FR11: Covered in Epic 2 - Agent Session 快照和日志索引
FR12: Covered in Epic 2 - 一 Issue 一 Agent Session
FR13: Covered in Epic 2 - Agents Activity 左右两栏和 Session list 基础
FR14: Covered in Epic 2 - 内嵌 PTY/xterm 运行 Codex
FR15: Covered in Epic 3 - Needs Attention
FR16: Covered in Epic 3 - 不关联 Issue 的临时 Agent Session
FR17: Covered in Epic 4 - 手动 Mark Review
FR18: Covered in Epic 4 - review 阶段继续修正
FR19: Covered in Epic 4 - crashed / stopped Agent Session
FR20: Covered in Epic 5 - 手动完成或无提交完成
FR21: Covered in Epic 5 - Agent Commit 完成
FR22: Covered in Epic 5 - CompletionAttempt
FR23: Covered in Epic 5 - completed Issue 操作限制
FR24: Covered in Epic 5 - Summary 和日志复盘
FR25: Covered in Epic 4 - Session Header 与 Issue Inspector
FR26: Covered in Epic 1 - zh-CN / en-US 核心文案

Total FRs in epics: 26

### Coverage Matrix

| FR Number | PRD Requirement | Epic Coverage | Status |
| --------- | --------------- | ------------- | ------ |
| FR-1 | 创建 Git Workspace | Epic 1 / Story 1.3 | Covered |
| FR-2 | 打开最近 Workspace | Epic 1 / Story 1.4 | Covered |
| FR-3 | 提供 Workspace Settings 与 Global Settings | Epic 1 / Story 1.9 | Covered |
| FR-4 | 创建和编辑 Issue | Epic 1 / Story 1.5 | Covered |
| FR-5 | 展示 Issue 详情弹窗 | Epic 1 / Story 1.6 | Covered |
| FR-6 | 记录 IssueAction | Epic 1 / Story 1.7, Story 2.3, Story 4.1, Story 5.1 | Covered |
| FR-7 | 检测 Codex command | Epic 1 / Story 1.8 | Covered |
| FR-8 | 保存 Agent Profile 与 WorkspaceAgentOverride | Epic 1 / Story 1.8, Epic 2 / Story 2.1 | Covered |
| FR-9 | 生成并确认最终 prompt | Epic 2 / Story 2.1, Story 2.2 | Covered |
| FR-10 | 成功启动后才进入 running | Epic 2 / Story 2.3 | Covered |
| FR-11 | 保存 Agent Session 快照和日志索引 | Epic 2 / Story 2.2, Story 2.3, Story 2.7 | Covered |
| FR-12 | 限制一 Issue 一 Agent Session | Epic 2 / Story 2.4 | Covered |
| FR-13 | 提供 Agents Activity 左右两栏工作区 | Epic 2 / Story 2.5, Epic 3 / Story 3.1 | Covered |
| FR-14 | 通过内嵌 PTY 运行 Codex | Epic 2 / Story 2.6 | Covered |
| FR-15 | 展示 Needs Attention | Epic 3 / Story 3.2, Story 3.3 | Covered |
| FR-16 | 创建不关联 Issue 的临时 Agent Session | Epic 3 / Story 3.4, Story 3.5, Story 3.6 | Covered |
| FR-17 | 手动 Mark Review | Epic 4 / Story 4.1, Story 4.4 | Covered |
| FR-18 | review 阶段继续修正 | Epic 4 / Story 4.2, Story 4.4 | Covered |
| FR-19 | 处理 crashed 或 stopped Agent Session | Epic 4 / Story 4.5, Story 4.6, Story 4.7 | Covered |
| FR-20 | 手动完成或无提交完成 | Epic 5 / Story 5.1, Story 5.2, Story 5.5 | Covered |
| FR-21 | Agent Commit 完成 | Epic 5 / Story 5.3, Story 5.4, Story 5.5, Story 5.6 | Covered |
| FR-22 | 记录 CompletionAttempt | Epic 5 / Story 5.2, Story 5.3, Story 5.4, Story 5.5, Story 5.6, Story 5.7 | Covered |
| FR-23 | 限制 completed Issue 操作 | Epic 5 / Story 5.1, Story 5.8, Story 5.9 | Covered |
| FR-24 | 查看 Summary 和日志 | Epic 4 / Story 4.7, Epic 5 / Story 5.8, Story 5.9 | Covered |
| FR-25 | 展示 Session Header 和 Issue Inspector | Epic 2 / Story 2.5, Epic 3 / Story 3.6, Epic 4 / Story 4.3, Story 4.4 | Covered |
| FR-26 | 提供核心状态和命令文案 | Epic 1 / Story 1.9 | Covered |

### Missing Requirements

No missing PRD FR coverage was found. Epics document includes FR1-FR26 and maps each one to an epic. No extra FR numbers outside the PRD sequence were found in the epics document.

### Coverage Statistics

- Total PRD FRs: 26
- FRs covered in epics: 26
- Coverage percentage: 100%

## Step 4: UX Alignment Assessment

### UX Document Status

Found. UX documentation exists as a sharded UX spine:

- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/reconcile-prd.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/review-ux.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/.decision-log.md`

### UX ↔ PRD Alignment

- UX Information Architecture aligns with PRD: Workspace Picker, Issues Activity, Issue Detail Dialog, Run Dialog, Agents Activity, Session Dialog, Issue Inspector, Completion Confirmation, Workspace Settings, Global Settings, Summary / Log View.
- UX preserves PRD MVP scope freeze: no Code, Diff, Git History, Terminal, GitHub/GitLab, cloud sync, Worktree, plugin system, multi Session Attempt, or completed Issue Reopen as MVP paths.
- UX state patterns align with PRD states: Issue `backlog/running/review/completed`, Agent Session `running/closed/crashed/stopped`, `attention=none|requested`, no review Session grouping, no automatic completed on crash or no commit.
- UX component behavior matches PRD: Run Dialog remains lightweight, Session Dialog remains minimal, Header hides Issue area for standalone sessions, Issue Inspector does not change route or unload xterm, review remains interactive.
- UX trust rules reinforce PRD: completion confirmation shows Git summary, completion prompt is expandable, no commit detected keeps Issue in `review`, crashed/stopped is explicit, completed offers Summary/Open Log.
- UX i18n and accessibility requirements expand PRD FR-26 without contradicting it: core status and commands are dictionary-backed, focus behavior and labels are specified.

### UX ↔ Architecture Alignment

- Architecture supports the UX workbench shape through `features/workspace`, `features/issues`, `features/agents`, `features/settings`, `shared/ui`, `shared/styles`, and Activity-level routing.
- Architecture explicitly protects xterm lifecycle: Inspector/Dialog/Header operations are view state and must not unload `CodexTerminal` or PTY Session.
- Architecture supports UX trust requirements through Rust Core source of truth, Tauri command/event boundary, SQLite `IssueAction` / `SessionEvent` / `CompletionAttempt`, session log files, and Git HEAD/status detection.
- Architecture supports UX visual direction by selecting a starter without a large UI framework and requiring custom desktop workbench components plus CSS/token layers.
- Architecture supports performance constraints: high-frequency terminal output goes to log files / PTY channel rather than per-character SQLite events.
- Architecture supports failure visibility through explicit error codes and states such as `NO_COMMIT_DETECTED`, `crashed`, `stopped`, and `log_missing`.

### Alignment Issues

No blocking PRD/UX/Architecture alignment issue was found.

### Warnings

- Medium: UX Fast path did not generate key-screen mockups. The UX review recommends adding `Issues Activity`, `Agents Activity with linked Issue`, `Run Dialog`, and `Completion Confirmation` mockups before detailed frontend implementation because visual quality depends on exact density, proportions, and panel treatment.
- Medium: Three architecture-critical UX/technical promises still require real Spike validation before full implementation confidence: Embedded Codex Terminal, Codex resume/completion prompt injection, and Git Commit Detection.
- Low: `stopped` remains an open state decision across PRD, UX, and Architecture. It is documented as acceptable but should be finalized before implementing the Agent Session state machine.
- Low: Command Palette and shortcut assumptions are documented as non-core. Implementation must not make any core flow depend on them until confirmed.

## Step 5: Epic Quality Review

### Overall Quality Summary

Epic structure is mostly implementation-ready. The five epics are user-value oriented rather than purely technical milestones, and the sequence is broadly valid:

- Epic 1 can stand alone as Workspace, Issue, Settings, Profile, i18n, and workbench foundation.
- Epic 2 depends only on Epic 1 and delivers the first Issue-to-Codex Session path.
- Epic 3 depends on Session infrastructure from Epic 2 and adds Session management plus standalone sessions.
- Epic 4 depends on prior running sessions and adds review, Inspector, and abnormal-session handling.
- Epic 5 depends on review sessions and completes the workflow with completion policy, commit detection, Summary, and logs.

No FR coverage gap was found. The main readiness risks are story-level quality issues: placeholder UI acceptance criteria, future/spike dependencies embedded in stories, and unresolved state decisions.

### Critical Violations

No critical violation was found. There are no purely technical epics with no user value, no Epic N requiring Epic N+1 to function, and no missing FR coverage.

### Major Issues

#### Major 1: Placeholder completion UI in Story 4.4 creates forward dependency risk

**Location:** `Story 4.4: 根据 Issue 状态展示 Header 操作`

**Issue:** The acceptance criteria state that a `review` Issue Header should show “完成类按钮占位或入口” while concrete completion behavior is implemented in Epic 5. This is a forward dependency smell: a story should not ship placeholder controls that imply a future workflow the current story cannot complete.

**Impact:** Users may see a completion control before completion behavior exists, or implementers may add dead UI. It also makes Story 4.4 harder to verify independently.

**Recommendation:** In Story 4.4, limit scope to already implemented actions: linked Issue title, standalone-session hidden Issue area, and `running -> Mark Review`. Move all `review` completion button rendering to Epic 5 stories where actual completion commands exist.

#### Major 2: Resume/continue placeholders in abnormal Session stories are not implementation-ready

**Locations:** `Story 4.5: 处理 Codex 进程 crashed`, `Story 4.7: 异常 Session 的日志复盘入口`

**Issue:** These stories include “继续会话入口占位” and “实际 resume 能力以后续 story 或 Spike 结果为准”. That is an explicit placeholder/future dependency inside acceptance criteria.

**Impact:** The story can pass with a non-functional placeholder, which weakens user trust and violates the “independently completable” rule.

**Recommendation:** Choose one MVP path per story. If resume is not implemented, acceptance criteria should require log/diagnostic recovery only. If resume is required, add an explicit resume Spike/story before these UI entries are accepted as functional.

#### Major 3: `stopped` vs `crashed` state decision remains embedded in Story 4.6

**Location:** `Story 4.6: 应用重启后标记不可恢复 Session`

**Issue:** The story requires implementers to choose `stopped` or `crashed` before implementing the state machine and update Architecture or ADR. This is a decision gate embedded inside a story rather than a resolved implementation contract.

**Impact:** Agent Session schema, enum types, i18n, UI filters, Completed grouping, and tests can diverge if different implementers make different choices.

**Recommendation:** Finalize the state before implementation starts. Either keep `stopped` as a formal Agent Session status with i18n and persistence support, or collapse restart-loss into `crashed` with a reason payload. Update PRD/Architecture/Epics consistently.

#### Major 4: Spike 2 and Spike 3 are prerequisites but not explicit implementation gates

**Locations:** Additional Requirements, Epic 5 stories, Architecture warnings

**Issue:** The planning docs require Spike 2 for Codex resume/completion prompt injection and Spike 3 for Git Commit Detection. Epics include `Story 2.6` for Embedded Codex Terminal Spike, but there are no equally explicit Spike stories or gates before Epic 5 depends on completion prompt injection and Git commit detection.

**Impact:** High-risk implementation may start before feasibility is proven. This is especially risky because completion safety is a primary trust requirement.

**Recommendation:** Add explicit stories or pre-Epic-5 gates:
- Spike: Codex Session Resume and Completion Prompt Injection
- Spike: Git Commit Detection
Then make Epic 5 implementation stories depend on the recorded Spike results or documented fallback path.

### Minor Concerns

#### Minor 1: Story 2.6 mixes Spike validation and production feature delivery

**Location:** `Story 2.6: 运行 Codex Native Session View 的 PTY/xterm Spike`

**Issue:** The story title and ACs mix a feasibility Spike with production behavior. It asks the user to start a Codex AgentSession and operate Codex TUI, while also saying the Spike records compatibility risks.

**Recommendation:** Either rename it as a production implementation story with a required Spike evidence artifact, or split into a pure Spike story followed by a production `Codex Native Session View` implementation story.

#### Minor 2: Story 1.10 is broad for one implementation story

**Location:** `Story 1.10: 实现桌面视觉 Token 与基础可访问性`

**Issue:** The story covers theme tokens, typography, spacing, rounded rules, shared component layer, Button/Dialog/Inspector/Toolbar/Tooltip/Activity Bar rendering, focus ring, hit targets, `Esc`, `Tab`, focus restore, and Reduce Motion. This is valuable but large.

**Recommendation:** Keep tokens and baseline primitives in Story 1.10, then let later feature stories verify surface-specific behavior such as Inspector and Completion Confirmation. Avoid requiring future feature components to be complete in Epic 1.

#### Minor 3: Story 5.10 is a validation gate, not a normal user story

**Location:** `Story 5.10: 完成闭环端到端验收`

**Issue:** This story is appropriate as an end-to-end acceptance gate, but it depends on most prior stories and is not independently shippable product functionality.

**Recommendation:** Mark it explicitly as `E2E Validation Gate` or `Acceptance Gate` rather than a regular implementation story. Keep it at the end of Epic 5.

### Dependency Analysis

No epic-level forward dependency was found. The epic order is coherent:

| Epic | Independence Result |
| ---- | ------------------- |
| Epic 1 | Pass: stands alone as local workbench foundation with Workspace, Issue, Settings, Profile, and i18n. |
| Epic 2 | Pass: uses Epic 1 output to start Issue-linked Codex sessions. |
| Epic 3 | Pass: uses Session infrastructure from Epic 2 to manage sessions and standalone sessions. |
| Epic 4 | Pass with story-level issues: review and abnormal-session handling use prior Session infrastructure, but placeholder resume/completion entries need cleanup. |
| Epic 5 | Pass with Spike risk: completion flow uses prior review sessions, but risky completion prompt and Git detection work need explicit Spike gates. |

### Database Creation Timing

Database/entity timing is mostly compliant. The epics do not create all tables upfront. Story 1.2 creates migration infrastructure only, while tables are introduced when first needed:

- `workspaces`: Story 1.3
- `issues`: Story 1.5
- `issue_actions`: Story 1.7
- `agent_profiles`: Story 1.8
- `workspace_agent_overrides`: Story 1.8
- `workspace_settings`: Story 1.9
- `agent_sessions` / `session_events`: Story 2.3
- `completion_attempts`: Story 5.2

### Best Practices Compliance Checklist

| Area | Result | Notes |
| ---- | ------ | ----- |
| Epics deliver user value | Pass | No purely technical epic found. |
| Epic independence | Pass | No Epic N requires Epic N+1. |
| Stories appropriately sized | Partial | Story 1.10 and Story 5.10 should be narrowed or marked as gates. |
| No forward dependencies | Partial | Placeholder completion/resume entries and missing Spike gates need remediation. |
| Database tables created when needed | Pass | Table creation is incremental by story. |
| Clear acceptance criteria | Partial | Most ACs are BDD and testable; placeholder/future-dependent ACs need cleanup. |
| Traceability to FRs maintained | Pass | FR1-FR26 are mapped and story Requirements reference FRs/NFRs/UX-DRs. |

## Summary and Recommendations

### Overall Readiness Status

NEEDS WORK

The planning package is close to implementation-ready, but it should not be treated as fully ready until the Major issues below are resolved. PRD, UX, Architecture, and Epics are broadly aligned; FR coverage is complete; no critical gap blocks the product direction. The readiness risk is concentrated in implementation planning: placeholder controls, unresolved state decisions, and missing explicit Spike gates for high-risk completion behavior.

### Issue Count

- Critical issues: 0
- Major issues: 4
- Minor concerns: 3
- Warnings from UX/Architecture alignment: 4
- Missing PRD FR coverage: 0

### Critical Issues Requiring Immediate Action

No critical issue was found.

### Major Issues Requiring Action Before Implementation

1. Remove placeholder completion UI from Story 4.4 or move all review completion button rendering to Epic 5 where completion behavior exists.
2. Remove non-functional resume/continue placeholders from Stories 4.5 and 4.7, or add an explicit resume implementation story/gate before those controls are accepted.
3. Finalize the `stopped` vs `crashed` Agent Session state decision before implementing schema, enums, i18n, filters, and tests.
4. Add explicit Spike gates for Codex resume/completion prompt injection and Git Commit Detection before Epic 5 implementation begins.

### Recommended Next Steps

1. Update `epics.md` to resolve the four Major issues:
   - Story 4.4 should not ship future completion placeholders.
   - Stories 4.5 and 4.7 should either implement resume or only expose log/diagnostic recovery.
   - Story 4.6 should consume a finalized state decision rather than make the decision during implementation.
   - Epic 5 should be preceded by Spike 2 and Spike 3 gate stories or explicit acceptance artifacts.
2. Add or schedule key-screen mockups for `Issues Activity`, `Agents Activity with linked Issue`, `Run Dialog`, and `Completion Confirmation` before detailed frontend implementation.
3. Decide and document whether `stopped` is a formal Agent Session state. Update PRD, UX, Architecture, Epics, and i18n requirements consistently.
4. Mark Story 5.10 as an `E2E Validation Gate` rather than a normal implementation story.
5. Narrow Story 1.10 or explicitly limit it to tokens and baseline primitives; leave surface-specific component verification to later feature stories.
6. After edits, rerun implementation readiness validation to confirm Major issues are closed and readiness can move to `READY`.

### Final Note

This assessment found 11 issues across coverage, UX/architecture alignment, and epic quality categories. The strongest parts of the package are PRD completeness, FR traceability, architecture boundaries, and UX/PRD alignment. The weakest part is not product definition; it is implementation sequencing around risky Agent/PTY/Git behavior and placeholder UI. Address the Major issues before starting Phase 4 implementation, or proceed only with a clearly accepted risk that some stories are not independently completable.

Assessment date: 2026-06-04

Assessor: BMAD Implementation Readiness workflow
