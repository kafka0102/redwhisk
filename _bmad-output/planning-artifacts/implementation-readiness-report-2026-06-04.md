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
  - `prd.md` (34,348 bytes, modified 2026-06-04 14:40:27 CST)
  - `addendum.md` (14,375 bytes, modified 2026-06-04 14:37:47 CST)
  - `reconcile-brainstorming.md` (3,313 bytes, modified 2026-06-03 21:32:10 CST)
  - `review-rubric.md` (3,482 bytes, modified 2026-06-03 21:32:10 CST)
  - `.decision-log.md` (3,869 bytes, modified 2026-06-03 21:32:35 CST)

### Architecture Files Found

**Whole Documents:**
- `_bmad-output/planning-artifacts/architecture.md` (40,378 bytes, modified 2026-06-04 14:38:09 CST)

**Sharded Documents:**
- None found

### Epics & Stories Files Found

**Whole Documents:**
- `_bmad-output/planning-artifacts/epics.md` (62,565 bytes, modified 2026-06-04 14:39:28 CST)

**Sharded Documents:**
- None found

### UX Design Files Found

**Whole Documents:**
- None found by default pattern: `_bmad-output/planning-artifacts/*ux*.md`

**Sharded Documents:**
- Folder: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/`
  - `DESIGN.md` (10,332 bytes, modified 2026-06-03 22:25:35 CST)
  - `EXPERIENCE.md` (17,143 bytes, modified 2026-06-04 14:38:31 CST)
  - `review-ux.md` (2,618 bytes, modified 2026-06-03 22:24:46 CST)
  - `reconcile-prd.md` (2,696 bytes, modified 2026-06-03 22:24:46 CST)
  - `.decision-log.md` (2,866 bytes, modified 2026-06-03 22:25:35 CST)

### Issues Found

- No duplicate whole/sharded document format conflicts were found.
- PRD and UX use non-default sharded directory layouts without shallow `index.md`; the listed folders are selected for assessment.

### Selected Files for Assessment

- PRD:
  - `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md`
  - `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md`
  - `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/reconcile-brainstorming.md`
  - `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/review-rubric.md`
  - `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/.decision-log.md`
- Architecture:
  - `_bmad-output/planning-artifacts/architecture.md`
- Epics & Stories:
  - `_bmad-output/planning-artifacts/epics.md`
- UX:
  - `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md`
  - `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md`
  - `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/review-ux.md`
  - `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/reconcile-prd.md`
  - `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/.decision-log.md`

## PRD Analysis

### Functional Requirements

FR-1：创建 Git Workspace
用户可以选择本地目录创建 Workspace；系统必须校验该目录是 Git Repository。
可测试结果：选择 Git Repository 时，系统创建 Workspace 并保存 `workspace_id`、`name`、`repo_path`、`created_at`、`last_opened_at`；选择非 Git 目录时拒绝创建并展示明确错误；创建成功后进入该 Workspace 的 Issues Activity。

FR-2：打开最近 Workspace
用户重新打开应用时，可以回到最近打开的 Workspace。
可测试结果：系统更新并持久化 Workspace 的 `last_opened_at`；应用重启后能展示最近 Workspace 的 Issues Activity；若 `repo_path` 不存在或不可访问，系统展示错误，不删除 Workspace 记录。

FR-3：提供 Workspace Settings 与 Global Settings
系统必须区分当前 Workspace Settings 和全局应用级 Global Settings。
可测试结果：Workspace Settings 位于 Activity Bar 的 `Settings`，只影响当前 Workspace；至少包含 Workspace 名称、`repo_path`、Workspace 级 `completion_policy`、默认 Agent Profile、WorkspaceAgentOverride、项目级 instructions、日志和 Agent Session 存储信息；Global Settings 通过左下角 gear 或原生顶部菜单打开；至少包含 UI language、全局 Agent Profiles、全局默认 `completion_policy`、全局数据目录、全局日志目录、About 和 Diagnostics；Workspace Settings 通过 `Inherit global default` 或 `Override for this workspace` 与 Global Settings 连接；`completion_policy` 只能是 `manual` 或 `agent_auto_commit`；[ASSUMPTION: 新 Workspace 的默认 Completion Policy 为 `manual`，降低误提交风险。]

FR-4：创建和编辑 Issue
用户可以在 Workspace 内创建和编辑本地 Issue。
可测试结果：Issue 至少保存 `title`、`description`、`status`、`created_at`、`updated_at`；新 Issue 默认状态为 `backlog`；用户可以在 Issue 详情弹窗中编辑 `title` 和 `description`；MVP 不提供 priority、label、assignee、milestone。

FR-5：展示 Issue 详情弹窗
用户点击 Issue 卡片后，系统打开 Issue 详情弹窗。
可测试结果：Issue 详情弹窗采用左右两栏布局；左侧主要区域展示 `title` 和 `description`，两者均可随时编辑并保存至数据库；右侧辅助区域展示 Session 关联区和当前 Issue 可执行操作按钮；Issue 详情弹窗不展示 `status` 字段，不展示 `updated_at` 字段；`backlog` 且无 Agent Session 的 Issue 显示 `Run`；`running` 或 `review` 且有关联 Agent Session 的 Issue 显示 `Open Session`；`completed` Issue 不显示 `Run`、`Mark Review` 或完成类按钮；MVP 不在 Issue 详情弹窗展示完整日志、完整 Diff 或 Git 历史。

FR-6：记录 IssueAction
所有改变 Issue 状态的动作必须写入 IssueAction。
可测试结果：创建 Issue、启动 Agent 成功、标记 review、完成 Issue 都生成 IssueAction；IssueAction 至少包含 `issue_id`、`action_type`、`payload_json`、`created_at`；启动失败不得把 Issue 改为 `running`，但可以记录失败原因。

FR-7：检测 Codex command
系统可以检测本机 `codex` 命令，并允许手动路径兜底。
可测试结果：创建 Codex Agent Profile 时，系统通过用户 login shell 执行 `command -v codex`；检测失败时，用户可以手动填写 command path 并运行 Test；command 不可执行时，系统不得保存 enabled Agent Profile。

FR-8：保存 Agent Profile 与 WorkspaceAgentOverride
用户可以创建全局 Agent Profile，并为 Workspace 设置覆盖项。
可测试结果：Agent Profile 至少保存 `name`、`agent_type`、`command`、`default_args`、`default_skill`、`prompt_template`、`enabled`；WorkspaceAgentOverride 可以覆盖 `default_args`、`default_skill`、`prompt_template`、`enabled`；Run Dialog 使用覆盖后的生效配置；配置来源和 command 可用性属于 Settings / Agent Profile 配置层，不进入 Run Dialog。

FR-9：生成并确认最终 prompt
用户从 Issue 点击 `Run` 后，Run Dialog 必须展示可编辑最终 prompt。
可测试结果：最终 prompt 由 Issue、Workspace、Agent Profile、WorkspaceAgentOverride、默认 skill、prompt 模板和应用补充说明组成；Run Dialog 显示最终 prompt，默认可编辑；Run Dialog 可以折叠查看 prompt 来源，例如 Issue description、default skill、prompt template、app instructions；Run Dialog 显示 Agent Profile 选择、working directory、default args、`Cancel` 和 `Start`；Run Dialog 不展示 command 是否可用，不展示配置继承或覆盖来源；默认 prompt 不包含 Issue `title`；只有 `prompt_template` 显式引用 `{{issue.title}}` 时，Issue `title` 才进入 prompt；用户确认后，系统保存最终 prompt 快照。

FR-10：成功启动后才进入 running
用户确认 Run Dialog 后，系统尝试启动 Agent 进程；只有进程成功启动后，才创建或激活 Agent Session，并将 Issue 改为 `running`。
可测试结果：启动成功时，系统创建 Agent Session、写入 SessionEvent，并将 Issue 状态改为 `running`；启动失败时，Issue 保持 `backlog`；启动失败原因展示在 Run Dialog 中，并可写入 IssueAction 或 SessionEvent。

FR-11：保存 Agent Session 快照和日志索引
系统必须保存 Agent Session 的关键元数据和日志文件路径。
可测试结果：Agent Session 至少保存 `issue_id`、`agent_profile_id`、`codex_session_id`、`status`、`attention`、`working_dir`、`command_snapshot`、`prompt_snapshot`、`log_path`、`started_at`；高频终端输出写入日志文件，不逐字符写入 SQLite；SQLite 保存关键 SessionEvent 和日志路径。

FR-12：限制一 Issue 一 Agent Session
MVP 中一个 Issue 最多关联一个 Agent Session。
可测试结果：已有关联 Agent Session 的 Issue 不允许创建第二个并列 Agent Session；若 Agent Session 异常退出，系统优先提供 resume 或日志复盘路径，而不是新建 Attempt；多 Session Attempt 不进入 MVP。

FR-13：提供 Agents Activity 左右两栏工作区
Agents Activity 必须展示 Agent Session 列表和当前 Codex Native Session View。
可测试结果：左侧栏展示当前 Workspace 的最近 Agent Session；默认按 `Running` 和 `Completed` 分组展示；`Running` 分组按 `last_active_at` 排序；`Completed` 分组展示 `closed`、`crashed` 或 `stopped` Agent Session，按最近完成或结束时间排序，默认只展示最近 20 条；左侧栏顶部提供展示形态 icon，并提供新建不关联 Issue 的临时 Agent Session 按钮；左侧 Agent Session 列表项展示 Issue title 或临时 Session title、Agent 类型和运行状态；右侧展示当前选中的 Codex Native Session View；Session 与 `review` 无关。

FR-14：通过内嵌 PTY 运行 Codex
系统必须通过内嵌 PTY 和 xterm.js 运行 Codex CLI。
可测试结果：用户输入直接进入 Codex TUI，不额外实现独立聊天输入框；右侧工作区能显示 Codex TUI 的主要界面、颜色和交互；Enter、方向键、Ctrl+C、粘贴和 resize 在 Spike 验收中可用；Codex 退出时，系统能获得进程退出信息并记录 SessionEvent。

FR-15：展示 Needs Attention
系统必须支持对运行中的 Agent Session 标记用户关注需求。
可测试结果：Agent Session 主状态保持 `running`，等待用户输入不改变主状态；`attention` 只取 `none` 或 `requested`；Issues Activity 和 Agents Activity 能展示 Needs Attention；MVP 可以通过手动标记和启发式输出识别设置 `attention=requested`。

FR-16：创建不关联 Issue 的临时 Agent Session
用户可以在 Agents Activity 中创建不关联 Issue 的临时 Agent Session。
可测试结果：点击 Agents 左侧栏顶部的新建按钮后，系统打开 Session Dialog，而不是直接创建 Agent Session；Session Dialog 字段保持极简，只包含 `title`、`agent_profile`、`prompt`、`Cancel` 和 `Start`；`title` 默认生成，例如 `Untitled Session`，用户可修改；Session Dialog 不展示 `working_directory`，默认使用当前 Workspace `repo_path`；Session Dialog 不展示 command 是否可用，不展示配置来源或继承/覆盖关系；点击 `Start` 后，只有 Rust Core 成功启动 Agent 进程，才创建 Agent Session 并加入左侧列表；启动失败时不创建 Agent Session，Session Dialog 显示错误；不关联 Issue 的 Agent Session 不触发 Issue 状态流转，不参与 Completion Policy。

FR-17：手动 Mark Review
用户可以手动将 `running` Issue 标记为 `review`。
可测试结果：只有 `running` Issue 且存在关联 Agent Session 时显示 `Mark Review`；在 Agents Activity 中，`Mark Review` 显示在右侧 Session Header 上；点击 `Mark Review` 后，Issue 状态变为 `review`；Agent Session 保持 `running`，Codex 进程不关闭；系统写入 IssueAction。

FR-18：review 阶段继续修正
用户在 `review` Issue 中继续向 Codex 输入修正需求时，Issue 不退回 `running`。
可测试结果：`review` Issue 仍可打开当前 Codex Native Session View；用户继续交互后，Issue 状态仍为 `review`；右侧 Session Header 仍显示完成类按钮；修正交互继续写入同一个 Agent Session 日志和事件流。

FR-19：处理 crashed 或 stopped Agent Session
系统必须显式展示异常 Agent Session，而不是把异常伪装成完成。
可测试结果：Codex 进程异常退出时，Agent Session 进入 `crashed`；应用重启后无法恢复活进程时，Agent Session 必须标记为 `stopped`；`running` 或 `review` Issue 关联异常 Agent Session 时，系统默认提供日志复盘或诊断入口；`Resume Session` 入口只有在 Codex resume 能力由 Spike 或后续 story 明确实现后才显示；`crashed` Agent Session 不会让 Issue 自动进入 `completed`。

FR-20：手动完成或无提交完成
用户可以在 `manual` 策略下手动完成 Issue，也可以在 `agent_auto_commit` 且无未提交改动时直接完成。
可测试结果：`completion_policy=manual` 时，`review` Issue 显示 `Complete Manually`；`agent_auto_commit` 且无未提交改动时，`review` Issue 显示 `Complete`；用户确认后，系统关闭 Agent Session，将 Agent Session 标记为 `closed`，并将 Issue 标记为 `completed`；完成动作写入 IssueAction。

FR-21：Agent Commit 完成
用户可以在 `agent_auto_commit` 策略下让当前 Codex 只提交本 Issue 相关改动并完成 Issue。
可测试结果：仅当 Issue 为 `review`、Agent Session 为 `running`、`completion_policy=agent_auto_commit` 且存在未提交改动时显示 `Complete with Agent Commit`；点击后，系统检测当前 Issue、Agent Session、Workspace、Git status、HEAD、changed files 和策略配置；系统弹出轻量确认面板，默认隐藏 completion prompt，但允许展开查看；用户确认后，系统把 completion prompt 发送给当前 Codex Agent Session；检测到新 commit 后，系统记录 commit hash，关闭 Agent Session，并将 Issue 标记为 `completed`；未检测到新 commit 时，Issue 保持 `review` 并提示用户处理。

FR-22：记录 CompletionAttempt
每次完成尝试必须写入 CompletionAttempt。
可测试结果：CompletionAttempt 至少记录 `issue_id`、`session_id`、`option`、`head_before`、`head_after`、`changed_files_json`、`commit_hash`、`result`、`error`、`created_at`；若 `HEAD` 未改变且用户选择 Agent Commit，CompletionAttempt 记录 `no_commit_detected`；若出现 merge、rebase、cherry-pick 等进行中状态，MVP 提示用户手动处理，不自动完成。

FR-23：限制 completed Issue 操作
completed Issue 不提供重新打开或重新运行能力。
可测试结果：completed Issue 不显示 `Run`、`Mark Review`、`Complete Manually`、`Complete with Agent Commit`；MVP 不实现 `Reopen`；状态不一致时，系统展示诊断信息，不自动修复。

FR-24：查看 Summary 和日志
用户可以查看 completed Issue 的摘要和日志。
可测试结果：Summary 至少展示 Issue 信息、Agent Session 时间、Agent Session 状态、CompletionAttempt 结果、commit hash 和日志路径；`Open Log` 能打开或定位原始日志文件；日志路径缺失或文件不存在时，系统展示明确错误。

FR-25：展示 Session Header 和 Issue Inspector
系统必须在当前 Agent Session 关联 Issue 时展示 Issue 上下文，并支持打开 Issue Inspector。
可测试结果：当前 Agent Session 关联 Issue 时，右侧 Session Header 显示 Issue 标题；当前 Agent Session 不关联 Issue 时，Header 不显示 Issue 标题，不显示 `No linked issue`，也不显示 Issue 操作；`running` Issue 的 Header 主按钮为 `Mark Review`；`review` Issue 的 Header 主按钮根据 Completion Policy 显示 `Complete with Agent Commit` 或 `Complete Manually`；`completed` Issue 的 Header 不显示完成类主按钮，可显示 `View Summary`、`Open Log` 或打开 Issue Inspector；点击 Issue 标题打开 Issue Inspector，不跳转页面，不需要返回按钮；Issue Inspector 可通过 `X`、`Esc`、再次点击 Issue 标题或点击面板外关闭；打开和关闭 Issue Inspector 不影响当前 Codex Native Session View，不卸载 xterm；Issue Inspector 可编辑 `title` 和 `description`，并展示 Session 关联区和操作区。

FR-26：提供核心状态和命令文案
系统必须为核心状态和命令提供 `zh-CN` 与 `en-US` 文案。
可测试结果：Issue 状态文案包含：`backlog=待办`、`running=运行中`、`review=待验收`、`completed=已完成`；核心命令文案包含：`运行`、`打开会话`、`标记待验收`、`继续会话`、`手动完成`、`Agent 提交并完成`、`不提交直接完成`、`查看总结`、`打开日志`、`配置 Agent`；UI 命令语义不把 Codex 写死为唯一 Agent 名称。

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

- MVP 范围冻结：第一阶段只验证本地闭环，不包含 GitHub/GitLab、云协作、插件系统、完整代码浏览、完整 Diff、Git 历史、Worktree 自动化、多 Agent 并行、多 Session Attempt、completed Issue Reopen。
- 术语和状态模型固定：Issue 状态为 `backlog`、`running`、`review`、`completed`；Agent Session 状态为 `running`、`closed`、`crashed`、`stopped`；`review` 是 Issue 状态，不是 Session 状态或分组。
- Settings 分层固定：Activity Bar 的 `Settings` 是 Workspace Settings；Global Settings 通过左下角 gear 或原生顶部菜单打开。
- UI 信息架构固定：Activity Bar 只包含 `Issues`、`Agents`、`Settings`；Issues Activity 四泳道；Agents Activity 左右两栏；Session Header 只在有关联 Issue 时展示 Issue 上下文。
- Completion Policy 固定为 `manual | agent_auto_commit`；`agent_auto_commit` 必须向当前 Codex Session 注入 completion prompt，并通过 Git 检测验证结果，不能由应用直接 `git add .`。
- Spike 约束：Embedded Codex Terminal、Codex Session Resume 与 completion prompt 注入、Git Commit Detection 是关键可行性验证。
- 成功指标：连续 5 次本地闭环演示、macOS Codex Native Session View Spike 通过、完成动作可追溯、10 次故意 command 失败不污染状态、重启后可复盘。
- 开放问题：产品正式名称、默认 Completion Policy、attention 启发式可靠性、Windows/Linux 里程碑、completion prompt 模板、`stopped` 是否作为正式状态保留。

### PRD Completeness Assessment

PRD 完整度较高，FR 编号连续且每项均包含可测试结果；NFR 覆盖本地隐私、状态可靠性、审计、终端性能、完成安全、失败可见性和跨平台方向。Addendum 为架构、数据模型、Command/Event、Spike 和里程碑提供了足够下游输入。主要残余风险不在需求缺失，而在若干假设和 Spike 结果：Embedded Codex Terminal、resume / completion prompt 注入、Git commit 检测必须在实现前或早期里程碑中验证；默认 Completion Policy、attention 启发式、`stopped` 状态和 completion prompt 模板仍需确认。

## Epic Coverage Validation

### Epic FR Coverage Extracted

- FR1：Covered in Epic 1 - 创建 Git Workspace
- FR2：Covered in Epic 1 - 打开最近 Workspace
- FR3：Covered in Epic 1 - Workspace Settings 与 Global Settings
- FR4：Covered in Epic 1 - 创建和编辑 Issue
- FR5：Covered in Epic 1 - Issue 详情弹窗
- FR6：Covered in Epic 1 - IssueAction 审计记录
- FR7：Covered in Epic 1 - Codex command 检测
- FR8：Covered in Epic 1 - Agent Profile 与 WorkspaceAgentOverride
- FR9：Covered in Epic 2 - 最终 prompt 生成与确认
- FR10：Covered in Epic 2 - 成功启动后才进入 running
- FR11：Covered in Epic 2 - Agent Session 快照和日志索引
- FR12：Covered in Epic 2 - 一 Issue 一 Agent Session
- FR13：Covered in Epic 2 - Agents Activity 左右两栏和 Session list 基础
- FR14：Covered in Epic 2 - 内嵌 PTY/xterm 运行 Codex
- FR15：Covered in Epic 3 - Needs Attention
- FR16：Covered in Epic 3 - 不关联 Issue 的临时 Agent Session
- FR17：Covered in Epic 4 - 手动 Mark Review
- FR18：Covered in Epic 4 - review 阶段继续修正
- FR19：Covered in Epic 4 - crashed / stopped Agent Session
- FR20：Covered in Epic 5 - 手动完成或无提交完成
- FR21：Covered in Epic 5 - Agent Commit 完成
- FR22：Covered in Epic 5 - CompletionAttempt
- FR23：Covered in Epic 5 - completed Issue 操作限制
- FR24：Covered in Epic 5 - Summary 和日志复盘
- FR25：Covered in Epic 4 - Session Header 与 Issue Inspector
- FR26：Covered in Epic 1 - zh-CN / en-US 核心文案

Total FRs in epics: 26

### Coverage Matrix

| FR Number | PRD Requirement | Epic Coverage | Status |
| --- | --- | --- | --- |
| FR1 | 创建 Git Workspace | Epic 1 / Story 1.3 | Covered |
| FR2 | 打开最近 Workspace | Epic 1 / Story 1.4 | Covered |
| FR3 | 提供 Workspace Settings 与 Global Settings | Epic 1 / Story 1.9 | Covered |
| FR4 | 创建和编辑 Issue | Epic 1 / Story 1.5 | Covered |
| FR5 | 展示 Issue 详情弹窗 | Epic 1 / Story 1.6 | Covered |
| FR6 | 记录 IssueAction | Epic 1 / Story 1.7，并贯穿后续状态故事 | Covered |
| FR7 | 检测 Codex command | Epic 1 / Story 1.8 | Covered |
| FR8 | 保存 Agent Profile 与 WorkspaceAgentOverride | Epic 1 / Story 1.8 | Covered |
| FR9 | 生成并确认最终 prompt | Epic 2 / Story 2.1、2.2 | Covered |
| FR10 | 成功启动后才进入 running | Epic 2 / Story 2.3 | Covered |
| FR11 | 保存 Agent Session 快照和日志索引 | Epic 2 / Story 2.3、2.7 | Covered |
| FR12 | 限制一 Issue 一 Agent Session | Epic 2 / Story 2.4 | Covered |
| FR13 | 提供 Agents Activity 左右两栏工作区 | Epic 2 / Story 2.5，Epic 3 / Story 3.1 | Covered |
| FR14 | 通过内嵌 PTY 运行 Codex | Epic 2 / Story 2.6 | Covered |
| FR15 | 展示 Needs Attention | Epic 3 / Story 3.2、3.3 | Covered |
| FR16 | 创建不关联 Issue 的临时 Agent Session | Epic 3 / Story 3.4、3.5、3.6 | Covered |
| FR17 | 手动 Mark Review | Epic 4 / Story 4.1 | Covered |
| FR18 | review 阶段继续修正 | Epic 4 / Story 4.2，Epic 2 / Story 2.8 Spike | Covered |
| FR19 | 处理 crashed 或 stopped Agent Session | Epic 4 / Story 4.5、4.6、4.7 | Covered |
| FR20 | 手动完成或无提交完成 | Epic 5 / Story 5.1、5.2 | Covered |
| FR21 | Agent Commit 完成 | Epic 5 / Story 5.3、5.4、5.5、5.6，Epic 2 / Story 2.9 Spike | Covered |
| FR22 | 记录 CompletionAttempt | Epic 5 / Story 5.2、5.4、5.5、5.6、5.7 | Covered |
| FR23 | 限制 completed Issue 操作 | Epic 5 / Story 5.1、5.8、5.9 | Covered |
| FR24 | 查看 Summary 和日志 | Epic 5 / Story 5.8、5.9 | Covered |
| FR25 | 展示 Session Header 和 Issue Inspector | Epic 4 / Story 4.3、4.4 | Covered |
| FR26 | 提供核心状态和命令文案 | Epic 1 / Story 1.9 | Covered |

### Missing Requirements

No missing PRD FR coverage was found. All PRD FR1-FR26 are explicitly mapped in the epics document and have at least one implementation story or gate path.

No extra FR numbers were found in epics that are not present in the PRD.

### Coverage Statistics

- Total PRD FRs: 26
- FRs covered in epics: 26
- Coverage percentage: 100%

## UX Alignment Assessment

### UX Document Status

Found. UX documentation exists as a sharded UX spine under `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/`:

- `DESIGN.md`
- `EXPERIENCE.md`
- `reconcile-prd.md`
- `review-ux.md`
- `.decision-log.md`

No whole UX document was found by the default shallow pattern `_bmad-output/planning-artifacts/*ux*.md`; the sharded UX folder is the selected UX source.

### UX ↔ PRD Alignment

UX is strongly aligned with the PRD.

- PRD product shape is a cross-platform desktop Agent workbench; UX defines a single-window Tauri desktop workbench with Activity Bar, Issues Activity, Agents Activity, Settings, Dialogs, Inspector, Completion Confirmation, and Summary / Log surfaces.
- PRD UJ-1 through UJ-5 are reflected in UX Key Flows covering Issue Run and review, review-stage correction, standalone temporary Session, and completed/anomalous Session review.
- PRD IA constraints are preserved: Activity Bar only contains `Issues`、`Agents`、`Settings`; Global Settings is reached from gear/native menu; Issues Activity has four lanes; Agents Activity uses left Session list plus right Codex Native Session View.
- PRD state rules are preserved: `review` is Issue state, not Session grouping; `attention=requested` does not change Agent Session main state; crashed/stopped are visible and do not auto-complete Issue; completed Issue does not expose Run/Reopen/Mark Review/Complete.
- PRD trust rules are preserved: Run failure leaves Issue in `backlog`; completion confirmation shows Git summary and expandable prompt; no commit detected keeps Issue in `review`; logs and Summary remain available after completion.
- PRD i18n requirement is extended in UX with accessibility and text-source constraints: core status and commands must come from `zh-CN` / `en-US` dictionaries and not be hard-coded in components.

No UX requirements were found that contradict the PRD. UX adds non-conflicting implementation-facing requirements around design tokens, keyboard behavior, focus restoration, reduced motion, minimum hit targets, and key-screen mockup recommendations.

### UX ↔ Architecture Alignment

Architecture supports the UX requirements.

- React Workbench is organized around `Issues`、`Agents`、`Settings`, matching UX IA.
- Frontend project structure includes `issue-detail-dialog.tsx`、`run-dialog.tsx`、`agents-activity.tsx`、`agent-session-list.tsx`、`session-header.tsx`、`issue-inspector.tsx`、`codex-terminal.tsx`、`completion-confirmation.tsx`、`workspace-settings-activity.tsx`、`global-settings-dialog.tsx`, matching UX surfaces.
- Architecture explicitly states Dialog / Inspector operations must not unload xterm, satisfying UX trust and Session continuity rules.
- Rust PTY + xterm.js boundary supports Codex Native Session View; terminal output is written to logs, while SQLite only stores structured events and paths.
- Architecture includes `shared/styles/tokens.css`、`themes.css` and self-built `shared/ui` primitives, supporting DESIGN.md token and anti-management-SaaS constraints.
- Architecture includes `shared/i18n/zh-cn.ts` and `en-us.ts`, supporting FR-26 and UX i18n constraints.
- Architecture includes event, command, state machine, repository and service boundaries that support UX failure states such as run failed, crashed/stopped, no commit detected, and log missing.
- Architecture maps UX and PRD accessibility needs into implementation requirements via NFR8 and UX-DR rules in the epics document.

### Alignment Issues

No blocking UX / PRD / Architecture misalignment was found.

### Warnings

- Key-screen mockups were not generated. UX review marks this as a medium residual risk because the desired visual quality depends on layout proportion, density and panel rhythm. Recommended pre-implementation or early implementation mockups: `Issues Activity`、`Agents Activity with linked Issue`、`Run Dialog`、`Completion Confirmation`.
- Embedded Codex Terminal behavior still requires real Spike validation. Architecture and UX both depend on PTY/xterm preserving input, resize, Ctrl+C, paste, exit detection and xterm continuity.
- Codex resume / completion prompt injection and Git commit detection remain important Spike gates before Epic 5 `agent_auto_commit` stories.
- Command Palette and shortcut assumptions are explicitly non-blocking. Core flows must not depend on them until confirmed.
- `<960px` window behavior and minimum usable desktop width remain open UX items; this should be clarified before responsive polish.

## Epic Quality Review

### Overall Assessment

Epic structure is mostly implementation-ready. All five epics are framed around user-visible outcomes rather than pure technical milestones, and FR traceability is preserved. The decomposition generally follows progressive delivery: Epic 1 establishes Workspace / Issue / Settings foundations; Epic 2 starts Codex Sessions; Epic 3 adds Session management and temporary Sessions; Epic 4 adds review and abnormal Session handling; Epic 5 closes the loop with completion and review.

However, several story-level sequencing and readiness issues should be corrected before Phase 4 execution. The main concern is not missing scope, but dependency hygiene: a few stories reference capabilities that are only introduced later, and the greenfield project lacks an explicit early CI / quality gate story.

### Epic Structure Validation

| Epic | User Value Focus | Independence | Traceability | Assessment |
| --- | --- | --- | --- | --- |
| Epic 1: 本地 Workspace、Issue 与配置基础 | Strong | Strong | FR1-FR8, FR26 | Pass. Delivers a usable local Workspace / Issue / Settings base. Contains necessary greenfield setup and data boundary stories. |
| Epic 2: 从 Issue 可靠启动 Codex Session | Strong | Mostly strong | FR9-FR14 plus Spike support | Needs sequencing correction. PTY/xterm Spike appears after stories that depend on real Codex process startup. |
| Epic 3: Agent Session 管理与临时 Codex 会话 | Strong | Mostly strong | FR15-FR16, partial FR13 | Needs dependency cleanup. Some Completed/crashed/stopped display criteria depend on Epic 4 abnormal status implementation. |
| Epic 4: Review 循环、Issue Inspector 与异常 Session | Strong | Strong | FR17-FR19, FR25 | Pass with one minor wording issue around completion buttons before Epic 5. |
| Epic 5: 完成策略、Agent Commit 与复盘 | Strong | Strong if Spike gates are complete | FR20-FR24 | Pass. Correctly depends on prior Spike conclusions and includes an explicit E2E gate. |

### Critical Violations

No critical violations were found. There are no purely technical epics, no circular epic dependencies, and no missing FR implementation path.

### Major Issues

M-1: Story 2.3 depends on PTY/Codex startup capability that is validated later in Story 2.6.

- Evidence: Story 2.3 acceptance criteria require Rust Core to successfully start Codex, create AgentSession, write SessionEvent, and set Issue to `running`. Story 2.6 later validates the PTY/xterm Codex Spike that makes this reliable.
- Impact: Implementation could start business state transitions before the hard technical feasibility gate is proven, increasing rework and risking false `running` state behavior.
- Recommendation: Move Story 2.6 before Story 2.3, or split Story 2.3 into a post-Spike implementation story that explicitly depends on a completed Embedded Codex Terminal Spike. Story 2.1 and 2.2 can remain before the Spike because prompt generation does not require a working PTY.

M-2: Completed/crashed/stopped Session display criteria appear before abnormal statuses are implemented.

- Evidence: Story 2.5 says `Completed` group should reserve display for `closed`、`crashed`、`stopped`; Story 3.1 lists FR19 and requires Completed group to show `closed`、`crashed`、`stopped`, while crashed/stopped status creation is implemented in Epic 4 Stories 4.5 and 4.6.
- Impact: This is a forward dependency or at least an overclaim. A team implementing Epic 3 before Epic 4 cannot fully satisfy the real crashed/stopped behavior without pulling Epic 4 scope forward.
- Recommendation: Narrow Story 2.5 and 3.1 to list grouping and sorting for statuses already available at that point, using seeded fixtures only if needed. Move real crashed/stopped production and UI behavior entirely to Epic 4. Remove FR19 from Story 3.1 requirements unless it is explicitly a display-only placeholder.

M-3: Greenfield CI / quality gate setup is not explicit in Epic 1.

- Evidence: Architecture states early CI/CD should verify lint, typecheck, unit tests, Rust tests and build. Story 1.1 only requires local format/lint/typecheck/test scripts; no CI or quality gate story appears in Epic 1.
- Impact: Phase 4 can begin without a repeatable quality gate, which is risky for a Tauri + Rust + React greenfield project with generated types and command/event contracts.
- Recommendation: Add an early Epic 1 story or gate after Story 1.1: “建立基础质量门禁和 CI”。Acceptance criteria should include running frontend lint/typecheck/test, Rust fmt/clippy/test, generated type check, and at least one build verification command.

### Minor Concerns

m-1: Several enabling stories are technical but acceptable if explicitly labeled as Enabler / Spike / Gate.

- Evidence: Story 1.2 is primarily about SQLite migration and Tauri command boundaries; Stories 2.8 and 2.9 are implementation Spikes; Gate 5.10 is already labeled as a validation gate.
- Impact: The current wording is mostly safe, but treating these as normal user stories can confuse sprint planning and velocity expectations.
- Recommendation: Label Story 1.2 as an Enabler Story, Stories 2.8 / 2.9 as Spike Gates, and keep Gate 5.10 out of normal feature story accounting.

m-2: Story 4.4 has stage-specific acceptance criteria that will change after Epic 5.

- Evidence: Story 4.4 says a `review` Issue Header must not show completion buttons or unavailable completion controls. Final PRD FR25 requires `review` Header main action to depend on Completion Policy, which Epic 5 implements.
- Impact: If read literally after Epic 5, Story 4.4 conflicts with final behavior.
- Recommendation: Qualify Story 4.4 wording as “before Epic 5 completion actions are implemented” or move final review Header completion behavior into Epic 5 stories with a clear post-Epic-5 override.

m-3: “预留展示能力” is weaker than a testable acceptance criterion.

- Evidence: Story 2.5 uses “Completed 分组预留展示 `closed`、`crashed`、`stopped` 的最近 20 条能力”.
- Impact: “预留” can be interpreted as UI placeholder, data model support, or fully working behavior.
- Recommendation: Replace with concrete verifiable behavior, such as “When no completed sessions exist, Completed group renders an empty state” or defer the full Completed group behavior to Story 3.1 / Epic 4.

### Database / Entity Creation Timing

Database creation timing mostly follows best practice.

- Story 1.2 creates database and migration infrastructure, not all domain tables upfront.
- Story 1.3 creates `workspaces` when Workspace creation first needs it.
- Story 1.5 creates `issues` when Issue CRUD first needs it.
- Story 1.7 creates `issue_actions` when audit first needs it.
- Story 1.8 creates `agent_profiles` and `workspace_agent_overrides` when profile configuration first needs them.
- Story 2.3 creates `agent_sessions` and `session_events` when Session startup first needs them.
- Story 5.2 creates `completion_attempts` when completion audit first needs it.

No “create all models up front” violation was found.

### Acceptance Criteria Quality

Acceptance criteria are generally strong: most stories use Given / When / Then, include success and failure paths, and specify concrete state changes. Error cases are especially strong around run failure, command failure, crashed/stopped sessions, no commit detected, log missing, and Git operation-in-progress.

Areas to tighten before implementation:

- Convert “reserved capability” wording into concrete expected UI/state behavior.
- Add explicit CI / quality gate acceptance criteria.
- Clarify stage-specific Header behavior before and after Epic 5.
- Make Spike output artifacts mandatory and linked from dependent stories, especially Epic 5 `agent_auto_commit`.

### Best Practices Compliance Checklist

| Check | Result | Notes |
| --- | --- | --- |
| Epics deliver user value | Pass | No purely technical epic found. |
| Epic sequence is progressive | Pass with issues | Overall sequence is sound; Story 2.6 should move earlier. |
| No forward dependencies | Needs correction | Story 2.3 -> 2.6 and Completed/crashed/stopped display references need cleanup. |
| Stories appropriately sized | Mostly pass | Spikes/gates should be labeled separately from feature stories. |
| Database tables created when needed | Pass | Tables are introduced near first use. |
| Acceptance criteria are testable | Mostly pass | Some “预留能力” wording is vague. |
| Traceability to FRs maintained | Pass | FR1-FR26 all mapped and covered. |

### Recommendations Before Implementation

1. Reorder Epic 2 so Embedded Codex Terminal Spike precedes real AgentSession startup and `running` state mutation.
2. Remove or narrow forward references to crashed/stopped behavior from Epic 2 and Epic 3; keep real abnormal Session behavior in Epic 4.
3. Add an explicit early CI / quality gate story in Epic 1.
4. Re-label technical enablers, spikes and gates so sprint accounting does not treat them as normal user-facing stories.
5. Qualify Story 4.4 as pre-completion behavior or update it to avoid conflict with Epic 5 final Header behavior.

## Summary and Recommendations

### Overall Readiness Status

NEEDS WORK

The planning package is close to implementation-ready, but should not enter Phase 4 unchanged. PRD completeness, FR coverage, UX alignment and architecture coverage are strong; the remaining work is concentrated in epic/story sequencing, Spike gate placement and early quality gate definition.

This is not a scope failure. It is a planning hygiene issue: the implementation plan currently risks starting stateful AgentSession work before PTY/Codex feasibility is proven, and it contains a few forward references to statuses implemented later.

### Critical Issues Requiring Immediate Action

No critical violations were found.

### Major Issues Requiring Correction

1. Story 2.3 depends on the PTY/Codex startup capability that Story 2.6 validates later.
   Move the Embedded Codex Terminal Spike before real AgentSession startup and before Issue `running` mutation, or explicitly gate Story 2.3 on a completed Spike.

2. Epic 2 / Epic 3 reference Completed/crashed/stopped behavior before Epic 4 implements abnormal Session status production.
   Narrow those earlier stories to display scaffolding or already-available statuses; keep real crashed/stopped behavior in Epic 4.

3. Epic 1 lacks an explicit early CI / quality gate story.
   Add a story or gate after project initialization covering frontend lint/typecheck/test, Rust fmt/clippy/test, generated type checks and at least one build verification.

### Additional Warnings

- Key-screen mockups were not generated. This is not blocking, but visual quality is at risk until the four key screens are mocked or implemented with review: `Issues Activity`、`Agents Activity with linked Issue`、`Run Dialog`、`Completion Confirmation`.
- Codex resume / completion prompt injection and Git commit detection remain mandatory Spike gates before Epic 5 `agent_auto_commit` implementation.
- Story 4.4 needs wording cleanup so pre-Epic-5 Header behavior does not conflict with final completion behavior.
- Technical enabler / Spike / Gate items should be labeled separately from normal feature stories.
- `<960px` window behavior and Command Palette shortcuts remain open assumptions and must not be required for core flow completion.

### Recommended Next Steps

1. Patch `_bmad-output/planning-artifacts/epics.md` to reorder Story 2.6 before Story 2.3, or convert it into a formal precondition gate for Story 2.3.
2. Patch Epic 2 and Epic 3 acceptance criteria to remove overclaims around `crashed` / `stopped` behavior before Epic 4.
3. Add an Epic 1 quality gate story for CI and local verification scripts.
4. Label Story 1.2 as an Enabler Story, Stories 2.8 / 2.9 as Spike Gates, and keep Gate 5.10 out of normal delivery velocity.
5. Optionally generate or review four key-screen mockups before building the first UI surfaces.

### Final Note

This assessment identified 11 issues or risks across 4 categories:

- 0 critical violations
- 3 major epic/story readiness issues
- 3 minor story quality concerns
- 5 UX / Spike / assumption warnings

Address the 3 major issues before proceeding to implementation. The remaining minor concerns and warnings can be handled during artifact cleanup or early implementation planning, but they should stay visible as gates or explicit assumptions.

**Assessor:** Codex using `bmad-check-implementation-readiness`
**Assessment Date:** 2026-06-04
