## Why

当前 `issues.id` 与 `agent_sessions.id` 都是 SQLite 全局自增主键，导致同一项目内 issue / session 编号不连续——用户看到 `#1`、`#5`、`#12`、`#47` 这样的跳号。用户希望在一个项目内看到连续、自增、用户可见的编号，并且日志文件名也使用该编号，而不是全局跳号。

此外，全局 id 当前被直接嵌入 session 日志文件名、worktree 分支名、附件目录，靠全局唯一性避免冲突；引入项目内编号时必须保证这些路径在新数据上仍唯一。

## What Changes

- 为 `issues` 与 `agent_sessions` 各新增项目内自增、不可逆的 `number` 列，并加 `UNIQUE(project_id, number)` 约束。
- 创建时在同一事务内按 `MAX(number)+1`（**不过滤软删除行**）分配，保证项目内连续且删除后不复用；并发冲突靠唯一约束 + 重试兜底。
- issue 编号在 UI 展示（看板卡片、summary 标题、run dialog 标题、会话列表行的关联 issue 号）改用 `number`。
- session 编号用于 session 日志文件命名；不在 UI 新增 session 编号展示位。
- 新数据：agent session 日志文件名、worktree 分支名、附件目录改用项目内编号；completion / merge-back 记录的 `workspace_branch` 同步。
- 历史数据：DB 回填 `number`（按 `created_at ASC, id ASC`），但**不迁移**已有日志文件、worktree 分支、附件目录，新旧命名并存。
- 保留全局 `id` 作主键与内部寻址；跨边界寻址仍用 `projectId + issueId / sessionId`，`number` 仅作展示与日志命名。

## Non-goals

- 不改造 project terminal 的编号与日志命名（另一套 session 体系）。
- 不迁移历史日志文件名、worktree 分支名、附件目录。
- 不在 UI 新增 session 编号展示位。
- 不改变 issue 与 agent session 之间的关联规则与状态机。
- 不引入 Rust → TypeScript DTO 自动生成流水线。

## Capabilities

### New Capabilities

- `project-scoped-numbering`: 定义 issue 与 agent session 的项目内自增编号分配、不可逆递增语义、UI 展示、日志与路径命名规则，以及历史数据回填策略。

## Impact

- 数据库：新增 migration（加 `number` 列、按项目分组回填、加 `UNIQUE(project_id, number)`）。
- 后端：issue / agent_session repository 与 service 的编号分配、session 日志路径构造、worktree 分支命名、附件路径、DTO 新增 `number`。
- 前端：`IssueRecord` / `AgentSessionListItem` 新增 `number`，看板、summary、run dialog、会话列表改用 `number` 展示。
- 验证：`cd src-tauri && cargo test`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
- 详细设计见 `docs/superpowers/specs/2026-07-09-project-scoped-issue-session-number-design.md`。
