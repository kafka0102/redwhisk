---
baseline_commit: aba494e
---

# Story 1.3: 创建 Git Project

Status: done

<!-- 说明：可在 dev-story 前运行 validate-create-story 做质量检查。 -->

## Story

作为本地开发者,
我希望从 Project Home 的 `+` card 选择一个本地 Git Repository 创建 Project,
以便 RedWhisk 能以该仓库作为 Issue 和 Agent 工作流边界.

## Acceptance Criteria

1. 给定用户停留在 Project Home，当用户点击 `+` card 并选择一个本地 Git Repository 时，则 Rust Core 校验该目录是 Git Repository，并且如 schema 尚未存在则通过 migration 创建 `projects` 表，保存 `project_id`、`name`、`repo_path`、`created_at`、`last_opened_at`。
2. 给定用户选择非 Git 目录，当 Rust Core 校验失败时，则系统拒绝创建 Project，并且 UI 显示明确错误，且不写入有效 Project 记录。
3. 给定 Project 创建成功，当 command 返回成功时，则应用进入该 Project 的 Issues Activity，并且 Activity Bar 中 `Issues` 处于选中状态。

## Tasks / Subtasks

- [x] 增量创建 Project 持久化 schema (AC: 1)
  - [x] 新增 `src-tauri/migrations/0002_projects.sql`，创建 `projects` 表；字段至少包含 `id`、`name`、`repo_path`、`created_at`、`last_opened_at`，表名和列名使用 `snake_case`。
  - [x] 为 `repo_path` 增加唯一约束或唯一索引，避免同一仓库路径重复创建多个 Project。
  - [x] 更新 `src-tauri/src/db/migrations.rs` 的静态 migration 列表，确保 `0001_core` 后执行 `0002_projects`，且继续保持事务、幂等和失败回滚行为。
- [x] 建立 Project 数据模型和 repository/service 边界 (AC: 1, 2)
  - [x] 新增 `src-tauri/src/types/project.rs`，定义跨边界 DTO：`CreateProjectInput`、`ProjectSummary`，JSON 字段输出使用 `camelCase`；前端使用的 Project 字段应映射到现有 `ProjectSummary` 视图模型。
  - [x] 新增 `src-tauri/src/db/project_repository.rs`，只负责 `projects` 表读写，不包含 Git 校验或 UI 规则。
  - [x] 新增 `src-tauri/src/core/project_service.rs`，负责创建 Project 的业务流程：规范化输入路径、校验 Git Repository、派生 Project name、写入 Project、返回 DTO。
  - [x] 新增 `src-tauri/src/git/repository.rs` 和 `src-tauri/src/git/mod.rs`，只负责 Git repo 检测；优先用文件系统检查目录内存在 `.git` 目录或 `.git` 文件，不从 React 直接执行 Git/shell。
  - [x] 为非 Git 目录、路径不存在/不可访问、空路径等情况返回统一 `CommandError`，错误码使用 `SCREAMING_SNAKE_CASE`，例如 `PROJECT_REPO_NOT_GIT_REPOSITORY`。
- [x] 暴露 `create_project` Tauri command 和前端 wrapper (AC: 1, 2, 3)
  - [x] 新增或扩展 `src-tauri/src/commands/project_commands.rs`，只做 Tauri 参数适配、调用 `ProjectService`、映射 `CommandError`。
  - [x] 在 `src-tauri/src/lib.rs` 注册 `create_project`，并在 `AppState` 中管理 Project service 或其依赖；不要让 command adapter 直接操作 SQLite。
  - [x] 更新 `src/features/project/project-commands.ts`，新增 `createProject(input)` wrapper，通过 `invokeCommand` 调用 Rust Core。
  - [x] 前端不得直接访问 SQLite、shell、Git 或文件系统；目录选择可以使用 Tauri dialog plugin，但 Git 校验必须由 `create_project` 完成。
