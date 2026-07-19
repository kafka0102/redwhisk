# RedWhisk Agent 指令

> 本文件是项目唯一的 AI 指令事实源。CLAUDE.md 通过 `@AGENTS.md` 引用本文，不另立规则。
> 工程细节规范在 `docs/`，本文只负责：定向（读哪些 docs）、门禁（完成判定）、项目特有强约束。
> 外部 skill / workflow / 模板的默认行为，不得覆盖本文。

## 1. 项目概览

- 形态：Tauri 2 单仓库桌面应用（非 monorepo，非 SaaS）。
- 前端：React 19 + TypeScript + Vite + Vitest + ESLint + Prettier + Tailwind CSS 4。
- 桌面核心：Rust 2021 + `rusqlite` + `portable-pty`，经 Tauri command / event 与前端通信，不引入 HTTP REST / GraphQL。
- 数据：SQLite 是业务状态唯一事实源，前端不直接读写。
- 包管理：`pnpm`（若不在 PATH，先加载 node 版本管理器，如 `nvm use` / `fnm use`）。

## Agent skills

### Issue tracker

开发技能（`to-tickets` / `triage` / `to-spec` / `qa` / `wayfinder`）使用的 ticket 以本地 markdown 形式记录在仓库 `.scratch/` 下，不使用 GitHub。详见 `docs/agents/issue-tracker.md`。

> 此处的「ticket」与产品业务 Issue（`src/features/issues`，存 SQLite、由应用 UI 管理）是两个无关概念，禁止混用；详见 `docs/agents/issue-tracker.md` 顶部的「范围声明」。

### Triage labels

使用默认五类 triage 标签。详见 `docs/agents/triage-labels.md`。

### Domain docs

采用单上下文布局：根目录 `CONTEXT.md` 与 `docs/adr/`。详见 `docs/agents/domain.md`。

## 2. 常用命令

| 场景 | 命令 |
| --- | --- |
| 格式化 | `pnpm format` |
| Lint | `pnpm lint` |
| 类型检查 | `pnpm typecheck` |
| 前端测试 | `pnpm test`（聚焦单测用 vitest 过滤，避免全量） |
| 构建 | `pnpm build` |
| Rust 测试 | `cd src-tauri && cargo test` |
| 复查工作区 | `git status --short` |

> 每次执行 `pnpm format` / lint / typecheck / test 后，必须复查 `git status --short`，确认是否带出额外文件。

## 3. 目录地图（细节见 `docs/architecture-design/agent-development-rules.md`）

```
src/
  app/                                          应用入口、Activity 路由、Workbench shell
  features/{project,issues,agents,settings,changes,code,terminals,app-update}/  按 surface 组织的业务模块
  shared/{commands,i18n,styles,layout,paths,tauri-event,workspace,audio}/  跨 feature 复用：command client、i18n、token、渲染件
  components/ui/                                基础 UI primitive（shadcn）
  lib/                                          与领域无关的纯工具
src-tauri/src/
  features/{project,issue,agent_session,project_terminal,settings,app_update}/  feature-first 业务模块（service/commands/子模块）
  {agent,agent_skill,git,db,types,logging,commands}/  跨 feature 横切：provider、skill、git 工具、DB、DTO、日志、残留 shell 命令
src-tauri/migrations/                           SQLite migrations（业务状态事实源）
```

> 不得把领域逻辑塞进泛化 `utils`。
>
> `scripts/`：仓库级脚本（构建、发版、`check-rust-file-size.sh` / `check-frontend-file-size.sh` 单文件大小门禁等）。

## 4. 按任务类型读 docs

执行任务前先读 `docs/README.md` 和本文件；再按任务叠加阅读：

