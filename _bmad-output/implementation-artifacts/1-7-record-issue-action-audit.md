---
baseline_commit: abdbf9463937a92ecfe6a9cd4c585c8af14fa01c
---

# Story 1.7: 记录 IssueAction 审计

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望 Issue 状态相关动作被记录,
以便我能复盘本地任务发生过什么。

## Acceptance Criteria

1. 给定用户创建 Issue，当 Issue 创建成功时，则如 schema 尚未存在则通过 migration 创建 `issue_actions` 表，并写入一条 IssueAction。
2. 给定写入成功的 IssueAction，当开发者检查持久化记录时，则记录至少包含 `issue_id`、`action_type`、`payload_json`、`created_at`。
3. 给定当前 Epic 里后续状态动作尚未实现，当本 story 完成时，则当前 IssueAction 结构仍能支持后续启动 Agent、`Mark Review`、完成 Issue 的动作类型，并且不要求提前实现这些状态流转。
4. 给定 Issue 创建失败，当 command 返回错误时，则系统不写入成功类 IssueAction，并且 UI 继续显示现有失败原因。

## Tasks / Subtasks

- [x] 增量创建 `issue_actions` 持久化 schema (AC: 1, 2, 3)
  - [x] 新增 `src-tauri/migrations/0005_issue_actions.sql`，创建 `issue_actions` 表；字段至少包含 `id`、`issue_id`、`action_type`、`payload_json`、`created_at`。
  - [x] `id` 使用 `INTEGER PRIMARY KEY`；`issue_id` 使用 `INTEGER NOT NULL` 并引用 `issues(id)`；`payload_json` 使用 `TEXT NOT NULL` 保存 JSON 字符串；`created_at` 使用 Unix epoch milliseconds 的 `INTEGER NOT NULL`。
  - [x] 为 `issue_id` 和按时间倒序查询补最小索引，例如 `idx_issue_actions_issue_id_created_at`；不要提前设计不被当前 story 使用的宽表、额外状态列或通用事件总线。
  - [x] 更新 `src-tauri/src/db/migrations.rs` 的静态 migration 列表，确保 `0004_issues` 后执行 `0005_issue_actions`，并保持现有事务、幂等和失败回滚行为。
- [x] 建立 IssueAction DTO 与 repository 边界 (AC: 2, 3)
  - [x] 新增 `src-tauri/src/types/issue_action.rs`，定义跨边界或内部共享的最小类型，例如 `IssueActionType`、`IssueActionRecord`、创建输入或 payload helper；JSON 字段输出保持 `camelCase`。
  - [x] `IssueActionType` 当前至少支持 `issue_created`，但命名和枚举结构必须能自然扩展到后续 `agent_started`、`marked_review`、`issue_completed` 等动作。
  - [x] 新增 `src-tauri/src/db/event_repository.rs` 或同等清晰命名的 repository，仅负责 `issue_actions` 表写入与按 Issue 查询；不要把业务判定塞进 repository。
  - [x] 更新 `src-tauri/src/db/mod.rs`、`src-tauri/src/types/mod.rs` 暴露新增模块，保持现有分层。
- [x] 在 Issue 创建成功路径中写入审计记录 (AC: 1, 2, 4)
  - [x] 更新 `src-tauri/src/core/issue_service.rs`，让 `create_issue` 在同一业务路径中完成“插入 Issue”与“写入 issue_created 审计”。
  - [x] 审计 payload 至少记录当前 story 可稳定提供的信息，例如 `title`、`description`、`status`；字段命名保持克制，为后续动作复用保留空间。
  - [x] 若写入 IssueAction 失败，应将整个创建流程视为失败，避免出现已创建 Issue 但缺失必需审计记录的半成功状态。
  - [x] `update_issue` 继续保持当前行为；本 story 不为编辑动作补 IssueAction，避免超出 FR6 当前范围。
