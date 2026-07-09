# 项目内自增 issue / session 编号 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 issues 与 agent_sessions 新增项目内不可逆递增的 `number`，UI 与日志/worktree/附件路径对新数据改用 `number`，保留全局 `id` 作内部寻址。

**Architecture:** 数据库加 `number` 列 + `UNIQUE(project_id, number)` + 历史回填；创建时在事务内 `MAX(number)+1`（不过滤软删除）分配；session 日志路径构造、worktree 分支名、附件目录改用 number；跨边界寻址仍用全局 id，number 仅展示与命名。

**Tech Stack:** Rust 2021、rusqlite、Tauri 2、React 19、TypeScript、Vitest。

## Global Constraints

- `issues.number`、`agent_sessions.number` 项目内不可逆递增；`UNIQUE(project_id, number)` 含软删除行。
- 保留全局 `id INTEGER PRIMARY KEY` 作主键与内部寻址；跨边界寻址继续用 `projectId + issueId / sessionId`。
- 新数据路径用 `number`；旧数据日志文件、worktree 分支、附件目录保留全局 id 命名不动。
- Rust DTO `#[serde(rename_all = "camelCase")]`，TS 中 `number` 为 `number` 类型。
- migration 回填用相关子查询（不依赖 SQLite 窗口函数版本）。
- 编号分配必须在创建事务内完成；SQLite 写事务串行即保证并发安全，`UNIQUE` 约束兜底。
- 提交规范：`<type>: <简体中文描述>`，无 scope；每个 task 末尾 commit。
- 详细设计：`docs/superpowers/specs/2026-07-09-project-scoped-issue-session-number-design.md`。

## File Structure

**Create:**
- `src-tauri/migrations/0036_project_scoped_issue_session_numbers.sql` — 加列、回填、唯一索引。
- `src-tauri/src/db/issue_number.rs`（如需独立模块；否则内联）— number 分配 helper（实际内联到 repository，见 Task 3）。

**Modify:**
- `src-tauri/src/db/issue_repository.rs` — SELECT 列、`issue_from_row`、`insert`/`insert_in_transaction` 加 number 分配。
- `src-tauri/src/db/agent_session_repository.rs` — SELECT 列、`from_row`、`insert_in_transaction`/`insert_standalone_in_transaction` 加 number 分配；list 查询 join issue number。
- `src-tauri/src/types/issue.rs` — `IssueRecord` 加 `number`。
- `src-tauri/src/types/agent_session.rs` — `AgentSessionRecord`、`AgentSessionListItem` 加 `number`；`AgentSessionListItem` 加 `issue_number`。
- `src-tauri/src/core/agent_session_service.rs` — 日志路径构造改 number；调用处传 number。
- `src-tauri/src/core/issue_service.rs` — 附件路径改 issue number。
- `src-tauri/src/git/worktree.rs` — `create_worktree_for_issue` 用 issue number 命名分支/目录（上层传 number）。
- `src/features/issues/issue-commands.ts` — `IssueRecord` 加 `number`。
- `src/features/agents/agent-session-commands.ts` — `AgentSessionListItem` 加 `number`、`issueNumber`。
- `src/features/issues/issues-kanban.tsx`、`issue-summary-dialog.tsx`、`issue-run-dialog.tsx`、`src/features/agents/agents-session-list.tsx`、`src/shared/i18n/messages.ts` — 展示改 number。

---

### Task 1: migration 加列、回填、唯一索引

**Files:**
- Create: `src-tauri/migrations/0036_project_scoped_issue_session_numbers.sql`
- Test: `src-tauri/src/db/issue_repository.rs` 既有测试模块（新增回填验证测试）

**Interfaces:**
- Produces: `issues.number`、`agent_sessions.number` 列与 `UNIQUE(project_id, number)` 索引，供后续 task 使用。

- [ ] **Step 1: 写 migration 文件**

