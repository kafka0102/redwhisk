# ADR 0014：SQL 收敛至 repository，确立 service / repository 事务边界

## 状态

采纳（主体已执行；残余项见清单）。[ADR-0013](./0013-feature-first-module-organization.md) 的 feature 边界已落地，本 ADR 由草案转采纳。

## 背景

后端重构方案 P2（feature-first 重组后的收尾阶段）。普查 `features/` 层直接碰 DB（`prepare` / `query_row` / `execute`）主要集中在：`features/issue/service.rs` **73 处**（含 10 处 `unchecked_transaction()`）、`features/agent_session/service.rs` **39 处**（含 10 处 `unchecked_transaction()`）、`features/project_terminal/service.rs` 1 处；事务内直接 `prepare` / `execute` / `query_row`。

但 `db/` 层**已提供 30+ 个 `*_in_transaction(&Transaction)` 方法**：`issue_repository` 8 个、`agent_session_repository` 11 个，`issue_attachment` / `issue_completion_flow` / `completion_attempt` / `event` 各若干。手法已成熟，只是没有贯彻。

根因：service 经 `self.issue_repository.connection()` 拿到原始 `Connection`，自己开事务、自己拼 SQL；repository 的 `*_in_transaction` 只覆盖了部分写操作，剩余被 service 内联。`db/connection.rs` 仅 61 行（`open` + `PRAGMA foreign_keys`），无统一事务入口与错误转换抽象，各 service 各自 `map_err(database_error)`。

## 决定

1. **service 层禁止直接 `prepare` / `execute` / `query_row` / 裸 SQL**；所有 SQL 归 repository。
2. **service 保留事务编排权**：通过统一入口开 `Transaction`，把 `&Transaction` 传给各 repository 的 `*_in_transaction`。事务边界在 service（它知道跨聚合原子性），SQL 在 repository。
3. **repository 补齐缺失的 `*_in_transaction` 写方法**，覆盖 service 现有全部直连写；移除 service 内联 SQL。
4. **`repository.connection()` 访问器收敛为「仅用于开事务 / 读 data_dir」**，不得用于 `prepare`。
5. **`db/connection.rs` 扩展**：统一事务入口与 `rusqlite::Error → CommandError` 转换，消除各 service 重复的 `map_err(database_error)`。
6. **文件 IO 收敛**：`read_previewable_text_file` / `delete_attachment_files` / `cleanup_created_files` 等收进 feature 内 `io` 模块或 `shared/fs`，service 不直接 `std::fs`。

### 边界速查

| 层 | 允许 | 禁止 |
| --- | --- | --- |
| `commands/` | 参数校验、调 service、错误映射 | 碰 `rusqlite`、碰文件系统 |
| `features/<feature>/service` | 业务编排、事务边界声明、调 repository | ❌ 直接 `prepare` / `execute` / 裸 SQL |
| `db/` repository | 所有 SQL、行 ↔ record 映射、单表与跨表事务 | 业务判断、文件 IO |

## 执行清单

逐 feature 推进，每步补集成测试钉死行为（`src-tauri/tests/<feature>.rs`）。repository 手法（`*_in_transaction(&Transaction)`）已成熟，迁移以「service 开事务传 `&Transaction`、SQL 全归 repository」为单元。

### 已完成

- **issue 完成流 blocked 写入收口**：`record_blocked_completion_attempt`（原 `features/issue/completion/flow.rs` 的 helper）下沉为 `CompletionAttemptRepository::record_blocked_in_transaction`，blocked attempt 的 `changed_files_json` 形状与 `GitOperationBlocked` 结果映射归 repository；调用方传已格式化的 `operation_state_str` 与 `created_at`，避免 db 层反向依赖 git 模块。
- **`features/issue/service.rs` 生产路径 SQL 清空**：时间轴查询 → `EventRepository::list_issue_timeline_rows`；评论写入 / 幂等查询 → `IssueCommentRepository`；交付摘要 `try_publish_completion_comment` 的 turn / issue / profile 查询 → `AgentSessionRepository` / `AgentProfileRepository`；标题描述更新 → `IssueRepository::update_title_and_description_in_transaction`。`create_issue` / `update_issue` / `delete_issue` / `mark_issue_review` / 状态推进与回滚等事务块此前已只编排 `*_in_transaction`。
- **`features/agent_session/service.rs` 生产路径 SQL 清空**：结构化 standalone 插入下沉为 `AgentSessionRepository::insert_structured_in_transaction`；其余写路径此前已走 repository，service 仅保留 `unchecked_transaction()` 开事务。
- **`features/project_terminal/service.rs`**：生产路径无内联 SQL（仅 `connection()` 组装 repository）。
- **文件 IO**：附件预览 / 删除 / 草稿等已落在 `features/issue/attachment.rs`，service 不直接拼 SQL；`std::fs` 仍可能出现在 feature 内 IO 辅助（非本 ADR SQL 边界核心）。

### 待执行（收尾）

1. **`repository.connection()` 访问器收敛**：限定为「仅用于开事务 / 读 data_dir / 组装同库 repository」，禁止业务 SQL；可考虑类型封装或 lint 规则防止回潮。
2. **`db/connection.rs` 扩展**：统一事务入口与 `rusqlite::Error → CommandError` 转换。注意各 feature 错误码不同（`IssuePersistenceFailed` / agent session 等），转换需可注入 code 或保持 feature 侧 `map_err`。
3. **单测内种子 SQL**：`service` 与 `tui_start_tests` 等测试模块仍可直连 `execute` 铺数据；不计入生产边界，可选后续改为 repository / fixture helper。

## 后果

- service 只见 record 与事务编排，SQL 全在 repository，可单测、可审计。
- 跨表事务（issue + agent_session + completion_flow）仍由 service 编排，repository 不感知跨聚合业务规则。
- 代价：主体迁移已完成；后续代价集中在 `connection()` 收敛与统一事务入口，避免 service 再次内联 SQL。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| repository 提供「Unit of Work」聚合多 repo | 过度抽象；当前 `*_in_transaction(&tx)` 签名已够，service 编排更直接 |
| 跨表操作整体封进单 repository 方法（如 `complete_issue_in_transaction`） | repository 被迫知道跨聚合业务规则，职责越界 |
| 引入 `Repository<T>` 泛型基类 / ORM / 查询构造器 | Rust 反模式；现有 per-aggregate repository 更清晰、零成本 |
| service 完全无事务感知，repository 各自提交 | 破坏跨表原子性（issue 完成需 issue + session + flow 同生共死） |

## 事实来源

- 散落：`src-tauri/src/features/issue/service.rs`（73 处 SQL、10 处 `unchecked_transaction`）、`src-tauri/src/features/agent_session/service.rs`（39 处 SQL、10 处 `unchecked_transaction`）。
- 先例：`src-tauri/src/db/{issue,agent_session,issue_attachment,issue_completion_flow,completion_attempt,event}_repository.rs` 的 `*_in_transaction`。
- 连接：`src-tauri/src/db/connection.rs`（待扩展统一事务入口与 `rusqlite::Error -> CommandError` 转换）。
