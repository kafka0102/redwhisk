# PRD Addendum：RedWhisk MVP 技术与计划补充

本文档保存 PRD 主体之外但对后续架构、Spike、故事拆分有价值的内容。它不扩大 MVP 范围；如与 `prd.md` 冲突，以 `prd.md` 中的功能需求、非目标和 MVP 范围为准。

## 1. 输入来源

- `_bmad-output/brainstorming/brainstorming-session-2026-06-02-222104.md`
- 用户本轮约束：使用 `bmad-prd` 创建 PRD；采用 Fast path；基于已确认的 MVP scope freeze；不再扩大 MVP 范围；默认使用简体中文输出。

## 2. 已冻结的 MVP 判断

- 产品定位：VS Code 形态的 Agent 工作台，不是桌面版 Agent Kanban。
- 核心闭环：Git Workspace -> 本地 Issue -> Run Codex -> 内嵌 Codex Session -> Mark Review -> 继续修正或完成 -> Summary/Log。
- 首个 Agent：Codex。
- MVP 必须内嵌终端，不接受外部终端作为主路径。
- Issue 与 Agent Session 是分离的一等实体，通过关联关系和跳转联动。
- MVP 保持一 Issue 一 Agent Session。
- Agent Session 可以不关联 Issue，用于当前 Workspace 下的临时 Codex 交互；临时 Agent Session 不参与 Issue 状态流转和 Completion Policy。
- Issue 状态：`backlog`、`running`、`review`、`completed`。
- Agent Session 状态：`running`、`closed`、`crashed`、`stopped`。`crashed` 表示 Codex 进程异常退出；`stopped` 表示应用生命周期中断后原 `running` PTY 无法恢复。
- Agents Activity 左侧 Session 展示分组固定包含 `Running` 和 `Completed`，不按 `Review` 分组。
- 等待用户输入不是 Agent Session 主状态，用 `attention=none|requested` 表示。
- `review` 阶段允许继续让 Codex 修正，Issue 不退回 `running`。
- Completion Policy：`manual | agent_auto_commit`。
- `agent_auto_commit` 不等于应用直接 `git add .`，而是向当前 Codex Session 注入 completion prompt，并由应用检测 Git 结果。

## 3. MVP 模块边界

| 模块 | MVP 职责 | 明确不做 |
| --- | --- | --- |
| Tauri Shell | 桌面应用外壳、窗口生命周期、文件夹选择、基础设置入口、前后端连接 | 多窗口工作区、插件宿主、云同步 |
| React Workbench | Activity Bar、Issues Activity、Agents Activity、Workspace Settings、Run Dialog、Session Dialog、Issue Inspector、xterm 容器 | 完整代码编辑器、完整 Git GUI、复杂看板字段 |
| Rust Core | Workspace 校验、Agent command 检测、PTY 进程管理、AgentAdapter、Git status/HEAD 检测、状态变化、SQLite 写入 | 直接自动提交、复杂 merge/rebase、长期后台 daemon |
| SQLite Store | Workspace、Issue、AgentProfile、AgentSession、SessionEvent、IssueAction、CompletionAttempt 等结构化事实 | 逐字符终端日志、跨设备同步 |
| Log Files | 保存原始终端输出，按 Agent Session 组织日志路径 | 结构化查询、富文本渲染 |
| CodexAdapter | 启动 Codex、写入 prompt、resume、注入 completion prompt、解析基础事件 | 重写 Codex UI、完全可靠理解 TUI 所有状态 |

## 4. Command/Event 同步模型

React Workbench 不直接写核心业务状态。前端通过 Tauri command 请求 Rust Core 执行动作；Rust Core 校验条件、执行本地动作、写入 SQLite，并通过事件通知前端刷新。前端可以显示 loading，但最终状态以 Core 返回值和 Core 事件为准。

