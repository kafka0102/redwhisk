---
baseline_commit: adc21ae
---

# Story 1.5: 创建和编辑本地 Issue

Status: ready-for-dev

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望在 Project 内创建和编辑极简 Issue,
以便我可以把本地开发任务作为 Agent 工作流入口.

## Acceptance Criteria

1. 给定用户位于 Issues Activity，当用户创建 Issue 并填写 `title` 和 `description`，则如 schema 尚未存在则通过 migration 创建 `issues` 表，并保存 Issue，默认 `status=backlog`，同时保存 `created_at` 和 `updated_at`。
2. 给定 Issue 已创建，当用户编辑 `title` 或 `description`，则系统持久化更新，并更新 `updated_at`。
3. 给定用户查看 Issue 表单，当 UI 展示字段时，则不提供 priority、label、assignee、milestone 字段。

## Tasks / Subtasks

- [ ] 增量创建 `issues` 持久化 schema (AC: 1)
  - [ ] 新增 `src-tauri/migrations/0004_issues.sql`，创建 `issues` 表，字段至少包含 `id`、`project_id`、`title`、`description`、`status`、`created_at`、`updated_at`。
  - [ ] `id` 使用 `INTEGER PRIMARY KEY`；`project_id` 使用 INTEGER 并引用 `projects(id)`；`created_at` / `updated_at` 使用 Unix epoch milliseconds 的 `INTEGER NOT NULL`。
  - [ ] 为当前 Project 查询添加索引，例如 `idx_issues_project_id_status` 或 `idx_issues_project_id_updated_at`。
  - [ ] 更新 `src-tauri/src/db/migrations.rs` 的静态 migration 列表，确保 `0001_core`、`0002_projects`、`0003_project_integer_ids` 后执行 `0004_issues`，并保持现有事务、幂等和失败回滚行为。
  - [ ] 更新 `src-tauri/tests/local_data.rs` 对 migration 版本的预期，从 `0003_project_integer_ids` 扩展到 `0004_issues`。
- [ ] 建立 Issue DTO、repository 和 service 边界 (AC: 1, 2)
  - [ ] 新增 `src-tauri/src/types/issue.rs`，定义 `IssueStatus`、`IssueRecord`、`IssueListResponse`、`CreateIssueInput`、`UpdateIssueInput` 等跨边界 DTO，JSON 字段使用 `camelCase`。
  - [ ] `IssueStatus` 目前只需支持 `backlog` 的创建默认值，但类型必须保留 PRD 状态字面量：`backlog`、`running`、`review`、`completed`。
  - [ ] 新增 `src-tauri/src/db/issue_repository.rs`，只负责 `issues` 表读写：按 Project 查询、按 id 查询、insert、更新 `title`/`description` 和 `updated_at`。
  - [ ] 新增 `src-tauri/src/core/issue_service.rs`，负责业务校验：Project 必须存在；Issue 创建默认 `status=backlog`；创建和更新输入要 trim；空 `title` 返回结构化错误；前端校验不能替代 Rust Core 校验。
  - [ ] 更新 `src-tauri/src/types/mod.rs`、`src-tauri/src/db/mod.rs`、`src-tauri/src/core/mod.rs` 暴露新增模块。
- [ ] 暴露 Issue Tauri commands 和前端 command wrapper (AC: 1, 2)
  - [ ] 新增 `src-tauri/src/commands/issue_commands.rs`，只做 Tauri 参数适配、data dir 初始化、调用 `IssueService` 和错误映射。
  - [ ] 注册 commands：`list_issues`、`create_issue`、`update_issue`；command 使用 `snake_case`，前端 wrapper 使用 `camelCase`。
  - [ ] 新增或扩展错误码，例如 `ISSUE_PERSISTENCE_FAILED`、`ISSUE_NOT_FOUND`、`ISSUE_VALIDATION_FAILED`；错误结构继续包含 `code`、`message`、可选 `details[].@type`。
  - [ ] 新增 `src/features/issues/issue-commands.ts`，通过 `invokeCommand` 调用 Rust Core；不要在 feature 组件里直接调用 `invoke`。
