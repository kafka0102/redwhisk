---
baseline_commit: 5cdfe9b
---

# Story 1.4: 展示 Project Home 并处理路径异常

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为本地开发者,
我希望打开 RedWhisk 时能从 Project Home 或工作台顶部 Project Switcher 选择 Project,
以便我可以明确进入当前项目，并在需要切换项目时打开另一个项目窗口.

## Acceptance Criteria

1. 给定用户曾成功创建多个 Project，当应用重启时，则系统展示 Project Home，按 `last_opened_at` 优先排序展示所有 Project card，最后一个 card 固定为 `+` 创建 Project，并且未点击 Project card 前不显示 Activity Bar。
2. 给定用户已经进入某个 Project 工作台，当工作台窗口渲染时，则窗口顶部与关闭/最小化/缩放控件同一行显示 Project Switcher；折叠态显示当前 Project 名称，不显示静态 `RedWhisk` 标题；工作台内容顶部不再重复展示 `PROJECT` 标识、Project 名称或 repo path。
3. 给定最近 Project 的 `repo_path` 不存在或不可访问，当 Project Home 或 Project Switcher 渲染该 Project 时，则 UI 在对应 Project card 或 switcher item 上展示路径异常状态；用户点击后显示明确错误；系统不删除 Project 记录。
4. 给定用户重新打开某个 Project，当用户点击 Project card 且路径可访问时，则系统更新并持久化 `last_opened_at`，并进入该 Project 的 Issues Activity。
5. 给定用户在 Project 工作台中打开 Project Switcher，当下拉列表展开时，则列表按 `last_opened_at` 优先排序展示本机所有 Project；每项左侧显示稳定色块 icon，icon 文案默认取 Project 名称首字符，背景色从固定色板按 `project_id` 或名称稳定派生；每项中间上下两行显示 Project 名称和 repo path；当前 Project 项最右侧显示对钩。
6. 给定用户在 Project Switcher 中选择另一个路径可访问的 Project，当用户点击该 Project item 时，则系统更新并持久化目标 Project 的 `last_opened_at`，打开一个新的 RedWhisk 窗口显示目标 Project 的 Issues Activity，并且当前窗口保持在原 Project，不原地切换 Project。

## Tasks / Subtasks

- [x] 建立最近 Project 查询与打开 Project 的 Rust Core 边界 (AC: 1, 3, 4, 5, 6)
  - [x] 在 `src-tauri/src/types/project.rs` 新增跨边界 DTO：`ProjectListResponse`、可复用的 Project 列表项 DTO、`OpenProjectInput`、`OpenProjectWindowInput`；JSON 字段使用 `camelCase`。
  - [x] Project 列表项至少包含 `id`、`name`、`repoPath`、`createdAt`、`lastOpenedAt`、`pathStatus`；`pathStatus` 使用稳定字面量，例如 `"available"` / `"missing"`。
  - [x] 在 `src-tauri/src/db/project_repository.rs` 新增按 `last_opened_at DESC` 查询 Project 列表、按 id 查询 Project、更新 `last_opened_at` 的方法；repository 不做路径校验或窗口创建。
  - [x] 在 `src-tauri/src/core/project_service.rs` 新增 `list_projects()`、`open_project()`、`open_project_for_window()` 或等价方法；service 负责路径存在性/可访问性校验和 `last_opened_at` 更新。
  - [x] 路径不存在、不可访问或非目录时返回结构化错误，不删除 `projects` 记录；错误码可复用 `PROJECT_REPO_PATH_INVALID`，如需更明确可新增 `PROJECT_REPO_PATH_UNAVAILABLE`。
- [x] 暴露 Tauri command 与前端 command wrapper (AC: 1, 3, 4, 6)
  - [x] 在 `src-tauri/src/commands/project_commands.rs` 新增 `list_projects` command，返回显式对象 `{ projects: [...] }`，不要返回裸数组。
  - [x] 新增 `open_project` command：用于 Project Home 点击已有 Project，校验路径可访问，更新该 Project 的 `last_opened_at`，返回 Project DTO 给当前窗口。
  - [x] 新增 `open_project_window` command：用于 Project Switcher 选择其它 Project，校验目标路径可访问，更新目标 Project 的 `last_opened_at`，创建新 Tauri window，并返回足够的成功 DTO；当前 React 窗口不得把 `selectedProject` 改成目标 Project。
  - [x] 在 `src-tauri/src/lib.rs` 注册新增 command；如果 `open_project_window` 创建窗口，command 使用 `async fn`，避免 Tauri/WebView2 在同步 command 中创建窗口的跨平台风险。
  - [x] 更新 `src/features/project/project-commands.ts`，新增 `listProjects()`、`openProject()`、`openProjectWindow()` wrapper，继续通过 `invokeCommand`。
