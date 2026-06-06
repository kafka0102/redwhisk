---
baseline_commit: fe42f4e
---

# Story 1.8: 配置 Codex Agent Profile 和 Project Override

Status: done

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为 AI Coding 用户,
我希望配置全局 Codex Agent Profile 并在 Project 中覆盖部分配置,
以便不同仓库可以复用或调整 Codex 启动方式.

## Acceptance Criteria

1. 给定用户打开 Global Settings，当用户创建 Codex Agent Profile，则系统通过用户 login shell 执行 `command -v codex`；如 schema 尚未存在则通过 migration 创建 `agent_profiles` 表，并保存 `name`、`agent_type`、`command`、`default_args`、`default_skill`、`prompt_template`、`enabled`。
2. 给定 `codex` command 检测失败，当用户手动填写 command path 并运行 Test，则 command 可执行时允许保存 enabled Agent Profile，command 不可执行时不得保存 enabled Agent Profile。
3. 给定 Project 已打开，当用户设置 ProjectAgentOverride，则如 schema 尚未存在则通过 migration 创建 `project_agent_overrides` 表，并可以覆盖 `default_args`、`default_skill`、`prompt_template`、`enabled`；override 只影响当前 Project。

## Tasks / Subtasks

- [x] 新增 `agent_profiles` 与 `project_agent_overrides` 持久化 schema，并接入 migration runner (AC: 1, 3)
  - [x] 新增 `src-tauri/migrations/0006_agent_profiles_and_project_overrides.sql` 或等价顺序 migration；保持现有单事务、幂等和失败回滚机制。
  - [x] `agent_profiles` 至少保存 `id`、`name`、`agent_type`、`command`、`default_args`、`default_skill`、`prompt_template`、`enabled`；字段命名保持 `snake_case`，布尔值沿用 SQLite 可测试表示。
  - [x] `project_agent_overrides` 至少保存 `id`、`project_id`、`agent_profile_id`、`default_args`、`default_skill`、`prompt_template`、`enabled`，并通过外键约束到 `projects` 与 `agent_profiles`。
  - [x] 为 `project_agent_overrides` 增加能保证“同一 Project 对同一 Agent Profile 最多一条 override”的唯一约束；不要提前引入本 story 未消费的宽表、审计表或配置历史表。
- [x] 建立 Agent Profile / Project override 的 Rust 类型、repository、service 与 command detector 边界 (AC: 1, 2, 3)
  - [x] 新增 `src-tauri/src/types/agent_profile.rs` 或同等清晰命名的类型文件，定义跨边界 DTO、输入类型和最小枚举；当前仅需支持 Codex，但命名不能把后续多 Agent 扩展堵死。
  - [x] 新增 `src-tauri/src/db/agent_profile_repository.rs` 与必要的 Project override repository 边界，只负责持久化，不把 command 检测或 enabled 判定塞进 repository。
  - [x] 新增 `src-tauri/src/core/settings_service.rs` 或等价服务，集中处理 profile 保存、override 保存、command 检测和“enabled 仅在命令可执行时允许为 true”的业务规则。
  - [x] 新增 `src-tauri/src/agent/command_detector.rs` 或等价能力，负责通过用户 login shell 执行 `command -v codex`，以及对手动 command path 做可执行性检测；不要把 `/bin/zsh`、当前机器路径或安装器假设硬编码进 React。
  - [x] 扩展 `src-tauri/src/commands/`、`src-tauri/src/core/mod.rs`、`src-tauri/src/db/mod.rs`、`src-tauri/src/types/mod.rs`、`src-tauri/src/lib.rs` 暴露新模块与 Tauri commands。
- [x] 提供最小可用的 Agent Profile / Project override 配置 UI，但不提前完整实现 Story 1.9 的设置体系 (AC: 1, 2, 3)
  - [x] 在 `src/features/settings/` 下新增专用 UI 组件，例如 `agent-profile-form.tsx`、`project-agent-override-form.tsx`，不要把设置表单逻辑堆进 `shared/`。
  - [x] 让当前 `ProjectSettingsActivity` 从占位页升级为最小可用的 Project override 编辑面，并清楚标注“当前 Project”作用域。
  - [x] 为全局 Agent Profile 提供一个轻量但真实可操作的入口或弹层，保证用户能创建/编辑全局 profile，同时不抢走 Story 1.9 对正式 Global Settings IA、gear/native menu 和其他设置域的所有权。
  - [x] UI 必须区分“检测 command / Test”和“保存 profile”两个动作；检测失败时展示事实性错误，不伪造 enabled 成功状态。
  - [x] 当前 story 不实现 UI language、全局数据目录、日志目录、About、Diagnostics，也不实现完整 Settings 首页导航。
