---
baseline_commit: 4a33c85
---

# Story 1.2: 建立本地数据存储和核心命令边界

Status: done

<!-- 说明：可在 dev-story 前运行 validate-create-story 做质量检查。 -->

## Story

作为 RedWhisk 用户,
我希望应用把本地 Project 和 Issue 数据可靠保存在本机,
以便我重新打开应用时能继续之前的工作流.

## Acceptance Criteria

1. 给定应用首次启动，当 Rust Core 初始化本地数据目录时，则系统创建或打开 SQLite 数据库，并运行 migration 基础设施，包含迁移版本记录和后续故事可增量扩展的 schema 管理。
2. 给定 React 需要读取或改变业务状态，当前端触发操作时，则前端只能通过 Tauri command 调用 Rust Core，并且不直接访问 SQLite 或 shell。
3. 给定 Rust Core command 失败，当错误返回前端时，则错误结构包含 `code`、`message` 和可选 `details`，并且错误码使用 `SCREAMING_SNAKE_CASE`。

## Tasks / Subtasks

- [x] 建立 Rust Core 数据目录和 SQLite 连接基础设施 (AC: 1)
  - [x] 在 `src-tauri/Cargo.toml` 添加当前 story 必需的最小 Rust 依赖，例如 `rusqlite`、错误派生和临时目录测试依赖；不要引入 `tauri-plugin-sql` 作为业务写入路径。
  - [x] 新建 `src-tauri/src/app_state.rs`，集中保存 core/database 状态，并通过 `tauri::Builder::manage(...)` 注入。
  - [x] 新建 `src-tauri/src/db/connection.rs`，由 Rust Core 解析应用本地数据目录，创建目录并打开 `redwhisk.sqlite3`。
  - [x] 路径解析必须在 Rust 侧完成；React 不能传入数据库路径或直接读取本地数据目录。
- [x] 建立 migration runner 和版本记录 (AC: 1)
  - [x] 新建 `src-tauri/src/db/migrations.rs` 和 `src-tauri/migrations/0001_core.sql`。
  - [x] migration runner 必须创建迁移版本记录表，例如 `schema_migrations`，记录已应用 migration 的版本和 `applied_at`。
  - [x] `0001_core.sql` 只创建 migration 基础设施需要的最小结构；不要提前实现完整 `projects`、`issues`、`agent_sessions` 等业务表，除非当前 AC 直接需要。
  - [x] migration runner 必须可重复运行：第二次启动不重复应用已记录 migration，也不破坏已有数据库。
- [x] 建立 Rust command/core/db/types 目录边界 (AC: 1, 2, 3)
  - [x] 新建 `src-tauri/src/commands/`、`src-tauri/src/core/`、`src-tauri/src/db/`、`src-tauri/src/types/` 的 `mod.rs`。
  - [x] `commands/*` 只做 Tauri command 适配、参数校验和错误映射；业务状态和本地副作用放在 `core/*` 或 `db/*`。
  - [x] `db/*` 只做 SQLite 连接、migration 和后续 repository 基础，不放 UI 或 Tauri adapter 逻辑。
  - [x] `types/*` 放跨 Tauri 边界 DTO 和错误响应结构，并使用 `serde` 显式建模。
- [x] 暴露最小 Tauri command 用于初始化/健康检查 (AC: 2, 3)
  - [x] 新增一个最小 command，例如 `initialize_local_data` 或 `get_local_data_status`，触发 Rust Core 初始化数据库和 migration，并返回结构化状态 DTO。
  - [x] 在 `src-tauri/src/lib.rs` 注册 command handler，并保持现有 `tauri_plugin_opener`。
  - [x] 成功响应应包含可测试的数据库状态信息，例如 database 是否存在、已应用 migration 版本列表或当前 schema version。
  - [x] 失败路径必须返回统一错误结构，而不是 panic、字符串错误或未建模 JSON。
- [x] 建立统一 command error 模型和前端 command client 边界 (AC: 2, 3)
  - [x] 新建 `src-tauri/src/types/errors.rs`，定义 `CommandError` / domain error code；序列化字段使用 `camelCase`，错误码值使用 `SCREAMING_SNAKE_CASE`。
  - [x] 新建 `src/shared/commands/command-error.ts`，定义前端侧 `CommandError` 类型和识别 helper。
  - [x] 新建 `src/shared/commands/command-client.ts`，封装 `@tauri-apps/api/core` 的 `invoke`；feature 代码不得直接散落调用 `invoke`。
  - [x] 新建最小 feature command wrapper，例如 `src/features/project/project-commands.ts` 或清晰命名的 core command wrapper，供后续 Project/Issue story 复用。
