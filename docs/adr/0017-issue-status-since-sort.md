# ADR 0017：Issue 看板按状态进入时间排序（`issues.status_changed_at`）

## 状态

采纳（已实现）。

## 背景

Issue 看板四个甬道（`backlog` / `running` / `review` / `completed`）当前统一用 `ORDER BY issues.updated_at DESC, issues.created_at DESC, issues.id DESC`（`issue_repository.rs::list_by_project_id_paged`）。但 `updated_at` 在任意字段更新（改标题、改描述、加标签）时都会刷新，**无法表达「进入当前状态的那一刻」**。

产品要求各甬道按各自语义时间降序：`completed` 按完成时间、`running` 按开始运行时间、`review` 按开始 review 时间。这三个时间在 `issues` 表里均不存在；`issue_actions` 时间轴虽记录了 `agent_session_started` / `issue_review_marked` / `issue_completed` / `issue_status_changed` 等动作，但作为排序键需逐行 JOIN 子查询且部分动作类型要从 `payload_json` 解析 `fromStatus`/`toStatus`，分页 `LIMIT/OFFSET` 性能与稳定性差。

## 决定

1. **`issues` 表新增 `status_changed_at INTEGER NOT NULL` 列**（epoch 毫秒，与 `created_at`/`updated_at` 同源），语义为「进入当前 `status` 的时刻」。
2. **状态每次迁移时在同一事务内刷新该列**：覆盖所有进入 `running` / `review` / `completed` / `backlog` 的路径（`advance_issue_status`、`mark_issue_review`、`complete_issue_flow` / `complete_issue_manual` / `complete_issue_clean`、`start_agent_session` 等），新建 Issue 时取创建时刻。
3. **四态统一排序**为 `ORDER BY issues.status_changed_at DESC, issues.created_at DESC, issues.id DESC`：一个排序键覆盖完成 / 开始运行 / 开始 review 三种语义，`created_at`/`id` 作稳定 tiebreaker。
4. **migration 回填**：对存量行，取该 Issue 在 `issue_actions` 中状态相关动作（`agent_session_started` / `issue_review_marked` / `issue_completed` / `issue_status_changed`）的最大 `created_at`；无任何记录则退回 `updated_at`。
5. **DTO 同步**：`IssueRecord`（Rust + TS）新增 `statusChangedAt`，前端 `mergeIssues` 跨页合并改按 `statusChangedAt DESC, createdAt DESC, id DESC`，与后端 `ORDER BY` 对齐。

## 后果

- 排序语义统一、SQL 可直接 `ORDER BY` + 建索引、分页游标稳定；前端跨页顺序与后端一致。
- 代价：schema 加列 + migration 回填 + 所有状态迁移写入点更新 + 跨边界 DTO 手动同步（`#[serde(rename_all="camelCase")]` 与 TS 类型，见 `coding-style.md`）。
- `status_changed_at` 与 `updated_at` 职责分离：前者仅状态迁移刷新，后者任意字段更新刷新；二者不可互换。
- 状态反复横跳时取「最近一次进入当前状态」，符合看板「最近活动的在前」直觉。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 不改 schema，查询时 JOIN `issue_actions` 子查询取最近一次进入该状态的动作时间 | SQL 复杂（每行子查询、多动作类型、`IssueStatusChanged` 要 `json_extract` `toStatus`）；分页 `LIMIT/OFFSET` 性能差、排序字段非列难加索引 |
| 直接用 `updated_at` 排序 | 语义错误——编辑标题/描述会刷新，无法表达「状态进入时刻」 |
| 加三列 `completed_at` / `running_since` / `review_since` | 与单列 `status_changed_at` 等价但列更多、迁移写入点分支更多；单列已能统一表达 |

## 事实来源

- 排序：`src-tauri/src/db/issue_repository.rs`（`ISSUE_SELECT_COLUMNS`、`list_by_project_id_paged`、`list_by_project_id`）。
- 状态迁移写入点：`src-tauri/src/features/issue/service.rs`（`advance_issue_status_with_transaction`、`update_issue_status_with_audit_in_transaction`、完成流程）、`src-tauri/src/features/agent_session/service.rs`（`AgentSessionStarted`）、`src-tauri/src/features/issue/completion/flow.rs`。
- 时间轴：`issue_actions` 表（migration `0005_issue_actions.sql`）、[ADR 0002](./0002-issue-timeline-event-model.md)。
- DTO 同步：`src-tauri/src/types/issue.rs`、`src/features/issues/issue-commands.ts`、`src/features/issues/issue-lane-helpers.ts`（`mergeIssues`）。