- [ ] 将 `IssuesActivity` 从占位切换为最小 Issue 创建/编辑界面 (AC: 1, 2, 3)
  - [ ] 让 `AppShell` / `ActivityRouter` 把当前 `project.id` 传给 `IssuesActivity`；不要让 `IssuesActivity` 猜测当前 Project。
  - [ ] `IssuesActivity` 初次渲染时调用 `listIssues({ projectId })`，展示当前 Project 的 Issue 列表；空状态显示轻量提示和 `New Issue` 动作。
  - [ ] 提供最小创建表单，只包含 `title`、`description`、`Cancel`、`Create Issue`；成功后刷新/合并列表并选中新 Issue。
  - [ ] 提供最小编辑表单，只包含 `title`、`description`、`Save` 或失焦保存；保存成功后更新列表和当前选中 Issue。
  - [ ] UI 不提供 priority、label、assignee、milestone，不显示完整 Git/Diff/Agent/Run 能力，不新增 Story 1.6 的右侧 Session 操作区。
  - [ ] 对失败显示事实性错误并保留原业务状态，例如创建失败不插入 Issue，更新失败不把本地缓存伪装成已保存。
- [ ] 保留前置 story 行为并控制范围 (AC: 1-3)
  - [ ] 保留 Project Home、Project Switcher、路径异常、Activity Bar 和默认 Issues Activity 行为。
  - [ ] 不提前实现 `issue_actions`；Story 1.7 专门负责 IssueAction 审计。若本 story 实现创建 Issue command event，可只作为 UI refresh 辅助，不写审计表。
  - [ ] 不实现 Story 1.6 的完整四泳道和 Issue Detail Dialog 右侧操作；最小列表/表单可以为后续四泳道重构保留清晰组件边界。
  - [ ] 不实现 Run Dialog、Agent Profile、Agent Session、Mark Review、Completion、Summary/Log、Git history 或 cloud sync。
- [ ] 测试与验证 (AC: 1-3)
  - [ ] 添加 Rust 测试覆盖：`0003_issues` migration 创建字段、外键/索引；创建 Issue 默认 `backlog` 并保存 timestamps；更新 `title`/`description` 会推进 `updated_at`；空标题失败且不插入；跨 Project 查询不会泄漏其它 Project 的 Issue。
  - [ ] 添加或更新 Vitest 覆盖：进入 Project 后 `IssuesActivity` 调用 `listIssues`；空状态能打开创建表单；创建只提交 `title`/`description` 并渲染返回 Issue；编辑只更新 `title`/`description`；表单中不存在 priority、label、assignee、milestone。
  - [ ] 运行 `pnpm format`。
  - [ ] 运行 `cargo fmt --manifest-path src-tauri/Cargo.toml`。
  - [ ] 运行 `pnpm lint`。
  - [ ] 运行 `pnpm typecheck`。
  - [ ] 运行 `pnpm test`。
  - [ ] 运行 `pnpm build`。
  - [ ] 运行 `cd src-tauri && cargo test`。

## Dev Notes

### 范围边界

- 本 story 交付 FR4：在已打开 Project 的 Issues Activity 中创建和编辑极简 Issue，持久化 `title`、`description`、`status`、`created_at`、`updated_at`，新 Issue 默认 `backlog`。
- Story 1.6 才负责四个常驻泳道、Issue card 规范和左右两栏 Issue Detail Dialog；本 story 可提供最小可用列表/表单，但不要把完整看板和右侧操作区提前做完。
- Story 1.7 才负责 `issue_actions` 表和创建 Issue 审计记录；本 story 不应写入成功类 IssueAction，否则会混入后续 story 的验收范围。
- 本 story 不新增 priority、label、assignee、milestone，也不实现 Agent Run、Session、Review、Completion、Summary、Log 或 Git 检测。

### 架构约束

- SQLite 只能由 Rust Core 的 repository/service 层读写；React 不直接访问数据库或本地文件系统。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Architecture]
- Issue / AgentSession / CompletionAttempt 状态变化只通过 Rust Core command 完成；React store 只保存 view state、选中项、Dialog 可见性和缓存查询结果。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns]
- Tauri command 使用 `snake_case`，前端 wrapper 使用 `camelCase`；跨边界 DTO 显式建模，JSON 字段使用 `camelCase`。[Source: `_bmad-output/planning-artifacts/architecture.md` §API / Command Naming Conventions]
- `commands/*_commands.rs` 只做边界适配；`core/*_service.rs` 执行业务校验和状态动作；`db/*_repository.rs` 只做持久化。[Source: `_bmad-output/planning-artifacts/architecture.md` §Service Boundaries]
- SQLite 表名使用 `snake_case` 复数名词，列名使用 `snake_case`；主键使用 `INTEGER PRIMARY KEY`；外键字段使用 INTEGER；timestamp 列以 `_at` 结尾并保存 Unix epoch milliseconds。[Source: `_bmad-output/planning-artifacts/architecture.md` §Database Naming Conventions]
- 新增 command 时必须有统一错误 code、command wrapper 和至少一个失败路径测试。[Source: `_bmad-output/planning-artifacts/architecture.md` §Enforcement Guidelines]

