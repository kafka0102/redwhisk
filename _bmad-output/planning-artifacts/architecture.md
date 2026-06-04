---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md
  - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/addendum.md
  - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/reconcile-brainstorming.md
  - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/review-rubric.md
  - _bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/.decision-log.md
  - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/reconcile-prd.md
  - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/review-ux.md
  - _bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/.decision-log.md
  - docs/standards/README.md
  - docs/standards/shared/api-conventions.md
  - docs/standards/shared/coding-style.md
  - docs/standards/shared/engineering-spec.md
  - docs/standards/shared/git-workflow.md
workflowType: 'architecture'
project_name: 'redwhisk'
user_name: 'kafka0102'
date: '2026-06-03'
lastStep: 8
status: 'complete'
completedAt: '2026-06-03'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
RedWhisk MVP 的功能核心是本地 Git Workspace 内的 Agent 开发闭环：创建 Workspace，管理极简本地 Issue，从 Issue 启动 Codex Agent Session，在内嵌 PTY/xterm 的 Codex Native Session View 中交互，手动进入 review，继续修正或完成 Issue，并保留 Summary、日志、IssueAction、SessionEvent 与 CompletionAttempt。

功能需求可归为 10 类：Workspace 与本地恢复、Issue 管理、Agent Profile 与 prompt 编排、Agent Session 启动、Codex Native Session View、Review 循环、Completion Policy、完成后复盘、Session Header / Issue Inspector、基础国际化。架构必须明确前端不能直接写核心业务状态，状态变化应由核心层校验、持久化并通知 UI。

**Non-Functional Requirements:**
关键 NFR 是本地优先与隐私、状态可靠性、审计性、终端性能、完成安全、失败可见性和跨平台目标。MVP 不上传 Issue、prompt、日志、Git 状态或代码内容；终端高频输出写入日志文件，SQLite 只保存结构化事件和索引；应用不得直接执行 `git add .` 或自行提交全部改动；crashed、no commit detected、日志缺失等失败路径必须显式可见。

**Scale & Complexity:**
项目复杂度为 high，原因不是用户规模或云端复杂度，而是本地桌面、PTY 进程、Codex CLI、Git 检测、状态机、审计记录和 React 工作台 UI 之间存在强一致性要求。

- Primary domain: 跨平台本地桌面 full-stack developer tool
- Complexity level: high
- Estimated architectural components: 8-10 个核心组件，包括 Tauri Shell、React Workbench、Rust Core、PTY/Agent 运行层、CodexAdapter、SQLite Store、Log Files、Git 检测层、Settings/Profile 配置层、i18n/UI 状态层

### Technical Constraints & Dependencies

输入文档已经给出若干架构倾向或约束：桌面壳为 Tauri，前端为 React + TypeScript，核心状态和本地动作由 Rust Core 或等价核心层负责，Codex CLI 通过内嵌 PTY 与 xterm.js 展示，结构化事实保存在 SQLite，原始终端输出保存在日志文件中。

MVP 首个 Agent 是 Codex，但 Agent Profile / WorkspaceAgentOverride / Run Dialog 不应把 Codex 写死为唯一 UI 语义。Workspace 必须绑定本地 Git Repository。macOS 上的 Embedded Codex Terminal Spike 是进入完整业务实现前的关键验证点，Windows/Linux 兼容性需要记录风险但不扩大 MVP 范围。

### Cross-Cutting Concerns Identified

- 状态机一致性：Issue 状态、Agent Session 状态、attention、CompletionAttempt 必须有单一可信写入路径。
- 审计与可复盘：IssueAction、SessionEvent、CompletionAttempt、commit hash、日志路径必须贯穿主要动作。
- 本地进程生命周期：Codex 启动、退出、crash、resize、输入、日志写入和可能的 resume 需要统一管理。
- Git 安全边界：Completion Policy 只能通过 completion prompt 与 Git 检测闭环，不允许应用层静默提交。
- UI 不卸载终端：Issue Inspector、Dialog、Header 操作不能破坏当前 xterm/PTY 会话。
- 配置继承与 prompt 快照：Global Agent Profile、Workspace override、最终 prompt 来源和快照需要可追溯。
- 失败路径可见：启动失败、command 不可用、crashed/stopped、no commit detected、日志缺失都不能被伪装成成功。
- i18n 与文案一致性：核心状态和命令文案必须支持 zh-CN / en-US，不能散落硬编码。

## Starter Template Evaluation

### Primary Technology Domain

跨平台桌面应用。项目要求本地优先、内嵌 PTY、Rust Core、React Workbench、SQLite 与 Codex CLI 集成，因此 primary domain 是 Tauri desktop full-stack developer tool，而不是普通 Web app 或 Electron app。

### Starter Options Considered

1. `create-tauri-app` + `react-ts`
   - 官方维护，直接提供 Tauri、Rust、React、TypeScript、Vite 基础结构。
   - 与 PRD/UX 中已冻结的 Tauri + React + TypeScript + Rust Core 方向一致。
   - 适合作为最小可控基础，后续再按架构补 SQLite、PTY、xterm、AgentAdapter、Git 检测和 i18n。