- [x] 将 Project Home 从 mock 数据切换为持久化列表 (AC: 1, 3, 4)
  - [x] 更新 `src/app/app.tsx` 启动流程：初始化本地数据后通过 `listProjects()` 加载 Project Home 列表；不得继续用 `MOCK_PROJECTS` 作为权威最近 Project 列表。
  - [x] Project Home 无 Project 记录时只显示 `Create Project` card；有记录时按 Rust Core 返回顺序展示，最后一项仍固定为 `Create Project` card。
  - [x] 点击可访问 Project card 时调用 `openProject({ projectId })`，成功后进入 Issues Activity；失败时留在 Project Home、显示明确错误、不显示 Activity Bar。
  - [x] 创建 Project 成功后继续进入该 Project 的 Issues Activity，并刷新或合并本地列表缓存，避免返回 Project Home 后列表缺失刚创建的 Project。
  - [x] Project card 展示路径异常状态；不能只靠颜色表达，文本或可访问 label 必须明确说明路径不可访问。
- [x] 实现工作台顶部 Project Switcher (AC: 2, 5, 6)
  - [x] 新增 `src/features/project/project-switcher.tsx` 或同等组件，放在 `features/project`，由 `AppShell` 渲染在窗口顶部 chrome 区域。
  - [x] `AppShell` 不再在内容 header 中展示 `PROJECT` eyebrow、Project 名称和 repo path；工作台内容顶部只保留 Activity 对应内容。
  - [x] Project Switcher 折叠态显示当前 Project 名称和下拉 affordance；不显示静态 `RedWhisk` 标题。
  - [x] 展开态列表复用 `listProjects()` 返回的项目数据，按 `last_opened_at` 优先排序；当前 Project 右侧显示 `Check` icon。
  - [x] 每个 item 左侧显示稳定色块 icon：默认取 Project 名称首字符，背景色从固定色板按 `project.id` 或 `project.name` 稳定派生；不得使用随机色。
  - [x] 选择当前 Project 只关闭浮层；选择其它路径可访问 Project 调用 `openProjectWindow({ projectId })`，成功后当前窗口保持原 Project。
  - [x] 选择路径不可访问 Project 时显示明确错误，不打开新窗口，不删除 Project 记录。
- [x] 保留既有壳行为并控制范围 (AC: 1, 2, 4, 6)
  - [x] 保留 Story 1.1/1.2/1.3 的启动初始化、本地数据错误提示、Project 未选择前不显示 Activity Bar、进入工作台默认 Issues Activity、Create Project dialog 流程。
  - [x] 不引入 Redux、路由框架、HTTP API、前端 SQL plugin、shell plugin、Git history、Issue/Agent/Settings 业务能力或 Cloud sync。
  - [x] 不实现“重新选择目录”和“从最近列表移除”入口；UX 文档提到这些是路径异常状态下的后续入口，本 story AC 只要求显示异常、点击报错并保留记录。
  - [x] 不在当前窗口原地切换到另一个 Project；这是 Story 1.4 明确禁止的退化实现。