- [x] 连接现有 React 壳但不伪造持久化 (AC: 2)
  - [x] 保留 Story 1.1 已实现的 Project Home 首屏、mock Project cards、点击进入工作台和 Activity Bar 行为。
  - [x] 若在 React 启动时调用初始化 command，失败必须以明确可测试状态呈现，但不要把 mock Project cards 声称为已持久化数据。
  - [x] 不新增直接 SQLite、shell、Git 或文件系统访问到 React；此 story 的前端改动仅限 command client/wrapper 和必要的初始化状态展示。
- [x] 测试与验证 (AC: 1, 2, 3)
  - [x] 添加 Rust 测试覆盖 migration 首次运行、重复运行、版本记录和 command 错误序列化。
  - [x] 添加或更新 React/Vitest 测试，覆盖前端通过 command wrapper 处理成功/失败结果；如 UI 展示初始化失败状态，也覆盖该渲染分支。
  - [x] 运行 `pnpm format`。
  - [x] 运行 `pnpm lint`。
  - [x] 运行 `pnpm typecheck`。
  - [x] 运行 `pnpm test`。
  - [x] 运行 `pnpm build`。
  - [x] 运行 `cd src-tauri && cargo test`。

### Review Findings

- [x] [Review][Patch] migration 执行与版本记录必须在同一事务中完成，并覆盖失败回滚测试 [src-tauri/src/db/migrations.rs:24]
- [x] [Review][Patch] migration 流程需要处理多进程/多连接并发初始化，避免重复插入版本记录导致初始化失败 [src-tauri/src/db/migrations.rs:24]
- [x] [Review][Patch] `ensure_migration_table` 不应复用完整 `0001_core.sql`，否则未来扩展会绕过版本控制反复执行 [src-tauri/src/db/migrations.rs:82]
- [x] [Review][Patch] 应用首次启动路径没有实际调用本地数据初始化，SQLite 和 migration 不会在当前生产启动路径运行 [src/app/app.tsx:32]
- [x] [Review][Patch] `app_data_dir` 解析失败发生在 Tauri setup 阶段时会绕过统一 command error 结构 [src-tauri/src/lib.rs:15]
- [x] [Review][Patch] 前端 `isCommandError` 过宽，未校验错误码格式和 `details[].@type` [src/shared/commands/command-error.ts:12]

## Dev Notes

### 范围边界

- 本 story 是 Enabler Story：只建立本地数据存储和 command 边界，不交付完整 Project 创建、Project 列表恢复、Issue CRUD、Agent Profile、PTY/Codex、Git 检测或完成策略。
- 不要提前创建完整业务 schema。规划文档明确：Story 1.2 创建数据库和 migration 基础设施，不一次性创建所有领域表；`projects` 在 Story 1.3 首次需要时通过 migration 创建，`issues` 在 Story 1.5 首次需要时创建。[Source: `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` §Recommendation]
- 不要把当前 mock Project cards 改成“已持久化”假数据。Story 1.1 的 mock state 只是入口壳，真实 Project 读取/创建属于 Story 1.3/1.4。
- 不引入 HTTP REST/GraphQL、Redux、Turbo、云同步、登录、多租户、通用 shell plugin 或前端 SQL plugin。

### 架构约束

- 结构化存储选择本地 SQLite，但业务写入必须通过 Rust Core 的 repository/service 层；React 不直接访问数据库。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Architecture]
- migration runner 在 Rust 侧执行，migration 文件随应用打包；首次启动或打开 Project 时运行 migration。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Architecture]
- 前后端通信边界是 Tauri command + event，不引入 HTTP API；command 用于请求动作，event 用于通知状态变化。[Source: `_bmad-output/planning-artifacts/architecture.md` §API & Communication Patterns]
- 所有 command 返回统一错误结构：`code`、`message`、可选 `details`；错误码使用 `SCREAMING_SNAKE_CASE`。[Source: `_bmad-output/planning-artifacts/epics.md` Story 1.2; `_bmad-output/planning-artifacts/architecture.md` §API & Communication Patterns]
- `commands/*_commands.rs` 只做边界适配，不复制业务规则；`core/*_service.rs` 执行业务动作；`db/*_repository.rs` 只做持久化。[Source: `_bmad-output/planning-artifacts/architecture.md` §Service Boundaries]
- React store 只保存 view state、选中项、Dialog/Inspector 可见性和缓存查询结果；业务状态 source of truth 是 Rust Core。[Source: `_bmad-output/planning-artifacts/architecture.md` §State Management Patterns]

### 文件结构要求

当前仓库已有 Story 1.1 生成的 Tauri + React 骨架。预计新增或更新：

```text
src/
  features/
    project/
      project-commands.ts
  shared/
    commands/
      command-client.ts
      command-error.ts
src-tauri/
  migrations/
    0001_core.sql
  src/
    app_state.rs
    commands/
      mod.rs
      core_commands.rs
    core/
      mod.rs
      local_data_service.rs
    db/
      mod.rs
      connection.rs
      migrations.rs
    types/
      mod.rs
      errors.rs
      local_data.rs
  tests/
    local_data.rs
```