2. Plain Vite `react-ts`
   - 适合纯前端，但不提供 Tauri/Rust Core 桌面壳。
   - 会把关键桌面架构留给后续手工接入，不适合作为 RedWhisk 的首选 starter。

3. Electron Forge `vite-typescript`
   - Electron 官方生态成熟，也有 Vite + TypeScript 模板。
   - 但它偏离 PRD/UX 已指定的 Tauri/Rust Core 方向，并引入 Electron runtime，不作为首选。

4. 手工 Tauri 初始化
   - 可控性最高，但会增加初始化不一致风险。
   - 当前项目还没有源码骨架，优先使用官方 starter 更利于 AI Agent 后续一致实现。

### Selected Starter: `create-tauri-app` with `react-ts`

**Rationale for Selection:**
选择官方 `create-tauri-app` 的 `react-ts` 模板。它最贴合 RedWhisk 的技术约束：Tauri 桌面壳、Rust Core、React Workbench、TypeScript 前端和 Vite 开发体验。它不会提前引入 Web SaaS 框架、服务端路由、云部署假设或不必要抽象。

**Initialization Command:**

```bash
pnpm create tauri-app@latest . --template react-ts
```

如果实现阶段未采用 `pnpm`，可按官方命令等价替换为 npm/yarn/bun，但 starter 与模板选择保持不变。

**Architectural Decisions Provided by Starter:**

**Language & Runtime:**
前端使用 React + TypeScript；桌面核心使用 Rust；Tauri command/event 作为前后端边界。

**Styling Solution:**
starter 不强绑定大型 UI 组件库。RedWhisk 后续应按 UX spine 建立自定义桌面工作台组件与 CSS/token 层，避免默认套用管理后台组件库。

**Build Tooling:**
Vite 负责前端开发服务器和构建；Tauri CLI 负责桌面应用开发、打包和 Rust 集成。

**Testing Framework:**
starter 不应被视为完整测试架构。后续架构需补充 Rust 单元/集成测试、前端组件测试、Tauri command 边界测试，以及 PTY/Git Spike 验证脚本。

**Code Organization:**
starter 提供前端目录与 `src-tauri` Rust 目录。后续应在此基础上明确 React Workbench、Rust Core、Agent/PTY、SQLite、Git、日志和配置模块边界。

**Development Experience:**
提供桌面应用本地开发闭环、前端热更新和 Rust/Tauri 集成入口。项目初始化应作为第一个 implementation story，并在初始化后立即补齐 lint、typecheck、format 和基础测试脚本。

**Version Verification:**
截至 2026-06-03，已通过官方文档与 npm registry 核验当前 starter 生态：`create-tauri-app@4.6.2`、`@tauri-apps/cli@2.11.2`、`vite@8.0.16`、`react@19.2.7`、`typescript@6.0.3`。主要参考来源为 Tauri 官方 create project 文档、`create-tauri-app` npm 包、Vite 官方指南和 Electron Forge Vite + TypeScript 模板文档。

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- SQLite 只能由 Rust Core 读写，React 不直接访问数据库。
- Issue / AgentSession / CompletionAttempt 状态变化只通过 Rust Core command 完成。
- Codex 通过 Rust PTY 管理，xterm.js 只负责展示和输入转发。
- Git completion 由 Rust Core 检测 HEAD/status，应用层不直接自动提交。
- 前后端类型合同由 Rust 类型生成 TypeScript 类型，避免手写漂移。

**Important Decisions (Shape Architecture):**
- React 使用轻量本地状态架构，不引入 Redux。
- UI 使用自建桌面工作台组件和 CSS tokens，不采用管理后台组件库。
- 路由保持三大 Activity 的轻量路由；Dialog / Inspector 不作为独立页面路由。
- 日志按 Session 写文件，SQLite 只保存事件、摘要和路径。
- MVP 不实现登录、云同步、远程 API 或多租户。

**Deferred Decisions (Post-MVP):**
- 云账户、同步、组织权限、GitHub/GitLab 集成、插件系统、完整 Diff、Worktree 自动化。
- 数据库加密和 secret vault，除非后续引入真实密钥存储需求。
- 自动更新、签名、公发渠道和跨平台发布流水线细节。

### Data Architecture

选择本地 SQLite 作为结构化存储，但不使用前端可直接调用的 SQL 插件作为业务写入路径。Rust Core 通过 `rusqlite` 访问 SQLite，并封装 repository/service 层。这样能保证状态机、审计记录和事务边界集中在核心层。

迁移策略使用 Rust 侧 migration runner，迁移文件随应用打包。首次启动或打开 Workspace 时运行迁移。表结构优先覆盖 PRD addendum 中的 `workspaces`、`workspace_settings`、`issues`、`agent_profiles`、`workspace_agent_overrides`、`agent_sessions`、`session_events`、`issue_actions`、`completion_attempts`。