- [x] 保持与后续 Run Dialog / Session 流程的边界清晰 (AC: 1, 2, 3)
  - [x] Run Dialog、最终 prompt 生成、prompt 来源折叠、Session 启动、Issue `running` 状态流转均留给后续 stories，不在本 story 提前实现。
  - [x] 仅保证本 story 保存的数据结构足以被后续 Run Dialog 读取和组合；如果 `default_args` 的内部表示需要约定，必须前后端统一且可逆，不把解析规则散落在多个 UI 组件里。
  - [x] `command` 可用性与配置继承属于 Settings 侧事实，不应提前泄漏到 `issues` 或 `agents` 视图。
- [x] 测试与验证 (AC: 1, 2, 3)
  - [x] 新增 Rust 测试覆盖：`0006` migration 创建表、外键和唯一约束；保存 enabled profile 时 command 检测成功/失败分支；Project override 只影响当前 Project。
  - [x] 新增 Rust 测试覆盖：手动 command path Test 成功时允许保存 enabled，失败时返回稳定错误并且数据库不落 enabled=true 的脏数据。
  - [x] 新增前端测试覆盖：设置页区分全局 profile 与当前 Project override、检测失败文案、保存禁用条件、override 不影响其他 Project 的展示。
  - [x] 如增加了新的 command client 或 DTO，补最小集成测试，确保错误对象仍符合 `src/shared/commands/command-error.ts` 既有解析约定。
  - [x] 运行 `pnpm format`。
  - [x] 运行 `pnpm lint`。
  - [x] 运行 `pnpm typecheck`。
  - [x] 运行 `pnpm test`。
  - [x] 运行 `cargo fmt --manifest-path src-tauri/Cargo.toml`。
  - [x] 运行 `cargo test --manifest-path src-tauri/Cargo.toml`。
  - [x] 若实际改动了跨边界 command / DTO / shell 能力，再运行 `pnpm build` 做一轮前端构建验证。

### Review Findings

- [x] [Review][Patch] 继承态的 Project override 表单不会随着全局 profile 更新刷新，导致 Settings 继续展示旧默认值 [src/features/settings/project-settings-activity.tsx:132]

## Dev Notes

### 关键假设与取舍

- 这条 story 的核心是 FR7 + FR8，即“Agent Profile / Project override 的可配置与可校验基础”。Story 1.9 才正式接住 Project Settings、Global Settings 分层、gear/native menu 入口和基础 i18n，因此 1.8 应交付最小可用配置 UI，而不是把整个设置体系一次性做完。
- 当前仓库还没有 `settings_service.rs`、`agent_profile_repository.rs`、`agent/command_detector.rs` 或任何 Global Settings 入口。默认选择是：1.8 先把数据模型、命令边界和最小可用 UI 建起来，并确保这些组件能被 1.9 直接复用，而不是做临时脚手架后再推倒重来。
- `enabled` 是本 story 最关键的业务约束。保存 disabled profile 时不需要强制 command 可执行；只有当用户要保存 `enabled=true` 时，才必须先经过检测并阻止失败状态落库。
- `default_args` 的持久化表示当前文档没有进一步规定。实现时必须明确单一表示方式并保持前后端一致，例如 `string[]` DTO + SQLite 文本序列化；不要在 UI 层靠空格切分字符串再让后端各自猜测。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §FR-8]
- 2026-06-06 额外核对官方 Codex CLI 文档后，没有发现“`codex` 作为 CLI 入口”已失效的信号；因此本 story 只需要检测本机可执行命令存在与可执行性，不需要把安装方式、版本检查或联网校验扩展进范围。

### 范围边界

- 交付 FR7、FR8 和与其直接相关的最小设置界面、数据库结构、命令检测和错误反馈。
- 不交付 FR9 最终 prompt 生成，不交付 Run Dialog，不交付 Agent Session 启动，不交付 Project/global completion policy、日志目录、About、Diagnostics 或 i18n 切换。
- 不新增与本 story 无关的状态流转、IssueAction、SessionEvent、CompletionAttempt，也不提前实现多 Agent 并行或云端同步。

### 架构约束

