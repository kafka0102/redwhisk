# Design: 项目内自增的 issue / session 编号

完整设计见 `docs/superpowers/specs/2026-07-09-project-scoped-issue-session-number-design.md`。本文件记录 OpenSpec change 维度的关键技术决策与已确认取舍。

## 已确认决策

1. **编号语义：不可逆递增**。删除后编号作废、不复用。这是日志 / worktree 分支 / 附件目录能安全改用编号的前提。
2. **session 编号展示：仅日志命名**。session 编号只用于日志文件名，UI 不增加展示位。
3. **路径范围**：agent session 日志文件名、worktree 分支名、附件目录切到编号；project terminal 不在范围。
4. **迁移策略：仅回填 DB，不迁移旧文件 / 分支**。历史资产保留全局 id 命名，新旧并存。

## 数据模型

- `issues.number INTEGER NOT NULL`，`agent_sessions.number INTEGER NOT NULL`。
- `UNIQUE(project_id, number)`（含软删除行）。
- 全局 `id` 主键保留，继续承担内部寻址。

## 编号分配

创建事务内 `SELECT COALESCE(MAX(number),0)+1 FROM <table> WHERE project_id=?`（不过滤 `del`），写入新行。`UNIQUE(project_id, number)` 冲突时回滚重试。软删除保留 number。

## 路径层（新数据）

- session 日志：`project-{pid}-issue-{issueNumber}-session-{sessionNumber}.jsonl`、`...-standalone-session-{sessionNumber}.jsonl`、`archive-...-session-{sessionNumber}.log`。
- worktree 分支 / 目录：`issue-{issueNumber}`；`workspace_branch` 记录同步。
- 附件目录：`.redwhisk/issues/{issueNumber}/attachments/...`；`issue_attachments` 表路径字段同步；token `{{issue-attachment:{attachment_id}}}` 不含 issue id，无需改 token。
- 旧数据路径不动。

## migration / 回填

按 `project_id` 分组、`created_at ASC, id ASC`，窗口函数 `ROW_NUMBER()` 赋号；确认 bundled SQLite ≥ 3.25，否则降级相关子查询。回填后收紧 `NOT NULL`。不迁移文件 / 分支。

## 风险

- 并发：唯一约束 + 事务重试。
- 路径新旧并存：Open Log / 诊断入口需容忍旧命名。
- worktree 分支名：completion 流程的 `workspace_branch` 读写须统一用编号，避免与旧 `issue-{全局id}` 混淆。
- 跨边界类型手动同步，靠测试覆盖。