- [x] 测试与验证 (AC: 1-6)
  - [x] 添加 Rust 测试覆盖：`list_projects` 按 `last_opened_at` 降序返回；路径存在与缺失分别返回正确 `pathStatus`；`open_project` 对可访问路径更新 `last_opened_at`；缺失路径返回错误且记录仍保留。
  - [x] 添加 Rust command/service 测试或可测试 seam，覆盖 `open_project_window` 在校验失败时不更新目标 Project、不创建窗口；窗口创建成功路径至少验证会先更新目标 Project 并返回成功结果。若实际窗口创建无法在集成测试中稳定运行，抽出最小 window opener trait/seam 测试 service 分支。
  - [x] 添加或更新 Vitest 测试覆盖：启动后 Project Home 从 `listProjects` 渲染持久化列表；无 Project 时只显示 create card；点击已有 Project 成功进入 Issues；点击缺失路径 Project 显示错误且 Activity Bar 不出现。
  - [x] 添加或更新 Vitest 测试覆盖：工作台顶部显示 Project Switcher，内容 header 不重复显示 Project 名称/path；展开后显示列表、稳定首字母 icon、当前对钩；选择当前项目只关闭；选择其它项目调用 `openProjectWindow` 且不改变当前窗口的 project。
  - [x] 运行 `pnpm format`。
  - [x] 运行 `cargo fmt --manifest-path src-tauri/Cargo.toml`。
  - [x] 运行 `pnpm lint`。
  - [x] 运行 `pnpm typecheck`。
  - [x] 运行 `pnpm test`。
  - [x] 运行 `pnpm build`。
  - [x] 运行 `cd src-tauri && cargo test`。

### Review Findings

- [x] [Review][Patch] `open_project_window` 重复打开同一目标 Project 时会因固定 Tauri window label 失败，并且失败前已刷新 `last_opened_at` [src-tauri/src/commands/project_commands.rs:47] — 已修复：重复打开时聚焦既有窗口，窗口创建/聚焦成功后才更新 `last_opened_at`。
- [x] [Review][Patch] URL `projectId` 入口打开失败会被归入 `localDataError`，错误来源与 UI 状态不匹配 [src/app/app.tsx:40] — 已修复：初始化/列表错误与 URL Project 打开错误分开处理。
- [x] [Review][Patch] Activity 内容顶部仍重复展示 Project 名称，违反工作台 header 去重要求 [src/features/issues/issues-activity.tsx:11] — 已修复：Issues、Agents、Settings 内容顶部不再展示 Project 名称。
- [x] [Review][Patch] Project Switcher 展开后缺少 `Esc` 关闭键盘支持 [src/features/project/project-switcher.tsx:31] — 已修复：展开期间监听 `Escape` 并关闭浮层，已补 Vitest 覆盖。

## Dev Notes

### 范围边界

- 本 story 交付 FR2：应用重启后的 Project Home 最近 Project 列表恢复、路径异常展示、点击已有 Project 打开并更新 `last_opened_at`、工作台顶部 Project Switcher、从 Switcher 选择其它 Project 打开新窗口。
- Story 1.3 已交付从 `+` card 创建 Git Project；本 story 只复用和扩展其 Project repository/service/command 边界，不重写创建流程。
- Story 1.5 以后才进入 Issue 管理；不要在本 story 新增 Issue 表、Issue UI、Agent Profile、Session、Git status、日志或 Settings 能力。
- “打开新窗口”是 Switcher 选择其它 Project 的验收标准；Project Home 点击 Project 仍在当前窗口进入该 Project 工作台。

### 架构约束

- SQLite 只能由 Rust repository/service 层读写；React 不直接访问数据库，也不能用本地存储伪造最近 Project 列表。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Architecture; §Data Boundaries]
- 前后端通信只使用 Tauri command/event，不引入 HTTP REST/GraphQL；command 用 `snake_case`，前端 wrapper 用 `camelCase`。[Source: `_bmad-output/planning-artifacts/architecture.md` §API & Communication Patterns; §Naming Patterns]
- Project 列表查询返回显式 DTO，必须支持 Project Home 和 Project Switcher 复用；至少包含 Project 标识、名称、路径、最近打开时间和路径可访问性状态。[Source: `_bmad-output/planning-artifacts/architecture.md` §API / Command Response Formats]
- 打开其它 Project 必须通过 Rust/Tauri command，例如 `open_project_window`；command 负责校验目标 `repo_path`、更新目标 `last_opened_at` 并创建新 Tauri window；当前窗口不在 React store 中原地替换 Project context。[Source: `_bmad-output/planning-artifacts/architecture.md` §API / Command Response Formats; §State Management Patterns]
- `commands/*_commands.rs` 只做边界适配；`core/*_service.rs` 执行业务动作；`db/*_repository.rs` 只做持久化；窗口创建可通过 service seam 或 command adapter 封装，但不要把数据库更新逻辑塞进 React。[Source: `_bmad-output/planning-artifacts/architecture.md` §Service Boundaries]
- 所有 command 失败统一返回 `code`、`message`、可选 `details`；错误码使用 `SCREAMING_SNAKE_CASE`，`details` 存在时每项必须包含 `@type`。[Source: `_bmad-output/planning-artifacts/architecture.md` §Error Handling Patterns; `docs/standards/shared/api-conventions.md` §3.2]