```sql
-- 0036_project_scoped_issue_session_numbers.sql
ALTER TABLE issues ADD COLUMN number INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_sessions ADD COLUMN number INTEGER NOT NULL DEFAULT 0;

-- 回填 issues：按 project 分组、created_at,id 排序赋号（相关子查询，不依赖窗口函数）
UPDATE issues
SET number = (
  SELECT COUNT(*) + 1
  FROM issues AS i2
  WHERE i2.project_id = issues.project_id
    AND (
      i2.created_at < issues.created_at
      OR (i2.created_at = issues.created_at AND i2.id < issues.id)
    )
);

-- 回填 agent_sessions：按 project 分组、started_at,id 排序赋号
UPDATE agent_sessions
SET number = (
  SELECT COUNT(*) + 1
  FROM agent_sessions AS s2
  WHERE s2.project_id = agent_sessions.project_id
    AND (
      s2.started_at < agent_sessions.started_at
      OR (s2.started_at = agent_sessions.started_at AND s2.id < agent_sessions.id)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_issues_project_id_number
ON issues (project_id, number);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_agent_sessions_project_id_number
ON agent_sessions (project_id, number);
```

- [ ] **Step 2: 写回填正确性测试**

在 `issue_repository.rs` 测试模块新增（参考既有测试如何建内存库 + 跑 migration）：

```rust
#[test]
fn backfill_assigns_continuous_numbers_per_project() {
    let db = setup_test_db_with_migrations(); // 既有 helper，跑全部 migration
    let pid = create_project(&db, "p1");
    let i1 = insert_issue_raw(&db, pid, "a"); // 直接 INSERT 不带 number，模拟旧数据
    let i2 = insert_issue_raw(&db, pid, "b");
    let i3 = insert_issue_raw(&db, pid, "c");
    // migration 已在 setup 时跑过；验证 number 已回填
    let n1 = issue_number(&db, i1);
    let n2 = issue_number(&db, i2);
    let n3 = issue_number(&db, i3);
    assert_eq!((n1, n2, n3), (1, 2, 3));
}
```

> 注：测试 helper 与既有 migration 测试一致；`setup_test_db_with_migrations` 跑到 `0036`。旧数据 INSERT 用 `INSERT INTO issues (project_id, title, description, status, created_at, updated_at) VALUES (...)` 显式给不同 `created_at` 验证排序。

- [ ] **Step 3: 运行测试验证回填**

Run: `cd src-tauri && cargo test backfill_assigns_continuous_numbers_per_project`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src-tauri/migrations/0036_project_scoped_issue_session_numbers.sql src-tauri/src/db/issue_repository.rs
git commit -m "feat: 新增 issue/session 项目内编号列与回填 migration"
```

---

### Task 2: Rust DTO 加 number 字段

**Files:**
- Modify: `src-tauri/src/types/issue.rs:274-295`（`IssueRecord`）
- Modify: `src-tauri/src/types/agent_session.rs:180-209`（`AgentSessionListItem`）、`211-` （`AgentSessionRecord`）
- Test: `src-tauri/src/types/` 既有测试或 repository 测试

**Interfaces:**
- Produces: `IssueRecord.number: i64`、`AgentSessionRecord.number: i64`、`AgentSessionListItem.number: i64`、`AgentSessionListItem.issue_number: Option<i64>`（camelCase → 前端 `number`、`issueNumber`）。

- [ ] **Step 1: 在 `IssueRecord` 加字段**

在 `id: i64` 之后加：

```rust
pub number: i64,
```

- [ ] **Step 2: 在 `AgentSessionRecord` 与 `AgentSessionListItem` 加字段**

`AgentSessionRecord` 在 `id: i64` 后加 `pub number: i64,`。
`AgentSessionListItem` 在 `session_id: i64,` 后加 `pub number: i64,`；在 `issue_id: Option<i64>,` 后加 `pub issue_number: Option<i64>,`。

- [ ] **Step 3: 写字段序列化测试（或留给 Task 3/4 的 repository 测试覆盖）**

确认编译：`cd src-tauri && cargo check`。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/types/issue.rs src-tauri/src/types/agent_session.rs
git commit -m "feat: DTO 增加 issue/session 项目内编号字段"
```

> 此时 repository 的 `from_row` 与 SELECT 尚未填 number，编译会因 `IssueRecord { ... }` 构造缺字段失败。Task 3/4 一并补齐构造点。**本 task 不单独 commit 编译**，与 Task 3 合并提交；若需独立 commit，先在所有 `IssueRecord { id, ... }` 构造处补 `number: 0` 占位再 commit，Task 3/4 再填真实值。

