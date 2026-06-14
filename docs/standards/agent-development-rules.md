# Agent 开发通用规则

## 目标

本文档把 `_bmad-output` 中的架构、PRD、UX 与实现故事约束，收敛为后续 Agent 开发可直接引用的通用规则。

当规划文档与当前代码不一致时，以当前代码事实为准。特别是：实体 `id` 当前使用 SQLite `INTEGER` / TypeScript `number`，时间字段当前使用 Unix epoch milliseconds / TypeScript `number`，不是字符串 ID 或 ISO 字符串。

## 代码事实基线

当前项目是单仓库 Tauri 桌面应用：

- 前端：React 19、TypeScript、Vite、Vitest、ESLint、Prettier、Tailwind CSS 4。
- 桌面核心：Tauri 2、Rust 2021、`rusqlite`、`portable-pty`。
- 包管理：`pnpm`，当前不使用 Turbo 或多 package workspace。
- 数据库：SQLite migrations 位于 `src-tauri/migrations/`，结构化业务状态由 Rust Core 读写。
- 前后端边界：Tauri command + Tauri event；不引入 HTTP REST/GraphQL。
- Agent 终端：Rust PTY 管理进程与日志，前端 xterm.js 负责展示和输入转发。

## 目录边界

前端按 feature / workbench surface 组织：

- `src/app/`：应用入口、Activity 路由、Workbench shell、全局壳层样式。
- `src/features/project/`：Project Home、Project card、Project Switcher、Project command wrapper。
- `src/features/issues/`：Issues Activity、Issue Dialog、Run Prompt、Completion、Summary。
- `src/features/agents/`：Agents Activity、Session list、Codex terminal、Issue Inspector、临时 Session。
- `src/features/settings/`：Project Settings、Agent Profile 表单和 Settings command wrapper。
- `src/shared/commands/`：Tauri command client、统一 command error 处理。
- `src/components/ui/`：基础 UI primitive。
- `src/shared/styles/`：全局 token。

Rust 按 command adapter、core service、repository、类型和外部能力分层：

- `src-tauri/src/commands/`：Tauri command adapter，只做参数承接、状态注入和错误映射，不承载业务状态机。
- `src-tauri/src/core/`：业务 service、状态流转、事务编排。
- `src-tauri/src/db/`：连接、migration、repository 和 SQL 映射。
- `src-tauri/src/types/`：跨边界 DTO、状态枚举和 command error。
- `src-tauri/src/agent/`：Codex command 检测、PTY session 管理、终端输出广播。
- `src-tauri/src/git/`：Git status、HEAD、operation state 检测。

不得把领域逻辑塞进泛化 `utils`。当前已有 `src/lib/utils.ts` 仅作为轻量 class 合并工具使用，新增共享逻辑必须放入有明确领域语义的模块。

## 数据与状态规则

SQLite 是核心业务状态的事实来源，React 不直接读写 SQLite。

必须遵守：

- SQLite 表名使用 `snake_case` 复数名词，例如 `projects`、`issues`、`agent_sessions`。
- 主键统一为 `id INTEGER PRIMARY KEY`；外键统一为 `{entity}_id INTEGER`。
- 时间列统一以 `_at` 结尾，类型为 `INTEGER NOT NULL`，保存 Unix epoch milliseconds。
- 跨 Tauri 边界时字段名使用 `camelCase`，TypeScript 中 ID 和时间字段为 `number`。
- SQLite 内部 payload 字段使用 JSON 字符串列，例如 `payload_json`、`changed_files_json`。
- 新增状态变更时，必须同步写入对应审计记录：`IssueAction`、`SessionEvent` 或 `CompletionAttempt`。

禁止：

- 前端直接把 Issue 或 Agent Session 设置为 `running`、`review`、`completed`、`closed`。
- 绕过 Rust Core 修改 SQLite。
- 用空字符串表达缺失值；缺失值使用 `null`，空集合使用 `[]`。
- 添加与当前状态机冲突的新状态值。

## 状态枚举

当前核心状态值以代码枚举和 migrations 为准：

- Issue：`backlog`、`running`、`review`、`completed`。
- Agent Session：`running`、`closed`、`crashed`、`stopped`。
- Attention：`none`、`requested`。
- Completion Policy：`manual`、`agent_auto_commit`。
- CompletionAttempt option：`complete_manual`、`complete_clean`、`agent_auto_commit`。
- CompletionAttempt result：`completed`、`prompt_sent`、`no_commit_detected`、`git_operation_blocked`。
- Agent Profile scope：`project`、`global`。
- Agent type：当前只有 `codex`。