版本核验：`rusqlite` 当前 registry 查询为 `0.40.0`；`tauri-plugin-sql` 当前为 `2.4.0`，但仅作为参考，不作为业务状态写入方案。

### Authentication & Security

MVP 不做用户登录、远程认证或多租户授权。安全边界集中在本机权限、Tauri command 暴露面、文件系统 scope、进程启动和 Git 操作上。

React 不能直接调用 shell 执行任意命令。Agent command 检测、Codex 启动、PTY 输入、Git status/HEAD 检测、日志路径创建都由 Rust Core 校验后执行。Tauri plugin 权限保持最小化：只按功能引入 dialog/fs/opener/log 等必要能力，并避免把 shell plugin 暴露为通用前端能力。

### API & Communication Patterns

前后端通信使用 Tauri command + event，不引入 HTTP REST/GraphQL。Command 用于请求动作，event 用于通知状态变化和 Session 输出索引更新。所有 command 返回统一错误结构：`code`、`message`、可选 `details`，与项目 API 约定保持一致。

类型合同由 Rust `serde` 模型生成 TypeScript 类型。候选工具为 `ts-rs`，当前 registry 查询为 `12.0.1`。所有跨边界 DTO 显式建模，不让前端猜测 payload shape。

### Frontend Architecture

React Workbench 采用 Activity-level 组织：`Issues`、`Agents`、`Settings`。状态分层为：
- server/core state：来自 Tauri command 查询和 core event 刷新；
- view state：当前选中的 Activity、Session、Dialog、Inspector；
- terminal state：xterm 实例生命周期，避免因 Inspector/Dialog 打开而卸载。

状态管理建议使用轻量 store，候选 `zustand` 当前 npm 查询为 `5.0.14`。路由可使用简单本地 router 或 `@tanstack/react-router`；如果引入后者，当前 npm 查询为 `1.170.11`。UI 组件使用自建 CSS/token 层，图标使用 `lucide-react`，当前 npm 查询为 `1.17.0`。

### Infrastructure & Deployment

MVP 是本地桌面应用，不设计云 hosting。开发环境以 `pnpm tauri dev` 为主，构建以 Tauri bundle 为主。CI/CD 第一阶段只要求 lint、typecheck、unit test、Rust test 和基础 build 验证；签名、公证、自动更新和商店分发延后。

日志分两层：应用诊断日志使用 Tauri/Rust logging；Agent 原始终端输出按 Session 写入日志文件，并由 SQLite 保存路径。监控不接入云端 telemetry，Diagnostics 只读取本地信息。

### Decision Impact Analysis

**Implementation Sequence:**
1. 初始化 `create-tauri-app react-ts`。
2. 建立 TypeScript/Rust lint、typecheck、test、format 脚本。
3. 建立 Rust Core 模块边界和 Tauri command/error/event 类型合同。
4. 接入 SQLite migration 与 repository 层。
5. 实现 Workspace / Issue 状态机基础。
6. 做 PTY + xterm + Codex Spike。
7. 接入 AgentSession、SessionEvent、日志文件。
8. 实现 Review 和 CompletionAttempt / Git 检测闭环。
9. 补齐 Summary、Settings、i18n 和异常复盘。

**Cross-Component Dependencies:**
- Rust Core 独占数据库写入决定了前端只能通过 command/event 更新业务状态。
- PTY 生命周期决定 Agents Activity、Issue Inspector、Dialog 都不能卸载 xterm。
- Completion Policy 依赖 Git 检测、AgentSession 状态、CompletionAttempt 事务记录。
- i18n 必须从一开始进入状态和命令文案，避免后续硬编码替换。

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:**
识别出 12 类高风险冲突点：数据库命名、Rust/TS 类型命名、Tauri command 命名、event 命名、错误结构、状态机写入路径、React 组件组织、Dialog/Inspector 生命周期、日志格式、日期时间格式、测试位置、i18n 文案组织。

### Naming Patterns

**Database Naming Conventions:**
- SQLite table 使用 `snake_case` 复数名词：`workspaces`、`issues`、`agent_sessions`、`completion_attempts`。
- SQLite column 使用 `snake_case`：`workspace_id`、`created_at`、`prompt_snapshot`。
- 主键统一为 `id`；外键统一为 `{entity}_id`。
- JSON payload 列统一以 `_json` 结尾：`payload_json`、`changed_files_json`。
- timestamp 列统一以 `_at` 结尾，保存 ISO 8601 UTC 字符串。
- index 命名使用 `idx_{table}_{columns}`：`idx_issues_workspace_id_status`。
- unique index 命名使用 `uidx_{table}_{columns}`。