- [x] 保持前端边界和现有失败行为 (AC: 4)
  - [x] 保留 `src/features/issues/issue-commands.ts`、`src/features/issues/issues-activity.tsx` 现有 command 调用和错误展示行为，除非 Rust DTO 变更迫使同步调整。
  - [x] 不新增前端直连数据库、文件系统或 shell；不在 React 中伪造审计结果。
  - [x] 若 Rust 错误码、错误消息或 DTO 形状未变，优先不改 TypeScript/React 源码，降低回归面。
- [x] 测试与验证 (AC: 1, 2, 3, 4)
  - [x] 添加 Rust 测试覆盖：`0005_issue_actions` migration 创建字段、外键和索引；成功创建 Issue 时生成一条 `issue_created` 审计；Issue 创建失败时不写入成功类审计。
  - [x] 添加 Rust 测试覆盖：Issue 与 IssueAction 写入具有原子性，任一环节失败时数据库不留下半成功状态。
  - [x] 若新增按 Issue 查询审计的 repository API，补最小 repository 测试，验证 `payload_json` 和时间戳落库形状。
  - [x] 若实际改动了 TypeScript/React 源码，则按仓库规则补对应前端测试并运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。
  - [x] 运行 `cargo fmt --manifest-path src-tauri/Cargo.toml`。
  - [x] 运行 `cd src-tauri && cargo test`。

## Dev Notes

### 关键假设与取舍

- 当前 FR6 在 Epic 1 的最小落点是“创建 Issue 成功时写入一条 `issue_created` 审计”；后续 `Run`、`Mark Review`、完成 Issue 的审计由后续 stories 复用本 story 建立的表结构和 repository 边界继续扩展。[Source: `_bmad-output/planning-artifacts/epics.md` §Story 1.7; `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` §FR-6]
- `payload_json` 采用 JSON 字符串持久化即可，不需要为了当前 story 引入 SQLite 自定义 JSON 列类型或额外插件；架构已约定 JSON payload 列统一以 `_json` 结尾。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Model Conventions]
- 当前 story 不要求把 Issue 编辑也纳入审计；范围只覆盖“成功创建 Issue 写成功类审计”和“创建失败不写成功类审计”。如果顺手给编辑动作加审计，会把后续状态机和 UI 预期一起提前拉进来，超出本 story 范围。

### 范围边界

- 交付 FR6 在 Epic 1 的首个实现：建立 `issue_actions` schema、最小类型与 repository、在 Issue 创建成功路径写入审计、并补齐 Rust 测试。
- 不交付 Agent Session、SessionEvent、Run Dialog、`Mark Review`、完成策略、Summary、日志或 `completion_attempts`。
- 不新增前端审计列表 UI、不新增 Issue 状态流转 command、不把 `update_issue` 改成状态机入口。

### 架构约束

- SQLite 写入只能发生在 Rust repository/service 层；React 不直接访问数据库或 shell。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Boundaries]
- `commands/*_commands.rs` 只做 Tauri 边界适配；业务规则放在 `core/*_service.rs`；持久化细节放在 `db/*_repository.rs`。[Source: `_bmad-output/planning-artifacts/architecture.md` §Service Boundaries]
- FR-4 至 FR-6 的长期结构落点是 `features/issues/`、`core/issue_service.rs`、`core/state_machine.rs`、`db/issue_repository.rs`、`db/event_repository.rs`。当前仓库里 `state_machine.rs` 与 `event_repository.rs` 还不存在，本 story 只需补最小可用边界，不要反向大规模搭完整状态机框架。[Source: `_bmad-output/planning-artifacts/architecture.md` §Requirements to Structure Mapping]
- 新增状态变更时必须同时补 IssueAction 或 SessionEvent / CompletionAttempt。本 story 至少要保证“创建 Issue”这条已有业务动作满足该约束。[Source: `_bmad-output/planning-artifacts/architecture.md` §Cross-Cutting Concerns]

### 当前代码状态与修改指引