- 文件和目录使用现有约定：前端文件 `kebab-case`，Rust module/file `snake_case`。[Source: `_bmad-output/planning-artifacts/architecture.md` §Naming Patterns; `docs/standards/shared/coding-style.md` §命名规范]
- `src/shared/` 只能放跨 feature 复用的基础能力；不要新增泛化 `utils` 目录。[Source: `_bmad-output/planning-artifacts/architecture.md` §Structure Patterns; `docs/standards/shared/coding-style.md` §组织方式]
- 若实现时发现 Tauri/Rust 测试更适合放在 `src-tauri/src/...` 单元测试中，可以保留单元测试，但 migration/command 边界至少要有可重复运行的 Rust 测试覆盖。

### 数据与错误约定

- SQLite 表名使用 `snake_case` 复数名词，列名使用 `snake_case`，timestamp 列以 `_at` 结尾并保存 ISO 8601 UTC 字符串。[Source: `_bmad-output/planning-artifacts/architecture.md` §Naming Patterns]
- 迁移版本表建议命名 `schema_migrations`，字段至少包含 migration version/name 和 `applied_at`。如使用其他命名，必须在代码和测试中保持清晰一致。
- 跨 Rust/TypeScript 边界 JSON 字段使用 `camelCase`；SQLite 内部列名使用 `snake_case`。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Exchange Formats]
- `details` 可选；存在时每个对象必须包含 `@type`。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Exchange Formats; `docs/standards/shared/api-conventions.md` §3.2]
- 外部输入必须在 Rust Core command 边界校验；前端即时校验不能代替 Rust Core 校验。[Source: `_bmad-output/planning-artifacts/architecture.md` §Validation Patterns]

### 当前代码状态

- `src-tauri/src/lib.rs` 目前只初始化 `tauri_plugin_opener` 并运行 builder；尚未注册任何 command 或 managed state。
- `src-tauri/Cargo.toml` 目前已有 `tauri`、`tauri-plugin-opener`、`serde`、`serde_json`，尚未接入 `rusqlite` 或 domain error 依赖。
- `src/app/app.tsx` 使用本地 React state 和 `MOCK_PROJECTS` 模拟 Project Home -> Project workbench；修改时必须保留未选择 Project 前不显示 Activity Bar、点击 Project 后默认 Issues 的行为。
- `src/app/app.test.tsx` 已覆盖 Project Home、`+` card 顺序、点击 Project 后 Activity Bar 和默认 Issues；新增初始化逻辑时必须维护这些测试或按真实行为更新。

### 前置故事信息

- Story 1.1 已建立 Tauri 2 + React 19 + TypeScript + Vite 单应用骨架，未引入 Turbo、Redux、路由框架或大型 UI/admin 组件库。
- Story 1.1 的验证已通过：`pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`cd src-tauri && cargo test`。
- Story 1.1 曾因本机 Cargo 1.79 不支持依赖的 Rust 2024 edition，更新到 Rust 1.96 后通过；如果 cargo 测试出现 edition/toolchain 错误，先确认当前 Rust toolchain。
- Story 1.1 的格式化脚本已刻意限制扫描范围，避免格式化 BMAD/WDS 资产和 Tauri/Cargo 生成目录。

### 最新技术信息

- 当前仓库实际依赖以 `package.json`、`pnpm-lock.yaml`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 为准；不要依赖规划文档中旧的 starter 版本号。
- 2026-06-04 本地 registry 查询：`rusqlite = 0.40.0`、`ts-rs = 12.0.1`、`thiserror = 2.0.18`、`@tauri-apps/api = 2.11.0`、`@tauri-apps/cli = 2.11.2`。
- `ts-rs` 是架构候选的 Rust -> TypeScript 类型导出工具，但本 story 可以先显式建模 DTO 和前端类型；如果引入类型导出脚本会扩大范围，应只在必要时加入。
- Tauri command handler 应返回可序列化成功 DTO 或统一错误 DTO；不要用 `expect`/panic 表达可恢复业务失败。参考 Tauri v2 Calling Rust 文档与当前项目的 `@tauri-apps/api/core` invoke 用法。

### 测试要求

- 因本 story 改动 TypeScript/React 边界，默认必须运行 `pnpm lint` 与 `pnpm typecheck`。
- 因本 story 改动运行时行为、分支逻辑、数据流和测试依赖实现，除 lint/typecheck 外必须运行 `pnpm test` 和 Rust 测试。
- 最小验证命令清单：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cd src-tauri && cargo test
```