**API / Command Naming Conventions:**
- 不引入 HTTP API；Tauri command 使用 `snake_case` 动词短语：`create_workspace`、`start_agent_session`、`mark_issue_review`。
- 前端 command wrapper 使用 `camelCase`：`createWorkspace`、`startAgentSession`。
- Event name 使用 kebab-case domain event：`workspace-created`、`session-started`、`issue-review-marked`、`completion-failed`。
- Event payload TypeScript 字段使用 `camelCase`；Rust 内部字段可用 `snake_case`，跨边界序列化必须输出 `camelCase`。
- 错误码使用 `SCREAMING_SNAKE_CASE`：`AGENT_COMMAND_NOT_EXECUTABLE`、`NO_COMMIT_DETECTED`。

**Code Naming Conventions:**
- 文件和目录使用 `kebab-case`：`issue-card.tsx`、`agent-session-service.rs`。
- React component 使用 `PascalCase`：`IssueCard`、`SessionHeader`。
- TypeScript 变量/函数使用 `camelCase`；类型/interface/class 使用 `PascalCase`。
- Rust module/file 使用 `snake_case`；Rust struct/enum 使用 `PascalCase`；Rust function 使用 `snake_case`。
- 状态枚举值跨边界统一使用 PRD 字面量：`backlog`、`running`、`review`、`completed`、`closed`、`crashed`、`stopped`、`none`、`requested`。
- `stopped` 是正式 Agent Session 状态，用于应用重启后无法恢复活 PTY 的场景；`crashed` 用于 Codex/PT​Y 进程异常退出。

### Structure Patterns

**Project Organization:**
- 前端按 feature + workbench surface 组织，不按纯组件类型堆叠。
- `src/features/issues/` 放 Issue 看板、卡片、详情弹窗和相关 hooks/store。
- `src/features/agents/` 放 Session list、Session Header、xterm 容器、Issue Inspector。
- `src/features/settings/` 放 Workspace Settings 和 Global Settings。
- `src/shared/` 只放跨 feature 复用的 UI primitives、types、i18n、command client、error helpers。
- 禁止把业务逻辑塞进泛化 `utils`；共享逻辑必须有明确领域名。

**Rust Core Organization:**
- `src-tauri/src/core/` 放业务 service 和状态机。
- `src-tauri/src/db/` 放连接、migration、repository。
- `src-tauri/src/commands/` 放 Tauri command adapter，只做参数校验、调用 core、映射返回。
- `src-tauri/src/events/` 放 event 类型和 emit helper。
- `src-tauri/src/agent/` 放 AgentAdapter、CodexAdapter、PTY 管理。
- `src-tauri/src/git/` 放 Git status/HEAD/operation-state 检测。
- `src-tauri/src/logs/` 放 Session log path 和写入策略。
- `src-tauri/src/types/` 放跨边界 DTO 与导出到 TypeScript 的类型。

**Testing Structure:**
- 前端组件测试与组件 co-located：`issue-card.test.tsx`。
- 前端跨 feature 行为测试放 `src/__tests__/`。
- Rust 单元测试与模块 co-located；涉及 DB/状态机的集成测试放 `src-tauri/tests/`。
- Spike 验证脚本可放 `spikes/` 或 `src-tauri/tests/spikes/`，但不能混入生产模块。

### Format Patterns

**API / Command Response Formats:**
- Command 成功返回直接业务 DTO；列表 DTO 必须显式包含数组字段，不返回裸数组给复杂 surface。
- Command 失败统一映射为：
  ```json
  {
    "code": "AGENT_COMMAND_NOT_EXECUTABLE",
    "message": "Agent command 不可执行。",
    "details": [
      {
        "@type": "CommandPath",
        "path": "/usr/local/bin/codex"
      }
    ]
  }
  ```
- `details` 可选；存在时每个对象必须包含 `@type`。

**Data Exchange Formats:**
- 跨 Rust/TypeScript 边界 JSON 字段使用 `camelCase`。
- SQLite 内部列名使用 `snake_case`。
- 日期时间跨边界使用 ISO 8601 字符串，不使用 Unix timestamp。
- 空值：未知或未产生的数据用 `null`；空集合用 `[]`；不要混用空字符串表达缺失。
- ID 使用字符串，不在前端假设自增整数。

### Communication Patterns

**Event System Patterns:**
- Event 只通知“事实已发生”或“状态已改变”，不发起业务写入。
- Event name 使用过去式或结果语义：`session-started`、`session-start-failed`、`issue-completed`。
- Event payload 必须包含可定位实体 ID：`workspaceId`、`issueId`、`sessionId`。
- 高频终端输出不逐字符发结构化业务事件；xterm 数据流走专门 PTY channel，SQLite 只记录关键 SessionEvent。
- Event handler 只刷新相关 core state，不在前端推导业务状态。

**State Management Patterns:**
- Rust Core 是业务状态 source of truth。
- React store 只保存 view state、选中项、Dialog/Inspector 可见性和缓存的查询结果。
- `running`、`review`、`completed`、`closed` 等核心状态不得由前端直接 set。
- Issue 与 AgentSession 状态更新必须来自 command 返回或 core event。
- xterm 实例生命周期独立于 Issue Inspector 和 Dialog；打开/关闭 Inspector 不重新创建 terminal。

### Process Patterns