---

### Task 3: issue 编号分配 + repository SELECT/INSERT

**Files:**
- Modify: `src-tauri/src/db/issue_repository.rs`（`ISSUE_SELECT_COLUMNS`、`issue_from_row`、`insert`、`insert_in_transaction`、所有 `IssueRecord { ... }` 构造点）
- Test: `src-tauri/src/db/issue_repository.rs` 测试模块

**Interfaces:**
- Consumes: Task 1 的 `number` 列、Task 2 的 `IssueRecord.number`。
- Produces: 创建 issue 时自动分配项目内 `MAX(number)+1` 的 number；`IssueRecord` 带真实 number 返回。

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn insert_assigns_project_scoped_number() {
    let db = setup_test_db_with_migrations();
    let pid = create_project(&db, "p1");
    let issue1 = IssueRepository::new(db.connection()).insert(pid, "a", "", "[]").unwrap();
    let issue2 = IssueRepository::new(db.connection()).insert(pid, "b", "", "[]").unwrap();
    assert_eq!(issue1.number, 1);
    assert_eq!(issue2.number, 2);
}
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd src-tauri && cargo test insert_assigns_project_scoped_number`
Expected: FAIL（number 字段缺失或为 0）

- [ ] **Step 3: 修改 SELECT 列与 from_row**

在 `issue_from_row` 的 row 读取里加 `number: row.get("number")?`；`ISSUE_SELECT_COLUMNS` 的列清单加 `issues.number`（注意列别名与 from_row 的取名一致，保持 `number`）。

- [ ] **Step 4: 在 `insert` / `insert_in_transaction` 事务内分配 number**

`insert`：在 `execute` 前先算 number（注意 `insert` 用 `self.connection`，非事务；为与事务版一致，用同一连接查询 + 插入）：

```rust
let number: i64 = self.connection.query_row(
    "SELECT COALESCE(MAX(number), 0) + 1 FROM issues WHERE project_id = ?1",
    params![project_id],
    |row| row.get(0),
)?;
self.connection.execute(
    "INSERT INTO issues (project_id, number, title, description, label_ids, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'backlog', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))",
    params![project_id, number, title, description, label_ids_json],
)?;
```

`insert_in_transaction`：同理，把 `self.connection` 换成 `transaction`。

- [ ] **Step 5: 补齐所有 `IssueRecord { ... }` 构造点**

全仓 `grep -n "IssueRecord {" src-tauri/src`，每个构造点补 `number:` 字段（测试 helper 用 `number: row.get("number").unwrap_or(0)`，生产 from_row 用真实值）。

- [ ] **Step 6: 运行测试验证通过**

Run: `cd src-tauri && cargo test issue`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db/issue_repository.rs src-tauri/src/types/issue.rs
git commit -m "feat: issue 创建分配项目内自增编号"
```

---

### Task 4: agent_session 编号分配 + repository SELECT/INSERT

**Files:**
- Modify: `src-tauri/src/db/agent_session_repository.rs`（SELECT 列、`from_row`、`insert_in_transaction`、`insert_standalone_in_transaction`、list 查询 join issue number、所有 `AgentSessionRecord/ListItem { ... }` 构造点）
- Test: `src-tauri/src/db/agent_session_repository.rs` 测试模块

