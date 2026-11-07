# 数据模型与 Migration

SQLite 位于 `~/.redwhisk/redwhisk.sqlite3`，是业务状态唯一事实源。迁移文件位于 `src-tauri/migrations/`，由 `db/migrations.rs` 在 `BEGIN IMMEDIATE` 事务中按版本顺序执行。

## 核心实体关系

```text
projects
 ├─ issues ── issue_actions
 │     ├─ issue_attachments
 │     ├─ issue_comments
 │     ├─ issue_remote_comments
 │     ├─ issue_remote_events
 │     └─ issue_completion_flows
 ├─ project_forge_connections
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
| `projects`                              | 项目仓库与 worktree 配置 | `repo_path` 唯一；worktree root 策略与 setup command 属于项目。Issue 来源另有 `issue_source_mode`（`local` / `remote` / `mixed`，默认 `local`）、`issue_sync_scope`、`issue_sync_label`、`issue_sync_enabled`、`issue_sync_interval_seconds`（≥ 60，默认 90）、三个写回开关和 `issue_create_source` |
| `issues`                                | 项目内任务               | `project_id` 外键；状态受 CHECK；`number` 在项目内唯一；`del` 为软删除；`source` 为 `local` 或 `remote`，默认 `local`，迁移不改写已有标题、状态和删除标记 |
| `issue_external_refs`                   | GitHub / GitLab Issue 外部身份 | `issue_id` 主键并级联删除。`(provider, host, external_id)` 唯一，`(project_id, provider, host, repo, external_number)` 也唯一。`host` 是小写主机名。`sync_status` 由 `0064_issue_external_ref_recovery` 扩展为 `synced`、`error`、`unavailable`、`kept_local`、`unlinked`。同步成功写 `projects.last_issue_synced_at` 并清空 `last_issue_sync_error`；凭据过期或缓存失败只更新错误码，不删除 Issue。`kept_local` 与 `unlinked` 后续同步跳过 |
| `project_forge_connections`             | 项目 Forge 连接快照      | `project_id` 主键并级联删除；`provider` 仅 `github` / `gitlab` 或空；`auth_status` 为 `unknown` / `ready` / `expired` / `unauthenticated` / `cli_missing` / `not_forge`；未探测则没有行。不存 token |
| `agent_sessions`                        | Agent 业务会话快照       | 可关联 Issue；活动关联有 partial unique index；记录 workspace、provider、turn、处理时长（json 由后台心跳按活跃时长累加、含进行中的 Turn；Codex 的 tui 取 session log 各 turn 处理耗时之和）与 Session Token 消耗三项累计（`token_input` / `token_output` / `token_cache`，json 来自结构化用量事件、Codex 的 tui 来自 session log 线程累计快照，尚未收到用量为 NULL） |
| `issue_actions` / `session_events`      | 审计                     | payload 为 JSON 字符串，按实体与时间索引                                                     |
| `issue_comments`                        | 本地评论正文             | `UNIQUE(linked_session_id, linked_turn_id)` 只约束本地 Agent 评论。正文不进 `issue_actions` 负载 |
| `issue_remote_comments`                 | 远程评论                 | `(issue_id, remote_comment_id)` 唯一。不写入 `issue_comments`，不进入本地评论唯一键 |
| `issue_remote_events`                   | 远程系统事件             | `(issue_id, remote_event_id)` 唯一。不写入 `issue_actions`，也不进入本地评论唯一键 |
| `issue_completion_flows`                | 完成流程状态             | 每 Issue 最多一条；phase 见状态机                                                            |
| `issue_completion_writebacks`           | 完成写回幂等与待写回     | 每 Issue 一条。`completion_method` 为 `merge_to_base` 或 `open_pull_request`。失败把 `error_code` 留下，不改 `issues.status`。成功关闭或评论后不重复执行 |
| `agent_profiles`                        | provider 配置            | `agent_type` 为 `codex` 或 `claude`；scope 为 `project` 或 `global`；软删除                  |
| `issue_attachments`                     | Issue 落盘附件元数据     | 路径、种类、大小和 preview 能力；Issue 删除级联                                              |
| `project_labels` / `saved_agent_skills` | 设置域                   | scope + 可选 `project_id`；label 不再关联 agent profile                                      |
| 终端配置两表                            | 项目终端声明与快捷命令   | 项目删除级联                                                                                 |
| `change_requests`                       | PR/MR 列表快照           | `0065_change_requests` 新增。`state` 为 `open` / `draft` / `merged` / `closed`。唯一键是项目、provider、host、repo、number，另有 `(provider, host, external_id)`。`host` 小写。检查计数可空，三者都空表示未知。`remote_updated_at` 是 epoch milliseconds |
| `change_request_issue_links`            | PR/MR 与 Issue 多对多    | 主键是 `(change_request_id, issue_id)`。`link_kind` 为 `closing` / `mentioned` / `branch` / `manual` |
| `change_request_details`                | PR/MR 详情快照           | 每个 change request 一条。文件、检查、评审、评论 JSON 默认 `[]` |
| `issue_pull_requests.change_request_id` | 历史 URL 升级            | 可空，引用 `change_requests`。解析失败保持 null，URL 原文不变 |

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
6. `0060_project_issue_source_settings` 给已有项目和 Issue 补默认来源，并新建 `project_forge_connections`。不修改已发布 migration。
7. `0061_issue_external_refs` 只新增项目同步水位、最后错误和 `issue_external_refs`。不修改 `0060`，也不回写已有 Issue 的标题、状态、`del` 或 `source`。
8. `0062_issue_remote_comments` 新增 `issue_remote_comments` 与 `issue_remote_events`。两表都不进入本地 `issue_comments` 的唯一键。重复的远程 id 不新增第二行，失败写入不清空已有行。
9. `0063_issue_completion_writeback` 新增 `issue_completion_writebacks`。不修改已发布 migration，也不回滚已经成立的本地完成。
10. `0065_change_requests` 新增 `change_requests`、`change_request_issue_links`、`change_request_details`，并给 `issue_pull_requests` 增加可空 `change_request_id`。不修改已发布 migration。登记列表从 `0059` 起移到 `db/migration_list_tail.rs`。

不得从 React 直接读写 SQLite，也不得用前端缓存替代状态事实源。