**Error Handling Patterns:**
- Rust domain error 使用可枚举 code；Tauri command adapter 统一映射到前端错误格式。
- 用户可见错误必须事实性说明状态结果，例如“启动失败，Issue 保持待办。”
- 日志错误和用户错误分层：用户看到简洁 message，Diagnostics 可查看 detail/log path。
- `no_commit_detected`、`crashed`、`stopped`、`log_missing` 都必须是显式状态或错误码，不得用通用失败吞掉。

**Loading State Patterns:**
- 每个 command wrapper 暴露 local pending/error，不使用全局大 loading 遮挡整个工作台。
- 启动 Agent、completion attempt 等长动作必须禁用重复提交按钮，但不冻结 xterm。
- loading 文案描述动作本身：`正在启动 Agent...`、`正在检测 Git 状态...`。
- command 失败后保持原业务状态，并清理 pending。

**Validation Patterns:**
- 外部输入在 Rust Core command 边界校验。
- 前端可做即时表单校验，但不能代替 Rust Core 校验。
- Agent command path、repo path、log path、Git repo 校验都在 Rust Core 完成。
- Prompt 快照必须在启动成功路径中持久化；启动失败不得创建有效 AgentSession。

### Enforcement Guidelines

**All AI Agents MUST:**
- 不绕过 Rust Core 写 SQLite 或改业务状态。
- 不让 React 直接执行 shell/Git/Codex 命令。
- 不新增与 PRD 冲突的状态值、Issue 字段或 Session attempt 模型。
- 不把 Codex 写死到 UI 命令语义；UI 使用 Agent 泛称，配置里体现 Codex。
- 不引入大型 UI 管理后台组件库或营销式页面结构。
- 不把原始终端输出逐字符写入 SQLite。
- 不在 completed Issue 上新增 Run/Reopen 主路径。
- 不把 `review` 当作 AgentSession 状态或 Session list 分组。

**Pattern Enforcement:**
- 新增跨边界 DTO 时，必须更新 Rust 类型导出和前端类型引用。
- 新增状态变更时，必须同时补 IssueAction 或 SessionEvent / CompletionAttempt。
- 新增 command 时，必须有统一错误 code、command wrapper 和至少一个失败路径测试。
- 新增文案时，必须进入 i18n 字典，不在组件里硬编码核心状态/命令文案。
- 修改架构模式时，必须更新本 architecture 文档或后续 ADR。

### Pattern Examples

**Good Examples:**
- `start_agent_session(issue_id, profile_id, prompt)` 只在 Rust Core 成功启动 PTY 后创建 `agent_sessions` 并把 Issue 改为 `running`。
- `session-started` event payload 包含 `workspaceId`、`issueId`、`sessionId`，前端收到后刷新对应 Session。
- `completion_attempts.changed_files_json` 保存 changed files 摘要；原始终端输出写入 Session log 文件。
- `IssueInspector` 打开时只改变 view state，不卸载 `CodexTerminal`。

**Anti-Patterns:**
- React 直接把 Issue 设置为 `completed`。
- 前端调用 shell plugin 执行 `git status` 或 `codex`。
- SQLite 表名混用 `AgentSession`、`agentSession`、`agent_sessions`。
- Event 使用命令式名称 `mark-review`，导致语义像请求而不是事实。
- 在 Issue card 里新增 priority/label/assignee 并扩大 MVP scope。
- 把 waiting-for-user 建成 AgentSession 主状态，而不是 `attention=requested`。

## Project Structure & Boundaries

### Complete Project Directory Structure