- SQLite 只能由 Rust repository/service 层读写；React 不直接访问数据库、shell 或本地文件系统。[Source: `_bmad-output/planning-artifacts/architecture.md` §Data Boundaries]
- `commands/*_commands.rs` 只做 Tauri 边界适配；Agent Profile 的 enabled 判定、override 作用域和 command 检测必须留在 `core/settings_service.rs` 或等价业务层。[Source: `_bmad-output/planning-artifacts/architecture.md` §Service Boundaries]
- Feature 边界已经在架构中给出：`features/settings/` 负责 Project Settings、Global Settings、Agent Profile 和 Diagnostics；`shared/commands` 仅是前端接入 Rust Core 的通道，不承载业务判断。[Source: `_bmad-output/planning-artifacts/architecture.md` §Component Boundaries]
- Activity Bar 固定只有 `Issues`、`Agents`、`Settings` 三个入口；Global Settings 通过 gear 或原生菜单打开，而不是增加第四个 Activity。若 1.8 需要临时全局入口，也必须服从这个 IA，不要私自加新主导航。[Source: `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` §信息架构；`_bmad-output/planning-artifacts/epics.md` §UX-DR5]
- Run Dialog 后续会消费覆盖后的生效配置，但它不应展示 command 可用性或配置继承细节；这些信息属于 Settings 侧。[Source: `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` §FR-8、FR-9]

### 当前代码状态与修改指引

- `src/features/settings/project-settings-activity.tsx` 现在只是一个静态占位页，没有表单、没有 Project 作用域状态，也没有全局设置入口。Story 1.8 需要把它变成真正可工作的最小设置面，但避免顺手完成 1.9 的全域设置内容。
- `src/app/activity-router.tsx` 只会把 `settings` route 渲染到 `ProjectSettingsActivity`，`src/app/app-shell.tsx` 也没有左下角 gear 或 Global Settings 触发器。若要满足 AC 中“打开 Global Settings”，需要补一个最小入口，同时保持当前 shell 结构稳定。
- Rust 侧目前只有 `project`、`issue`、`issue_action` 等类型与 service/repository；`src-tauri/src/commands/mod.rs`、`src-tauri/src/core/mod.rs`、`src-tauri/src/db/mod.rs`、`src-tauri/src/types/mod.rs` 里都还没有 settings / agent profile 模块。
- `src-tauri/src/core/project_service.rs` 与 `src-tauri/src/db/project_repository.rs` 当前只处理 Project 创建、查询和打开；不要把 Agent Profile / Project override 逻辑硬塞到 project service/repository 中，应该新建独立边界保持单一职责。
- `src-tauri/src/types/errors.rs` 目前只有本地数据、Project、Issue 相关错误码。实现 1.8 时应补 settings / command detection 相关错误码，同时保持 `SCREAMING_SNAKE_CASE` 与前端 `toCommandError` 兼容。
- `src-tauri/src/db/migrations.rs` 当前静态 migration 到 `0005_issue_actions`；本 story 应在其后追加 `0006`，沿用已有事务、`INSERT OR IGNORE` 和 rollback 模式。

### 实现建议

- `agent_profiles` 建议作为全局表；`project_agent_overrides` 建议以 `(project_id, agent_profile_id)` 建立唯一约束，明确“某 Project 对某个 profile 最多一份覆盖”，避免把 override 错建成 Project 级单例后堵死多 profile 场景。
- `agent_type` 当前只需要支持 Codex，但类型和持久化值应选用能自然扩展的稳定字面量，不要把 UI 文案直接当数据库值。
- command 检测应由 Rust 负责，并与“保存 enabled profile”解耦：用户可以先 Test，再保存；也可以在保存 enabled 时由 service 二次保护，防止前端跳过 Test 直接提交。
- 手动 command path Test 只需验证路径是否可执行，不要在本 story 里进一步启动真实 Codex 会话或探测 `--version` 输出，以免把 Epic 2 的 PTY / Session 责任提前拉进来。
- 如果需要前端临时保存表单草稿，应明确区分“未保存表单状态”和“已持久化配置”；失败时保留输入并展示事实性错误，不能把本地草稿伪装成数据库成功状态。

### 前置故事信息