`review` 是 Issue 状态，不是 Agent Session 状态，也不是 Agents list 分组。`stopped` 表示应用重启后无法恢复原运行中 PTY；`crashed` 表示 Codex/PTY 进程异常退出。

## Command 与错误约定

Tauri command 是业务动作入口，命名使用 `snake_case` 动词短语，例如 `create_project`、`start_agent_session`、`mark_issue_review`。前端 wrapper 使用 `camelCase`，并统一通过 `invokeCommand` 调用。

Command 成功返回显式 DTO。复杂列表返回对象包装数组，例如：

```ts
interface IssueListResponse {
  issues: IssueRecord[];
}
```

Command 失败必须返回统一错误结构：

```json
{
  "code": "ISSUE_VALIDATION_FAILED",
  "message": "只有运行中的 Issue 可以标记待验收。",
  "details": [
    {
      "@type": "IssueStatus",
      "issueId": 1,
      "status": "backlog"
    }
  ]
}
```

错误码来自 Rust `CommandErrorCode`，序列化为 `SCREAMING_SNAKE_CASE`。`details` 可选；存在时每项必须包含 `@type`。

新增 command 时必须同时完成：

- Rust input/output DTO，使用 `#[serde(rename_all = "camelCase")]`。
- Rust command adapter 注册到 `tauri::generate_handler!`。
- 前端 command wrapper 和 TypeScript 类型。
- 至少一个成功路径测试和一个失败路径测试。

当前项目尚未落地 Rust DTO 自动生成 TypeScript 的流水线。新增或修改跨边界 DTO 时，必须手动同步 Rust 类型与前端类型，并用 command client 测试或 feature 测试覆盖关键字段。

## Event 与终端通道

Tauri event 只表示事实发生或终端输出，不发起业务写入。事件名使用 kebab-case，例如 `agent-session-terminal-output`。

事件 payload 必须包含定位实体的 ID，例如 `projectId`、`sessionId`、`issueId`。

终端输出规则：

- PTY 原始输出继续写入 session log 文件。
- Running Session 的 xterm 主渲染使用实时输出事件与 restore 结果，不再以轮询日志尾部作为主路径。
- `read_agent_session_terminal` 只适合作为非活跃 Session、Open Log 或诊断降级路径。
- 前端不得重放截断 ANSI 日志作为 Codex TUI 恢复方案。
- Inspector、Dialog、Header 操作不得卸载当前 xterm。

## Issue 与 Agent Session 流程规则

启动 Issue 关联 Agent Session：

- 只能从 `backlog` Issue 启动。
- 一个 Issue 最多关联一个 Agent Session。
- 只有进程/PTY 成功启动后，Rust Core 才创建 Agent Session，并把 Issue 改为 `running`。
- 启动失败时 Issue 保持 `backlog`，不得创建有效 Agent Session。

Review 阶段：

- 只有 `running` Issue 且存在运行中关联 Session 时，才能标记 `review`。
- 标记 `review` 后 Agent Session 仍保持 `running`。
- 用户在 review 中继续输入修正要求时，不得把 Issue 退回 `running`，也不得创建第二个 Session。

异常状态：

- Codex/PTY 异常退出时 Agent Session 进入 `crashed`。
- 应用重启后无法恢复原运行中 PTY 时进入 `stopped`。
- `crashed` / `stopped` 不会让关联 Issue 自动完成，UI 必须提供事实性提示和日志/诊断入口。

Completed：

- `completed` Issue 不提供 `Run`、`Reopen`、重新完成或重新运行主路径。
- 复盘入口是 Summary 和 Open Log。
- 日志路径缺失或文件不存在时必须显示明确错误。

## Completion 与 Git 安全边界

Completion Policy 只有 `manual` 和 `agent_auto_commit`。

必须遵守：

- 应用不得执行 `git add .`，不得静默提交全部改动。
- `agent_auto_commit` 只能向当前 Codex Session 注入 completion prompt，然后由 Rust Core 检测 Git HEAD/status/changed files。
- 检测到新 commit 后，记录 `commit_hash` 并完成 Issue。
- 未检测到新 commit 时，记录 `no_commit_detected`，Issue 保持 `review`。
- 检测到 merge/rebase/cherry-pick 等 Git operation 进行中时，记录 `git_operation_blocked`，提示用户手动处理，不自动完成。
- 每次完成尝试必须写入 `completion_attempts`。