| UI 动作 | Tauri command | Core 输出事件 | 持久化记录 |
| --- | --- | --- | --- |
| 创建 Workspace | `create_workspace(repo_path)` | `workspace_created` | Workspace、WorkspaceSettings |
| 创建 Issue | `create_issue(workspace_id, input)` | `issue_created` | Issue、IssueAction |
| 保存 Agent Profile | `save_agent_profile(input)` | `agent_profile_saved` | AgentProfile |
| 测试 command | `test_agent_command(command)` | `agent_command_tested` | 可选 IssueAction 或 AuditLog |
| 启动 Agent Session | `start_agent_session(issue_id, profile_id, prompt)` | `session_started` 或 `session_start_failed` | AgentSession、SessionEvent、IssueAction |
| 启动临时 Agent Session | `start_standalone_agent_session(input)` | `session_started` 或 `session_start_failed` | AgentSession、SessionEvent |
| 标记 review | `mark_issue_review(issue_id)` | `issue_review_marked` | Issue、IssueAction |
| 注入 completion prompt | `complete_issue_with_policy(issue_id, option)` | `completion_prompt_sent`、`issue_completed` 或 `completion_failed` | SessionEvent、IssueAction、CompletionAttempt |
| 关闭 Agent Session | `close_agent_session(session_id)` | `session_closed` | AgentSession、SessionEvent |

## 5. 数据表草案

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `workspaces` | `id`、`name`、`repo_path`、`created_at`、`last_opened_at` | Git Repository 入口 |
| `workspace_settings` | `workspace_id`、`completion_policy`、`default_agent_profile_id`、`locale` | Workspace 级设置 |
| `issues` | `id`、`workspace_id`、`title`、`description`、`status`、`created_at`、`updated_at` | 极简本地 Issue |
| `agent_profiles` | `id`、`name`、`agent_type`、`command`、`default_args`、`default_skill`、`prompt_template`、`enabled` | 全局 Agent 配置 |
| `workspace_agent_overrides` | `workspace_id`、`agent_profile_id`、覆盖字段 | Workspace 级覆盖 |
| `agent_sessions` | `id`、`issue_id`、`title`、`agent_profile_id`、`codex_session_id`、`status`、`attention`、`working_dir`、`command_snapshot`、`prompt_snapshot`、`log_path`、`last_active_at`、`started_at`、`closed_at` | 一 Issue 一 Agent Session；`issue_id` 可为空表示临时 Agent Session |
| `session_events` | `id`、`session_id`、`event_type`、`payload_json`、`created_at` | Agent Session 关键事件 |
| `issue_actions` | `id`、`issue_id`、`action_type`、`payload_json`、`created_at` | Issue 状态和用户动作审计 |
| `completion_attempts` | `id`、`issue_id`、`session_id`、`option`、`head_before`、`head_after`、`changed_files_json`、`commit_hash`、`result`、`error`、`created_at` | 完成策略审计 |

## 6. Session Header / Issue 操作状态表