**Interfaces:**
- Consumes: Task 1 列、Task 2 DTO。
- Produces: 创建 session 时分配 `MAX(number)+1`；list 返回 `number` 与 `issue_number`。

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn insert_session_assigns_project_scoped_number() {
    let db = setup_test_db_with_migrations();
    let pid = create_project(&db, "p1");
    // 用既有 helper 构造 minimal session 行（参考既有 insert_in_transaction 测试）
    let s1 = insert_minimal_session(&db, pid, None);
    let s2 = insert_minimal_session(&db, pid, None);
    assert_eq!(s1.number, 1);
    assert_eq!(s2.number, 2);
}
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd src-tauri && cargo test insert_session_assigns_project_scoped_number`
Expected: FAIL

- [ ] **Step 3: SELECT 列 + from_row 加 number**

session SELECT 列清单加 `agent_sessions.number`；from_row 读取加 `number: row.get("number")?`。

- [ ] **Step 4: 两个 insert 路径分配 number**

在 `insert_in_transaction` 与 `insert_standalone_in_transaction` 的 `execute` 前各加：

```rust
let number: i64 = transaction.query_row(
    "SELECT COALESCE(MAX(number), 0) + 1 FROM agent_sessions WHERE project_id = ?1",
    params![project_id],
    |row| row.get(0),
)?;
```

INSERT 列清单加 `number`，VALUES 加对应占位符与 params。

- [ ] **Step 5: list 查询 join issue number**

`AgentSessionListItem` 的 list SQL 需带出关联 issue 的 number。在 list 查询里 `LEFT JOIN issues ON issues.id = agent_sessions.issue_id`，SELECT 加 `issues.number AS issue_number`；list item 构造点填 `issue_number: row.get("issue_number").ok()` 与 `number: row.get("number")?`。

- [ ] **Step 6: 补齐所有构造点 + 运行测试**

`grep -n "AgentSessionRecord {\|AgentSessionListItem {" src-tauri/src`，补 `number`（list item 还补 `issue_number`）。
Run: `cd src-tauri && cargo test agent_session`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db/agent_session_repository.rs src-tauri/src/types/agent_session.rs
git commit -m "feat: agent session 创建分配项目内自增编号并带出关联 issue 编号"
```

---

### Task 5: session 日志路径改用 number

**Files:**
- Modify: `src-tauri/src/core/agent_session_service.rs:3836-3872`（三个路径构造函数）+ 所有调用处
- Test: `src-tauri/src/core/agent_session_service.rs` 既有路径测试

**Interfaces:**
- Consumes: session 创建后已分配的 `number`、关联 issue 的 `number`。
- Produces: 新 session 日志文件名用 `issue-{issueNumber}-session-{sessionNumber}`。

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn runtime_log_path_uses_numbers() {
    let dir = tempfile::tempdir().unwrap();
    let p = build_issue_runtime_structured_log_path(dir.path(), 7, 0, 0).unwrap(); // 旧签名占位
    // 改造后断言文件名含 issue-3-session-5
}
```

> 实际测试用改造后的签名 `(data_dir, project_id, issue_number, session_number)` 断言 `issue-3-session-5`。

- [ ] **Step 2: 改造三个路径构造函数签名与文件名**

```rust
fn build_issue_runtime_structured_log_path(
    data_dir: &Path, project_id: i64, issue_number: i64, session_number: i64,
) -> Result<String, CommandError> {
    let logs_dir = runtime_session_log_project_dir(data_dir, project_id)?;
    let path = logs_dir.join(format!(
        "project-{project_id}-issue-{issue_number}-session-{session_number}.jsonl"
    ));
    Ok(path.to_string_lossy().to_string())
}

fn build_standalone_runtime_structured_log_path(
    data_dir: &Path, project_id: i64, session_number: i64,
) -> Result<String, CommandError> {
    let logs_dir = runtime_session_log_project_dir(data_dir, project_id)?;
    let path = logs_dir.join(format!(
        "project-{project_id}-standalone-session-{session_number}.jsonl"
    ));
    Ok(path.to_string_lossy().to_string())
}