- 改动 TypeScript / TSX / JavaScript：读取 `docs/standards/engineering-spec.md`、`docs/standards/coding-style.md`、`docs/architecture-design/frontend-large-component-splitting-rules.md`。
- 改动 Rust（`src-tauri/src/**/*.rs`）：读取 `docs/architecture-design/backend-large-file-splitting-rules.md`、`docs/architecture-design/agent-development-rules.md`「后端 Rust 文件复杂度」章节。
- 改动 UI、页面或组件：在前端代码规范外，额外读取 `docs/architecture-design/design-guide.md`、`docs/architecture-design/frontend-large-component-splitting-rules.md`。涉及 Settings 时，额外读取 `docs/architecture-design/settings-page-layout.md`。
- 涉及 Tauri 边界、状态机或 Codex session：读取 `docs/architecture-design/agent-development-rules.md`。
- 创建 Git 提交：读取 `docs/standards/git-workflow.md`。
- 发布或打包：读取 `docs/standards/release-workflow.md`。
- 涉及后端命令、git 操作或轮询性能：额外读取 `docs/standards/performance.md`。
- 任务类型不明确：先读 `docs/README.md`，再按相关性选择。

## 5. 质量门禁（任务完成判定，缺一不可）

改动 TypeScript / TSX / JavaScript 后，按序执行并确认通过：