- [x] 将 Project Home 的 `+` card 接入创建流程 (AC: 1, 2, 3)
  - [x] 更新 `src/features/project/create-project-card.tsx`，支持点击触发创建 Project 流程，并保持可键盘聚焦。
  - [x] 更新 `src/features/project/project-card-grid.tsx` 和 `src/features/project/project-home.tsx`，把 `onCreateProject` 从 `App` 传入 `CreateProjectCard`。
  - [x] 更新 `src/app/app.tsx`，实现最小创建流程：点击 `+` card -> 打开目录选择 -> 调用 `createProject` -> 成功后进入该 Project 的 workbench；失败后在 Project Home 显示明确错误并保持未选择 Project。
  - [x] 更新现有 `ProjectSummary` view model，兼容 Rust DTO 的 `id`、`name`、`repoPath`、`lastOpenedAt`；UI 显示路径继续使用现有 Project card 样式。
  - [x] 创建成功后显式把 `selectedProject` 设为返回的 Project，并让 `AppShell` 仍以 `Issues` 为默认选中入口。
- [x] 保留现有壳行为并控制范围 (AC: 1, 2, 3)
  - [x] 保留 Story 1.1/1.2 已有 Project Home 首屏、未选择 Project 前不显示 Activity Bar、点击 Project 后默认 Issues 的行为。
  - [x] 不提前实现 Story 1.4 的完整最近 Project 持久化列表、路径异常 card 恢复和 `last_opened_at` 重新打开更新；本 story 只需创建成功后进入新 Project。
  - [x] 不新增 Issue、Agent Profile、Session、Settings、Git history、完整 Diff、Worktree 或云同步能力。
- [x] 测试与验证 (AC: 1, 2, 3)
  - [x] 添加 Rust 测试覆盖：`0002_projects` migration 创建字段和唯一约束；Git repo 目录创建 Project 成功；非 Git 目录失败且未插入 `projects`；重复 repo path 不产生第二条有效记录。
  - [x] 添加或更新 Vitest 测试覆盖：`Create Project` card 可点击；目录选择返回路径后调用 `createProject`；成功后进入 Issues Activity；失败时 Project Home 显示错误且 Activity Bar 不出现。
  - [x] 若新增 Tauri dialog plugin，mock `@tauri-apps/plugin-dialog`，并更新 capability 权限测试或配置检查。
  - [x] 运行 `pnpm format`。
  - [x] 运行 `cargo fmt`。
  - [x] 运行 `pnpm lint`。
  - [x] 运行 `pnpm typecheck`。
  - [x] 运行 `pnpm test`。
  - [x] 运行 `pnpm build`。
  - [x] 运行 `cd src-tauri && cargo test`。

### Review Findings

- [x] [Review][Patch] `repo_path` 未规范化，同一仓库可用路径变体绕过唯一约束 [src-tauri/src/core/project_service.rs:87]
- [x] [Review][Patch] duplicate create 存在 check-then-insert 竞争，唯一约束冲突会变成保存失败 [src-tauri/src/core/project_service.rs:37]
- [x] [Review][Patch] dialog 打开阶段未进入 busy 状态且 `open()` reject 未捕获 [src/app/app.tsx:63]
- [x] [Review][Patch] dialog capability 使用 `dialog:default`，权限超过当前目录选择需求 [src-tauri/capabilities/default.json:6]
- [x] [Review][Patch] 不存在、不可访问或非目录路径被统一误报为非 Git Repository [src-tauri/src/git/repository.rs:6]
- [x] [Review][Patch] Project id 依赖系统时间，极端快速创建不同 repo 时可能主键冲突 [src-tauri/src/core/project_service.rs:99]

## Dev Notes

### 范围边界

- 本 story 只交付 FR1：从 Project Home 的 `+` card 选择目录、Rust Core 校验 Git Repository、写入 `projects` 表、成功后进入 Issues Activity、失败时展示明确错误。
- Story 1.4 才负责应用重启后的 Project 列表恢复、按 `last_opened_at` 排序、路径缺失 card 状态和点击已有 Project 时更新 `last_opened_at`。本 story 不要提前实现完整恢复列表。
- 不要把现有 mock Project cards 伪装成已持久化数据。可以继续保留 mock card 作为 Story 1.1/1.2 壳体验，但真实创建成功返回的 Project 必须来自 Rust Core。
- 不引入 HTTP REST/GraphQL、Redux、Turbo、大型管理后台组件库、前端 SQL plugin、通用 shell plugin、GitHub/GitLab、云同步或 Worktree 自动化。

### 架构约束

