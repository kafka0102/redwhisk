# Tauri Command 与 Event 契约

本文档是跨 React/Rust 边界的导航和变更清单。完整字段以 `src-tauri/src/types/`、对应前端 `*-commands.ts` 及 `src-tauri/src/lib.rs` 的 `generate_handler!` 为准。重构后 command 实现位置见注册表 adapter 列；wrapper 可能位于 `features/<feature>/` 或 `shared/commands/`（全局/跨 feature 命令在后者）。

## 固定约定

- Rust command 用 `snake_case` 动词短语；前端 wrapper 用 `camelCase`，统一经 `invokeCommand` 调用。
- DTO struct 用 `#[serde(rename_all = "camelCase")]`；状态 enum 用 `snake_case`。ID 与 epoch milliseconds 时间在前端均为 `number`。
- 成功结果返回显式 DTO；列表包进对象，如 `{ issues: IssueRecord[] }`。
- 失败返回 `CommandError`：`code`、`message`、可选 `reason`、可选 `details`；每个 detail 必须有 `@type`。
- 前端以 `getCommandErrorMessage(error, t)` 做本地化；Rust 不返回面向 locale 的文案逻辑。
- **Agent Session 新建**必须关联 Issue：仅 `start_agent_session`（及 Issue 完成相关注入等既有路径）；不存在、不得再注册无 Issue / structured standalone 新建 command（[ADR-0024](../adr/0024-agent-session-must-link-issue.md)）。历史独立 Session 的 list / resume / delete / title 等非新建 command 仍可保留。

## Command 注册表

| 分组         | Command                                                                                                                                                            | 前端 wrapper / 类型                                                 | Rust adapter                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------- |
| 初始化       | `initialize_local_data`                                                                                                                                            | `features/project/project-commands.ts`                              | `commands/core_commands.rs`              |
| 项目         | `create_project`、`list_projects`、`remove_project_from_list`、`delete_project`、`open_project`、`open_project_window`、`update_project_settings`、`validate_project_repo_path`                                  | `features/project/project-commands.ts`                              | `features/project/commands.rs`           |
| Issue        | `list_issues`、`create_issue`、`update_issue`、附件 draft/preview/export、`mark_issue_review`、`advance_issue_status`、完成 flow、summary、`get_issue_timeline`、delete、`prepare_agent_commit_completion`、`send_agent_commit_prompt`、`detect_agent_commit_completion`、`get_issue_worktree_status`、`delete_issue_worktree` | `features/issues/issue-commands.ts`                                 | `features/issue/commands.rs`             |
| 会话         | session 列表/Issue 启动/标题/attention、`get_project_git_branches`、`inject_agent_session_prompt`、结构化恢复、`delete_agent_session`、消息、取消、权限、模型/思考/模式、附件、timeline、TUI 终端 write/resize/restore/subscribe/read（新建须关联 Issue，无 standalone 新建 command） | `features/agents/agent-session-commands.ts`                         | `features/agent_session/commands.rs`、`tui_terminal_commands.rs` |
| 工作区       | changes、`list_code_workspace_roots`、file tree、commit history、file、diff、`search_project_worktree_content`、`pull_project_worktree`、`push_project_worktree`、`delete_code_workspace_worktree`                                                      | `shared/workspace/workspace-commands.ts`                            | `features/agent_session/workspace_commands.rs` |
| 项目终端     | 创建、`create_temporary_project_terminal`、`list_project_terminals`、`subscribe_project_terminal_output`、`unsubscribe_project_terminal_output`、读写、恢复、resize、关闭、配置与快捷命令、cwd、`set_app_theme` | `features/terminals/project-terminal-commands.ts`                   | `features/project_terminal/commands.rs`  |
| Settings     | command 检测、`test_agent_command`、profile、`preview_agent_command_args`、label、保存的 skill CRUD、`get_user_profile`、`update_user_profile`                       | `features/settings/settings-commands.ts`                            | `features/settings/commands.rs`          |
| Skill 索引   | `list_agent_skills`、`refresh_agent_skills`                                                                                                                        | `features/settings/settings-commands.ts`                            | `features/settings/agent_skill_commands.rs` |
| 会话监控窗口 | 打开/关闭 monitor、列出与定位会话                                                                                                                                  | `features/agents/session-notifications/session-monitor-commands.ts` | `features/agent_session/session_monitor_commands.rs` |
| 应用更新     | `get_update_status`、`dismiss_update_prompt`                                                                                                                       | `shared/commands/app-update-commands.ts`                            | `features/app_update/commands.rs`        |
| 应用主题     | `set_app_theme`（当前挂在 `project_terminal` 模块，语义属应用级，未来宜迁出）                                                                                      | `shared/commands/app-commands.ts`                                   | `features/project_terminal/commands.rs`  |

