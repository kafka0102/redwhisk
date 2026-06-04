# Story 1.1: 初始化 RedWhisk 桌面工作台骨架

Status: ready-for-dev

<!-- 说明：可在 dev-story 前运行 validate-create-story 做质量检查。 -->

## Story

作为本地开发者,
我希望能启动 RedWhisk 桌面应用并看到基础工作台壳,
以便我可以在一个可信的本地桌面入口中继续配置 Project 和 Issue.

## Acceptance Criteria

1. 给定仓库尚未包含应用源码，当开发者按架构要求初始化项目时，则项目使用 `create-tauri-app` 的 `react-ts` 模板，并且根目录包含可运行的 Tauri + React + TypeScript 应用骨架。
2. 给定应用启动成功，当用户打开 RedWhisk 时，则 UI 首屏显示 Project Home，而不是直接显示 Activity Bar。
3. 给定应用启动成功，当 Project Home 渲染时，则页面预留本机 Project card 网格，并且最后一个 card 是 `+` 创建 Project。
4. 给定用户尚未选择 Project，当用户停留在 Project Home 时，则不显示 Activity Bar。
5. 给定用户在 Project Home 选择一个 Project，当 Project 工作台打开时，则 UI 显示桌面工作台壳，包含 Activity Bar 的 `Issues`、`Agents`、`Settings` 入口。
6. 给定 Project 工作台打开，当初始 Activity 渲染时，则 `Issues` 为默认当前入口，并且未实现的业务区域可以显示空态。
7. 给定项目已初始化，当开发者运行质量脚本时，则至少存在并可执行 `format`、`lint`、`typecheck`、`test` 的基础脚本，并且不引入 Turbo 作为初始任务编排工具。

## Tasks / Subtasks

- [ ] 初始化 Tauri + React + TypeScript 骨架 (AC: 1)
  - [ ] 在仓库根目录运行 `pnpm create tauri-app@latest . --template react-ts`.
  - [ ] 保留 Tauri starter 的 `src-tauri/` Rust 桌面壳和 Vite React 前端结构.
  - [ ] 不引入 Turbo, monorepo 拆分或云端框架.
- [ ] 补齐基础工程脚本和配置 (AC: 7)
  - [ ] 在 `package.json` 提供 `format`、`lint`、`typecheck`、`test`、`build`、`tauri`/`dev` 类脚本.
  - [ ] 添加或确认 `eslint.config.js`、`prettier.config.mjs`、`vitest.config.ts`、`tsconfig*.json` 可支撑脚本运行.
  - [ ] 若 starter 默认脚本不足, 只补当前 story 所需最小工具链.
- [ ] 建立 Project Home 首屏 (AC: 2, 3, 4)
  - [ ] 新建 `src/features/project/project-home.tsx`.
  - [ ] 新建 `src/features/project/project-card-grid.tsx`.
  - [ ] 新建 `src/features/project/project-card.tsx`.
  - [ ] 新建 `src/features/project/create-project-card.tsx`.
  - [ ] Project Home 渲染 mock/静态 Project cards 和最后一个 `+` 创建 card.
  - [ ] 未选择 Project 前不得渲染 Activity Bar.
- [ ] 建立 Project 工作台壳 (AC: 5, 6)
  - [ ] 新建或整理 `src/app/app.tsx`、`src/app/app-shell.tsx`、`src/app/activity-router.tsx`、`src/app/app.css`.
  - [ ] 通过本地 React state 模拟选择 Project 后进入工作台.
  - [ ] Activity Bar 只显示 `Issues`、`Agents`、`Settings`.
  - [ ] 默认选中 `Issues`, 业务区域显示克制空态.
- [ ] 建立基础样式和可访问性底线 (AC: 2-6)
  - [ ] 使用自建 CSS/token 层, 不引入大型管理后台组件库.
  - [ ] Project card 和 Activity Bar 控件支持键盘 focus.
  - [ ] Activity Bar 图标 hit target 不小于 40px; 普通控件 hit target 不小于 28px.
  - [ ] 使用克制圆角: 小控件 3px, 按钮和 card 5px, 不做大圆角 pill 文本.
- [ ] 验证 (AC: 1-7)
  - [ ] 运行 `pnpm format`.
  - [ ] 运行 `pnpm lint`.
  - [ ] 运行 `pnpm typecheck`.
  - [ ] 运行 `pnpm test`.
  - [ ] 运行 `pnpm build`.
  - [ ] 若 Rust/Tauri 初始化后提供可用 Rust 检查, 运行 `cd src-tauri && cargo test`.

## Dev Notes

### 范围边界

- 本 story 只做 greenfield 初始化和静态/本地状态的 UI 壳.
- 不实现 SQLite schema、Project 持久化、Git Repository 校验、文件夹选择、真实 `create_project` command、Issue CRUD、Agent Profile、Codex PTY 或 xterm.
- `+` card 可以是不可执行或打开占位提示, 但必须作为 Project Home 最后一个 card 显示. 真实选择目录和 Git 校验属于 Story 1.3.
- 选择 Project 进入工作台可以使用本地 mock state. 不得伪造已经完成持久化能力.
- 未选择 Project 前不要显示 Activity Bar. 这是用户明确修正后的入口规则.

### 架构约束