```text
redwhisk/
├── README.md
├── AGENTS.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── index.html
├── eslint.config.js
├── prettier.config.mjs
├── vitest.config.ts
├── playwright.config.ts
├── .env.example
├── .gitignore
├── docs/
│   └── standards/
│       ├── README.md
│       └── shared/
│           ├── api-conventions.md
│           ├── coding-style.md
│           ├── engineering-spec.md
│           └── git-workflow.md
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── app.tsx
│   │   ├── app-shell.tsx
│   │   ├── activity-router.tsx
│   │   └── app.css
│   ├── features/
│   │   ├── workspace/
│   │   │   ├── workspace-picker.tsx
│   │   │   ├── recent-workspaces.tsx
│   │   │   ├── workspace-store.ts
│   │   │   └── workspace-commands.ts
│   │   ├── issues/
│   │   │   ├── issues-activity.tsx
│   │   │   ├── issue-board.tsx
│   │   │   ├── issue-lane.tsx
│   │   │   ├── issue-card.tsx
│   │   │   ├── issue-detail-dialog.tsx
│   │   │   ├── run-dialog.tsx
│   │   │   ├── issue-summary.tsx
│   │   │   ├── issues-store.ts
│   │   │   ├── issue-actions.ts
│   │   │   └── issue-card.test.tsx
│   │   ├── agents/
│   │   │   ├── agents-activity.tsx
│   │   │   ├── agent-session-list.tsx
│   │   │   ├── session-dialog.tsx
│   │   │   ├── session-header.tsx
│   │   │   ├── issue-inspector.tsx
│   │   │   ├── codex-terminal.tsx
│   │   │   ├── completion-confirmation.tsx
│   │   │   ├── agents-store.ts
│   │   │   ├── terminal-store.ts
│   │   │   └── codex-terminal.test.tsx
│   │   └── settings/
│   │       ├── workspace-settings-activity.tsx
│   │       ├── global-settings-dialog.tsx
│   │       ├── agent-profile-form.tsx
│   │       ├── workspace-agent-override-form.tsx
│   │       ├── diagnostics-panel.tsx
│   │       └── settings-store.ts
│   ├── shared/
│   │   ├── commands/
│   │   │   ├── command-client.ts
│   │   │   ├── command-error.ts
│   │   │   └── generated-types.ts
│   │   ├── events/
│   │   │   ├── event-client.ts
│   │   │   └── event-names.ts
│   │   ├── i18n/
│   │   │   ├── index.ts
│   │   │   ├── zh-cn.ts
│   │   │   └── en-us.ts
│   │   ├── ui/
│   │   │   ├── button.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── icon-button.tsx
│   │   │   ├── inspector.tsx
│   │   │   ├── toolbar.tsx
│   │   │   └── tooltip.tsx
│   │   ├── styles/
│   │   │   ├── tokens.css
│   │   │   ├── themes.css
│   │   │   └── reset.css
│   │   └── test/
│   │       ├── render.tsx
│   │       └── fixtures.ts
│   └── __tests__
│       ├── issue-run-flow.test.tsx
│       └── review-completion-flow.test.tsx
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/
│   │   └── default.json
│   ├── migrations/
│   │   ├── 0001_initial.sql
│   │   └── 0002_agent_sessions.sql
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── app_state.rs
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── workspace_commands.rs
│   │   │   ├── issue_commands.rs
│   │   │   ├── agent_commands.rs
│   │   │   ├── settings_commands.rs
│   │   │   └── completion_commands.rs
│   │   ├── core/
│   │   │   ├── mod.rs
│   │   │   ├── workspace_service.rs
│   │   │   ├── issue_service.rs
│   │   │   ├── agent_session_service.rs
│   │   │   ├── completion_service.rs
│   │   │   ├── settings_service.rs
│   │   │   └── state_machine.rs
│   │   ├── db/
│   │   │   ├── mod.rs
│   │   │   ├── connection.rs
│   │   │   ├── migrations.rs
│   │   │   ├── workspace_repository.rs
│   │   │   ├── issue_repository.rs
│   │   │   ├── agent_profile_repository.rs
│   │   │   ├── agent_session_repository.rs
│   │   │   ├── event_repository.rs
│   │   │   └── completion_attempt_repository.rs
│   │   ├── agent/
│   │   │   ├── mod.rs
│   │   │   ├── agent_adapter.rs
│   │   │   ├── codex_adapter.rs
│   │   │   ├── pty_manager.rs
│   │   │   ├── pty_session.rs
│   │   │   └── command_detector.rs
│   │   ├── git/
│   │   │   ├── mod.rs
│   │   │   ├── repository.rs
│   │   │   ├── status.rs
│   │   │   └── operation_state.rs
│   │   ├── logs/
│   │   │   ├── mod.rs
│   │   │   ├── app_log.rs
│   │   │   └── session_log.rs
│   │   ├── events/
│   │   │   ├── mod.rs
│   │   │   ├── event_names.rs
│   │   │   └── event_emitter.rs
│   │   ├── types/
│   │   │   ├── mod.rs
│   │   │   ├── workspace.rs
│   │   │   ├── issue.rs
│   │   │   ├── agent.rs
│   │   │   ├── completion.rs
│   │   │   └── errors.rs
│   │   └── testsupport/
│   │       ├── mod.rs
│   │       ├── temp_workspace.rs
│   │       └── db_fixture.rs
│   └── tests/
│       ├── workspace_lifecycle.rs
│       ├── issue_state_machine.rs
│       ├── agent_session_start.rs
│       ├── completion_policy.rs
│       └── git_detection.rs
├── e2e/
│   ├── workspace-open.spec.ts
│   ├── issue-run-review.spec.ts
│   └── completion-summary.spec.ts
├── spikes/
│   ├── embedded-codex-terminal.md
│   ├── codex-resume-completion-prompt.md
│   └── git-commit-detection.md
└── scripts/
    ├── check-generated-types.mjs
    └── export-rust-types.mjs
```

### Architectural Boundaries

**API Boundaries:**
MVP 不提供 HTTP API。前后端边界是 Tauri command/event：
- React 通过 `src/shared/commands/command-client.ts` 调用 command。
- Rust command adapter 位于 `src-tauri/src/commands/`。
- 业务状态变化由 `src-tauri/src/core/` 完成。
- event 从 `src-tauri/src/events/` 发出，前端在 `src/shared/events/` 订阅。