新增 command 必须同时更新 Rust DTO、adapter、`generate_handler!`、前端 wrapper、类型和成功/失败路径测试；并同步更新本注册表对应行 + 错误码到前端 locale 的映射（见错误码边界表）。不要只在本表新增名称。

> 注册表路径以 `src-tauri/src/lib.rs` 的 `generate_handler!` 与各 feature 的 `commands.rs` 为准；ADR-0013 feature-first 重构后命令已下沉到 `features/<feature>/`，本表随之回写。

## Parity gate

`src-tauri/tests/dto_parity_export.rs`（`cargo test`）解析 `src/types/*.rs` 生成 `src/shared/commands/__parity__/rust-dto-signatures.json`（提交进仓）；`src/shared/commands/__parity__/dto-parity.test.ts`（`pnpm test:parity`）解析全部 `*-commands.ts` 并对比。改 Rust DTO 后须重生成快照并 commit；改前端 `*-commands.ts` 后 `pnpm test` 自动校验。drift 表现为测试失败。类型名差异登记在 `name-mapping.ts`，前端不需 mirror 的 Rust 类型登记在 `rustOnlyAllowlist`（每条带注释说明）。

## Event 注册表

| 事件                            | 载荷                                                                            | 生产者                        | 消费者与语义                                                 |
| ------------------------------- | ------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------ |
| `agent-session-stream-event`    | `AgentStreamEventEnvelope`（`projectId`、`sessionId`、`seq`、`epoch`、`event`） | `agent_event_broadcaster.rs`  | 结构化 Codex/Claude 会话事实；前端只渲染，不借事件写业务状态 |
| `agent-session-terminal-output` | PTY 输出事件                                                                    | `lib.rs` 的 PTY output sink   | 项目终端与 **tui** Agent Session 的实时字节输出；json 结构化会话不使用 |
| `agent-skills-updated`          | `AgentSkillsUpdatedEvent`                                                       | `agent_skill_commands.rs`     | 全局或项目 skill 索引刷新完成                                |
| `open-agent-session`            | `OpenAgentSessionEventPayload`                                                  | `session_monitor_commands.rs` | 通知目标窗口定位指定项目与会话                               |
| `agent-session-list-changed`    | 会话列表变更（`projectId`、`sessionId`、`reason`）                              | `agent_event_broadcaster.rs`、`features/agent_session/commands.rs`（`emit_agent_session_list_changed`） | 会话增删/标题/attention 变更；前端 `agents/agent-session-events.ts`（常量）、`agents/use-agent-session-list.ts`（`agents-activity.tsx` 间接消费）、`changes/use-changes-auto-refresh.ts` 据此去抖刷新 |
| `code-workspace-roots-updated`  | Code workspace 根目录变更                                                       | `features/agent_session/workspace_commands.rs`（`emit_code_workspace_roots_updated`） | worktree/code 根目录刷新；前端 `code/use-code-workspace-roots.ts` 重新拉取 |
| `update-prompt-changed`         | `UpdateStatus`                                                                  | `features/app_update/commands.rs` | 应用更新提示状态变更；前端 `app-update/use-update-status.ts` 刷新徽章 |
| `issue-timeline-changed`        | Issue 时间轴变更                                                                | `features/issue/completion_comment.rs`  | 评论自动发表后广播；前端 `issues/issue-detail/issue-timeline.tsx` 刷新当前 Issue 时间轴 |