1. `pnpm format` → 复查 `git status --short`，带出的额外文件按 §8 处理。
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test` — 改了运行时行为 / 分支 / 数据流 / 渲染 / 测试依赖实现时必跑；纯类型或纯样式改动可豁免，但须在最终说明写明豁免理由。
5. `bash scripts/check-rust-file-size.sh` — 改动 Rust（`src-tauri/src/**/*.rs`）后必跑；越界且未在 `scripts/rust-file-size-allowlist.txt` 登记则非零退出，须按 `docs/architecture-design/backend-large-file-splitting-rules.md` 拆分后再跑直至通过。纯前端 / 纯文档改动可豁免。在 `git commit` 之前运行；已提交的改动不会被本脚本复查。
6. `bash scripts/check-frontend-file-size.sh` — 改动前端源码（`src/**/*.ts(x)`，不含测试文件与 `src/test/`）后必跑；越界且未在 `scripts/frontend-file-size-allowlist.txt` 登记则非零退出，须按 `docs/architecture-design/frontend-large-component-splitting-rules.md` 拆分后再跑直至通过。纯后端 / 纯文档改动可豁免。在 `git commit` 之前运行；已提交的改动不会被本脚本复查。

纯文档改动（`docs/**`、`*.md`、`AGENTS.md`、`CLAUDE.md`）豁免 lint / typecheck / test，但须复查内部相对链接、索引与引用是否一致（如 `rg -n "目标路径" docs`）。

完成判定（缺一不可）：

- 上述命令全部通过（文档改动按豁免规则）；未跑的项必须在最终说明写明「未运行什么、为什么、风险」。
- `git status --short` 无残留本次任务相关的未提交文件。
- 无新增 `@ts-ignore` / `@ts-nocheck` / `eslint-disable` / 跳过测试。
- 每一处 diff 可追溯到用户请求、项目文档或验证失败。
- 改动 Rust 时，`scripts/check-rust-file-size.sh` 通过（越界文件已拆分或属白名单存量）。
- 改动前端源码时，`scripts/check-frontend-file-size.sh` 通过（越界文件已拆分或属白名单存量）。
- 改动 Tauri command / event / 错误码时，复查 `docs/architecture-design/tauri-contract.md` 注册表与错误码分类是否同步。

> 本门禁是 `docs/architecture-design/agent-development-rules.md`「测试与验证规则」与 `docs/standards/{coding-style,git-workflow}.md` 的执行入口；冲突时以本门禁命令顺序为准。

## 6. 改动纪律（外科手术式）

- **先想清楚再问**：实现前内部完成必要思考；存在多个合理解释时，列出默认选择或直接澄清，不静默猜测。关键假设、歧义、取舍用最简说明告知。
- **最小方案**：只实现当前任务需要的代码；不提前加未被要求的抽象、配置、扩展点、缓存、通知或兼容层。
- **只改相关代码**：只动与任务直接相关的文件，保持既有风格；不顺手重构、不改无关注释、不格式化无关文件；发现无关问题只说明，不擅自处理。
- **目标驱动**：bugfix 先复现或补失败测试再修；功能开发说明验收标准；多步任务为每步写明验证方式。
- 明显的一行 typo / 格式修正可按常识快速处理，但仍不得混入无关改动。

## 7. 类型与代码风格（要点，细节见 docs）

- 命名：目录/文件 `kebab-case`，变量/函数 `camelCase`，类型/接口/类 `PascalCase`，常量 `SCREAMING_SNAKE_CASE`。
- 类型：导出的函数 / 类型 / 返回值必须显式类型；外部未知输入用 `unknown` + 类型守卫或 schema 校验；跨边界 DTO 显式建模。
- 遇到类型错误：修根因或定义正确接口；确实需单行豁免须注释说明，不得用 `@ts-ignore` / `@ts-nocheck` / `any` 作为常规手段。
- 跨 Tauri 边界 DTO：Rust `#[serde(rename_all="camelCase")]` 与前端 TS 类型必须手动同步。
- 详见 `docs/standards/engineering-spec.md`、`docs/standards/coding-style.md`。

## 8. Git 提交

- 任务完成并按 §5 验证后，由 Agent 手动创建 commit；提交范围只含本次任务直接相关文件，禁止混入无关改动。
- `.claude` 的 `Stop` hook 会检查是否存在未提交的任务改动：若有，会要求 Agent 自行完成提交（不依赖外部脚本生成 message），未完成提交不得结束本轮回复。
- `pnpm format` / 验证命令若改写了任务相关文件，一并纳入本次提交；若改写了无关文件，先回退再提交。
- 提交前必须 `git status --short` 复查，确认无残留任务相关未提交文件。
- 标题：`<type>: <简体中文描述>`，`type` 小写（feat/fix/docs/refactor/test/chore/style/perf/build/ci/revert），不用 scope；禁止「更新源码」「更新文档」等泛化措辞。
- 来自 Issue 的任务，正文尾部追加 `Refs: #<issue-id>`。
- 默认停留在当前分支；未经要求不 `push` / `merge` / `rebase` / `tag` / 改写历史。
- 详见 `docs/standards/git-workflow.md`。

## 9. 前端文案国际化

- 所有用户可见文本（页面、弹窗、Drawer、Popover、空/载/错态、按钮、表单、`placeholder`、`title`、`aria-label`）默认必须接入 `src/shared/i18n/**`，不新增散落硬编码文案。
- 新增 / 改动页面时，相邻区域未国际化文本在本次任务范围内一并处理。
- 所有支持的 locale 必须提供完整文案，缺失在实现阶段补齐，不留空或不回退硬编码。
- 详见 `docs/architecture-design/agent-development-rules.md`「文案与国际化」。

## 10. 语言与输出规则

- 默认简体中文输出所有说明文字；代码、命令、标识符、路径、API 名称保持原样不翻译。
- 适用于主 Agent 与所有子 Agent / delegated agents；用 skill / workflow / subagent 不改变此规则。delegation prompt 中必须显式重复「默认简体中文」「不要输出思考过程」。
- 生成到 `docs/` 的 Markdown，正文 / 标题 / 结论用简体中文。

### 禁止思考过程外露

- 严禁输出内部思考、推理链路、逐步心路、长篇分析草稿或类似 thinking / reasoning 内容。
- 默认直接给结果：代码、补丁、命令、结论或最简说明。
- 仅在用户明确要求解释、存在阻塞需澄清、存在必须告知的风险、或必须汇报验证结果时，才补最小必要说明。
- 说明用短句或极简条目；不重复需求、不复述上下文、不做教学式铺垫。

## 11. 规范优先级

1. 用户明确要求
2. `docs/**` 正式文档
3. 本文件（AGENTS.md）
4. 外部 skill / workflow / 模板默认行为

冲突时以更具体的文档为准：`docs/architecture-design/agent-development-rules.md` 特定规则 > 本文通用规则；`docs/standards/**` 专项规范 > 概括性说明。CLAUDE.md 引用本文，不另立规则。