### 当前代码状态与修改指引

- `src/features/issues/issues-activity.tsx` 目前只有 `Issues` 标题和 “Issue tracking is not configured...” 空态；本 story 应在这里接入最小 Issue 查询、创建和编辑 UI。
- `src/app/activity-router.tsx` 目前不接收 Project；需要把 `project.id` 从 `AppShell` 传给 `IssuesActivity`，同时保持 Agents/Settings 现有占位不受影响。
- `src/app/app-shell.tsx` 已有 Project Switcher 和默认 `activeActivity = "issues"`；修改时不要破坏 Project Switcher 的新窗口行为和 Activity Bar 入口。
- `src/features/project/project-commands.ts` 展示了 command wrapper 模式；Issue wrapper 应放在 `src/features/issues/issue-commands.ts`，继续通过 `invokeCommand`。
- Rust 侧当前只有 Project 模块：`types/project.rs`、`db/project_repository.rs`、`core/project_service.rs`、`commands/project_commands.rs`。Issue 模块应平行新增，不要把 Issue 逻辑塞进 Project service。
- `src-tauri/src/db/migrations.rs` 当前内联注册 Project 相关 migrations；本轮 course correction 已为 Project 整数 id / epoch ms 预留 `0003_project_integer_ids`，因此 Issue schema 应新增为 `0004_issues`。
- `src-tauri/tests/project.rs` 已覆盖 Project repository/service 行为。Issue 测试可以新建 `src-tauri/tests/issue.rs`，保持测试职责清晰。

### 数据与行为细节

- `issues` 表建议 schema：

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

- 为查询添加索引，例如 `CREATE INDEX IF NOT EXISTS idx_issues_project_id_status ON issues (project_id, status, updated_at);`。如果实现按 `updated_at DESC` 列表排序，也可使用 `idx_issues_project_id_updated_at`。
- Issue id 使用 SQLite 自动分配的整数 id；不要再使用 `issue-` + 随机 hex 字符串。
- `list_issues` 只返回当前 Project 的 Issues，建议按 `updated_at DESC, created_at DESC` 排序。
- `create_issue` 输入只接受 `projectId`、`title`、`description`；Rust Core trim 后持久化。`title` 为空时返回 `ISSUE_VALIDATION_FAILED`，不插入记录。
- `description` 可以为空字符串；不要为了“完整任务描述”强制前端或 Rust Core 拒绝空描述，除非后续需求明确要求。
- `update_issue` 只允许更新 `title` 和 `description`；不得从前端传入或修改 `status`、`createdAt`、`updatedAt`、`projectId`。
- 更新时必须设置新的 `updated_at` epoch milliseconds；如果测试偶发相等，测试可先把旧值手动改成较早固定值再调用 service。
- Project 不存在时，创建/list 应返回结构化错误，不自动创建 Project，也不跨 Project 泄漏 Issue。

### UX 与可访问性要求

- Issues Activity 是 Project 打开后的默认入口；空态应是轻量工作台式，不要大插画、营销 hero 或复杂 dashboard。
- 表单字段只展示 `title` 和 `description`，标签要明确；不要展示 `status`、`updated_at`、priority、label、assignee、milestone。
- 创建/保存按钮必须可键盘聚焦；按钮 `type` 要显式设置，避免表单内按钮意外提交。
- 如果使用 Dialog，打开时焦点进入 Dialog，关闭后回到触发控件；`Esc` 可关闭最上层 Dialog。若使用内联表单，也要保持 Tab 顺序清晰。
- Issue card/list item 当前可展示 `title`、`status`、`updated_at`；更完整四泳道布局留给 Story 1.6。
- 视觉保持桌面工具密度：正文 13px、标签 12px、元信息 11px、圆角约 5px；不要使用大圆角 pill、彩色阶段柱或悬浮卡片式 page section。

### 前置故事信息

