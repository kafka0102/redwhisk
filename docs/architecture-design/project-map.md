# 项目代码地图

本文档帮助开发 Agent 从用户可见能力快速定位实现入口。它描述当前代码事实；数据结构、状态与跨边界载荷以对应契约文档和源码为准。

## 从界面到代码

| 能力                                    | 前端入口                            | 跨边界与 Rust 核心                                                                              | 持久化                                                                   |
| --------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 应用壳、窗口 surface、Activity 路由     | `src/app/`                          | `src-tauri/src/commands/project_commands.rs`、`session_monitor_commands.rs`                     | `projects`                                                               |
| 项目创建、切换与设置                    | `src/features/project/`             | `core/project_service.rs`                                                                       | `projects`                                                               |
| Issue、附件、标签与完成流程             | `src/features/issues/`              | `commands/issue_commands.rs`、`core/issue_service.rs`                                           | `issues`、`issue_attachments`、`issue_actions`、`issue_completion_flows` |
| 智能体会话、消息流、权限与工作区查看器  | `src/features/agents/`              | `commands/agent_session_commands.rs`、`core/agent_session_service.rs`                           | `agent_sessions`、`session_events`                                       |
| Agent provider 协议适配                 | 无直接 UI 入口                      | `src-tauri/src/agent/codex_app_server/`、`agent/claude_streaming/`、`agent/session_handle.rs`   | session 快照与运行时日志                                                 |
| 项目终端与快捷命令                      | `src/features/terminals/`           | `commands/project_terminal_commands.rs`、`core/project_terminal_service.rs`                     | `project_terminal_configs`、`project_terminal_shortcut_commands`         |
| 项目/全局设置、配置、标签、保存的 skill | `src/features/settings/`            | `commands/settings_commands.rs`、`commands/agent_skill_commands.rs`、`core/settings_service.rs` | `agent_profiles`、`project_labels`、`saved_agent_skills`                 |
| 基础 UI、i18n、命令错误和全局样式       | `src/components/ui/`、`src/shared/` | 前端边界；`types/errors.rs` 定义错误契约                                                        | locale JSON、浏览器偏好                                                  |

## 分层与依赖方向

```text
React feature / shared command wrapper
        ↓ Tauri command（参数承接、状态注入、错误映射）
Rust core service（业务规则、状态流转、事务编排）
        ↓
repository / git / agent provider / PTY / 文件系统
        ↓
SQLite、Git worktree、子进程、~/.redwhisk
```

`commands/` 不承载业务状态机；`core/` 不让前端绕过；`db/` 只负责连接、migration、SQL 映射。新增共享逻辑必须归属明确领域，不能扩充 `src/lib/utils.ts`。

## 按改动定位

| 改动类型                        | 先读                                                    | 最小核对范围                                                         |
| ------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| 页面或交互                      | 本文、设计指南、i18n 规则                               | 相邻 feature、对应 `*-commands.ts`、组件测试                         |
| Tauri command / DTO / event     | [Tauri 契约](./tauri-contract.md)                       | Rust command、`generate_handler!`、前端 wrapper、Rust/前端类型、测试 |
| Issue 或会话状态                | [状态机](../domain/state-machine.md)                    | core service、审计表、相关 dialog 与列表                             |
| SQLite / repository / migration | [数据模型](../domain/data-model.md)                     | migration runner、repository、DTO、历史升级测试                      |
| Codex / Claude 会话             | [Provider 协议](./agent-provider-protocol.md)           | `AgentSessionHandle`、事件归一化、timeline reducer、权限与取消路径   |
| Worktree / 完成流程             | [Worktree 与 Git 生命周期](./worktree-git-lifecycle.md) | `git/worktree.rs`、完成 flow、Issue UI、清理与阻断路径               |
| 测试或验证                      | [测试策略](../testing/strategy.md)                      | 最接近的现有测试与相应命令                                           |

## 运行时数据边界

- 业务 SQLite：`~/.redwhisk/redwhisk.sqlite3`。
- 后端操作日志：`~/.redwhisk/logs/YYYY-MM.log`。
- Agent session 日志：`~/.redwhisk/session-logs/`，含 runtime 与 archive 子目录。
- SQLite 是业务状态事实源；前端只能通过 Tauri command 修改业务状态。
- `src-tauri/tauri.conf.json` 的 asset protocol 仅允许 `~/.redwhisk/**/*`，修改本地文件访问方式时必须同步核对该 scope。

## 保鲜规则

修改 command、事件、状态枚举、migration、provider 能力或目录归属时，同次变更更新本文指向的事实文档。文档只记录稳定契约与导航；完整字段定义始终链接到 Rust DTO、前端类型和 migration，避免复制整份类型后漂移。