- Story 1.2 建立了 SQLite 连接、migration runner、`initialize_local_data` command 和统一 `CommandError` 结构。
- Story 1.3 建立了 Project schema、Git repo 校验、Project DTO / repository / service / command 和 Tauri window 打开流程。
- Story 1.4 建立了 Project Home、Project Switcher 和路径不可用时的恢复/提示逻辑。
- Story 1.5 建立了 Issue CRUD 的 Rust Core 与最小前端交互。
- Story 1.6 建立了 Issues 四泳道和 Issue Detail Dialog，当前 UI shell 已固定为 `Issues`、`Agents`、`Settings` 三个 Activity。
- Story 1.7 建立了 IssueAction migration、repository/service 分层和 Rust 事务化写入模式；本 story 应复用这种“新增独立 repository + service + migration + Rust 测试”的实现节奏，而不是回退到 command 层堆业务逻辑。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `fe42f4e`。
- 最近提交以单 story 小步提交为主，且前端 story 都会执行 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`；Rust story 则执行 `cargo fmt` 与 `cargo test`。本 story 同时涉及 React + Rust，默认两套验证都要跑。
- 最近 5 个提交里，`fe42f4e`、`4925a96`、`7ee87dd`、`fb4d182`、`1413707` 都聚焦单一 story 的局部改动，没有混入大规模重构；1.8 也应遵守同样的外科手术式修改策略。

### 测试要求

- 因本 story 大概率会改动 TypeScript / React 源码，必须运行 `pnpm lint` 与 `pnpm typecheck`。
- 因本 story 会改动运行时行为、表单分支、数据流、Tauri command 和测试依赖实现，必须运行前端 `pnpm test`。
- 因本 story 也会改动 Rust migration、service、repository 和 command detector，必须运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 与 `cargo test --manifest-path src-tauri/Cargo.toml`。
- 若新增命令或 DTO 影响到打包/构建路径，建议补跑 `pnpm build`，尽早发现跨边界类型或 Vite 打包问题。
- 最小验证命令清单：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Epic 1 / Story 1.8、FR7、FR8、UX-DR5、UX-DR8。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — UJ-2、FR-7、FR-8、FR-9、信息架构与 Settings 范围。
- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` — FR-7、FR-8、FR-9、Settings 分层、覆盖后的生效配置约束。
- `_bmad-output/planning-artifacts/architecture.md` — Component Boundaries、Service Boundaries、Data Boundaries、Requirements to Structure Mapping、migration 与 SQLite 约束。
- `_bmad-output/implementation-artifacts/1-7-record-issue-action-audit.md` — 最近一条 Rust 数据层 story 的分层、事务和验证模式。
- `src/features/settings/project-settings-activity.tsx` — 当前 Settings 占位实现。
- `src/app/activity-router.tsx`、`src/app/app-shell.tsx` — 当前 Project workbench 的 Settings 路由与 shell 结构。
- `src-tauri/src/core/project_service.rs`、`src-tauri/src/db/project_repository.rs`、`src-tauri/src/db/migrations.rs`、`src-tauri/src/types/errors.rs` — 当前 Rust Core 边界、migration 模式与错误结构。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-06T10:25+0800：`bmad-dev-workflow` preflight 完成，识别到 `1-8-configure-codex-agent-profile-and-project-override` 为首个 backlog story。
- 2026-06-06T10:28+0800：读取 Epic / PRD / architecture / implementation-readiness 与当前 Settings、Project、Rust command 代码现状，确认 1.8 必须只做 FR7+FR8 的最小可用配置基础。
- 2026-06-06T10:32+0800：补做官方 Codex CLI 最小核对，未发现 `codex` CLI 入口已失效的信号，因此 story 保持本机命令可执行性检测范围。
- 2026-06-06T10:41+0800：完成 `0006` migration、`agent_profile` 类型、repository、service 与 Tauri settings commands，`enabled=true` 改为由 Rust service 二次校验命令可执行性。
- 2026-06-06T10:49+0800：完成最小 Settings UI，采用全局 profile 弹层 + 当前 Project override 表单，保留 Story 1.9 对正式 Settings IA 的所有权。
- 2026-06-06T10:58+0800：完整验证通过：Rust 定向测试、前端定向测试、`pnpm format`、`cargo fmt`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`cargo test`、`pnpm build`。
- 2026-06-06T11:11+0800：手动 code review 发现继承态 override 表单不会随着全局 profile 更新刷新；已改为使用 profile 派生 key 强制 inherited form remount，并补回归测试。
- 2026-06-06T11:12+0800：review patch 验证通过：`pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test -- --run src/features/settings/project-settings-activity.test.tsx src/shared/commands/command-client.test.ts src/app/app.test.tsx`。

### Completion Notes List