- Story 1.2 建立了 `LocalDataService`、SQLite 连接、migration runner、`initialize_local_data` command、统一 `CommandError` 和前端 `invokeCommand` wrapper。
- Story 1.3 建立了 `projects` migration、Project DTO/repository/service、Git repo 最小检测、`create_project` command、Tauri dialog 创建流程；review 已修复 canonical path、duplicate insert、dialog pending/reject、最小 dialog 权限、路径错误区分、SQLite 随机 Project id。
- Story 1.4 建立了 `list_projects`、`open_project`、`open_project_window`、Project Home 持久化列表恢复、路径异常展示、Project Switcher 和跨窗口 Project 打开行为；review 已修复重复窗口聚焦、URL 项目打开错误归因、Activity Project 名称去重和 Switcher `Esc` 关闭。
- 2026-06-05 course correction：Project id 和未来实体 id 统一改为 SQLite INTEGER；`created_at`、`updated_at`、`last_opened_at` 等时间列统一改为 epoch milliseconds，UI 展示时按本机本地时区格式化。
- 最近提交 `adc21ae Set macOS traffic light y position to 22` 只调整 titlebar/窗口 chrome；本 story 不需要继续修改 titlebar 行为。

### Git Intelligence

- `7e63763 Implement project home switcher workflow` 是 Story 1.4 的主要实现提交，建立了 `ProjectListResponse`、`ProjectListItem`、`OpenProjectInput`、`open_project`、`open_project_window`、Project Switcher 以及前端 Project 列表刷新模式；Issue CRUD 应沿用这些 command wrapper 和 service/repository 测试方式。
- `34204de Implement git project creation` 是 Story 1.3 的实现提交，建立了 migration/repository/service/command 的 Project 分层；新增 Issue 应平行扩展，不复用 Project service 承担 Issue 业务。
- `aba494e Implement local data storage boundary` 建立了 migration 事务和结构化 `CommandError`；新增 Issue 错误码不需要改前端 guard，除非破坏 `SCREAMING_SNAKE_CASE` 或 `details[].@type`。

### 最新技术信息

- 当前仓库实际依赖以 `package.json` 和 `src-tauri/Cargo.toml` 为准：React `^19.1.0`、`@tauri-apps/api` `^2`、`rusqlite = "0.40.0"`、`tauri = "2"`。
- Tauri v2 官方 “Calling Rust” 文档仍以 `invoke` 调用 Rust command，并展示 Rust/serde 可用 `rename_all = "camelCase"` 管理跨边界字段；本项目已通过 `invokeCommand` 封装这一模式。
- React 官方 `<input>` / `<textarea>` 文档要求 controlled 输入传 `value` 时同步提供 `onChange`；本 story 表单如使用 controlled state，应始终初始化为字符串，避免 uncontrolled/controlled 切换。
- rusqlite 文档中 optional single-row 查询可用 `OptionalExtension::optional()`；当前 Project repository 已采用该模式，Issue repository 可沿用。

### 测试要求

- 因本 story 会改动 TypeScript/React 源码，必须运行 `pnpm lint` 与 `pnpm typecheck`。
- 因本 story 会改动运行时行为、分支逻辑、数据流、渲染逻辑和测试依赖实现，除 lint/typecheck 外必须运行前端测试和 Rust 测试。
- 最小验证命令清单：

```bash
pnpm format
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cd src-tauri && cargo test
```

- 如果任何命令因环境、耗时或外部依赖无法运行，必须记录未运行项、原因和风险；不能把未执行命令口头视为已验证。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 1 / Story 1.5、Story 1.6、Story 1.7、FR4、FR5、FR6、NFR1、NFR2。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — FR-4 至 FR-6、本地 Issue 管理可测试结果。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — Command/Event 同步模型、`issues` 表草案、React IA 冻结口径。
- `_bmad-output/planning-artifacts/architecture.md` — Data Architecture、API & Communication Patterns、Naming Patterns、State Management Patterns、Service Boundaries、Validation Patterns、Enforcement Guidelines。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Issues Activity、Issue Detail、空态、键盘和 modal discipline。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md` — Issue card、Dialog、工作台视觉密度、圆角与布局规则。
- `_bmad-output/implementation-artifacts/1-4-show-project-home-and-handle-path-errors.md` — 前置 story 的 Project Switcher、Project open、测试命令和 review 修复记录。
- `_bmad-output/implementation-artifacts/1-3-create-git-project.md` — Project migration/repository/service/command 分层、随机 id、错误处理和测试模式。
- `docs/standards/shared/api-conventions.md` — 错误响应结构和 `details` 约定。
- Tauri v2 Calling Rust 文档: https://v2.tauri.app/develop/calling-rust/
- React `<input>` 文档: https://react.dev/reference/react-dom/components/input
- React `<textarea>` 文档: https://react.dev/reference/react-dom/components/textarea
- rusqlite `Statement` / `OptionalExtension` 文档: https://docs.rs/rusqlite/latest/rusqlite/struct.Statement.html

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- create-story 上下文分析已完成，已生成 Story 1.5 的开发实现指南。

### File List

### Change Log