pub(crate) fn build_issue_archive_log_path(
    data_dir: &Path, project_id: i64, issue_number: i64, session_number: i64,
) -> Result<String, CommandError> {
    let logs_dir = archive_session_log_project_dir(data_dir, project_id)?;
    let path = logs_dir.join(format!(
        "archive-project-{project_id}-issue-{issue_number}-session-{session_number}.log"
    ));
    Ok(path.to_string_lossy().to_string())
}
```

- [ ] **Step 3: 更新所有调用处传 number**

`grep -n "build_issue_runtime_structured_log_path\|build_standalone_runtime_structured_log_path\|build_issue_archive_log_path" src-tauri/src`，每处把 `session.id`/`issue_id` 参数换成 `session.number`/`issue.number`。调用处通常已有 `session` 与 `issue` 记录（先分配 number 再建路径）。

- [ ] **Step 4: 运行测试**

Run: `cd src-tauri && cargo test log_path && cargo check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/core/agent_session_service.rs
git commit -m "refactor: session 日志路径改用项目内编号命名"
```

---

### Task 6: worktree 分支名与 completion workspace_branch 改用 issue number

**Files:**
- Modify: `src-tauri/src/git/worktree.rs:79-108`（`create_worktree_for_issue` 签名）+ `unique_worktree_path`
- Modify: 调用处（`grep -n "create_worktree_for_issue" src-tauri/src`）传 issue number
- Modify: completion / merge-back 流程中 `format!("issue-{}", issue_id)` 处（`agent_session_service.rs:1343` 等），改用 issue number
- Test: `src-tauri/src/git/worktree.rs` 既有测试

**Interfaces:**
- Consumes: issue 的 `number`。
- Produces: 新 issue worktree 分支 `issue-{number}`、目录 `issue-{number}`；completion 记录的 `workspace_branch` 用同一编号。

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn worktree_branch_uses_issue_number() {
    // 改造后 create_worktree_for_issue(repo, root, issue_number, target)
    let created = create_worktree_for_issue(&repo, &root, 3, "main").unwrap();
    assert_eq!(created.workspace_branch, "issue-3");
}
```

- [ ] **Step 2: 改 `create_worktree_for_issue` 参数语义**

把第三参数从 `issue_id: i64` 重命名为 `issue_number: i64`（保持 `i64` 类型，仅语义变化）：

```rust
pub fn create_worktree_for_issue(
    repo_path: impl AsRef<Path>,
    worktree_root_path: impl AsRef<Path>,
    issue_number: i64,
    target_branch: &str,
) -> Result<CreatedWorktree, GitWorktreeError> {
    // ...
    let workspace_branch = format!("issue-{}", issue_number);
    let workspace_path = unique_worktree_path(&worktree_root_path, issue_number);
    // ...
}
```

- [ ] **Step 3: 更新调用处传 issue.number**

调用处从 `issue_service` / completion 流程取得 `issue.number` 传入；`agent_session_service.rs:1343` 的 `format!("issue-{}", input.issue_id)` 改为用 issue number（需从 issue 记录取 number）。

- [ ] **Step 4: 运行测试 + cargo check**

Run: `cd src-tauri && cargo test worktree && cargo check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/worktree.rs src-tauri/src/core/agent_session_service.rs
git commit -m "refactor: worktree 分支与目录改用 issue 项目内编号"
```

---

### Task 7: 附件路径改用 issue number

**Files:**
- Modify: `src-tauri/src/core/issue_service.rs:3297`（附件 relative_path 与 absolute_path）
- Test: `src-tauri/src/core/issue_service.rs` 既有附件测试

**Interfaces:**
- Consumes: issue `number`。
- Produces: 新附件存到 `.redwhisk/issues/{number}/attachments/...`。

- [ ] **Step 1: 写失败测试**

附件保存后断言 `relative_path` 形如 `.redwhisk/issues/3/attachments/...`（用 issue number 而非全局 id）。

- [ ] **Step 2: 改附件路径用 issue number**

`persist_new_attachments` / `save_issue_attachment_draft_in_data_dir` 中（`issue_service.rs:3297` 附近）：

```rust
let relative_path = format!(".redwhisk/issues/{issue_number}/attachments/{placeholder_name}");
let absolute_path = data_dir
    .join("issues")
    .join(issue_number.to_string())
    .join("attachments")
    .join(&placeholder_name);
```

调用处把 `issue.id` 换成 `issue.number`。附件 token `{{issue-attachment:{attachment_id}}}` 不变（以 attachment_id 寻址）。

- [ ] **Step 3: 验证渲染路径解析同步**

`grep -n "issue-attachment" src-tauri/src` 与前端渲染处确认 token → path 解析使用回填后的 `issue_attachments` 表路径字段（表内 `relative_path/absolute_path` 已是新建时的值，旧数据保持全局 id）。

- [ ] **Step 4: 运行测试 + cargo check**

Run: `cd src-tauri && cargo test attachment && cargo check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/core/issue_service.rs
git commit -m "refactor: issue 附件目录改用项目内编号"
```

---

### Task 8: 前端 DTO 加 number

