# 项目内自增的 issue / session 编号 设计文档

- 日期：2026-07-09
- 范围：RedWhisk issue 与 agent session 的用户可见编号
- 关联规范：`docs/architecture-design/agent-development-rules.md`（数据与状态规则、Command 与错误约定）

## 1. 背景与现状

当前 `issues.id` 与 `agent_sessions.id` 都是 SQLite `INTEGER PRIMARY KEY` 全局自增主键，INSERT 时不指定 id，靠 rowid 分配（`last_insert_rowid()`），没有任何项目内序号字段。

- issues INSERT：`src-tauri/src/db/issue_repository.rs` 的 `insert` / `insert_in_transaction`。
- agent_sessions INSERT：`src-tauri/src/db/agent_session_repository.rs` 的 `insert_in_transaction` / `insert_standalone_in_transaction`。

全局自增导致：同一项目内的 issue / session 编号不连续（例如某项目看到的 issue 是 `#1`、`#5`、`#12`、`#47`）。用户希望在一个项目内看到连续、自增的编号。

用户可见的编号当前只有 issue id 被展示：

- 看板卡片：`src/features/issues/issues-kanban.tsx` `#{issue.id}`。
- summary 标题：`src/features/issues/issue-summary-dialog.tsx` `#${summary.issue.id}`。
- run dialog 标题：`src/features/issues/issue-run-dialog.tsx` + `src/shared/i18n/messages.ts` `运行 Issue #${id}`。
- 会话列表行：`src/features/agents/agents-session-list.tsx` `#${session.issueId}`（展示关联 issue 的编号，不是 session 自身编号）。

session 自身 id 当前不以数字形式展示给用户，仅用于内部 key 与命令参数。

全局 id 还被直接嵌入文件系统与 git 命名，靠全局唯一性避免冲突：

- session 日志：`src-tauri/src/core/agent_session_service.rs` `build_issue_runtime_structured_log_path` / `build_standalone_runtime_structured_log_path` / `build_issue_archive_log_path`，文件名形如 `project-{pid}-issue-{iid}-session-{sid}.jsonl`、`archive-project-{pid}-issue-{iid}-session-{sid}.log`。
- worktree 分支名与目录：`src-tauri/src/git/worktree.rs` `format!("issue-{}", issue_id)`（分支名无后缀兜底，目录有 `unique_worktree_path` 后缀兜底）。
- 附件目录：`src-tauri/src/core/issue_service.rs` `format!(".redwhisk/issues/{issue_id}/attachments/{placeholder_name}")`。
- project terminal 日志：`src-tauri/src/core/project_terminal_service.rs` `project-{pid}-terminal-{sid}.log`（本次不在范围）。

两表均有 `project_id`（issues 自 `0004`；agent_sessions 由 `0009` 补加并回填）与软删 `del`（`0020`）。无任何 `number` / `seq` / `index` / `display_id` 列，也无 `(project_id, number)` 唯一约束。

## 2. 目标

- 为 `issues` 与 `agent_sessions` 各新增一个项目内自增、不可逆的 `number` 列，作为用户可见编号。
- issue 编号在 UI 展示（看板、summary、run dialog、会话列表行的关联 issue 号）改用 `number`。
- session 编号用于 session 日志文件命名，使同一项目内日志文件名连续可读；不在 UI 新增 session 编号展示位。
- agent session 日志文件名、worktree 分支名、附件目录对新数据改用项目内编号。
- 保留全局 `id` 作主键与内部寻址，跨边界寻址仍用 `projectId + issueId / sessionId`。

## 3. Non-goals

- 不改造 project terminal 的编号与日志命名（它是另一套 session 体系）。
- 不迁移历史日志文件名、worktree 分支名、附件目录（旧资产保留全局 id 命名）。
- 不在 UI 新增 session 编号展示位。
- 不改变 issue 与 agent session 之间的关联规则与状态机。
- 不引入 Rust → TypeScript DTO 自动生成流水线。

## 4. 已确认决策

1. **编号语义：不可逆递增**。条目删除后编号作废、永不复用，新条目拿到更大的号（GitHub 式）。这是日志 / worktree 分支 / 附件目录能安全改用编号的前提——项目内编号一旦分配即唯一。
2. **session 编号展示：仅日志命名**。session 编号只用于 session 日志文件命名等非展示场景，UI 不增加 session 编号展示位。
3. **路径范围**：agent session 日志文件名、worktree 分支名、附件目录切到项目内编号；project terminal 不在范围。
4. **迁移策略：仅回填 DB 编号，不迁移旧文件 / 分支**。历史 issue / session 在 DB 回填 `number`；已有日志文件、worktree 分支、附件目录保留全局 id 命名不动，文件系统 / git 层新旧命名并存。

## 5. 详细设计

### 5.1 数据模型

- `issues` 新增 `number INTEGER NOT NULL DEFAULT 0`，回填后改为 `NOT NULL`。
- `agent_sessions` 新增 `number INTEGER NOT NULL DEFAULT 0`，回填后改为 `NOT NULL`。
- 各加唯一索引：`UNIQUE(project_id, number)`（含软删除行，保证项目内编号永不重复）。
- 全局 `id` 主键保留不变。

### 5.2 编号分配（不可逆递增）

创建 issue / session 时，在同一事务内：

```sql
SELECT COALESCE(MAX(number), 0) + 1 FROM issues WHERE project_id = ?1
```

不过滤 `del`，软删除行的编号计入 MAX → 新号严格大于所有已分配号 → 永不复用。结果写入新行 `number` 列。

并发兜底：`UNIQUE(project_id, number)` 冲突时事务回滚并重试一次。软删除保留 `number`，不回填。