- SQLite 只能由 Rust Core 的 repository/service 层读写；React 不直接访问数据库。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Architecture]
- Project 校验属于 Rust Core 职责；React 不能直接调用 shell、Git 或文件系统来判断目录是否为 Git Repository。[Source: `_bmad-output/planning-artifacts/architecture.md` §Authentication & Security; §Validation Patterns]
- Tauri command 使用 `snake_case`，本 story command 为 `create_project`；前端 wrapper 使用 `camelCase`，例如 `createProject`。[Source: `_bmad-output/planning-artifacts/architecture.md` §API / Command Naming Conventions]
- `commands/*_commands.rs` 只做边界适配；`core/*_service.rs` 执行业务动作；`db/*_repository.rs` 只做持久化；`git/*` 只负责 Git 检测，不执行自动提交策略。[Source: `_bmad-output/planning-artifacts/architecture.md` §Service Boundaries]
- 所有 command 失败统一返回 `code`、`message`、可选 `details`；错误码使用 `SCREAMING_SNAKE_CASE`，`details` 存在时每项必须包含 `@type`。[Source: `_bmad-output/planning-artifacts/architecture.md` §API & Communication Patterns; `docs/standards/shared/api-conventions.md` §3.2]
- SQLite 表名使用 `snake_case` 复数名词，timestamp 列以 `_at` 结尾并保存 ISO 8601 UTC 字符串。[Source: `_bmad-output/planning-artifacts/architecture.md` §Naming Patterns]

### 当前代码状态与修改指引

- `src/app/app.tsx` 目前在启动时调用 `initializeLocalData()`，并用 `MOCK_PROJECTS` 渲染 Project Home；修改时必须保留初始化失败 status、未选择 Project 前不显示 Activity Bar、点击 Project 后默认 Issues。
- `src/features/project/create-project-card.tsx` 目前只是静态按钮，需要增加点击入口；不要在该组件里塞 Rust 调用细节，优先由 `App` 或 feature 容器协调。
- `src/features/project/project-card-grid.tsx` 和 `project-home.tsx` 当前只接收 `projects` / `onProjectOpen`；本 story 需要新增 `onCreateProject` 传递。
- `src/features/project/project-commands.ts` 已有 `initializeLocalData()` wrapper；在同文件新增 `createProject()`，继续通过 `invokeCommand`，不要散落调用 `invoke`。
- `src/shared/commands/command-error.ts` 已有结构化错误守卫；新增错误码不需要改前端 guard，除非新增错误 detail shape 需要测试。
- `src-tauri/src/lib.rs` 当前只注册 `initialize_local_data`；新增 command 后必须注册到 `generate_handler!`。
- `src-tauri/src/app_state.rs` 当前只管理 `LocalDataService`。可以按最小方案增加 Project service 所需状态；避免为未来 story 提前创建 settings/issues/agents 状态。
- `src-tauri/src/db/migrations.rs` 已有 `BEGIN IMMEDIATE` 事务、失败回滚和 `schema_migrations` 记录；新增 migration 必须沿用这个 runner，不要重写 migration 基础设施。
- `src-tauri/migrations/0001_core.sql` 只创建 `schema_migrations`；`projects` 必须放到 `0002_projects.sql`，符合 readiness report 对实体创建时机的要求。[Source: `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` §Database / Entity Creation Timing]

### 推荐文件结构

预计新增或更新：

```text
src/
  app/
    app.test.tsx
    app.tsx
  features/
    project/
      create-project-card.tsx
      project-card-grid.tsx
      project-commands.ts
      project-home.tsx
src-tauri/
  capabilities/
    default.json
  migrations/
    0002_projects.sql
  src/
    app_state.rs
    commands/
      mod.rs
      project_commands.rs
    core/
      mod.rs
      project_service.rs
    db/
      migrations.rs
      mod.rs
      project_repository.rs
    git/
      mod.rs
      repository.rs
    lib.rs
    types/
      errors.rs
      mod.rs
      project.rs
  tests/
    local_data.rs
    project.rs
```

- 如实现时能用更小的测试文件组织完成覆盖，可以不强制新建所有测试文件；但 service/repository/Git 校验和前端创建流程必须被测试覆盖。
- 文件和目录使用现有约定：前端文件 `kebab-case`，Rust module/file `snake_case`。[Source: `_bmad-output/planning-artifacts/architecture.md` §Naming Patterns; `docs/standards/shared/coding-style.md` §命名规范]

### 数据与行为细节