- Starter: 使用官方 `create-tauri-app` 的 `react-ts` 模板. 架构文档指定命令为 `pnpm create tauri-app@latest . --template react-ts`. [Source: `_bmad-output/planning-artifacts/architecture.md` §Starter Template Evaluation]
- 前端: React + TypeScript; 桌面核心: Rust/Tauri; Vite 负责前端开发服务器和构建. [Source: `_bmad-output/planning-artifacts/architecture.md` §Architectural Decisions Provided by Starter]
- 初始任务编排: 当前 MVP 使用 `pnpm`, 不引入 Turbo. [Source: `_bmad-output/planning-artifacts/epics.md` Story 1.1]
- Project Home 是应用首屏; 点击 Project card 后才进入 Project 工作台并显示 Activity Bar. [Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §4]
- React Workbench MVP surface 包含 Project Home、Project Card Grid、Activity Bar、Issues Activity、Agents Activity、Project Settings 等. [Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` §3]

### 文件结构要求

创建或对齐以下初始结构：

```text
src/
  main.tsx
  app/
    app.tsx
    app-shell.tsx
    activity-router.tsx
    app.css
  features/
    project/
      project-home.tsx
      project-card-grid.tsx
      project-card.tsx
      create-project-card.tsx
    issues/
      issues-activity.tsx
    agents/
      agents-activity.tsx
    settings/
      project-settings-activity.tsx
  shared/
    styles/
```

- Frontend feature organization must follow `features/project`, `features/issues`, `features/agents`, `features/settings`. [Source: `_bmad-output/planning-artifacts/architecture.md` §Project Structure & Boundaries]
- Keep shared code intentional. Do not create a generic `utils` bucket. [Source: `docs/standards/shared/coding-style.md` §组织方式]
- Tauri/Rust files remain under `src-tauri/`. Do not move generated Rust files into frontend folders.

### UX 要求

- Project Home / Project Grid: App cold open surface; shows all local Project cards sorted by recent open in later stories; last card is `+` create Project. For this story, static cards are acceptable. [Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Information Architecture]
- Activity Bar only appears after a Project is open and contains only `Issues`、`Agents`、`Settings`. [Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Information Architecture]
- Project Card Grid cards should show Project name, repo path, recent opened time, and path abnormal state in later stories; this story may use mock content to establish layout. [Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Component Patterns]
- UI must feel like a desktop developer tool, not a marketing page or SaaS dashboard. Avoid hero layouts, large decorative cards, gradients, celebration animation, and management-dashboard component libraries. [Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` §Foundation / §Banned in MVP]
- Activity Bar width target is 48px; default sidebar width for later Project surfaces is 280px. [Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md` §Layout]

### 样式约束

- Use light/dark capable CSS tokens from the start if practical. Light base: `#F7F8FA` and `#FFFFFF`; dark base: `#000000`, `#0B0B0C`, `#141416`. [Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md`]
- Body text 13px, labels 12px, metadata 11px, mono 12px; `letter-spacing: 0`. [Source: `_bmad-output/planning-artifacts/epics.md` UX-DR2]
- Cards/buttons radius should stay near 5px; Dialog/Inspector 7px for later stories. [Source: `_bmad-output/planning-artifacts/epics.md` UX-DR4]
- If adding icons, prefer `lucide-react` as architecture recommends. Keep icon buttons labelled with accessible text/aria labels. [Source: `_bmad-output/planning-artifacts/architecture.md` §Frontend Architecture]

### 测试要求

- Because this story creates TypeScript/React source, run at least the affected package `lint` and `typecheck`.
- Because it establishes rendering logic and test scripts, also run affected tests.
- Minimum validation commands expected before marking implementation complete:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- If `src-tauri/` compiles and `cargo` is available, also run:

```bash
cd src-tauri && cargo test
```

- If any command cannot run due to environment, toolchain, or dependency constraints, record exactly what did not run, why, and risk.

### 最新技术信息

- Tauri official docs identify `create-tauri-app` as the utility for creating a new Tauri project from officially maintained framework templates, including React. Use the docs flow and let `@latest` resolve current package versions at implementation time. Source: https://v2.tauri.app/start/create-project/
- Do not rely on stale package versions embedded in older planning text if the current `@latest` starter resolves newer versions. Prefer generated project metadata plus lockfile as source of truth after scaffolding.

### 前置故事信息

- No previous implementation story exists. Repository currently has BMAD planning artifacts, standards docs, `README.md`, and no application source, `package.json`, Vite config, or `src-tauri/`.
- Recent commits only changed planning artifacts and sprint tracking:
  - `e46cd03 Rename Workspace concept to Project`
  - `acd2533 Generate BMAD sprint status`
  - `129f4f6 docs: update implementation readiness report`

### 禁止事项

- Do not auto-enter the last Project on app open.
- Do not render Activity Bar on Project Home.
- Do not implement fake persistence and call it done.
- Do not introduce Issue fields beyond MVP (`priority`, `label`, `assignee`, `milestone`).
- Do not add Redux, routing complexity, backend HTTP, cloud auth, or plugin architecture.
- Do not use a large UI/admin component framework as the base.

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 1 / Story 1.1 and UX-DR5.
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — Project Home entry model, FR-1, FR-2, FR-3.
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md` — React IA and module boundary.
- `_bmad-output/planning-artifacts/architecture.md` — starter, project structure, toolchain, testing expectations.
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — IA, component behavior, Project card grid rules.
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md` — visual tokens and layout constraints.
- `docs/standards/shared/coding-style.md` — naming, type, organization, formatting rules.
- `docs/standards/shared/engineering-spec.md` — TypeScript engineering baseline.
- Tauri official create-project docs: https://v2.tauri.app/start/create-project/

## Dev Agent Record

### Agent Model Used

由 dev agent 填写。

### Debug Log References

### Completion Notes List

- 已完成 create-story 上下文分析，并生成开发实现指南。

### File List