| Issue 状态 | Agent Session 状态 | 条件 | Header 主按钮 | 次按钮 | 状态变化 |
| --- | --- | --- | --- | --- | --- |
| `backlog` | 无 | Issues Activity / Issue 详情弹窗 | `Run` | `Edit Issue` | 启动成功后 Issue -> `running`，Agent Session -> `running` |
| `backlog` | 无 | Agent command 不可用 | `Run` 禁用 | `Configure Agent` | 无状态变化 |
| `backlog` | 已有关联 Agent Session | 异常历史数据或恢复场景 | `Open Session` | `Run` 禁用 | 无状态变化 |
| `running` | `running` | Header 显示关联 Issue | `Mark Review` | 打开 Issue Inspector | `Mark Review` 后 Issue -> `review`，Agent Session 保持 `running` |
| `running` | `running` | `attention=requested` | `Mark Review` | 打开 Issue Inspector | 用户处理后 attention -> `none` |
| `running` | `crashed` | Codex 进程异常退出 | `Open Log` | 打开 Issue Inspector | Issue 不自动 completed；resume 能力仅在 Spike 或后续故事明确实现后显示 |
| `review` | `running` | `completion_policy=manual` | `Complete Manually` | 打开 Issue Inspector | 确认后 Agent Session -> `closed`，Issue -> `completed` |
| `review` | `running` | `agent_auto_commit` 且有未提交改动 | `Complete with Agent Commit` | `Complete without Commit`、打开 Issue Inspector | 检测到新 commit 后 Agent Session -> `closed`，Issue -> `completed`；未检测到 commit 则 Issue 保持 `review` |
| `review` | `running` | `agent_auto_commit` 且无未提交改动 | `Complete` | 打开 Issue Inspector | Issue -> `completed`，Agent Session -> `closed` |
| `review` | `crashed` | Codex 异常退出但 Issue 待验收 | `Open Log` | 打开 Issue Inspector | Issue 保持 `review`；不显示会导致 completed 的完成确认；resume 能力仅在 Spike 或后续故事明确实现后显示 |
| `completed` | `closed` | 正常完成 | 无完成类主按钮 | `View Summary`、`Open Log`、打开 Issue Inspector | 无状态变化 |
| `completed` | `crashed` 或 `running` | 异常数据不一致 | `View Summary` | `Open Log` | 显示状态不一致警告，不自动修复 |
| 无关联 Issue | `running` 或 `closed` | 临时 Agent Session | 不显示 Issue 区域 | 无 Issue 操作 | 不触发 Issue 状态流转 |

## 7. React IA 冻结口径

- Activity Bar 只包含 `Issues`、`Agents`、`Settings`；`Settings` 指 Workspace Settings。
- Global Settings 通过左下角 gear 或原生顶部菜单打开。
- Issues Activity 使用 `Backlog`、`Running`、`Review`、`Completed` 四泳道。
- Issue 卡片只展示 `title`、`status`、`updated_at`，可显示 Agent Session 标记和 attention 标记。
- Issue 详情弹窗采用左右两栏；左侧编辑 `title` 和 `description`，右侧展示 Session 关联和操作按钮；不展示 `status` 和 `updated_at` 字段。
- Agents Activity 采用左右两栏：左侧 Session 列表，右侧 Codex Native Session View。
- Agents 左侧 `Running` 分组按 `last_active_at` 排序；`Completed` 分组按最近完成时间排序，默认只显示最近 20 条。
- Agents 左侧顶部的新建按钮打开 Session Dialog，用于创建不关联 Issue 的临时 Agent Session。
- Session Dialog 字段为 `title`、`agent_profile`、`prompt`、`Cancel`、`Start`，不展示 working directory、command 可用性或配置来源。
- 右侧 Session Header 只在当前 Agent Session 关联 Issue 时展示 Issue 标题和 Issue 操作；无关联 Issue 时不显示 Issue 区域，也不显示 `No linked issue`。
- 点击 Issue 标题打开 Issue Inspector，不切换路由，不卸载 xterm。

## 8. Button Copy

| 命令语义 | zh-CN | en-US |
| --- | --- | --- |
| `run_issue` | 运行 | Run |
| `open_session` | 打开会话 | Open Session |
| `mark_review` | 标记待验收 | Mark Review |
| `resume_session` | 继续会话 | Resume Session |
| `complete_manual` | 手动完成 | Complete Manually |
| `complete_agent_commit` | Agent 提交并完成 | Complete with Agent Commit |
| `complete_without_commit` | 不提交直接完成 | Complete without Commit |
| `view_summary` | 查看总结 | View Summary |
| `open_log` | 打开日志 | Open Log |
| `configure_agent` | 配置 Agent | Configure Agent |

## 9. Spike 计划

### Spike 1：Embedded Codex Terminal

目标是验证 Codex CLI 在 Tauri + xterm.js + Rust PTY 中是否有足够接近原生终端的体验。

验收清单：