**Component Boundaries:**
- `features/issues` 管 Issue 看板、Issue Detail、Run Dialog 和 completed Summary。
- `features/agents` 管 Agent Session list、Codex terminal、Session Header、Issue Inspector 和 completion confirmation。
- `features/settings` 管 Workspace Settings、Global Settings、Agent Profile 和 Diagnostics。
- `shared/ui` 只能放无业务语义的基础桌面控件。
- `shared/commands` 和 `shared/events` 是前端接入 Rust Core 的唯一通道。

**Service Boundaries:**
- `core/*_service.rs` 是业务动作入口和状态机执行者。
- `db/*_repository.rs` 只做持久化，不决定业务状态。
- `commands/*_commands.rs` 只做边界适配，不复制业务规则。
- `agent/*` 只负责 Codex/PTY 进程生命周期，不直接完成 Issue。
- `git/*` 只负责 Git 检测，不执行自动提交策略。

**Data Boundaries:**
- SQLite 写入只发生在 Rust repository/service 层。
- Session 原始输出写入 log files；SQLite 保存 `log_path`、SessionEvent 和摘要。
- 前端不持久化权威业务状态，只缓存查询结果和 view state。
- 跨边界 DTO 由 `src-tauri/src/types/` 导出到 `src/shared/commands/generated-types.ts`。

### Requirements to Structure Mapping

**Feature / FR Mapping:**
- FR-1 至 FR-3 Workspace / Settings：`features/workspace/`、`features/settings/`、`core/workspace_service.rs`、`core/settings_service.rs`、`db/workspace_repository.rs`
- FR-4 至 FR-6 Issue 管理与 IssueAction：`features/issues/`、`core/issue_service.rs`、`core/state_machine.rs`、`db/issue_repository.rs`、`db/event_repository.rs`
- FR-7 至 FR-9 Agent Profile / prompt：`features/settings/agent-profile-form.tsx`、`features/issues/run-dialog.tsx`、`agent/command_detector.rs`、`db/agent_profile_repository.rs`
- FR-10 至 FR-12 从 Issue 启动 Session：`features/issues/run-dialog.tsx`、`features/agents/agents-activity.tsx`、`core/agent_session_service.rs`、`agent/pty_manager.rs`
- FR-13 至 FR-16 Codex Native Session / 临时 Session：`features/agents/codex-terminal.tsx`、`agent/codex_adapter.rs`、`agent/pty_session.rs`、`logs/session_log.rs`
- FR-17 至 FR-19 Review / crashed / stopped：`features/agents/session-header.tsx`、`core/state_machine.rs`、`core/agent_session_service.rs`
- FR-20 至 FR-22 Completion Policy：`features/agents/completion-confirmation.tsx`、`core/completion_service.rs`、`git/status.rs`、`db/completion_attempt_repository.rs`
- FR-23 至 FR-24 Summary / Log：`features/issues/issue-summary.tsx`、`logs/session_log.rs`、`db/completion_attempt_repository.rs`
- FR-25 Header / Inspector：`features/agents/session-header.tsx`、`features/agents/issue-inspector.tsx`
- FR-26 i18n：`shared/i18n/zh-cn.ts`、`shared/i18n/en-us.ts`

**Cross-Cutting Concerns:**
- 错误格式：`src-tauri/src/types/errors.rs`、`src/shared/commands/command-error.ts`
- 状态机：`src-tauri/src/core/state_machine.rs`
- 审计：`db/event_repository.rs`、`issue_actions`、`session_events`、`completion_attempts`
- 主题与桌面 UI：`src/shared/styles/tokens.css`、`themes.css`、`shared/ui/`
- 类型生成：`src-tauri/src/types/`、`scripts/export-rust-types.mjs`

### Integration Points

**Internal Communication:**
React Activity -> command client -> Tauri command -> Rust Core service -> repository / PTY / Git / logs -> event emitter -> React event client -> feature store refresh。

**External Integrations:**
- Codex CLI：通过 `agent/codex_adapter.rs` 和 `agent/pty_manager.rs`。
- Git repository：通过 `git/repository.rs`、`git/status.rs`、`git/operation_state.rs`。
- OS file/dialog/open log：通过最小 Tauri plugin 能力和 Rust Core 封装。
- 无云服务、无 HTTP backend、无 telemetry。

**Data Flow:**
1. 用户在 React surface 触发动作。
2. 前端 command wrapper 发送 DTO。
3. Rust command adapter 校验边界输入并调用 Core。
4. Core 执行业务规则和状态机，必要时调用 DB、Agent、Git、Logs。
5. Core 在同一动作路径写入审计记录。
6. Rust 发送 event。
7. 前端刷新相关 store 并更新 UI。

### File Organization Patterns

**Configuration Files:**
- 根目录保存前端/工作区配置：`package.json`、`vite.config.ts`、`tsconfig.json`、`eslint.config.js`、`vitest.config.ts`。
- Tauri/Rust 配置在 `src-tauri/`：`Cargo.toml`、`tauri.conf.json`、`capabilities/default.json`。
- 环境示例只放 `.env.example`，MVP 不依赖云端 secret。