## UI 与 UX 规则

RedWhisk 是本地桌面开发工具，不是 SaaS 管理后台或营销页面。

必须遵守：

- Project Home 是首屏；未选择 Project 前不显示 Activity Bar。
- Project 工作台 Activity Bar 只包含 `Issues`、`Agents`、`Settings`。
- Project Switcher 属于窗口顶部 chrome，不属于内容 Header。
- Activity Bar 主分组里的 `Settings` 是 Project Settings；Global Settings 是左侧菜单底部的仅图标 shell action，不属于 Project Activity 列表。
- Agents Activity 使用左右两栏：左侧 Session list，右侧 Codex Native Session View。
- Settings 页面外层布局遵守 [Settings 页面布局规范](./settings-page-layout.md)。
- 基础视觉使用 `src/shared/styles/tokens.css` 的 token；不要局部重新发明字体、圆角、焦点和色板体系。
- 图标优先使用已有 `lucide-react`。
- 核心状态不能只靠颜色表达，必须有文本或可访问 label。
- Dialog 打开后焦点进入 Dialog，关闭后回到触发控件；`Esc` 关闭最上层 Dialog/Inspector。
- `Enter` 在 Dialog 中提交主动作，在 Codex terminal 中原样传给终端。
- `prefers-reduced-motion: reduce` 下必须禁用或显著收敛非必要动画。

禁止：

- 新增营销式 hero、渐变装饰、大圆角卡片墙、彩色阶段柱或管理后台式重型组件库。
- 在 Codex Native Session View 之外再做独立聊天输入框。
- Header 无关联 Issue 时显示 `No linked issue`。
- Inspector/Dialog 打开关闭导致 xterm 重建。

## Agent Profile 与 Settings 规则

当前代码事实中，Agent Profile 使用同表 scope 模型：

- `agent_profiles.scope` 为 `project | global`。
- Project 级 profile 用 `project_id` 关联 Project。
- 当前 migrations 已移除早期 `project_agent_overrides` 表。
- 字段包括 `name`、`agent_type`、`command`、`scope`、`project_id`、`mode`、`dangerous`、`default_skill`、`prompt_template`。

后续 Agent 不应继续按早期规划文档中的 `ProjectAgentOverride` 表实现新功能；涉及 Settings 数据模型时，以 `src-tauri/migrations/0007_restructure_agent_profiles.sql`、`src-tauri/src/types/agent_profile.rs` 和当前 repository/service 为准。

Codex command 检测和测试由 Rust Core 完成，React 不直接执行 shell。command 不可用时，不得保存或启用会在启动时失败的 Agent Profile。

## 文案与国际化

规划文档要求核心状态和命令支持 `zh-CN` / `en-US`，但当前代码尚无 `src/shared/i18n` 运行时字典，且已有故事记录该项为 deferred work。

因此当前新增功能应遵守：

- 不扩大硬编码文案范围；新增核心状态、命令或错误文案时，优先集中在同一 formatter / helper 中。
- 不把 Codex 写死为通用 UI 命令语义；按钮和流程文案使用 Agent 泛称，配置项中体现 Codex。
- 若任务本身涉及文案或 i18n，应优先补运行时字典，再迁移相关硬编码文案。

## 测试与验证规则

改动 TypeScript / TSX / JavaScript 后，默认至少运行：

```bash
pnpm lint
pnpm typecheck
```

改动运行时行为、分支逻辑、数据流、渲染逻辑或测试依赖实现后，还必须运行：

```bash
pnpm test
```

影响构建、样式、Vite 配置或打包路径时，补充运行：

```bash
pnpm build
```

改动 Rust / Tauri / SQLite migrations 后，至少运行：

```bash
cd src-tauri && cargo test
```

改动文档时，至少检查：

```bash
find docs -maxdepth 3 -type f | sort
rg -n "相对链接|目标路径关键字" docs
git diff -- docs
```

如果因环境、耗时或外部依赖无法运行某项验证，最终说明必须写明未运行什么、为什么没运行、风险是什么。

## 参考来源

本规则整理自以下文档和代码事实：

- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md`
- `_bmad-output/planning-artifacts/sprint-change-proposal-integer-ids-and-epoch-ms-2026-06-05.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md`
- `_bmad-output/implementation-artifacts/6-1-stabilize-agent-session-terminal-rendering.md`
- `package.json`
- `src/`
- `src-tauri/src/`
- `src-tauri/migrations/`