- create-story 已为 Story 1.8 生成完整开发上下文。
- 已明确 1.8 与 1.9 的边界：1.8 交付 Agent Profile / Project override 基础，1.9 再正式完善 Settings 分层和 i18n。
- 已标出当前仓库缺失的 `settings_service.rs`、`agent_profile_repository.rs`、`agent/command_detector.rs`、Global Settings 入口与错误码扩展点。
- 已规定本 story 既要跑前端 `format/lint/typecheck/test`，也要跑 Rust `fmt/test`，并建议补跑 `pnpm build`。
- 新增 `0006_agent_profiles_and_project_overrides.sql`，为全局 `agent_profiles` 和 `(project_id, agent_profile_id)` 唯一约束的 `project_agent_overrides` 建立持久化基础。
- 新增 `command_detector`、`agent_profile_repository` 与 `settings_service`，统一处理 login shell `command -v codex` 检测、手动 command path 检测，以及保存 `enabled=true` 时的后端保护。
- 新增 `settings_commands` 与跨边界 DTO/错误码，前端通过 `settings-commands.ts` 调用，不把 shell 或业务判断泄漏到 React。
- `ProjectSettingsActivity` 已升级为最小可用设置页，包含全局 Codex Profile 弹层、当前 Project override 表单、Test 与 Save 分离交互，以及事实性失败反馈。
- 为规避 React hooks lint，表单采用 keyed remount + lazy initial state，同步 profile/override 初值而不在 `useEffect` 中执行 `setState`。
- Rust 与前端测试均已补齐，覆盖 migration 约束、enabled 校验、override 作用域、设置页交互和 command client 错误解析。
- code review 额外修复了 inherited Project override 表单的陈旧默认值问题；全局 profile 更新后，未持久化 override 的 Project 表单会立即反映新的全局默认值。

### Validation Commands

- `cargo test --manifest-path src-tauri/Cargo.toml --test settings`
- `cargo test --manifest-path src-tauri/Cargo.toml --test local_data`
- `pnpm test -- --run src/features/settings/project-settings-activity.test.tsx src/shared/commands/command-client.test.ts src/app/app.test.tsx`
- `pnpm format`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm build`
- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- --run src/features/settings/project-settings-activity.test.tsx src/shared/commands/command-client.test.ts src/app/app.test.tsx`

### Validation Results

- `cargo test --manifest-path src-tauri/Cargo.toml --test settings`：通过
- `cargo test --manifest-path src-tauri/Cargo.toml --test local_data`：通过
- `pnpm test -- --run src/features/settings/project-settings-activity.test.tsx src/shared/commands/command-client.test.ts src/app/app.test.tsx`：通过
- `pnpm format`：通过
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：通过
- `pnpm lint`：通过
- `pnpm typecheck`：通过
- `pnpm test`：通过，测试输出包含既有 `Could not parse CSS stylesheet` 警告，但不影响结果
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过
- `pnpm build`：通过，保留既有 CSS minify 和 chunk size warning，未阻塞本 story
- `pnpm format`：通过（review patch）
- `pnpm lint`：通过（review patch）
- `pnpm typecheck`：通过（review patch）
- `pnpm test -- --run src/features/settings/project-settings-activity.test.tsx src/shared/commands/command-client.test.ts src/app/app.test.tsx`：通过（review patch），输出包含既有 `Could not parse CSS stylesheet` 警告

### File List

- _bmad-output/implementation-artifacts/1-8-configure-codex-agent-profile-and-project-override.md
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src-tauri/migrations/0006_agent_profiles_and_project_overrides.sql
- src-tauri/src/agent/command_detector.rs
- src-tauri/src/agent/mod.rs
- src-tauri/src/commands/mod.rs
- src-tauri/src/commands/settings_commands.rs
- src-tauri/src/core/mod.rs
- src-tauri/src/core/settings_service.rs
- src-tauri/src/db/agent_profile_repository.rs
- src-tauri/src/db/migrations.rs
- src-tauri/src/db/mod.rs
- src-tauri/src/lib.rs
- src-tauri/src/types/agent_profile.rs
- src-tauri/src/types/errors.rs
- src-tauri/src/types/mod.rs
- src-tauri/tests/local_data.rs
- src-tauri/tests/settings.rs
- src/app/activity-router.tsx
- src/app/app-shell.tsx
- src/app/app.css
- src/features/settings/agent-profile-form.tsx
- src/features/settings/project-agent-override-form.tsx
- src/features/settings/project-settings-activity.test.tsx
- src/features/settings/project-settings-activity.tsx
- src/features/settings/settings-commands.ts
- src/shared/commands/command-client.test.ts

### Change Log

- 2026-06-06：实现 Story 1.8 的 Codex Agent Profile 与 Project override 基础设施、最小 Settings UI 和前后端验证，状态推进到 review。
- 2026-06-06：修复 code review 发现的 inherited override 刷新问题，追加回归测试后复审通过，状态推进到 done。