### 当前代码状态与修改指引

- `src/app/app.tsx` 当前仍定义并渲染 `MOCK_PROJECTS`；本 story 必须移除其作为权威数据源的角色，改为 `initializeLocalData()` 后调用 `listProjects()`。如测试需要 fixture，应放在测试 mock 中，不留生产 mock 列表。
- `src/app/app.tsx` 已有 `handleCreateProject()`：点击 `Create Project` -> Tauri dialog `open({ directory: true, multiple: false })` -> `createProject()` -> `setSelectedProject()`。修改时保留 dialog pending、防重复点击和失败错误展示。
- `src/app/app-shell.tsx` 当前在 `.workbench__header` 内重复展示 `PROJECT`、Project 名称和 path；本 story 要删除该重复内容，将 Project Switcher 放到工作台顶部 chrome，Activity Bar 仍固定左侧。
- `src/features/project/project-card.tsx` 当前用 `status: "available" | "missing"` 展示 `path unavailable`；可复用这一路径异常视觉，但状态必须来自 Rust Core 查询结果，不再来自 mock fixture。
- `src/features/project/project-card-grid.tsx` 已保证 create card 最后一项；切换到持久化列表时保持这个结构。
- `src/features/project/project-commands.ts` 当前只有 `initializeLocalData()` 和 `createProject()`；新增 wrapper 必须继续通过 `invokeCommand()`，不要直接散落 `invoke()`。
- `src-tauri/src/core/project_service.rs` 当前负责 create project：canonicalize repo path、检测 `.git`、派生 name、insert-or-get-existing；可以在同 service 中新增 list/open 方法，复用路径校验 helper，但不要把“列出 Project”误要求必须是 Git repo，只需标记路径可访问性。
- `src-tauri/src/db/project_repository.rs` 当前已有 `find_by_repo_path()` 和 insert 方法；新增按 id 查询、列表查询和更新时间方法时保持 SQL 简单可测。
- `src-tauri/tests/project.rs` 已覆盖 Story 1.3 的 migration/create/duplicate/invalid path 行为；本 story 应在同文件或新的 `project_lifecycle.rs` 中追加最近列表和打开 Project 测试。

### 数据与行为细节

- `projects` 表当前字段为 `id`、`name`、`repo_path`、`created_at`、`last_opened_at`；本 story 不需要新增 migration，除非实现中发现必须新增列。路径可访问性可以实时派生，不应持久化为权威状态。
- `list_projects` 应返回所有 Project 记录，包括路径缺失记录；缺失记录必须保留，不能被过滤掉。
- `last_opened_at` 更新由 Rust Core 完成，建议使用 SQLite `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` 保持 Story 1.3 的 timestamp 形式。
- `open_project({ projectId })` 成功返回更新后的 Project DTO；前端将其设置为当前 `selectedProject`，让 `AppShell` 默认 Issues Activity。
- `open_project_window({ projectId })` 成功后当前窗口只关闭 switcher 或保持原状态，不调用 `setSelectedProject(target)`。
- 路径异常错误文案必须事实性说明结果，例如“Project 路径不存在或不可访问。”，并在 `details` 中包含 Project id 或 repo path，便于 Diagnostics 后续扩展。
- Project Switcher item 的路径长文本用 mono 字体、截断和 `title`/tooltip 处理；不要让长 path 撑开布局。

### UX 与可访问性要求

