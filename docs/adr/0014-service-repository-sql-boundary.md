# ADR 0014：SQL 收敛至 repository，确立 service / repository 事务边界

## 状态

草案（Draft）。依赖 [ADR-0013](./0013-feature-first-module-organization.md) 的 feature 边界落地；P1（feature-first 重组）完成后转采纳，并补执行清单。

## 背景

后端重构方案 P2。普查 `core/` 层直接碰 DB（`prepare` / `query_row` / `execute` / `rusqlite` / `Connection`）共 **215 处**，其中 `issue_service` **115 处**、`agent_session_service` **67 处**。`issue_service` 有 **12 处 `unchecked_transaction()`**，事务内直接 `prepare` / `execute` / `query_row`。

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

## 后果

- service 只见 record 与事务编排，SQL 全在 repository，可单测、可审计。
- 跨表事务（issue + agent_session + completion_flow）仍由 service 编排，repository 不感知跨聚合业务规则。
- 代价：迁移 215 处直连 SQL，逐 feature 推进；`issue_service`（115）、`agent_session_service`（67）是大头，需补集成测试钉死行为。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| repository 提供「Unit of Work」聚合多 repo | 过度抽象；当前 `*_in_transaction(&tx)` 签名已够，service 编排更直接 |
| 跨表操作整体封进单 repository 方法（如 `complete_issue_in_transaction`） | repository 被迫知道跨聚合业务规则，职责越界 |
| 引入 `Repository<T>` 泛型基类 / ORM / 查询构造器 | Rust 反模式；现有 per-aggregate repository 更清晰、零成本 |
| service 完全无事务感知，repository 各自提交 | 破坏跨表原子性（issue 完成需 issue + session + flow 同生共死） |

## 事实来源

- 散落：`src-tauri/src/core/issue_service.rs`（115 处 SQL、12 处 `unchecked_transaction`）、`core/agent_session_service.rs`（67 处）。
- 先例：`src-tauri/src/db/{issue,agent_session,issue_attachment,issue_completion_flow,completion_attempt,event}_repository.rs` 的 `*_in_transaction`。
- 连接：`src-tauri/src/db/connection.rs`（61 行，待扩展）。