- Project `id` 必须由 Rust Core 生成并作为字符串返回。可使用简洁稳定方案，例如基于当前时间/随机数/UUID；若新增 `uuid` 依赖，要说明必要性并只用于当前 story。
- Project `name` 默认从 `repo_path` 的最后一级目录名派生；路径最后一级不可用时返回校验错误，不要让前端猜测。
- `created_at` 和 `last_opened_at` 在创建时都设置为当前 UTC ISO 8601 字符串。
- Git repo 检测的最小可验收标准：路径存在且为目录，并且目录内存在 `.git` 目录或 `.git` 文件。`.git` 文件可覆盖 Git worktree/submodule 常见形态；不需要在本 story 实现完整 `git rev-parse` 或 Git 操作状态检测。
- 非 Git 目录失败时不得插入 `projects`。如果校验失败后数据库中出现有效 Project 记录，视为 AC2 失败。
- 重复选择同一路径时不应生成多个有效 Project。可返回已有 Project 或返回明确重复错误；实现前在测试中固定一种行为，保持 UI 结果明确。
- 创建成功后，前端将返回的 Project 设置为当前选中 Project；`AppShell` 自身已有默认 `activeActivity = "issues"`，不要绕过该行为。

### UX 与可访问性要求

- `Create Project` card 必须继续是 Project grid 最后一个 card，按钮可键盘聚焦，hit target 不小于现有 card。
- 创建失败的错误展示在 Project Home，不应隐藏 Project grid，也不应显示 Activity Bar。
- 成功创建后直接进入 Project 工作台；Activity Bar 只包含 `Issues`、`Agents`、`Settings`，`Issues` 选中。
- 本 story 可以继续使用现有英文固定文案；FR26 的完整 zh-CN/en-US 字典由后续 i18n story 完成。新增错误展示必须事实性说明结果，不使用庆祝或拟人语气。

### 最新技术信息

- 当前仓库实际依赖以 `package.json`、`pnpm-lock.yaml`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 为准；不要依赖规划文档中的旧 starter 版本号。
- 若使用 Tauri 目录选择，官方 Tauri v2 dialog plugin 的前端 API 可通过 `open({ directory: true, multiple: false })` 选择目录；对应依赖为 `@tauri-apps/plugin-dialog` 和 `tauri-plugin-dialog`，还需要在 capability 中添加最小 dialog 权限。Rust Core 仍必须负责 Git repo 校验。
- 当前 Rust 依赖已有 `rusqlite = 0.40.0`、`thiserror = 2.0.18`；当前前端依赖已有 `@tauri-apps/api`、React、Vitest、Testing Library 和 `lucide-react`。

### 前置故事信息

- Story 1.1 建立了 Tauri 2 + React + TypeScript + Vite 单应用骨架，未引入 Turbo、Redux、路由框架或大型 UI/admin 组件库。
- Story 1.2 建立了 `LocalDataService`、SQLite 连接、migration runner、`initialize_local_data` command、统一 `CommandError`、前端 `invokeCommand` wrapper，并在 app 启动时调用初始化。
- Story 1.2 review 已修复：migration 单次执行与版本记录位于同一事务；`ensure_migration_table` 只创建版本表；前端 command error guard 校验错误码和 `details[].@type`。
- 若 cargo 测试出现 Rust edition/toolchain 错误，先确认当前 Rust toolchain；Story 1.1 曾因本机 Cargo 1.79 不支持依赖 edition 而需要更新 toolchain。

### 测试要求

- 因本 story 会改动 TypeScript/React 源码，必须运行 `pnpm lint` 与 `pnpm typecheck`。
- 因本 story 会改动运行时行为、分支逻辑、数据流和测试依赖实现，除 lint/typecheck 外必须运行前端测试和 Rust 测试。
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

