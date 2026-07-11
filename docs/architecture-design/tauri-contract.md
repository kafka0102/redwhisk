# Tauri Command 与 Event 契约

本文档是跨 React/Rust 边界的导航和变更清单。完整字段以 `src-tauri/src/types/`、对应前端 `*-commands.ts` 及 `src-tauri/src/lib.rs` 的 `generate_handler!` 为准。

## 固定约定

- Rust command 用 `snake_case` 动词短语；前端 wrapper 用 `camelCase`，统一经 `invokeCommand` 调用。
- DTO struct 用 `#[serde(rename_all = "camelCase")]`；状态 enum 用 `snake_case`。ID 与 epoch milliseconds 时间在前端均为 `number`。
- 成功结果返回显式 DTO；列表包进对象，如 `{ issues: IssueRecord[] }`。
- 失败返回 `CommandError`：`code`、`message`、可选 `reason`、可选 `details`；每个 detail 必须有 `@type`。
- 前端以 `getCommandErrorMessage(error, t)` 做本地化；Rust 不返回面向 locale 的文案逻辑。

## Command 注册表

| 分组         | Command                                                                                                                                                            | 前端 wrapper / 类型                                                 | Rust adapter                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------- |
| 初始化       | `initialize_local_data`                                                                                                                                            | `features/project/project-commands.ts`                              | `commands/core_commands.rs`              |
| 项目         | `create_project`、`list_projects`、`open_project`、`open_project_window`、`update_project_settings`、`validate_project_repo_path`                                  | `features/project/project-commands.ts`                              | `commands/project_commands.rs`           |
| Issue        | `list_issues`、`create_issue`、`update_issue`、附件 draft/preview/export、`mark_issue_review`、`advance_issue_status`、完成 flow、summary、delete 与 worktree 清理 | `features/issues/issue-commands.ts`                                 | `commands/issue_commands.rs`             |
| 会话         | session 列表/启动/标题/attention、结构化启动与恢复、消息、取消、权限、模型/思考/模式、附件、timeline                                                               | `features/agents/agent-session-commands.ts`                         | `commands/agent_session_commands.rs`     |
| 工作区查看   | changes、file tree、commit history、file、diff                                                                                                                     | `features/agents/session-workspace-commands.ts`                     | `commands/session_workspace_commands.rs` |
| 项目终端     | 创建、读写、恢复、resize、关闭、配置与快捷命令、cwd                                                                                                                | `features/terminals/project-terminal-commands.ts`                   | `commands/project_terminal_commands.rs`  |
| Settings     | command 检测、profile、label、保存的 skill CRUD                                                                                                                    | `features/settings/settings-commands.ts`                            | `commands/settings_commands.rs`          |
| Skill 索引   | `list_agent_skills`、`refresh_agent_skills`                                                                                                                        | `features/settings/settings-commands.ts`                            | `commands/agent_skill_commands.rs`       |
| 会话监控窗口 | 打开/关闭 monitor、列出与定位会话                                                                                                                                  | `features/agents/session-notifications/session-monitor-commands.ts` | `commands/session_monitor_commands.rs`   |

新增 command 必须同时更新 Rust DTO、adapter、`generate_handler!`、前端 wrapper、类型和成功/失败路径测试；不要只在本表新增名称。

## Event 注册表

| 事件                            | 载荷                                                                            | 生产者                        | 消费者与语义                                                 |
| ------------------------------- | ------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------ |
| `agent-session-stream-event`    | `AgentStreamEventEnvelope`（`projectId`、`sessionId`、`seq`、`epoch`、`event`） | `agent_event_broadcaster.rs`  | 结构化 Codex/Claude 会话事实；前端只渲染，不借事件写业务状态 |
| `agent-session-terminal-output` | PTY 输出事件                                                                    | `lib.rs` 的 PTY output sink   | 项目终端的实时字节输出；不用于结构化 Agent 会话              |
| `agent-skills-updated`          | `AgentSkillsUpdatedEvent`                                                       | `agent_skill_commands.rs`     | 全局或项目 skill 索引刷新完成                                |
| `open-agent-session`            | `OpenAgentSessionEventPayload`                                                  | `session_monitor_commands.rs` | 通知目标窗口定位指定项目与会话                               |

新增 event 必须有 kebab-case 名、定位实体 ID、Rust payload 类型、前端 listener 的释放逻辑和至少一条序列/重连行为测试。

## 结构化消息流的稳定部分

`AgentStreamEvent` 的顶层事件包含 thread/turn 生命周期、timeline、usage、permission、mode/model/effort 更新。`timeline` 是可判别 union，含用户/助手消息、reasoning、tool call、todo、error 与 compaction。完整枚举在 `src-tauri/src/types/agent_session_stream.rs`；前端 reducer 与卡片渲染必须为未知 provider 细节保留安全降级，而非假设只会出现 Codex 私有字段。

## 错误码边界

错误码定义在 `src-tauri/src/types/errors.rs`。现有分类是 Local Data、Project、Issue、Agent Profile/Command/Session、Project Terminal、Settings 的验证、持久化或启动错误。新增可预期失败优先归入现有领域；新增错误码时同步添加前端 locale 映射和 command client 测试。