新增 event 必须有 kebab-case 名、定位实体 ID、Rust payload 类型、前端 listener 的释放逻辑和至少一条序列/重连行为测试。事件名以 `pub const`（或文件内 `const`）定义；生产者封装为 `emit_*` 函数；跨窗口广播用 `emit_to`；前端 listener 必须在卸载时释放并覆盖序列/重连测试。

## 注册约定（feature-first 重构后）

- **A. feature-first command 落点**：`commands/` 仅保留 `core_commands.rs`（承载不属于任何 feature 的全局命令，如 `initialize_local_data`）；新命令一律落在 `features/<feature>/commands.rs` 或同 feature 下 `*_commands.rs`，并在 `src-tauri/src/lib.rs` 的 `generate_handler!` 注册。
- **D. DTO 跨边界同步**：event/命令 DTO 定义以 `src-tauri/src/types/` 为准；`lib.rs` 或 feature 内联的私有 payload struct（如 `TerminalOutputEventPayload`）不视为稳定契约，跨模块复用前须迁入 `types/`。
- **E. 前端 wrapper 路径判据**：被多 feature 复用或属全局应用级命令（主题、应用更新）的 wrapper 放 `shared/commands/`；领域专属命令放 `features/<feature>/`。
- **F. 错误码领域归属**：错误码按前缀归入领域，见「错误码边界」章节的「错误码前缀 -> 领域 -> adapter 模块」精简表，避免分类描述再次失同步；新增错误码同时更新该表与 `src-tauri/src/types/errors.rs`。

## 结构化消息流的稳定部分

`AgentStreamEvent` 的顶层事件包含 thread/turn 生命周期、timeline、usage、permission、mode/model/effort 更新。`timeline` 是可判别 union，含用户/助手消息、reasoning、tool call、todo、error 与 compaction。完整枚举在 `src-tauri/src/types/agent_session_stream.rs`；前端 reducer 与卡片渲染必须为未知 provider 细节保留安全降级，而非假设只会出现 Codex 私有字段。

## 错误码边界

错误码定义在 `src-tauri/src/types/errors.rs`。现有分类是 Local Data、Project、Issue（含 IssueWorktree 子类）、Agent Profile/Command/Session（含 `AgentSessionStartNotReady`、`AgentSessionUsesStructuredStream`、`AgentSessionModelUnavailable` 等细化码）、Project Terminal、Settings、UserProfile（`UserProfilePersistenceFailed`、`UserProfileValidationFailed`）、AppUpdate（`AppUpdatePersistenceFailed`、`AppUpdateValidationFailed`）的验证、持久化或启动错误。新增可预期失败优先归入现有领域；新增错误码时同步添加前端 locale 映射和 command client 测试。

错误码与领域归属精简表（详见 `src-tauri/src/types/errors.rs`）：

| 错误码前缀           | 领域               | adapter 模块                          |
| -------------------- | ------------------ | ------------------------------------- |
| `LocalData*`         | 本地数据初始化     | `commands/core_commands.rs`           |
| `Project*`           | 项目               | `features/project/commands.rs`        |
| `Issue*`             | Issue              | `features/issue/commands.rs`          |
| `IssueWorktree*`     | Issue Worktree     | `features/issue/commands.rs`          |
| `AgentSession*`      | Agent 会话         | `features/agent_session/commands.rs`  |
| `AgentProfile*`      | Agent Profile      | `features/settings/commands.rs`       |
| `AgentCommand*`      | Agent 命令检测     | `features/settings/commands.rs`       |
| `ProjectTerminal*`   | 项目终端           | `features/project_terminal/commands.rs` |
| `Settings*`          | 设置（label/skill）| `features/settings/commands.rs`       |
| `UserProfile*`       | 用户档案           | `features/settings/commands.rs`       |
| `AppUpdate*`         | 应用更新           | `features/app_update/commands.rs`     |