- 如果新增或改动 Rust workspace 根脚本，也可运行 `cargo fmt` 等价命令，但 Dev Agent Record 只能记录实际执行过的命令。
- 如果任何命令因环境、耗时或外部依赖无法运行，必须记录未运行项、原因和风险。

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 1 / Story 1.3、FR1、NFR1、NFR2、UX-DR5。
- `_bmad-output/planning-artifacts/architecture.md` — Data Architecture、Authentication & Security、API & Communication Patterns、Naming Patterns、Structure Patterns、Service Boundaries、Validation Patterns。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — Command/Event 同步模型、数据表草案、React IA 冻结口径。
- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` — FR1 可测试结果和 entity creation timing。
- `_bmad-output/implementation-artifacts/1-2-establish-local-data-storage-and-core-command-boundary.md` — 前置 story 的实现边界、review fixes、现有文件清单和测试命令。
- `docs/standards/shared/coding-style.md` — 命名、类型和组织方式。
- `docs/standards/shared/api-conventions.md` — 错误响应结构和 `details` 约定。
- Tauri v2 dialog plugin 文档: https://v2.tauri.app/plugin/dialog/

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-04: 进入开发阶段；保留 create-story 写入的 `baseline_commit: aba494e`，按任务顺序先补 Rust/前端红灯测试。
- 2026-06-04: Rust 红灯测试先失败于缺失 `project_service`、`project_repository`、`types::project` 和 `PROJECT_REPO_NOT_GIT_REPOSITORY` 错误码；随后补齐最小实现。
- 2026-06-04: 前端红灯测试先失败于缺失 `@tauri-apps/plugin-dialog` 和 `createProject` wrapper；随后接入 dialog plugin、Project Home 创建流程和 command wrapper。
- 2026-06-04: 首次全量 `cd src-tauri && cargo test` 失败于旧 `local_data` 测试仍预期仅 `0001_core`；已更新为 `0001_core` + `0002_projects` 后通过。
- 2026-06-05: 修复 review follow-up 时，`cargo test --manifest-path src-tauri/Cargo.toml --test project` 先失败于旧测试仍期望非 canonical `repo_path`；已更新测试契约为保存 canonical path 后通过。

### Completion Notes List

- create-story 上下文分析已完成，已生成 Story 1.3 的开发实现指南。
- 已新增 `projects` migration，创建 `projects` 表并以 `uidx_projects_repo_path` 保证同一路径不重复持久化。
- 已新增 Rust Project DTO、repository、service、Git repo 最小检测模块和 `create_project` Tauri command；非 Git 目录返回结构化错误且不会写入有效 Project。
- 已接入 Tauri dialog plugin 目录选择；Project Home 的 `Create Project` card 成功后进入 Issues Activity，失败后留在 Project Home 并展示明确错误。
- 已保持 Story 1.4 范围外能力不实现：未做应用重启后的持久化列表恢复、路径异常 card 恢复或点击已有 Project 的 `last_opened_at` 更新。
- 已修复 6 项 code review findings：`repo_path` canonical 化、Project insert 幂等化、dialog pending/reject 状态处理、dialog 权限收窄、路径无效与非 Git 目录错误区分、Project id 改为 SQLite 随机生成。
- Review follow-up 定向验证已通过：`cargo test --manifest-path src-tauri/Cargo.toml --test project`、`pnpm test -- src/app/app.test.tsx`。
- 已执行并通过验证：`pnpm format`、`cargo fmt --manifest-path src-tauri/Cargo.toml`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`cd src-tauri && cargo test`。

### File List

- `_bmad-output/implementation-artifacts/1-3-create-git-project.md`
- `_bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `package.json`
- `pnpm-lock.yaml`
- `src-tauri/Cargo.lock`
- `src-tauri/Cargo.toml`
- `src-tauri/capabilities/default.json`
- `src-tauri/migrations/0002_projects.sql`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/commands/project_commands.rs`
- `src-tauri/src/core/mod.rs`
- `src-tauri/src/core/project_service.rs`
- `src-tauri/src/db/migrations.rs`
- `src-tauri/src/db/mod.rs`
- `src-tauri/src/db/project_repository.rs`
- `src-tauri/src/git/mod.rs`
- `src-tauri/src/git/repository.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/types/errors.rs`
- `src-tauri/src/types/mod.rs`
- `src-tauri/src/types/project.rs`
- `src-tauri/tests/local_data.rs`
- `src-tauri/tests/project.rs`
- `src/app/app.test.tsx`
- `src/app/app.tsx`
- `src/features/project/create-project-card.tsx`
- `src/features/project/project-card-grid.tsx`
- `src/features/project/project-commands.ts`
- `src/features/project/project-home.tsx`
- `src/shared/commands/command-client.test.ts`

### Change Log

- 2026-06-04: 实现创建 Git Project 的数据库 schema、Rust Core command/service/repository、Git repo 校验、Tauri dialog 目录选择和 Project Home 创建流程；新增 Rust/Vitest 覆盖并通过完整验证。
- 2026-06-05: 修复 6 项 code review findings，补充 canonical path、幂等插入、随机 id、dialog pending/reject 和权限收窄覆盖；story 标记为 done。
