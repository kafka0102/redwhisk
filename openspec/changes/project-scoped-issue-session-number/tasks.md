## 1. 数据模型与 migration

- [ ] 1.1 新增 migration：为 `issues`、`agent_sessions` 加 `number INTEGER NOT NULL DEFAULT 0` 列。
- [ ] 1.2 migration 内回填 number：按 `project_id` 分组、`created_at ASC, id ASC` 排序，用 `ROW_NUMBER()` 窗口函数赋号；确认 bundled SQLite 版本，必要时降级为相关子查询。
- [ ] 1.3 加 `UNIQUE(project_id, number)` 索引；回填后将列约束收紧为 `NOT NULL`。
- [ ] 1.4 repository 行映射与 DTO 读取新增 `number` 字段。

## 2. 编号分配

- [ ] 2.1 issue 创建事务内按 `MAX(number)+1`（不过滤 `del`）分配 `number`，`UNIQUE` 冲突重试。
- [ ] 2.2 agent_session 创建（issue 关联 + standalone）事务内分配 `number`。
- [ ] 2.3 后端测试覆盖：项目内连续递增、软删除后不复用、跨项目独立、并发唯一约束冲突重试。

## 3. 路径层（新数据用编号）

- [ ] 3.1 session 日志路径构造改用 `issueNumber` / `sessionNumber`（运行态、standalone、归档三处）。
- [ ] 3.2 worktree 分支名与目录改用 `issueNumber`；completion / merge-back 记录的 `workspace_branch` 同步。
- [ ] 3.3 附件目录与 `issue_attachments` 路径字段改用 `issueNumber`；token 解析路径同步。
- [ ] 3.4 确认旧数据路径不动，Open Log 与诊断入口兼容旧全局 id 命名。

## 4. 跨边界 DTO

- [ ] 4.1 Rust `IssueRecord` / `AgentSessionListItem` / `AgentSessionRecord` 新增 `number: i64`。
- [ ] 4.2 前端 `IssueRecord` / `AgentSessionListItem` 新增 `number: number`。
- [ ] 4.3 command client 测试覆盖 `number` 字段。

## 5. UI 展示

- [ ] 5.1 看板卡片改用 `IssueRecord.number`。
- [ ] 5.2 summary 标题、run dialog 标题（含 i18n `运行 Issue #${number}`）改用 `number`。
- [ ] 5.3 会话列表行关联 issue 号改用 `number`。
- [ ] 5.4 前端测试覆盖编号展示。

## 6. 验证

- [ ] 6.1 `pnpm lint`
- [ ] 6.2 `pnpm typecheck`
- [ ] 6.3 `pnpm test`
- [ ] 6.4 `cd src-tauri && cargo test`