- Project Home 是应用冷启动首屏；未选择 Project 前不显示 Activity Bar。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Information Architecture]
- Project Switcher 属于窗口顶部 chrome，不属于 Activity Bar 或内容 Header；折叠态只显示当前 Project 名称和下拉 affordance，不显示静态 `RedWhisk` 标题。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Component Patterns]
- 展开态为 light surface 浮层，宽度约 520-620px，item 高度约 72px；每项左侧 40px 方形 icon，半径约 7px，右侧当前对钩。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md` §Components]
- Activity Bar 仍只包含 `Issues`、`Agents`、`Settings`，不要新增 `Code`、`Diff`、`Git History`、`Terminal` 等入口。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Information Architecture]
- 键盘支持至少覆盖：Project Switcher 按钮可聚焦；展开后 `Esc` 关闭；点击或键盘选择当前 Project 只关闭浮层；路径异常不能只靠颜色表达。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Interaction Primitives; §Accessibility Floor]
- 桌面工具视觉保持克制：正文 13px、标签 12px、元信息 11px，`letterSpacing` 保持 0；不要使用营销 hero、大圆角卡片墙、渐变装饰或彩色状态柱。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md` §Typography; §Layout & Spacing]

### 前置故事信息

- Story 1.1 建立了 Tauri 2 + React + TypeScript + Vite 单应用骨架、Project Home 首屏、未选择 Project 前不显示 Activity Bar、进入工作台默认 Issues。
- Story 1.2 建立了 `LocalDataService`、SQLite 连接、migration runner、`initialize_local_data` command、统一 `CommandError` 和前端 `invokeCommand` wrapper。
- Story 1.3 建立了 `projects` migration、Project DTO/repository/service、Git repo 最小检测、`create_project` command、Tauri dialog 创建流程；review 已修复 canonical path、duplicate insert、dialog pending/reject、最小 dialog 权限、路径错误区分、SQLite 随机 Project id。
- 最近提交 `5cdfe9b docs: update story 1.4 project switcher scope` 已把 Story 1.4 的 Project Switcher 范围同步到 PRD、Epics、UX 和 Architecture。

### Git Intelligence

- `34204de Implement git project creation` 是 Story 1.3 的实现提交，主要触及 `src/app/app.tsx`、`src/features/project/*`、`src-tauri/src/core/project_service.rs`、`src-tauri/src/db/project_repository.rs`、`src-tauri/src/commands/project_commands.rs` 和 `src-tauri/tests/project.rs`；本 story 应沿用这些文件的分层和测试方式。
- `aba494e Implement local data storage boundary` 建立了 command error guard 与 migration runner；新增 command 错误不需要改前端 guard，除非新增 detail shape 违反 `@type` 约定。
- 不要回退或重写 Story 1.3 已完成的 duplicate/canonical path 行为；新增打开 Project 行为应以现有 canonical `repo_path` 为准。

### 最新技术信息

- 当前仓库实际依赖以 `package.json` 和 `src-tauri/Cargo.toml` 为准：`@tauri-apps/api` `^2`、`@tauri-apps/plugin-dialog` `^2.7.1`、`tauri = "2"`、`tauri-plugin-dialog = "2"`、`rusqlite = "0.40.0"`。
- Tauri v2 JavaScript API 提供 `WebviewWindow` 用于前端创建窗口，但本项目架构要求 Project 切换必须通过 Rust/Tauri command，不能让 React 直接决定业务状态或窗口 context。[Source: Tauri v2 `webviewWindow` API, https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow/]
- Tauri `WebviewWindowBuilder::new` 可由 Rust `AppHandle` 创建窗口；docs.rs 对 Tauri 2.11.2 标注：在 Windows 上同步 command/event handler 中创建窗口可能死锁，应使用 async command 或独立线程。[Source: docs.rs `tauri::webview::WebviewWindowBuilder`, https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html]

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

