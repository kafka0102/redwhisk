# 数据模型与 Migration

SQLite 位于 `~/.redwhisk/redwhisk.sqlite3`，是业务状态唯一事实源。迁移文件位于 `src-tauri/migrations/`，由 `db/migrations.rs` 在 `BEGIN IMMEDIATE` 事务中按版本顺序执行。

## 核心实体关系

```text
projects
 ├─ issues ── issue_actions
 │     ├─ issue_attachments
 │     └─ issue_completion_flows
 ├─ agent_profiles（project / global scope）
 ├─ agent_sessions ── session_events
 ├─ project_terminal_configs
 ├─ project_terminal_shortcut_commands
 └─ project_labels

saved_agent_skills 可为 global 或 project scope；issues.label_ids 保存标签 ID JSON。
completion_attempts 保留历史完成尝试审计。
```

## 表与责任边界

| 表                                      | 责任                     | 关键约束/事实                                                                                |
| --------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `projects`                              | 项目仓库与 worktree 配置 | `repo_path` 唯一；worktree root 策略与 setup command 属于项目                                |
| `issues`                                | 项目内任务               | `project_id` 外键；状态受 CHECK；`number` 在项目内唯一；`del` 为软删除                       |
| `agent_sessions`                        | Agent 业务会话快照       | 可关联 Issue；活动关联有 partial unique index；记录 workspace、provider、turn 与处理耗时事实 |
| `issue_actions` / `session_events`      | 审计                     | payload 为 JSON 字符串，按实体与时间索引                                                     |
| `issue_completion_flows`                | 完成流程状态             | 每 Issue 最多一条；phase 见状态机                                                            |
| `agent_profiles`                        | provider 配置            | `agent_type` 为 `codex` 或 `claude`；scope 为 `project` 或 `global`；软删除                  |
| `issue_attachments`                     | Issue 落盘附件元数据     | 路径、种类、大小和 preview 能力；Issue 删除级联                                              |
| `project_labels` / `saved_agent_skills` | 设置域                   | scope + 可选 `project_id`；label 不再关联 agent profile                                      |
| 终端配置两表                            | 项目终端声明与快捷命令   | 项目删除级联                                                                                 |

## 数据约定

- 表名为复数 snake_case；主键 `id INTEGER PRIMARY KEY`；外键使用 `{entity}_id`。
- 跨 Tauri 边界字段用 camelCase；全局 `id` 和 epoch milliseconds 时间用 `number`。
- 业务缺失值为 `null`，空集合为 `[]`；JSON 列以 `*_json` 命名。
- 历史表中 `project_labels.created_at/updated_at` 使用 ISO 文本；不要据此把其他实体的 epoch milliseconds 约定改掉。
- `number` 用于项目内展示和命名，不能替代跨边界的全局 `id`。

## 新增或修改 Migration

1. 只新增按序编号的 SQL 文件，不修改已发布 migration。
2. 在 `db/migrations.rs` 注册版本和 `include_str!`，保证 `default_migrations()` 的顺序正确。
3. 设计历史数据回填、`NOT NULL` 默认值、CHECK/索引与失败回滚；需要表重建时保留全部仍有效字段和索引。
4. 同步 repository、Rust DTO、前端类型、状态机文档和必要测试。
5. 用新库与已迁移库验证升级；迁移执行后检查唯一索引和外键行为。

不得从 React 直接读写 SQLite，也不得用前端缓存替代状态事实源。