- 如果新增 Rust lint 脚本或手动运行 `cargo fmt` / `cargo clippy`，应记录在 Dev Agent Record 的验证结果中；但不要把未运行的命令写成已验证。
- 如果任何命令因环境、耗时或外部依赖无法运行，必须记录未运行项、原因和风险。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 1 / Story 1.2、Story 1.3、Story 1.4。
- `_bmad-output/planning-artifacts/architecture.md` — Data Architecture、API & Communication Patterns、Naming Patterns、Structure Patterns、Service Boundaries、Data Boundaries、Testing Structure。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — Project、本地恢复、Issue、审计和 NFR。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — Rust Core / SQLite Store 边界、command/event 表、初始 schema 参考。
- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` — Story 1.2 Enabler 范围和不要一次性创建所有领域表的建议。
- `docs/standards/shared/coding-style.md` — 命名、类型和组织方式。
- `docs/standards/shared/api-conventions.md` — 错误响应结构和 `details` 约定。
- Tauri v2 Calling Rust 文档: https://v2.tauri.app/develop/calling-rust/
- Tauri v2 State Management 文档: https://v2.tauri.app/develop/state-management/
- Rust crate registry 查询：`cargo search rusqlite --limit 3`、`cargo search ts-rs --limit 3`、`cargo search thiserror --limit 3`。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-04: 先添加 `src-tauri/tests/local_data.rs` 与 `src/shared/commands/command-client.test.ts` 红灯测试；初次运行分别失败于缺少 `db`/`types` Rust 模块、`tempfile` 依赖和前端 command wrapper。
- 2026-06-04: 初次 `cargo test --test local_data` 两次因新依赖下载/编译超时未完成；按用户提供的 SOCKS5 代理仅设置命令环境变量后通过。
- 2026-06-04: 未引入 `tauri-plugin-sql`，使用 `rusqlite` 由 Rust Core 独占 SQLite 初始化与 migration。
- 2026-06-04: Code review 提出 6 个 patch findings；已一次性修复并重新运行完整验证。

### Completion Notes List

- create-story 上下文分析已完成，已生成 Story 1.2 的开发实现指南。
- 已建立 Rust Core 本地数据初始化路径：Tauri `setup` 通过 `app.path().app_data_dir()` 解析应用数据目录，并将 `LocalDataService` 注入 `AppState`。
- 已新增 SQLite 连接层和 migration runner，创建 `redwhisk.sqlite3` 与 `schema_migrations`，并验证 migration 可重复运行。
- 已新增 `initialize_local_data` Tauri command，成功返回 `LocalDataStatus`，失败返回结构化 `CommandError`。
- 已新增前端 `shared/commands` command client/error helper 和 `features/project/project-commands.ts` wrapper，feature 层通过 wrapper 调用 Rust Core。
- 已保留 Story 1.1 的 Project Home mock shell 行为，未伪造持久化 Project 或提前实现业务 schema。
- 已执行并通过验证：`pnpm format`、`cargo fmt`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`cd src-tauri && cargo test`。
- 已修复 review findings：migration 使用 `BEGIN IMMEDIATE` 事务包裹单次 migration 与版本记录，失败回滚新增测试覆盖；`ensure_migration_table` 改为只创建版本表；React 启动时调用 `initializeLocalData` 并展示初始化失败状态；Tauri setup 不再提前解析数据目录；前端 command error guard 校验错误码与 `details[].@type`。
- Review fixes 后已再次执行并通过验证：`pnpm format`、`cargo fmt`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`cd src-tauri && cargo test`。

### Change Log

- 2026-06-04: 实现本地 SQLite 初始化、migration runner、Tauri command 边界、结构化错误模型和前端 command wrapper。
- 2026-06-04: 修复 code review findings，补强 migration 原子性、启动初始化路径和前端错误守卫。

### File List

- `_bmad-output/implementation-artifacts/1-2-establish-local-data-storage-and-core-command-boundary.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `src-tauri/Cargo.lock`
- `src-tauri/Cargo.toml`
- `src-tauri/migrations/0001_core.sql`
- `src-tauri/src/app_state.rs`
- `src-tauri/src/commands/core_commands.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/core/local_data_service.rs`
- `src-tauri/src/core/mod.rs`
- `src-tauri/src/db/connection.rs`
- `src-tauri/src/db/migrations.rs`
- `src-tauri/src/db/mod.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/types/errors.rs`
- `src-tauri/src/types/local_data.rs`
- `src-tauri/src/types/mod.rs`
- `src-tauri/tests/local_data.rs`
- `src/app/app.css`
- `src/app/app.test.tsx`
- `src/app/app.tsx`
- `src/features/project/project-commands.ts`
- `src/shared/commands/command-client.test.ts`
- `src/shared/commands/command-client.ts`
- `src/shared/commands/command-error.ts`