- `src-tauri/src/core/issue_service.rs` 当前 `create_issue` 只做“校验 Project 存在 -> trim 字段 -> 写入 issues 表 -> 返回 DTO”，还没有任何审计写入。实现 Story 1.7 时应在这个 service 层把审计与 Issue 创建串起来，而不是在 command adapter 或前端补救。
- `src-tauri/src/db/issue_repository.rs` 当前只负责 `issues` 表的 `list`、`find`、`insert`、`update_title_and_description`。不要把 `issue_actions` 的 SQL 混进这个 repository，保持仓库职责单一。
- `src-tauri/src/commands/issue_commands.rs` 当前只负责解析 app data dir、初始化 local data，然后调用 `IssueService`。若 DTO 没变，这一层理论上不需要新增复杂逻辑。
- `src-tauri/src/db/migrations.rs` 当前静态 migration 顺序是 `0001_core`、`0002_projects`、`0003_project_integer_ids`、`0004_issues`，并通过单事务 + `INSERT OR IGNORE` 记录版本。`0005_issue_actions` 必须沿用这套机制。
- `src/features/issues/issue-commands.ts`、`src/features/issues/issues-activity.tsx` 当前只关心 Issue CRUD 和错误展示。若后端返回的 `IssueRecord` 结构不变，前端最好零改动，从而把回归面限制在 Rust 层。

### 实现建议

- 优先把“创建 Issue + 写审计”放进一个显式事务里，避免出现 `issues` 成功但 `issue_actions` 失败的半成功状态。现有 `IssueRepository::insert` 直接使用连接执行 SQL；若需要同事务复用，可以在 repository 层新增接受 `Transaction` 的最小写入入口，或让 service 先开启事务再调用更细粒度的方法。
- `payload_json` 建议保存可读且稳定的最小快照，例如：

```json
{
  "title": "Issue 标题",
  "description": "Issue 描述",
  "status": "backlog"
}
```

  不要过早加入未来 session、git、completion 相关字段。
- `action_type` 值建议使用稳定的 `snake_case` 字面量，如 `issue_created`，与现有 command/migration 命名风格保持一致，避免后续再做兼容迁移。
- 如果你选择新增 `IssueActionRecord`，字段命名应与其它 DTO 一致：Rust 侧 `snake_case` 字段，序列化输出 `camelCase`。

### 项目结构说明

- Rust schema 文件放在 `src-tauri/migrations/`。
- Rust 持久化层放在 `src-tauri/src/db/`。
- Rust 业务层放在 `src-tauri/src/core/`。
- Rust 跨边界类型放在 `src-tauri/src/types/`。
- 前端 Issues feature 仍位于 `src/features/issues/`，但本 story 应尽量不改这里。

### 前置故事信息

- Story 1.2 已建立 SQLite 初始化、migration runner、统一 `CommandError` 和前端 `invokeCommand` 边界。
- Story 1.3 已建立 Project schema、Git repo 校验和 Project 持久化。
- Story 1.5 已建立 `issues` schema、Issue DTO/repository/service/commands、Project 作用域校验、空标题验证和 `updated_at` 单调推进。
- Story 1.6 已把前端 Issues UI 升级为四泳道与 Dialog，并明确说明 `issue_actions` 由 Story 1.7 负责，不应在 1.6 里提前实现。

### Git Intelligence

- 当前 `HEAD` 为 `abdbf94`，这是进入本 workflow preflight 时记录的基线提交；正式进入 `dev-story` 后应把它写入 story frontmatter 作为实现 diff 基线。
- 现有工作区在本 workflow 开始时没有源码脏改动，只有 handoff 文件会在流程中更新；后续实现和自动提交时仍需只暂存与 Story 1.7 直接相关的文件。

### 测试要求

- 本 story 的最小实现大概率只改 Rust；这种情况下优先验证 Rust 侧 schema、service 和事务行为。
- 若实现过程中改到了 TypeScript / React 源码，按仓库规则默认至少运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