### 5.3 路径层（仅新数据用编号）

- 运行态结构化日志：`project-{pid}-issue-{issueNumber}-session-{sessionNumber}.jsonl`。
- 独立会话日志：`project-{pid}-standalone-session-{sessionNumber}.jsonl`。
- 归档日志：`archive-project-{pid}-issue-{issueNumber}-session-{sessionNumber}.log`。
- worktree 分支名 `issue-{issueNumber}`、目录 `issue-{issueNumber}`（`unique_worktree_path` 后缀兜底保留）。
- completion / merge-back 流程记录的 `workspace_branch` 同步使用 `issue-{issueNumber}`。
- 附件目录 `.redwhisk/issues/{issueNumber}/attachments/{name}`，`issue_attachments` 表 `relative_path` / `absolute_path` 同步更新。
- 附件 token `{{issue-attachment:{attachment_id}}}` 与 `{{issue-attachment-temp:{token}}}` 不含 issue id，token 本身无需修改；渲染时按 `number` 解析路径。
- 旧 issue / session 的日志文件、worktree 分支、附件目录保留全局 id 命名不动。

### 5.4 UI 展示

- issue 编号：`issues-kanban.tsx`、`issue-summary-dialog.tsx`、`issue-run-dialog.tsx`（含 i18n `运行 Issue #${number}`）、`agents-session-list.tsx` 的 `#{issueNumber}` 全部改用 `IssueRecord.number`。
- session 编号：不新增 UI 展示位，会话列表行保持显示关联 issue 编号。

### 5.5 跨边界 DTO

- Rust：`IssueRecord` 增加 `number: i64`；`AgentSessionListItem` / `AgentSessionRecord` 增加 `number: i64`。沿用 `#[serde(rename_all = "camelCase")]`，前端字段名 `number`。
- 前端：`src/features/issues/issue-commands.ts` `IssueRecord` 增加 `number: number`；`src/features/agents/agent-session-commands.ts` `AgentSessionListItem` 增加 `number: number`。
- 寻址字段（`projectId` / `issueId` / `sessionId`）保持不变，`number` 仅作展示与日志命名。
- 因项目无 Rust → TS 自动生成，手动同步两端类型，并补 command client 测试覆盖 `number` 字段。

### 5.6 migration 与回填

- 新增一条 migration（编号紧跟当前最新 `0035`）：为两表加列、回填、加 `UNIQUE(project_id, number)` 索引。
- 回填按 `project_id` 分组、`created_at ASC, id ASC` 排序，用窗口函数赋号：

```sql
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn
  FROM issues
)
UPDATE issues SET number = (SELECT rn FROM ranked WHERE ranked.id = issues.id);
```

`agent_sessions` 同理。实现时确认 bundled SQLite 版本支持窗口函数（SQLite ≥ 3.25）；若不支持，降级为相关子查询 `COUNT(*)` 方案。
- 回填完成后，将列约束收紧为 `NOT NULL`（或重建表）。不迁移任何文件路径 / 分支名。

## 6. 风险与权衡

- **编号并发**：`UNIQUE(project_id, number)` + 事务内重试兜底竞态。
- **路径新旧并存**：旧 issue / session 的 git 分支、日志文件、附件目录保留全局 id 命名；UI 统一展示 `number`，分支名 / 文件名差异为实现细节。Open Log、诊断入口需容忍旧命名。
- **附件路径切换**：新附件写入 `.redwhisk/issues/{number}/`，旧附件保留原目录；渲染按各自路径解析。
- **worktree 分支名**：新 issue 用 `issue-{number}`；completion 流程记录与读取的 `workspace_branch` 字段需统一使用编号命名，避免与旧 `issue-{全局id}` 混淆导致 merge-back 找错分支。
- **回填正确性**：窗口函数赋号须在单事务内完成，保证幂等；migration 失败需整体回滚。
- **跨边界类型同步**：手动维护 Rust 与 TS 类型一致，靠测试覆盖。

## 7. 验收标准

- 新建 issue / session 时，`number` 在所属 `project_id` 内严格递增，删除后再创建拿到更大的号。
- 同一 `project_id` 内不存在重复 `number`（含软删除行）。
- 看板、summary、run dialog、会话列表行展示的 issue 编号为项目内连续编号。
- 新 session 的日志文件名、新 issue 的 worktree 分支名与附件目录使用项目内编号。
- 旧 issue / session 的日志文件、worktree 分支、附件目录未被迁移、仍可访问。
- Rust 与前端 DTO 均包含 `number` 字段，command client 测试覆盖该字段。
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`cd src-tauri && cargo test` 通过。

## 8. 涉及的关键代码位置

- 表结构：`src-tauri/migrations/0004_issues.sql`、`0008_agent_sessions_and_session_events.sql`、`0009_agent_sessions_project_id.sql`、`0020_issues_and_agent_sessions_del.sql`。
- INSERT：`src-tauri/src/db/issue_repository.rs`、`src-tauri/src/db/agent_session_repository.rs`。
- session 日志路径：`src-tauri/src/core/agent_session_service.rs`（`build_issue_runtime_structured_log_path` 等）。
- worktree 分支 / 目录：`src-tauri/src/git/worktree.rs`。
- 附件路径与 token：`src-tauri/src/core/issue_service.rs`。
- DTO：`src-tauri/src/types/issue.rs`、`src-tauri/src/types/agent_session.rs`。
- 前端展示与类型：`src/features/issues/issues-kanban.tsx`、`issue-summary-dialog.tsx`、`issue-run-dialog.tsx`、`issue-commands.ts`、`src/features/agents/agents-session-list.tsx`、`agent-session-commands.ts`、`src/shared/i18n/messages.ts`。