- `_bmad-output/planning-artifacts/epics.md` — Epic 1 / Story 1.4、FR2、NFR1、NFR6。
- `_bmad-output/planning-artifacts/architecture.md` — Data Architecture、API & Communication Patterns、API / Command Response Formats、State Management Patterns、Service Boundaries。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Project Home、Project Switcher、Activity Bar、路径异常、键盘行为。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md` — Project Switcher 视觉规格、桌面工具 typography、layout 与组件规则。
- `_bmad-output/planning-artifacts/sprint-change-proposal-project-switcher-2026-06-05.md` — Story 1.4 Project Switcher 范围变更记录。
- `_bmad-output/implementation-artifacts/1-3-create-git-project.md` — 前置 story 的实现边界、review fixes、现有文件清单和测试命令。
- `docs/standards/shared/api-conventions.md` — 错误响应结构和 `details` 约定。
- Tauri v2 WebviewWindow JavaScript API: https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow/
- Tauri 2.11.2 `WebviewWindowBuilder` Rust API: https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-05: 进入 Story 1.4 开发阶段；保留 create-story 写入的 `baseline_commit: 5cdfe9b`，先按 TDD 写 Rust/前端红灯测试。
- 2026-06-05: Rust 红灯测试先失败于缺失 `OpenProjectInput`、`ProjectPathStatus`、`list_projects`、`open_project`、`open_project_for_window`、`find_by_id` 和 `PROJECT_REPO_PATH_UNAVAILABLE`；随后补齐最小 Project list/open 实现。
- 2026-06-05: 前端红灯测试先失败于缺失 `listProjects` / `openProject` / `openProjectWindow` wrapper、Project Home 仍使用 mock 数据、工作台没有 Project Switcher；随后接入持久化列表和 switcher。
- 2026-06-05: Diff 自检发现 `open_project_window` 新窗口缺少 Project context；已补 `?projectId=...` URL 入口和前端启动时按 URL 打开 Project 的测试与实现。
- 2026-06-05: 首次 `pnpm typecheck` 失败于测试 mock 中隐式 `any`；已改为显式 `ProjectListResponse` mock 状态后通过。
- 2026-06-05: Code review 发现重复窗口 label、窗口失败前更新时间、URL 入口错误归因、Activity 重复 Project 名称和 Switcher `Esc` 缺失；已完成修复并补回测试。

### Completion Notes List

- create-story 上下文分析已完成，已生成 Story 1.4 的开发实现指南。
- 已新增最近 Project 查询、打开已有 Project、打开 Project 新窗口的 Rust Core service/repository/command 边界；列表返回 `pathStatus`，打开路径不可访问 Project 会返回结构化错误且保留记录。
- 已将 Project Home 从生产 mock 列表切换为 `listProjects()` 持久化数据；点击已有 Project 通过 `openProject()` 更新 `last_opened_at` 后进入 Issues Activity，缺失路径留在 Project Home 并显示错误。
- 已新增工作台顶部 Project Switcher；折叠态显示当前 Project 名称，展开态展示项目列表、稳定首字母色块、repo path、路径异常状态和当前对钩。
- 已实现 Project Switcher 选择其它 Project 时调用 `openProjectWindow()`；Rust command 校验目标 Project 后创建新窗口或聚焦既有目标窗口，并在窗口成功可用后更新目标 Project `last_opened_at`；当前窗口不原地切换。
- 已移除工作台内容 header 和各 Activity 内容顶部重复的 `PROJECT` 标识、Project 名称和 repo path，保留 Activity Bar 默认 Issues 行为。
- 已补 Project Switcher 展开后 `Esc` 关闭支持；URL `projectId` 自动打开失败会显示为 Project open error，而不是本地数据初始化错误。
- 已执行并通过验证：`pnpm format`、`cargo fmt --manifest-path src-tauri/Cargo.toml`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`cd src-tauri && cargo test`。

### File List

- `_bmad-output/implementation-artifacts/1-4-show-project-home-and-handle-path-errors.md`
- `_bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `src-tauri/src/commands/project_commands.rs`
- `src-tauri/src/core/project_service.rs`
- `src-tauri/src/db/project_repository.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/types/errors.rs`
- `src-tauri/src/types/project.rs`
- `src-tauri/tests/project.rs`
- `src/app/activity-router.tsx`
- `src/app/app-shell.tsx`
- `src/app/app.css`
- `src/app/app.test.tsx`
- `src/app/app.tsx`
- `src/features/agents/agents-activity.tsx`
- `src/features/issues/issues-activity.tsx`
- `src/features/project/project-commands.ts`
- `src/features/project/project-switcher.tsx`
- `src/features/settings/project-settings-activity.tsx`
- `src/shared/commands/command-client.test.ts`

### Change Log

- 2026-06-05: 实现 Story 1.4 Project Home 持久化恢复、路径异常处理、Project Switcher 和跨窗口 Project 打开行为。
- 2026-06-05: 修复 code review findings：重复 Project 窗口聚焦既有窗口且成功后更新时间、URL Project 打开错误归因、Activity Project 名称去重、Project Switcher `Esc` 关闭。