- 不论是否改动前端，Rust 侧至少运行：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cd src-tauri && cargo test
```

- 如果实际实现修改了跨边界 DTO 或 Tauri command 形状，建议再补一轮：

```bash
pnpm build
```

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 1 / Story 1.7、FR6。
- `_bmad-output/planning-artifacts/architecture.md` — Data Boundaries、Service Boundaries、Requirements to Structure Mapping、Cross-Cutting Concerns、Data Model Conventions。
- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` — FR-6、schema rollout recommendation。
- `_bmad-output/implementation-artifacts/1-5-create-and-edit-local-issue.md` — 现有 Issue CRUD、测试与 review 修复。
- `_bmad-output/implementation-artifacts/1-6-show-issues-kanban-and-issue-detail-dialog.md` — 前端范围边界，明确 `issue_actions` 不在 1.6 实现。
- `src-tauri/src/core/issue_service.rs` — 当前 Issue 创建/更新业务入口。
- `src-tauri/src/db/issue_repository.rs` — 当前 `issues` 表持久化边界。
- `src-tauri/src/commands/issue_commands.rs` — 当前 Tauri command 适配层。
- `src-tauri/src/db/migrations.rs` — 当前 migration 注册顺序与事务逻辑。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-06T07:11:08+0800：`bmad-dev-workflow` preflight 完成，识别到 `1-7-record-issue-action-audit` 为首个 backlog story。
- 2026-06-06T07:11:08+0800：create-story 上下文分析完成，基于 `epics.md`、`architecture.md`、`implementation-readiness-report-2026-06-04.md` 和当前 Issue 相关代码状态生成开发指南。
- 2026-06-06T07:22+0800：按 TDD 先补 `issue_actions` schema、审计写入和失败回滚测试，再实现 `IssueService` 事务化创建路径。
- 2026-06-06T07:28+0800：RED 暴露 `event_repository` 生命周期问题，修正查询返回值后 Rust 定向测试转绿。
- 2026-06-06T07:35+0800：完成 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与全量 `cargo test --manifest-path src-tauri/Cargo.toml`，全部通过。

### Completion Notes List

- create-story 已为 Story 1.7 生成完整开发上下文。
- Story 1.7 聚焦最小 FR6：Issue 创建成功时写入 `issue_created` 审计，失败时不写成功类审计。
- Dev Notes 已明确当前仓库缺少 `event_repository.rs` / `state_machine.rs`，本 story 只补最小必要边界，不提前搭完整状态机。
- 已记录 Rust 优先验证清单，以及“若改动 TypeScript/React 则追加前端验证”的规则。
- 新增 `0005_issue_actions` migration、`IssueActionType` / `IssueActionRecord` 类型和 `EventRepository`，将 Issue 审计边界独立出 `IssueRepository`。
- `IssueService::create_issue` 已改为同一 SQLite 事务内完成 Issue 插入和 `issue_created` 审计写入；若审计写入失败，Issue 创建整体回滚。
- 前端契约未变化，因此未改动 TypeScript / React 源码，也未运行前端 `lint` / `typecheck` / `test`。
- Rust 验证已实际执行：`cargo test --manifest-path src-tauri/Cargo.toml --test issue`、`cargo test --manifest-path src-tauri/Cargo.toml --test local_data`、`cargo fmt --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`。

### File List

- _bmad-output/implementation-artifacts/1-7-record-issue-action-audit.md
- src-tauri/migrations/0005_issue_actions.sql
- src-tauri/src/core/issue_service.rs
- src-tauri/src/db/event_repository.rs
- src-tauri/src/db/issue_repository.rs
- src-tauri/src/db/migrations.rs
- src-tauri/src/db/mod.rs
- src-tauri/src/types/issue_action.rs
- src-tauri/src/types/mod.rs
- src-tauri/tests/issue.rs
- src-tauri/tests/local_data.rs

### Change Log

- 2026-06-06: 实现 Story 1.7 的 IssueAction 审计基础设施、事务化 Issue 创建路径和 Rust 测试，状态推进到 review。
- 2026-06-06: 外部三层 review 均无 findings，状态推进到 done。