**Source Organization:**
- 前端按 Activity/feature 组织。
- Rust 按 command/core/db/agent/git/logs/events/types 分层组织。
- shared 目录不得成为业务逻辑垃圾桶。

**Test Organization:**
- 单组件测试 co-located。
- 跨 feature React 行为测试放 `src/__tests__/`。
- Rust core/db/git 集成测试放 `src-tauri/tests/`。
- E2E 测试放 `e2e/`，覆盖 Workspace、Issue Run/Review、Completion Summary。
- Spike 文档和验证记录放 `spikes/`。

**Asset Organization:**
- MVP 不需要营销资产。
- App icon 和 Tauri bundle 资产留在 Tauri 默认位置。
- UI token 和主题 CSS 放 `src/shared/styles/`。

### Development Workflow Integration

**Development Server Structure:**
- `pnpm tauri dev` 启动 Tauri + Vite。
- 前端热更新只影响 React surface，不应重启 Rust Core 状态机测试。
- PTY/Codex Spike 通过前，不进入完整业务联调。

**Build Process Structure:**
- `pnpm build` 执行 TypeScript typecheck 和 Vite build。
- `cargo test` / `cargo clippy` 在 `src-tauri/` 执行。
- Tauri bundle 作为桌面分发产物，签名和自动更新延后。

**Deployment Structure:**
- MVP 只面向本地桌面分发。
- CI 产物应包含前端 build、Rust test、Tauri build 验证。
- 云 hosting、server deployment、container、Kubernetes 均不进入 MVP 项目结构。

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
Tauri、React、TypeScript、Rust Core、SQLite、PTY/xterm、Git 检测和本地日志文件的组合一致。Rust Core 作为状态与本地副作用边界，支撑 PRD 对状态可靠性、审计性和完成安全的要求。

**Pattern Consistency:**
命名、错误、event、command、状态更新、日志和 i18n 规则与核心决策一致。React 不直接写 SQLite、不直接执行 shell/Git/Codex，避免多 Agent 实现冲突。

**Structure Alignment:**
项目结构覆盖前端 Activity、Rust command/core/db/agent/git/logs/events/types、测试、spikes 和脚本。目录边界支持已定义模式。

### Requirements Coverage Validation ✅

**Functional Requirements Coverage:**
FR-1 至 FR-26 均已有结构和架构支撑。Workspace、Issue、Agent Profile、Run Dialog、Agent Session、Codex Native Session、Review、Completion、Summary/Log、Header/Inspector、i18n 都映射到具体模块。

**Non-Functional Requirements Coverage:**
本地优先、隐私、状态可靠性、审计性、终端性能、完成安全、失败可见性和跨平台目标均已纳入架构。高频终端输出写日志文件，SQLite 保存结构化事实。

### Implementation Readiness Validation ✅

**Decision Completeness:**
关键技术和边界已决策：official Tauri starter、Rust Core 独占状态写入、SQLite repository/service、Tauri command/event、PTY/xterm、Git 检测、类型生成和轻量前端状态。

**Structure Completeness:**
项目树已具体到主要文件和目录，足以指导首轮脚手架和后续故事拆分。

**Pattern Completeness:**
已覆盖数据库命名、跨边界 DTO、command/event、错误格式、状态更新、日志、测试和 i18n。

### Gap Analysis Results

**Critical Gaps:** 无。

**Important Gaps:**
- Embedded Codex Terminal Spike 仍需真实验证。
- Codex resume 与 completion prompt 注入仍需 Spike 验证；Epic 5 的 `agent_auto_commit` stories 必须等待对应 Spike gate 结论。
- Git commit detection 仍需真实仓库场景验证；Epic 5 的 `agent_auto_commit` stories 必须等待对应 Spike gate 结论。

**Nice-to-Have Gaps:**
- UX key-screen mockups 可在实现前补充。
- Turbo 暂不引入；后续拆 monorepo package 后再评估。

### Validation Issues Addressed

验证中没有发现会阻塞实现的架构矛盾。已明确当前 MVP 使用 `pnpm` 即可，不把 Turbo 纳入初始架构。

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** high

**Key Strengths:**
- 状态写入边界清晰，前端不会成为第二个 source of truth。
- Agent/PTY、Git、SQLite、日志和审计职责分离。
- PRD 的失败路径都有明确架构承载。
- 项目结构足够具体，适合 AI Agent 后续一致实现。

**Areas for Future Enhancement:**
- 补关键屏 mockups。
- 完成三个 Spike 并把结果回写架构或 ADR。
- 后续多 package 化后再评估 Turbo。

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented.
- Use implementation patterns consistently across all components.
- Respect project structure and boundaries.
- Refer to this document for all architectural questions.

**First Implementation Priority:**

```bash
pnpm create tauri-app@latest . --template react-ts
```

初始化后立即补齐 lint、typecheck、format、test 脚本，并建立 Rust/TypeScript 类型导出检查。