**Files:**
- Modify: `src/features/issues/issue-commands.ts:47-62`（`IssueRecord`）
- Modify: `src/features/agents/agent-session-commands.ts:16-17`（`AgentSessionListItem`）
- Test: `src/features/issues/issue-commands.ts` 或 feature 测试

**Interfaces:**
- Consumes: 后端 DTO 已带 `number`。
- Produces: 前端 `IssueRecord.number`、`AgentSessionListItem.number`、`AgentSessionListItem.issueNumber`。

- [ ] **Step 1: 加字段**

`IssueRecord` 在 `id` 后加 `number: number;`。
`AgentSessionListItem` 在 `sessionId` 后加 `number: number;`，在 `issueId` 后加 `issueNumber: number | null;`。

- [ ] **Step 2: 运行 typecheck**

Run: `pnpm typecheck`
Expected: PASS（字段未使用不报错）

- [ ] **Step 3: Commit**

```bash
git add src/features/issues/issue-commands.ts src/features/agents/agent-session-commands.ts
git commit -m "feat: 前端 DTO 增加 issue/session 项目内编号字段"
```

---

### Task 9: 前端展示改用 number

**Files:**
- Modify: `src/features/issues/issues-kanban.tsx:231`（`#{issue.id}` → `#{issue.number}`）
- Modify: `src/features/issues/issue-summary-dialog.tsx:133`（`#${summary.issue.id}` → `#${summary.issue.number}`）
- Modify: `src/features/issues/issue-run-dialog.tsx:381` + `src/shared/i18n/messages.ts:745,1282`（`Run Issue #${id}`/`运行 Issue #${id}` → 传 `issue.number`）
- Modify: `src/features/agents/agents-session-list.tsx:160`（`#{session.issueId}` → `#{session.issueNumber}`）
- Test: `src/features/issues/issues-activity.test.tsx`、`src/features/agents/*-test.tsx`

**Interfaces:**
- Consumes: Task 8 的 `number` / `issueNumber`。

- [ ] **Step 1: 写失败测试**

在 issues 展示测试里断言卡片显示 `#1`（用 mock 的 number=1，而非全局 id）。

- [ ] **Step 2: 逐处改用 number**

- kanban：`#{issue.number}`
- summary：`#${summary.issue.number}`
- run dialog：调用 i18n 时传 `issue.number`
- i18n messages：`runIssue: (id) => \`运行 Issue #${id}\`` 保持（参数语义改为 number），调用处传 number
- 会话列表：`#{session.issueNumber}`

- [ ] **Step 3: 运行测试**

Run: `pnpm test -- issues agents`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/features src/shared/i18n/messages.ts
git commit -m "feat: 前端展示改用 issue 项目内编号"
```

---

### Task 10: 全量验证

**Files:** 无新增，仅运行验证。

- [ ] **Step 1: Rust 测试**

Run: `cd src-tauri && cargo test`
Expected: 全部 PASS

- [ ] **Step 2: 前端验证**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: 全部 PASS

- [ ] **Step 3: OpenSpec 校验**

Run: `openspec validate project-scoped-issue-session-number --strict`
Expected: PASS

- [ ] **Step 4: 回填 tasks.md**

在 `openspec/changes/project-scoped-issue-session-number/tasks.md` 勾选全部已完成项。

- [ ] **Step 5: Commit**

```bash
git add openspec/changes/project-scoped-issue-session-number/tasks.md
git commit -m "chore: 回填 project-scoped-issue-session-number 任务勾选"
```

## Self-Review

- **Spec coverage**: 4 个 spec requirement（项目内自增、issue UI 展示、session 日志命名、新数据路径）分别由 Task 3/4（分配）、Task 9（UI）、Task 5（日志）、Task 5/6/7（路径）覆盖；历史数据不迁移由 Task 1 仅回填 DB 保证。
- **Placeholder scan**: 关键代码（migration、编号分配 SQL、路径构造、DTO 字段）均完整；机械改动（from_row、SELECT 列、构造点）给出确切位置与字段名，由 subagent 读现有模式补齐。
- **Type consistency**: `number: i64`（Rust）/ `number: number`（TS）/ `issueNumber` 命名一致；`create_worktree_for_issue` 第三参数语义改为 issue_number，调用处同步。
