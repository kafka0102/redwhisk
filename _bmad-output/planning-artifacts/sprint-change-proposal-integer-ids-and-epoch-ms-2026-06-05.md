# Sprint Change Proposal：整数自增 ID 与毫秒时间戳

日期：2026-06-05
项目：redwhisk
触发 story：Story 1.5 创建和编辑本地 Issue
范围分类：Moderate

## 1. 问题摘要

在 Story 1.5 进入开发前，用户明确要求调整数据模型：

- 实体 `id` 统一改为 SQLite 整数自增主键。
- `created_at`、`updated_at`、`last_opened_at` 等时间列统一改为 `INTEGER NOT NULL`，保存 Unix epoch milliseconds。
- 已有 Project 代码也要同步重构，而不是只影响未来 Issue 表。

需要澄清的是：Unix epoch milliseconds 表示绝对时间点，本身不带时区；“本地时区”应在 UI 展示层处理，数据库只保存本机当前时间对应的 epoch milliseconds。

## 2. 影响分析

### Epic 影响

- Epic 1 仍可按原计划推进，但 Story 1.3、Story 1.4 已完成代码需要重构，Story 1.5 的 schema 指引需要更新。
- 后续所有依赖实体引用的 stories 都受影响，包括 Issue、IssueAction、AgentSession、SessionEvent、CompletionAttempt、Project Settings、Agent Profile/Override。
- 不需要新增 Epic，也不改变 MVP 目标。

### Story 影响

- Story 1.3：`projects` schema、Project DTO、repository/service/tests 从 `TEXT` id 和 ISO 时间改为 `INTEGER` id 和 epoch ms。
- Story 1.4：Project Switcher、URL `projectId`、window label、前端类型和测试从字符串 id 调整为数字 id。
- Story 1.5：`issues` schema 建议改为 `id INTEGER PRIMARY KEY`、`project_id INTEGER NOT NULL`、时间列 `INTEGER NOT NULL`；迁移编号顺延为 `0004_issues`，因为需要先用 `0003_project_integer_ids` 迁移已存在 Project 数据。
- Story 1.7 及后续审计/Session/Completion stories：所有外键字段使用 INTEGER，时间列使用 epoch ms。

### Artifact 影响

- PRD/epics 中的字段名不需要改，但需要补充数据表示约束：`*_id` 为 INTEGER，`*_at` 为 epoch milliseconds。
- Architecture 的 Database Naming Conventions、Data Exchange Formats、Project DTO 说明需要更新。
- UX 不需要结构变化，只需展示层按本地时区格式化 epoch ms。

### 技术影响

- 需要新增迁移 `0003_project_integer_ids.sql`，对已存在的 `projects` 表进行重建迁移。
- Rust DTO 中 `id`、`project_id` 改为 `i64`，timestamp 改为 `i64`。
- TypeScript 中 `ProjectRecord.id`、`OpenProjectInput.projectId`、`createdAt`、`lastOpenedAt` 改为 `number`。
- URL query `projectId` 仍是字符串载体，但入口处必须解析为 number；非法值不调用 `open_project`，显示 Project open error。
- Tauri window label 继续使用字符串拼接，例如 `project-${id}`。

## 3. 推荐方案

采用 Direct Adjustment：

1. 立即新增 Project 迁移和代码重构，保证已完成 Project 功能不继续扩散旧类型。
2. 更新 Story 1.5 的开发指南，让 Issue 首次实现直接基于 INTEGER id 和 epoch ms。
3. 更新架构/epics/PRD addendum 的数据约束，作为后续 Agent 使用的权威指导。

不建议 rollback Story 1.3/1.4，因为功能本身有效，直接重构 schema/DTO/test 成本更低。

## 4. 详细变更提案

### Architecture

将 SQLite id/timestamp 规则改为：

- 主键字段 `id` 使用 `INTEGER PRIMARY KEY`，依赖 SQLite rowid 自动分配。
- 外键字段 `{entity}_id` 使用 `INTEGER NOT NULL`，引用对应实体整数 id。
- 时间字段 `*_at` 使用 `INTEGER NOT NULL`，保存 Unix epoch milliseconds。
- 展示时由前端按本机本地时区格式化；数据库不保存本地时区字符串。

### PRD Addendum

在数据表草案前补充：

- 所有实体主键和外键使用 SQLite INTEGER。
- 所有时间列使用 epoch milliseconds。

### Story 1.5

更新 schema 指引：

```sql
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('backlog', 'running', 'review', 'completed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
```

## 5. 实施交接

Developer agent 直接执行：

- 新增 `0003_project_integer_ids.sql`。
- 重构 Project Rust/TS 类型和 tests。
- 更新 Story 1.5 为 `0004_issues` 和 INTEGER schema。
- 运行完整验证：`pnpm format`、`cargo fmt --manifest-path src-tauri/Cargo.toml`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`cd src-tauri && cargo test`。

成功标准：

- 已有 Project 创建、打开、列表、switcher 测试全部通过。
- 新数据库直接得到 INTEGER schema。
- 已有 `0002_projects` 数据库运行 `0003_project_integer_ids` 后迁移为 INTEGER schema。
- Story 1.5 不再指导使用 TEXT id 或 TEXT timestamp。