- 能从 GUI 启动 `codex`，并继承用户 login shell 下可用的 PATH。
- xterm.js 能显示 Codex TUI 的主要界面、颜色和交互。
- 键盘输入、Enter、方向键、Ctrl+C、粘贴可用。
- 窗口 resize 后 PTY size 同步，Codex TUI 不严重错位。
- Codex 退出后 Rust Core 能获得 exit code。
- 原始输出能写入 Agent Session log 文件。
- macOS 先通过；Windows/Linux 记录兼容性风险，不阻塞 MVP 设计。

### Spike 2：Codex Session Resume 与 completion prompt 注入

目标是验证 review 后继续修正，以及完成时向当前 Codex Session 发送 completion prompt 的可行性。

验收清单：

- 能捕获或推断 Codex session id，并保存到 AgentSession。
- 在同一个 PTY 进程中能向 Codex 发送后续修正 prompt。
- 能向当前 Agent Session 注入 completion prompt，而不是启动一个无上下文的新进程。
- Codex 异常退出后，能通过 `codex resume <session_id>` 或等价方式恢复上下文。
- 无法稳定恢复时，降级为保留日志、提示用户手动处理，Issue 保持 `review` 或 `running`；UI 不显示不可执行的继续会话入口。

### Spike 3：Git Commit Detection

目标是验证 completion 前后 Git 状态检测，避免只相信 Agent 输出文本。

验收清单：

- completion 前记录 `HEAD`、`git status --porcelain`、changed files。
- completion 后重新读取 `HEAD` 和 status。
- 若 `HEAD` 改变，记录新 commit hash。
- 若 `HEAD` 未变但用户选择 Agent Commit，Issue 保持 `review` 并记录 `no_commit_detected`。
- 若出现 merge/rebase/cherry-pick 进行中状态，MVP 提示用户手动处理，不自动完成。

## 10. 开发切片和里程碑

| Milestone | 用户可见结果 | 必须完成 | 暂不包含 |
| --- | --- | --- | --- |
| M0 - Shell Spike | Tauri 窗口里能跑 Codex TUI | xterm、PTY、resize、输入输出、日志 | Issue、数据库、completion |
| M1 - Local Workspace Issues | 能创建 Git Workspace 和本地 Issue | SQLite、Workspace 校验、Issue CRUD、Issues Activity | Agent Profile 覆盖、review |
| M2 - Run Issue with Codex | 能从 Issue 启动 Codex Session | Agent Profile、Run Dialog、Agent Session 创建、Issue -> `running` | completion、resume |
| M3 - Review Loop | 能 Mark Review 并继续在同一 Codex 修正 | Session Header、Issue Inspector、attention、review 保持、Session 日志 | auto commit |
| M4 - Complete Loop | 能通过 manual 或 agent_auto_commit 完成 Issue | completion prompt、Git 检测、commit hash、Agent Session closed | PR/MR、完整 Diff |
| M5 - Recovery Polish | 重启后能复盘已完成任务和异常 Agent Session | Summary、Open Log、crashed/stopped 标记 | 活进程跨重启恢复 |

## 11. 信任风险清单

MVP 最大风险不是功能少，而是用户不相信工具的状态和完成判断。以下行为必须作为产品能力处理：

- 所有改变 Issue 状态的动作都写入 IssueAction。
- 所有 Agent 启动、关闭、异常和 completion prompt 注入都写入 SessionEvent。
- Run Dialog 展示最终 prompt。
- completion prompt 至少可展开查看。
- Complete with Agent Commit 前展示 Git 摘要和 changed files 数量。
- 未检测到 commit 时绝不自动 completed。
- Agent Session crashed 时不伪装成 completed。
- completed 后提供 Summary 和 Open Log。

## 12. 后续文档入口

- UX 设计：需要细化 Issues Activity、Issue 详情弹窗、Agents Activity、Session Header、Issue Inspector、Run Dialog、Session Dialog、completion 确认面板和异常状态文案。
- 架构设计：需要细化 Rust Core 状态机、PTY 管理、CodexAdapter、SQLite schema、迁移策略、日志路径策略和 Git 检测。
- 用户故事拆分：可以从 `prd.md` 的 FR-1 至 FR-26 直接拆出故事和验收标准。
